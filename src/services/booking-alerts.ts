import { many, one, type Db } from "../db/pool.ts";
import { formatPrice, formatShortDate } from "../shared/lib/format.ts";
import type { Appointment, EmailType } from "../shared/types/index.ts";
import type { Alert } from "./alerts.ts";
import { maskEmail, maskPhone, shortName } from "./masking.ts";

/**
 * Aviso por ntfy de cada reserva desde la página pública (lo pidió el usuario: verlas al momento, sin
 * esperar al resumen de correos del cron). Lleva lo importante de la cita y a quién salen los emails;
 * los datos del paciente, a medias (ver masking.ts).
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
  /** Los emails de la reserva; `held`: por qué no sale (p. ej. un tope diario), o null. */
  emails: { type: EmailType; to: string; held: string | null }[];
}

export function onlineBookingAlert(booking: OnlineBooking): Alert {
  const { client } = booking;
  const patient = [shortName(client.name), client.email && maskEmail(client.email), maskPhone(client.phone)].filter(Boolean).join(" · ");
  const emails = booking.emails
    .filter((email) => EMAIL_ROLES[email.type])
    .map((email) => {
      const held = email.held ? ` (no sale: ${email.held.replace(/^No enviado:\s*/i, "")})` : "";
      return `• ${EMAIL_ROLES[email.type]} → ${maskEmail(email.to)}${held}`;
    });
  return {
    title: `Nueva reserva · ${booking.businessName}`,
    message: [
      `${booking.newClient ? "Paciente nuevo" : "Ya era paciente"}: ${patient}`,
      `${booking.serviceName} · ${booking.durationMinutes} min · ${booking.price > 0 ? formatPrice(booking.price, booking.currency) : "gratis"}`,
      [
        booking.professionalName && `Con ${booking.professionalName}`,
        `${formatShortDate(booking.date)} ${booking.startTime}`,
        PLACE_LABELS[booking.place],
      ]
        .filter(Boolean)
        .join(" · "),
      booking.status === "confirmed" ? "Confirmada" : "Pendiente de confirmar",
      "",
      ...(emails.length > 0 ? ["Emails:", ...emails] : ["Sin emails (el negocio tiene apagadas las confirmaciones)."]),
    ].join("\n"),
    priority: 3,
    tags: ["calendar"],
    click: `/admin/businesses/${booking.businessId}`,
  };
}

/** Los datos del aviso de una reserva recién creada (dentro de su transacción, con sus emails ya en cola). */
export async function loadOnlineBooking(db: Db, appointment: Appointment, newClient: boolean): Promise<OnlineBooking | null> {
  const row = await one<{
    businessName: string;
    currency: string;
    serviceName: string;
    durationMinutes: number;
    professionalName: string | null;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
  }>(
    db,
    `select b.name as "businessName", b.currency, s.name as "serviceName", s.duration_minutes as "durationMinutes",
            p.display_name as "professionalName", c.name as "clientName", c.email as "clientEmail", c.phone as "clientPhone"
       from appointments a
       join businesses b on b.id = a.business_id
       join services s on s.id = a.service_id
       join clients c on c.id = a.client_id
       left join professionals p on p.id = a.professional_id
      where a.id = $1`,
    [appointment.id],
  );
  if (!row) return null;
  const emails = await many<{ type: EmailType; to: string; held: string | null }>(
    db,
    `select type, to_email as "to", case when status = 'failed' then last_error end as held
       from notifications where appointment_id = $1 order by created_at`,
    [appointment.id],
  );
  return {
    businessId: appointment.businessId,
    businessName: row.businessName,
    currency: row.currency,
    serviceName: row.serviceName,
    durationMinutes: row.durationMinutes,
    price: appointment.price,
    professionalName: row.professionalName,
    date: appointment.date,
    startTime: appointment.startTime,
    place: appointment.isVirtual ? "virtual" : appointment.homeVisit ? "home" : "business",
    status: appointment.status,
    newClient,
    client: { name: row.clientName, email: row.clientEmail, phone: row.clientPhone },
    emails,
  };
}
