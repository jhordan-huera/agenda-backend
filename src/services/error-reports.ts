import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { waitUntil } from "@vercel/functions";
import type { Request } from "express";
import { config } from "../config.ts";

/**
 * Avisos de errores a Sentry (spec 044), sin librería: así no se alarga el arranque en frío (principio VI).
 *
 * El aviso se arma campo por campo con una lista cerrada (principio II): el tipo de error, el mensaje
 * limpio, la pila, la versión, la ruta tal como está en el código y unas pocas etiquetas. Nunca se agregan
 * el cuerpo, la consulta, las cabeceras, las cookies, la IP ni el usuario de la petición.
 *
 * Lo llama errorHandler (http/errors.ts) en los errores inesperados (500) y cuando la base no responde (503).
 * Los errores previstos (AppError) no se avisan. Sin SENTRY_DSN (config.sentry) no hace nada.
 */

const ROOT = join(import.meta.dirname, "..", "..");

/** Los prefijos de montaje de app.ts: la ruta del aviso es el prefijo más `req.route.path`. */
const MOUNTS = ["/api/files", "/api/public", "/api/auth", "/api/users", "/api/images", "/api/businesses", "/api/admin", "/api/push"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BUSINESS_IN_PATH = new RegExp(`^/api/(?:admin/)?businesses/(${UUID})(?:/|$)`, "i");

/** Como mucho, un aviso del mismo error por minuto y 30 por hora en cada instancia (el cupo del plan gratis). */
const SAME_ERROR_MS = 60_000;
const PER_HOUR = 30;
const SEND_TIMEOUT_MS = 3_000;
const MAX_FRAMES = 50;
const MAX_MESSAGE = 300;

/** La ruta tal como está en el código («GET /api/businesses/:id/clients»), nunca la dirección real. */
export function routeTemplate(req: Pick<Request, "method" | "originalUrl"> & { route?: { path?: unknown } }): string {
  const path = (req.originalUrl ?? "").split("?")[0];
  const mount = MOUNTS.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? (path.startsWith("/api") ? "/api" : "");
  const leaf = typeof req.route?.path === "string" ? req.route.path : "/…";
  return `${req.method} ${mount}${leaf === "/" ? "" : leaf}`;
}

/** Quién hizo la petición, sin decir quién es: «paciente» (las páginas públicas), «super admin», «equipo» o «sin sesión». */
function userType(req: Request): string {
  if (/^\/api\/public(?:\/|$)/.test(req.originalUrl ?? "")) return "paciente";
  const user = req.ctx?.user;
  if (!user) return "sin sesión";
  return user.platformRole === "super_admin" ? "super admin" : "equipo";
}

/**
 * El mensaje sin datos de nadie: los emails, los números de 7 o más cifras (teléfonos, cédulas) y los tokens
 * largos se tapan, y se corta a 300 caracteres.
 */
export function scrubMessage(message: string): string {
  return message
    .replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\+?\d(?:[\s.-]?\d){6,}/g, "[número]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[token]")
    .slice(0, MAX_MESSAGE);
}

