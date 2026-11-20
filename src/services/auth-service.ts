import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { userColumns } from "../db/columns.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { THEME_MODE_LABELS } from "../shared/lib/constants/app.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { formatSupportContact, getFullName } from "../shared/lib/format.ts";
import {
  changePasswordSchema,
  loginSchema,
  newPasswordSchema,
  registerSchema,
  themeModeSchema,
  twoFactorLoginSchema,
} from "../shared/lib/validations/auth.ts";
import type { BrandColors, BusinessRole, BusinessStatus, PlatformRole, ThemeMode, TwoFactorChallenge, User } from "../shared/types/index.ts";
import { hashPassword, needsRehash, verifyPassword } from "./accounts.ts";
import { logAudit } from "./audit.ts";
import { parseInput, requireUser, type RequestContext } from "./context.ts";
import { queueEmail } from "./notifications.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import { pausePushDevices } from "./push-device-service.ts";
import { checkCaptchaToken } from "../http/captcha.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import { issueDeviceToken, isTrustedDevice } from "./trusted-device.ts";
import { queueAccountSecurityEmail, queueOwnPasswordEmail } from "./account-alerts.ts";
import { deleteOldTemporaryPasswords, discardTemporaryPasswords, isLastUsedTemporary, useTemporaryPassword } from "./password-recovery.ts";
import {
  accountAttemptsToday,
  CAPTCHA_AFTER_ATTEMPTS,
  isKnownConnection,
  isLockedOut,
  lockedOutError,
  logSessionEvent,
  recordFailedSessionCheck,
  reserveAttempt,
  startSessionCheck,
  type ClientConnection,
} from "./session-security.ts";
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
  /** Colores del panel de plataforma del super admin (spec 007). null: los de Agenda360; siempre null si no es super admin. */
  panelColors: BrandColors | null;
  /** Modo de pantalla de la cuenta (spec 019), de cualquier rol. "auto": sigue al modo del aparato. */
  themeMode: ThemeMode;
  /**
   * Se entró con una contraseña temporal (la del email o la que puso el soporte, spec 054): el panel sólo muestra «Crea
   * tu contraseña nueva» y la API responde `password_change_required` al resto.
   */
  passwordChangeRequired: boolean;
}

/** Token de sesión recién emitido: la ruta lo guarda en una cookie httpOnly. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  /** "Recordarme": la cookie sobrevive al cierre del navegador. */
  persistent: boolean;
}

/**
 * Caducidad de las sesiones. Con «Recordarme», REMEMBER_DAYS sin usarla (se renueva con el uso) y,
 * como mucho, REMEMBER_MAX_DAYS desde que se inició (SUPER_ADMIN_REMEMBER_DAYS la del super admin: su
 * cuenta llega a todos los negocios). Antes no tenía tope y una cookie robada valía mientras se usara
 * (spec 009). Sin «Recordarme», IDLE_HOURS sin usarla y, como mucho, MAX_SESSION_HOURS desde que se
 * inició (la cookie, además, se borra al cerrar el navegador). El último uso se anota como mucho cada
 * RENEW_EVERY_MINUTES.
 */
const REMEMBER_DAYS = 14;
const REMEMBER_MAX_DAYS = 30;
const SUPER_ADMIN_REMEMBER_DAYS = 7;
const IDLE_HOURS = 12;
const MAX_SESSION_HOURS = 24;
const RENEW_EVERY_MINUTES = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Hash de referencia para que un email inexistente tarde lo mismo que una contraseña incorrecta.
 * Fijo (de una contraseña aleatoria que nadie conoce, con el mismo coste que las reales): así no
 * se gasta CPU en calcularlo cada vez que arranca el servidor.
 */
const DUMMY_PASSWORD_HASH = "$2b$12$9PfTLcduCrpzXq42WwlcRuyP6cf8HmcoIqDRGpO.I/s12UC5QFGeG";

