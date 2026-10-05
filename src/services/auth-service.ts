import { createHash, randomBytes } from "node:crypto";
import { userColumns } from "../db/columns.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { formatSupportContact, getFullName } from "../shared/lib/format.ts";
import { changePasswordSchema, loginSchema, registerSchema } from "../shared/lib/validations/auth.ts";
import type { BusinessRole, BusinessStatus, PlatformRole, User } from "../shared/types/index.ts";
import { hashPassword, verifyPassword } from "./accounts.ts";
import { logAudit } from "./audit.ts";
import { parseInput, requireUser, type AuditActor, type RequestContext } from "./context.ts";
import { queueEmail } from "./notifications.ts";
import { getPlatformSettings } from "./platform-settings.ts";

/** Lo que el frontend necesita saber de la sesión (igual que `Session` en agenda-front/src/lib/auth/types.ts). */
export interface Session {
  userId: string;
  businessId: string | null;
  role: BusinessRole | null;
  businessStatus: BusinessStatus | null;
  platformRole: PlatformRole | null;
  /** Puede ver historias clínicas: propietario o miembro autorizado (el super admin, en modo soporte). */
  clinicalAccess: boolean;
}

/** Token de sesión recién emitido: la ruta lo guarda en una cookie httpOnly. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  /** "Recordarme": la cookie sobrevive al cierre del navegador. */
  persistent: boolean;
}

const REMEMBER_DAYS = 30;
const SESSION_HOURS = 24;

/**
 * Bloqueo ante intentos de adivinar contraseñas. Los fallos se cuentan en la auditoría (no en la
 * memoria de cada servidor), así que valen para todas las instancias de Vercel a la vez.
 */
const LOCKOUT_MINUTES = 15;
/** Fallos en LOCKOUT_MINUTES que bloquean una cuenta (exista o no: no revela qué emails existen). */
const MAX_FAILURES_PER_ACCOUNT = 10;
/** Fallos en LOCKOUT_MINUTES que bloquean una conexión, pruebe la cuenta que pruebe. */
const MAX_FAILURES_PER_IP = 50;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hash de referencia para que un email inexistente tarde lo mismo que una contraseña incorrecta. */
const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString("hex"));

const withoutPassword = ({ passwordHash: _, ...user }: User & { passwordHash: string }): User => user;

/** Desde dónde se conecta (IP y navegador). Sólo se guarda en los eventos de sesión. */
export interface ClientConnection {
  ip: string;
  userAgent: string | null;
}

/**
 * Inicio y cierre de sesión e intentos fallidos, en la auditoría (entityType "session"). Sólo los
 * ve el super admin; el cron avisa por ntfy si una cuenta acumula intentos fallidos.
 */
