import { waitUntil } from "@vercel/functions";
import { config } from "../config.ts";
import { many, one, pool } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { escapeHtml } from "../shared/lib/email/layout.ts";
import { getZonedNow, type ZonedNow } from "../shared/lib/time.ts";
import {
  DISCARD_REASONS,
  EMAIL_PRIORITY_ORDER,
  QUOTA_WAIT_NOTE,
  alertOnce,
  emailQuotaLimits,
  emailTypesOf,
  sentLast24h,
  type EmailPriority,
} from "./email-limits.ts";
import { inviteSequenceSql, resetUndeliveredInvitesSql } from "./calendar-invite-reset.ts";
import { readdressInvite } from "./calendar-invites.ts";
import { calendarEventOf, createGmailSender } from "./gmail-transport.ts";
import { isQuietTime, isReminderEmail, isReminderSql, minutesUntilQuietEnds, minutesUntilStart, reminderCurrentSql } from "./reminder-rules.ts";

/**
 * Envío de emails con Gmail (OAuth2, por SMTP o por su API: ver gmail-transport.ts). Los
 * servicios sólo guardan el email "en cola" en la tabla notifications (dentro de su
 * transacción); aquí se envían en segundo plano, así que un fallo de Gmail nunca hace
 * fallar una cita o un registro. Si el envío falla, se
 * reintenta con una espera que se duplica cada vez (5 min, 10, 20…): tras MAX_ATTEMPTS
 * intentos, unas 10 horas después, queda como fallido.
 *
 * Cada lote se toma de la cola con una consulta corta (for update skip locked) que lo reserva
 * durante CLAIM_MINUTES (next_attempt_at), y cada email se marca como enviado apenas sale: si el
 * proceso muere a mitad de un lote (tiempo máximo de Lambda, de Vercel o de Actions), lo ya
 * enviado no se repite y lo pendiente vuelve a la cola al vencer la reserva.
 *
 * El cupo diario de la cuenta de Gmail (spec 015) se mira al tomar cada lote: salen primero los del
 * equipo, después los del paciente y al final los del negocio (EMAIL_PRIORITY, en email-limits.ts),
 * cada nivel hasta su límite. Lo que no cabe espera en la cola sin gastar intentos (nunca se descarta)
 * y sale en cuanto la ventana de 24 h libera cupo, por orden de llegada.
 */

/**
 * Lo que se guarda en lugar de la contraseña en los emails con datos de acceso: la plantilla
 * se compone con esto y la contraseña va aparte (columna `secret`) sólo hasta que se envía.
 */
export const PASSWORD_MASK = "••••••••";

/** Intentos de envío antes de darlo por fallido. */
export const MAX_ATTEMPTS = 8;
/** Espera tras el primer fallo; se duplica en cada uno: 5, 10, 20… 320 min (unas 10 h en total). */
const RETRY_BASE_MINUTES = 5;
/** Un lote queda reservado este tiempo mientras se envía: si el proceso muere, vuelve a la cola. */
const CLAIM_MINUTES = 10;
const BATCH_SIZE = 10;
/** Un email que no cabe en el cupo de Gmail vuelve a mirarse a los 30 minutos, o antes si se libera cupo. */
const QUOTA_WAIT_MINUTES = 30;
const POLL_INTERVAL_MS = 60_000;
/**
 * Envío al momento en Lambda (antes de responder) y en Vercel (después, con waitUntil): un lote y este
 * tiempo para empezar envíos; con los límites de nodemailer, unos 20 s como mucho. Lo que no salga
 * (p. ej. reintentos acumulados) lo envía el cron.
 */
const FLUSH_BUDGET_MS = 8_000;
const hostedPass = () => ({ skipReminders: true, maxBatches: 1, deadline: Date.now() + FLUSH_BUDGET_MS });

/** Espera hasta el siguiente intento, tras `attempts` intentos fallidos. */
export const retryDelayMinutes = (attempts: number) => RETRY_BASE_MINUTES * 2 ** Math.max(0, attempts - 1);

