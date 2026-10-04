// Copia de agenda-front/src/lib/availability.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { BLOCKING_STATUSES } from "./constants/appointment-status.ts";
import { PUBLIC_BOOKING_MIN_NOTICE_HOURS } from "./constants/business.ts";
import {
  addDaysISO,
  daysBetween,
  getDayOfWeek,
  minutesToTime,
  rangesOverlap,
  timeToMinutes,
  type ZonedNow,
} from "./time.ts";
import type {
  Appointment,
  BlockedTime,
  BookingSettings,
  BusySlot,
  ISODate,
  Schedule,
  TimeString,
} from "../types/index.ts";

/**
 * Cálculo de disponibilidad.
 *
 * Funciones puras: reciben los datos ya cargados (horario, citas, bloqueos)
 * y no saben de dónde vienen. Al migrar a PostgreSQL sólo cambia la consulta
 * que obtiene esos datos; esta lógica se mantiene (en el cliente o en una
 * Edge Function / RPC).
 */

interface MinuteRange {
  start: number;
  end: number;
}

const FULL_DAY: MinuteRange = { start: 0, end: 24 * 60 };

export type AvailabilitySettings = Pick<
  BookingSettings,
  "alignSlotsToDuration" | "slotIntervalMinutes" | "minNoticeHours" | "maxAdvanceDays"
>;

export interface AvailabilityContext {
  schedules: Schedule[];
  /** Franjas ocupadas por citas activas (ver `toBusySlots`). */
  busySlots: BusySlot[];
  blockedTimes: BlockedTime[];
  settings: AvailabilitySettings;
  now: ZonedNow;
}

