import { waitUntil } from "@vercel/functions";
import nodemailer from "nodemailer";
import { config } from "../config.ts";
import { many, pool } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { escapeHtml } from "../shared/lib/email/layout.ts";
import { getZonedNow, type ZonedNow } from "../shared/lib/time.ts";
import { isQuietTime, minutesUntilQuietEnds, minutesUntilStart, reminderKeySql } from "./reminder-rules.ts";

/**
 * Envío de emails con Gmail (OAuth2). Los servicios sólo guardan el email "en cola" en la
 * tabla notifications (dentro de su transacción); aquí se envían en segundo plano, así
 * que un fallo de Gmail nunca hace fallar una cita o un registro. Si el envío falla, se
 * reintenta con una espera que se duplica cada vez (5 min, 10, 20…): tras MAX_ATTEMPTS
 * intentos, unas 10 horas después, queda como fallido.
 *
 * Cada lote se toma de la cola con una consulta corta (for update skip locked) que lo reserva
 * durante CLAIM_MINUTES (next_attempt_at), y cada email se marca como enviado apenas sale: si el
 * proceso muere a mitad de un lote (tiempo máximo de Lambda, de Vercel o de Actions), lo ya
 * enviado no se repite y lo pendiente vuelve a la cola al vencer la reserva.
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
const transporter = gmail
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: gmail.user,
        clientId: gmail.clientId,
        clientSecret: gmail.clientSecret,
        refreshToken: gmail.refreshToken,
      },
      // Sin límites, una conexión colgada con Gmail retendría el lote (y la función) indefinidamente.
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 12_000,
    })
  : null;

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
  /** Intentos, contando éste. */
  attempts: number;
  /** Recordatorios: la cita tal como está ahora (null si ya no existe) y la zona del negocio. */
  appointmentStatus: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  timezone: string | null;
  /** El recordatorio es de la fecha y hora actuales de la cita (ver reminderKeySql). */
  reminderCurrent: boolean | null;
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

/** Lo que recibe quien envía: destinatario, asunto y contenido ya con la contraseña. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

async function sendWithGmail(email: OutgoingEmail): Promise<void> {
  await transporter!.sendMail({
    from: { name: gmail!.fromName, address: gmail!.user },
    to: email.to,
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
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
 * Un recordatorio se comprueba otra vez antes de salir (puede llevar un rato en cola o
 * reintentándose): si la cita se canceló, cambió de fecha u hora o ya empezó, se descarta (el
 * cuerpo guardado diría algo falso); en las horas de silencio del negocio, espera a las 7:00.
 */
function checkReminder(email: QueuedEmail): ReminderCheck {
  if (email.type !== "appointment_reminder") return { action: "send" };
  if (!email.appointmentStatus || !["pending", "confirmed"].includes(email.appointmentStatus) || !email.reminderCurrent) {
    return { action: "discard", reason: "Recordatorio descartado: la cita se canceló o cambió de fecha u hora." };
  }
  const now = zonedNowOf(email);
  if (minutesUntilStart(email.appointmentDate!, email.appointmentTime!, now) <= 0) {
    return { action: "discard", reason: "Recordatorio descartado: la cita ya empezó." };
  }
  if (isQuietTime(now)) return { action: "postpone", minutes: minutesUntilQuietEnds(now) };
  return { action: "send" };
}

/**
 * Toma de la cola hasta BATCH_SIZE emails listos para enviar (los más antiguos) y los reserva
 * durante CLAIM_MINUTES, en una sola consulta: otro proceso que mire la cola a la vez no los ve
 * (skip locked) ni los toma mientras dure la reserva. Cuenta el intento desde ya.
 */
