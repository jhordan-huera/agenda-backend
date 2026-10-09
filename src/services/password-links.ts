import { createHash, randomBytes } from "node:crypto";
import { one, type Db } from "../db/pool.ts";
import type { EmailContent } from "../shared/lib/email/templates.ts";
import type { EmailType, PasswordLink } from "../shared/types/index.ts";
import { appOrigin, PASSWORD_MASK, queueEmail } from "./notifications.ts";

/**
 * Enlaces de un solo uso para que cada persona defina su contraseña: nadie más la elige ni la ve
 * (tampoco el super admin). Se envían al crear una cuenta o cuando el soporte lo pide (p. ej. si la
 * olvidó). En la base sólo queda el hash SHA-256 del token; caduca a los PASSWORD_LINK_MINUTES y
 * sirve una vez (ver authService.setPasswordWithLink). Generar otro anula el anterior.
 */

export const PASSWORD_LINK_MINUTES = 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Página del frontend para definir la contraseña (sin sesión). */
export const passwordLinkUrl = (token: string) => `${appOrigin()}/definir-contrasena?token=${token}`;

/** Enlace nuevo para el usuario: los anteriores sin usar dejan de servir. Devuelve también el token. */
export async function issuePasswordLink(db: Db, user: { id: string; email: string }): Promise<{ token: string; link: PasswordLink }> {
  await db.query("delete from password_setup_tokens where user_id = $1 and used_at is null", [user.id]);
  const token = randomBytes(32).toString("base64url");
  const { expiresAt } = (await one<{ expiresAt: string }>(
    db,
    `insert into password_setup_tokens (user_id, token_hash, expires_at)
     values ($1, $2, now() + make_interval(mins => $3))
     returning expires_at as "expiresAt"`,
    [user.id, sha256(token), PASSWORD_LINK_MINUTES],
  ))!;
  return { token, link: { url: passwordLinkUrl(token), expiresAt, email: user.email } };
}

/**
 * Crea el enlace y lo envía por email con la plantilla que corresponda. La plantilla recibe la
 * dirección con el token oculto (PASSWORD_MASK): así queda en el registro de emails, y el token
 * real va aparte (`secret`) sólo hasta que el email sale (ver mailer.ts). Devuelve el enlace para
 * que el super admin lo copie si el email no llega.
 */
export async function deliverPasswordLink(
  db: Db,
  user: { id: string; email: string },
  email: { businessId: string | null; type: EmailType; compose: (setPasswordUrl: string, linkMinutes: number) => EmailContent },
): Promise<PasswordLink> {
  const { token, link } = await issuePasswordLink(db, user);
  await queueEmail(db, {
    businessId: email.businessId,
    type: email.type,
    to: user.email,
    secret: token,
    ...email.compose(passwordLinkUrl(PASSWORD_MASK), PASSWORD_LINK_MINUTES),
  });
  return link;
}

export interface ValidPasswordLink {
  id: string;
  userId: string;
  expiresAt: string;
}

/** El enlace vigente (sin usar ni caducado) de este token, o null. `lock`: lo bloquea hasta el fin de la transacción. */
export function findPasswordLink(db: Db, token: string, lock = false): Promise<ValidPasswordLink | null> {
  return one<ValidPasswordLink>(
    db,
    `select id, user_id as "userId", expires_at as "expiresAt" from password_setup_tokens
      where token_hash = $1 and used_at is null and expires_at > now()
      ${lock ? "for update" : ""}`,
    [sha256(token)],
  );
}

/** Los enlaces sin usar de un usuario dejan de servir (cambió su contraseña o su email). */
export async function revokePasswordLinks(db: Db, userId: string): Promise<void> {
  await db.query("delete from password_setup_tokens where user_id = $1 and used_at is null", [userId]);
}