export function getWorkingRanges(schedules: Schedule[], date: ISODate): MinuteRange[] {
  const day = schedules.find((schedule) => schedule.dayOfWeek === getDayOfWeek(date));
  if (!day?.isActive) return [];

  return day.intervals
    .map((interval) => ({
      start: timeToMinutes(interval.start),
      end: timeToMinutes(interval.end),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
}

export function getBlockedRanges(blockedTimes: BlockedTime[], date: ISODate): MinuteRange[] {
  return blockedTimes
    .filter((block) => block.startDate <= date && date <= block.endDate)
    .map((block) =>
      block.allDay || !block.startTime || !block.endTime
        ? FULL_DAY
        : { start: timeToMinutes(block.startTime), end: timeToMinutes(block.endTime) },
    );
}

function getBusyRanges(busySlots: BusySlot[], date: ISODate): MinuteRange[] {
  return busySlots
    .filter((slot) => slot.date === date)
    .map((slot) => ({ start: timeToMinutes(slot.startTime), end: timeToMinutes(slot.endTime) }));
}

/** Citas que ocupan la agenda, reducidas a su franja horaria (sin datos del cliente). */
export function toBusySlots(appointments: Appointment[]): BusySlot[] {
  return appointments
    .filter((appointment) => BLOCKING_STATUSES.has(appointment.status))
    .map(({ date, startTime, endTime }) => ({ date, startTime, endTime }));
}

export function isDateWithinBookingWindow(
  date: ISODate,
  settings: AvailabilitySettings,
  now: ZonedNow,
): boolean {
  const daysAhead = daysBetween(now.date, date);
  return daysAhead >= 0 && daysAhead <= settings.maxAdvanceDays;
}

/**
 * Anticipación mínima para reservar online. Estas funciones sólo calculan la
 * disponibilidad de la página pública: las citas creadas desde el panel no la usan,
 * así que el profesional puede agendar a cualquier hora.
 */
export function getMinNoticeHours(settings: Pick<AvailabilitySettings, "minNoticeHours">): number {
  return Math.max(PUBLIC_BOOKING_MIN_NOTICE_HOURS, settings.minNoticeHours);
}

/**
 * Paso entre horas ofrecidas: por defecto, la duración del servicio (un servicio de
 * 1 h se ofrece a las 08:00, 09:00, 10:00… y nunca a las 08:30).
 */
export function getSlotStep(durationMinutes: number, settings: AvailabilitySettings): number {
  return Math.max(5, settings.alignSlotsToDuration ? durationMinutes : settings.slotIntervalMinutes);
}

/**
 * Horas de inicio disponibles para un servicio en una fecha.
 *
 * Una hora es válida si:
 * 1. Está en la cuadrícula del intervalo del horario (ver `getSlotStep`).
 * 2. La cita completa cabe dentro de ese intervalo del horario de atención.
 * 3. No se solapa con citas activas ni con horarios bloqueados.
 * 4. Respeta la anticipación mínima (al menos 24 h) y máxima configuradas.
 */
export function getAvailableSlots(
  date: ISODate,
  durationMinutes: number,
  context: AvailabilityContext,
): TimeString[] {
  const { schedules, busySlots, blockedTimes, settings, now } = context;
  if (durationMinutes <= 0 || !isDateWithinBookingWindow(date, settings, now)) return [];

  const unavailable = [...getBlockedRanges(blockedTimes, date), ...getBusyRanges(busySlots, date)];
  const minutesFromNowToDayStart = daysBetween(now.date, date) * 24 * 60 - now.minutes;
  const minNoticeMinutes = getMinNoticeHours(settings) * 60;
  const step = getSlotStep(durationMinutes, settings);
  const slots: TimeString[] = [];

  for (const range of getWorkingRanges(schedules, date)) {
    for (let start = range.start; start + durationMinutes <= range.end; start += step) {
      const end = start + durationMinutes;
      if (minutesFromNowToDayStart + start < minNoticeMinutes) continue;
      if (unavailable.some((busy) => rangesOverlap(start, end, busy.start, busy.end))) continue;
      slots.push(minutesToTime(start));
    }
  }

  return slots;
}

/** La reserva pública se valida con la misma cuadrícula: una hora fuera de ella se rechaza. */
export function isSlotAvailable(
  date: ISODate,
  startTime: TimeString,
  durationMinutes: number,
  context: AvailabilityContext,
): boolean {
  return getAvailableSlots(date, durationMinutes, context).includes(startTime);
}

/** Fechas (desde `from`, `days` días) que tienen al menos una hora libre. */
export function getAvailableDates(
  from: ISODate,
  days: number,
  durationMinutes: number,
  context: AvailabilityContext,
): Set<ISODate> {
  const available = new Set<ISODate>();
  for (let offset = 0; offset < days; offset++) {
    const date = addDaysISO(from, offset);
    if (getAvailableSlots(date, durationMinutes, context).length > 0) available.add(date);
  }
  return available;
}

/* ---------- Validaciones para citas creadas desde el panel ---------- */

interface TimeWindow {
  id?: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
}

/** Cita activa que se solapa con la franja indicada (ignora la propia cita al editar). */
export function findConflictingAppointment(
  window: TimeWindow,
  appointments: Appointment[],
): Appointment | undefined {
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  return appointments.find(
    (appointment) =>
      appointment.id !== window.id &&
      appointment.date === window.date &&
      BLOCKING_STATUSES.has(appointment.status) &&
      rangesOverlap(start, end, timeToMinutes(appointment.startTime), timeToMinutes(appointment.endTime)),
  );
}

export function isWithinWorkingHours(schedules: Schedule[], window: TimeWindow): boolean {
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  return getWorkingRanges(schedules, window.date).some(
    (range) => start >= range.start && end <= range.end,
  );
}

export function findOverlappingBlock(
  blockedTimes: BlockedTime[],
  window: TimeWindow,
): BlockedTime | undefined {
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  return blockedTimes.find((block) => {
    const [range] = getBlockedRanges([block], window.date);
    return range !== undefined && rangesOverlap(start, end, range.start, range.end);
  });
}
