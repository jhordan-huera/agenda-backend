import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { userColumns } from "../db/columns.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { formatSupportContact } from "../shared/lib/format.ts";
import {
  changePasswordSchema,
  loginSchema,
  passwordLinkSchema,
  registerSchema,
  setPasswordSchema,
  twoFactorLoginSchema,
} from "../shared/lib/validations/auth.ts";
import type {
  BusinessRole,
  BusinessStatus,
  PasswordLinkInfo,
  PlatformRole,
  TwoFactorChallenge,
  User,
} from "../shared/types/index.ts";
import { hashPassword, verifyPassword } from "./accounts.ts";
import { parseInput, requireUser, type RequestContext } from "./context.ts";
import { queueEmail } from "./notifications.ts";
import { findPasswordLink, revokePasswordLinks } from "./password-links.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import { isLockedOut, lockedOutError, logSessionEvent, type ClientConnection } from "./session-security.ts";
import {
  createLoginChallenge,
  findLoginChallenge,
  MAX_CHALLENGE_ATTEMPTS,
  verifySecondFactor,
} from "./two-factor.ts";

export type { ClientConnection };

/** Lo que el frontend necesita saber de la sesión (igual que `Session` en agenda-front/src/lib/auth/types.ts). */
export interface Session {
  userId: string;
  businessId: string | null;
  role: BusinessRole | null;
  businessStatus: BusinessStatus | null;
  platformRole: PlatformRole | null;
  /** Super admin principal: gestiona el equipo de super admins. */
  platformOwner: boolean;
  /** Puede ver historias clínicas: propietario o miembro autorizado (el super admin, en modo soporte). */
  clinicalAccess: boolean;
  /** Su agenda activa en el negocio, si atiende citas. */
  professionalId: string | null;
  /**
   * Super admin sin la verificación en dos pasos (obligatoria): hasta activarla, el panel /admin y el
   * modo soporte responden `two_factor_required` y el frontend le muestra la pantalla para activarla.
   */
  twoFactorSetupRequired: boolean;
}

/** Token de sesión recién emitido: la ruta lo guarda en una cookie httpOnly. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  /** "Recordarme": la cookie sobrevive al cierre del navegador. */
  persistent: boolean;
}

/**
 * Caducidad de las sesiones. Con «Recordarme», REMEMBER_DAYS sin usarla (se renueva con el uso). Sin
 * él, IDLE_HOURS sin usarla y, como mucho, MAX_SESSION_HOURS desde que se inició (la cookie, además,
 * se borra al cerrar el navegador). El último uso se anota como mucho cada RENEW_EVERY_MINUTES.
 */
const REMEMBER_DAYS = 14;
const IDLE_HOURS = 12;
const MAX_SESSION_HOURS = 24;
const RENEW_EVERY_MINUTES = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Hash de referencia para que un email inexistente tarde lo mismo que una contraseña incorrecta.
 * Fijo (de una contraseña aleatoria que nadie conoce, con el mismo coste que las reales): así no
 * se gasta CPU en calcularlo cada vez que arranca el servidor.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$xLkJUyZsnCD8ukHE6RxWguQec45gX8EGopr0e0EODO/I9dNPtdc1a";

const withoutSecrets = ({
  passwordHash: _password,
  twoFactor: _twoFactor,
  ...user
}: User & { passwordHash: string; twoFactor: boolean }): User => user;

/** Resultado del inicio de sesión: la sesión, o el paso del código si tiene la verificación en dos pasos. */
export type SignInResult = { session: Session; issued: IssuedSession } | { twoFactor: TwoFactorChallenge };

/** Cuenta desactivada: no entra, ni con la contraseña ni con el código. */
async function blockInactive(user: User, connection: ClientConnection): Promise<never> {
  await logSessionEvent(user, { action: "session.login_blocked", summary: "Intento de inicio de sesión con la cuenta desactivada" }, connection);
  const supportContact = formatSupportContact(await getPlatformSettings(pool));
  throw new AppError("forbidden", `Tu cuenta está desactivada. Escribe a ${supportContact} para recuperar el acceso.`);
}