/** Dominios de los datos demo y dominios reservados (RFC 2606): nunca se les envía nada. */
const UNDELIVERABLE_DOMAINS = new Set(["demo.com", "example.com", "example.org", "example.net"]);
const UNDELIVERABLE_TLDS = [".test", ".example", ".invalid", ".localhost"];

function isUndeliverable(address: string): boolean {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return UNDELIVERABLE_DOMAINS.has(domain) || UNDELIVERABLE_TLDS.some((tld) => domain.endsWith(tld));
}

const gmail = config.gmail;
/** Envío por SMTP o por la API de Gmail (GMAIL_TRANSPORT), con límites de tiempo (ver gmail-transport.ts). */
const transporter = gmail ? createGmailSender(gmail) : null;

interface QueuedEmail {
  id: string;
  type: string;
  to: string;
  subject: string;
  body: string;
  /** Versión con diseño (null en los emails anteriores a la migración 012). */
  html: string | null;
  /** Contraseña de los emails con datos de acceso: se guarda oculta (PASSWORD_MASK) y va aquí. */
  secret: string | null;
  /** El iCalendar de una invitación de calendario (spec 027); null en los demás. */
  calendar: string | null;
  /** Intentos, contando éste. */
  attempts: number;
  /** Clave única (recordatorios y su copia al profesional, agenda del día); null en los demás. */
  dedupeKey: string | null;
  /** Recordatorios (y su copia): la cita tal como está ahora (null si ya no existe) y la zona del negocio. */
  appointmentStatus: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  timezone: string | null;
  /** El recordatorio es de la fecha y hora actuales de la cita y de uno de sus pacientes (ver reminderCurrentSql). */
  reminderCurrent: boolean | null;
  /** Copia al profesional de un recordatorio: si a algún paciente le llegó ese recordatorio (null en los demás). */
  reminderSent: boolean | null;
}

/** El contenido que sale: la contraseña sólo existe en el email enviado; en el registro queda oculta. */
export function outgoingContent(email: Pick<QueuedEmail, "body" | "html" | "secret">): { text: string; html: string | null } {
  const { secret } = email;
  if (secret === null) return { text: email.body, html: email.html };
  return {
    text: email.body.replaceAll(PASSWORD_MASK, () => secret),
    html: email.html?.replaceAll(PASSWORD_MASK, () => escapeHtml(secret)) ?? null,
  };
}

/**
 * Lo que recibe quien envía: destinatario, asunto y contenido ya con la contraseña, y la invitación de
 * calendario si la hay (spec 027).
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string | null;
  calendar?: string | null;
}

async function sendWithGmail(email: OutgoingEmail): Promise<void> {
  await transporter!.send({
    from: { name: gmail!.fromName, address: gmail!.user },
    to: email.to,
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
    // La invitación: la parte text/calendar y el adjunto .ics (ver calendarEventOf).
    ...(email.calendar ? { icalEvent: calendarEventOf(email.calendar) } : {}),
  });
}

/** Resultado de una pasada por la cola (el cron lo resume en el aviso de ntfy). */
export interface EmailQueueReport {
  sent: number;
  /** Fallaron y se reintentarán más tarde (con espera creciente). */
  retrying: number;
  /** Fallaron por última vez (MAX_ATTEMPTS intentos, o un recordatorio de una cita que ya pasó). */
  failed: number;
  /** Direcciones de demostración y recordatorios que ya no valen: se descartan sin enviar. */
  skipped: number;
  /** Esperan en la cola el cupo diario de Gmail al terminar la pasada (spec 015): salen después, sin perderse. */
  waiting: number;
  /** Errores distintos, sin direcciones: el aviso no debe llevar datos de los clientes. */
  errors: string[];
}

const MAX_REPORTED_ERRORS = 5;

/** Mensaje de error sin direcciones de email (los registros de GitHub Actions son públicos). */
export const scrubEmails = (message: string) => message.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[email]");

