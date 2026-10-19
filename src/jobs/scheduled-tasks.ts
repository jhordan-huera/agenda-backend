import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { deleteExpiredRateLimits } from "../http/rate-limit-store.ts";
import { accountChangeNotice, findAccountChanges } from "../services/account-alerts.ts";
import { refreshAnalytics, type AnalyticsRefresh } from "../services/analytics-service.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import {
  clientImportNotice,
  findClientImports,
  findOnlineBookings,
  findPanelAppointments,
  findPanelClients,
  findPanelSeries,
  findSeriesCancellations,
  findStatusChanges,
  newClientNotice,
  onlineBookingNotice,
  panelAppointmentNotice,
  panelSeriesNotice,
  seriesCancelledNotice,
  statusChangeNotice,
  type BookingNotice,
} from "../services/booking-alerts.ts";
import { businessesWithCalendarInvites, syncCalendarInvites, upcomingInviteIds } from "../services/calendar-invites.ts";
import { deleteStalePendingAttachments } from "../services/clinical-attachment-service.ts";
import { saveDailyDatabaseStats, type DatabaseStatsRefresh } from "../services/database-stats-service.ts";
import { deleteUnusedImageUploads } from "../services/image-service.ts";
import { deleteStalePendingReceipts, purgeOldReceipts } from "../services/payment-service.ts";
import { processEmailQueue, scrubEmails, type EmailQueueReport } from "../services/mailer.ts";
import { maskEmail, shortName } from "../services/masking.ts";
import { runDailyAgendaJob, runReminderJob } from "../services/notifications.ts";
import { cleanupPanelNotices } from "../services/panel-notices.ts";
import { runPushJobs, type PushReport } from "../services/push-notices.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import type { EmailType } from "../shared/types/index.ts";

/** Emails puestos en cola y negocios en los que falló el trabajo (se siguió con los demás). */
export interface QueuedReminders {
  queued: number;
  failures: number;
}

/**
 * Ejecuta `work` para cada negocio, cada uno en su propia transacción. Si falla uno (p. ej. por
 * datos rotos), se registra y se sigue con los demás: un negocio no frena el cron de todos ni el
 * envío de la cola de emails.
 */
async function forEachBusiness(ids: string[], job: string, work: (db: Db, id: string) => Promise<number>): Promise<QueuedReminders> {
  const result: QueuedReminders = { queued: 0, failures: 0 };
  for (const id of ids) {
    try {
      result.queued += await transaction((db) => work(db, id));
    } catch (error) {
      result.failures++;
      // Sólo el id del negocio y el motivo: los registros de GitHub Actions son públicos.
      const message = scrubEmails(error instanceof Error ? error.message : String(error)).slice(0, 300);
      console.error(`[${job}] Falló el negocio ${id}: ${message}`);
    }
  }
  return result;
}

/**
 * Pone en cola los recordatorios de citas de todos los negocios activos y, por la mañana, la agenda
 * del día de los profesionales que la piden. Devuelve cuántos emails y en cuántos negocios falló.
 */
export async function queueAllReminders(): Promise<QueuedReminders> {
  const businesses = await many<{ id: string }>(
    pool,
    `select id from businesses
      where status = 'active' and (notification_settings ->> 'reminders')::boolean`,
  );
  const reminders = await forEachBusiness(
    businesses.map(({ id }) => id),
    "recordatorios",
    (db, id) => runReminderJob(db, id),
  );
  const withDailyAgenda = await many<{ id: string }>(
    pool,
    `select distinct p.business_id as id
       from professionals p join businesses b on b.id = p.business_id
      where b.status = 'active' and p.is_active and p.daily_agenda and p.email <> ''`,
  );
  const agendas = await forEachBusiness(
    withDailyAgenda.map(({ id }) => id),
    "agenda del día",
    (db, id) => runDailyAgendaJob(db, id),
  );
  return { queued: reminders.queued + agendas.queued, failures: reminders.failures + agendas.failures };
}

/**
 * Las invitaciones de calendario (spec 027): en cada pasada, las citas de la ventana de las agendas con el
 * interruptor, negocio por negocio. Las que entran en la ventana reciben la suya y las que cambiaron por
 * otro lado (el nombre del servicio, la dirección del negocio, el email de la agenda) su versión nueva; con
 * la huella, lo demás no se repite. Devuelve cuántas quedaron en cola y en cuántos negocios falló.
 */
