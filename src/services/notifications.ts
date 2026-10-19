import { config } from "../config.ts";
import { appointmentColumns, businessColumns } from "../db/columns.ts";
import { many, one, type Db } from "../db/pool.ts";
import { canCancelOnline, isFollowUpDate } from "../shared/lib/constants/business.ts";
import { emailTemplates, type AppointmentEmailData, type EmailContent, type SeriesEmailDate } from "../shared/lib/email/templates.ts";
import { joinNames } from "../shared/lib/format.ts";
import { addDaysISO, getZonedNow, type ZonedNow } from "../shared/lib/time.ts";
import type { Appointment, BankAccount, Business, EmailType } from "../shared/types/index.ts";
import { appointmentClientIds } from "./appointment-clients.ts";
import { newPatientEmailHold, publicEmailHold } from "./email-limits.ts";
import { PASSWORD_MASK, scheduleEmailDelivery } from "./mailer.ts";
import { isQuietTime, minutesUntilStart, reminderCopyKey, reminderKeyFor, reminderKeySql } from "./reminder-rules.ts";

export { PASSWORD_MASK };

/**
 * Emails del sistema. Cada mensaje se guarda "en cola" en la tabla notifications, en la
 * misma transacción que el cambio que lo provoca (si la operación falla, no se envía nada),
 * y src/services/mailer.ts lo envía por Gmail en segundo plano.
 */

/** Enlaces de los emails: apuntan al frontend. */
export function appOrigin(): string {
  return config.appUrl;
}

/** Enlace privado de pago de una cita: datos para transferir y subida del comprobante. */
export const paymentUrl = (token: string) => `${appOrigin()}/pago/${token}`;

/**
 * Enlace privado de una persona a su página «Tu cita» (spec 010): el del principal es el token del pago
 * y el de cada otra persona de la sesión, el suyo (appointment_clients.access_token).
 */
export const appointmentPageUrl = (token: string) => `${appOrigin()}/cita/${token}`;

/** De dónde viene un cambio de la cita: el panel, la página de reservas o «Tu cita» (el paciente, spec 010). */
export type ChangeOrigin = "dashboard" | "booking_page" | "patient_link";

/**
 * Pone el email en cola. Devuelve false si no va a salir: ya existía (recordatorio duplicado) o lo
 * frenó un tope contra el abuso (ver email-limits.ts: queda en el historial como fallido, con el
 * motivo). El cupo de Gmail no se mira aquí sino al enviar (mailer.ts): lo que no cabe espera en la cola.
 * `secret`: la contraseña que el mailer pone en lugar de PASSWORD_MASK al enviarlo (ver mailer.ts).
 * `hold`: motivo para no enviarlo, si quien lo pone en cola ya lo sabe.
 * `calendar`: el iCalendar de una invitación de calendario (spec 027), que sale como text/calendar.
 */
