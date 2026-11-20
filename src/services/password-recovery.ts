import { createHash } from "node:crypto";
import { userColumns } from "../db/columns.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import { generateTemporaryPassword, TEMPORARY_PASSWORD_MINUTES } from "../shared/lib/constants/auth.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { forgotPasswordSchema } from "../shared/lib/validations/auth.ts";
import type { User } from "../shared/types/index.ts";
import { hashPassword, verifyPassword } from "./accounts.ts";
import { parseInput } from "./context.ts";
import { PASSWORD_MASK } from "./mailer.ts";
import { appOrigin, queueEmail } from "./notifications.ts";
import { logSessionEvent, type ClientConnection } from "./session-security.ts";

/*
 * «¿Olvidaste tu contraseña?» (spec 054, pedido del dueño el 2026-11-20): una contraseña temporal por email para las
 * cuentas del equipo y de los super admins. Es aparte de la de siempre, que sigue funcionando hasta que se use la
 * temporal (así nadie deja afuera a otro pidiendo recuperaciones a su nombre). Sirve una vez, vence en 1 hora y sólo vale
 * la última pedida. Al entrar con ella, la sesión sólo puede crear la contraseña nueva (auth-service.ts).
 */

/** Pedidos por email antes de dejar de enviar (la respuesta es la misma). */
export const REQUESTS_PER_HOUR = 3;
export const REQUESTS_PER_DAY = 5;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Hash de referencia para comparar cuando la cuenta no tiene una temporal pendiente: tarda lo mismo. */
const DUMMY_TEMPORARY_HASH = "$2b$12$9PfTLcduCrpzXq42WwlcRuyP6cf8HmcoIqDRGpO.I/s12UC5QFGeG";

/** La huella del email en los contadores: así rate_limits no guarda emails en claro. */
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 32);

export const passwordRecoveryService = {
  /**
   * POST /auth/forgot-password. Responde siempre igual (la ruta, 204): exista o no la cuenta, esté o no activa y aunque
   * se pase del tope. Hace el mismo trabajo en todos los casos (un bcrypt y los contadores), así un email inexistente
   * tarda lo mismo. Cada pedido queda en Actividad → Seguridad del super admin, sin la contraseña.
   */
  async request(input: unknown, connection: ClientConnection): Promise<void> {
    const { email } = parseInput(forgotPasswordSchema, input);
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const key = emailKey(email);
    const hour = await incrementCounter(pool, `recuperar:hora:${key}`, HOUR_MS);
    const day = await incrementCounter(pool, `recuperar:dia:${key}`, DAY_MS);
    const user = await one<User>(pool, `select ${userColumns()} from users where email = $1`, [email]);

    if (!user) {
      await logSessionEvent(
        null,
        { action: "session.temporary_password_requested", summary: "Pidió una contraseña temporal para un email no registrado", attemptedEmail: email },
        connection,
      );
      return;
    }
    if (!user.isActive) {
      await logSessionEvent(
        user,
        { action: "session.temporary_password_requested", summary: "Pidió una contraseña temporal con la cuenta desactivada (no se envió)" },
        connection,
      );
      return;
    }
    if (hour.hits > REQUESTS_PER_HOUR || day.hits > REQUESTS_PER_DAY) {
      await logSessionEvent(
        user,
        { action: "session.temporary_password_requested", summary: "Pidió una contraseña temporal, pero pasó el tope de pedidos (no se envió)" },
        connection,
      );
      return;
    }
    await transaction(async (db) => {
      // Sólo vale la última: las anteriores sin usar se borran.
      await discardTemporaryPasswords(db, user.id);
      await db.query(
        `insert into temporary_passwords (user_id, password_hash, expires_at)
         values ($1, $2, now() + make_interval(mins => $3))`,
        [user.id, passwordHash, TEMPORARY_PASSWORD_MINUTES],
      );
      // La contraseña va en `secret`: el registro de emails guarda «••••••••» (mailer.ts).
      await queueEmail(db, {
        businessId: null,
        type: "temporary_password",
        to: user.email,
        secret: password,
        ...emailTemplates.temporaryPassword({
          firstName: user.firstName,
          email: user.email,
          password: PASSWORD_MASK,
          minutes: TEMPORARY_PASSWORD_MINUTES,
          loginUrl: `${appOrigin()}/login`,
        }),
      });
      await logSessionEvent(
        user,
        { action: "session.temporary_password_requested", summary: "Pidió una contraseña temporal («¿Olvidaste tu contraseña?»)" },
        connection,
        db,
      );
    });
  },
};

/**
 * ¿Es `password` la contraseña temporal pendiente de la cuenta? Si lo es, queda usada en ese momento (una sola vez,
 * también con dos inicios de sesión a la vez). Sin una pendiente, compara con un hash de referencia: tarda lo mismo.
 */
export async function useTemporaryPassword(userId: string, password: string): Promise<boolean> {
  const pending = await many<{ id: string; passwordHash: string }>(
    pool,
    `select id, password_hash as "passwordHash" from temporary_passwords
      where user_id = $1 and used_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [userId],
  );
  const candidate = pending[0];
  const matches = await verifyPassword(password, candidate?.passwordHash ?? DUMMY_TEMPORARY_HASH);
  if (!candidate || !matches) return false;
  const used = await one(
    pool,
    "update temporary_passwords set used_at = now() where id = $1 and used_at is null and expires_at > now() returning id",
    [candidate.id],
  );
  return Boolean(used);
}

/** ¿Es `password` la última temporal que usó la cuenta? (la contraseña nueva tiene que ser distinta). */
export async function isLastUsedTemporary(userId: string, password: string): Promise<boolean> {
  const last = await one<{ passwordHash: string }>(
    pool,
    `select password_hash as "passwordHash" from temporary_passwords
      where user_id = $1 and used_at is not null order by used_at desc limit 1`,
    [userId],
  );
  return Boolean(last && (await verifyPassword(password, last.passwordHash)));
}

/** Las temporales sin usar dejan de servir: al entrar con la de siempre, al cambiarla o al ponerla el soporte. */
export async function discardTemporaryPasswords(db: Db, userId: string): Promise<void> {
  await db.query("delete from temporary_passwords where user_id = $1 and used_at is null", [userId]);
}

/** Limpieza del cron: las vencidas o usadas hace más de un día. */
export async function deleteOldTemporaryPasswords(db: Db = pool): Promise<void> {
  await db.query(
    "delete from temporary_passwords where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day'",
  );
}
