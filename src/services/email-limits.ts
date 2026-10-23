import { config } from "../config.ts";
import { one, pool, type Db } from "../db/pool.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import type { EmailType } from "../shared/types/index.ts";
import { sendAlert, type Alert } from "./alerts.ts";

/**
 * El cupo de Gmail y los topes de emails.
 *
 * - **El cupo de la cuenta** (spec 015): la cuenta de Gmail que envía tiene un cupo diario (unos 500
 *   envíos en 24 h). Se mira al enviar (claimBatch, en mailer.ts) con tres niveles de prioridad
 *   (EMAIL_PRIORITY): lo que no cabe espera en la cola, nunca se descarta.
 * - **Los topes contra el abuso** (spec 009), al poner en cola: cualquiera puede reservar con un email
 *   ajeno o registrarse con el de otro, y cada vez sale un email. Al llegar a un tope el email no se
 *   envía (queda en el historial como fallido, con el motivo) y se avisa por el registro y por ntfy.
 *   Son defensas, no un cupo: está bien que fallen.
 */

/** El nivel de prioridad de un email frente al cupo de Gmail (spec 015, R2). */
export type EmailPriority = "team" | "patient" | "business";

/**
 * El nivel de cada tipo de email, en un solo sitio (tests/email-quota.test.ts exige que estén todos):
 * - **team**: las cuentas del equipo y de la plataforma (contraseñas, seguridad, planes). Salen siempre:
 *   pueden usar todo el cupo.
 * - **patient**: al paciente sobre su cita y la bienvenida de un registro. Hasta el cupo menos la
 *   reserva del equipo.
 * - **business**: las copias al profesional y los avisos al negocio. Hasta el cupo menos la reserva del
 *   paciente: si un día no hay cupo, esperan al día siguiente (primero lo del paciente).
 */
export const EMAIL_PRIORITY: Record<EmailType, EmailPriority> = {
  password_reset: "team",
  team_invite: "team",
  account_security_changed: "team",
  platform_admin_added: "team",
  business_suspended: "team",
  business_reactivated: "team",
  plan_change_requested: "team",
  plan_change_approved: "team",
  plan_change_rejected: "team",
  plan_changed: "team",
  business_created: "team",
  // La mensualidad del propietario (spec 029): como los planes, sale siempre.
  billing_reminder: "team",
  billing_paid: "team",
  billing_rejected: "team",
  billing_voided: "team",
  welcome: "patient",
  booking_created: "patient",
  appointment_confirmed: "patient",
  appointment_updated: "patient",
  appointment_cancelled: "patient",
  appointment_reminder: "patient",
  appointment_pending: "patient",
  appointment_completed: "patient",
  appointment_no_show: "patient",
  // Una serie de citas (spec 011): un email por paciente, no uno por cita.
  appointment_series: "patient",
  appointment_series_cancelled: "patient",
  appointment_copy: "business",
  booking_received: "business",
  professional_new_appointment: "business",
  professional_daily_agenda: "business",
  payment_receipt_received: "business",
  patient_cancelled: "business",
  // Las invitaciones de calendario al profesional (spec 027): como la copia, esperan si un día no hay cupo.
  calendar_invite: "business",
};

/** Los niveles, del que sale primero al último. */
export const EMAIL_PRIORITY_ORDER: readonly EmailPriority[] = ["team", "patient", "business"];

/** Los tipos de un nivel. */
export const emailTypesOf = (priority: EmailPriority): EmailType[] =>
  (Object.keys(EMAIL_PRIORITY) as EmailType[]).filter((type) => EMAIL_PRIORITY[type] === priority);

/** Los emails al paciente (y las bienvenidas): los que frenan los topes del público. */
const PATIENT_EMAIL_TYPES = emailTypesOf("patient");

/**
 * Hasta cuántos envíos en 24 h (contando todos los niveles) puede llegar cada nivel: el equipo, al
 * cupo; el paciente, al cupo menos la reserva del equipo; el negocio, al cupo menos la del paciente.
 */
export function emailQuotaLimits(quota = config.emailQuota): Record<EmailPriority, number> {
  return { team: quota.quota, patient: quota.quota - quota.teamReserve, business: quota.quota - quota.patientReserve };
}

/**
 * La marca (en last_error) de un email que espera el cupo de Gmail: sigue en cola, sin gastar intentos,
 * y sale en cuanto hay cupo, por orden de llegada. No es un error: no se muestra en ninguna pantalla.
 */
