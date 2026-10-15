import { many, type Db } from "../db/pool.ts";
import { SERIES_FREQUENCY_LABELS } from "../shared/lib/appointment-series.ts";
import { formatPrice, formatShortDate, plural } from "../shared/lib/format.ts";
import { ROLE_LABELS } from "../shared/lib/permissions.ts";
import type { Appointment, AppointmentSeriesFrequency, BusinessRole, EmailType } from "../shared/types/index.ts";
import { scrubEmails } from "./mailer.ts";
import { maskEmail, maskPhone, shortName } from "./masking.ts";

/** Al final del resumen de un cambio de estado hecho sin avisar al paciente (spec 008): lo escribe el servicio de citas y lo lee el aviso de ntfy. */
export const WITHOUT_NOTICE = " (sin avisar al paciente)";

/**
 * Aviso por ntfy de cada reserva desde la página pública (lo pidió el usuario, 2026-10-12). Lo envía
 * el cron de GitHub en su pasada (cada 10 minutos): así no hace falta NTFY_TOPIC en Vercel ni en
 * Lambda. Lleva lo importante de la cita y a quién salieron sus emails; los datos del paciente, a
 * medias (ver masking.ts). El título no nombra el negocio: el registro de Actions es público y guarda
 * el título de cada aviso (ver scripts/notify.ts).
 */

/** Para quién es cada email de una reserva online. */
const EMAIL_ROLES: Partial<Record<EmailType, string>> = {
  booking_created: "Al paciente",
  appointment_confirmed: "Al paciente",
  appointment_copy: "Copia al profesional",
  booking_received: "Aviso al negocio",
  professional_new_appointment: "Aviso al profesional",
  appointment_series: "Al paciente",
};

const PLACE_LABELS = { business: "en el local", virtual: "virtual", home: "a domicilio" } as const;

/** Reservas detalladas por pasada del cron; de las demás sólo se dice cuántas son. */
export const MAX_BOOKING_NOTICES = 10;

export interface OnlineBooking {
  businessId: string;
  businessName: string;
  currency: string;
  serviceName: string;
  durationMinutes: number;
  /** Lo que paga el paciente (con el recargo a domicilio); 0 = gratis. */
  price: number;
  professionalName: string | null;
  date: string;
  startTime: string;
  place: keyof typeof PLACE_LABELS;
  status: Appointment["status"];
  /**
   * Las personas de la reserva: quien reservó primero y, en una sesión en pareja o en familia, las
   * demás. `newClient`: se creó con esta reserva (no estaba en el negocio). `toVerify`: «Por
   * verificar» (spec 009), escribió la cédula de otra ficha con otros datos.
   */
  clients: { name: string; email: string; phone: string; newClient: boolean; toVerify?: boolean }[];
  /** Los emails de la reserva y cómo están: `reason`, por qué no salió (un tope diario, un fallo). */
  emails: { type: EmailType; to: string; status: "queued" | "sent" | "failed"; reason: string | null }[];
}

/** El aviso de ntfy de una reserva (la forma de Notice en scripts/notify.ts). */
export interface BookingNotice {
  title: string;
  message: string;
  priority: 3;
  tags: string[];
  click: string;
}

function describeEmailStatus(email: OnlineBooking["emails"][number]): string {
  if (email.status === "sent") return "";
  if (email.status === "queued") return " (en cola)";
  const reason = scrubEmails(email.reason ?? "").replace(/^No enviado:\s*/i, "").slice(0, 120);
  return reason ? ` (no salió: ${reason})` : " (no salió)";
}

export function onlineBookingNotice(booking: OnlineBooking): BookingNotice {
  const patients = booking.clients.map((client) => {
    const patient = [shortName(client.name), client.email && maskEmail(client.email), maskPhone(client.phone)].filter(Boolean).join(" · ");
    const verify = client.toVerify ? " · Por verificar (la cédula es de un paciente con otros datos)" : "";
    return `${client.newClient ? "Paciente nuevo" : "Ya era paciente"}: ${patient}${verify}`;
  });
  const emails = booking.emails
    .filter((email) => EMAIL_ROLES[email.type])
    .map((email) => `• ${EMAIL_ROLES[email.type]} → ${maskEmail(email.to)}${describeEmailStatus(email)}`);
  return {
    title: "Agenda360: nueva reserva",
    message: [
      `${booking.businessName} · ${formatShortDate(booking.date)} ${booking.startTime}`,
      ...patients,
      `${booking.serviceName} · ${booking.durationMinutes} min · ${booking.price > 0 ? formatPrice(booking.price, booking.currency) : "gratis"}`,
      [booking.professionalName && `Con ${booking.professionalName}`, PLACE_LABELS[booking.place]].filter(Boolean).join(" · "),
      booking.status === "pending" ? "Pendiente de confirmar" : booking.status === "confirmed" ? "Confirmada" : "Ya cancelada",
      "",
      ...(emails.length > 0 ? ["Emails:", ...emails] : ["Sin emails (el negocio tiene apagadas las confirmaciones)."]),
    ].join("\n"),
    priority: 3,
    tags: ["calendar"],
    click: `/admin/businesses/${booking.businessId}`,
  };
}

