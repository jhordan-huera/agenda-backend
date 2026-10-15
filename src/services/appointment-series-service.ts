import { appointmentColumns, blockedTimeColumns } from "../db/columns.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import {
  applyPlanLimit,
  classifySeriesDate,
  freeTimesOn,
  SERIES_PLAN_REMAINING_CAP,
  SERIES_RETIMABLE,
  seriesDates,
  seriesFrequencyText,
  seriesRowCreates,
  type SeriesContext,
  type SeriesPlanRow,
} from "../shared/lib/appointment-series.ts";
import { getSlotStep } from "../shared/lib/availability.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { formatNumericDate, joinNames, plural } from "../shared/lib/format.ts";
import { addMinutesToTime, addMonthsISO, getZonedNow, timeToMinutes } from "../shared/lib/time.ts";
import {
  appointmentSeriesPreviewSchema,
  appointmentSeriesSchema,
  cancelFollowingSchema,
  type AppointmentSeriesPreviewInput,
} from "../shared/lib/validations/appointment.ts";
import type {
  Appointment,
  AppointmentSeriesCreated,
  AppointmentSeriesPreview,
  BlockedTime,
  Business,
  BusySlot,
  ISODate,
  SeriesDatePreview,
  SeriesDateStatus,
  SeriesPlanRemaining,
  TimeString,
} from "../shared/types/index.ts";
import { appointmentClientIds, clientNamesOf, resolveExtraClients, saveExtraClients } from "./appointment-clients.ts";
import { agendaScope, assertAppointmentInScope, assertClientInScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { WITHOUT_NOTICE } from "./booking-alerts.ts";
import {
  assertOffersService,
  buildAppointmentFields,
  findOwned,
  homeVisitJson,
  listSchedules,
  resolveAppointmentProfessional,
  saveAppointment,
} from "./business-data-service.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";
import { notifySeriesCancelled, notifySeriesCreated } from "./notifications.ts";
import { planOf } from "./plan-limits.ts";

/**
 * Citas que se repiten (spec 011): desde «Nueva cita» del panel se agenda de una vez una serie («cada
 * semana, 8 sesiones»). Antes de crearla se ve la lista de fechas, con las que chocan marcadas
 * (`preview`); al crearla se vuelve a comprobar cada fecha con el negocio bloqueado (`create`). Cada cita
 * sigue siendo una cita normal: se cambia sola. La única acción de grupo es «Cancelar ésta y las
 * siguientes» (`cancelFollowing`). La reserva online no crea series.
 */

/** Lo que se comprueba una vez para toda la serie, igual que al crear una cita suelta (appointmentService.create). */
async function prepareSeries(db: Db, actor: Actor, businessId: string, data: AppointmentSeriesPreviewInput) {
  const scope = await agendaScope(db, actor, businessId);
  const { requestedProfessionalId, requestedExtraClientIds, ...fields } = await buildAppointmentFields(db, businessId, data.appointment);
  await assertClientInScope(db, scope, fields.clientId);
  const extraClientIds = await resolveExtraClients(db, {
    businessId,
    scope,
    clientId: fields.clientId,
    requested: requestedExtraClientIds,
    current: [],
  });
  const professionalId = await resolveAppointmentProfessional(db, businessId, actor, scope, requestedProfessionalId);
  await assertOffersService(db, businessId, professionalId, fields.serviceId);
  const business = (await one<Pick<Business, "timezone" | "bookingSettings">>(
    db,
    `select timezone, booking_settings as "bookingSettings" from businesses where id = $1`,
    [businessId],
  ))!;
  // Una serie es de citas por venir (R2): una cita pasada se sigue registrando suelta.
  if (fields.date < getZonedNow(business.timezone || DEFAULT_TIMEZONE).date) {
    throw new AppError("validation", "La primera fecha de la serie no puede ser anterior a hoy.");
  }
  return {
    fields,
    extraClientIds,
    professionalId,
    business,
    durationMinutes: data.appointment.durationMinutes,
    dates: seriesDates(fields.date, data.repeat.frequency, data.repeat.count),
  };
}

/**
 * La agenda del profesional entre dos fechas: su horario, las franjas de sus citas activas (sin datos
 * del paciente) y los bloqueos suyos o de todo el negocio. Tres consultas para toda la serie.
 */
async function loadSeriesContext(db: Db, businessId: string, professionalId: string, from: ISODate, to: ISODate): Promise<SeriesContext> {
  const schedules = await listSchedules(db, businessId, professionalId);
  const blockedTimes = await many<BlockedTime>(
    db,
    `select ${blockedTimeColumns()} from blocked_times
      where business_id = $1 and (professional_id is null or professional_id = $2) and start_date <= $4 and end_date >= $3`,
    [businessId, professionalId, from, to],
  );
  const busySlots = await many<BusySlot>(
    db,
    `select date, start_time as "startTime", end_time as "endTime", professional_id as "professionalId" from appointments
      where business_id = $1 and professional_id = $2 and status in ('pending', 'confirmed', 'completed') and date between $3 and $4
      order by date, start_time`,
    [businessId, professionalId, from, to],
  );
  return { schedules, busySlots, blockedTimes };
}

/**
 * Las citas que quedan en el cupo del plan en cada mes de esas fechas (R4): el tope del plan menos las
 * citas no canceladas del mes, como assertAppointmentLimit. null si el plan no tiene tope.
 */
async function planRemainingFor(
  db: Db,
  businessId: string,
  dates: ISODate[],
): Promise<{ remaining: SeriesPlanRemaining | null; monthlyLimit: number | null }> {
  const { limits } = await planOf(db, businessId);
  const monthlyLimit = limits.appointmentsPerMonth;
  if (monthlyLimit === null || dates.length === 0) return { remaining: null, monthlyLimit: null };
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  const rows = await many<{ month: string; count: number }>(
    db,
    `select to_char(date, 'YYYY-MM') as month, count(*)::int as count from appointments
      where business_id = $1 and status <> 'cancelled' and date >= $2::date and date < $3::date
      group by 1`,
    [businessId, `${months[0]}-01`, addMonthsISO(`${months.at(-1)}-01`, 1)],
  );
  const used = new Map(rows.map((row) => [row.month, row.count]));
  return {
    remaining: Object.fromEntries(months.map((month) => [month, Math.max(0, monthlyLimit - (used.get(month) ?? 0))])),
    monthlyLimit,
  };
}

/** Por qué no se creó una fecha que llegó para crearse (RF-005): cambió algo mientras se revisaba la lista. */
const SKIPPED_REASONS: Record<Exclude<SeriesDateStatus, "free">, string> = {
  busy: "Se ocupó mientras revisabas la lista",
  blocked: "Se bloqueó mientras revisabas la lista",
  day_off: "Cambió el horario mientras revisabas la lista",
  outside_hours: "Cambió el horario mientras revisabas la lista",
  plan_limit: "Se llenó el cupo del plan mientras revisabas la lista",
};

/** "20/10/2026 10:00, 27/10/2026 11:00…": las fechas en la actividad. */
const listDates = (appointments: Pick<Appointment, "date" | "startTime">[]) =>
  appointments.map((appointment) => `${formatNumericDate(appointment.date)} ${appointment.startTime}`).join(", ");

export const appointmentSeriesService = {
  /**
   * La lista de fechas, antes de crear (R1–R4). No cambia nada ni bloquea el negocio. Cada fecha con su
   * marca y su motivo; las de otra cita, un bloqueo o fuera del horario, con las horas libres de ese
   * día. El cupo de cada mes llega topado en 24.
   */
  async preview(ctx: RequestContext, businessId: string, input: unknown): Promise<AppointmentSeriesPreview> {
    const actor = await authorize(pool, ctx, businessId, "appointments.manage");
    const data = parseInput(appointmentSeriesPreviewSchema, input);
    const { fields, professionalId, business, durationMinutes, dates } = await prepareSeries(pool, actor, businessId, data);
    const context = await loadSeriesContext(pool, businessId, professionalId, dates[0], dates.at(-1)!);
    const step = getSlotStep(durationMinutes, business.bookingSettings);
    const rows = dates.map((date): SeriesDatePreview => {
      const window = { date, startTime: fields.startTime, endTime: fields.endTime };
      const { status, reason } = classifySeriesDate(window, context);
      return { ...window, status, reason, freeTimes: SERIES_RETIMABLE.has(status) ? freeTimesOn(date, durationMinutes, context, step) : [] };
    });
    const { remaining, monthlyLimit } = await planRemainingFor(pool, businessId, dates);
    return {
      dates: applyPlanLimit(rows, remaining, monthlyLimit),
      planRemaining: remaining
        ? Object.fromEntries(Object.entries(remaining).map(([month, left]) => [month, Math.min(left, SERIES_PLAN_REMAINING_CAP)]))
        : null,
      monthlyLimit,
    };
  },

  /**
   * Crea la serie con las fechas que quedaron en la lista (R5), en una transacción con el negocio
   * bloqueado: las citas del panel, las reservas online y las otras series esperan su turno. Cada fecha se
   * vuelve a comprobar: la que ya no se puede crear a esa hora (alguien la agendó, se bloqueó o se llenó
   * el cupo mientras se revisaba la lista) vuelve en `skipped`. Nunca queda una cita solapada
   * (`appointments_no_overlap` sigue de red de seguridad: si saltara, se deshace la serie entera). Si no
   * se puede crear ninguna, no se crea nada. Un email por paciente, un aviso al profesional y una
   * entrada de actividad.
   */
  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<AppointmentSeriesCreated> {
    const data = parseInput(appointmentSeriesSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const { fields, extraClientIds, professionalId, durationMinutes, dates } = await prepareSeries(db, actor, businessId, data);
      // Sólo las fechas de la serie (la primera, la frecuencia y el número): se cambia la hora o se quitan.
      const position = new Map(dates.map((date, index) => [date, index]));
      if (data.dates.some((item) => !position.has(item.date))) {
        throw new AppError("validation", "Una de las fechas no es de la serie: sólo se puede cambiar la hora o quitar fechas.");
      }
      const requested = [...data.dates].sort((a, b) => position.get(a.date)! - position.get(b.date)!);
      for (const item of requested) {
        if (timeToMinutes(item.startTime) + durationMinutes > 24 * 60) {
          throw new AppError("validation", `La cita del ${formatNumericDate(item.date)} no puede terminar después de medianoche.`);
        }
      }

      const context = await loadSeriesContext(db, businessId, professionalId, requested[0].date, requested.at(-1)!.date);
      const { remaining, monthlyLimit } = await planRemainingFor(
        db,
        businessId,
        requested.map((item) => item.date),
      );
      const rows = applyPlanLimit(
        requested.map((item): SeriesPlanRow & { startTime: TimeString; endTime: TimeString } => {
          const window = { date: item.date, startTime: item.startTime, endTime: addMinutesToTime(item.startTime, durationMinutes) };
          return { ...window, ...classifySeriesDate(window, context), allowAnyway: item.allowOutsideHours };
        }),
        remaining,
        monthlyLimit,
      );
      const toCreate = rows.filter(seriesRowCreates);
      const skipped = rows
        .filter((row) => !seriesRowCreates(row))
        .map((row) => ({
          date: row.date,
          startTime: row.startTime,
          reason: SKIPPED_REASONS[row.status as Exclude<SeriesDateStatus, "free">],
        }));
      if (toCreate.length === 0) {
        if (rows.every((row) => row.status === "plan_limit")) throw new AppError("plan_limit", "Has alcanzado el límite de citas de tu plan.");
        throw new AppError("conflict", "No se creó ninguna cita: todas las fechas chocan. Revisa la lista.");
      }

      const series = (await one<{ id: string }>(
        db,
        `insert into appointment_series (business_id, frequency, requested_count, created_count, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [businessId, data.repeat.frequency, data.repeat.count, toCreate.length, actor.userId],
      ))!;
      const created: Appointment[] = [];
      for (const [index, row] of toCreate.entries()) {
        const inserted = (await one<Appointment>(
          db,
          `insert into appointments
             (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, notes, price,
              home_visit, is_virtual, source, series_id, series_index)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'dashboard', $13, $14)
           returning ${appointmentColumns()}`,
          [
            businessId,
            fields.clientId,
            fields.serviceId,
            professionalId,
            row.date,
            row.startTime,
            row.endTime,
            fields.status,
            fields.notes,
            fields.price,
            homeVisitJson(fields.homeVisit),
            fields.isVirtual,
            series.id,
            index + 1,
          ],
        ))!;
        created.push(await saveExtraClients(db, inserted, extraClientIds, []));
      }

      await notifySeriesCreated(db, created, actor.userId);
      const names = joinNames(await clientNamesOf(db, appointmentClientIds(created[0])));
      const missing = data.repeat.count - created.length;
      await logAudit(db, {
        businessId,
        actor,
        action: "appointment.series_created",
        entityType: "appointment",
        entityId: series.id,
        summary:
          `Agendó una serie de ${plural(created.length, "cita", "citas")} de ${names}, ${seriesFrequencyText(data.repeat.frequency)} ` +
          `desde el ${formatNumericDate(created[0].date)} ${created[0].startTime}` +
          (missing > 0 ? ` (${missing} ${missing === 1 ? "no se creó" : "no se crearon"})` : ""),
        changes: [{ label: "Fechas", before: null, after: listDates(created) }],
      });
      return { series: { id: series.id, total: created.length, frequency: data.repeat.frequency }, created, skipped };
    });
  },

  /**
   * «Cancelar ésta y las siguientes» (R10): las citas de la serie desde ésta (por su número, no por la
   * fecha: así no importa que alguna se haya movido de día) que siguen Pendientes o Confirmadas. Las
   * atendidas, las de «No asistió» y las ya canceladas no se tocan; el rol Profesional, sólo las de su
   * agenda. `notify: false` (la casilla «Avisar al paciente» desmarcada, spec 008): ningún email.
   */
  async cancelFollowing(ctx: RequestContext, businessId: string, appointmentId: string, input: unknown): Promise<{ cancelled: Appointment[] }> {
    const { notify } = parseInput(cancelFollowingSchema, input ?? {});
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const from = await findOwned<Appointment>(db, "appointments", appointmentColumns(), businessId, appointmentId, "Cita no encontrada.");
      const scope = await agendaScope(db, actor, businessId);
      assertAppointmentInScope(scope, from);
      if (!from.series) throw new AppError("conflict", "Esta cita no es de una serie.");
      const targets = await many<Appointment>(
        db,
        `select ${appointmentColumns()} from appointments
          where business_id = $1 and series_id = $2 and series_index >= $3 and status in ('pending', 'confirmed')
            and ($4::uuid is null or professional_id = $4::uuid)
          order by series_index`,
        [businessId, from.series.id, from.series.index, scope.professionalId],
      );
      if (targets.length === 0) throw new AppError("conflict", "No quedan citas activas de la serie desde ésta.");

      const cancelled: Appointment[] = [];
      for (const before of targets) cancelled.push(await saveAppointment(db, { ...before, status: "cancelled" }, false));
      if (notify) await notifySeriesCancelled(db, cancelled);
      const names = joinNames(await clientNamesOf(db, appointmentClientIds(from)));
      await logAudit(db, {
        businessId,
        actor,
        action: "appointment.series_cancelled",
        entityType: "appointment",
        entityId: from.series.id,
        summary:
          `Canceló ${plural(cancelled.length, "cita", "citas")} de la serie de ${names} ` +
          `desde el ${formatNumericDate(cancelled[0].date)} ${cancelled[0].startTime}${notify ? "" : WITHOUT_NOTICE}`,
        changes: [{ label: "Citas canceladas", before: null, after: listDates(cancelled) }],
      });
      return { cancelled };
    });
  },
};
