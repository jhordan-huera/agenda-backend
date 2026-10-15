// Copia de agenda-front/src/lib/appointment-series.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { findOverlappingBlock, getBlockedRanges, getWorkingRanges, isWithinWorkingHours, type BlockedRange } from "./availability.ts";
import { addDaysISO, addMonthsISO, endOfMonthISO, minutesToTime, rangesOverlap, timeToMinutes } from "./time.ts";
import type {
  AppointmentSeriesFrequency,
  BusySlot,
  ISODate,
  Schedule,
  SeriesDateStatus,
  SeriesPlanRemaining,
  TimeString,
} from "../types/index.ts";

/**
 * Citas que se repiten (spec 011): las fechas de una serie y la marca de cada una en la lista. Son
 * funciones puras, como availability.ts. Las usan la vista previa y la creación de la API (así lo que se
 * ve y lo que se crea nunca discrepan), el formulario del panel cuando se cambia la lista y la beta.
 */

/** De 2 a 24 citas, contando la primera (unos 6 meses cada semana). */
export const SERIES_MIN = 2;
export const SERIES_MAX = 24;
/** Lo que propone el formulario («cada semana, 8 sesiones»; decisión del dueño del producto, 2026-10-14). */
export const SERIES_DEFAULT_COUNT = 8;
/**
 * El cupo de cada mes llega a la lista topado: con eso basta, y el rol Profesional no se entera de
 * cuántas citas tiene el negocio ese mes (R4).
 */
export const SERIES_PLAN_REMAINING_CAP = SERIES_MAX;

export const SERIES_FREQUENCY_LABELS: Record<AppointmentSeriesFrequency, string> = {
  weekly: "Cada semana",
  biweekly: "Cada 2 semanas",
  monthly: "Cada mes",
};

/** "cada semana", para las frases («Cita 3 de 8 · cada semana»). */
export const seriesFrequencyText = (frequency: AppointmentSeriesFrequency) => SERIES_FREQUENCY_LABELS[frequency].toLowerCase();

/**
 * Las marcas que se pueden «Agendar igual» (decisión del dueño del producto, 2026-10-14): hoy una cita
 * suelta en un bloqueo o fuera del horario también se puede guardar. Otra cita a la misma hora y el cupo
 * del plan, no.
 */
export const SERIES_OVERRIDABLE: ReadonlySet<SeriesDateStatus> = new Set<SeriesDateStatus>(["blocked", "day_off", "outside_hours"]);

/** Las marcas que ofrecen «Otra hora» (con las horas libres de ese día). */
export const SERIES_RETIMABLE: ReadonlySet<SeriesDateStatus> = new Set<SeriesDateStatus>(["busy", "blocked", "outside_hours"]);

/**
 * Las fechas de la serie, la primera incluida: cada semana (+7 días), cada 2 semanas (+14) o cada mes. Cada
 * mes es el mismo día que la primera fecha, contado siempre desde ella y no desde la anterior; si ese mes
 * no tiene ese día, el último: 31 de enero → 28 (o 29) de febrero → 31 de marzo.
 */