/**
 * Las reservas por la página creadas en (since, until], las más antiguas primero (hasta `limit`), y
 * cuántas son en total. Sin `since` (la primera pasada), las del último día. Un paciente es nuevo si
 * se creó con la reserva: misma transacción, mismo instante. Con las otras personas de una sesión en
 * pareja o en familia, en el orden en que se muestran.
 */
export async function findOnlineBookings(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_BOOKING_NOTICES,
): Promise<{ bookings: OnlineBooking[]; total: number }> {
  const rows = await many<{
    id: string;
    total: number;
    businessId: string;
    businessName: string;
    currency: string;
    serviceName: string;
    durationMinutes: number;
    price: string;
    professionalName: string | null;
    date: string;
    startTime: string;
    isVirtual: boolean;
    homeVisit: boolean;
    status: Appointment["status"];
    newClient: boolean;
    toVerify: boolean;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    extraClients: OnlineBooking["clients"];
  }>(
    db,
    `select a.id, count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", b.currency,
            s.name as "serviceName", s.duration_minutes as "durationMinutes", a.price, p.display_name as "professionalName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime",
            a.is_virtual as "isVirtual", a.home_visit is not null as "homeVisit", a.status,
            (c.source = 'booking_page' and c.created_at = a.created_at) as "newClient",
            c.claimed_client_id is not null as "toVerify",
            c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone",
            coalesce((select json_agg(json_build_object('name', ec.name, 'email', ec.email, 'phone', ec.phone,
                                                        'newClient', ec.source = 'booking_page' and ec.created_at = a.created_at,
                                                        'toVerify', ec.claimed_client_id is not null)
                                      order by ac.created_at, ac.client_id)
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '[]') as "extraClients"
       from appointments a
       join businesses b on b.id = a.business_id
       join services s on s.id = a.service_id
       join clients c on c.id = a.client_id
       left join professionals p on p.id = a.professional_id
      where a.source = 'booking_page'
        and a.created_at > coalesce($1::timestamptz, now() - interval '1 day') and a.created_at <= $2
      order by a.created_at
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { bookings: [], total: 0 };
  const emails = await many<{ appointmentId: string } & OnlineBooking["emails"][number]>(
    db,
    `select appointment_id as "appointmentId", type, to_email as "to", status, case when status = 'failed' then last_error end as reason
       from notifications where appointment_id = any($1::uuid[]) order by created_at`,
    [rows.map((row) => row.id)],
  );
  const bookings = rows.map(
    (row): OnlineBooking => ({
      businessId: row.businessId,
      businessName: row.businessName,
      currency: row.currency,
      serviceName: row.serviceName,
      durationMinutes: row.durationMinutes,
      price: Number(row.price),
      professionalName: row.professionalName,
      date: row.date,
      startTime: row.startTime,
      place: row.isVirtual ? "virtual" : row.homeVisit ? "home" : "business",
      status: row.status,
      clients: [
        { name: row.clientName, email: row.clientEmail, phone: row.clientPhone, newClient: row.newClient, toVerify: row.toVerify },
        ...row.extraClients,
      ],
      emails: emails.filter((email) => email.appointmentId === row.id).map(({ appointmentId: _id, ...email }) => email),
    }),
  );
  return { bookings, total: rows[0].total };
}

/* --------------------------------------------- Pacientes nuevos del panel -- */

/**
 * Aviso por ntfy de cada paciente que se registra desde el panel (lo pidió el usuario, 2026-10-13):
 * quién lo registró y el paciente, a medias. Los que crea la página de reservas ya salen en el aviso
 * de su reserva («Paciente nuevo»). Lo envía el cron, como los de las reservas.
 */
export const MAX_CLIENT_NOTICES = 10;

export interface PanelClient {
  businessId: string;
  businessName: string;
  name: string;
  email: string;
  phone: string;
  /** Quién lo registró (null: no se sabe, p. ej. su usuario ya no existe). */
  createdBy: PanelActor;
}

/** Quién hizo algo desde el panel (no es dato del paciente): " por Ana T. (Profesional)". */
type PanelActor = { name: string; role: BusinessRole | null; superAdmin: boolean } | null;

function byWhom(by: PanelActor): string {
  if (!by) return "";
  if (by.superAdmin && !by.role) return " por el super admin (modo soporte)";
  return ` por ${shortName(by.name)}${by.role ? ` (${ROLE_LABELS[by.role]})` : ""}`;
}

/** El paciente a medias: "Juan P. · ju***@gmail.com · 099***5555". */
const maskedPatient = (client: { name: string; email: string; phone: string }) =>
  [shortName(client.name), client.email && maskEmail(client.email), maskPhone(client.phone)].filter(Boolean).join(" · ");

export function newClientNotice(client: PanelClient): BookingNotice {
  return {
    title: "Agenda360: nuevo paciente",
    message: [client.businessName, `Paciente nuevo: ${maskedPatient(client)}`, `Registrado desde el panel${byWhom(client.createdBy)}`].join("\n"),
    priority: 3,
    tags: ["bust_in_silhouette"],
    click: `/admin/businesses/${client.businessId}`,
  };
}

/**
 * Los pacientes registrados desde el panel en (since, until], los más antiguos primero (hasta
 * `limit`), y cuántos son en total. Sin `since` (la primera pasada), los del último día. Sólo los de
 * `source = 'dashboard'`: los de una importación (spec 012, `'import'`) no salen uno por uno, sino en un
 * solo aviso por importación (ver findClientImports).
 */
export async function findPanelClients(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_CLIENT_NOTICES,
): Promise<{ clients: PanelClient[]; total: number }> {
  const rows = await many<{
    total: number;
    businessId: string;
    businessName: string;
    name: string;
    email: string;
    phone: string;
    creatorName: string | null;
    creatorRole: BusinessRole | null;
    superAdmin: boolean | null;
  }>(
    db,
    `select count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", c.name, c.email, c.phone,
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "creatorName", bu.role as "creatorRole",
            u.platform_role = 'super_admin' as "superAdmin"
       from clients c
       join businesses b on b.id = c.business_id
       left join users u on u.id = c.created_by
       left join business_users bu on bu.business_id = c.business_id and bu.user_id = c.created_by
      where c.source = 'dashboard'
        and c.created_at > coalesce($1::timestamptz, now() - interval '1 day') and c.created_at <= $2
      order by c.created_at
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { clients: [], total: 0 };
  return {
    clients: rows.map((row) => ({
      businessId: row.businessId,
      businessName: row.businessName,
      name: row.name,
      email: row.email,
      phone: row.phone,
      createdBy:
        row.creatorName === null && !row.superAdmin
          ? null
          : { name: row.creatorName ?? "", role: row.creatorRole, superAdmin: Boolean(row.superAdmin) },
    })),
    total: rows[0].total,
  };
}

/* ------------------------------------------------ Citas agendadas del panel -- */

/**
 * Aviso por ntfy de cada cita que se agenda desde el panel (lo pidió el usuario, 2026-10-13): lo
 * mismo que el de una reserva por la página, con quién la agendó. Las de la página ya tienen el suyo.
 */
export const MAX_APPOINTMENT_NOTICES = 10;

export interface PanelAppointment extends Omit<OnlineBooking, "clients"> {
  /** Los pacientes de la cita: el principal primero y, en una sesión en pareja o en familia, los demás. */
  clients: { name: string; email: string; phone: string }[];
  /** Quién la agendó (null: no se sabe). */
  createdBy: PanelActor;
}

const STATUS_LINES: Record<Appointment["status"], string> = {
  pending: "Pendiente de confirmar",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
  cancelled: "Ya cancelada",
};

export function panelAppointmentNotice(appointment: PanelAppointment): BookingNotice {
  const emails = appointment.emails
    .filter((email) => EMAIL_ROLES[email.type])
    .map((email) => `• ${EMAIL_ROLES[email.type]} → ${maskEmail(email.to)}${describeEmailStatus(email)}`);
  return {
    title: "Agenda360: nueva cita",
    message: [
      `${appointment.businessName} · ${formatShortDate(appointment.date)} ${appointment.startTime}`,
      ...appointment.clients.map((client) => `Paciente: ${maskedPatient(client)}`),
      `${appointment.serviceName} · ${appointment.durationMinutes} min · ${appointment.price > 0 ? formatPrice(appointment.price, appointment.currency) : "gratis"}`,
      [appointment.professionalName && `Con ${appointment.professionalName}`, PLACE_LABELS[appointment.place]].filter(Boolean).join(" · "),
      STATUS_LINES[appointment.status],
      `Agendada desde el panel${byWhom(appointment.createdBy)}`,
      "",
      ...(emails.length > 0 ? ["Emails:", ...emails] : ["Sin emails (el paciente no tiene email o el negocio tiene apagados esos avisos)."]),
    ].join("\n"),
    priority: 3,
    tags: ["date"],
    click: `/admin/businesses/${appointment.businessId}`,
  };
}

/**
 * Las citas agendadas desde el panel en (since, until], las más antiguas primero (hasta `limit`), y
 * cuántas son en total. Sin `since` (la primera pasada), las del último día. Quién la agendó sale de
 * su registro de actividad (appointment.created). Las de una serie (spec 011) no tienen aviso propio:
 * la serie tiene uno solo (findPanelSeries).
 */
export async function findPanelAppointments(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_APPOINTMENT_NOTICES,
): Promise<{ appointments: PanelAppointment[]; total: number }> {
  const rows = await many<{
    id: string;
    total: number;
    businessId: string;
    businessName: string;
    currency: string;
    serviceName: string;
    durationMinutes: number;
    price: string;
    professionalName: string | null;
    date: string;
    startTime: string;
    isVirtual: boolean;
    homeVisit: boolean;
    status: Appointment["status"];
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    extraClients: PanelAppointment["clients"];
    creatorName: string | null;
    creatorRole: BusinessRole | null;
    superAdmin: boolean | null;
  }>(
    db,
    `select a.id, count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", b.currency,
            s.name as "serviceName", s.duration_minutes as "durationMinutes", a.price, p.display_name as "professionalName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime",
            a.is_virtual as "isVirtual", a.home_visit is not null as "homeVisit", a.status,
            c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone",
            coalesce((select json_agg(json_build_object('name', ec.name, 'email', ec.email, 'phone', ec.phone)
                                      order by ac.created_at, ac.client_id)
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '[]') as "extraClients",
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "creatorName", bu.role as "creatorRole",
            u.platform_role = 'super_admin' as "superAdmin"
       from appointments a
       join businesses b on b.id = a.business_id
       join services s on s.id = a.service_id
       join clients c on c.id = a.client_id
       left join professionals p on p.id = a.professional_id
       left join lateral (select l.actor_id from audit_logs l
                           where l.business_id = a.business_id and l.entity_id = a.id and l.action = 'appointment.created'
                           order by l.created_at limit 1) created on true
       left join users u on u.id = created.actor_id
       left join business_users bu on bu.business_id = a.business_id and bu.user_id = created.actor_id
      where a.source = 'dashboard' and a.series_id is null
        and a.created_at > coalesce($1::timestamptz, now() - interval '1 day') and a.created_at <= $2
      order by a.created_at
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { appointments: [], total: 0 };
  const emails = await many<{ appointmentId: string } & OnlineBooking["emails"][number]>(
    db,
    `select appointment_id as "appointmentId", type, to_email as "to", status, case when status = 'failed' then last_error end as reason
       from notifications where appointment_id = any($1::uuid[]) order by created_at`,
    [rows.map((row) => row.id)],
  );
  const appointments = rows.map(
    (row): PanelAppointment => ({
      businessId: row.businessId,
      businessName: row.businessName,
      currency: row.currency,
      serviceName: row.serviceName,
      durationMinutes: row.durationMinutes,
      price: Number(row.price),
      professionalName: row.professionalName,
      date: row.date,
      startTime: row.startTime,
      place: row.isVirtual ? "virtual" : row.homeVisit ? "home" : "business",
      status: row.status,
      clients: [{ name: row.clientName, email: row.clientEmail, phone: row.clientPhone }, ...row.extraClients],
      createdBy:
        row.creatorName === null && !row.superAdmin
          ? null
          : { name: row.creatorName ?? "", role: row.creatorRole, superAdmin: Boolean(row.superAdmin) },
      emails: emails.filter((email) => email.appointmentId === row.id).map(({ appointmentId: _id, ...email }) => email),
    }),
  );
  return { appointments, total: rows[0].total };
}

/* ------------------------------------- Series de citas del panel (spec 011) -- */

/** Series detalladas por pasada del cron (creadas y canceladas, cada una); de las demás sólo se dice cuántas son. */
export const MAX_SERIES_NOTICES = 10;

/** Una serie de citas agendada desde el panel: los datos de su primera cita, sus fechas y sus emails. */
export interface PanelSeries extends Omit<PanelAppointment, "date" | "startTime"> {
  frequency: AppointmentSeriesFrequency;
  /** Las fechas de la lista y las citas que se crearon. */
  requested: number;
  created: number;
  first: { date: string; startTime: string };
  last: { date: string; startTime: string };
}

/**
 * Aviso por ntfy de una serie de citas del panel (R11): uno por serie, no uno por cita. Lo mismo que el
 * de una cita del panel, con las fechas y cuántas no se crearon. El paciente, a medias; el título no
 * nombra al negocio.
 */
export function panelSeriesNotice(series: PanelSeries): BookingNotice {
  const emails = series.emails
    .filter((email) => EMAIL_ROLES[email.type])
    .map((email) => `• ${EMAIL_ROLES[email.type]} → ${maskEmail(email.to)}${describeEmailStatus(email)}`);
  const missing = series.requested - series.created;
  return {
    title: "Agenda360: nueva serie de citas",
    message: [
      `${series.businessName} · serie de ${plural(series.created, "cita", "citas")} desde el panel`,
      `${SERIES_FREQUENCY_LABELS[series.frequency]} · ${formatShortDate(series.first.date)} ${series.first.startTime} → ${formatShortDate(series.last.date)} ${series.last.startTime}`,
      ...series.clients.map((client) => `Paciente: ${maskedPatient(client)}`),
      `${series.serviceName} · ${series.durationMinutes} min · ${series.price > 0 ? formatPrice(series.price, series.currency) : "gratis"}`,
      [series.professionalName && `Con ${series.professionalName}`, PLACE_LABELS[series.place]].filter(Boolean).join(" · "),
      STATUS_LINES[series.status],
      ...(missing > 0 ? [missing === 1 ? "1 fecha no se creó" : `${missing} fechas no se crearon`] : []),
      `Agendada desde el panel${byWhom(series.createdBy)}`,
      "",
      ...(emails.length > 0 ? ["Emails:", ...emails] : ["Sin emails (el paciente no tiene email o el negocio tiene apagados esos avisos)."]),
    ].join("\n"),
    priority: 3,
    tags: ["repeat"],
    click: `/admin/businesses/${series.businessId}`,
  };
}

/**
 * Las series agendadas desde el panel en (since, until], las más antiguas primero (hasta `limit`), y
 * cuántas son en total, por `appointment_series.created_at`. Sin `since` (la primera pasada), las del
 * último día. Los emails son los de su primera cita puestos en cola en la misma transacción.
 */
export async function findPanelSeries(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_SERIES_NOTICES,
): Promise<{ series: PanelSeries[]; total: number }> {
  const rows = await many<{
    id: string;
    appointmentId: string;
    createdAt: string;
    total: number;
    businessId: string;
    businessName: string;
    currency: string;
    frequency: AppointmentSeriesFrequency;
    requested: number;
    created: number;
    serviceName: string;
    durationMinutes: number;
    price: string;
    professionalName: string | null;
    firstDate: string;
    firstTime: string;
    lastDate: string;
    lastTime: string;
    isVirtual: boolean;
    homeVisit: boolean;
    status: Appointment["status"];
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    extraClients: PanelSeries["clients"];
    creatorName: string | null;
    creatorRole: BusinessRole | null;
    superAdmin: boolean | null;
  }>(
    db,
    `select s.id, a.id as "appointmentId", s.created_at as "createdAt", count(*) over ()::int as total,
            b.id as "businessId", b.name as "businessName", b.currency,
            s.frequency, s.requested_count as requested, s.created_count as created,
            sv.name as "serviceName", sv.duration_minutes as "durationMinutes", a.price, p.display_name as "professionalName",
            to_char(a.date, 'YYYY-MM-DD') as "firstDate", to_char(a.start_time, 'HH24:MI') as "firstTime",
            to_char(z.date, 'YYYY-MM-DD') as "lastDate", to_char(z.start_time, 'HH24:MI') as "lastTime",
            a.is_virtual as "isVirtual", a.home_visit is not null as "homeVisit", a.status,
            c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone",
            coalesce((select json_agg(json_build_object('name', ec.name, 'email', ec.email, 'phone', ec.phone)
                                      order by ac.created_at, ac.client_id)
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '[]') as "extraClients",
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "creatorName", bu.role as "creatorRole",
            u.platform_role = 'super_admin' as "superAdmin"
       from appointment_series s
       join businesses b on b.id = s.business_id
       join lateral (select x.* from appointments x where x.series_id = s.id order by x.series_index limit 1) a on true
       join lateral (select x.date, x.start_time from appointments x where x.series_id = s.id order by x.series_index desc limit 1) z on true
       join services sv on sv.id = a.service_id
       join clients c on c.id = a.client_id
       left join professionals p on p.id = a.professional_id
       left join users u on u.id = s.created_by
       left join business_users bu on bu.business_id = s.business_id and bu.user_id = s.created_by
      where s.created_at > coalesce($1::timestamptz, now() - interval '1 day') and s.created_at <= $2
      order by s.created_at
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { series: [], total: 0 };
  const emails = await many<{ appointmentId: string; createdAt: string } & OnlineBooking["emails"][number]>(
    db,
    `select appointment_id as "appointmentId", created_at as "createdAt", type, to_email as "to", status,
            case when status = 'failed' then last_error end as reason
       from notifications where appointment_id = any($1::uuid[]) order by created_at, id`,
    [rows.map((row) => row.appointmentId)],
  );
  const series = rows.map(
    (row): PanelSeries => ({
      businessId: row.businessId,
      businessName: row.businessName,
      currency: row.currency,
      serviceName: row.serviceName,
      durationMinutes: row.durationMinutes,
      price: Number(row.price),
      professionalName: row.professionalName,
      place: row.isVirtual ? "virtual" : row.homeVisit ? "home" : "business",
      status: row.status,
      frequency: row.frequency,
      requested: row.requested,
      created: row.created,
      first: { date: row.firstDate, startTime: row.firstTime },
      last: { date: row.lastDate, startTime: row.lastTime },
      clients: [{ name: row.clientName, email: row.clientEmail, phone: row.clientPhone }, ...row.extraClients],
      createdBy:
        row.creatorName === null && !row.superAdmin
          ? null
          : { name: row.creatorName ?? "", role: row.creatorRole, superAdmin: Boolean(row.superAdmin) },
      emails: emails
        .filter((email) => email.appointmentId === row.appointmentId && email.createdAt === row.createdAt)
        .map(({ appointmentId: _id, createdAt: _at, ...email }) => email),
    }),
  );
  return { series, total: rows[0].total };
}

/** «Cancelar ésta y las siguientes» de una serie (spec 011): cuántas, desde cuándo, quién y sus emails. */
export interface SeriesCancellation {
  businessId: string;
  businessName: string;
  serviceName: string;
  count: number;
  first: { date: string; startTime: string };
  clients: { name: string; email: string; phone: string }[];
  by: PanelActor;
  /** Se desmarcó «Avisar al paciente» (spec 008). */
  withoutNotice: boolean;
  emails: OnlineBooking["emails"];
}

/**
 * Aviso por ntfy de «Cancelar ésta y las siguientes» (R11): uno solo, no un cambio de estado por cada
 * cita. El paciente, a medias; el título no nombra al negocio.
 */
export function seriesCancelledNotice(cancellation: SeriesCancellation): BookingNotice {
  const emails = cancellation.emails.map(
    (email) => `• ${STATUS_EMAIL_ROLES[email.type] ?? "Al paciente"} → ${maskEmail(email.to)}${describeEmailStatus(email)}`,
  );
  return {
    title: "Agenda360: serie de citas cancelada",
    message: [
      `${cancellation.businessName} · ${plural(cancellation.count, "cita cancelada", "citas canceladas")} desde ${formatShortDate(cancellation.first.date)} ${cancellation.first.startTime}`,
      ...cancellation.clients.map((client) => `Paciente: ${maskedPatient(client)}`),
      cancellation.serviceName,
      `Cancelada desde el panel${byWhom(cancellation.by)}`,
      "",
      ...(cancellation.withoutNotice
        ? ["Sin avisar al paciente (se desmarcó la casilla)."]
        : emails.length > 0
          ? ["Emails:", ...emails]
          : ["Sin emails (el paciente no tiene email o el negocio tiene apagados esos avisos)."]),
    ].join("\n"),
    priority: 3,
    tags: ["arrows_counterclockwise"],
    click: `/admin/businesses/${cancellation.businessId}`,
  };
}

/**
 * Las series canceladas («ésta y las siguientes») en (since, until], las más antiguas primero (hasta
 * `limit`), y cuántas son en total. Salen de su entrada de actividad (`appointment.series_cancelled`,
 * con el id de la serie): las fechas, de su fila «Citas canceladas»; el paciente y el servicio, de la
 * primera cita cancelada (la que se guardó en ese instante); los emails, los de esas citas en ese instante.
 */
export async function findSeriesCancellations(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_SERIES_NOTICES,
): Promise<{ cancellations: SeriesCancellation[]; total: number }> {
  const rows = await many<{
    total: number;
    businessId: string;
    businessName: string;
    serviceName: string;
    date: string;
    startTime: string;
    dates: string | null;
    summary: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    extraClients: SeriesCancellation["clients"];
    actorName: string | null;
    actorRole: BusinessRole | null;
    superAdmin: boolean | null;
    emails: OnlineBooking["emails"];
  }>(
    db,
    `select count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", sv.name as "serviceName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime",
            (select ch->>'after' from jsonb_array_elements(l.changes) ch where ch->>'label' = 'Citas canceladas' limit 1) as dates,
            l.summary, c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone",
            coalesce((select json_agg(json_build_object('name', ec.name, 'email', ec.email, 'phone', ec.phone)
                                      order by ac.created_at, ac.client_id)
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '[]') as "extraClients",
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "actorName", bu.role as "actorRole",
            u.platform_role = 'super_admin' as "superAdmin",
            coalesce((select json_agg(json_build_object('type', n.type, 'to', n.to_email, 'status', n.status,
                                                        'reason', case when n.status = 'failed' then n.last_error end)
                                      order by n.created_at, n.id)
                        from notifications n join appointments x on x.id = n.appointment_id
                       where x.series_id = l.entity_id and n.created_at = l.created_at), '[]') as emails
       from audit_logs l
       join businesses b on b.id = l.business_id
       join lateral (select x.* from appointments x where x.series_id = l.entity_id
                      order by (x.updated_at = l.created_at) desc, x.series_index limit 1) a on true
       join services sv on sv.id = a.service_id
       join clients c on c.id = a.client_id
       left join users u on u.id = l.actor_id
       left join business_users bu on bu.business_id = l.business_id and bu.user_id = l.actor_id
      where l.action = 'appointment.series_cancelled'
        and l.created_at > coalesce($1::timestamptz, now() - interval '1 day') and l.created_at <= $2
      order by l.created_at, l.id
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { cancellations: [], total: 0 };
  return {
    cancellations: rows.map(
      (row): SeriesCancellation => ({
        businessId: row.businessId,
        businessName: row.businessName,
        serviceName: row.serviceName,
        count: row.dates ? row.dates.split(", ").length : 1,
        first: { date: row.date, startTime: row.startTime },
        clients: [{ name: row.clientName, email: row.clientEmail, phone: row.clientPhone }, ...row.extraClients],
        by:
          row.actorName === null && !row.superAdmin
            ? null
            : { name: row.actorName ?? "", role: row.actorRole, superAdmin: Boolean(row.superAdmin) },
        withoutNotice: row.summary.endsWith(WITHOUT_NOTICE),
        emails: row.emails,
      }),
    ),
    total: rows[0].total,
  };
}

/* ------------------------------ Cambios de estado ----------------------------- */

/** Cambios de estado detallados por pasada del cron; de los demás sólo se dice cuántos son. */
export const MAX_STATUS_NOTICES = 10;

export interface StatusChange {
  businessId: string;
  businessName: string;
  serviceName: string;
  date: string;
  startTime: string;
  /** Los estados como los muestra el panel ("Confirmada", "Pendiente"…), de su registro de actividad. */
  from: string;
  to: string;
  clients: { name: string; email: string; phone: string }[];
  by: PanelActor;
  /** El que lo hizo desmarcó «Avisar al paciente» (spec 008). */
  withoutNotice: boolean;
  /** Lo canceló el paciente desde «Tu cita», el enlace de sus emails (spec 010). */
  byPatient: boolean;
  /** Los emails que salieron con ese cambio (en la misma transacción). */
  emails: OnlineBooking["emails"];
}

const STATUS_TITLES: Record<string, string> = {
  Pendiente: "cita pendiente de confirmar",
  Confirmada: "cita confirmada",
  Completada: "cita completada",
  Cancelada: "cita cancelada",
  "No asistió": "el paciente no asistió",
};

/** Para quién es cada email de un cambio de estado: los demás son al paciente. */
const STATUS_EMAIL_ROLES: Partial<Record<EmailType, string>> = {
  appointment_copy: "Copia al profesional",
  patient_cancelled: "Aviso al negocio",
};

/**
 * Aviso por ntfy de un cambio de estado de una cita (spec 008, lo pidió el dueño del producto): de
 * qué estado a cuál, quién lo hizo y a quién salieron los emails. El paciente, a medias; el título
 * no nombra al negocio. Si la canceló el paciente desde su email (spec 010), lo dice el título.
 */
export function statusChangeNotice(change: StatusChange): BookingNotice {
  const emails = change.emails.map(
    (email) => `• ${STATUS_EMAIL_ROLES[email.type] ?? "Al paciente"} → ${maskEmail(email.to)}${describeEmailStatus(email)}`,
  );
  return {
    title: change.byPatient
      ? "Agenda360: cita cancelada por el paciente"
      : `Agenda360: ${STATUS_TITLES[change.to] ?? "cambio de estado de una cita"}`,
    message: [
      `${change.businessName} · ${formatShortDate(change.date)} ${change.startTime}`,
      ...change.clients.map((client) => `Paciente: ${maskedPatient(client)}`),
      change.serviceName,
      `De ${change.from} a ${change.to}`,
      change.byPatient ? "Cancelada por el paciente desde su email" : `Cambiado desde el panel${byWhom(change.by)}`,
      "",
      ...(change.withoutNotice
        ? ["Sin avisar al paciente (se desmarcó la casilla)."]
        : emails.length > 0
          ? ["Emails:", ...emails]
          : ["Sin emails (el paciente no tiene email o el negocio tiene apagados esos avisos)."]),
    ].join("\n"),
    priority: 3,
    tags: ["arrows_counterclockwise"],
    click: `/admin/businesses/${change.businessId}`,
  };
}

/**
 * Los cambios de estado de citas en (since, until], los más antiguos primero (hasta `limit`), y
 * cuántos son en total. Salen del registro de actividad: los botones de estado, el formulario de la
 * cita y la cancelación desde «Tu cita» (spec 010) guardan «Estado» en `changes`. «Confirmo que voy»
 * no lo guarda: no avisa. Sin `since` (la primera pasada), los del último día.
 */
export async function findStatusChanges(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_STATUS_NOTICES,
): Promise<{ changes: StatusChange[]; total: number }> {
  const rows = await many<{
    total: number;
    businessId: string;
    businessName: string;
    serviceName: string;
    date: string;
    startTime: string;
    from: string | null;
    to: string | null;
    summary: string;
    action: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    extraClients: StatusChange["clients"];
    actorName: string | null;
    actorRole: BusinessRole | null;
    superAdmin: boolean | null;
    emails: OnlineBooking["emails"];
  }>(
    db,
    `select count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", s.name as "serviceName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime",
            (select ch->>'before' from jsonb_array_elements(l.changes) ch where ch->>'label' = 'Estado' limit 1) as "from",
            (select ch->>'after' from jsonb_array_elements(l.changes) ch where ch->>'label' = 'Estado' limit 1) as "to",
            l.summary, l.action, c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone",
            coalesce((select json_agg(json_build_object('name', ec.name, 'email', ec.email, 'phone', ec.phone)
                                      order by ac.created_at, ac.client_id)
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '[]') as "extraClients",
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "actorName", bu.role as "actorRole",
            u.platform_role = 'super_admin' as "superAdmin",
            coalesce((select json_agg(json_build_object('type', n.type, 'to', n.to_email, 'status', n.status,
                                                        'reason', case when n.status = 'failed' then n.last_error end)
                                      order by n.created_at, n.id)
                        from notifications n
                       where n.appointment_id = a.id and n.created_at = l.created_at), '[]') as emails
       from audit_logs l
       join appointments a on a.id = l.entity_id
       join businesses b on b.id = a.business_id
       join services s on s.id = a.service_id
       join clients c on c.id = a.client_id
       left join users u on u.id = l.actor_id
       left join business_users bu on bu.business_id = l.business_id and bu.user_id = l.actor_id
      where l.entity_type = 'appointment' and l.changes @> '[{"label": "Estado"}]'
        and l.created_at > coalesce($1::timestamptz, now() - interval '1 day') and l.created_at <= $2
      order by l.created_at, l.id
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { changes: [], total: 0 };
  const changes = rows.map(
    (row): StatusChange => ({
      businessId: row.businessId,
      businessName: row.businessName,
      serviceName: row.serviceName,
      date: row.date,
      startTime: row.startTime,
      from: row.from ?? "—",
      to: row.to ?? "—",
      clients: [{ name: row.clientName, email: row.clientEmail, phone: row.clientPhone }, ...row.extraClients],
      by:
        row.actorName === null && !row.superAdmin
          ? null
          : { name: row.actorName ?? "", role: row.actorRole, superAdmin: Boolean(row.superAdmin) },
      withoutNotice: row.summary.endsWith(WITHOUT_NOTICE),
      byPatient: row.action === "appointment.client_cancelled",
      emails: row.emails,
    }),
  );
  return { changes, total: rows[0].total };
}

/* ------------------------------------------------- Importaciones de pacientes -- */

/** Importaciones detalladas por pasada del cron; de las demás sólo se dice cuántas son. */
export const MAX_IMPORT_NOTICES = 10;

export interface ClientImport {
  businessId: string;
  businessName: string;
  /** El resumen de la actividad, sólo con cifras: «Importó 200 pacientes (3 ya existían, 5 con errores)». */
  summary: string;
  by: PanelActor;
}

/**
 * Aviso por ntfy de una importación de pacientes desde un Excel o un CSV (spec 012): uno por
 * importación, con la cifra y quién la hizo, a medias. Sin nombres ni datos de los pacientes; el
 * título no nombra al negocio.
 */
export function clientImportNotice(entry: ClientImport): BookingNotice {
  return {
    title: "Agenda360: pacientes importados",
    message: [entry.businessName, entry.summary, `Desde el panel${byWhom(entry.by)}`].join("\n"),
    priority: 3,
    tags: ["inbox_tray"],
    click: `/admin/businesses/${entry.businessId}`,
  };
}

/**
 * Las importaciones de pacientes en (since, until], las más antiguas primero (hasta `limit`), y cuántas
 * son en total. Salen del registro de actividad (client.imported: sólo las que crearon algún paciente).
 * Sin `since` (la primera pasada), las del último día.
 */
export async function findClientImports(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_IMPORT_NOTICES,
): Promise<{ imports: ClientImport[]; total: number }> {
  const rows = await many<{
    total: number;
    businessId: string;
    businessName: string;
    summary: string;
    actorName: string | null;
    actorRole: BusinessRole | null;
    superAdmin: boolean | null;
  }>(
    db,
    `select count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", l.summary,
            nullif(trim(u.first_name || ' ' || u.last_name), '') as "actorName", bu.role as "actorRole",
            u.platform_role = 'super_admin' as "superAdmin"
       from audit_logs l
       join businesses b on b.id = l.business_id
       left join users u on u.id = l.actor_id
       left join business_users bu on bu.business_id = l.business_id and bu.user_id = l.actor_id
      where l.entity_type = 'client' and l.action = 'client.imported'
        and l.created_at > coalesce($1::timestamptz, now() - interval '1 day') and l.created_at <= $2
      order by l.created_at, l.id
      limit $3`,
    [since, until, limit],
  );
  if (rows.length === 0) return { imports: [], total: 0 };
  return {
    imports: rows.map((row) => ({
      businessId: row.businessId,
      businessName: row.businessName,
      summary: row.summary,
      by:
        row.actorName === null && !row.superAdmin
          ? null
          : { name: row.actorName ?? "", role: row.actorRole, superAdmin: Boolean(row.superAdmin) },
    })),
    total: rows[0].total,
  };
}
