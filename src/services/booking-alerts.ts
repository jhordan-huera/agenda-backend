import { many, type Db } from "../db/pool.ts";
import { formatPrice, formatShortDate } from "../shared/lib/format.ts";
import type { Appointment, EmailType } from "../shared/types/index.ts";
import { scrubEmails } from "./mailer.ts";
import { maskEmail, maskPhone, shortName } from "./masking.ts";

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
  /** El paciente se creó con esta reserva (no estaba en el negocio). */
  newClient: boolean;
  client: { name: string; email: string; phone: string };
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
  const { client } = booking;
  const patient = [shortName(client.name), client.email && maskEmail(client.email), maskPhone(client.phone)].filter(Boolean).join(" · ");
  const emails = booking.emails
    .filter((email) => EMAIL_ROLES[email.type])
    .map((email) => `• ${EMAIL_ROLES[email.type]} → ${maskEmail(email.to)}${describeEmailStatus(email)}`);
  return {
    title: "Agenda360: nueva reserva",
    message: [
      `${booking.businessName} · ${formatShortDate(booking.date)} ${booking.startTime}`,
      `${booking.newClient ? "Paciente nuevo" : "Ya era paciente"}: ${patient}`,
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
 * se creó con la reserva: misma transacción, mismo instante.
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
    clientName: string;
    clientEmail: string;
    clientPhone: string;
  }>(
    db,
    `select a.id, count(*) over ()::int as total, b.id as "businessId", b.name as "businessName", b.currency,
            s.name as "serviceName", s.duration_minutes as "durationMinutes", a.price, p.display_name as "professionalName",
            to_char(a.date, 'YYYY-MM-DD') as date, to_char(a.start_time, 'HH24:MI') as "startTime",
            a.is_virtual as "isVirtual", a.home_visit is not null as "homeVisit", a.status,
            (c.source = 'booking_page' and c.created_at = a.created_at) as "newClient",
            c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone"
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
      newClient: row.newClient,
      client: { name: row.clientName, email: row.clientEmail, phone: row.clientPhone },
      emails: emails.filter((email) => email.appointmentId === row.id).map(({ appointmentId: _id, ...email }) => email),
    }),
  );
  return { bookings, total: rows[0].total };
}