export function seriesDates(firstDate: ISODate, frequency: AppointmentSeriesFrequency, count: number): ISODate[] {
  const day = Number(firstDate.slice(8, 10));
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    if (frequency === "weekly") return addDaysISO(firstDate, 7 * index);
    if (frequency === "biweekly") return addDaysISO(firstDate, 14 * index);
    const monthStart = addMonthsISO(firstDate, index);
    const lastDay = endOfMonthISO(monthStart);
    return Number(lastDay.slice(8, 10)) < day ? lastDay : `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;
  });
}

/**
 * La agenda del profesional de la serie, ya filtrada (como `scopeToProfessional`): su horario, las
 * franjas de sus citas activas (sin datos del paciente) y los bloqueos suyos o de todo el negocio.
 */
export interface SeriesContext {
  schedules: Schedule[];
  busySlots: BusySlot[];
  blockedTimes: (BlockedRange & { reason?: string })[];
}

interface SeriesWindow {
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
}

/**
 * La marca de una fecha (R3), la primera que aplique: otra cita del profesional, un bloqueo, un día que no
 * atiende o fuera de su horario. El motivo de otra cita sólo dice la franja: nunca de quién es.
 */
export function classifySeriesDate(
  window: SeriesWindow,
  context: SeriesContext,
): { status: Exclude<SeriesDateStatus, "plan_limit">; reason: string | null } {
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  const busy = context.busySlots
    .filter((slot) => slot.date === window.date && rangesOverlap(start, end, timeToMinutes(slot.startTime), timeToMinutes(slot.endTime)))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  if (busy) return { status: "busy", reason: `Ya hay una cita de ${busy.startTime} a ${busy.endTime}` };
  const block = findOverlappingBlock(context.blockedTimes, window);
  if (block) return { status: "blocked", reason: block.reason ? `Bloqueado: ${block.reason}` : "Bloqueado" };
  if (getWorkingRanges(context.schedules, window.date).length === 0) return { status: "day_off", reason: "Ese día no atiende" };
  if (!isWithinWorkingHours(context.schedules, window)) return { status: "outside_hours", reason: "Fuera del horario de atención" };
  return { status: "free", reason: null };
}

/**
 * Las horas libres de un día para «Otra hora»: las de la cuadrícula del negocio (`step`, ver
 * `getSlotStep`: la misma de la página de reservas) en que la cita entera cabe en el horario del
 * profesional, sin otra cita ni bloqueo. No se aplican la antelación mínima ni la máxima: son reglas de
 * la reserva online, no del panel.
 */
export function freeTimesOn(date: ISODate, durationMinutes: number, context: SeriesContext, step: number): TimeString[] {
  if (durationMinutes <= 0) return [];
  const taken = [
    ...getBlockedRanges(context.blockedTimes, date),
    ...context.busySlots
      .filter((slot) => slot.date === date)
      .map((slot) => ({ start: timeToMinutes(slot.startTime), end: timeToMinutes(slot.endTime) })),
  ];
  const times: TimeString[] = [];
  for (const range of getWorkingRanges(context.schedules, date)) {
    for (let start = range.start; start + durationMinutes <= range.end; start += Math.max(5, step)) {
      const end = start + durationMinutes;
      if (taken.some((busy) => rangesOverlap(start, end, busy.start, busy.end))) continue;
      times.push(minutesToTime(start));
    }
  }
  return [...new Set(times)].sort();
}

/** «Supera el cupo del plan (20 citas al mes)». */
export const planLimitReason = (monthlyLimit: number | null) =>
  monthlyLimit === null ? "Supera el cupo del plan" : `Supera el cupo del plan (${monthlyLimit} citas al mes)`;

/** Lo que el cupo necesita de cada fila: la fecha, su marca y si se agenda igual («Agendar igual»). */
export interface SeriesPlanRow {
  date: ISODate;
  status: SeriesDateStatus;
  reason: string | null;
  allowAnyway?: boolean;
}

/** La fila se va a crear: está libre o se agenda igual en un bloqueo, un día sin atención o fuera de horario. */
export const seriesRowCreates = (row: Pick<SeriesPlanRow, "status" | "allowAnyway">) =>
  row.status === "free" || (row.allowAnyway === true && SERIES_OVERRIDABLE.has(row.status));

/**
 * El cupo del plan (R4): recorre en orden las fechas que se van a crear y, en cada mes, marca «Supera el
 * cupo del plan» las que pasan lo que queda (`remainingByMonth`). Las que no se crean no gastan cupo:
 * al quitar una fecha, la marca pasa a la siguiente. Sin tope (null), no marca ninguna.
 */
export function applyPlanLimit<T extends SeriesPlanRow>(
  rows: T[],
  remainingByMonth: SeriesPlanRemaining | null,
  monthlyLimit: number | null,
): T[] {
  if (!remainingByMonth) return rows;
  const used = new Map<string, number>();
  return rows.map((row) => {
    if (!seriesRowCreates(row)) return row;
    const month = row.date.slice(0, 7);
    const taken = used.get(month) ?? 0;
    if (taken < (remainingByMonth[month] ?? 0)) {
      used.set(month, taken + 1);
      return row;
    }
    return { ...row, status: "plan_limit" satisfies SeriesDateStatus, reason: planLimitReason(monthlyLimit) } as T;
  });
}
