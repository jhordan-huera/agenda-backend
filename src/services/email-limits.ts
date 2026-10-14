import { config } from "../config.ts";
import { one, pool, type Db } from "../db/pool.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import type { EmailType } from "../shared/types/index.ts";
import { sendAlert, type Alert } from "./alerts.ts";

/**
 * Topes diarios de emails, contra el spam desde nuestra cuenta de Gmail: cualquiera puede reservar
 * con un email ajeno o registrarse con el de otro, y cada vez sale un email. Al llegar a un tope el
 * email no se envía (queda en el historial como fallido, con el motivo) y se avisa por el registro y
 * por ntfy. Sólo se frenan los emails a terceros: los avisos al negocio, a sus profesionales y al
 * equipo de la plataforma (nueva reserva, comprobantes, altas, planes…) salen siempre.
 */

/**
 * Emails a personas de fuera de la plataforma: los de las citas al paciente y la bienvenida de un
 * registro (su dirección no está comprobada).
 */
export const THIRD_PARTY_EMAIL_TYPES: readonly EmailType[] = [
  "welcome",
  "booking_created",
  "appointment_confirmed",
  "appointment_updated",
  "appointment_cancelled",
  "appointment_reminder",
  "appointment_pending",
  "appointment_completed",
  "appointment_no_show",
];

/**
 * Emails a terceros que provoca alguien de fuera, sin cuenta (spec 009): la bienvenida de un registro
 * y los de una cita reservada en la página, puestos en cola en la misma transacción que la creó. Tienen
 * su propio tope (config.publicEmailsPerDay) dentro del total: quien llene el tope con reservas falsas
 * no deja a los negocios sin recordatorios ni avisos de sus citas. El total no sube: la cuenta de Gmail
 * tiene su propio tope diario (unos 500 envíos).
 */
const PUBLIC_ORIGIN = (alias: string) =>
  `(${alias}.type = 'welcome'
    or exists (select 1 from appointments pa
                where pa.id = ${alias}.appointment_id and pa.source = 'booking_page' and pa.created_at = ${alias}.created_at))`;

/** Emails de la página de reservas a pacientes nuevos (creados por ella hace menos de 24 h) por negocio en 24 h. */
export const NEW_PATIENT_EMAILS_PER_DAY = 20;

/** Los que cuentan: enviados o por enviar. Los frenados por un tope quedan como fallidos sin intentos. */
const COUNTED = "(n.status <> 'failed' or n.attempts > 0)";

/** Un aviso por clave cada 24 h (aunque el tope frene muchos emails ese día). */
async function alertOnce(key: string, alert: Alert): Promise<void> {
  try {
    const { hits } = await incrementCounter(pool, `aviso:${key}`, 24 * 60 * 60_000);
    if (hits === 1) sendAlert(alert);
  } catch (error) {
    console.error("[emails] No se pudo registrar el aviso del tope:", error instanceof Error ? error.message : error);
  }
}

/**
 * Motivo por el que este email no debe salir (tope diario de emails a terceros entre todos los
 * negocios), o null si puede salir.
 */