/**
 * La cuenta como la lee el inicio de sesión: con la contraseña, la verificación, el modo de pantalla (spec 019) y si su
 * contraseña la puso el soporte (spec 054: al entrar, hay que crear la propia).
 */
type LoginRow = User & { passwordHash: string; twoFactor: boolean; themeMode: ThemeMode; mustChange: boolean };

const withoutSecrets = ({
  passwordHash: _password,
  twoFactor: _twoFactor,
  themeMode: _themeMode,
  mustChange: _mustChange,
  ...user
}: LoginRow): User => user;

/** Resultado del inicio de sesión: la sesión, o el paso del código si tiene la verificación en dos pasos. */
/** Códigos de verificación incorrectos de una cuenta en 24 horas que ponen la verificación en pausa (revisión 2026-11-18). */
const TWO_FACTOR_FAILURES_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60_000;
const twoFactorDayKey = (userId: string) => `acceso:codigos-dia:${userId}`;

/** La cookie del dispositivo de confianza para el navegador que entró (trusted-device.ts); null sin clave. */
type DeviceCookie = { token: string; expiresAt: Date } | null;

export type SignInResult = { session: Session; issued: IssuedSession; device: DeviceCookie } | { twoFactor: TwoFactorChallenge };

/** Cuenta desactivada: no entra, ni con la contraseña ni con el código. */
async function blockInactive(user: User, connection: ClientConnection): Promise<never> {
  await logSessionEvent(user, { action: "session.login_blocked", summary: "Intento de inicio de sesión con la cuenta desactivada" }, connection);
  const supportContact = formatSupportContact(await getPlatformSettings(pool));
  throw new AppError("forbidden", `Tu cuenta está desactivada. Escribe a ${supportContact} para recuperar el acceso.`);
}

/** `passwordChangeRequired`: la sesión se abre con una contraseña temporal y sólo puede crear la nueva (spec 054). */
async function createSession(db: Db, userId: string, remember: boolean, passwordChangeRequired = false): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const row = (await one<{ expiresAt: string }>(
    db,
    `insert into sessions (user_id, token_hash, expires_at, remember, password_change_required)
     select u.id, $2,
            case when $3::boolean then now() + make_interval(days => least($4::int, case when u.platform_role = 'super_admin' then $5::int else $6::int end))
                 else now() + make_interval(hours => $7) end,
            $3, $8
       from users u where u.id = $1
     returning expires_at as "expiresAt"`,
    [userId, sha256(token), remember, REMEMBER_DAYS, SUPER_ADMIN_REMEMBER_DAYS, REMEMBER_MAX_DAYS, IDLE_HOURS, passwordChangeRequired],
  ))!;
  return { token, expiresAt: new Date(row.expiresAt), persistent: remember };
}

/** Sesión de la cookie y, si se acaba de renovar una con «Recordarme», su caducidad nueva (para la cookie). */
export interface FoundSession extends RequestContext {
  renewedUntil: Date | null;
}

/**
 * Busca la sesión de la cookie (null si no existe, caducó o pasó demasiado tiempo sin usarse) y
 * anota su uso: la caducidad se corre IDLE_HOURS (o REMEMBER_DAYS con «Recordarme») desde ahora.
 * Una sola consulta: se lee y, si hace falta, se renueva. Trae también el modo de pantalla de la cuenta
 * (spec 019), que llega con la sesión sin otra consulta.
 */