async function claimBatch(skipReminders: boolean): Promise<QueuedEmail[]> {
  return many<QueuedEmail>(
    pool,
    `with claimed as (
       update notifications
          set attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => $2)
        where id in (
          select id from notifications
           where status = 'queued' and next_attempt_at <= now()
                 ${skipReminders ? "and type <> 'appointment_reminder'" : ""}
           order by created_at
           limit $1
             for update skip locked)
    returning id, type, to_email, subject, body, html, secret, attempts, appointment_id, dedupe_key, created_at
     )
     select c.id, c.type, c.to_email as "to", c.subject, c.body, c.html, c.secret, c.attempts,
            a.status as "appointmentStatus", a.date as "appointmentDate", a.start_time as "appointmentTime",
            b.timezone, c.dedupe_key = ${reminderKeySql("a")} as "reminderCurrent"
       from claimed c
       left join appointments a on c.type = 'appointment_reminder' and a.id = c.appointment_id
       left join businesses b on b.id = a.business_id
      order by c.created_at`,
    [BATCH_SIZE, CLAIM_MINUTES],
  );
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
 * Envía un email ya reservado y guarda el resultado al momento, fuera de cualquier transacción
 * larga. Devuelve false si el envío falló.
 */
async function deliver(email: QueuedEmail, send: (email: OutgoingEmail) => Promise<void>, report: EmailQueueReport): Promise<boolean> {
  // Con los emails desviados a tu correo (pruebas en local), también los de los datos demo:
  // al destinatario falso no le llega nada, sólo a ti.
  if (!config.emailRedirectTo && isUndeliverable(email.to)) {
    await discard(email.id, "Dirección de demostración: no se envía.");
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

  const redirectTo = config.emailRedirectTo;
  const { text, html } = outgoingContent(email);
  try {
    await send({
      to: redirectTo ?? email.to,
      subject: redirectTo ? `[Para ${email.to}] ${email.subject}` : email.subject,
      text,
      html,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Sin la dirección: el cron corre en GitHub Actions, cuyos registros son públicos.
    console.error(`[email] No se pudo enviar el email ${email.id}: ${scrubEmails(message)}`);
    // Último intento, o un recordatorio de una cita que ya empezó: no se reintenta.
    const giveUp =
      email.attempts >= MAX_ATTEMPTS ||
      (email.type === "appointment_reminder" && minutesUntilStart(email.appointmentDate!, email.appointmentTime!, zonedNowOf(email)) <= 0);
    await pool.query(
      `update notifications
          set last_error = $2,
              status = case when $3 then 'failed' else 'queued' end,
              secret = case when $3 then null else secret end,
              next_attempt_at = now() + make_interval(mins => $4)
        where id = $1`,
      [email.id, message.slice(0, 500), giveUp, retryDelayMinutes(email.attempts)],
    );
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
 * `skipReminders` deja los recordatorios de citas para el cron de GitHub (scripts/cron.ts), que
 * es quien los envía. `send`: sólo para las pruebas, otra forma de enviar (sin Gmail).
 */
export async function processEmailQueue(
  options: { maxBatches?: number; deadline?: number; skipReminders?: boolean; send?: (email: OutgoingEmail) => Promise<void> } = {},
): Promise<EmailQueueReport> {
  const report: EmailQueueReport = { sent: 0, retrying: 0, failed: 0, skipped: 0, errors: [] };
  const send = options.send ?? (transporter ? sendWithGmail : null);
  if (!send) return report;
  if (processing) {
    pendingRun = true;
    return report;
  }
  processing = true;
  const hasTime = () => options.deadline === undefined || Date.now() < options.deadline;
  let batches = 0;
  try {
    do {
      pendingRun = false;
      let failed = false;
      const batch = await claimBatch(options.skipReminders ?? false);
      for (const [index, email] of batch.entries()) {
        if (!hasTime()) {
          await release(batch.slice(index));
          break;
        }
        if (!(await deliver(email, send, report))) failed = true;
      }
      batches++;
      // Lote completo y sin errores: puede haber más en cola. Con errores se reintenta más tarde.
      if (batch.length === BATCH_SIZE && !failed) pendingRun = true;
    } while (pendingRun && hasTime() && batches < (options.maxBatches ?? Number.POSITIVE_INFINITY));
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
  console.info(
    config.emailRedirectTo
      ? `✓ Emails por Gmail (${gmail!.user}); en desarrollo todos se redirigen a ${config.emailRedirectTo}`
      : `✓ Emails por Gmail (${gmail!.user})`,
  );
  void processEmailQueue();
  const interval = setInterval(() => void processEmailQueue(), POLL_INTERVAL_MS);
  return () => {
    clearInterval(interval);
    if (scheduled) clearTimeout(scheduled);
    transporter.close();
  };
}