export async function thirdPartyEmailHold(db: Db, type: EmailType, appointmentId: string | null = null): Promise<string | null> {
  if (!THIRD_PARTY_EMAIL_TYPES.includes(type)) return null;
  const publicHold = await publicEmailHold(db, type, appointmentId);
  if (publicHold) return publicHold;
  const limit = config.thirdPartyEmailsPerDay;
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from notifications n
      where n.created_at between now() - interval '24 hours' and now() and n.type = any($1::text[]) and ${COUNTED}`,
    [THIRD_PARTY_EMAIL_TYPES],
  );
  if ((row?.count ?? 0) < limit) return null;
  console.warn(`[emails] Tope de ${limit} emails a terceros en 24 h: no se envía un email "${type}".`);
  await alertOnce("tope-emails-terceros", {
    title: "Agenda360: tope diario de emails a pacientes",
    message:
      `Se enviaron ${limit} emails a pacientes y registros nuevos en las últimas 24 h (THIRD_PARTY_EMAILS_PER_DAY). ` +
      "Los siguientes quedan sin enviar hasta que baje la cuenta; los avisos a los negocios siguen saliendo. " +
      "Si no es un ataque, sube el tope. Detalle en Actividad → Emails.",
    priority: 4,
    tags: ["warning"],
  });
  return `No enviado: se alcanzó el tope de ${limit} emails a terceros en 24 h.`;
}

/**
 * Tope de los emails que provoca el público (reservas online y registros) en 24 h, entre todos los
 * negocios. El email va en la misma transacción que la reserva (now() es su instante): así se sabe
 * si es de una reserva que se está creando.
 */
async function publicEmailHold(db: Db, type: EmailType, appointmentId: string | null): Promise<string | null> {
  const isPublic =
    type === "welcome" ||
    (appointmentId !== null &&
      Boolean(await one(db, "select 1 from appointments where id = $1 and source = 'booking_page' and created_at = now()", [appointmentId])));
  if (!isPublic) return null;
  const limit = config.publicEmailsPerDay;
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from notifications n
      where n.created_at between now() - interval '24 hours' and now() and n.type = any($1::text[])
        and ${PUBLIC_ORIGIN("n")} and ${COUNTED}`,
    [THIRD_PARTY_EMAIL_TYPES],
  );
  if ((row?.count ?? 0) < limit) return null;
  console.warn(`[emails] Tope de ${limit} emails de reservas online y registros en 24 h: no se envía un email "${type}".`);
  await alertOnce("tope-emails-publico", {
    title: "Agenda360: tope diario de emails de reservas online",
    message:
      `Se enviaron ${limit} emails por reservas online y registros en las últimas 24 h (PUBLIC_EMAILS_PER_DAY). ` +
      "Los de las reservas siguientes quedan sin enviar; los recordatorios y los avisos de los negocios siguen saliendo. " +
      "Si no es un ataque, sube el tope. Detalle en Actividad → Emails.",
    priority: 4,
    tags: ["warning"],
  });
  return `No enviado: se alcanzó el tope de ${limit} emails de reservas online y registros en 24 h.`;
}

/**
 * Motivo por el que no debe salir el email de una reserva online a un paciente nuevo (tope por
 * negocio en 24 h), o null si puede salir o si el paciente no es nuevo. Cuenta los emails de las citas
 * con algún paciente nuevo: el principal o una de las otras personas de una sesión en pareja.
 */
export async function newPatientEmailHold(db: Db, businessId: string, clientId: string): Promise<string | null> {
  const isNew = await one(
    db,
    "select 1 from clients where id = $1 and source = 'booking_page' and created_at between now() - interval '24 hours' and now()",
    [clientId],
  );
  if (!isNew) return null;
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count
       from notifications n
       join appointments a on a.id = n.appointment_id
      where n.business_id = $1 and n.created_at between now() - interval '24 hours' and now()
        and n.type in ('booking_created', 'appointment_confirmed')
        and exists (select 1 from clients c
                     where (c.id = a.client_id
                            or c.id in (select ac.client_id from appointment_clients ac where ac.appointment_id = a.id))
                       and c.source = 'booking_page' and c.created_at between now() - interval '24 hours' and now())
        and ${COUNTED}`,
    [businessId],
  );
  if ((row?.count ?? 0) < NEW_PATIENT_EMAILS_PER_DAY) return null;
  console.warn(`[emails] El negocio ${businessId} llegó al tope de ${NEW_PATIENT_EMAILS_PER_DAY} emails a pacientes nuevos en 24 h.`);
  await alertOnce(`tope-emails-pacientes-nuevos:${businessId}`, {
    title: "Agenda360: muchas reservas online de pacientes nuevos",
    message:
      `Un negocio (id ${businessId}) recibió más de ${NEW_PATIENT_EMAILS_PER_DAY} reservas de pacientes nuevos en 24 h: ` +
      "a los siguientes no se les envía la confirmación por email. Revisa si son reservas falsas.",
    priority: 3,
    tags: ["warning"],
  });
  return `No enviado: el negocio llegó al tope de ${NEW_PATIENT_EMAILS_PER_DAY} emails a pacientes nuevos en 24 h.`;
}