async function createSession(db: Db, userId: string, remember: boolean): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_DAYS * 86_400_000 : IDLE_HOURS * 3_600_000));
  await db.query("insert into sessions (user_id, token_hash, expires_at, remember) values ($1, $2, $3, $4)", [
    userId,
    sha256(token),
    expiresAt,
    remember,
  ]);
  return { token, expiresAt, persistent: remember };
}

/** Sesión de la cookie y, si se acaba de renovar una con «Recordarme», su caducidad nueva (para la cookie). */
export interface FoundSession extends RequestContext {
  renewedUntil: Date | null;
}

/**
 * Busca la sesión de la cookie (null si no existe, caducó o pasó demasiado tiempo sin usarse) y
 * anota su uso: la caducidad se corre IDLE_HOURS (o REMEMBER_DAYS con «Recordarme») desde ahora.
 * Una sola consulta: se lee y, si hace falta, se renueva.
 */
export async function findSessionByToken(token: string): Promise<FoundSession | null> {
  const row = await one<
    User & { sessionId: string; remember: boolean; stale: boolean; twoFactorEnabled: boolean; renewedUntil: string | null }
  >(
    pool,
    `with found as (
       select s.id as "sessionId", s.remember, s.last_seen_at < now() - make_interval(mins => $2) as stale,
              u.two_factor_secret is not null as "twoFactorEnabled", ${userColumns("u")}
         from sessions s
         join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()
     ), renewed as (
       update sessions s
          set last_seen_at = now(),
              expires_at = case
                when s.remember then now() + make_interval(days => $3)
                else least(s.created_at + make_interval(hours => $4), now() + make_interval(hours => $5))
              end
         from found f
        where s.id = f."sessionId" and f.stale
       returning s.expires_at
     )
     select f.*, (select r.expires_at from renewed r) as "renewedUntil" from found f`,
    [sha256(token), RENEW_EVERY_MINUTES, REMEMBER_DAYS, MAX_SESSION_HOURS, IDLE_HOURS],
  );
  if (!row) return null;
  const { sessionId, remember, twoFactorEnabled, renewedUntil, stale: _stale, ...user } = row;
  return { user, sessionId, twoFactorEnabled, renewedUntil: remember && renewedUntil ? new Date(renewedUntil) : null };
}