/** La hora del negocio de un recordatorio (con una zona inválida, la de Ecuador: no debe bloquear la cola). */
function zonedNowOf(email: QueuedEmail): ZonedNow {
  try {
    return getZonedNow(email.timezone ?? DEFAULT_TIMEZONE);
  } catch {
    return getZonedNow(DEFAULT_TIMEZONE);
  }
}

type ReminderCheck = { action: "send" } | { action: "discard"; reason: string } | { action: "postpone"; minutes: number };

/**
 * Un recordatorio (o su copia al profesional) se comprueba otra vez antes de salir (puede llevar un
 * rato en cola, reintentándose o esperando el cupo de Gmail): si la cita se canceló, cambió de fecha u
 * hora o ya empezó, se descarta (el cuerpo guardado diría algo falso, o ya no llega a tiempo); en las
 * horas de silencio del negocio, espera a las 7:00.
 *
 * La copia al profesional de un recordatorio que ya le llegó al paciente sale aunque la cita haya
 * cambiado o empezado mientras esperaba el cupo (spec 015): es la copia de lo que recibió el paciente y
 * nunca se descarta. La de un recordatorio que no salió se descarta con él.
 */
function checkReminder(email: QueuedEmail): ReminderCheck {
  if (!isReminderEmail(email)) return { action: "send" };
  const now = zonedNowOf(email);
  if (!email.reminderSent) {
    if (!email.appointmentStatus || !["pending", "confirmed"].includes(email.appointmentStatus) || !email.reminderCurrent) {
      return { action: "discard", reason: DISCARD_REASONS.reminderChanged };
    }
    if (minutesUntilStart(email.appointmentDate!, email.appointmentTime!, now) <= 0) {
      return { action: "discard", reason: DISCARD_REASONS.reminderStarted };
    }
  }
  if (isQuietTime(now)) return { action: "postpone", minutes: minutesUntilQuietEnds(now) };
  return { action: "send" };
}

/** Un recordatorio (no la copia de uno que ya salió) de una cita que ya empezó: no se reintenta. */
function isLateReminder(email: QueuedEmail): boolean {
  return (
    isReminderEmail(email) &&
    !email.reminderSent &&
    email.appointmentDate !== null &&
    minutesUntilStart(email.appointmentDate, email.appointmentTime!, zonedNowOf(email)) <= 0
  );
}

/** Lista SQL de los tipos de un nivel (constantes del código: ver EMAIL_PRIORITY). */
const typeList = (priority: EmailPriority) =>
  emailTypesOf(priority)
    .map((type) => `'${type}'`)
    .join(", ");

/**
 * El nivel de un email en SQL: 0 el equipo, 1 el paciente y 2 el negocio. Un tipo que no esté en
 * EMAIL_PRIORITY (no debería: lo comprueban las pruebas) va con el negocio, el que menos cupo usa.
 */
const levelSql = (alias: string) =>
  `case when ${alias}.type in (${typeList("team")}) then 0 when ${alias}.type in (${typeList("patient")}) then 1 else 2 end`;

/**
 * Las copias de un recordatorio (dedupe_key "<clave del recordatorio>:copy"): si a algún paciente le
 * llegó ese recordatorio (el principal tiene la misma clave; los demás, la clave y ":<paciente>").
 */
const reminderSentSql = (alias: string) =>
  `case when ${alias}.type = 'appointment_copy' and coalesce(${alias}.dedupe_key, '') like 'reminder:%:copy' then exists (
     select 1 from notifications r
      where r.type = 'appointment_reminder' and r.status = 'sent'
        and (r.dedupe_key = left(${alias}.dedupe_key, -5) or starts_with(r.dedupe_key, left(${alias}.dedupe_key, -5) || ':'))) end`;

/** Lo que tomó un lote de la cola y si el cupo de Gmail dejó fuera algo de lo que estaba listo. */
interface Claim {
  emails: QueuedEmail[];
  /** Algún nivel llegó a su límite: lo suyo que estaba listo quedó esperando (QUOTA_WAIT_NOTE). */
  limited: boolean;
}