export async function findSessionByToken(token: string): Promise<FoundSession | null> {
  const row = await one<
    User & {
      sessionId: string;
      remember: boolean;
      stale: boolean;
      twoFactorEnabled: boolean;
      themeMode: ThemeMode;
      renewedUntil: string | null;
      passwordChangeRequired: boolean;
    }
  >(
    pool,
    `with found as (
       select s.id as "sessionId", s.remember, s.last_seen_at < now() - make_interval(mins => $2) as stale,
              s.password_change_required as "passwordChangeRequired",
              u.two_factor_secret is not null as "twoFactorEnabled", u.theme_mode as "themeMode", ${userColumns("u")}
         from sessions s
         join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()
          -- Tope de «Recordarme» desde que se inició: también las sesiones abiertas antes de existir.
          and (not s.remember
               or s.created_at > now() - make_interval(days => case when u.platform_role = 'super_admin' then $6::int else $7::int end))
     ), renewed as (
       update sessions s
          set last_seen_at = now(),
              expires_at = case
                when s.remember then least(
                  s.created_at + make_interval(days => case when f."platformRole" = 'super_admin' then $6::int else $7::int end),
                  now() + make_interval(days => $3))
                else least(s.created_at + make_interval(hours => $4), now() + make_interval(hours => $5))
              end
         from found f
        where s.id = f."sessionId" and f.stale
       returning s.expires_at
     )
     select f.*, (select r.expires_at from renewed r) as "renewedUntil" from found f`,
    [sha256(token), RENEW_EVERY_MINUTES, REMEMBER_DAYS, MAX_SESSION_HOURS, IDLE_HOURS, SUPER_ADMIN_REMEMBER_DAYS, REMEMBER_MAX_DAYS],
  );
  if (!row) return null;
  const { sessionId, remember, twoFactorEnabled, themeMode, renewedUntil, passwordChangeRequired, stale: _stale, ...user } = row;
  return {
    user,
    sessionId,
    twoFactorEnabled,
    themeMode,
    passwordChangeRequired,
    renewedUntil: remember && renewedUntil ? new Date(renewedUntil) : null,
  };
}

/**
 * `themeMode`: el de la cuenta, leído en la misma consulta que el usuario (spec 019). `passwordChangeRequired`: la de la
 * sesión (spec 054).
 */
async function resolveSession(
  db: Db,
  user: User,
  twoFactorEnabled: boolean,
  themeMode: ThemeMode,
  passwordChangeRequired = false,
): Promise<Session | null> {
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
  // Sólo las cuentas de super admin tienen colores de panel: las de los negocios no hacen esta consulta.
  const panel =
    user.platformRole === "super_admin"
      ? await one<{ colors: BrandColors | null }>(db, `select panel_colors as colors from users where id = $1`, [user.id])
      : null;
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
    panelColors: panel?.colors ?? null,
    themeMode,
    passwordChangeRequired,
  };
}

