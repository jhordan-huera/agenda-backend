import { one, pool, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
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

/** Desde dónde se conecta (IP y navegador). Sólo se guarda en los eventos de sesión. */
export interface ClientConnection {
  ip: string;
  userAgent: string | null;
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

/** Error de cuenta o conexión bloqueada (mismo mensaje exista o no la cuenta). */
export function lockedOutError(): AppError {
  return new AppError(
    "rate_limited",
    `Demasiados intentos fallidos. Por seguridad, espera ${LOCKOUT_MINUTES} minutos antes de volver a intentarlo.`,
  );
}
