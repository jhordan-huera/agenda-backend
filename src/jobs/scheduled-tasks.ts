import { many, one, pool, transaction } from "../db/pool.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import { deleteStalePendingAttachments } from "../services/clinical-attachment-service.ts";
import { processEmailQueue, type EmailQueueReport } from "../services/mailer.ts";
import { runReminderJob } from "../services/notifications.ts";
import type { EmailType } from "../shared/types/index.ts";

/** Pone en cola los recordatorios de citas de todos los negocios activos. Devuelve cuántos. */
export async function queueAllReminders(): Promise<number> {
  const businesses = await many<{ id: string }>(
    pool,
    `select id from businesses
      where status = 'active' and (notification_settings ->> 'reminders')::boolean`,
  );
  let queued = 0;
  for (const { id } of businesses) queued += await transaction((db) => runReminderJob(db, id));
  return queued;
}

/** Resumen de una ejecución del cron (scripts/cron.ts). */
export interface ScheduledTasksReport {
  /** Recordatorios puestos en cola en esta ejecución. */
  reminders: number;
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
  /** Registros de auditoría borrados por antigüedad (purge_audit_logs). */
  auditPurged: number;
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
  /** Cliente de la cita (emails de citas). */
  clientName: string | null;
  date: string | null;
  startTime: string | null;
}

/** Emails detallados en el aviso; del resto sólo se dice cuántos son. */
const MAX_SENT_DETAILS = 40;

/** "María López Vera" → "María L." */
export function shortName(name: string): string {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
}

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
 * Tareas periódicas: recordatorios, reintentos de la cola de emails y limpieza. En producción
 * las ejecuta el cron de GitHub (scripts/cron.ts) directamente contra la base y Gmail, sin
 * pasar por Vercel; en local, el propio servidor.
 */
export async function runScheduledTasks(): Promise<ScheduledTasksReport> {
  const started = Date.now();
  const previous = await one<{ ranAt: string }>(pool, 'select ran_at as "ranAt" from cron_runs order by ran_at desc limit 1');
  const reminders = await queueAllReminders();
  const emails = await processEmailQueue({ maxBatches: MAX_EMAIL_BATCHES });
  await deleteExpiredSessions();
  await deleteStalePendingAttachments();
  const security = await findLoginAttacks(previous?.ranAt ?? null);
  const purged = await one<{ deleted: number }>(pool, "select purge_audit_logs() as deleted");
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
    `select n.type, n.to_email as "to", b.name as "businessName", c.name as "clientName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime"
       from notifications n
       left join businesses b on b.id = n.business_id
       left join appointments a on a.id = n.appointment_id
       left join clients c on c.id = a.client_id
      where n.status = 'sent' and n.sent_at > coalesce($1::timestamptz, now() - interval '1 day') and n.sent_at <= $2
      order by n.sent_at
      limit $3`,
    [previous?.ranAt ?? null, totals?.at ?? new Date().toISOString(), MAX_SENT_DETAILS],
  );
  const report: ScheduledTasksReport = {
    reminders,
    emails,
    sentSinceLastRun: totals?.sent ?? 0,
    sentEmails: sent.map((email) => ({
      ...email,
      to: maskEmail(email.to),
      clientName: email.clientName ? shortName(email.clientName) : null,
    })),
    since: previous?.ranAt ?? null,
    pending: totals?.pending ?? 0,
    security,
    auditPurged: purged?.deleted ?? 0,
    durationMs: Date.now() - started,
  };
  await pool.query("insert into cron_runs (ran_at, report) values (coalesce($1::timestamptz, now()), $2)", [
    totals?.at ?? null,
    report,
  ]);
  await pool.query("delete from cron_runs where ran_at < now() - interval '30 days'");
  return report;
}