export async function queueEmail(
  db: Db,
  message: {
    businessId: string | null;
    type: EmailType;
    to: string;
    appointmentId?: string | null;
    secret?: string;
    /** Emails que se envían una sola vez (la agenda del día de un profesional, cada recordatorio). */
    dedupeKey?: string;
    hold?: string | null;
    calendar?: string;
  } & EmailContent,
): Promise<boolean> {
  const hold = message.hold ?? (await publicEmailHold(db, message.type, message.appointmentId ?? null));
  const result = await db.query(
    `insert into notifications
       (business_id, type, to_email, subject, body, html, appointment_id, status, secret, dedupe_key, last_error, calendar)
     values ($1, $2, $3, $4, $5, $6, $7, case when $10::text is null then 'queued' else 'failed' end,
             case when $10::text is null then $8 end, $9, $10, $11)
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
      hold,
      message.calendar ?? null,
    ],
  );
  const queued = (result.rowCount ?? 0) > 0 && hold === null;
  if (queued) scheduleEmailDelivery();
  return queued;
}

/** Un paciente de la cita a quien se le escribe ("" = sin email). */
interface Recipient {
  clientId: string;
  name: string;
  email: string;
  /** Paciente «Por verificar» (spec 009): escribió la cédula de otra ficha con otros datos. */
  toVerify: boolean;
  /**
   * Su enlace a «Tu cita» (spec 010): el token del pago si es el principal y el suyo si es otra persona
   * de la sesión; null si ya no está en la cita (p. ej. quitado: recibe la cancelación, sin enlace).
   */
  token: string | null;
  /** Ya confirmó que va («Confirmo que voy»). */
  confirmed: boolean;
}

interface AppointmentContext {
  business: Business;
  /** Los pacientes de la cita: el principal primero y luego los demás (ver appointment-clients.ts). */
  recipients: Recipient[];
  /** Todos sus nombres ("Ana Torres y Carlos Pérez"): avisos al negocio y al profesional, y la copia. */
  clientName: string;
  serviceName: string;
  /** Los clientes ven el precio de este servicio (ver isPriceVisible). */
  showPrice: boolean;
  professionalName: string | null;
  /** A dónde se le avisa al profesional ("" = sin avisos) y si quiere el aviso de citas nuevas. */
  professionalEmail: string;
  professionalNotify: boolean;
  professionalUserId: string | null;
  /**
   * A dónde va la copia de los emails al paciente: el email de avisos del profesional o, si no tiene,
   * el de su usuario ("" = sin copia: una agenda sin email ni usuario).
   */
  professionalCopyEmail: string;
  /** Sala de videollamada del profesional ("" = sin enlace). */
  meetingUrl: string;
  /** Cuentas para el pago por transferencia de esta agenda, la principal primero (vacía: no cobra por transferencia). */
  bankAccounts: BankAccount[];
}

async function loadAppointmentContext(db: Db, appointment: Appointment): Promise<AppointmentContext | null> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [
    appointment.businessId,
  ]);
  const ids = appointmentClientIds(appointment);
  const rows = await many<Omit<Recipient, "token" | "confirmed">>(
    db,
    `select id as "clientId", name, email, claimed_client_id is not null as "toVerify" from clients where id = any($1::uuid[])`,
    [ids],
  );
  // El enlace y la confirmación de las otras personas de la sesión (los del principal van en la cita).
  const links = await many<{ clientId: string; token: string; confirmed: boolean }>(
    db,
    `select client_id as "clientId", access_token as token, confirmed_at is not null as confirmed
       from appointment_clients where appointment_id = $1`,
    [appointment.id],
  );
  const mainConfirmed = (appointment.clientConfirmations ?? []).some((confirmation) => confirmation.clientId === appointment.clientId);
  const recipients = ids.flatMap((id) =>
    rows
      .filter((row) => row.clientId === id)
      .map((row): Recipient => {
        if (id === appointment.clientId) return { ...row, token: appointment.paymentToken || null, confirmed: mainConfirmed };
        const link = links.find((candidate) => candidate.clientId === id);
        return { ...row, token: link?.token ?? null, confirmed: link?.confirmed ?? false };
      }),
  );
  const details = await one<Omit<AppointmentContext, "business" | "recipients" | "clientName">>(
    db,
    `select s.name as "serviceName",
            s.show_price as "showPrice",
            coalesce(p.meeting_url, '') as "meetingUrl",
            coalesce(p.bank_accounts, '[]'::jsonb) as "bankAccounts",
            p.display_name as "professionalName",
            coalesce(p.email, '') as "professionalEmail",
            coalesce(p.notify_new_appointments, false) as "professionalNotify",
            p.user_id as "professionalUserId",
            coalesce(nullif(p.email, ''), u.email, '') as "professionalCopyEmail"
       from services s
       left join professionals p on p.id = $2
       left join users u on u.id = p.user_id
      where s.id = $1`,
    [appointment.serviceId, appointment.professionalId],
  );
  if (!business || !details || recipients.length === 0) return null;
  return { business, recipients, clientName: joinNames(recipients.map((recipient) => recipient.name)), ...details };
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
    isVirtual: appointment.isVirtual,
    meetingUrl: appointment.isVirtual ? context.meetingUrl || null : null,
    // Sólo si hay algo que pagar y aún no se marcó como pagada; con todas las cuentas (vale cualquiera).
    payment:
      context.bankAccounts.length > 0 && appointment.price > 0 && !appointment.paidAt
        ? { bankAccounts: context.bankAccounts, url: paymentUrl(appointment.paymentToken) }
        : null,
    // En las citas virtuales la hora va con la zona del negocio: el paciente puede estar en otro país.
    timezone: business.timezone,
  };
}

/** Dónde es la cita: en el local, virtual o a domicilio (con la dirección). */
const placeOf = (appointment: Appointment) =>
  appointment.isVirtual ? "virtual" : appointment.homeVisit ? `home:${appointment.homeVisit.address}` : "business";

/**
 * Cambios que el paciente tiene que saber: fecha, hora, servicio, profesional o modalidad (en el
 * local, virtual o a domicilio, y la dirección de la visita).
 */
export function isRescheduled(before: Appointment, after: Appointment): boolean {
  return (
    before.date !== after.date ||
    before.startTime !== after.startTime ||
    before.serviceId !== after.serviceId ||
    before.professionalId !== after.professionalId ||
    placeOf(before) !== placeOf(after)
  );
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const emailKey = (email: string) => email.trim().toLowerCase();

/**
 * La página «Tu cita» de quien recibe el email (spec 010): su enlace, si podrá cancelar desde ahí
 * cuando salga el email (sólo el principal, con «Permitir cancelaciones» y en plazo: canCancelOnline)
 * y si ya confirmó. null sin enlace. Las plantillas sólo lo ponen en los emails de una cita activa, y
 * nunca en la copia al profesional.
 */
function appointmentPageFor(
  recipient: Recipient,
  appointment: Appointment,
  business: Business,
  minutesUntil: number,
): AppointmentEmailData["appointmentPage"] {
  if (!recipient.token) return null;
  const active = ["pending", "confirmed"].includes(appointment.status);
  return {
    url: appointmentPageUrl(recipient.token),
    canCancel: active && recipient.clientId === appointment.clientId && canCancelOnline(business.bookingSettings, minutesUntil),
    confirmed: recipient.confirmed,
  };
}

/** Enlace a la cita en la agenda del panel (también el «Ver en Agenda360» de las invitaciones de calendario). */
export const agendaUrlOf = (appointment: Pick<Appointment, "id" | "date">) =>
  `${appOrigin()}/dashboard/calendar?date=${appointment.date}&appointment=${appointment.id}`;

/**
 * Aviso al profesional de una cita nueva en su agenda (o que le pasaron de otra), salvo que la haya
 * agendado él mismo, que ya le llegue como aviso del negocio (mismo email que el negocio) o que a ese
 * email ya le haya llegado la copia del email al paciente (`copiedTo`).
 */
async function notifyProfessional(
  db: Db,
  context: AppointmentContext,
  before: Appointment | null,
  after: Appointment,
  origin: "dashboard" | "booking_page",
  actorUserId: string | null,
  copiedTo: string,
) {
  const isNewForProfessional = !before || before.professionalId !== after.professionalId;
  if (!isNewForProfessional || !["pending", "confirmed"].includes(after.status)) return;
  if (!context.professionalEmail || !context.professionalNotify) return;
  if (actorUserId && actorUserId === context.professionalUserId) return;
  if (origin === "booking_page" && context.professionalEmail === context.business.email) return;
  if (sameEmail(context.professionalEmail, copiedTo)) return;
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
 * El paciente subió un comprobante: aviso al email del negocio y al profesional (si recibe los
 * avisos de sus citas y no es el mismo email).
 */
export async function notifyReceiptReceived(db: Db, appointment: Appointment): Promise<void> {
  const context = await loadAppointmentContext(db, appointment);
  if (!context) return;
  const recipients = new Set([context.business.email, context.professionalNotify ? context.professionalEmail : ""].filter(Boolean));
  const content = emailTemplates.paymentReceiptReceived({
    ...buildEmailData(context, appointment),
    agendaUrl: `${appOrigin()}/dashboard/calendar?date=${appointment.date}&appointment=${appointment.id}`,
  });
  for (const to of recipients) {
    await queueEmail(db, { businessId: context.business.id, type: "payment_receipt_received", to, appointmentId: appointment.id, ...content });
  }
}

/** El email al paciente que corresponde a un cambio de su cita, según la configuración del negocio. */
interface ClientMessage {
  type: EmailType;
  template: (data: AppointmentEmailData) => EmailContent;
}

/**
 * Spec 008: todo cambio de estado se avisa. A los casos de siempre (cancelación, «vuelve a estar
 * agendada», cambio de fecha u hora, confirmación) se suman, después y sin cambiar su prioridad:
 * - Atendida y No asistió, con «Seguimiento» (encendido si el negocio no lo guardó) y sólo de citas
 *   de los últimos 7 días (`today`: hoy en la zona del negocio);
 * - volver a Pendiente desde Confirmada, Atendida o No asistió.
 */
function clientMessageFor(
  settings: Business["notificationSettings"],
  before: Appointment | null,
  after: Appointment,
  today: string,
): ClientMessage | null {
  if (!before) {
    if (!settings.confirmations || !["pending", "confirmed"].includes(after.status)) return null;
    return after.status === "confirmed"
      ? { type: "appointment_confirmed", template: emailTemplates.appointmentConfirmed }
      : { type: "booking_created", template: emailTemplates.bookingCreated };
  }
  if (after.status === "cancelled" && before.status !== "cancelled") {
    return settings.cancellations ? { type: "appointment_cancelled", template: emailTemplates.appointmentCancelled } : null;
  }
  if (after.status === "cancelled") return null;
  if (after.status === "completed" || after.status === "no_show") {
    if (before.status === after.status || settings.followUps === false || !isFollowUpDate(after.date, today)) return null;
    return after.status === "completed"
      ? { type: "appointment_completed", template: emailTemplates.appointmentCompleted }
      : { type: "appointment_no_show", template: emailTemplates.appointmentNoShow };
  }
  if (!settings.confirmations) return null;
  // Estaba cancelada y vuelve a estar activa: el paciente la daba por perdida.
  if (before.status === "cancelled") return { type: "appointment_updated", template: emailTemplates.appointmentRestored };
  if (isRescheduled(before, after)) return { type: "appointment_updated", template: emailTemplates.appointmentUpdated };
  if (after.status === "confirmed" && before.status !== "confirmed") {
    return { type: "appointment_confirmed", template: emailTemplates.appointmentConfirmed };
  }
  // Vuelve a Pendiente desde Confirmada, Atendida o No asistió: ya no está confirmada (spec 008).
  if (after.status === "pending" && before.status !== "pending") {
    return { type: "appointment_pending", template: emailTemplates.appointmentPending };
  }
  return null;
}

/**
 * Emails automáticos al crear o cambiar una cita, según la configuración de notificaciones, a cada
 * paciente de la cita con su nombre (citas con varios pacientes, spec 004):
 * - los que ya estaban reciben el aviso del cambio;
 * - los que se agregan a una cita activa, el de una cita nueva (solicitud o confirmación);
 * - los que se quitan de una cita activa, el de cancelación.
 * Los datos de pago van sólo al principal; en una reserva por la página, el email de los demás dice
 * quién la hizo (spec 005).
 * Un solo email por dirección (una pareja con el mismo correo). Cada email que sale al paciente le
 * llega también, una sola vez y con los nombres de todos, como copia al profesional de la cita (la de
 * los recordatorios, en runReminderJob); a ese email ya no se le manda además el aviso de cita nueva o
 * de nueva reserva.
 * `actorUserId`: quién hizo el cambio desde el panel (al profesional no se le avisa de lo que hizo él).
 * Devuelve true si se envió un email a algún paciente.
 */
export async function notifyAppointmentChange(
  db: Db,
  before: Appointment | null,
  after: Appointment,
  origin: ChangeOrigin,
  actorUserId: string | null = null,
): Promise<boolean> {
  const context = await loadAppointmentContext(db, after);
  if (!context) return false;
  const { business } = context;
  const settings = business.notificationSettings;
  const data = buildEmailData(context, after);
  const beforeIds = before ? appointmentClientIds(before) : [];
  const afterIds = appointmentClientIds(after);
  const written = new Set<string>();
  let sentToClient = false;
  let copied: { message: ClientMessage; data: AppointmentEmailData } | null = null;

  // Quien reservó una sesión en pareja o en familia por la página (el principal): se lo dice a los demás.
  const bookedBy = !before && origin === "booking_page" ? context.recipients[0]?.name : undefined;
  // Para saber si cada persona podrá cancelar desde «Tu cita» cuando le llegue el email (spec 010).
  const minutesUntil = minutesUntilStart(after.date, after.startTime, getZonedNow(business.timezone));
  const write = async (recipient: Recipient, message: ClientMessage | null, emailData: AppointmentEmailData) => {
    if (!message || !recipient.email || written.has(emailKey(recipient.email))) return;
    written.add(emailKey(recipient.email));
    // La reserva online de un paciente nuevo: tope por negocio (además del general a terceros).
    const hold = origin === "booking_page" ? await newPatientEmailHold(db, business.id, recipient.clientId) : null;
    // Los datos de pago, sólo al principal: el precio es de la sesión y lo paga una persona (spec 005).
    const own = recipient.clientId === after.clientId ? {} : { payment: null, bookedBy };
    // Su propio enlace a «Tu cita» (spec 010): va en los datos de esa persona, no en los de la copia.
    const appointmentPage = appointmentPageFor(recipient, after, business, minutesUntil);
    const queued = await queueEmail(db, {
      businessId: business.id,
      type: message.type,
      to: recipient.email,
      appointmentId: after.id,
      hold,
      ...message.template({ ...emailData, ...own, appointmentPage, clientName: recipient.name }),
    });
    if (queued) {
      sentToClient = true;
      copied ??= { message, data: emailData };
    }
  };

  const today = getZonedNow(business.timezone).date;
  for (const recipient of context.recipients) {
    const added = before !== null && !beforeIds.includes(recipient.clientId);
    await write(recipient, clientMessageFor(settings, added ? null : before, after, today), data);
  }
  // Quitados de una cita que seguía activa: para ellos, la cita se canceló.
  const removedIds = beforeIds.filter((id) => !afterIds.includes(id));
  if (before && removedIds.length > 0 && settings.cancellations && ["pending", "confirmed"].includes(before.status)) {
    const beforeContext = await loadAppointmentContext(db, before);
    const cancelled: ClientMessage = { type: "appointment_cancelled", template: emailTemplates.appointmentCancelled };
    for (const recipient of beforeContext?.recipients.filter((r) => removedIds.includes(r.clientId)) ?? []) {
      await write(recipient, cancelled, buildEmailData(beforeContext!, { ...before, status: "cancelled" }));
    }
  }

  let copiedTo = "";
  const copyTo = context.professionalCopyEmail;
  const copy = copied as { message: ClientMessage; data: AppointmentEmailData } | null;
  if (copy && copyTo && !written.has(emailKey(copyTo))) {
    await queueEmail(db, {
      businessId: business.id,
      type: "appointment_copy",
      to: copyTo,
      appointmentId: after.id,
      ...copy.message.template({
        ...copy.data,
        clientName: context.clientName,
        // La canceló el paciente desde «Tu cita» (spec 010): así sabe que no fue alguien del negocio.
        professionalCopy: { agendaUrl: agendaUrlOf(after), pending: after.status === "pending", byPatient: origin === "patient_link" },
      }),
    });
    copiedTo = copyTo;
  }

  // El paciente canceló desde «Tu cita»: también se avisa al negocio (recepción), si su email no es el
  // del profesional, que ya tiene la copia (decisión del dueño del producto, 2026-10-14). Sale aunque
  // el negocio tenga apagados los emails de cancelación: esos son los del paciente.
  if (
    origin === "patient_link" &&
    after.status === "cancelled" &&
    before?.status !== "cancelled" &&
    business.email &&
    !sameEmail(business.email, context.professionalCopyEmail) &&
    !written.has(emailKey(business.email))
  ) {
    await queueEmail(db, {
      businessId: business.id,
      type: "patient_cancelled",
      to: business.email,
      appointmentId: after.id,
      ...emailTemplates.patientCancelled({ ...data, agendaUrl: agendaUrlOf(after) }),
    });
  }

  if (!before && origin === "booking_page" && business.email && !sameEmail(business.email, copiedTo)) {
    await queueEmail(db, {
      businessId: business.id,
      type: "booking_received",
      to: business.email,
      appointmentId: after.id,
      // Por verificar: el negocio tiene que revisarla y, si es la misma persona, unirla a su ficha.
      ...emailTemplates.bookingReceived({ ...data, toVerify: context.recipients.some((recipient) => recipient.toVerify) }),
    });
  }
  // El paciente nunca crea ni mueve citas: desde «Tu cita» no hay cita nueva que avisarle al profesional.
  if (origin !== "patient_link") await notifyProfessional(db, context, before, after, origin, actorUserId, copiedTo);
  return sentToClient;
}

/* ------------------------------------------------ Citas que se repiten (spec 011) -- */

/**
 * El enlace a «Tu cita» (spec 010) de cada persona en cada cita de una serie: el del principal es el
 * token del pago y el de cada otra persona de la sesión, el suyo. null si ya no está en esa cita.
 */
async function seriesLinks(db: Db, appointments: Appointment[]): Promise<(appointment: Appointment, clientId: string) => string | null> {
  const rows = await many<{ appointmentId: string; clientId: string; token: string }>(
    db,
    `select appointment_id as "appointmentId", client_id as "clientId", access_token as token
       from appointment_clients where appointment_id = any($1::uuid[])`,
    [appointments.map((appointment) => appointment.id)],
  );
  const extras = new Map(rows.map((row) => [`${row.appointmentId}:${row.clientId}`, row.token]));
  return (appointment, clientId) => {
    const token = appointment.clientId === clientId ? appointment.paymentToken : extras.get(`${appointment.id}:${clientId}`);
    return token ? appointmentPageUrl(token) : null;
  };
}

/** Las fechas de unas citas para los emails de la serie, con el enlace de cada una (o sin él). */
const seriesDatesOf = (appointments: Appointment[], urlOf: (appointment: Appointment) => string | null = () => null): SeriesEmailDate[] =>
  appointments.map((appointment) => ({
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    url: urlOf(appointment),
  }));

/**
 * Una serie de citas nueva desde el panel (spec 011, R7 y R8): en vez de un email por cita, uno solo a
 * cada paciente con todas las fechas, cada una con su enlace a «Tu cita». Como al crear una cita suelta:
 * - a cada persona de la sesión con su nombre, una vez por dirección; los datos de pago, sólo al
 *   principal; sólo con «Confirmaciones» encendido;
 * - la copia al profesional, una sola vez, con los nombres de todos y sin los enlaces de cada fecha
 *   (son del paciente); no sale si el email al paciente no salió (p. ej. lo frenó el tope diario);
 * - un solo aviso al profesional (si lo pide, no la agendó él y no le llegó ya la copia), con las fechas.
 * Los emails van con el id de la primera cita: así los encuentran la bandeja y el aviso de ntfy.
 * `appointments`: las citas creadas, en orden.
 */
export async function notifySeriesCreated(db: Db, appointments: Appointment[], actorUserId: string | null): Promise<void> {
  const [first] = appointments;
  if (!first) return;
  const context = await loadAppointmentContext(db, first);
  if (!context) return;
  const { business } = context;
  const data = buildEmailData(context, first);
  const pending = first.status === "pending";
  const written = new Set<string>();
  let sentToClient = false;

  if (business.notificationSettings.confirmations) {
    const linkOf = await seriesLinks(db, appointments);
    for (const recipient of context.recipients) {
      if (!recipient.email || written.has(emailKey(recipient.email))) continue;
      written.add(emailKey(recipient.email));
      const own = recipient.clientId === first.clientId ? {} : { payment: null };
      const queued = await queueEmail(db, {
        businessId: business.id,
        type: "appointment_series",
        to: recipient.email,
        appointmentId: first.id,
        ...emailTemplates.appointmentSeries({
          ...data,
          ...own,
          clientName: recipient.name,
          pending,
          dates: seriesDatesOf(appointments, (appointment) => linkOf(appointment, recipient.clientId)),
        }),
      });
      if (queued) sentToClient = true;
    }
  }

  let copiedTo = "";
  const copyTo = context.professionalCopyEmail;
  if (sentToClient && copyTo && !written.has(emailKey(copyTo))) {
    await queueEmail(db, {
      businessId: business.id,
      type: "appointment_copy",
      to: copyTo,
      appointmentId: first.id,
      ...emailTemplates.appointmentSeries({
        ...data,
        clientName: context.clientName,
        pending,
        dates: seriesDatesOf(appointments),
        professionalCopy: { agendaUrl: agendaUrlOf(first), pending },
      }),
    });
    copiedTo = copyTo;
  }

  if (!context.professionalEmail || !context.professionalNotify) return;
  if (actorUserId && actorUserId === context.professionalUserId) return;
  if (sameEmail(context.professionalEmail, copiedTo)) return;
  await queueEmail(db, {
    businessId: business.id,
    type: "professional_new_appointment",
    to: context.professionalEmail,
    appointmentId: first.id,
    ...emailTemplates.professionalNewAppointment({
      ...data,
      origin: "dashboard",
      agendaUrl: `${appOrigin()}/dashboard/calendar?date=${first.date}`,
      series: seriesDatesOf(appointments),
    }),
  });
}

/**
 * «Cancelar ésta y las siguientes» (spec 011, R10): un solo email a cada paciente con las fechas en que
 * está (una vez por dirección: cada cita se pudo cambiar sola) y una copia por profesional con las de su
 * agenda. Sólo con «Cancelaciones» encendido; la casilla «Avisar al paciente» la mira quien llama. La
 * copia de un profesional no sale si no salió ningún email de sus citas. `appointments`: las citas
 * canceladas, en orden.
 */
export async function notifySeriesCancelled(db: Db, appointments: Appointment[]): Promise<void> {
  const contexts: { appointment: Appointment; context: AppointmentContext }[] = [];
  for (const appointment of appointments) {
    const context = await loadAppointmentContext(db, appointment);
    if (context) contexts.push({ appointment, context });
  }
  const business = contexts[0]?.context.business;
  if (!business?.notificationSettings.cancellations) return;

  const byEmail = new Map<string, { recipient: Recipient; context: AppointmentContext; appointments: Appointment[] }>();
  for (const { appointment, context } of contexts) {
    for (const recipient of context.recipients) {
      if (!recipient.email) continue;
      const entry = byEmail.get(emailKey(recipient.email)) ?? { recipient, context, appointments: [] };
      entry.appointments.push(appointment);
      byEmail.set(emailKey(recipient.email), entry);
    }
  }
  const notified = new Set<string>();
  for (const { recipient, context, appointments: own } of byEmail.values()) {
    const queued = await queueEmail(db, {
      businessId: business.id,
      type: "appointment_series_cancelled",
      to: recipient.email,
      appointmentId: own[0].id,
      ...emailTemplates.appointmentSeriesCancelled({
        ...buildEmailData(context, own[0]),
        clientName: recipient.name,
        dates: seriesDatesOf(own),
      }),
    });
    if (queued) for (const appointment of own) notified.add(appointment.id);
  }

  const byCopy = new Map<string, { context: AppointmentContext; appointments: Appointment[]; names: string[] }>();
  for (const { appointment, context } of contexts) {
    const to = context.professionalCopyEmail;
    if (!to || !notified.has(appointment.id) || byEmail.has(emailKey(to))) continue;
    const entry = byCopy.get(emailKey(to)) ?? { context, appointments: [], names: [] };
    entry.appointments.push(appointment);
    for (const recipient of context.recipients) if (!entry.names.includes(recipient.name)) entry.names.push(recipient.name);
    byCopy.set(emailKey(to), entry);
  }
  for (const { context, appointments: own, names } of byCopy.values()) {
    await queueEmail(db, {
      businessId: business.id,
      type: "appointment_copy",
      to: context.professionalCopyEmail,
      appointmentId: own[0].id,
      ...emailTemplates.appointmentSeriesCancelled({
        ...buildEmailData(context, own[0]),
        clientName: joinNames(names),
        dates: seriesDatesOf(own),
        professionalCopy: { agendaUrl: agendaUrlOf(own[0]), pending: false },
      }),
    });
  }
}

/**
 * Recordatorios pendientes de un negocio: citas activas que empiezan dentro de las próximas
 * `reminderHoursBefore` horas y aún no tienen recordatorio para su fecha y hora actuales (al
 * reprogramar o reactivar una cita puede salir otro). No salen:
 * - en las horas de silencio del negocio (21:00 a 7:00): a las 7:00 salen los de las citas que aún
 *   no empezaron;
 * - si la cita se agendó, se movió o se reactivó ya dentro de esas horas y el negocio envía
 *   confirmaciones: el paciente acaba de recibir la confirmación o el aviso del cambio.
 * Si sale alguno, el profesional recibe la copia (decisión del usuario, 2026-10-13): una por cita y
 * versión, con los nombres de todos, salvo que su email sea el de uno de los pacientes.
 * Lo ejecutan el cron (scripts/cron.ts) y, en local, src/jobs/reminders.ts. `at`: el momento (pruebas).
 */
export async function runReminderJob(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  if (!business || business.status !== "active" || !business.notificationSettings.reminders) return 0;

  const now = getZonedNow(business.timezone, at);
  if (isQuietTime(now)) return 0;
  const settings = business.notificationSettings;
  const windowMinutes = settings.reminderHoursBefore * 60;
  const lastDate = addDaysISO(now.date, Math.ceil(windowMinutes / 1440) + 1);
  const candidates = await many<Appointment & { reminderKey: string; scheduledAt: string }>(
    db,
    `select ${appointmentColumns("a")}, ${reminderKeySql("a")} as "reminderKey", a.scheduled_at as "scheduledAt"
       from appointments a
      where a.business_id = $1
        and a.status in ('pending', 'confirmed')
        and a.date between $2 and $3
        and (not exists (select 1 from notifications n where n.dedupe_key = ${reminderKeySql("a")})
             or exists (select 1 from appointment_clients ac
                         where ac.appointment_id = a.id
                           and not exists (select 1 from notifications n
                                            where n.dedupe_key = ${reminderKeySql("a")} || ':' || ac.client_id)))`,
    [businessId, now.date, lastDate],
  );

  let sent = 0;
  for (const { reminderKey, scheduledAt, ...appointment } of candidates) {
    const minutesUntil = minutesUntilStart(appointment.date, appointment.startTime, now);
    if (minutesUntil <= 0 || minutesUntil > windowMinutes) continue;
    // Faltaban menos de `reminderHoursBefore` horas cuando se fijó la fecha y hora.
    const minutesSinceScheduled = (at.getTime() - Date.parse(scheduledAt)) / 60_000;
    if (settings.confirmations && minutesUntil + minutesSinceScheduled <= windowMinutes) continue;

    const context = await loadAppointmentContext(db, appointment);
    if (!context) continue;
    const when = appointment.date === now.date ? "hoy" : appointment.date === addDaysISO(now.date, 1) ? "mañana" : null;
    const data = buildEmailData(context, appointment);
    const written = new Set<string>();
    let reminded = false;
    for (const recipient of context.recipients) {
      if (!recipient.email || written.has(emailKey(recipient.email))) continue;
      written.add(emailKey(recipient.email));
      const inserted = await queueEmail(db, {
        businessId,
        type: "appointment_reminder",
        to: recipient.email,
        appointmentId: appointment.id,
        dedupeKey: reminderKeyFor(reminderKey, appointment, recipient.clientId),
        // Su enlace a «Tu cita», con «Confirmo que voy» (spec 010). Con los ajustes de fábrica (recordatorio
        // y antelación de 24 h) ya no está en plazo para cancelar: dice «Ver mi cita».
        ...emailTemplates.appointmentReminder(
          { ...data, clientName: recipient.name, appointmentPage: appointmentPageFor(recipient, appointment, business, minutesUntil) },
          when,
        ),
      });
      if (inserted) {
        sent++;
        reminded = true;
      }
    }
    // La clave única evita una segunda copia si después se agrega un paciente y le sale su recordatorio.
    const copyTo = context.professionalCopyEmail;
    if (reminded && copyTo && !written.has(emailKey(copyTo))) {
      await queueEmail(db, {
        businessId,
        type: "appointment_copy",
        to: copyTo,
        appointmentId: appointment.id,
        dedupeKey: reminderCopyKey(reminderKey),
        ...emailTemplates.appointmentReminder(
          { ...data, professionalCopy: { agendaUrl: agendaUrlOf(appointment), pending: appointment.status === "pending" } },
          when,
        ),
      });
    }
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
    const rows = await many<{
      time: string;
      clientName: string;
      extraNames: string[];
      serviceName: string;
      homeVisit: Appointment["homeVisit"];
      isVirtual: boolean;
    }>(
      db,
      `select to_char(a.start_time, 'HH24:MI') || '–' || to_char(a.end_time, 'HH24:MI') as time,
              c.name as "clientName", s.name as "serviceName", a.home_visit as "homeVisit", a.is_virtual as "isVirtual",
              coalesce((select array_agg(ec.name order by ac.created_at, ac.client_id)
                          from appointment_clients ac join clients ec on ec.id = ac.client_id
                         where ac.appointment_id = a.id), '{}') as "extraNames"
         from appointments a join clients c on c.id = a.client_id join services s on s.id = a.service_id
        where a.professional_id = $1 and a.date = $2 and a.status in ('pending', 'confirmed')
        order by a.start_time`,
      [professional.id, now.date],
    );
    if (rows.length === 0) continue;
    const appointments = rows.map(({ extraNames, ...row }) => ({ ...row, clientName: joinNames([row.clientName, ...extraNames]) }));
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
