import { config } from "../config.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import { queueAllReminders, queueCalendarInvites } from "./scheduled-tasks.ts";

/**
 * Repite `work` cada `minutes` (0 = nunca), la primera vez a los 10 s; si una vuelta tarda más, la
 * siguiente espera. Devuelve una función para detenerlo.
 */
function every(minutes: number, label: string, work: () => Promise<void>): () => void {
  if (minutes === 0) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      console.error(`[${label}] Error:`, error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 10_000);
  const interval = setInterval(tick, minutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

/**
 * Trabajo programado del servidor local (en producción lo sustituye el cron de GitHub, ver
 * scripts/cron.ts):
 * - cada REMINDER_JOB_INTERVAL_MINUTES, los recordatorios de citas de todos los negocios activos (aunque
 *   nadie tenga el panel abierto) y la limpieza de las sesiones caducadas;
 * - cada CALENDAR_INVITE_JOB_INTERVAL_MINUTES, el paso de las invitaciones de calendario del cron (spec 027,
 *   2026-10-22): las citas que entran en la ventana de 14 días y los cambios que vienen de otro lado (el
 *   nombre del servicio, la dirección…). Así se prueban con `npm run dev:local`, que apaga los
 *   recordatorios si no se piden.
 * Sólo con la base de este equipo: server.ts no lo arranca en la nube ni contra la base de producción
 * (backgroundJobs), y aquí se comprueba otra vez. Devuelve una función para detenerlo al apagar el servidor.
 */
export function startReminderJob(): () => void {
  if (config.hosted || config.productionDbFromHere) return () => undefined;
  const stopReminders = every(config.reminderJobIntervalMinutes, "recordatorios", async () => {
    const { queued } = await queueAllReminders();
    if (queued > 0) console.info(`[recordatorios] ${queued} email(s) en cola`);
    await deleteExpiredSessions();
  });
  const stopCalendar = every(config.calendarInviteJobIntervalMinutes, "calendario", async () => {
    const { queued, failures } = await queueCalendarInvites();
    if (queued > 0) console.info(`[calendario] ${queued} invitación(es) de calendario en cola`);
    if (failures > 0) console.error(`[calendario] Fallaron ${failures} negocio(s) al preparar las invitaciones`);
  });
  return () => {
    stopReminders();
    stopCalendar();
  };
}