export async function queueCalendarInvites(): Promise<QueuedReminders> {
  return forEachBusiness(await businessesWithCalendarInvites(pool), "invitaciones de calendario", async (db, id) =>
    syncCalendarInvites(db, await upcomingInviteIds(db, { businessId: id })),
  );
}

/** Resumen de una ejecución del cron (scripts/cron.ts). */
export interface ScheduledTasksReport {
  /** Recordatorios puestos en cola en esta ejecución. */
  reminders: number;
  /**
   * Negocios en los que falló preparar los recordatorios, la agenda del día o las invitaciones de calendario
   * (detalle en el registro).
   */
  reminderFailures: number;
  /**
   * Invitaciones de calendario (spec 027) puestas en cola en esta pasada: las citas que entraron en la
   * ventana o cambiaron por otro lado. Sólo la cifra (el registro es público).
   */
  calendarInvites?: number;
  /** Lo que hizo esta ejecución con la cola de emails. */
  emails: EmailQueueReport;
  /** Emails enviados desde la ejecución anterior: también los que salieron al momento (reservas, avisos). */
  sentSinceLastRun: number;
  /** Detalle de esos emails (hasta MAX_SENT_DETAILS) para el aviso de ntfy. */
  sentEmails: SentEmail[];
  /** Reservas desde la página pública desde la ejecución anterior. */
  onlineBookings?: number;
  /** El aviso de cada una (hasta MAX_BOOKING_NOTICES), con los datos del paciente a medias. */
  bookingNotices?: BookingNotice[];
  /** Pacientes registrados desde el panel desde la ejecución anterior. */
  panelClients?: number;
  /** El aviso de cada uno (hasta MAX_CLIENT_NOTICES), con quién lo registró y sus datos a medias. */
  clientNotices?: BookingNotice[];
  /** Citas agendadas desde el panel desde la ejecución anterior. */
  panelAppointments?: number;
  /** El aviso de cada una (hasta MAX_APPOINTMENT_NOTICES), con quién la agendó y los pacientes a medias. */
  appointmentNotices?: BookingNotice[];
  /** Series de citas agendadas desde el panel desde la ejecución anterior (spec 011): un aviso por serie. */
  panelSeries?: number;
  /** El aviso de cada una (hasta MAX_SERIES_NOTICES), con sus fechas, quién la agendó y los pacientes a medias. */
  seriesNotices?: BookingNotice[];
  /** «Cancelar ésta y las siguientes» desde la ejecución anterior (spec 011). */
  seriesCancellations?: number;
  /** El aviso de cada una (hasta MAX_SERIES_NOTICES): cuántas citas, desde cuándo, quién y sus emails. */
  seriesCancelNotices?: BookingNotice[];
  /** Cambios de estado de citas desde la ejecución anterior (spec 008). */
  statusChanges?: number;
  /** El aviso de cada uno (hasta MAX_STATUS_NOTICES): de qué estado a cuál, quién y sus emails. */
  statusNotices?: BookingNotice[];
  /** Importaciones de pacientes desde un Excel o un CSV desde la ejecución anterior (spec 012). */
  clientImports?: number;
  /** El aviso de cada una (hasta MAX_IMPORT_NOTICES), con la cifra y quién la hizo, sin datos de pacientes. */
  importNotices?: BookingNotice[];
  /** Cambios de seguridad en cuentas de super admin desde la ejecución anterior (spec 009). */
  accountChanges?: number;
  /** El aviso de cada uno (hasta MAX_ACCOUNT_NOTICES), con la cuenta enmascarada. */
  accountNotices?: ReturnType<typeof accountChangeNotice>[];
  /** Fecha de la ejecución anterior (null si es la primera). */
  since: string | null;
  /** Emails que siguen en cola al terminar (reintentos o lote máximo alcanzado). */
  pending: number;
  /** Cuentas con muchos intentos fallidos de inicio de sesión (ver findLoginAttacks). */
  security: LoginAlert[];
  /** Avisos en el celular (spec 013): los que puso en cola esta pasada y el envío de toda la cola. */
  push?: PushReport;
  /**
   * Centro de avisos del panel (spec 014): los que guardó esta pasada en las campanas (citas por cerrar,
   * resumen de las 8 y los del super admin) y los de más de 30 días que borró (null: no se pudo, p. ej.
   * sin la migración 041).
   */
  panelNotices?: { created: number; purged: number | null };
  /**
   * Analítica del super admin (spec 016): si esta pasada preparó la foto de hoy (después de las 06:00 de
   * Ecuador, una vez al día), si ya estaba, si era temprano o si falló (el cron siguió con lo demás).
   */
  analytics?: AnalyticsRefresh;
  /**
   * La foto del tamaño de la base (spec 024): si esta pasada la guardó (después de las 06:00 de Ecuador,
   * una vez al día), si ya estaba, si era temprano o si falló (el cron siguió con lo demás).
   */
  databaseStats?: DatabaseStatsRefresh;
  /** Registros de auditoría borrados por antigüedad (purge_audit_logs: sesiones 90 días, acciones 5 meses, historia clínica 5 años). */
  auditPurged: number;
  /** Emails con más de EMAIL_CONTENT_DAYS días a los que se les borró el contenido. */
  emailContentPurged: number;
  /** Comprobantes de pago borrados por antigüedad (null: sin almacenamiento configurado). */
  receiptsPurged: number | null;
  /** Logos y fotos subidos hace más de 24 h que nadie usa, borrados (null: sin almacenamiento). */
  unusedImagesDeleted: number | null;
  /** Cuentas caducadas de los límites de intentos, borradas. */
  rateLimitsPurged: number;
  durationMs: number;
}