async function resolveSession(db: Db, user: User, twoFactorEnabled: boolean): Promise<Session | null> {
  if (!user.isActive) return null;
  const membership = await one<{
    businessId: string;
    role: BusinessRole;
    status: BusinessStatus;
    clinicalAccess: boolean;
    professionalId: string | null;
  }>(
    db,
    `select bu.business_id as "businessId", bu.role, b.status, bu.clinical_access as "clinicalAccess",
            (select p.id from professionals p where p.business_id = bu.business_id and p.user_id = bu.user_id and p.is_active)
              as "professionalId"
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
    platformOwner: user.platformOwner,
    clinicalAccess: membership ? membership.role === "owner" || membership.clinicalAccess : false,
    professionalId: membership?.professionalId ?? null,
    twoFactorSetupRequired: user.platformRole === "super_admin" && config.superAdminTwoFactorRequired && !twoFactorEnabled,
  };
}

export const authService = {
  async getSession(ctx: RequestContext): Promise<Session | null> {
    return ctx.user ? resolveSession(pool, ctx.user, Boolean(ctx.twoFactorEnabled)) : null;
  },

  async signIn(input: unknown, connection: ClientConnection): Promise<SignInResult> {
    const { email, password, remember } = parseInput(loginSchema, input);
    const row = await one<User & { passwordHash: string; twoFactor: boolean }>(
      pool,
      `select ${userColumns()}, password_hash as "passwordHash", two_factor_secret is not null as "twoFactor"
         from users where email = $1`,
      [email],
    );
    const user = row ? withoutSecrets(row) : null;
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
      throw lockedOutError();
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
    if (!user.isActive) return blockInactive(user, connection);
    // Con la verificación en dos pasos, la sesión se abre al escribir el código (verifyTwoFactor).
    if (row?.twoFactor) {
      return { twoFactor: { twoFactorRequired: true, challenge: await createLoginChallenge(pool, user.id, remember) } };
    }
    const issued = await createSession(pool, user.id, remember);
    await logSessionEvent(user, { action: "session.login", summary: "Inició sesión" }, connection);
    return { session: (await resolveSession(pool, user, false))!, issued };
  },

  /**
   * Segundo paso del inicio de sesión: el código de la app o uno de recuperación. Los códigos
   * incorrectos cuentan como intentos fallidos (y para el bloqueo de la cuenta).
   */
  async verifyTwoFactor(input: unknown, connection: ClientConnection): Promise<{ session: Session; issued: IssuedSession }> {
    const { challenge: token, code } = parseInput(twoFactorLoginSchema, input);
    const challenge = await findLoginChallenge(pool, token);
    if (!challenge) throw new AppError("unauthorized", "Pasó demasiado tiempo. Vuelve a escribir tu contraseña.");
    const user = (await one<User>(pool, `select ${userColumns()} from users where id = $1`, [challenge.userId]))!;
    if (!user.isActive) {
      await pool.query("delete from login_challenges where user_id = $1", [user.id]);
      return blockInactive(user, connection);
    }
    if (await isLockedOut(user.id, user.email, connection.ip)) {
      await pool.query("delete from login_challenges where id = $1", [challenge.id]);
      await logSessionEvent(
        user,
        { action: "session.login_locked", summary: "Inicio de sesión bloqueado temporalmente por demasiados intentos fallidos" },
        connection,
      );
      throw lockedOutError();
    }

    const result = await verifySecondFactor(pool, user.id, code);
    if (!result) {
      const attempts = challenge.attempts + 1;
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) await pool.query("delete from login_challenges where id = $1", [challenge.id]);
      else await pool.query("update login_challenges set attempts = $2 where id = $1", [challenge.id, attempts]);
      await logSessionEvent(
        user,
        { action: "session.login_failed", summary: "Intento de inicio de sesión fallido: código de verificación incorrecto" },
        connection,
      );
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
        throw new AppError("unauthorized", "Demasiados códigos incorrectos. Vuelve a escribir tu contraseña.");
      }
      throw new AppError("validation", "El código no es correcto. Revisa que la hora del celular esté bien y escribe el código nuevo.");
    }

    // Cada paso intermedio sirve para una sola sesión.
    const consumed = await one(pool, "delete from login_challenges where id = $1 returning id", [challenge.id]);
    if (!consumed) throw new AppError("unauthorized", "Pasó demasiado tiempo. Vuelve a escribir tu contraseña.");
    const issued = await createSession(pool, user.id, challenge.remember);
    await logSessionEvent(
      user,
      {
        action: "session.login",
        summary:
          result.method === "app"
            ? "Inició sesión con verificación en dos pasos"
            : `Inició sesión con un código de recuperación (quedan ${result.left})`,
      },
      connection,
    );
    return { session: (await resolveSession(pool, user, true))!, issued };
  },

  /**
   * Registro público. Riesgo conocido: «Ya existe una cuenta con ese email» revela qué emails están
   * registrados. Mientras no haya verificación por email (un enlace para confirmar la cuenta) se deja
   * así; lo frenan el límite de intentos y el CAPTCHA de la ruta.
   */
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
      return { session: (await resolveSession(db, user, false))!, issued };
    });
  },

  async signOut(ctx: RequestContext, connection: ClientConnection): Promise<void> {
    if (!ctx.sessionId) return;
    await pool.query("delete from sessions where id = $1", [ctx.sessionId]);
    if (ctx.user) await logSessionEvent(ctx.user, { action: "session.logout", summary: "Cerró sesión" }, connection);
  },

  /**
   * Cualquier usuario cambia su propia contraseña desde su perfil (con la actual). Se cierran sus
   * demás sesiones y deja de servir cualquier enlace para definirla que tuviera pendiente.
   */
  async changePassword(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<void> {
    const user = requireUser(ctx);
    const data = parseInput(changePasswordSchema, input);
    if (!(await isCurrentPassword(user.id, data.currentPassword))) {
      throw new AppError("validation", "La contraseña actual no es correcta.");
    }
    const passwordHash = await hashPassword(data.newPassword);
    await transaction(async (db) => {
      await db.query("update users set password_hash = $2 where id = $1", [user.id, passwordHash]);
      await db.query("delete from sessions where user_id = $1 and id is distinct from $2", [user.id, ctx.sessionId]);
      await revokePasswordLinks(db, user.id);
      await logSessionEvent(user, { action: "session.password_changed", summary: "Cambió su contraseña" }, connection, db);
    });
  },

  /** Página /definir-contrasena: a quién es el enlace (si sigue valiendo) antes de pedir la contraseña. */
  async checkPasswordLink(input: unknown): Promise<PasswordLinkInfo> {
    const { token } = parseInput(passwordLinkSchema, input);
    const link = await findPasswordLink(pool, token);
    const user = link
      ? await one<{ firstName: string; email: string; isActive: boolean }>(
          pool,
          'select first_name as "firstName", email, is_active as "isActive" from users where id = $1',
          [link.userId],
        )
      : null;
    if (!link || !user) throw invalidPasswordLink();
    if (!user.isActive) throw await inactiveAccountError();
    return { firstName: user.firstName, email: user.email, expiresAt: link.expiresAt };
  },

  /**
   * Define la contraseña con el enlace de un solo uso (cuenta nueva o contraseña olvidada). Se cierran
   * todas las sesiones de la cuenta; para entrar, inicia sesión con la contraseña nueva (y el código,
   * si tiene la verificación en dos pasos).
   */
  async setPasswordWithLink(input: unknown, connection: ClientConnection): Promise<void> {
    const { token, password } = parseInput(setPasswordSchema, input);
    const passwordHash = await hashPassword(password);
    await transaction(async (db) => {
      const link = await findPasswordLink(db, token, true);
      if (!link) throw invalidPasswordLink();
      const user = (await one<User>(db, `select ${userColumns()} from users where id = $1 for update`, [link.userId]))!;
      if (!user.isActive) throw await inactiveAccountError();
      await db.query("update users set password_hash = $2 where id = $1", [user.id, passwordHash]);
      await db.query("update password_setup_tokens set used_at = now() where id = $1", [link.id]);
      await revokePasswordLinks(db, user.id);
      await db.query("delete from sessions where user_id = $1", [user.id]);
      await db.query("delete from login_challenges where user_id = $1", [user.id]);
      await logSessionEvent(
        user,
        { action: "session.password_set", summary: "Definió su contraseña con el enlace de un solo uso" },
        connection,
        db,
      );
    });
  },
};

/** ¿Es la contraseña actual de la cuenta? (para cambiarla o para cambiar el email). */
export async function isCurrentPassword(userId: string, password: string): Promise<boolean> {
  const row = await one<{ passwordHash: string }>(pool, 'select password_hash as "passwordHash" from users where id = $1', [userId]);
  return Boolean(row && (await verifyPassword(password, row.passwordHash)));
}

const invalidPasswordLink = () =>
  new AppError("not_found", "Este enlace ya no sirve: caducó, ya se usó o se pidió otro. Pide uno nuevo al soporte.");

async function inactiveAccountError(): Promise<AppError> {
  const supportContact = formatSupportContact(await getPlatformSettings(pool));
  return new AppError("forbidden", `Tu cuenta está desactivada. Escribe a ${supportContact} para recuperar el acceso.`);
}

/** Limpieza periódica de las sesiones caducadas (y de los enlaces para definir la contraseña de hace más de un día). */
export async function deleteExpiredSessions(): Promise<void> {
  await pool.query("delete from sessions where expires_at <= now()");
  await pool.query("delete from login_challenges where expires_at <= now()");
  await pool.query("delete from password_setup_tokens where expires_at <= now() - interval '1 day'");
}
