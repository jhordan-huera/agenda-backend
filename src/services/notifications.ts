import { config } from "../config.ts";
import { appointmentColumns, businessColumns } from "../db/columns.ts";
import { many, one, type Db } from "../db/pool.ts";
import { emailTemplates, type AppointmentEmailData, type EmailContent } from "../shared/lib/email/templates.ts";
import { addDaysISO, daysBetween, getZonedNow, timeToMinutes, type ZonedNow } from "../shared/lib/time.ts";
import type { Appointment, Business, EmailType } from "../shared/types/index.ts";
import { PASSWORD_MASK, scheduleEmailDelivery } from "./mailer.ts";

export { PASSWORD_MASK };

/**
 * Emails del sistema. Cada mensaje se guarda "en cola" en la tabla notifications, en la
 * misma transacción que el cambio que lo provoca (si la operación falla, no se envía nada),
 * y src/services/mailer.ts lo envía por Gmail en segundo plano.
 */

/** Enlaces de los emails: apuntan al frontend. */
export function appOrigin(): string {
  return config.frontendUrl;
}

/**
 * Pone el email en cola. Devuelve false si ya existía (recordatorio duplicado). `secret`: la
 * contraseña que el mailer pone en lugar de PASSWORD_MASK al enviarlo (ver mailer.ts).
 */
export async function queueEmail(
  db: Db,
  message: {
    businessId: string | null;
    type: EmailType;
    to: string;
    appointmentId?: string | null;
    secret?: string;
    /** Emails que se envían una sola vez (p. ej. la agenda del día de un profesional). */
    dedupeKey?: string;
  } & EmailContent,
): Promise<boolean> {
  const result = await db.query(
    `insert into notifications (business_id, type, to_email, subject, body, html, appointment_id, status, secret, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9)
     on conflict do nothing`,
    [
      message.businessId,
      message.type,
      message.to,
      message.subject,
      message.body,
      message.html,
      message.appointmentId ?? null,
      message.secret ?? null,
      message.dedupeKey ?? null,
    ],
  );
  const inserted = (result.rowCount ?? 0) > 0;
  if (inserted) scheduleEmailDelivery();
  return inserted;
}

interface AppointmentContext {
  business: Business;
  clientName: string;
  clientEmail: string;
  serviceName: string;
  /** Los clientes ven el precio de este servicio (ver isPriceVisible). */
  showPrice: boolean;
  professionalName: string | null;
  /** A dónde se le avisa al profesional ("" = sin avisos) y si quiere el aviso de citas nuevas. */
  professionalEmail: string;
  professionalNotify: boolean;
  professionalUserId: string | null;
}

async function loadAppointmentContext(db: Db, appointment: Appointment): Promise<AppointmentContext | null> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [
    appointment.businessId,
  ]);
  const details = await one<Omit<AppointmentContext, "business">>(
    db,
    `select c.name as "clientName", c.email as "clientEmail", s.name as "serviceName",
            s.show_price and s.price > 0 as "showPrice",
            p.display_name as "professionalName",
            coalesce(p.email, '') as "professionalEmail",
            coalesce(p.notify_new_appointments, false) as "professionalNotify",
            p.user_id as "professionalUserId"
       from clients c cross join services s left join professionals p on p.id = $3
      where c.id = $1 and s.id = $2`,
    [appointment.clientId, appointment.serviceId, appointment.professionalId],
  );
  return business && details ? { business, ...details } : null;
}

function buildEmailData(context: AppointmentContext, appointment: Appointment): AppointmentEmailData {
  const { business } = context;
  return {
    clientName: context.clientName,
    businessName: business.name,
    businessAddress: business.address,
    businessLat: business.lat,
    businessLng: business.lng,
    businessPhone: business.phone,
    professionalName: context.professionalName ?? business.name,
    serviceName: context.serviceName,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    price: appointment.price,
    showPrice: context.showPrice,
    currency: business.currency,
    cancellationPolicy: business.bookingSettings.allowCancellations ? business.bookingSettings.cancellationPolicy : "",
    bookingUrl: `${appOrigin()}/book/${business.slug}`,
    homeVisit: appointment.homeVisit,
  };
}

