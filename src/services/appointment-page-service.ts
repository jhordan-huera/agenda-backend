import { appointmentColumns } from "../db/columns.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { APPOINTMENT_PAGE_DAYS, canCancelOnline } from "../shared/lib/constants/business.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import type { Appointment, Business, PublicAppointment, PublicAppointmentResult } from "../shared/types/index.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import { PATIENT_LINK_ACTOR, cancelFromPatientLink } from "./business-data-service.ts";
import { minutesUntilStart } from "./reminder-rules.ts";

/**
 * Página «Tu cita» (/cita/:token, spec 010), sin sesión: el token es la autorización. Llega en los
 * emails de una cita activa. El paciente principal entra con el mismo enlace del pago
 * (appointments.payment_token) y cada otra persona de la sesión con el suyo
 * (appointment_clients.access_token). Desde ahí:
 * - «Confirmo que voy»: una marca aparte, que no cambia el estado (confirmar la cita es del negocio);
 * - «Cancelar mi cita»: sólo el principal, si el negocio permite cancelaciones y aún falta más que su
 *   antelación (canCancelOnline), con los avisos de cualquier cambio de estado (spec 008).
 * Un enlace reenviado o filtrado sólo enseña la fecha, la hora, el servicio, el profesional y el
 * negocio: nada del paciente ni de las otras personas.
 */

/** Lo que responde un enlace que no existe, caducado, de una persona que ya no está o de un negocio suspendido. */
const NOT_FOUND = "Este enlace no existe o ya no está disponible.";

/** Citas que aún se pueden confirmar o cancelar. */
const ACTIVE_STATUSES: readonly Appointment["status"][] = ["pending", "confirmed"];

/** Los enlaces son 32 caracteres hex (gen_random_uuid sin guiones, como el del pago). */
const TOKEN_FORMAT = /^[0-9a-f]{32}$/;

type PageBusiness = PublicAppointment["business"] & { status: Business["status"]; bookingSettings: Business["bookingSettings"] };

interface LinkContext {
  appointment: Appointment;
  /** Quien abre el enlace: el paciente principal o una de las otras personas de la sesión. */
  clientId: string;
  main: boolean;
  /** Su «Confirmo que voy» (null: aún no). */
  confirmedAt: string | null;
  business: PageBusiness;
  serviceName: string;
  professionalName: string;
  /** La agenda cobra por transferencia (tiene alguna cuenta). */
  transfers: boolean;
}

const notFound = () => new AppError("not_found", NOT_FOUND);

/**
 * La cita de un enlace «Tu cita», con quién lo abre. `lock`: la cita queda bloqueada hasta el final de
 * la transacción (confirmar y cancelar), así que dos toques a la vez no hacen dos veces lo mismo.
 * Responde siempre el mismo 404 (RF-011): el token no existe o no tiene el formato, esa persona ya no
 * está en la cita o cambió el principal (su fila o su token ya no existen), el negocio no está activo
 * o pasaron más de APPOINTMENT_PAGE_DAYS días desde la cita.
 */
async function findByLinkToken(db: Db, token: string, lock = false): Promise<LinkContext> {
  if (!TOKEN_FORMAT.test(token)) throw notFound();
  const forUpdate = lock ? " for update" : "";
  let appointment = await one<Appointment>(
    db,
    `select ${appointmentColumns()} from appointments where payment_token = $1${forUpdate}`,
    [token],
  );
  let person: { clientId: string; main: boolean; confirmedAt: string | null } | null = appointment
    ? {
        clientId: appointment.clientId,
        main: true,
        confirmedAt: appointment.clientConfirmations.find((confirmation) => confirmation.clientId === appointment!.clientId)?.confirmedAt ?? null,
      }
    : null;
  if (!appointment) {
    const extra = await one<{ appointmentId: string }>(
      db,
      `select appointment_id as "appointmentId" from appointment_clients where access_token = $1`,
      [token],
    );
    appointment = extra
      ? await one<Appointment>(db, `select ${appointmentColumns()} from appointments where id = $1${forUpdate}`, [extra.appointmentId])
      : null;
    // Con la cita ya bloqueada: si mientras tanto quitaron a esa persona, su enlace ya no vale.
    const row = appointment
      ? await one<{ clientId: string; confirmedAt: string | null }>(
          db,
          `select client_id as "clientId", confirmed_at as "confirmedAt" from appointment_clients
            where appointment_id = $1 and access_token = $2`,
          [appointment.id, token],
        )
      : null;
    person = row ? { ...row, main: false } : null;
  }
  if (!appointment || !person) throw notFound();

  const details = await one<Omit<LinkContext, "appointment" | "clientId" | "main" | "confirmedAt" | "business"> & { business: PageBusiness }>(
    db,
    `select json_build_object('name', b.name, 'slug', b.slug, 'logoUrl', b.logo_url, 'phone', b.phone, 'address', b.address,
                              'lat', b.lat, 'lng', b.lng, 'timezone', b.timezone, 'brandColors', b.brand_colors,
                              'status', b.status, 'bookingSettings', b.booking_settings) as business,
            coalesce(s.name, '') as "serviceName", coalesce(p.display_name, b.name) as "professionalName",
            coalesce(jsonb_array_length(p.bank_accounts), 0) > 0 as transfers
       from businesses b
       left join services s on s.id = $2
       left join professionals p on p.id = $3
      where b.id = $1`,
    [appointment.businessId, appointment.serviceId, appointment.professionalId],
  );
  // Un negocio suspendido no se distingue de un enlace que no existe.
  if (!details || details.business.status !== "active") throw notFound();
  const today = getZonedNow(details.business.timezone).date;
  if (appointment.date < addDaysISO(today, -APPOINTMENT_PAGE_DAYS)) throw notFound();
  return { appointment, ...person, ...details };
}

