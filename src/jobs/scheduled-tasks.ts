import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { deleteExpiredRateLimits } from "../http/rate-limit-store.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import { deleteStalePendingAttachments } from "../services/clinical-attachment-service.ts";
import { deleteUnusedImageUploads } from "../services/image-service.ts";
import { deleteStalePendingReceipts, purgeOldReceipts } from "../services/payment-service.ts";
import { processEmailQueue, scrubEmails, type EmailQueueReport } from "../services/mailer.ts";
import { runDailyAgendaJob, runReminderJob } from "../services/notifications.ts";
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

/** Resumen de una ejecución del cron (scripts/cron.ts). */
export interface ScheduledTasksReport {
  /** Recordatorios puestos en cola en esta ejecución. */
  reminders: number;
  /** Negocios en los que falló preparar los recordatorios o la agenda del día (detalle en el registro). */
  reminderFailures: number;
  /** Lo que hizo esta ejecución con la cola de emails. */
  emails: EmailQueueReport;
  /** Emails enviados desde la ejecución anterior: también los que salieron al momento (reservas, avisos). */
  sentSinceLastRun: number;
  /** Detalle de esos emails (hasta MAX_SENT_DETAILS) para el aviso de ntfy. */
  sentEmails: SentEmail[];
  /** Fecha de la ejecución anterior (null si es la primera). */
  since: string | null;
  /** Emails que siguen en cola al terminar (reintentos o lote máximo alcanzado). */
  pending: number;
  /** Cuentas con muchos intentos fallidos de inicio de sesión (ver findLoginAttacks). */
  security: LoginAlert[];
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
 * Un email enviado, tal como sale en el aviso de ntfy: el destinatario con el email enmascarado y
 * el nombre abreviado ("María L."), sin más datos personales.
 */
export interface SentEmail {
  type: EmailType;
  to: string;
  businessName: string | null;
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

/** "an***@gmail.com" */
export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  const visible = `${local.slice(0, 2)}***`;
  return domain ? `${visible}@${domain}` : visible;
}

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
export const EMAIL_CONTENT_DAYS = 90;

/**
 * El contenido de un email (texto y HTML, unos 6 KB) es lo que más ocupa en la base. Pasados
 * EMAIL_CONTENT_DAYS días se borra y queda sólo el registro: a quién, qué tipo, el asunto, cuándo
 * y si se envió. Los que siguen en cola no se tocan.
 */
async function purgeOldEmailContent(): Promise<number> {
  const result = await pool.query(
    `update notifications set body = '', html = null
      where status <> 'queued' and created_at < now() - make_interval(days => $1)
        and (body <> '' or html is not null)`,
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
    `select n.type, n.to_email as "to", b.name as "businessName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime"
       from notifications n
       left join businesses b on b.id = n.business_id
       left join appointments a on a.id = n.appointment_id
      where n.status = 'sent' and n.sent_at > coalesce($1::timestamptz, now() - interval '1 day') and n.sent_at <= $2
      order by n.sent_at
      limit $3`,
    [previous?.ranAt ?? null, totals?.at ?? new Date().toISOString(), MAX_SENT_DETAILS],
  );
  const report: ScheduledTasksReport = {
    reminders: reminders.queued,
    reminderFailures: reminders.failures,
    emails,
    sentSinceLastRun: totals?.sent ?? 0,
    sentEmails: sent.map((email) => ({
      ...email,
      to: maskEmail(email.to),
    })),
    since: previous?.ranAt ?? null,
    pending: totals?.pending ?? 0,
    security,
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
  await pool.query("delete from cron_runs where ran_at < now() - interval '30 days'");
  return report;
}