/**
 * Un email enviado, tal como sale en el aviso de ntfy: el destinatario con el email enmascarado y,
 * si es de una cita, el paciente con el nombre abreviado ("María L."), sin más datos personales.
 */
export interface SentEmail {
  type: EmailType;
  to: string;
  businessName: string | null;
  /** La cita del email: con ella se junta el email al paciente con su copia al profesional. */
  appointmentId: string | null;
  clientName: string | null;
  date: string | null;
  startTime: string | null;
}

/** Emails detallados en el aviso; del resto sólo se dice cuántos son. */
const MAX_SENT_DETAILS = 40;

/** Una cuenta (email enmascarado: el aviso sale por ntfy) con muchos intentos fallidos. */
export interface LoginAlert {
  account: string;
  attempts: number;
}

/** Intentos fallidos que hacen saltar la alerta, dentro de la última hora. */
const LOGIN_ALERT_ATTEMPTS = 10;


/**
 * Cuentas (o emails sin cuenta) con LOGIN_ALERT_ATTEMPTS o más intentos fallidos en la última
 * hora y alguno nuevo desde la ejecución anterior: así la alerta no se repite cada 10 minutos.
 */
async function findLoginAttacks(since: string | null): Promise<LoginAlert[]> {
  const rows = await many<{ email: string | null; attempted: string; attempts: number }>(
    pool,
    `select u.email, max(l.actor_name) as attempted, count(*)::int as attempts
       from audit_logs l left join users u on u.id = l.actor_id
      where l.action = 'session.login_failed' and l.created_at > now() - interval '1 hour'
      group by coalesce(l.actor_id::text, lower(l.actor_name)), u.email
     having count(*) >= $1 and max(l.created_at) > coalesce($2::timestamptz, now() - interval '1 hour')
      order by attempts desc`,
    [LOGIN_ALERT_ATTEMPTS, since],
  );
  return rows.map((row) => ({ account: maskEmail(row.email ?? row.attempted), attempts: row.attempts }));
}

/** Hasta 30 lotes de 10 emails por ejecución; lo que quede sale en la siguiente. */
const MAX_EMAIL_BATCHES = 30;
/**
 * Tiempo para empezar envíos en cada ejecución: el job de GitHub tiene 10 minutos y aún debe
 * limpiar y avisar. Lo que quede sale en la siguiente.
 */
const EMAIL_BUDGET_MS = 6 * 60_000;

/** Días que se guarda el contenido de cada email (para revisarlo en Actividad → Emails). */
export const EMAIL_CONTENT_DAYS = 30;

