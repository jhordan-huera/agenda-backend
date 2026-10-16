import { waitUntil } from "@vercel/functions";
import { config } from "../config.ts";
import { many, one, pool, type Db } from "../db/pool.ts";
import type { PushKind } from "../shared/types/index.ts";
import { isAllowedPushEndpoint, pushServiceName, sendWebPush, type PushResult, type VapidKeys } from "./web-push.ts";

/**
 * La cola de los avisos en el celular (spec 013, R6), como la de los emails (notifications +
 * mailer.ts):
 * 1. **Poner en cola:** quien provoca el aviso llama a `queuePush` dentro de su transacción, un aviso
 *    por aparato. Si la operación se deshace, el aviso también. Va en un punto de guardado: si algo
 *    falla (p. ej. falta la migración 040), se anota en el registro y la reserva sigue igual (RF-011).
 * 2. **Enviar al momento:** `schedulePushDelivery`, 1 s después y sin retrasar la respuesta (en Vercel
 *    con waitUntil; en Lambda, `flushPushDelivery` al responder).
 * 3. **Lo que no salió** lo reintenta el cron a los 1, 5, 15 y 60 minutos, hasta 24 h. Un aparato que
 *    el servicio de avisos da por desaparecido (404 o 410) se borra solo (RF-008).
 *
 * Los registros nunca escriben el título, el texto ni la dirección de un aparato: sólo el servicio
 * (fcm.googleapis.com) y el código de respuesta (los del cron son públicos).
 */

/**
 * A quién va un aviso: el propietario del negocio en este momento, un profesional del negocio (spec 017)
 * o los super admin (R5).
 */
export type PushAudience =
  | {
      /** Los aparatos de quien sea hoy `businesses.owner_id` (con su cuenta activa y el negocio activo). */
      ownerOf: string;
      /** Quien provocó el aviso no se avisa a sí mismo (p. ej. «Cita nueva en tu agenda» que agendó él). */
      excludeUserId?: string | null;
    }
  | {
      /**
       * Los aparatos de esta persona (el resumen de las 8 de su agenda, spec 017), si su cuenta sigue
       * activa y sigue en el equipo de `businessId` con el rol Profesional, con el negocio activo. El
       * super admin en modo soporte nunca lo es: no recibe los del profesional.
       */
      userOf: string;
      businessId: string;
    }
  | { platform: true };

/** Un aviso ya armado, con el paciente a medias (ver push-notices.ts). */
export interface PushMessageInput {
  kind: PushKind;
  title: string;
  body: string;
  /** Ruta del propio sitio que abre al tocarlo ("/dashboard/calendar?date=…&appointment=…"). */
  url: string;
  /** Identificador del aviso en la pantalla: el mismo reemplaza al anterior en vez de sumarse. */
  tag: string;
  urgency: "normal" | "high";
  /** Avisos que salen una sola vez por aparato (los del cron); null en los demás. */
  dedupeKey?: string | null;
}

/** Lo que cabe en la pantalla del celular: el texto se corta a 240 caracteres. */
const MAX_TITLE = 120;
const MAX_BODY = 240;
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * La parte de la consulta que elige los aparatos del destinatario ($1: negocio, $2: tipo, $3: quién lo
 * provocó, o la persona con `userOf`).
 */
function recipientsSql(audience: PushAudience): string {
  return `from push_subscriptions s
          join users u on u.id = s.user_id and u.is_active
         where s.signed_out_at is null
           and not ($2 = any (s.muted_kinds))
           and ${
             "ownerOf" in audience
               ? `u.id = (select b.owner_id from businesses b where b.id = $1::uuid and b.status = 'active')
                  and ($3::uuid is null or u.id <> $3::uuid)`
               : "userOf" in audience
                 ? `u.id = $3::uuid
                    and exists (select 1 from business_users bu join businesses b on b.id = bu.business_id and b.status = 'active'
                                 where bu.business_id = $1::uuid and bu.user_id = u.id and bu.role = 'professional')`
                 : "u.platform_role = 'super_admin' and $1::uuid is null and $3::uuid is null"
           }`;
}

