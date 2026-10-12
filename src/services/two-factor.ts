import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { twoFactorConfirmSchema, twoFactorDisableSchema, twoFactorEnableSchema } from "../shared/lib/validations/auth.ts";
import type { RecoveryCodes, TwoFactorSetup, TwoFactorStatus } from "../shared/types/index.ts";
import { verifyPassword } from "./accounts.ts";
import { parseInput, requireUser, type RequestContext } from "./context.ts";
import { logSessionEvent, type ClientConnection } from "./session-security.ts";
import { findTotpStep, generateRecoveryCodes, generateSecret, hashRecoveryCode, normalizeTotpCode, otpauthUrl } from "./totp.ts";

/**
 * Verificación en dos pasos (por ahora, sólo el super admin la activa; con datos reales es
 * obligatoria: ver superAdminNeedsTwoFactor en context.ts). Con ella, después de la contraseña se
 * pide el código de 6 dígitos de la app de autenticación o un código de recuperación. Si se pierde
 * todo: `npm run db:reset-2fa -- <email>` (src/db/reset-two-factor.ts).
 */

/** Minutos para escribir el código tras la contraseña. */
const CHALLENGE_MINUTES = 5;
/** Códigos incorrectos permitidos en un mismo inicio de sesión (luego, otra vez la contraseña). */
export const MAX_CHALLENGE_ATTEMPTS = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Paso intermedio del inicio de sesión: la contraseña ya es correcta y falta el código. */
export async function createLoginChallenge(db: Db, userId: string, remember: boolean): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into login_challenges (user_id, token_hash, remember, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, sha256(token), remember, CHALLENGE_MINUTES],
  );
  return token;
}

export interface LoginChallenge {
  id: string;
  userId: string;
  remember: boolean;
  attempts: number;
}

/** El paso intermedio vigente de este token, o null si no existe o caducó. */
export function findLoginChallenge(db: Db, token: string): Promise<LoginChallenge | null> {
  return one<LoginChallenge>(
    db,
    `select id, user_id as "userId", remember, attempts from login_challenges
      where token_hash = $1 and expires_at > now()`,
    [sha256(token)],
  );
}

export type SecondFactorResult = { method: "app" } | { method: "recovery"; left: number };

/**
 * Comprueba el código de la app (cada código sirve una sola vez) o gasta un código de
 * recuperación. null: no es válido.
 */
export async function verifySecondFactor(db: Db, userId: string, code: string): Promise<SecondFactorResult | null> {
  if (normalizeTotpCode(code)) {
    const row = await one<{ secret: string | null }>(db, 'select two_factor_secret as "secret" from users where id = $1', [userId]);
    const step = row?.secret ? findTotpStep(row.secret, code) : null;
    if (step === null) return null;
    // Atómico: si dos peticiones usan el mismo código a la vez, sólo una lo consigue.
    const used = await one(
      db,
      `update users set two_factor_last_step = $2
        where id = $1 and coalesce(two_factor_last_step, -1) < $2 returning id`,
      [userId, step],
    );
    return used ? { method: "app" } : null;
  }
  const hash = hashRecoveryCode(code);
  if (!hash) return null;
  const spent = await one<{ left: number }>(
    db,
    `update users set two_factor_recovery_codes = array_remove(two_factor_recovery_codes, $2)
      where id = $1 and two_factor_secret is not null and $2 = any(two_factor_recovery_codes)
      returning cardinality(two_factor_recovery_codes) as left`,
    [userId, hash],
  );
  return spent ? { method: "recovery", left: spent.left } : null;
}

/** Hoy sólo el super admin: su cuenta es la que da acceso a todo. */
function requireSuperAdminUser(ctx: RequestContext) {
  const user = requireUser(ctx);
  if (user.platformRole !== "super_admin") {
    throw new AppError("forbidden", "La verificación en dos pasos está disponible sólo para la cuenta de super admin.");
  }
  return user;
}

const WRONG_CODE = "El código no es correcto. Revisa que la hora del celular esté bien y escribe el código nuevo.";

