import { daysBetween, timeToMinutes, type ZonedNow } from "../shared/lib/time.ts";

/**
 * Cuándo sale un recordatorio de cita. Lo usan el trabajo que los pone en cola (runReminderJob, en
 * notifications.ts) y el envío (mailer.ts), que los vuelve a comprobar antes de mandarlos.
 */

/** Horas de silencio (en la zona del negocio): ningún recordatorio sale entre las 21:00 y las 7:00. */
export const QUIET_FROM_MINUTES = 21 * 60;
export const QUIET_UNTIL_MINUTES = 7 * 60;

export const isQuietTime = (now: ZonedNow) => now.minutes >= QUIET_FROM_MINUTES || now.minutes < QUIET_UNTIL_MINUTES;

/** Minutos que faltan para las 7:00 del negocio (0 fuera de las horas de silencio). */
export function minutesUntilQuietEnds(now: ZonedNow): number {
  if (!isQuietTime(now)) return 0;
  return now.minutes >= QUIET_FROM_MINUTES ? 1440 - now.minutes + QUIET_UNTIL_MINUTES : QUIET_UNTIL_MINUTES - now.minutes;
}

/** Minutos desde `now` hasta el inicio de la cita (0 o menos: ya empezó). */
export const minutesUntilStart = (date: string, startTime: string, now: ZonedNow) =>
  daysBetween(now.date, date) * 1440 + timeToMinutes(startTime) - now.minutes;

/**
 * Clave del recordatorio (columna dedupe_key, única): la cita, su fecha y hora y cuándo se fijaron
 * (scheduled_at cambia al crearla, reprogramarla o reactivarla). Un recordatorio por cada versión de
 * la cita; uno en cola con otra clave es de una fecha u hora que ya no vale. La migración 027 la
 * calcula igual para los recordatorios anteriores.
 */
export const reminderKeySql = (alias: string) =>
  `'reminder:' || ${alias}.id || ':' || to_char(${alias}.date, 'YYYY-MM-DD') || 'T' || to_char(${alias}.start_time, 'HH24:MI')
   || ':' || floor(extract(epoch from ${alias}.scheduled_at) * 1000)::bigint`;