/** Lo que ve quien abre el enlace. Qué puede hacer lo calcula el servidor; la página sólo lo muestra. */
function toPublicAppointment(context: LinkContext): PublicAppointment {
  const { appointment, business } = context;
  const settings = business.bookingSettings;
  const minutes = minutesUntilStart(appointment.date, appointment.startTime, getZonedNow(business.timezone));
  const past = minutes <= 0;
  const open = ACTIVE_STATUSES.includes(appointment.status) && !past;
  const cancellation: PublicAppointment["cancellation"]["status"] = !open
    ? "closed"
    : !context.main
      ? "not_main"
      : !settings.allowCancellations
        ? "disabled"
        : canCancelOnline(settings, minutes)
          ? "allowed"
          : "too_late";
  return {
    business: {
      name: business.name,
      slug: business.slug,
      logoUrl: business.logoUrl,
      phone: business.phone,
      address: business.address,
      lat: business.lat,
      lng: business.lng,
      timezone: business.timezone,
      brandColors: business.brandColors,
    },
    serviceName: context.serviceName,
    professionalName: context.professionalName,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    // Sin la dirección de la visita a domicilio ni el enlace de la videollamada: siguen llegando por email.
    place: appointment.isVirtual ? "virtual" : appointment.homeVisit ? "home" : "business",
    status: appointment.status,
    past,
    confirmedAt: context.confirmedAt,
    canConfirm: open,
    cancellation: {
      status: cancellation,
      noticeHours: settings.cancellationNoticeHours,
      policy: settings.allowCancellations ? settings.cancellationPolicy : "",
    },
    // Los datos de pago son sólo del principal (spec 005), como en el email.
    payment:
      context.main &&
      context.transfers &&
      appointment.price > 0 &&
      !appointment.paidAt &&
      appointment.status !== "cancelled" &&
      appointment.status !== "no_show",
  };
}

export const appointmentPageService = {
  async get(token: string): Promise<PublicAppointment> {
    return toPublicAppointment(await findByLinkToken(pool, token));
  },

  /**
   * «Confirmo que voy»: guarda cuándo, sin cambiar el estado, y lo registra la primera vez. Repetirlo
   * no cambia nada (`already`). Sin email ni aviso por ntfy: el negocio lo ve en la agenda.
   */
  async confirm(token: string): Promise<PublicAppointmentResult> {
    return transaction(async (db) => {
      const context = await findByLinkToken(db, token, true);
      const { appointment } = context;
      if (!ACTIVE_STATUSES.includes(appointment.status)) throw new AppError("conflict", "Esta cita ya no está activa.");
      if (minutesUntilStart(appointment.date, appointment.startTime, getZonedNow(context.business.timezone)) <= 0) {
        throw new AppError("conflict", "Esta cita ya pasó.");
      }
      const confirmed = context.main
        ? await one<{ at: string }>(
            db,
            "update appointments set client_confirmed_at = now() where id = $1 and client_confirmed_at is null returning client_confirmed_at as at",
            [appointment.id],
          )
        : await one<{ at: string }>(
            db,
            `update appointment_clients set confirmed_at = now()
              where appointment_id = $1 and client_id = $2 and confirmed_at is null
              returning confirmed_at as at`,
            [appointment.id, context.clientId],
          );
      if (confirmed) {
        await logAudit(db, {
          businessId: appointment.businessId,
          actor: null,
          actorName: PATIENT_LINK_ACTOR,
          action: "appointment.client_confirmed",
          entityType: "appointment",
          entityId: appointment.id,
          // Sólo quien confirmó, no las demás personas de la sesión.
          summary: `Confirmó que va, desde su email: ${await describeAppointment(db, { ...appointment, clientId: context.clientId, extraClientIds: [] })}`,
        });
      }
      return {
        appointment: toPublicAppointment({ ...context, confirmedAt: confirmed?.at ?? context.confirmedAt }),
        already: !confirmed,
      };
    });
  },

  /**
   * «Cancelar mi cita»: con la cita bloqueada se vuelve a comprobar la regla (pudo abrir la página
   * antes del plazo), así que nunca se cancela fuera de plazo (CE-002). Si ya estaba cancelada, no se
   * repite nada (`already`).
   */
  async cancel(token: string): Promise<PublicAppointmentResult> {
    return transaction(async (db) => {
      const context = await findByLinkToken(db, token, true);
      const { appointment, business } = context;
      const settings = business.bookingSettings;
      if (!context.main) throw new AppError("conflict", `Para no asistir, escríbele a ${business.name}.`);
      if (appointment.status === "cancelled") return { appointment: toPublicAppointment(context), already: true };
      const minutes = minutesUntilStart(appointment.date, appointment.startTime, getZonedNow(business.timezone));
      if (!ACTIVE_STATUSES.includes(appointment.status) || minutes <= 0) {
        throw new AppError("conflict", "Esta cita ya no está activa.");
      }
      if (!settings.allowCancellations) {
        throw new AppError("conflict", `${business.name} no permite cancelar desde aquí: escríbele para avisarle.`);
      }
      if (!canCancelOnline(settings, minutes)) {
        throw new AppError("conflict", `Para cancelar con menos de ${settings.cancellationNoticeHours} h, escríbele a ${business.name}.`);
      }
      const cancelled = await cancelFromPatientLink(db, appointment);
      return { appointment: toPublicAppointment({ ...context, appointment: cancelled, confirmedAt: null }), already: false };
    });
  },
};