const recipientParams = (audience: PushAudience, kind: PushKind) =>
  "ownerOf" in audience
    ? [audience.ownerOf, kind, audience.excludeUserId ?? null]
    : "userOf" in audience
      ? [audience.businessId, kind, audience.userOf]
      : [null, kind, null];

/**
 * ¿Alguien recibiría este tipo de aviso? Casi ningún negocio tiene aparatos: así sólo se arma el texto
 * (otra consulta) cuando hace falta.
 */
export async function hasPushRecipients(db: Db, audience: PushAudience, kind: PushKind): Promise<boolean> {
  return Boolean(await one(db, `select 1 ${recipientsSql(audience)} limit 1`, recipientParams(audience, kind)));
}

/** Un aviso por cada aparato del destinatario que lo quiere. Devuelve cuántos quedaron en cola. */
export async function insertPush(db: Db, audience: PushAudience, message: PushMessageInput): Promise<number> {
  const rows = await many<{ id: string }>(
    db,
    `insert into push_messages (subscription_id, business_id, kind, title, body, url, tag, urgency, dedupe_key)
     select s.id, $1::uuid, $2, $4, $5, $6, $7, $8, $9
       ${recipientsSql(audience)}
     on conflict (subscription_id, dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [
      ...recipientParams(audience, message.kind),
      clip(message.title, MAX_TITLE),
      clip(message.body, MAX_BODY),
      message.url,
      message.tag,
      message.urgency,
      message.dedupeKey ?? null,
    ],
  );
  return rows.length;
}

/** Qué falló, sin datos: el código de PostgreSQL y el mensaje (sin emails). */
function describeError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[email]").slice(0, 200) : "error";
  return typeof code === "string" ? `${code} ${text}` : text;
}

/**
 * Ejecuta `work` (armar el aviso y ponerlo en cola) sin que un fallo afecte a quien lo provoca: dentro
 * de una transacción (lo normal) trabaja en un punto de guardado; si falla, vuelve a él, lo anota en el
 * registro sin datos y la transacción sigue (la reserva y sus emails se guardan igual, RF-011).
 * `inTransaction: false` para el cron, que trabaja contra el pool. Devuelve cuántos avisos quedaron en
 * cola (0 también si falló) y, si hay alguno, pide el envío.
 */
export async function guardedPush(
  db: Db,
  label: string,
  work: () => Promise<number>,
  options: { inTransaction?: boolean } = {},
): Promise<number> {
  const inTransaction = options.inTransaction ?? true;
  let savepoint = false;
  try {
    if (inTransaction) {
      await db.query("savepoint aviso_celular");
      savepoint = true;
    }
    const queued = await work();
    if (savepoint) await db.query("release savepoint aviso_celular");
    if (queued > 0) schedulePushDelivery();
    return queued;
  } catch (error) {
    if (savepoint) await db.query("rollback to savepoint aviso_celular").catch(() => undefined);
    console.error(`[avisos] No se pudo poner en cola el aviso en el celular (${label}): ${describeError(error)}`);
    return 0;
  }
}

/** Pone en cola un aviso ya armado para cada aparato del destinatario (ver guardedPush). */
export async function queuePush(
  db: Db,
  audience: PushAudience,
  message: PushMessageInput,
  options: { inTransaction?: boolean } = {},
): Promise<number> {
  return guardedPush(db, message.kind, () => insertPush(db, audience, message), options);
}

/* ------------------------------------------------------------------ Envío -- */

/** Avisos que se toman de la cola en cada lote, y cuántos se envían a la vez. */
const BATCH_SIZE = 20;
const PARALLEL = 5;
/** Un lote queda reservado este tiempo mientras se envía: si el proceso muere, vuelve a la cola. */
const CLAIM_MINUTES = 2;
/** Reintentos a los 1, 5, 15 y 60 minutos (y cada hora después), mientras no pasen 24 h. */
const RETRY_MINUTES = [1, 5, 15, 60];
/** Lo que pida el servicio con Retry-After, como mucho 1 h. */
const MAX_RETRY_AFTER_SECONDS = 3600;
/** Rechazos seguidos (400, 401, 403, 413) con los que se borra el aparato. */
const MAX_DEVICE_FAILURES = 5;
/**
 * Un aparato guardado hace menos de esto (al activar o al abrir el panel) no se da de baja por un 404 o
 * 410: el servicio de Google lo responde a veces justo después de suscribirse y unos segundos después
 * acepta el aviso (comprobado con Chrome en local, 2026-10-14). Se reintenta como un fallo pasajero.
 */
export const FRESH_DEVICE_MS = 2 * 60_000;

/** El aparato se guardó hace menos de FRESH_DEVICE_MS. */
export const isFreshDevice = (savedAt: string | Date, now = Date.now()) => now - new Date(savedAt).getTime() < FRESH_DEVICE_MS;
/** Envío al momento en la API: 5 s para empezar envíos; lo que no salga lo envía el cron. */
const FLUSH_BUDGET_MS = 5_000;

/** Resultado de una pasada por la cola (el cron lo resume en su registro). */
export interface PushQueueReport {
  sent: number;
  /** Fallaron y se reintentarán (429, 5xx, sin red). */
  retrying: number;
  /** Rechazados por el servicio (400, 401, 403, 413) o caducados (24 h). */
  failed: number;
  /** Aparatos borrados: ya no existen (404, 410) o el servicio los rechazó 5 veces seguidas. */
  removedDevices: number;
  /** Qué falló, sin datos: "fcm.googleapis.com, 403" (hasta 5 distintos). */
  errors: string[];
}

export const emptyPushReport = (): PushQueueReport => ({ sent: 0, retrying: 0, failed: 0, removedDevices: 0, errors: [] });

interface ClaimedPush {
  id: string;
  subscriptionId: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  urgency: "normal" | "high";
  attempts: number;
  /** Segundos que le quedan de sus 24 h (el TTL del envío). */
  ttl: number;
  /** Cuándo se guardó el aparato por última vez (ver FRESH_DEVICE_MS). */
  deviceSavedAt: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Los avisos que ya no van a salir: los de más de 24 h quedan «Caducó» y los de un aparato en pausa
 * (se cerró la sesión), descartados. Devuelve cuántos caducaron.
 */
async function discardStale(): Promise<number> {
  const row = await one<{ expired: number }>(
    pool,
    `with discarded as (
       update push_messages m
          set status = 'failed',
              last_error = case when m.expires_at <= now() then 'Caducó: no salió en 24 horas.'
                                else 'Descartado: el aparato está en pausa (se cerró la sesión).' end
         from push_subscriptions s
        where s.id = m.subscription_id and m.status = 'queued'
          and (m.expires_at <= now() or s.signed_out_at is not null)
    returning m.expires_at <= now() as expired)
     select count(*) filter (where expired)::int as expired from discarded`,
  );
  return row?.expired ?? 0;
}

/** Toma hasta BATCH_SIZE avisos listos (los más antiguos) y los reserva CLAIM_MINUTES; cuenta el intento. */
async function claimBatch(): Promise<ClaimedPush[]> {
  return many<ClaimedPush>(
    pool,
    `with claimed as (
       update push_messages
          set attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => $2)
        where id in (
          select m.id from push_messages m
           where m.status = 'queued' and m.next_attempt_at <= now() and m.expires_at > now()
           order by m.created_at
           limit $1
             for update skip locked)
    returning id, subscription_id, kind, title, body, url, tag, urgency, attempts, expires_at, created_at
     )
     select c.id, c.subscription_id as "subscriptionId", c.kind, c.title, c.body, c.url, c.tag, c.urgency, c.attempts,
            greatest(0, floor(extract(epoch from c.expires_at - now())))::int as ttl,
            s.endpoint, s.p256dh, s.auth, s.updated_at as "deviceSavedAt"
       from claimed c join push_subscriptions s on s.id = c.subscription_id
      order by c.created_at`,
    [BATCH_SIZE, CLAIM_MINUTES],
  );
}

/** Reservados que no se llegaron a enviar (se acabó el tiempo): vuelven a la cola ya mismo. */
async function release(messages: ClaimedPush[]): Promise<void> {
  if (messages.length === 0) return;
  await pool.query("update push_messages set attempts = attempts - 1, next_attempt_at = now() where id = any($1::uuid[])", [
    messages.map((message) => message.id),
  ]);
}

/** Borra el aparato y, en cascada, sus avisos pendientes. */
async function removeDevice(subscriptionId: string): Promise<boolean> {
  const result = await pool.query("delete from push_subscriptions where id = $1", [subscriptionId]);
  return (result.rowCount ?? 0) > 0;
}

function noteError(report: PushQueueReport, summary: string): void {
  if (report.errors.length < 5 && !report.errors.includes(summary)) report.errors.push(summary);
}

/** Envía un aviso ya reservado y guarda el resultado al momento. */
async function deliver(message: ClaimedPush, vapid: VapidKeys, report: PushQueueReport): Promise<void> {
  const service = pushServiceName(message.endpoint);
  // Segunda barrera (la primera, al guardar el aparato): nunca un POST fuera de los servicios de avisos.
  if (!isAllowedPushEndpoint(message.endpoint, { allowLocal: config.pushAllowsLocalEndpoints })) {
    if (await removeDevice(message.subscriptionId)) report.removedDevices++;
    console.warn(`[avisos] Aparato dado de baja: su servicio de avisos no está permitido (${service}).`);
    return;
  }
  let result: PushResult;
  try {
    result = await sendWebPush(
      message,
      { title: message.title, body: message.body, url: message.url, tag: message.tag, kind: message.kind },
      { vapid, ttlSeconds: message.ttl, urgency: message.urgency },
    );
  } catch (error) {
    result = { outcome: "rejected", status: 0, error: describeError(error) };
  }
  // Recién activado: un 404 o 410 todavía no quiere decir que ya no exista (FRESH_DEVICE_MS).
  if (result.outcome === "gone" && isFreshDevice(message.deviceSavedAt)) {
    result = { outcome: "retry", status: result.status, retryAfterSeconds: null, error: `Respondió ${result.status} con el aparato recién activado` };
  }

  switch (result.outcome) {
    case "sent":
      await pool.query("update push_messages set status = 'sent', sent_at = now(), last_error = null where id = $1", [message.id]);
      await pool.query("update push_subscriptions set failures = 0 where id = $1 and failures <> 0", [message.subscriptionId]);
      report.sent++;
      return;
    case "gone":
      // Desinstaló la app o borró los datos del navegador: se deja de usar solo (RF-008).
      if (await removeDevice(message.subscriptionId)) report.removedDevices++;
      console.info(`[avisos] Aparato dado de baja: ya no existe (${service}, ${result.status}).`);
      return;
    case "retry": {
      const seconds = Math.min(
        MAX_RETRY_AFTER_SECONDS,
        result.retryAfterSeconds ?? RETRY_MINUTES[Math.min(message.attempts, RETRY_MINUTES.length) - 1] * 60,
      );
      await pool.query("update push_messages set next_attempt_at = now() + make_interval(secs => $2), last_error = $3 where id = $1", [
        message.id,
        Math.max(30, seconds),
        result.error,
      ]);
      report.retrying++;
      noteError(report, `${service}, ${result.status ?? "sin respuesta"}`);
      console.warn(`[avisos] ${service} no respondió bien (${result.status ?? "sin respuesta"}): se reintentará.`);
      return;
    }
    case "rejected": {
      await pool.query("update push_messages set status = 'failed', last_error = $2 where id = $1", [message.id, result.error]);
      report.failed++;
      noteError(report, `${service}, ${result.status}`);
      const device = await one<{ failures: number }>(
        pool,
        "update push_subscriptions set failures = failures + 1 where id = $1 returning failures",
        [message.subscriptionId],
      );
      // Cinco rechazos seguidos: p. ej. cambiaron las claves VAPID y el aparato se suscribió con las anteriores.
      if (device && device.failures >= MAX_DEVICE_FAILURES && (await removeDevice(message.subscriptionId))) report.removedDevices++;
      console.warn(`[avisos] ${service} rechazó un aviso (${result.status}).`);
      return;
    }
  }
}

let processing = false;
let pendingRun = false;

/**
 * Envía los avisos en cola que ya toca enviar, de 5 en 5. Si ya está trabajando, se repite al terminar
 * (y devuelve un resumen vacío). `deadline` (Date.now()): a partir de ahí no empieza envíos nuevos (lo
 * reservado vuelve a la cola). Sin claves VAPID no envía nada: los avisos esperan en cola y caducan.
 */
export async function processPushQueue(options: { deadline?: number; maxBatches?: number } = {}): Promise<PushQueueReport> {
  const report = emptyPushReport();
  const vapid = config.webPush;
  if (!vapid) return report;
  if (processing) {
    pendingRun = true;
    return report;
  }
  processing = true;
  const hasTime = () => options.deadline === undefined || Date.now() < options.deadline;
  let batches = 0;
  try {
    report.failed += await discardStale();
    do {
      pendingRun = false;
      const batch = await claimBatch();
      for (let index = 0; index < batch.length; index += PARALLEL) {
        if (!hasTime()) {
          await release(batch.slice(index));
          break;
        }
        await Promise.all(batch.slice(index, index + PARALLEL).map((message) => deliver(message, vapid, report)));
      }
      batches++;
      // Lote completo: puede haber más en cola.
      if (batch.length === BATCH_SIZE) pendingRun = true;
    } while (pendingRun && hasTime() && batches < (options.maxBatches ?? Number.POSITIVE_INFINITY));
  } catch (error) {
    console.error(`[avisos] Error al procesar la cola de avisos en el celular: ${describeError(error)}`);
    noteError(report, "error al procesar la cola");
  } finally {
    processing = false;
  }
  return report;
}

let scheduled: NodeJS.Timeout | null = null;
/** Lambda: esta petición puso avisos en cola (se envían al responder). */
let deliveryRequested = false;
let immediateDelivery = true;

/** Para el cron de GitHub: envía él mismo, al final, todo lo que pone en cola. */
export function disableImmediatePushDelivery(): void {
  immediateDelivery = false;
}

/**
 * Pide un envío en breve. Se llama al poner un aviso en cola: el segundo de espera deja que termine la
 * transacción que lo creó (si aún no terminó, lo recoge la pasada siguiente o el cron). Nunca retrasa
 * la respuesta: en Vercel, waitUntil mantiene viva la función hasta enviar.
 */
export function schedulePushDelivery(): void {
  if (!config.webPush || !immediateDelivery) return;
  if (config.onLambda) {
    deliveryRequested = true;
    return;
  }
  if (scheduled) return;
  const delivery = new Promise<void>((resolve) => {
    scheduled = setTimeout(() => {
      scheduled = null;
      void processPushQueue({ deadline: Date.now() + FLUSH_BUDGET_MS, maxBatches: 1 }).finally(() => resolve());
    }, 1_000);
  });
  if (config.onVercel) waitUntil(delivery);
}

/**
 * Lambda congela la ejecución al responder: los avisos que la petición puso en cola se envían justo
 * antes (lo llama app.ts, junto a los emails). Sin avisos pendientes no hace nada.
 */
export async function flushPushDelivery(): Promise<void> {
  if (!deliveryRequested) return;
  deliveryRequested = false;
  await processPushQueue({ deadline: Date.now() + FLUSH_BUDGET_MS, maxBatches: 1 }).catch((error: unknown) =>
    console.error(`[avisos] No se pudieron enviar al responder: ${describeError(error)}`),
  );
}

/* --------------------------------------------------------------- Limpieza -- */

/** Días que se guardan los avisos (con cualquier estado) y los aparatos en pausa. */
export const PUSH_MESSAGE_DAYS = 7;
export const PAUSED_DEVICE_DAYS = 90;

/** Limpieza del cron: avisos de más de 7 días y aparatos en pausa hace más de 90. */
export async function cleanupPush(): Promise<{ messages: number; devices: number }> {
  const messages = await pool.query("delete from push_messages where created_at < now() - make_interval(days => $1)", [PUSH_MESSAGE_DAYS]);
  const devices = await pool.query("delete from push_subscriptions where signed_out_at < now() - make_interval(days => $1)", [
    PAUSED_DEVICE_DAYS,
  ]);
  return { messages: messages.rowCount ?? 0, devices: devices.rowCount ?? 0 };
}
