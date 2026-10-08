import { waitUntil } from "@vercel/functions";
import nodemailer from "nodemailer";
import { config } from "../config.ts";
import { many, transaction } from "../db/pool.ts";
import { escapeHtml } from "../shared/lib/email/layout.ts";

/**
 * Envío de emails con Gmail (OAuth2). Los servicios sólo guardan el email "en cola" en la
 * tabla notifications (dentro de su transacción); aquí se envían en segundo plano, así
 * que un fallo de Gmail nunca hace fallar una cita o un registro. Cada email se reintenta
 * hasta MAX_ATTEMPTS veces antes de quedar como fallido.
 */

/**
 * Lo que se guarda en lugar de la contraseña en los emails con datos de acceso: la plantilla
 * se compone con esto y la contraseña va aparte (columna `secret`) sólo hasta que se envía.
 */
export const PASSWORD_MASK = "••••••••";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 60_000;

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
    })
  : null;

interface QueuedEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** Versión con diseño (null en los emails anteriores a la migración 012). */
  html: string | null;
  /** Contraseña de los emails con datos de acceso: se guarda oculta (PASSWORD_MASK) y va aquí. */
  secret: string | null;
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

async function send(email: QueuedEmail): Promise<void> {
  const redirectTo = config.emailRedirectTo;
  const { text, html } = outgoingContent(email);
  await transporter!.sendMail({
    from: { name: gmail!.fromName, address: gmail!.user },
    to: redirectTo ?? email.to,
    subject: redirectTo ? `[Para ${email.to}] ${email.subject}` : email.subject,
    text,
    ...(html ? { html } : {}),
  });
}

/** Resultado de una pasada por la cola (el cron lo resume en el aviso de ntfy). */
export interface EmailQueueReport {
  sent: number;
  /** Fallaron y se reintentarán en la próxima pasada. */
  retrying: number;
  /** Fallaron por última vez (MAX_ATTEMPTS intentos): no se vuelven a intentar. */
  failed: number;
  /** Direcciones de demostración: se descartan sin enviar. */
  skipped: number;
  /** Errores distintos, sin direcciones: el aviso no debe llevar datos de los clientes. */
  errors: string[];
}

const MAX_REPORTED_ERRORS = 5;

/** Mensaje de error sin direcciones de email. */
const scrubEmails = (message: string) => message.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[email]");

let processing = false;
let pendingRun = false;

/**
 * Envía los emails en cola. Si ya está trabajando, se repite al terminar (y devuelve un
 * resumen vacío). `maxBatches` limita la pasada; `skipReminders` deja los recordatorios
 * de citas para el cron de GitHub (scripts/cron.ts), que es quien los envía.
 */
export async function processEmailQueue(
  options: { maxBatches?: number; skipReminders?: boolean } = {},
): Promise<EmailQueueReport> {
  const report: EmailQueueReport = { sent: 0, retrying: 0, failed: 0, skipped: 0, errors: [] };
  if (!transporter) return report;
  if (processing) {
    pendingRun = true;
    return report;
  }
  processing = true;
  let batches = 0;
  try {
    do {
      pendingRun = false;
      let failed = false;
      const processed = await transaction(async (db) => {
        // skip locked: varias instancias de la API nunca envían el mismo email.
        const batch = await many<QueuedEmail>(
          db,
          `select id, to_email as "to", subject, body, html, secret from notifications
            where status = 'queued' ${options.skipReminders ? "and type <> 'appointment_reminder'" : ""}
            order by created_at
            limit $1
            for update skip locked`,
          [BATCH_SIZE],
        );
        for (const email of batch) {
          // Con los emails desviados a tu correo (pruebas en local), también los de los datos demo:
          // al destinatario falso no le llega nada, sólo a ti.
          if (!config.emailRedirectTo && isUndeliverable(email.to)) {
            await db.query(
              "update notifications set status = 'failed', last_error = $2, secret = null where id = $1",
              [email.id, "Dirección de demostración: no se envía."],
            );
            report.skipped++;
            continue;
          }
          try {
            await send(email);
            await db.query(
              "update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null, secret = null where id = $1",
              [email.id],
            );
            report.sent++;
          } catch (error) {
            failed = true;
            const message = error instanceof Error ? error.message : String(error);
            // Sin la dirección: el cron corre en GitHub Actions, cuyos registros son públicos.
            console.error(`[email] No se pudo enviar el email ${email.id}: ${scrubEmails(message)}`);
            const { rows } = await db.query(
              `update notifications
                  set attempts = attempts + 1, last_error = $2,
                      status = case when attempts + 1 >= $3 then 'failed' else 'queued' end,
                      secret = case when attempts + 1 >= $3 then null else secret end
                where id = $1
            returning status`,
              [email.id, message.slice(0, 500), MAX_ATTEMPTS],
            );
            if (rows[0]?.status === "failed") report.failed++;
            else report.retrying++;
            const summary = scrubEmails(message).slice(0, 200);
            if (report.errors.length < MAX_REPORTED_ERRORS && !report.errors.includes(summary)) {
              report.errors.push(summary);
            }
          }
        }
        return batch.length;
      });
      batches++;
      // Lote completo y sin errores: puede haber más en cola. Con errores se reintenta en la próxima pasada.
      if (processed === BATCH_SIZE && !failed) pendingRun = true;
    } while (pendingRun && batches < (options.maxBatches ?? Number.POSITIVE_INFINITY));
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
  if (!transporter || scheduled || !immediateDelivery) return;
  const delivery = new Promise<void>((resolve) => {
    scheduled = setTimeout(() => {
      scheduled = null;
      void processEmailQueue({ skipReminders: true }).then(() => resolve());
    }, 1_000);
  });
  // En Vercel la función se congela al responder: waitUntil la mantiene viva hasta enviar.
  if (config.onVercel) waitUntil(delivery);
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