export const twoFactorService = {
  async status(ctx: RequestContext): Promise<TwoFactorStatus> {
    const user = requireSuperAdminUser(ctx);
    const row = await one<Omit<TwoFactorStatus, "required">>(
      pool,
      `select two_factor_secret is not null as enabled, two_factor_enabled_at as "enabledAt",
              cardinality(two_factor_recovery_codes) as "recoveryCodesLeft"
         from users where id = $1`,
      [user.id],
    );
    return { ...row!, required: config.superAdminTwoFactorRequired };
  },

  /** Genera la clave que se escanea con la app. No se activa hasta confirmar un código (enable). */
  async setup(ctx: RequestContext): Promise<TwoFactorSetup> {
    const user = requireSuperAdminUser(ctx);
    const secret = generateSecret();
    const updated = await one(
      pool,
      "update users set two_factor_pending_secret = $2 where id = $1 and two_factor_secret is null returning id",
      [user.id, secret],
    );
    if (!updated) throw new AppError("conflict", "La verificación en dos pasos ya está activada.");
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  },

  /**
   * Activa la verificación con el primer código de la app y devuelve los códigos de
   * recuperación (sólo esta vez). Cierra las demás sesiones abiertas de la cuenta.
   */
  async enable(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<RecoveryCodes> {
    const user = requireSuperAdminUser(ctx);
    const { code } = parseInput(twoFactorEnableSchema, input);
    return transaction(async (db) => {
      const row = await one<{ pending: string | null; enabled: boolean }>(
        db,
        `select two_factor_pending_secret as pending, two_factor_secret is not null as enabled
           from users where id = $1 for update`,
        [user.id],
      );
      if (row?.enabled) throw new AppError("conflict", "La verificación en dos pasos ya está activada.");
      if (!row?.pending) throw new AppError("conflict", "Vuelve a empezar: pulsa «Activar» para generar un código QR nuevo.");
      const step = findTotpStep(row.pending, code);
      if (step === null) throw new AppError("validation", WRONG_CODE);
      const recoveryCodes = generateRecoveryCodes();
      await db.query(
        `update users
            set two_factor_secret = two_factor_pending_secret, two_factor_pending_secret = null,
                two_factor_enabled_at = now(), two_factor_last_step = $2, two_factor_recovery_codes = $3
          where id = $1`,
        [user.id, step, recoveryCodes.map((recovery) => hashRecoveryCode(recovery)!)],
      );
      await db.query("delete from sessions where user_id = $1 and id <> $2", [user.id, ctx.sessionId]);
      await logSessionEvent(user, { action: "session.two_factor_enabled", summary: "Activó la verificación en dos pasos" }, connection, db);
      return { recoveryCodes };
    });
  },

  /** Desactivarla pide la contraseña y un código: con sólo la sesión abierta no basta. */
  async disable(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<void> {
    const user = requireSuperAdminUser(ctx);
    const { password, code } = parseInput(twoFactorDisableSchema, input);
    const row = await one<{ passwordHash: string }>(pool, 'select password_hash as "passwordHash" from users where id = $1', [user.id]);
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      throw new AppError("validation", "La contraseña no es correcta.");
    }
    await transaction(async (db) => {
      if (!(await verifySecondFactor(db, user.id, code))) throw new AppError("validation", WRONG_CODE);
      await db.query(
        `update users
            set two_factor_secret = null, two_factor_pending_secret = null, two_factor_enabled_at = null,
                two_factor_last_step = null, two_factor_recovery_codes = '{}'
          where id = $1`,
        [user.id],
      );
      await logSessionEvent(user, { action: "session.two_factor_disabled", summary: "Desactivó la verificación en dos pasos" }, connection, db);
    });
  },

  /** Códigos de recuperación nuevos (los anteriores dejan de servir). */
  async regenerateRecoveryCodes(ctx: RequestContext, input: unknown, connection: ClientConnection): Promise<RecoveryCodes> {
    const user = requireSuperAdminUser(ctx);
    const { code } = parseInput(twoFactorConfirmSchema, input);
    return transaction(async (db) => {
      if (!(await verifySecondFactor(db, user.id, code))) throw new AppError("validation", WRONG_CODE);
      const recoveryCodes = generateRecoveryCodes();
      await db.query("update users set two_factor_recovery_codes = $2 where id = $1", [
        user.id,
        recoveryCodes.map((recovery) => hashRecoveryCode(recovery)!),
      ]);
      await logSessionEvent(
        user,
        { action: "session.two_factor_recovery_codes", summary: "Generó códigos de recuperación nuevos" },
        connection,
        db,
      );
      return { recoveryCodes };
    });
  },
};