/**
 * Aviso al profesional de una cita nueva en su agenda (o que le pasaron de otra), salvo que la haya
 * agendado él mismo o que ya le llegue como aviso del negocio (mismo email que el negocio).
 */
async function notifyProfessional(
  db: Db,
  context: AppointmentContext,
  before: Appointment | null,
  after: Appointment,
  origin: "dashboard" | "booking_page",
  actorUserId: string | null,
) {
  const isNewForProfessional = !before || before.professionalId !== after.professionalId;
  if (!isNewForProfessional || !["pending", "confirmed"].includes(after.status)) return;
  if (!context.professionalEmail || !context.professionalNotify) return;
  if (actorUserId && actorUserId === context.professionalUserId) return;
  if (origin === "booking_page" && context.professionalEmail === context.business.email) return;
  await queueEmail(db, {
    businessId: context.business.id,
    type: "professional_new_appointment",
    to: context.professionalEmail,
    appointmentId: after.id,
    ...emailTemplates.professionalNewAppointment({
      ...buildEmailData(context, after),
      origin,
      agendaUrl: `${appOrigin()}/dashboard/calendar?date=${after.date}`,
    }),
  });
}

/**
 * Emails automáticos al crear o cambiar una cita, según la configuración de notificaciones.
 * `actorUserId`: quién hizo el cambio desde el panel (al profesional no se le avisa de lo que hizo él).
 * Devuelve true si se envió un email al cliente.
 */
export async function notifyAppointmentChange(
  db: Db,
  before: Appointment | null,
  after: Appointment,
  origin: "dashboard" | "booking_page",
  actorUserId: string | null = null,
): Promise<boolean> {
  const context = await loadAppointmentContext(db, after);
  if (!context) return false;
  const { business } = context;
  const data = buildEmailData(context, after);
  const settings = business.notificationSettings;
  await notifyProfessional(db, context, before, after, origin, actorUserId);

  const toClient = async (type: EmailType, content: EmailContent) => {
    if (!context.clientEmail) return false;
    await queueEmail(db, { businessId: business.id, type, to: context.clientEmail, appointmentId: after.id, ...content });
    return true;
  };

  if (!before) {
    if (origin === "booking_page" && business.email) {
      await queueEmail(db, {
        businessId: business.id,
        type: "booking_received",
        to: business.email,
        appointmentId: after.id,
        ...emailTemplates.bookingReceived(data),
      });
    }
    if (!settings.confirmations || !["pending", "confirmed"].includes(after.status)) return false;
    return after.status === "confirmed"
      ? toClient("appointment_confirmed", emailTemplates.appointmentConfirmed(data))
      : toClient("booking_created", emailTemplates.bookingCreated(data));
  }

  if (after.status === "cancelled" && before.status !== "cancelled") {
    return settings.cancellations && toClient("appointment_cancelled", emailTemplates.appointmentCancelled(data));
  }
  if (after.status === "cancelled" || after.status === "completed" || after.status === "no_show") return false;

  const rescheduled =
    before.date !== after.date || before.startTime !== after.startTime || before.serviceId !== after.serviceId;
  if (rescheduled) {
    return settings.confirmations && toClient("appointment_updated", emailTemplates.appointmentUpdated(data));
  }
  if (after.status === "confirmed" && before.status !== "confirmed") {
    return settings.confirmations && toClient("appointment_confirmed", emailTemplates.appointmentConfirmed(data));
  }
  return false;
}

/**
 * Recordatorios pendientes de un negocio: citas activas que empiezan dentro de las
 * próximas `reminderHoursBefore` horas y aún no tienen recordatorio. Lo ejecuta el
 * trabajo programado del servidor (src/jobs/reminders.ts) y, al abrir el panel, el frontend.
 */