export const authService = {
  async getSession(ctx: RequestContext): Promise<Session | null> {
    return ctx.user
      ? resolveSession(pool, ctx.user, Boolean(ctx.twoFactorEnabled), ctx.themeMode ?? "auto", Boolean(ctx.passwordChangeRequired))
      : null;
  },

  async signIn(input: unknown, connection: ClientConnection): Promise<SignInResult> {
    const { email, password, remember, captchaToken } = parseInput(loginSchema, input);
    const row = await one<LoginRow>(
      pool,
      `select ${userColumns()}, password_hash as "passwordHash", two_factor_secret is not null as "twoFactor",
              theme_mode as "themeMode", password_change_required as "mustChange"
         from users where email = $1`,
      [email],
    );
    const user = row ? withoutSecrets(row) : null;
    // Desde un navegador o una conexión donde la cuenta ya entró, sin los topes repartidos ni el CAPTCHA (2026-11-18).
    const known =
      Boolean(row && isTrustedDevice(connection.deviceToken, row.id, row.passwordHash)) || (await isKnownConnection(user?.id ?? null, connection.ip));
    if (!known && (await accountAttemptsToday(email)) >= CAPTCHA_AFTER_ATTEMPTS) await checkCaptchaToken(captchaToken, connection.ip);
    // Bloqueada: ni se comprueba la contraseña (aunque sea la correcta) hasta que pase el tiempo. El
    // intento se aparta antes de comprobarla: con muchos a la vez, sólo pasan los del tope (spec 009).
    const locked = await isLockedOut(user?.id ?? null, email, connection.ip);
    const attempt = locked ? null : await reserveAttempt(email, connection.ip, user?.id ?? null, known);
    if (!attempt || attempt.locked) {
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
    let valid = await verifyPassword(password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
    // Si no es la de siempre, la contraseña temporal pendiente de «¿Olvidaste tu contraseña?» (spec 054). Siempre una
    // segunda comparación (con un hash de referencia si no hay cuenta): un email inexistente tarda lo mismo.
    let viaTemporary = false;
    if (!valid) {
      if (user?.isActive) viaTemporary = await useTemporaryPassword(user.id, password);
      else await verifyPassword(password, DUMMY_PASSWORD_HASH);
      valid = viaTemporary;
    }
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
    let passwordHash = row!.passwordHash;
    if (viaTemporary) {
      await logSessionEvent(user, { action: "session.temporary_login", summary: "Entró con una contraseña temporal" }, connection);
      // Un super admin: aviso a la cuenta y al dueño de la plataforma (y por ntfy, account-alerts.ts).
      if (user.platformRole === "super_admin") {
        await queueAccountSecurityEmail(pool, user, "Entró con una contraseña temporal («¿Olvidaste tu contraseña?»)", connection);
      }
    } else {
      // Recordó la de siempre: las temporales pendientes dejan de servir.
      await discardTemporaryPasswords(pool, user.id);
      // Las contraseñas de antes del costo 12 se rehacen al entrar (sólo si nadie la cambió entretanto).
      if (needsRehash(passwordHash)) {
        const rehashed = await hashPassword(password);
        await pool.query("update users set password_hash = $2 where id = $1 and password_hash = $3", [user.id, rehashed, passwordHash]);
        passwordHash = rehashed;
      }
    }
    // Con una contraseña temporal (o la que puso el soporte), la sesión sólo puede crear la nueva (spec 054).
    const mustChange = viaTemporary || row!.mustChange;
    // Con la verificación en dos pasos, la sesión se abre al escribir el código (verifyTwoFactor).
    if (row?.twoFactor) {
      return { twoFactor: { twoFactorRequired: true, challenge: await createLoginChallenge(pool, user.id, remember, mustChange) } };
    }
    const issued = await createSession(pool, user.id, remember, mustChange);
    await logSessionEvent(user, { action: "session.login", summary: viaTemporary ? "Inició sesión con una contraseña temporal" : "Inició sesión" }, connection);
    await attempt.succeeded();
    return {
      session: (await resolveSession(pool, user, false, row!.themeMode, mustChange))!,
      issued,
      // El navegador queda de confianza cuando tenga su contraseña propia (al crearla, newPassword).
      device: mustChange ? null : issueDeviceToken(user.id, passwordHash),
    };
  },

  /**
   * Segundo paso del inicio de sesión: el código de la app o uno de recuperación. Los códigos
   * incorrectos cuentan como intentos fallidos (y para el bloqueo de la cuenta).
   */
  async verifyTwoFactor(
    input: unknown,
    connection: ClientConnection,
  ): Promise<{ session: Session; issued: IssuedSession; device: DeviceCookie }> {
    const { challenge: token, code } = parseInput(twoFactorLoginSchema, input);
    const challenge = await findLoginChallenge(pool, token);
    if (!challenge) throw new AppError("unauthorized", "Pasó demasiado tiempo. Vuelve a escribir tu contraseña.");
    const { themeMode, ...user } = (await one<User & { themeMode: ThemeMode }>(
      pool,
      `select ${userColumns()}, theme_mode as "themeMode" from users where id = $1`,
      [challenge.userId],
    ))!;
    if (!user.isActive) {
      await pool.query("delete from login_challenges where user_id = $1", [user.id]);
      return blockInactive(user, connection);
    }
    const locked = await isLockedOut(user.id, user.email, connection.ip);
    const attempt = locked ? null : await reserveAttempt(user.email, connection.ip, user.id);
    if (!attempt || attempt.locked) {
      await pool.query("delete from login_challenges where id = $1", [challenge.id]);
      await logSessionEvent(
        user,
        { action: "session.login_locked", summary: "Inicio de sesión bloqueado temporalmente por demasiados intentos fallidos" },
        connection,
      );
      throw lockedOutError();
    }
    // Tope de códigos fallidos de la cuenta en 24 horas (revisión 2026-11-18): con la contraseña robada, el tope
    // de 15 minutos dejaba probar unos 2.400 códigos al día.
    const failedToday = await one<{ hits: number }>(pool, "select hits from rate_limits where key = $1 and reset_at > now()", [
      twoFactorDayKey(user.id),
    ]);
    if ((failedToday?.hits ?? 0) >= TWO_FACTOR_FAILURES_PER_DAY) {
      await pool.query("delete from login_challenges where id = $1", [challenge.id]);
      await logSessionEvent(
        user,
        { action: "session.login_locked", summary: "Verificación en dos pasos en pausa por demasiados códigos incorrectos en 24 horas" },
        connection,
      );
      throw new AppError(
        "rate_limited",
        "Demasiados códigos incorrectos en las últimas 24 horas: por seguridad, la verificación queda en pausa hasta mañana. Si no fuiste tú, cambia tu contraseña.",
      );
    }
    // El intento del paso intermedio se suma antes de comprobar el código, de forma atómica: con
    // muchos códigos a la vez sólo se comprueban MAX_CHALLENGE_ATTEMPTS (spec 009).
    const slot = await one<{ attempts: number }>(
      pool,
      `update login_challenges set attempts = attempts + 1
        where id = $1 and attempts < $2 and expires_at > now() returning attempts`,
      [challenge.id, MAX_CHALLENGE_ATTEMPTS],
    );
    if (!slot) {
      await pool.query("delete from login_challenges where id = $1", [challenge.id]);
      throw new AppError("unauthorized", "Demasiados códigos incorrectos. Vuelve a escribir tu contraseña.");
    }

    const result = await verifySecondFactor(pool, user.id, code);
    if (!result) {
      const { attempts } = slot;
      await incrementCounter(pool, twoFactorDayKey(user.id), DAY_MS);
      // El primer código incorrecto después de una contraseña correcta: si no fue la persona, alguien ya la sabe. Se avisa
      // por email (a la cuenta y al dueño de la plataforma) y por ntfy (account-alerts.ts).
      if (attempts === 1) {
        await logSessionEvent(
          user,
          { action: "session.second_factor_failed", summary: "Falló el código de verificación después de una contraseña correcta" },
          connection,
        );
        await queueAccountSecurityEmail(
          pool,
          user,
          "Alguien escribió bien tu contraseña, pero falló el código de verificación en dos pasos. Si no fuiste tú, cambia tu contraseña.",
          connection,
        );
      }
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) await pool.query("delete from login_challenges where id = $1", [challenge.id]);
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
    const issued = await createSession(pool, user.id, challenge.remember, challenge.passwordChangeRequired);
    await attempt.succeeded();
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
    const { passwordHash } = (await one<{ passwordHash: string }>(pool, 'select password_hash as "passwordHash" from users where id = $1', [user.id]))!;
    const mustChange = challenge.passwordChangeRequired;
    return {
      session: (await resolveSession(pool, user, true, themeMode, mustChange))!,
      issued,
      device: mustChange ? null : issueDeviceToken(user.id, passwordHash),
    };
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
      // Las cuentas nuevas empiezan en «Automático» (el default de la columna, spec 019).
      const { themeMode, ...user } = (await one<User & { themeMode: ThemeMode }>(
        db,
        `insert into users (first_name, last_name, email, password_hash)
         values ($1, $2, $3, $4)
         returning ${userColumns()}, theme_mode as "themeMode"`,
        [firstName, lastName, email, await hashPassword(password)],
      ))!;
      await queueEmail(db, { businessId: null, type: "welcome", to: email, ...emailTemplates.welcome(firstName) });
      const issued = await createSession(db, user.id, true);
      return { session: (await resolveSession(db, user, false, themeMode))!, issued };
    });
  },

  async signOut(ctx: RequestContext, connection: ClientConnection): Promise<void> {
    if (!ctx.sessionId) return;
    // Antes de borrar la sesión (que les quitaría el enlace): sus aparatos dejan de recibir avisos (spec 013).
    await pausePushDevices(ctx.sessionId);
    await pool.query("delete from sessions where id = $1", [ctx.sessionId]);
    if (ctx.user) await logSessionEvent(ctx.user, { action: "session.logout", summary: "Cerró sesión" }, connection);
  },

  /**
   * Cambia la propia contraseña y cierra las demás sesiones. Sólo el super admin: las
   * contraseñas de los usuarios las pone él (para poder entrar en su cuenta si le piden ayuda).
   */
  /**
   * POST /auth/change-password (Configuración → Perfil): cualquier cuenta del equipo y el super admin, con la actual
   * (spec 054; antes sólo el super admin). La actual incorrecta cuenta como intento fallido. Cierra las demás sesiones,
   * anula las temporales pendientes y avisa por email. Devuelve la cookie del dispositivo de confianza con el hash nuevo.
   */
  async changePassword(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<{ device: DeviceCookie }> {
    const user = requireUser(ctx);
    const data = parseInput(changePasswordSchema, input);
    const attempt = await startSessionCheck(user, connection);
    if (!(await isCurrentPassword(user.id, data.currentPassword))) {
      await recordFailedSessionCheck(user, connection, "Contraseña actual incorrecta al cambiar la contraseña");
      throw new AppError("validation", "La contraseña actual no es correcta.");
    }
    await attempt.succeeded();
    const hash = await hashPassword(data.newPassword);
    await transaction(async (db) => {
      await db.query("update users set password_hash = $2, password_change_required = false where id = $1", [user.id, hash]);
      await db.query("delete from sessions where user_id = $1 and id <> $2", [user.id, ctx.sessionId]);
      await db.query("delete from temporary_passwords where user_id = $1", [user.id]);
      await logSessionEvent(user, { action: "session.password_changed", summary: "Cambió su contraseña" }, connection, db);
      await queueOwnPasswordEmail(db, user, "Cambió su contraseña", connection);
    });
    return { device: issueDeviceToken(user.id, hash) };
  },

  /**
   * POST /auth/new-password: «Crea tu contraseña nueva», después de entrar con una contraseña temporal (la del email o la
   * que puso el soporte, spec 054). Sólo con la sesión marcada; no pide la actual. La nueva tiene que ser distinta de la
   * temporal. Pasa a ser su contraseña, cierra las demás sesiones, libera ésta y avisa por email.
   */
  async newPassword(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<{ session: Session; device: DeviceCookie }> {
    const user = requireUser(ctx);
    if (!ctx.passwordChangeRequired) {
      throw new AppError("conflict", "Tu contraseña ya está creada. Para cambiarla, ve a Configuración → Perfil.");
    }
    const { newPassword } = parseInput(newPasswordSchema, input);
    // La temporal del soporte es la contraseña actual de la cuenta; la del email, la última que usó.
    const current = (await one<{ passwordHash: string; mustChange: boolean }>(
      pool,
      'select password_hash as "passwordHash", password_change_required as "mustChange" from users where id = $1',
      [user.id],
    ))!;
    const sameAsSupport = current.mustChange && (await verifyPassword(newPassword, current.passwordHash));
    if (sameAsSupport || (await isLastUsedTemporary(user.id, newPassword))) {
      throw new AppError("validation", "Elige una contraseña distinta de la temporal.");
    }
    const hash = await hashPassword(newPassword);
    await transaction(async (db) => {
      await db.query("update users set password_hash = $2, password_change_required = false where id = $1", [user.id, hash]);
      await db.query("delete from sessions where user_id = $1 and id <> $2", [user.id, ctx.sessionId]);
      await db.query("update sessions set password_change_required = false where id = $1", [ctx.sessionId]);
      await db.query("delete from temporary_passwords where user_id = $1", [user.id]);
      await logSessionEvent(
        user,
        { action: "session.password_changed", summary: "Creó su contraseña nueva después de entrar con una contraseña temporal" },
        connection,
        db,
      );
      await queueOwnPasswordEmail(db, user, "Creó su contraseña nueva después de entrar con una contraseña temporal", connection);
    });
    const session = (await resolveSession(pool, user, Boolean(ctx.twoFactorEnabled), ctx.themeMode ?? "auto", false))!;
    return { session, device: issueDeviceToken(user.id, hash) };
  },

  /**
   * PUT /auth/theme-mode: el modo de pantalla de la propia cuenta (spec 019). Lo usan todos los roles y
   * el super admin, sin la barrera de la verificación en dos pasos: es una preferencia de su pantalla.
   * El mismo modo no escribe nada. El cambio queda en la actividad de su negocio o, la del super admin,
   * en la de la plataforma: también en modo soporte, que no es de la cuenta sino de cada petición a
   * /businesses/:id (`authorize`), así que nunca va al negocio que está viendo.
   */
  async setThemeMode(ctx: RequestContext, input: unknown): Promise<{ mode: ThemeMode }> {
    const user = requireUser(ctx);
    const { mode } = parseInput(themeModeSchema, input);
    return transaction(async (db) => {
      // El de antes, con la fila bloqueada: dos cambios a la vez (desde dos equipos) van uno detrás de
      // otro y cada uno registra el modo que de verdad tenía. Su negocio, como el de la sesión.
      const current = (await one<{ mode: ThemeMode; businessId: string | null }>(
        db,
        `select u.theme_mode as mode,
                (select bu.business_id from business_users bu where bu.user_id = u.id order by bu.created_at limit 1)
                  as "businessId"
           from users u
          where u.id = $1
            for update`,
        [user.id],
      ))!;
      if (current.mode === mode) return { mode };
      await db.query("update users set theme_mode = $2 where id = $1", [user.id, mode]);
      const superAdmin = user.platformRole === "super_admin";
      const [from, to] = [THEME_MODE_LABELS[current.mode], THEME_MODE_LABELS[mode]];
      await logAudit(db, {
        businessId: superAdmin ? null : current.businessId,
        actor: { userId: user.id, name: superAdmin ? `${getFullName(user)} (Super admin)` : getFullName(user) },
        action: "user.theme_mode_changed",
        entityType: "user",
        entityId: user.id,
        summary: `Cambió el modo de pantalla de «${from}» a «${to}»`,
        changes: [{ label: "Modo de pantalla", before: from, after: to }],
      });
      return { mode };
    });
  },
};

/** ¿Es la contraseña actual de la cuenta? (para cambiarla o para cambiar el email). */
export async function isCurrentPassword(userId: string, password: string): Promise<boolean> {
  const row = await one<{ passwordHash: string }>(pool, 'select password_hash as "passwordHash" from users where id = $1', [userId]);
  return Boolean(row && (await verifyPassword(password, row.passwordHash)));
}

/** Limpieza periódica de las sesiones caducadas. */
export async function deleteExpiredSessions(): Promise<void> {
  await pool.query("delete from sessions where expires_at <= now()");
  await pool.query("delete from login_challenges where expires_at <= now()");
  await deleteOldTemporaryPasswords(pool);
}