/**
 * El contenido de un email (texto y HTML, unos 6 KB) es lo que más ocupa en la base. Pasados
 * EMAIL_CONTENT_DAYS días se borra y queda sólo el registro: a quién, qué tipo, el asunto, cuándo
 * y si se envió. Los que siguen en cola no se tocan.
 */
async function purgeOldEmailContent(): Promise<number> {
  const result = await pool.query(
    `update notifications set body = '', html = null, calendar = null
      where status <> 'queued' and created_at < now() - make_interval(days => $1)
        and (body <> '' or html is not null or calendar is not null)`,
    [EMAIL_CONTENT_DAYS],
  );
  return result.rowCount ?? 0;
}

/**
 * Tareas periódicas: recordatorios, reintentos de la cola de emails y limpieza. En producción
 * las ejecuta el cron de GitHub (scripts/cron.ts) directamente contra la base y Gmail, sin
 * pasar por Vercel; en local, el propio servidor.
 */
export async function runScheduledTasks(): Promise<ScheduledTasksReport> {
  const started = Date.now();
  const previous = await one<{ ranAt: string }>(pool, 'select ran_at as "ranAt" from cron_runs order by ran_at desc limit 1');
  const reminders = await queueAllReminders();
  // Antes del envío: así las invitaciones de la ventana salen en esta misma pasada.
  const calendarInvites = await queueCalendarInvites();
  const emails = await processEmailQueue({ maxBatches: MAX_EMAIL_BATCHES, deadline: started + EMAIL_BUDGET_MS });
  await deleteExpiredSessions();
  await deleteStalePendingAttachments();
  await deleteStalePendingReceipts();
  const security = await findLoginAttacks(previous?.ranAt ?? null);
  const purged = await one<{ deleted: number }>(pool, "select purge_audit_logs() as deleted");
  const emailContentPurged = await purgeOldEmailContent();
  const receiptsPurged = await purgeOldReceipts();
  const unusedImagesDeleted = await deleteUnusedImageUploads();
  const rateLimitsPurged = await deleteExpiredRateLimits();
  // Corte en "ahora": lo enviado hasta aquí cuenta en esta ejecución y no en la siguiente.
  const totals = await one<{ at: string; pending: number; sent: number }>(
    pool,
    `select now() as at,
            count(*) filter (where status = 'queued')::int as pending,
            count(*) filter (where status = 'sent' and sent_at <= now())::int as sent
       from notifications
      where status = 'queued' or sent_at > coalesce($1::timestamptz, now() - interval '1 day')`,
    [previous?.ranAt ?? null],
  );
  const sent = await many<SentEmail>(
    pool,
    // El nombre del paciente al que le salió el email (en una cita con varios pacientes, el suyo); si no
    // fue a un paciente (la copia, los avisos al negocio), el del principal.
    `select n.type, n.to_email as "to", b.name as "businessName", a.id as "appointmentId",
            coalesce((select r.name from clients r
                       where lower(r.email) = lower(n.to_email)
                         and (r.id = a.client_id
                              or exists (select 1 from appointment_clients ac where ac.appointment_id = a.id and ac.client_id = r.id))
                       order by r.id = a.client_id desc limit 1), c.name) as "clientName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime"
       from notifications n
       left join businesses b on b.id = n.business_id
       left join appointments a on a.id = n.appointment_id
       left join clients c on c.id = a.client_id
      where n.status = 'sent' and n.sent_at > coalesce($1::timestamptz, now() - interval '1 day') and n.sent_at <= $2
      order by n.sent_at, n.created_at
      limit $3`,
    [previous?.ranAt ?? null, totals?.at ?? new Date().toISOString(), MAX_SENT_DETAILS],
  );
  // Después de enviar la cola: el aviso dice si los emails de cada reserva ya salieron.
  const online = await findOnlineBookings(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const panel = await findPanelClients(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const panelAppointments = await findPanelAppointments(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const panelSeries = await findPanelSeries(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const seriesCancellations = await findSeriesCancellations(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const statusChanges = await findStatusChanges(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const accountChanges = await findAccountChanges(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  const clientImports = await findClientImports(pool, previous?.ranAt ?? null, totals?.at ?? new Date().toISOString());
  // Avisos en el celular (spec 013), después de los de ntfy: citas por cerrar, el resumen de las 8 y los
  // del super admin; después, el envío de la cola y su limpieza.
  const push = await runPushJobs({
    since: previous?.ranAt ?? null,
    until: totals?.at ?? new Date().toISOString(),
    accountChanges: accountChanges.changes,
    loginAttacks: security,
  });
  // Las campanas del panel (spec 014) guardan 30 días: si falla el borrado, el cron sigue.
  const panelPurged = await cleanupPanelNotices().catch((error: unknown) => {
    console.error(`[avisos] No se pudieron borrar los avisos del panel de más de 30 días (${(error as { code?: string })?.code ?? "error"}).`);
    return null;
  });
  // La foto de la analítica (spec 016), una vez al día: si falla, el cron sigue y lo intenta en la próxima pasada.
  const analytics = await refreshAnalytics().catch((error: unknown): AnalyticsRefresh => {
    console.error(`[analítica] No se pudo preparar la foto de hoy (${(error as { code?: string })?.code ?? "error"}).`);
    return { status: "failed", businesses: null, purged: 0 };
  });
  // La foto del tamaño de la base (spec 024), una vez al día: si falla, el cron sigue y lo intenta en la próxima pasada.
  const databaseStats = await saveDailyDatabaseStats().catch((error: unknown): DatabaseStatsRefresh => {
    console.error(`[base de datos] No se pudo guardar la foto de hoy (${(error as { code?: string })?.code ?? "error"}).`);
    return { status: "failed", sizeBytes: null, purged: 0 };
  });
  const report: ScheduledTasksReport = {
    reminders: reminders.queued,
    reminderFailures: reminders.failures + calendarInvites.failures,
    calendarInvites: calendarInvites.queued,
    emails,
    sentSinceLastRun: totals?.sent ?? 0,
    sentEmails: sent.map((email) => ({
      ...email,
      to: maskEmail(email.to),
      clientName: email.clientName ? shortName(email.clientName) : null,
    })),
    onlineBookings: online.total,
    bookingNotices: online.bookings.map(onlineBookingNotice),
    panelClients: panel.total,
    clientNotices: panel.clients.map(newClientNotice),
    panelAppointments: panelAppointments.total,
    appointmentNotices: panelAppointments.appointments.map(panelAppointmentNotice),
    panelSeries: panelSeries.total,
    seriesNotices: panelSeries.series.map(panelSeriesNotice),
    seriesCancellations: seriesCancellations.total,
    seriesCancelNotices: seriesCancellations.cancellations.map(seriesCancelledNotice),
    statusChanges: statusChanges.total,
    statusNotices: statusChanges.changes.map(statusChangeNotice),
    clientImports: clientImports.total,
    importNotices: clientImports.imports.map(clientImportNotice),
    accountChanges: accountChanges.total,
    accountNotices: accountChanges.changes.map(accountChangeNotice),
    since: previous?.ranAt ?? null,
    pending: totals?.pending ?? 0,
    security,
    push,
    panelNotices: { created: push.panel ?? 0, purged: panelPurged },
    analytics,
    databaseStats,
    auditPurged: purged?.deleted ?? 0,
    emailContentPurged,
    receiptsPurged,
    unusedImagesDeleted,
    rateLimitsPurged,
    durationMs: Date.now() - started,
  };
  await pool.query("insert into cron_runs (ran_at, report) values (coalesce($1::timestamptz, now()), $2)", [
    totals?.at ?? null,
    report,
  ]);
  // El registro del cron se borra cada lunes al mediodía (hora de Ecuador): la primera pasada desde
  // las 12:00 borra todas las de antes (decisión del dueño del producto, 2026-10-19). Sólo se lee la
  // última. Restar 12 horas antes de truncar a la semana da el último lunes a las 12:00.
  await pool.query(
    `delete from cron_runs
      where ran_at < ((date_trunc('week', (coalesce($1::timestamptz, now()) at time zone $2) - interval '12 hours')
                       + interval '12 hours') at time zone $2)`,
    [totals?.at ?? null, DEFAULT_TIMEZONE],
  );
  return report;
}
