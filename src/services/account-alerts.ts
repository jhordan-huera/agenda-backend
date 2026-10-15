import { many, one, type Db } from "../db/pool.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { getFullName } from "../shared/lib/format.ts";
import type { User } from "../shared/types/index.ts";
import { maskEmail } from "./masking.ts";
import { appOrigin, queueEmail } from "./notifications.ts";
import type { ClientConnection } from "./session-security.ts";

/**
 * Cambios de seguridad en las cuentas de super admin (spec 009): activar o desactivar la
 * verificación en dos pasos y cambiar la contraseña. Son los que permiten quedarse con una cuenta que
 * llega a todos los negocios (p. ej. entrar antes que el dueño en una cuenta nueva y activar la
 * verificación con otro celular), así que nunca pasan sin que se note:
 * - un email al momento a la cuenta y al super admin principal;
 * - un aviso por ntfy en la siguiente pasada del cron, leyendo el registro de actividad.
 */

/** Hora del registro de la plataforma: la del dueño del producto. */
const PLATFORM_TIMEZONE = "America/Guayaquil";

/** "14 de octubre de 2026, 15:32 (hora de Ecuador)" */
function describeMoment(at: Date): string {
  const text = new Intl.DateTimeFormat("es-EC", { timeZone: PLATFORM_TIMEZONE, dateStyle: "long", timeStyle: "short" }).format(at);
  return `${text} (hora de Ecuador)`;
}

/** El navegador, sin la cadena entera (basta para reconocerlo). */
const describeBrowser = (userAgent: string | null) => (userAgent ? userAgent.slice(0, 160) : "Desconocido");

/**
 * Email del cambio a la cuenta afectada y al super admin principal (uno solo si es la misma persona).
 * Dentro de la transacción del cambio: si el cambio no se guarda, el email tampoco sale.
 */
export async function queueAccountSecurityEmail(db: Db, user: User, change: string, connection: ClientConnection): Promise<void> {
  const owner = await one<{ email: string }>(db, "select email from users where platform_owner and is_active limit 1");
  const recipients = [user.email, owner?.email].filter((email): email is string => Boolean(email));
  const unique = recipients.filter((email, index) => recipients.findIndex((other) => other.toLowerCase() === email.toLowerCase()) === index);
  const content = emailTemplates.accountSecurityChanged({
    accountName: getFullName(user),
    accountEmail: user.email,
    change,
    at: describeMoment(new Date()),
    ip: connection.ip,
    browser: describeBrowser(connection.userAgent),
    reviewUrl: `${appOrigin()}/admin/activity`,
  });
  for (const to of unique) {
    await queueEmail(db, { businessId: null, type: "account_security_changed", to, ...content });
  }
}

/* ------------------------------------------------------------ Aviso de ntfy -- */

/** Cambios detallados por pasada del cron; de los demás sólo se dice cuántos son. */
export const MAX_ACCOUNT_NOTICES = 10;

/** Las acciones del registro que avisan, con cómo se cuentan. */
const ACCOUNT_CHANGES: Record<string, string> = {
  "session.two_factor_enabled": "Activó la verificación en dos pasos",
  "session.two_factor_disabled": "Desactivó la verificación en dos pasos",
  "session.two_factor_reset": "Se reinició su verificación en dos pasos (npm run db:reset-2fa)",
  "session.password_changed": "Cambió su contraseña",
  "platform.user_password_changed": "Le cambiaron la contraseña desde el panel",
};

export interface AccountChange {
  /** El registro de actividad: la clave del aviso en el celular (spec 013), que sale una vez por registro. */
  id: string;
  /** La cuenta, ya enmascarada ("ma***@gmail.com"): el aviso va por ntfy. */
  account: string;
  change: string;
  at: string;
  /** Quién lo hizo: la propia cuenta, otro super admin o el comando de emergencia. */
  by: "self" | "other" | "command";
}

/** Aviso de ntfy de un cambio de cuenta. El título no lleva nombres (el registro de Actions es público). */
export function accountChangeNotice(change: AccountChange) {
  return {
    title: "Agenda360: cambio en una cuenta de super admin",
    message: [
      `Cuenta: ${change.account}`,
      change.change,
      describeMoment(new Date(change.at)),
      change.by === "other" ? "Lo hizo otro super admin." : change.by === "command" ? "Desde el servidor (comando de emergencia)." : "Lo hizo la propia cuenta.",
      "",
      "Si no lo reconoces, revisa la cuenta en /admin.",
    ].join("\n"),
    priority: 4 as const,
    tags: ["key"],
    click: "/admin/activity",
  };
}

/**
 * Los cambios de cuentas de super admin en (since, until], los más antiguos primero (hasta `limit`),
 * y cuántos hubo en total. Sin `since` (primera pasada), las últimas 24 h.
 */
export async function findAccountChanges(
  db: Db,
  since: string | null,
  until: string,
  limit = MAX_ACCOUNT_NOTICES,
): Promise<{ changes: AccountChange[]; total: number }> {
  const rows = await many<{ id: string; action: string; email: string; actorId: string | null; userId: string; at: string; total: number }>(
    db,
    `select l.id, l.action, u.email, l.actor_id as "actorId", u.id as "userId", l.created_at as at, count(*) over ()::int as total
       from audit_logs l
       join users u on u.id = l.entity_id
      where l.entity_type in ('session', 'user') and l.action = any($4::text[])
        and u.platform_role = 'super_admin'
        and l.created_at > coalesce($1::timestamptz, now() - interval '1 day') and l.created_at <= $2
      order by l.created_at, l.id
      limit $3`,
    [since, until, limit, Object.keys(ACCOUNT_CHANGES)],
  );
  return {
    total: rows[0]?.total ?? 0,
    changes: rows.map((row) => ({
      id: row.id,
      account: maskEmail(row.email),
      change: ACCOUNT_CHANGES[row.action],
      at: row.at,
      by: row.actorId === null ? "command" : row.actorId === row.userId ? "self" : "other",
    })),
  };
}