export const QUOTA_WAIT_NOTE = "En espera: no queda cupo de Gmail en las últimas 24 h.";

/**
 * Los motivos (en last_error) de los emails que no salen a propósito, no por un problema: el recordatorio
 * de una cita que se canceló, cambió o ya empezó (mailer.ts, checkReminder), las direcciones de
 * demostración y la invitación de calendario que ya tiene una versión más nueva para el mismo buzón (spec
 * 027, 2026-10-22). En un solo sitio: el mailer los escribe y el super admin (discardedEmailSql) no los
 * cuenta como fallidos.
 */
export const DISCARD_REASONS = {
  reminderChanged: "Recordatorio descartado: la cita se canceló o cambió de fecha u hora.",
  reminderStarted: "Recordatorio descartado: la cita ya empezó.",
  demoAddress: "Dirección de demostración: no se envía.",
  supersededInvite: "Invitación reemplazada por una versión más nueva.",
} as const;

/**
 * Cómo empiezan los motivos de DISCARD_REASONS (hasta los «:» o el punto final), lo que buscan las
 * consultas: «Recordatorio descartado», «Dirección de demostración»… Salen de los motivos, así no se
 * desfasan.
 */
const DISCARD_PREFIXES = [...new Set(Object.values(DISCARD_REASONS).map((reason) => reason.split(/[:.]/)[0]))];

/**
 * El email se descartó a propósito (DISCARD_REASONS): «Emails de hoy» y el gráfico del super admin no lo
 * cuentan como fallido y la lista de /admin lo marca «Descartado». `alias`: el de notifications en la consulta.
 */
export const discardedEmailSql = (alias: string) =>
  `(${DISCARD_PREFIXES.map((prefix) => `coalesce(${alias}.last_error, '') like '${prefix.replaceAll("'", "''")}%'`).join(" or ")})`;

/** Los envíos de las últimas 24 h, de todos los niveles: lo que cuenta frente al cupo. */
export async function sentLast24h(db: Db): Promise<number> {
  const row = await one<{ count: number }>(
    db,
    "select count(*)::int as count from notifications where status = 'sent' and sent_at > now() - interval '24 hours'",
  );
  return row?.count ?? 0;
}

/** El cupo de Gmail para Salud del super admin (spec 015): sólo cifras. */
export async function emailQuotaStatus(db: Db): Promise<{
  quota: number;
  sent24h: number;
  patientLimit: number;
  waiting: { patient: number; business: number };
}> {
  const row = await one<{ sent: number; patient: number; business: number }>(
    db,
    `select (select count(*) from notifications where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent,
            count(*) filter (where type = any($2::text[]))::int as patient,
            count(*) filter (where type = any($3::text[]))::int as business
       from notifications
      where status = 'queued' and last_error = $1`,
    [QUOTA_WAIT_NOTE, PATIENT_EMAIL_TYPES, emailTypesOf("business")],
  );
  return {
    quota: config.emailQuota.quota,
    sent24h: row?.sent ?? 0,
    patientLimit: emailQuotaLimits().patient,
    waiting: { patient: row?.patient ?? 0, business: row?.business ?? 0 },
  };
}

/**
 * Emails al paciente que provoca alguien de fuera, sin cuenta (spec 009): la bienvenida de un registro
 * y los de una cita reservada en la página, puestos en cola en la misma transacción que la creó. Tienen
 * su propio tope (config.publicEmailsPerDay): quien llene la cuenta con reservas falsas no deja a los
 * negocios sin recordatorios ni avisos de sus citas.
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
export async function alertOnce(key: string, alert: Alert): Promise<void> {
  try {
    const { hits } = await incrementCounter(pool, `aviso:${key}`, 24 * 60 * 60_000);
    if (hits === 1) sendAlert(alert);
  } catch (error) {
    console.error("[emails] No se pudo registrar el aviso del tope:", error instanceof Error ? error.message : error);
  }
}

/**
 * Motivo por el que este email no debe salir (tope de los emails al paciente que provoca el público,
 * reservas online y registros, en 24 h entre todos los negocios), o null si puede salir. El email va
 * en la misma transacción que la reserva (now() es su instante): así se sabe si es de una reserva que
 * se está creando. Los avisos al negocio y al equipo no se frenan.
 */
export async function publicEmailHold(db: Db, type: EmailType, appointmentId: string | null = null): Promise<string | null> {
  if (EMAIL_PRIORITY[type] !== "patient") return null;
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
    [PATIENT_EMAIL_TYPES],
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
