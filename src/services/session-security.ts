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
 * memoria de cada servidor), así que valen para todas las instancias de Vercel a la vez.
 */
export const LOCKOUT_MINUTES = 15;
/** Fallos en LOCKOUT_MINUTES que bloquean una cuenta (exista o no: no revela qué emails existen). */
const MAX_FAILURES_PER_ACCOUNT = 10;
/** Fallos en LOCKOUT_MINUTES que bloquean una conexión, pruebe la cuenta que pruebe. */
const MAX_FAILURES_PER_IP = 50;

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
 * ¿Demasiados intentos fallidos recientes con esta cuenta (desde su último inicio de sesión
 * correcto) o desde esta conexión?
 */
export async function isLockedOut(userId: string | null, email: string, ip: string): Promise<boolean> {
  const row = await one<{ account: number; ip: number }>(
    pool,
    `select count(*) filter (
              where (actor_id = $1::uuid or (actor_id is null and lower(actor_name) = lower($2)))
                and created_at > coalesce(
                  (select max(s.created_at) from audit_logs s
                    where s.entity_type = 'session' and s.action = 'session.login' and s.actor_id = $1::uuid),
                  '-infinity')
            )::int as account,
            count(*) filter (where ip = $3)::int as ip
       from audit_logs
      where entity_type = 'session' and action = 'session.login_failed'
        and created_at > now() - make_interval(mins => $4)`,
    [userId, email, ip, LOCKOUT_MINUTES],
  );
  return (row?.account ?? 0) >= MAX_FAILURES_PER_ACCOUNT || (row?.ip ?? 0) >= MAX_FAILURES_PER_IP;
}

/** Error de cuenta o conexión bloqueada (mismo mensaje exista o no la cuenta). */
export function lockedOutError(): AppError {
  return new AppError(
    "rate_limited",
    `Demasiados intentos fallidos. Por seguridad, espera ${LOCKOUT_MINUTES} minutos antes de volver a intentarlo.`,
  );
}