interface StackFrame {
  filename: string;
  function?: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

/** Las líneas de la pila de V8, de la más antigua a la más nueva (como las pide Sentry), con rutas relativas. */
export function parseStack(stack: string | undefined): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const match = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    const [, fn, location, lineno, colno] = match;
    const file = location.replace(/^file:\/\//, "");
    const internal = file.startsWith("node:");
    const relativePath = internal ? file : relative(ROOT, file);
    frames.push({
      filename: relativePath.startsWith("..") ? file.split("/").slice(-2).join("/") : relativePath,
      ...(fn ? { function: fn } : {}),
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !internal && !relativePath.includes("node_modules") && !relativePath.startsWith(".."),
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.reverse();
}

/** Un error de PostgreSQL: su mensaje y su detalle pueden citar valores de la fila, así que no se envían. */
function isDatabaseError(error: Error): error is Error & { code: string; table?: unknown; constraint?: unknown } {
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && typeof severity === "string";
}

interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: { frames: StackFrame[] };
}

function exceptionValue(error: unknown): ExceptionValue {
  if (!(error instanceof Error)) return { type: "Error", value: `Se lanzó un valor que no es un error (${typeof error})` };
  const frames = parseStack(error.stack);
  if (isDatabaseError(error)) {
    const constraint = typeof error.constraint === "string" ? ` · restricción ${error.constraint}` : "";
    const table = typeof error.table === "string" ? ` · tabla ${error.table}` : "";
    return { type: "DatabaseError", value: `PostgreSQL ${error.code}${constraint}${table}`, ...(frames.length ? { stacktrace: { frames } } : {}) };
  }
  const code = (error as { code?: unknown }).code;
  const prefix = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? `${code}: ` : "";
  return { type: error.name || "Error", value: scrubMessage(`${prefix}${error.message}`), ...(frames.length ? { stacktrace: { frames } } : {}) };
}

/** El error y sus causas, hasta dos niveles; Sentry los quiere de la causa más honda al error. */
function exceptionChain(error: unknown): ExceptionValue[] {
  const chain: ExceptionValue[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    chain.push(exceptionValue(current));
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain.reverse();
}

const lastSent = new Map<string, number>();
let hourStartedAt = 0;
let sentThisHour = 0;
let pausedUntil = 0;
let warned = false;

/** ¿Se puede enviar ya este error? Cuenta el envío si sí. */
function allowed(key: string, now: number): boolean {
  if (now < pausedUntil) return false;
  if (now - (lastSent.get(key) ?? -Infinity) < SAME_ERROR_MS) return false;
  if (now - hourStartedAt >= 3_600_000) {
    hourStartedAt = now;
    sentThisHour = 0;
  }
  if (sentThisHour >= PER_HOUR) return false;
  sentThisHour++;
  lastSent.set(key, now);
  if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value!);
  return true;
}

const pending = new Set<Promise<void>>();

function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[sentry] No se pudo enviar un aviso de error (${reason}). La API sigue igual.`);
}

function deliver(envelope: string): void {
  const target = config.sentry!;
  const delivery = fetch(target.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=agenda360-api/1.0`,
    },
    body: envelope,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
    .then((response) => {
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        pausedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
      } else if (!response.ok) {
        warnOnce(`Sentry respondió ${response.status}`);
      }
    })
    .catch(() => warnOnce("sin respuesta"))
    .finally(() => pending.delete(delivery));
  pending.add(delivery);
  // En Vercel la función se congela al responder: waitUntil la mantiene viva hasta enviar (como mailer.ts).
  if (config.onVercel) waitUntil(delivery);
}

/** Espera los avisos en camino (Lambda, antes de responder: ver el gancho de res.end en app.ts). */
export async function flushErrorReports(): Promise<void> {
  await Promise.allSettled([...pending]);
}

/**
 * Avisa a Sentry de un error inesperado (500) o de la base sin responder (503). No espera el envío ni lo hace
 * fallar: si algo sale mal al armar o enviar el aviso, la respuesta a la persona es la misma.
 */
export function reportError(error: unknown, req: Request, status: 500 | 503): void {
  if (!config.sentry) return;
  try {
    const values = exceptionChain(error);
    const main = values[values.length - 1];
    const route = routeTemplate(req);
    // El mismo error en la misma ruta: los de la base pasan casi siempre por el mismo ayudante (db/pool.ts).
    if (!allowed(`${route}|${main.type}|${main.value}`, Date.now())) return;

    const business = BUSINESS_IN_PATH.exec((req.originalUrl ?? "").split("?")[0])?.[1];
    const eventId = randomUUID().replaceAll("-", "");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: config.hosted ? "production" : "pruebas",
      ...(config.release ? { release: config.release } : {}),
      transaction: route,
      exception: { values },
      tags: {
        ruta: route,
        estado: String(status),
        usuario: userType(req),
        servidor: config.onLambda ? "lambda" : config.onVercel ? "vercel" : "local",
        ...(business ? { negocio: business.toLowerCase() } : {}),
      },
      contexts: { runtime: { name: "node", version: process.version } },
      sdk: { name: "agenda360.api", version: "1.0.0" },
    };
    const header = { event_id: eventId, sent_at: new Date().toISOString(), dsn: config.sentry.dsn };
    deliver(`${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`);
  } catch {
    warnOnce("no se pudo armar");
  }
}