async function logSessionEvent(
  user: User | null,
  event: { action: string; summary: string; attemptedEmail?: string },
  connection: ClientConnection,
): Promise<void> {
  const membership = user
    ? await one<{ businessId: string }>(pool, 'select business_id as "businessId" from business_users where user_id = $1 limit 1', [
        user.id,
      ])
    : null;
  const actor: AuditActor | null = user
    ? { userId: user.id, name: user.platformRole === "super_admin" ? `${getFullName(user)} (Super admin)` : getFullName(user) }
    : null;
  await logAudit(pool, {
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
async function isLockedOut(userId: string | null, email: string, ip: string): Promise<boolean> {
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

async function createSession(db: Db, userId: string, remember: boolean): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000));
  await db.query("insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)", [
    userId,
    sha256(token),
    expiresAt,
  ]);
  return { token, expiresAt, persistent: remember };
}

/** Busca la sesión de la cookie. Devuelve null si no existe o caducó. */
export async function findSessionByToken(token: string): Promise<RequestContext | null> {
  const row = await one<User & { sessionId: string }>(
    pool,
    `select s.id as "sessionId", ${userColumns("u")}
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  const { sessionId, ...user } = row;
  return { user, sessionId };
}

async function resolveSession(db: Db, user: User): Promise<Session | null> {
  if (!user.isActive) return null;
  const membership = await one<{ businessId: string; role: BusinessRole; status: BusinessStatus; clinicalAccess: boolean }>(
    db,
    `select bu.business_id as "businessId", bu.role, b.status, bu.clinical_access as "clinicalAccess"
       from business_users bu
       join businesses b on b.id = bu.business_id
      where bu.user_id = $1
      order by bu.created_at
      limit 1`,
    [user.id],
  );
  return {
    userId: user.id,
    businessId: membership?.businessId ?? null,
    role: membership?.role ?? null,
    businessStatus: membership?.status ?? null,
    platformRole: user.platformRole,
    clinicalAccess: membership ? membership.role === "owner" || membership.clinicalAccess : false,
  };
}

export const authService = {
  async getSession(ctx: RequestContext): Promise<Session | null> {
    return ctx.user ? resolveSession(pool, ctx.user) : null;
  },

  async signIn(input: unknown, connection: ClientConnection): Promise<{ session: Session; issued: IssuedSession }> {
    const { email, password, remember } = parseInput(loginSchema, input);
    const row = await one<User & { passwordHash: string }>(
      pool,
      `select ${userColumns()}, password_hash as "passwordHash" from users where email = $1`,
      [email],
    );
    const user = row ? withoutPassword(row) : null;
    // Bloqueada: ni se comprueba la contraseña (aunque sea la correcta) hasta que pase el tiempo.
    if (await isLockedOut(user?.id ?? null, email, connection.ip)) {
      await logSessionEvent(
        user,
        {
          action: "session.login_locked",
          summary: "Inicio de sesión bloqueado temporalmente por demasiados intentos fallidos",
          attemptedEmail: user ? undefined : email,
        },
        connection,
      );
      throw new AppError(
        "rate_limited",
        `Demasiados intentos fallidos. Por seguridad, espera ${LOCKOUT_MINUTES} minutos antes de volver a intentarlo.`,
      );
    }
    const valid = await verifyPassword(password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      await logSessionEvent(
        user,
        user
          ? { action: "session.login_failed", summary: "Intento de inicio de sesión fallido: contraseña incorrecta" }
          : { action: "session.login_failed", summary: "Intento de inicio de sesión con un email no registrado", attemptedEmail: email },
        connection,
      );
      throw new AppError("unauthorized", "Email o contraseña incorrectos.");
    }
    if (!user.isActive) {
      await logSessionEvent(user, { action: "session.login_blocked", summary: "Intento de inicio de sesión con la cuenta desactivada" }, connection);
      const supportContact = formatSupportContact(await getPlatformSettings(pool));
      throw new AppError("forbidden", `Tu cuenta está desactivada. Escribe a ${supportContact} para recuperar el acceso.`);
    }
    const issued = await createSession(pool, user.id, remember);
    await logSessionEvent(user, { action: "session.login", summary: "Inició sesión" }, connection);
    return { session: (await resolveSession(pool, user))!, issued };
  },

  async signUp(input: unknown): Promise<{ session: Session; issued: IssuedSession }> {
    const { firstName, lastName, email, password } = parseInput(registerSchema, input);
    return transaction(async (db) => {
      // El backend lo comprueba aunque la página de registro ya oculte el formulario.
      if (!(await getPlatformSettings(db)).allowPublicSignup) {
        throw new AppError(
          "forbidden",
          "El registro de nuevas cuentas está cerrado. Contacta al administrador de la plataforma.",
        );
      }
      if (await one(db, "select 1 from users where email = $1", [email])) {
        throw new AppError("conflict", "Ya existe una cuenta con ese email. Inicia sesión.");
      }
      const user = (await one<User>(
        db,
        `insert into users (first_name, last_name, email, password_hash)
         values ($1, $2, $3, $4)
         returning ${userColumns()}`,
        [firstName, lastName, email, await hashPassword(password)],
      ))!;
      await queueEmail(db, { businessId: null, type: "welcome", to: email, ...emailTemplates.welcome(firstName) });
      const issued = await createSession(db, user.id, true);
      return { session: (await resolveSession(db, user))!, issued };
    });
  },

  async signOut(ctx: RequestContext, connection: ClientConnection): Promise<void> {
    if (!ctx.sessionId) return;
    await pool.query("delete from sessions where id = $1", [ctx.sessionId]);
    if (ctx.user) await logSessionEvent(ctx.user, { action: "session.logout", summary: "Cerró sesión" }, connection);
  },

  /**
   * Cambia la propia contraseña y cierra las demás sesiones. Sólo el super admin: las
   * contraseñas de los usuarios las pone él (para poder entrar en su cuenta si le piden ayuda).
   */
  async changePassword(ctx: RequestContext, input: unknown): Promise<void> {
    const user = requireUser(ctx);
    if (user.platformRole !== "super_admin") {
      throw new AppError("forbidden", "Tu contraseña la gestiona el soporte de la plataforma. Escríbele si necesitas cambiarla.");
    }
    const data = parseInput(changePasswordSchema, input);
    const row = await one<{ passwordHash: string }>(pool, 'select password_hash as "passwordHash" from users where id = $1', [
      user.id,
    ]);
    if (!row || !(await verifyPassword(data.currentPassword, row.passwordHash))) {
      throw new AppError("validation", "La contraseña actual no es correcta.");
    }
    await transaction(async (db) => {
      await db.query("update users set password_hash = $2 where id = $1", [user.id, await hashPassword(data.newPassword)]);
      await db.query("delete from sessions where user_id = $1 and id <> $2", [user.id, ctx.sessionId]);
    });
  },
};

/** Limpieza periódica de las sesiones caducadas. */
export async function deleteExpiredSessions(): Promise<void> {
  await pool.query("delete from sessions where expires_at <= now()");
}