/**
 * Toma de la cola hasta BATCH_SIZE emails listos para enviar y los reserva durante CLAIM_MINUTES, en
 * una sola consulta: otro proceso que mire la cola a la vez no los ve (skip locked) ni los toma
 * mientras dure la reserva. Cuenta el intento desde ya.
 *
 * El cupo de Gmail (spec 015): primero los del equipo, después los del paciente y al final los del
 * negocio (y dentro de cada nivel, los más antiguos); cada uno entra si, con los enviados en las
 * últimas 24 h y los de antes en el lote, no pasa el límite de su nivel. Como los límites bajan de un
 * nivel al siguiente, lo que no entra es siempre el final del lote: un email del negocio nunca le quita
 * el sitio a uno del paciente. Los que esperan el cupo se miran en cada lote aunque su hora no haya
 * llegado, así salen en cuanto hay cupo y antes que los nuevos de su nivel.
 *
 * Lo que no cabe se queda en cola (QUOTA_WAIT_NOTE, a los QUOTA_WAIT_MINUTES), sin sumar el intento, y
 * al llegar al límite del paciente se avisa una vez al día por ntfy, sólo con cifras.
 */
async function claimBatch(skipReminders: boolean): Promise<Claim> {
  const limits = emailQuotaLimits();
  const sent = await sentLast24h(pool);
  const notReminder = (alias: string) => (skipReminders ? `and not ${isReminderSql(alias)}` : "");
  const emails = await many<QueuedEmail>(
    pool,
    `with candidates as materialized (
       select n.id, n.created_at, ${levelSql("n")} as level
         from notifications n
        where n.status = 'queued' and (n.next_attempt_at <= now() or n.last_error = $3)
              ${notReminder("n")}
        order by level, n.created_at
        limit $1
          for update skip locked
     ),
     fitting as (
       select r.id
         from (select c.id, c.level, row_number() over (order by c.level, c.created_at) as position from candidates c) r
        where $4::int + r.position <= case r.level when 0 then $5::int when 1 then $6::int else $7::int end
     ),
     claimed as (
       update notifications n
          set attempts = n.attempts + 1, next_attempt_at = now() + make_interval(mins => $2),
              last_error = case when n.last_error = $3 then null else n.last_error end
         from fitting f
        where n.id = f.id
    returning n.id, n.type, n.to_email, n.subject, n.body, n.html, n.secret, n.calendar, n.attempts, n.appointment_id, n.dedupe_key, n.created_at
     )
     select c.id, c.type, c.to_email as "to", c.subject, c.body, c.html, c.secret, c.calendar, c.attempts, c.dedupe_key as "dedupeKey",
            a.status as "appointmentStatus", a.date as "appointmentDate", a.start_time as "appointmentTime",
            b.timezone, ${reminderCurrentSql("c", "a")} as "reminderCurrent", ${reminderSentSql("c")} as "reminderSent"
       from claimed c
       left join appointments a on ${isReminderSql("c")} and a.id = c.appointment_id
       left join businesses b on b.id = a.business_id
      order by ${levelSql("c")}, c.created_at`,
    [BATCH_SIZE, CLAIM_MINUTES, QUOTA_WAIT_NOTE, sent, limits.team, limits.patient, limits.business],
  );

  // Los niveles que llegaron a su límite (si llega uno, también los que van después): lo suyo que
  // está listo espera el cupo, sin gastar un intento.
  const used = sent + emails.length;
  const fullFrom = EMAIL_PRIORITY_ORDER.findIndex((priority) => used >= limits[priority]);
  if (fullFrom === -1) return { emails, limited: false };
  await pool.query(
    `with waiting as (
       select n.id from notifications n
        where n.status = 'queued' and n.next_attempt_at <= now() and n.last_error is distinct from $1
          and ${levelSql("n")} >= $2 ${notReminder("n")}
          for update skip locked
     )
     update notifications n set next_attempt_at = now() + make_interval(mins => $3), last_error = $1
       from waiting w where n.id = w.id`,
    [QUOTA_WAIT_NOTE, fullFrom, QUOTA_WAIT_MINUTES],
  );
  if (used >= limits.patient) {
    const { quota } = config.emailQuota;
    await alertOnce("cupo-gmail", {
      title: "Agenda360: se llegó al cupo de Gmail",
      message:
        `Van ${used} envíos en las últimas 24 h y el cupo de la cuenta es de ${quota} (EMAIL_DAILY_QUOTA). ` +
        `Esperan en la cola ${await countWaiting()} emails al paciente y al negocio: salen en cuanto haya cupo, sin perderse. ` +
        "Las contraseñas y los avisos de seguridad del equipo siguen saliendo. Detalle en Salud de /admin.",
      priority: 4,
      tags: ["warning"],
    });
  }
  return { emails, limited: true };
}

