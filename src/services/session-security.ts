import { createHash } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import { one, pool, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import { getFullName } from "../shared/lib/format.ts";
import type { User } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import type { AuditActor } from "./context.ts";

/**
 * Seguridad de los inicios de sesión, compartida por la contraseña y la verificación en dos
 * pasos: los eventos de sesión en la auditoría y el bloqueo por intentos fallidos.
 */

/**
 * Bloqueo ante intentos de adivinar contraseñas. Los fallos se cuentan en la auditoría (no en la
 * memoria de cada servidor), así que valen para todas las instancias a la vez. Se frena a la
 * conexión que falla, no a la cuenta: el email del dueño es público y cualquiera podría dejarlo
 * fuera a propósito.
 */
export const LOCKOUT_MINUTES = 15;
/**
 * Fallos en LOCKOUT_MINUTES con una cuenta desde una misma conexión que la bloquean para esa cuenta
 * (exista o no: no revela qué emails existen). Desde otra conexión, el dueño sigue entrando.
 */
const MAX_FAILURES_PER_ACCOUNT_AND_IP = 10;
/** Fallos en LOCKOUT_MINUTES que bloquean una conexión, pruebe la cuenta que pruebe. */
const MAX_FAILURES_PER_IP = 50;
/**
 * Fallos con una cuenta en LOCKOUT_MINUTES sumando todas las conexiones (un ataque repartido entre
 * muchas IP): a partir de ahí sólo se puede intentar desde conexiones en las que la cuenta ya inició
 * sesión antes (los eventos de sesión se guardan 90 días). El dueño, desde las de siempre, entra.
 */
const MAX_FAILURES_PER_ACCOUNT = 30;
/**
 * Intentos con una cuenta en 24 horas desde conexiones nuevas para ella (revisión de seguridad 2026-11-18): el tope de
 * 15 minutos se reiniciaba y dejaba probar unas 2.900 contraseñas al día. Desde una conexión o un navegador donde la
 * cuenta ya entró (dispositivo de confianza, trusted-device.ts) no cuenta.
 */
const MAX_ATTEMPTS_PER_ACCOUNT_PER_DAY = 100;
/** Intentos de hoy con una cuenta desde conexiones nuevas a partir de los cuales se pide el CAPTCHA. */
export const CAPTCHA_AFTER_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60_000;

/** Desde dónde se conecta (IP y navegador). Sólo se guarda en los eventos de sesión. */
export interface ClientConnection {
  ip: string;
  userAgent: string | null;
  /** La cookie del dispositivo de confianza (trusted-device.ts), si la trae. No se guarda. */
  deviceToken?: string | null;
}

/**
 * Inicio y cierre de sesión e intentos fallidos, en la auditoría (entityType "session"). Sólo los
 * ve el super admin; el cron avisa por ntfy si una cuenta acumula intentos fallidos.
 */
export async function logSessionEvent(
  user: User | null,
  event: { action: string; summary: string; attemptedEmail?: string },
  connection: ClientConnection,
  /** Dentro de una transacción que bloquea la fila del usuario, ésa (si no, espera a sí misma). */
  db: Db = pool,
): Promise<void> {
  const membership = user
    ? await one<{ businessId: string }>(db, 'select business_id as "businessId" from business_users where user_id = $1 limit 1', [
        user.id,
      ])
    : null;
  const actor: AuditActor | null = user
    ? { userId: user.id, name: user.platformRole === "super_admin" ? `${getFullName(user)} (Super admin)` : getFullName(user) }
    : null;
  await logAudit(db, {
    businessId: membership?.businessId ?? null,
    actor,
    actorName: event.attemptedEmail?.slice(0, 120),
    action: event.action,
    entityType: "session",
    entityId: user?.id ?? null,
    summary: event.summary,
    connection,
  });
}

/**
 * ¿Demasiados intentos fallidos recientes con esta cuenta desde esta conexión (desde su último
 * inicio de sesión correcto), desde esta conexión con cualquier cuenta, o con esta cuenta desde
 * muchas conexiones y ésta es nueva para ella?
 */
export async function isLockedOut(userId: string | null, email: string, ip: string): Promise<boolean> {
  const row = await one<{ account: number; accountFromIp: number; ip: number; knownIp: boolean }>(
    pool,
    `with failures as (
       select ip,
              coalesce(actor_id = $1::uuid or (actor_id is null and lower(actor_name) = lower($2)), false)
                and created_at > coalesce(
                  (select max(s.created_at) from audit_logs s
                    where s.entity_type = 'session' and s.action = 'session.login' and s.actor_id = $1::uuid),
                  '-infinity') as own
         from audit_logs
        where entity_type = 'session' and action = 'session.login_failed'
          and created_at > now() - make_interval(mins => $4)
     )
     select count(*) filter (where own)::int as account,
            count(*) filter (where own and ip = $3)::int as "accountFromIp",
            count(*) filter (where ip = $3)::int as ip,
            exists (
              select 1 from audit_logs k
               where k.entity_type = 'session' and k.action = 'session.login' and k.actor_id = $1::uuid and k.ip = $3
            ) as "knownIp"
       from failures`,
    [userId, email, ip, LOCKOUT_MINUTES],
  );
  if (!row) return false;
  return (
    row.accountFromIp >= MAX_FAILURES_PER_ACCOUNT_AND_IP ||
    row.ip >= MAX_FAILURES_PER_IP ||
    (row.account >= MAX_FAILURES_PER_ACCOUNT && !row.knownIp)
  );
}

/**
 * Intento de acceso (contraseña o código) apartado ANTES de comprobarlo (spec 009). isLockedOut lee
 * los fallos ya anotados: con muchos intentos a la vez, todos lo pasaban antes de que se anotara el
 * primero. Estos contadores se suman de forma atómica (tabla rate_limits, compartida por todas las
 * instancias), así que de cien intentos simultáneos sólo pasan los que permite el tope. Los topes son
 * los mismos que los de isLockedOut, que se sigue comprobando igual.
 */
export interface AttemptReservation {
  /** Pasó de algún tope: no se comprueba nada y se responde lockedOutError(). */
  locked: boolean;
  /**
   * Inició sesión o acertó la contraseña: los fallos de la cuenta vuelven a cero (como isLockedOut,
   * que cuenta desde el último inicio de sesión) y este intento deja de contar para la conexión. Con
   * la verificación en dos pasos, sólo al acertar también el código: si no, quien sepa la contraseña
   * volvería a tener todos los intentos de código cada vez que la escribe.
   */
  succeeded(): Promise<void>;
}

/** Huella del email para las claves de los contadores (no se guardan emails en rate_limits). */
const accountKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

/** ¿La cuenta ya inició sesión desde esta conexión (IP)? */
export async function isKnownConnection(userId: string | null, ip: string): Promise<boolean> {
  return userId
    ? Boolean(
        await one(
          pool,
          "select 1 from audit_logs where entity_type = 'session' and action = 'session.login' and actor_id = $1 and ip = $2 limit 1",
          [userId, ip],
        ),
      )
    : false;
}

/** Intentos de hoy con la cuenta desde conexiones nuevas (sin sumar): para decidir si se pide el CAPTCHA. */
export async function accountAttemptsToday(email: string): Promise<number> {
  const row = await one<{ hits: number }>(pool, "select hits from rate_limits where key = $1 and reset_at > now()", [
    `acceso:cuenta-dia:${accountKey(email)}`,
  ]);
  return row?.hits ?? 0;
}

/**
 * `known`: la cuenta ya entró desde esta conexión o este navegador (dispositivo de confianza). Si no se indica, se mira
 * sólo la conexión.
 */
export async function reserveAttempt(email: string, ip: string, userId: string | null, known?: boolean): Promise<AttemptReservation> {
  const account = accountKey(email);
  // La misma clave de conexión que los límites de peticiones: IPv4 una a una e IPv6 por subred /64.
  const connection = ipKeyGenerator(ip, 64);
  const keys = {
    accountFromIp: `acceso:cuenta-ip:${account}:${connection}`,
    ip: `acceso:ip:${connection}`,
    account: `acceso:cuenta:${account}`,
    accountDay: `acceso:cuenta-dia:${account}`,
  };
  // Desde una conexión (o un navegador) donde la cuenta ya inició sesión no cuentan los topes repartidos entre muchas IP.
  const knownIp = known ?? (await isKnownConnection(userId, ip));
  const windowMs = LOCKOUT_MINUTES * 60_000;
  const locked: AttemptReservation = { locked: true, succeeded: async () => undefined };
  // De lo más estrecho a lo más amplio, y parando en el primer tope: lo que ya frenó la conexión no
  // suma en la cuenta. Si no, desde una sola IP se podría dejar fuera al dueño en sus conexiones
  // nuevas, y el bloqueo es para la conexión que falla, no para la cuenta.
  if ((await incrementCounter(pool, keys.accountFromIp, windowMs)).hits > MAX_FAILURES_PER_ACCOUNT_AND_IP) return locked;
  if ((await incrementCounter(pool, keys.ip, windowMs)).hits > MAX_FAILURES_PER_IP) return locked;
  if (!knownIp && (await incrementCounter(pool, keys.account, windowMs)).hits > MAX_FAILURES_PER_ACCOUNT) return locked;
  if (!knownIp && (await incrementCounter(pool, keys.accountDay, DAY_MS)).hits > MAX_ATTEMPTS_PER_ACCOUNT_PER_DAY) return locked;
  return {
    locked: false,
    async succeeded() {
      await pool.query("delete from rate_limits where key = any($1::text[])", [[keys.accountFromIp, keys.account, keys.accountDay]]);
      await pool.query("update rate_limits set hits = greatest(hits - 1, 0) where key = $1", [keys.ip]);
    },
  };
}

/**
 * Contraseña o código pedidos con la sesión abierta (cambiar el email o la contraseña, desactivar la
 * verificación, códigos de recuperación nuevos): cuentan para el mismo bloqueo que el inicio de
 * sesión, así que con una sesión robada tampoco se puede adivinar la contraseña (spec 009). Bloqueada,
 * lanza lockedOutError() sin comprobar nada; si no, devuelve el intento apartado.
 */
export async function startSessionCheck(user: User, connection: ClientConnection): Promise<AttemptReservation> {
  const locked = await isLockedOut(user.id, user.email, connection.ip);
  const attempt = locked ? null : await reserveAttempt(user.email, connection.ip, user.id);
  if (!attempt || attempt.locked) {
    await logSessionEvent(
      user,
      { action: "session.login_locked", summary: "Comprobación de la contraseña bloqueada temporalmente por demasiados intentos fallidos" },
      connection,
    );
    throw lockedOutError();
  }
  return attempt;
}

/** El fallo de una comprobación con la sesión abierta, en los eventos de sesión (cuenta para el bloqueo). */
export async function recordFailedSessionCheck(user: User, connection: ClientConnection, summary: string): Promise<void> {
  await logSessionEvent(user, { action: "session.login_failed", summary }, connection);
}

/** Error de cuenta o conexión bloqueada (mismo mensaje exista o no la cuenta). */
export function lockedOutError(): AppError {
  return new AppError(
    "rate_limited",
    `Demasiados intentos fallidos. Por seguridad, espera ${LOCKOUT_MINUTES} minutos antes de volver a intentarlo.`,
  );
}