export async function runReminderJob(db: Db, businessId: string): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  if (!business || business.status !== "active" || !business.notificationSettings.reminders) return 0;

  const now = getZonedNow(business.timezone);
  const windowMinutes = business.notificationSettings.reminderHoursBefore * 60;
  const lastDate = addDaysISO(now.date, Math.ceil(windowMinutes / 1440) + 1);
  const candidates = await many<Appointment>(
    db,
    `select ${appointmentColumns("a")}
       from appointments a
      where a.business_id = $1
        and a.status in ('pending', 'confirmed')
        and a.date between $2 and $3
        and not exists (
          select 1 from notifications n where n.appointment_id = a.id and n.type = 'appointment_reminder'
        )`,
    [businessId, now.date, lastDate],
  );

  let sent = 0;
  for (const appointment of candidates) {
    const minutesUntil =
      daysBetween(now.date, appointment.date) * 1440 + timeToMinutes(appointment.startTime) - now.minutes;
    if (minutesUntil <= 0 || minutesUntil > windowMinutes) continue;

    const context = await loadAppointmentContext(db, appointment);
    if (!context?.clientEmail) continue;
    const when = appointment.date === now.date ? "hoy" : appointment.date === addDaysISO(now.date, 1) ? "mañana" : null;
    const inserted = await queueEmail(db, {
      businessId,
      type: "appointment_reminder",
      to: context.clientEmail,
      appointmentId: appointment.id,
      ...emailTemplates.appointmentReminder(buildEmailData(context, appointment), when),
    });
    if (inserted) sent++;
  }
  return sent;
}

/** La agenda del día sale entre las 6:00 y las 11:00 (hora del negocio); más tarde ya no sirve. */
const DAILY_AGENDA_FROM_MINUTES = 6 * 60;
const DAILY_AGENDA_UNTIL_MINUTES = 11 * 60;

/**
 * Agenda del día de cada profesional (con email y el aviso activado) que tenga citas hoy. Una sola vez
 * por profesional y día (clave única en notifications). La ejecuta el cron cada 10 minutos.
 */
export async function runDailyAgendaJob(db: Db, businessId: string, at?: ZonedNow): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  if (!business || business.status !== "active") return 0;
  const now = at ?? getZonedNow(business.timezone);
  if (now.minutes < DAILY_AGENDA_FROM_MINUTES || now.minutes >= DAILY_AGENDA_UNTIL_MINUTES) return 0;

  const professionals = await many<{ id: string; displayName: string; email: string }>(
    db,
    `select id, display_name as "displayName", email from professionals
      where business_id = $1 and is_active and daily_agenda and email <> ''`,
    [businessId],
  );
  let sent = 0;
  for (const professional of professionals) {
    const appointments = await many<{ time: string; clientName: string; serviceName: string; homeVisit: Appointment["homeVisit"] }>(
      db,
      `select to_char(a.start_time, 'HH24:MI') || '–' || to_char(a.end_time, 'HH24:MI') as time,
              c.name as "clientName", s.name as "serviceName", a.home_visit as "homeVisit"
         from appointments a join clients c on c.id = a.client_id join services s on s.id = a.service_id
        where a.professional_id = $1 and a.date = $2 and a.status in ('pending', 'confirmed')
        order by a.start_time`,
      [professional.id, now.date],
    );
    if (appointments.length === 0) continue;
    const inserted = await queueEmail(db, {
      businessId,
      type: "professional_daily_agenda",
      to: professional.email,
      dedupeKey: `daily_agenda:${professional.id}:${now.date}`,
      ...emailTemplates.professionalDailyAgenda({
        professionalName: professional.displayName,
        businessName: business.name,
        date: now.date,
        appointments,
        agendaUrl: `${appOrigin()}/dashboard/calendar?date=${now.date}`,
      }),
    });
    if (inserted) sent++;
  }
  return sent;
}