/** Emails que esperan el cupo de Gmail. */
async function countWaiting(): Promise<number> {
  const row = await one<{ count: number }>(
    pool,
    "select count(*)::int as count from notifications where status = 'queued' and last_error = $1",
    [QUOTA_WAIT_NOTE],
  );
  return row?.count ?? 0;
}

/** Emails reservados que no se llegaron a enviar (se acabó el tiempo): vuelven a la cola ya mismo. */
async function release(emails: QueuedEmail[]): Promise<void> {
  if (emails.length === 0) return;
  await pool.query("update notifications set attempts = attempts - 1, next_attempt_at = now() where id = any($1::uuid[])", [
    emails.map((email) => email.id),
  ]);
}

/** Se descarta sin enviar (queda como fallido, con el motivo). */
async function discard(id: string, reason: string): Promise<void> {
  await pool.query("update notifications set status = 'failed', last_error = $2, secret = null where id = $1", [id, reason]);
}

/**
 * Una invitación de calendario (spec 027) con otra más nueva de la misma cita para el mismo buzón, en cola o
 * ya enviada: sobra, porque cada invitación lleva el evento entero. Si saliera después (p. ej. un reintento),
 * un calendario que nunca tuvo el evento lo añadiría aunque la cita ya se hubiera cancelado. «Más nueva»: la
 * puesta en cola después o, en la misma transacción, la de SEQUENCE mayor (crece con cada envío de la cita).
 */
async function isSupersededInvite(email: QueuedEmail): Promise<boolean> {
  if (email.type !== "calendar_invite") return false;
  const newer = await one(
    pool,
    `select 1 from notifications n
       join notifications o
         on o.business_id = n.business_id and o.created_at >= n.created_at and o.id <> n.id
        and o.type = 'calendar_invite' and o.appointment_id = n.appointment_id and o.to_email = n.to_email
        and o.status in ('queued', 'sent')
        and (o.created_at > n.created_at or coalesce(${inviteSequenceSql("o")}, -1) > coalesce(${inviteSequenceSql("n")}, -1))
      where n.id = $1
      limit 1`,
    [email.id],
  );
  return Boolean(newer);
}

/**
 * Envía un email ya reservado y guarda el resultado al momento, fuera de cualquier transacción
 * larga. Devuelve false si el envío falló.
 */
