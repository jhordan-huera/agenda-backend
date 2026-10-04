// Copia de agenda-front/src/lib/time.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { DayOfWeek, ISODate, TimeString } from "../types/index.ts";

/**
 * Utilidades de fecha/hora "de pared" (wall clock) en la zona horaria del negocio.
 * Trabajan con strings "YYYY-MM-DD" y "HH:mm" para no depender de la zona
 * horaria del navegador.
 */

export function timeToMinutes(time: TimeString): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): TimeString {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function addMinutesToTime(time: TimeString, minutes: number): TimeString {
  return minutesToTime(timeToMinutes(time) + minutes);
}

export function durationInMinutes(start: TimeString, end: TimeString): number {
  return timeToMinutes(end) - timeToMinutes(start);
}

/** Intervalos semiabiertos [start, end): 09:00–10:00 y 10:00–11:00 no se solapan. */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseParts(iso: ISODate): [number, number, number] {
  const [year, month, day] = iso.split("-").map(Number);
  return [year, month, day];
}

/** Fecha local a medianoche (útil para formatear con date-fns). */
export function parseISODate(iso: ISODate): Date {
  const [year, month, day] = parseParts(iso);
  return new Date(year, month - 1, day);
}

export function toISODate(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  const [year, month, day] = parseParts(iso);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function getDayOfWeek(iso: ISODate): DayOfWeek {
  const [year, month, day] = parseParts(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as DayOfWeek;
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = parseParts(from);
  const [y2, m2, d2] = parseParts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function eachDayISO(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let current = start; current <= end; current = addDaysISO(current, 1)) {
    days.push(current);
  }
  return days;
}

/** Lunes de la semana que contiene la fecha. */
export function startOfWeekISO(iso: ISODate): ISODate {
  const dayOfWeek = getDayOfWeek(iso);
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysISO(iso, offset);
}

export function startOfMonthISO(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonthsISO(iso: ISODate, months: number): ISODate {
  const [year, month] = parseParts(iso);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

export function endOfMonthISO(iso: ISODate): ISODate {
  return addDaysISO(addMonthsISO(startOfMonthISO(iso), 1), -1);
}

export interface ZonedNow {
  date: ISODate;
  /** Minutos transcurridos desde la medianoche. */
  minutes: number;
}

/** Fecha y hora actuales en la zona horaria indicada (p. ej. America/Guayaquil). */
export function getZonedNow(timezone: string, at: Date = new Date()): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** true si la fecha/hora indicada ya pasó respecto a `now`. */
export function isPast(date: ISODate, time: TimeString, now: ZonedNow): boolean {
  if (date !== now.date) return date < now.date;
  return timeToMinutes(time) <= now.minutes;
}
