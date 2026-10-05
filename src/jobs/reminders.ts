import { config } from "../config.ts";
import { deleteExpiredSessions } from "../services/auth-service.ts";
import { queueAllReminders } from "./scheduled-tasks.ts";

/**
 * Trabajo programado del servidor local (en producción lo sustituye el cron de GitHub, ver
 * scripts/cron.ts): envía los recordatorios de citas de todos los negocios activos
 * (aunque nadie tenga el panel abierto) y limpia las sesiones caducadas.
 * Devuelve una función para detenerlo al apagar el servidor.
 */
export function startReminderJob(): () => void {
  const minutes = config.reminderJobIntervalMinutes;
  if (minutes === 0) return () => undefined;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const queued = await queueAllReminders();
      if (queued > 0) console.info(`[recordatorios] ${queued} email(s) en cola`);
      await deleteExpiredSessions();
    } catch (error) {
      console.error("[recordatorios] Error:", error instanceof Error ? error.message : error);
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
