import { createHash, randomBytes } from "node:crypto";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { incrementCounter } from "../http/rate-limit-store.ts";
import { formatRewardCode, levelOf, LOYALTY_MIN_SLOTS, PATIENT_RESET_HOURS } from "../shared/lib/constants/loyalty.ts";
import {
  patientDeleteSchema,
  patientLoginSchema,
  patientPasswordSchema,
  patientResetSchema,
  patientSignupSchema,
} from "../shared/lib/validations/loyalty.ts";
import type { BrandColors, LoyaltyNext, PatientAccount, PatientCard, PatientInvite, PatientResetLink, PatientReward, SocialLinks } from "../shared/types/index.ts";
import { hashPassword, verifyPassword } from "./accounts.ts";
import { agendaScope, assertClientInScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";
import { appOrigin } from "./notifications.ts";

/*
 * La cuenta del paciente (spec 052): aparte de las del equipo (sus tablas, su cookie y sus rutas en /api/patient).
 * Entra con su teléfono y su contraseña; ve sólo las tarjetas de los negocios donde un usuario del equipo escaneó su
 * QR en persona y lo unió a su ficha (loyalty-scan.ts). Una sesión de paciente nunca pasa por authorize().
 */

export const PATIENT_SESSION_DAYS = 180;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_PER_PHONE = 10;
const WRONG_LOGIN = "El teléfono o la contraseña no coinciden.";

/*
 * Bloqueo creciente (la contraseña puede ser un PIN de 4 números, pedido del dueño): los fallos seguidos de un
 * teléfono se cuentan en rate_limits (`paciente-fallos:<teléfono>`, la cuenta se olvida 30 días después del último
 * fallo). Desde el 5.º, hay que esperar 15 minutos, y cada fallo más duplica la espera hasta 24 horas. Entrar bien o
 * cambiar la contraseña con el enlace del consultorio la pone en cero. Cuenta también los teléfonos sin cuenta: el
 * aviso no revela si existe. Con un fallo al día como mucho, adivinar un PIN que no sea de los fáciles tomaría años.
 */
const LOCK_AFTER_FAILURES = 5;
const LOCK_FIRST_MS = 15 * 60_000;
const LOCK_MAX_MS = 24 * 60 * 60_000;
const FAILURES_MEMORY_MS = 30 * 24 * 60 * 60_000;
const failuresKey = (phone: string) => `paciente-fallos:${phone}`;

/** La espera después de `failures` fallos seguidos (0 antes del 5.º). */
export function lockDurationMs(failures: number): number {
  if (failures < LOCK_AFTER_FAILURES) return 0;
  return Math.min(LOCK_FIRST_MS * 2 ** (failures - LOCK_AFTER_FAILURES), LOCK_MAX_MS);
}

/** «15 minutos», «1 hora», «24 horas». */
function waitText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

/** Los fallos seguidos y hasta cuándo hay que esperar (null: puede intentarlo). */
async function lockOf(db: Db, phone: string): Promise<{ failures: number; until: Date | null }> {
  const row = await one<{ hits: number; resetAt: string }>(
    db,
    `select hits, reset_at as "resetAt" from rate_limits where key = $1 and reset_at > now()`,
    [failuresKey(phone)],
  );
  if (!row) return { failures: 0, until: null };
  const lastFailure = new Date(row.resetAt).getTime() - FAILURES_MEMORY_MS;
  const until = lastFailure + lockDurationMs(row.hits);
  return { failures: row.hits, until: until > Date.now() ? new Date(until) : null };
}

async function recordFailure(db: Db, phone: string): Promise<number> {
  const row = (await one<{ hits: number }>(
    db,
    `insert into rate_limits (key, hits, reset_at) values ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
     on conflict (key) do update
       set hits = case when rate_limits.reset_at <= now() then 1 else rate_limits.hits + 1 end, reset_at = excluded.reset_at
     returning hits`,
    [failuresKey(phone), FAILURES_MEMORY_MS],
  ))!;
  return row.hits;
}

const clearFailures = (db: Db, phone: string) => db.query("delete from rate_limits where key = $1", [failuresKey(phone)]);

const lockedMessage = (until: Date) =>
  `Por seguridad, espera ${waitText(until.getTime() - Date.now())} antes de volver a intentarlo. Si olvidaste tu contraseña, pide en tu consultorio un enlace para cambiarla.`;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Un hash de bcrypt para comparar cuando el teléfono no existe: tarda lo mismo (no revela si hay cuenta). */
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

const ACCOUNT_COLUMNS = `a.id, a.name, a.phone, a.qr_token as "qrToken", a.created_at as "createdAt",
  case when a.reset_at is null then null else json_build_object('businessName', coalesce(b.name, 'tu consultorio'), 'at', a.reset_at) end as "passwordReset"`;

async function accountOf(db: Db, accountId: string): Promise<PatientAccount> {
  const account = await one<PatientAccount>(
    db,
    `select ${ACCOUNT_COLUMNS} from patient_accounts a left join businesses b on b.id = a.reset_by_business_id where a.id = $1`,
    [accountId],
  );
  if (!account) throw new AppError("unauthorized", "Inicia sesión con tu teléfono.");
  return account;
}

/* ------------------------------------------------------------------- Sesiones -- */

export async function createPatientSession(accountId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const row = (await one<{ expiresAt: string }>(
    pool,
    `insert into patient_sessions (account_id, token_hash, expires_at) values ($1, $2, now() + make_interval(days => $3))
     returning expires_at as "expiresAt"`,
    [accountId, sha256(token), PATIENT_SESSION_DAYS],
  ))!;
  return { token, expiresAt: new Date(row.expiresAt) };
}

/** La cuenta de una cookie (null si no existe o venció). */
export async function findPatientSession(token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const row = await one<{ accountId: string }>(
    pool,
    `select account_id as "accountId" from patient_sessions where token_hash = $1 and expires_at > now()`,
    [sha256(token)],
  );
  return row?.accountId ?? null;
}

export async function endPatientSession(token: string): Promise<void> {
  if (token) await pool.query("delete from patient_sessions where token_hash = $1", [sha256(token)]);
}

export async function deleteExpiredPatientSessions(db: Db = pool): Promise<number> {
  const sessions = await db.query("delete from patient_sessions where expires_at < now()");
  const links = await db.query("delete from patient_password_links where expires_at < now() - interval '30 days'");
  return (sessions.rowCount ?? 0) + (links.rowCount ?? 0);
}

/* ---------------------------------------------------------------- La tarjeta -- */

interface CardRow {
  clientId: string;
  cardNumber: number;
  businessId: string;
  businessName: string;
  slug: string;
  logoUrl: string | null;
  brandColors: BrandColors | null;
  socialLinks: SocialLinks;
  timezone: string;
  programName: string;
  programDescription: string;
  stampIcon: PatientCard["program"]["stampIcon"];
  afterLast: PatientCard["program"]["afterLast"];
}

async function cardsOf(db: Db, accountId: string): Promise<PatientCard[]> {
  const rows = await many<CardRow>(
    db,
    `select k.client_id as "clientId", k.card_number as "cardNumber", b.id as "businessId", b.name as "businessName", b.slug,
            b.logo_url as "logoUrl", b.brand_colors as "brandColors",
            json_build_object('facebook', b.facebook_url, 'instagram', b.instagram_url, 'tiktok', b.tiktok_url) as "socialLinks",
            b.timezone, p.name as "programName", p.description as "programDescription", p.stamp_icon as "stampIcon",
            p.after_last as "afterLast"
       from loyalty_cards k
       join businesses b on b.id = k.business_id and b.status = 'active'
       join loyalty_programs p on p.business_id = k.business_id and p.enabled_at is not null
       join clients c on c.id = k.client_id and c.is_active
       join patient_accounts a on a.id = k.patient_account_id
      where k.patient_account_id = $1
        -- Revisión de seguridad: quien cambió la contraseña con el enlace de un consultorio ve sólo la tarjeta de ese
        -- consultorio y las de los que lo vuelvan a escanear después (no las visitas a otros consultorios).
        and (a.reset_at is null or k.business_id = a.reset_by_business_id or k.linked_at > a.reset_at)
      order by b.name`,
    [accountId],
  );
  const cards: PatientCard[] = [];
  for (const row of rows) {
    const [{ stamps }, benefits, rewards, visits] = await Promise.all([
      one<{ stamps: number }>(
        db,
        "select count(*)::int as stamps from loyalty_stamps where client_id = $1 and card_number = $2 and voided_at is null",
        [row.clientId, row.cardNumber],
      ).then((value) => value!),
      many<PatientCard["benefits"][number] & { id: string }>(
        db,
        `select id, visits_required as "visitsRequired", name, description, conditions, valid_days as "validDays"
           from loyalty_benefits where business_id = $1 and archived_at is null and is_active order by visits_required`,
        [row.businessId],
      ),
      many<PatientReward>(
        db,
        `select r.id, r.name, r.description, r.conditions, r.visits_required as "visitsRequired", r.code,
                case when r.status = 'available' and r.expires_at is not null and r.expires_at <= now() then 'expired' else r.status end as status,
                r.unlocked_at as "unlockedAt", r.expires_at as "expiresAt", r.redeemed_at as "redeemedAt"
           from loyalty_rewards r where r.client_id = $1 order by r.unlocked_at desc`,
        [row.clientId],
      ),
      many<PatientCard["visits"][number]>(
        db,
        `select to_char(a.date, 'YYYY-MM-DD') as date, s.name as "serviceName"
           from loyalty_stamps t join appointments a on a.id = t.appointment_id join services s on s.id = a.service_id
          where t.client_id = $1 and t.voided_at is null
          order by a.date desc, a.start_time desc limit 50`,
        [row.clientId],
      ),
    ]);
    const next = benefits.find((benefit) => benefit.visitsRequired > stamps);
    const nextOf: LoyaltyNext | null = next
      ? { benefitId: next.id, name: next.name, visitsRequired: next.visitsRequired, missing: next.visitsRequired - stamps }
      : null;
    cards.push({
      business: {
        id: row.businessId,
        name: row.businessName,
        slug: row.slug,
        logoUrl: row.logoUrl,
        brandColors: row.brandColors,
        socialLinks: row.socialLinks,
        timezone: row.timezone,
      },
      program: { name: row.programName, description: row.programDescription, stampIcon: row.stampIcon, afterLast: row.afterLast },
      level: levelOf(row.cardNumber),
      cardNumber: row.cardNumber,
      stamps,
      slots: Math.max(LOYALTY_MIN_SLOTS, benefits.at(-1)?.visitsRequired ?? 0),
      benefits: benefits.map(({ id: _id, ...benefit }) => benefit),
      next: nextOf,
      rewards: rewards.map((reward) => ({ ...reward, code: formatRewardCode(reward.code) })),
      visits,
    });
  }
  return cards;
}

/* ---------------------------------------------------------------- El servicio -- */

export const patientAccountService = {
  /**
   * La invitación del QR del consultorio (/mi-tarjeta?consultorio=<slug>): su nombre, su logo, sus colores y el nombre
   * del programa si está encendido. Pública y de una sola consulta; null si no hay un negocio activo con ese enlace.
   */
  async invite(slug: string): Promise<PatientInvite | null> {
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
    return one<PatientInvite>(
      pool,
      `select b.name, b.logo_url as "logoUrl", b.brand_colors as "brandColors",
              case when p.enabled_at is not null then p.name end as "programName"
         from businesses b left join loyalty_programs p on p.business_id = b.id
        where b.slug = $1 and b.status = 'active'`,
      [slug],
    );
  },

  /** Crear la cuenta: un teléfono, una cuenta. Devuelve su id (la ruta abre la sesión). */
  async signup(input: unknown): Promise<string> {
    const data = parseInput(patientSignupSchema, input);
    const existing = await one(pool, "select 1 from patient_accounts where phone = $1", [data.phone]);
    if (existing) throw new AppError("conflict", "Ya hay una cuenta con este teléfono: inicia sesión.");
    const row = await one<{ id: string }>(
      pool,
      `insert into patient_accounts (name, phone, password_hash) values ($1, $2, $3) on conflict (phone) do nothing returning id`,
      [data.name, data.phone, await hashPassword(data.password)],
    );
    if (!row) throw new AppError("conflict", "Ya hay una cuenta con este teléfono: inicia sesión.");
    return row.id;
  },

  /**
   * Entrar: con el bloqueo creciente por fallos seguidos (arriba) y un límite de intentos por teléfono (además del de
   * la IP en la ruta).
   */
  async login(input: unknown): Promise<string> {
    const data = parseInput(patientLoginSchema, input);
    const lock = await lockOf(pool, data.phone);
    if (lock.until) throw new AppError("rate_limited", lockedMessage(lock.until));
    const { hits } = await incrementCounter(pool, `paciente-login:${data.phone}`, LOGIN_WINDOW_MS);
    if (hits > LOGIN_MAX_PER_PHONE) {
      throw new AppError("rate_limited", "Demasiados intentos con este teléfono. Espera 15 minutos e inténtalo de nuevo.");
    }
    const row = await one<{ id: string; passwordHash: string }>(
      pool,
      `select id, password_hash as "passwordHash" from patient_accounts where phone = $1`,
      [data.phone],
    );
    const valid = await verifyPassword(data.password, row?.passwordHash ?? (await dummy()));
    if (!row || !valid) {
      const failures = await recordFailure(pool, data.phone);
      const left = LOCK_AFTER_FAILURES - failures;
      if (left <= 0) throw new AppError("rate_limited", lockedMessage(new Date(Date.now() + lockDurationMs(failures))));
      if (left <= 2) {
        throw new AppError("unauthorized", `${WRONG_LOGIN} ${left === 1 ? "Te queda 1 intento" : `Te quedan ${left} intentos`} antes de tener que esperar.`);
      }
      throw new AppError("unauthorized", WRONG_LOGIN);
    }
    if (lock.failures > 0) await clearFailures(pool, data.phone);
    return row.id;
  },

  me: (accountId: string) => accountOf(pool, accountId),

  cards: (accountId: string) => cardsOf(pool, accountId),

  /** Un QR nuevo: el anterior deja de servir. */
  async newQr(accountId: string): Promise<PatientAccount> {
    await pool.query("update patient_accounts set qr_token = replace(gen_random_uuid()::text, '-', ''), updated_at = now() where id = $1", [
      accountId,
    ]);
    return accountOf(pool, accountId);
  },

  async changePassword(accountId: string, input: unknown, keepSessionToken: string): Promise<void> {
    const data = parseInput(patientPasswordSchema, input);
    const row = await one<{ passwordHash: string }>(pool, `select password_hash as "passwordHash" from patient_accounts where id = $1`, [accountId]);
    if (!row || !(await verifyPassword(data.currentPassword, row.passwordHash))) {
      throw new AppError("validation", "Tu contraseña actual no coincide.");
    }
    await pool.query("update patient_accounts set password_hash = $2, updated_at = now() where id = $1", [
      accountId,
      await hashPassword(data.newPassword),
    ]);
    // Las demás sesiones se cierran y los enlaces del consultorio que quedaban dejan de servir.
    await pool.query("delete from patient_sessions where account_id = $1 and token_hash <> $2", [accountId, sha256(keepSessionToken)]);
    await pool.query("update patient_password_links set used_at = now() where account_id = $1 and used_at is null", [accountId]);
  },

  /** Eliminar la cuenta: los negocios conservan la ficha, los sellos y los premios; la cuenta y su QR desaparecen. */
  async deleteAccount(accountId: string, input: unknown): Promise<void> {
    const { password } = parseInput(patientDeleteSchema, input ?? {});
    const row = await one<{ passwordHash: string }>(pool, `select password_hash as "passwordHash" from patient_accounts where id = $1`, [accountId]);
    if (!row || !(await verifyPassword(password, row.passwordHash))) throw new AppError("validation", "Tu contraseña no coincide.");
    await pool.query("delete from patient_accounts where id = $1", [accountId]);
  },

  /** El enlace del consultorio para cambiar la contraseña: si sirve todavía, el nombre de pila para saludar. */
  async resetInfo(token: string): Promise<{ valid: boolean; firstName: string | null }> {
    const row = token.length <= 200
      ? await one<{ name: string }>(
          pool,
          `select a.name from patient_password_links l join patient_accounts a on a.id = l.account_id
            where l.token_hash = $1 and l.used_at is null and l.expires_at > now()`,
          [sha256(token)],
        )
      : null;
    return { valid: Boolean(row), firstName: row ? (row.name.trim().split(/\s+/)[0] ?? null) : null };
  },

  /** Usar el enlace: una sola vez; cierra todas las sesiones y deja el aviso con el negocio y la fecha. */
  async resetPassword(token: string, input: unknown): Promise<string> {
    const data = parseInput(patientResetSchema, input);
    const hash = await hashPassword(data.password);
    return transaction(async (db) => {
      const link = token.length <= 200
        ? await one<{ accountId: string; businessId: string }>(
            db,
            `update patient_password_links set used_at = now()
              where token_hash = $1 and used_at is null and expires_at > now()
              returning account_id as "accountId", business_id as "businessId"`,
            [sha256(token)],
          )
        : null;
      if (!link) throw new AppError("not_found", "Este enlace ya se usó o venció. Pide otro en tu consultorio.");
      const { phone } = (await one<{ phone: string }>(
        db,
        `update patient_accounts set password_hash = $2, reset_by_business_id = $3, reset_at = now(), updated_at = now() where id = $1
         returning phone`,
        [link.accountId, hash, link.businessId],
      ))!;
      // Con la contraseña nueva, la espera por los intentos fallidos se termina.
      await clearFailures(db, phone);
      await db.query("delete from patient_sessions where account_id = $1", [link.accountId]);
      // Los otros enlaces que quedaban (de cualquier consultorio) dejan de servir.
      await db.query("update patient_password_links set used_at = now() where account_id = $1 and used_at is null", [link.accountId]);
      return link.accountId;
    });
  },

  /**
   * El equipo genera el enlace para cambiar la contraseña de la cuenta unida a una ficha: de un solo uso, por 24
   * horas, con el teléfono de la cuenta para abrir WhatsApp. Queda en la actividad.
   */
  async resetLink(ctx: RequestContext, businessId: string, clientId: string): Promise<PatientResetLink> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.manage", { lock: true });
      if (!isUuid(clientId)) throw new AppError("not_found", "Cliente no encontrado.");
      await assertClientInScope(db, await agendaScope(db, actor, businessId), clientId);
      const account = await one<{ id: string; phone: string; clientName: string }>(
        db,
        `select a.id, a.phone, c.name as "clientName"
           from loyalty_cards k join patient_accounts a on a.id = k.patient_account_id join clients c on c.id = k.client_id
          where k.client_id = $1 and k.business_id = $2`,
        [clientId, businessId],
      );
      if (!account) throw new AppError("conflict", "Este paciente no tiene una cuenta unida a su ficha.");
      // Un enlace nuevo anula los anteriores sin usar.
      await db.query("update patient_password_links set used_at = now() where account_id = $1 and used_at is null", [account.id]);
      const token = randomBytes(32).toString("base64url");
      const row = (await one<{ expiresAt: string }>(
        db,
        `insert into patient_password_links (token_hash, account_id, business_id, created_by, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(hours => $5)) returning expires_at as "expiresAt"`,
        [sha256(token), account.id, businessId, actor.userId, PATIENT_RESET_HOURS],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "loyalty.patient_reset_link",
        entityType: "loyalty",
        entityId: clientId,
        summary: `Generó un enlace para que ${account.clientName} cambie la contraseña de su cuenta`,
      });
      return { url: `${appOrigin()}/mi-tarjeta/clave/${token}`, phone: account.phone, expiresAt: row.expiresAt };
    });
  },
};