async function deliver(email: QueuedEmail, send: (email: OutgoingEmail) => Promise<void>, report: EmailQueueReport): Promise<boolean> {
  // Con los emails desviados a tu correo (pruebas en local), también los de los datos demo:
  // al destinatario falso no le llega nada, sólo a ti.
  if (!config.emailRedirectTo && isUndeliverable(email.to)) {
    await discard(email.id, DISCARD_REASONS.demoAddress);
    report.skipped++;
    return true;
  }
  const check = checkReminder(email);
  if (check.action === "discard") {
    await discard(email.id, check.reason);
    report.skipped++;
    return true;
  }
  if (check.action === "postpone") {
    // Horas de silencio: no cuenta como intento.
    await pool.query(
      "update notifications set attempts = attempts - 1, next_attempt_at = now() + make_interval(mins => $2) where id = $1",
      [email.id, check.minutes],
    );
    return true;
  }
  if (await isSupersededInvite(email)) {
    await discard(email.id, DISCARD_REASONS.supersededInvite);
    report.skipped++;
    return true;
  }

  const redirectTo = config.emailRedirectTo;
  const { text, html } = outgoingContent(email);
  try {
    await send({
      to: redirectTo ?? email.to,
      subject: redirectTo ? `[Para ${email.to}] ${email.subject}` : email.subject,
      text,
      html,
      // Desviada a la cuenta de pruebas: la invitación, a su nombre (ver readdressInvite).
      calendar: email.calendar && redirectTo ? readdressInvite(email.calendar, email.to, redirectTo) : email.calendar,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Sin la dirección: el cron corre en GitHub Actions, cuyos registros son públicos.
    console.error(`[email] No se pudo enviar el email ${email.id}: ${scrubEmails(message)}`);
    // Último intento, o un recordatorio de una cita que ya empezó: no se reintenta.
    const giveUp = email.attempts >= MAX_ATTEMPTS || isLateReminder(email);
    await pool.query(
      `update notifications
          set last_error = $2,
              status = case when $3 then 'failed' else 'queued' end,
              secret = case when $3 then null else secret end,
              next_attempt_at = now() + make_interval(mins => $4)
        where id = $1`,
      [email.id, message.slice(0, 500), giveUp, retryDelayMinutes(email.attempts)],
    );
    // Una invitación de calendario que ya no saldrá: la siguiente sincronización la vuelve a enviar (spec 027).
    // Las descartadas a propósito no: la de una dirección de demostración fallaría igual, y la reemplazada
    // ya tiene su versión más nueva.
    if (giveUp && email.type === "calendar_invite") await pool.query(resetUndeliveredInvitesSql("n.id = $1"), [email.id]);
    if (giveUp) report.failed++;
    else report.retrying++;
    const summary = scrubEmails(message).slice(0, 200);
    if (report.errors.length < MAX_REPORTED_ERRORS && !report.errors.includes(summary)) report.errors.push(summary);
    return false;
  }
  await pool.query(
    "update notifications set status = 'sent', sent_at = now(), last_error = null, secret = null where id = $1",
    [email.id],
  );
  report.sent++;
  return true;
}

let processing = false;
let pendingRun = false;

/**
 * Envía los emails en cola que ya toca enviar. Si ya está trabajando, se repite al terminar (y
 * devuelve un resumen vacío). `maxBatches` limita la pasada; `deadline` (Date.now()) es la hora
 * a partir de la cual no empieza envíos nuevos (lo reservado y sin enviar vuelve a la cola);
 * `skipReminders` deja los recordatorios de citas (y sus copias al profesional) para el cron de
 * GitHub (scripts/cron.ts), que es quien los envía. `send`: sólo para las pruebas, otra forma de enviar (sin Gmail).
 */
export async function processEmailQueue(
  options: { maxBatches?: number; deadline?: number; skipReminders?: boolean; send?: (email: OutgoingEmail) => Promise<void> } = {},
): Promise<EmailQueueReport> {
  const report: EmailQueueReport = { sent: 0, retrying: 0, failed: 0, skipped: 0, waiting: 0, errors: [] };
  const send = options.send ?? (transporter ? sendWithGmail : null);
  if (!send) return report;
  if (processing) {
    pendingRun = true;
    return report;
  }
  processing = true;
  const hasTime = () => options.deadline === undefined || Date.now() < options.deadline;
  let batches = 0;
  let limited = false;
  try {
    do {
      pendingRun = false;
      let failed = false;
      const claim = await claimBatch(options.skipReminders ?? false);
      const batch = claim.emails;
      limited ||= claim.limited;
      const sentBefore = report.sent;
      for (const [index, email] of batch.entries()) {
        if (!hasTime()) {
          await release(batch.slice(index));
          break;
        }
        if (!(await deliver(email, send, report))) failed = true;
      }
      batches++;
      // Lote completo y sin errores: puede haber más en cola. Con errores se reintenta más tarde. Si el
      // cupo cortó el lote y algo no salió (descartado o en horas de silencio), queda cupo para otro.
      if (!failed && (batch.length === BATCH_SIZE || (claim.limited && report.sent - sentBefore < batch.length))) pendingRun = true;
    } while (pendingRun && hasTime() && batches < (options.maxBatches ?? Number.POSITIVE_INFINITY));
    if (limited) report.waiting = await countWaiting();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[email] Error al procesar la cola:", scrubEmails(message));
    report.errors.push(scrubEmails(message).slice(0, 200));
  } finally {
    processing = false;
  }
  return report;
}

let scheduled: NodeJS.Timeout | null = null;
/** Lambda: esta petición puso emails en cola (se envían antes de responder). */
let deliveryRequested = false;
let immediateDelivery = true;

/**
 * Para el cron de GitHub: envía él mismo, al final, todo lo que pone en cola. Sin esto, cada
 * recordatorio programaría un envío inmediato en paralelo al suyo.
 */
export function disableImmediateDelivery(): void {
  immediateDelivery = false;
}

/**
 * Pide un envío en breve. Se llama al guardar un email: el pequeño retraso deja que la
 * transacción que lo creó termine; si aún no terminó, lo recoge la siguiente pasada.
 * Envía confirmaciones y avisos al momento; los recordatorios quedan para el cron.
 */
export function scheduleEmailDelivery(): void {
  if (!transporter || !immediateDelivery) return;
  // En Lambda nada corre después de responder: se envía al final de la petición (flushEmailDelivery).
  if (config.onLambda) {
    deliveryRequested = true;
    return;
  }
  if (scheduled) return;
  const delivery = new Promise<void>((resolve) => {
    scheduled = setTimeout(() => {
      scheduled = null;
      void processEmailQueue(config.onVercel ? hostedPass() : { skipReminders: true }).then(() => resolve());
    }, 1_000);
  });
  // En Vercel la función se congela al responder: waitUntil la mantiene viva hasta enviar.
  if (config.onVercel) waitUntil(delivery);
}

/**
 * Lambda congela la ejecución al responder: los emails que la petición puso en cola (confirmaciones,
 * avisos) se envían justo antes (lo llama app.ts). Sin emails pendientes no hace nada. Con el límite
 * de hostedPass, la respuesta no se retrasa más de unos 20 s (el máximo de la función es 30). En
 * Vercel se envían después con waitUntil; en un servidor normal, con el temporizador de
 * scheduleEmailDelivery.
 */
export async function flushEmailDelivery(): Promise<void> {
  if (!deliveryRequested) return;
  deliveryRequested = false;
  await processEmailQueue(hostedPass()).catch((error: unknown) =>
    console.error("[emails] No se pudieron enviar al responder:", error instanceof Error ? error.message : error),
  );
}

/** Arranca el envío periódico (reintentos y emails pendientes). Devuelve la función para detenerlo. */
export function startEmailWorker(): () => void {
  if (!transporter) {
    console.warn("⚠ Emails desactivados: faltan las variables GMAIL_* en .env. Quedarán en cola sin enviarse.");
    return () => undefined;
  }
  const transportName = transporter.kind === "api" ? "API de Gmail" : "SMTP";
  console.info(
    config.emailRedirectTo
      ? `✓ Emails por Gmail (${gmail!.user}, ${transportName}); en desarrollo todos se redirigen a ${config.emailRedirectTo}`
      : `✓ Emails por Gmail (${gmail!.user}, ${transportName})`,
  );
  void processEmailQueue();
  const interval = setInterval(() => void processEmailQueue(), POLL_INTERVAL_MS);
  return () => {
    clearInterval(interval);
    if (scheduled) clearTimeout(scheduled);
    transporter.close();
  };
}
