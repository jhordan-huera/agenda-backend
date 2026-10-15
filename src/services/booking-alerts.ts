import { many, type Db } from "../db/pool.ts";
import { formatPrice, formatShortDate } from "../shared/lib/format.ts";
import { ROLE_LABELS } from "../shared/lib/permissions.ts";
import type { Appointment, BusinessRole, EmailType } from "../shared/types/index.ts";
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
 * `limit`), y cuántos son en total. Sin `since` (la primera pasada), los del último día.
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
 * su registro de actividad (appointment.created).
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
      where a.source = 'dashboard'
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

/**
 * Aviso por ntfy de un cambio de estado de una cita (spec 008, lo pidió el dueño del producto): de
 * qué estado a cuál, quién lo hizo y a quién salieron los emails. El paciente, a medias; el título
 * no nombra al negocio.
 */
export function statusChangeNotice(change: StatusChange): BookingNotice {
  const emails = change.emails.map(
    (email) => `• ${email.type === "appointment_copy" ? "Copia al profesional" : "Al paciente"} → ${maskEmail(email.to)}${describeEmailStatus(email)}`,
  );
  return {
    title: `Agenda360: ${STATUS_TITLES[change.to] ?? "cambio de estado de una cita"}`,
    message: [
      `${change.businessName} · ${formatShortDate(change.date)} ${change.startTime}`,
      ...change.clients.map((client) => `Paciente: ${maskedPatient(client)}`),
      change.serviceName,
      `De ${change.from} a ${change.to}`,
      `Cambiado desde el panel${byWhom(change.by)}`,
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
 * cuántos son en total. Salen del registro de actividad: los botones de estado y el formulario de la
 * cita guardan «Estado» en `changes`. Sin `since` (la primera pasada), los del último día.
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
      emails: row.emails,
    }),
  );
  return { changes, total: rows[0].total };
}
