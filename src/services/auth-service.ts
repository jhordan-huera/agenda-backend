import { createHash, randomBytes } from "node:crypto";
import { userColumns } from "../db/columns.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { formatSupportContact } from "../shared/lib/format.ts";
import { changePasswordSchema, loginSchema, registerSchema } from "../shared/lib/validations/auth.ts";
import type { BusinessRole, BusinessStatus, PlatformRole, User } from "../shared/types/index.ts";
import { hashPassword, verifyPassword } from "./accounts.ts";
import { parseInput, requireUser, type RequestContext } from "./context.ts";
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

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hash de referencia para que un email inexistente tarde lo mismo que una contraseña incorrecta. */
const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString("hex"));

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

  async signIn(input: unknown): Promise<{ session: Session; issued: IssuedSession }> {
    const { email, password, remember } = parseInput(loginSchema, input);
    const row = await one<User & { passwordHash: string }>(
      pool,
      `select ${userColumns()}, password_hash as "passwordHash" from users where email = $1`,
      [email],
    );
    const valid = await verifyPassword(password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!row || !valid) throw new AppError("unauthorized", "Email o contraseña incorrectos.");
    const { passwordHash: _, ...user } = row;
    if (!user.isActive) {
      const supportContact = formatSupportContact(await getPlatformSettings(pool));
      throw new AppError("forbidden", `Tu cuenta está desactivada. Escribe a ${supportContact} para recuperar el acceso.`);
    }
    const issued = await createSession(pool, user.id, remember);
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

  async signOut(ctx: RequestContext): Promise<void> {
    if (ctx.sessionId) await pool.query("delete from sessions where id = $1", [ctx.sessionId]);
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
