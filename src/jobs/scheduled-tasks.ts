import { many, one, pool, transaction } from "../db/pool.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import { deleteStalePendingAttachments } from "../services/clinical-attachment-service.ts";
import { processEmailQueue, type EmailQueueReport } from "../services/mailer.ts";
import { runReminderJob } from "../services/notifications.ts";

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
  /** Fecha de la ejecución anterior (null si es la primera). */
  since: string | null;
  /** Emails que siguen en cola al terminar (reintentos o lote máximo alcanzado). */
  pending: number;
  durationMs: number;
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
  const report: ScheduledTasksReport = {
    reminders,
    emails,
    sentSinceLastRun: totals?.sent ?? 0,
    since: previous?.ranAt ?? null,
    pending: totals?.pending ?? 0,
    durationMs: Date.now() - started,
  };
  await pool.query("insert into cron_runs (ran_at, report) values (coalesce($1::timestamptz, now()), $2)", [
    totals?.at ?? null,
    report,
  ]);
  await pool.query("delete from cron_runs where ran_at < now() - interval '30 days'");
  return report;
}
