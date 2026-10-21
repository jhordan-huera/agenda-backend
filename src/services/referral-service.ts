import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { REFERRAL_DISCOUNT, REFERRAL_QUALIFY_DAYS, formatReferralAmount } from "../shared/lib/constants/business.ts";
import { referredBySchema } from "../shared/lib/validations/admin.ts";
import type { AdminBusinessReferrals, BusinessReferrals, ReferralReward, ReferredBusiness } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { authorize, authorizeSuperAdmin, parseInput, type AuditActor, type RequestContext } from "./context.ts";
import { appOrigin } from "./notifications.ts";

/**
 * El programa de referidos (spec 023). Cada negocio tiene su código (migración 046) y su enlace,
 * `<portada>/?ref=<código>`. El super admin anota «Recomendado por»; una recomendación «se queda» cuando el
 * negocio recomendado sigue activo a los 30 días de crearse, y entonces quien lo recomendó gana $1,50 de
 * descuento en su siguiente mensualidad, una sola vez. Que se ganó se calcula al leer; sólo se guarda
 * cuándo se aplicó.
 *
 * Desde la spec 029 el descuento va solo en el siguiente cobro de la mensualidad (billing-service.ts): el
 * cobro guarda las recomendaciones que usa y, al pagarse, quedan aplicadas. Mientras un cobro abierto las
 * usa, no salen en «Descuentos por referidos» ni se pueden marcar a mano; el dueño sigue marcando así las
 * de un negocio sin mensualidad.
 */

/** Los códigos: 6 caracteres, letras mayúsculas sin I ni O y números del 2 al 9 (como el check de la 046). */
const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

/** SQL: la recomendación del negocio `alias` se quedó (activo y con 30 días o más desde su alta). */
const qualifiedSql = (alias: string) =>
  `(${alias}.status = 'active' and ${alias}.created_at <= now() - make_interval(days => ${REFERRAL_QUALIFY_DAYS}))`;

/** SQL: la recomendación del negocio `alias` va en un cobro abierto de la mensualidad (spec 029). */
const inOpenChargeSql = (alias: string) =>
  `exists (select 1 from billing_charges c where c.status in ('due', 'in_review', 'rejected') and ${alias}.id = any(c.referral_ids))`;

/**
 * Las recomendaciones de `referrerId` con el descuento ganado y libre: sin aplicar y sin un cobro abierto
 * que ya las use. La más antigua primero (así las usa el siguiente cobro).
 */
export async function availableRewardIds(db: Db, referrerId: string): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select r.id from businesses r
      where r.referred_by = $1 and r.referral_reward_applied_at is null and ${qualifiedSql("r")} and not ${inOpenChargeSql("r")}
      order by r.created_at, r.id`,
    [referrerId],
  );
  return rows.map((row) => row.id);
}

/** Marca aplicados los descuentos de estas recomendaciones (al pagarse el cobro que los usa). Devuelve cuántos. */
export async function applyRewards(db: Db, referredIds: string[]): Promise<number> {
  if (referredIds.length === 0) return 0;
  const result = await db.query(
    "update businesses set referral_reward_applied_at = now() where id = any($1::uuid[]) and referral_reward_applied_at is null",
    [referredIds],
  );
  return result.rowCount ?? 0;
}

/** El enlace para recomendar: la portada con el código, que «Quiero mi agenda» nombra en su mensaje. */
export const referralLink = (code: string) => `${appOrigin()}/?ref=${code}`;

interface NamedBusiness {
  id: string;
  name: string;
}

/**
 * El negocio que recomendó a `businessId` (o null): tiene que existir y no ser él mismo. `businessId` es
 * null en el alta (el negocio todavía no existe).
 */
async function findReferrer(db: Db, businessId: string | null, referredBy: string | null): Promise<NamedBusiness | null> {
  if (referredBy === null || referredBy === "") return null;
  if (businessId !== null && referredBy === businessId) {
    throw new AppError("validation", "Un negocio no puede recomendarse a sí mismo.");
  }
  const referrer = isUuid(referredBy)
    ? await one<NamedBusiness>(db, "select id, name from businesses where id = $1", [referredBy])
    : null;
  if (!referrer) throw new AppError("validation", "Elige el negocio que lo recomendó.");
  return referrer;
}

/** «Recomendado por» en la actividad del negocio recomendado (spec 023): anotarlo, cambiarlo o quitarlo. */
async function logReferredBy(
  db: Db,
  actor: AuditActor,
  business: NamedBusiness,
  before: NamedBusiness | null,
  after: NamedBusiness | null,
): Promise<void> {
  await logAudit(db, {
    businessId: business.id,
    actor,
    action: "platform.referred_by_changed",
    entityType: "business",
    entityId: business.id,
    summary: after
      ? `Anotó que ${business.name} fue recomendado por ${after.name}`
      : `Quitó que ${business.name} fue recomendado por ${before?.name ?? "otro negocio"}`,
    changes: [{ label: "Recomendado por", before: before?.name ?? "Nadie", after: after?.name ?? "Nadie" }],
  });
}

/**
 * Alta de un negocio desde /admin con «Recomendado por» (dentro de la transacción del alta): lo guarda y
 * lo anota en la actividad. Sin recomendación, no hace nada.
 */
export async function setReferredByOnCreate(
  db: Db,
  actor: AuditActor,
  business: NamedBusiness,
  referredBy: string | null,
): Promise<void> {
  const referrer = await findReferrer(db, null, referredBy);
  if (!referrer) return;
  await db.query("update businesses set referred_by = $2 where id = $1", [business.id, referrer.id]);
  await logReferredBy(db, actor, business, null, referrer);
}

/** Lo que muestra la ficha de /admin: quién lo recomendó y a quién recomendó (el más nuevo primero). */
export async function adminReferralsOf(db: Db, businessId: string): Promise<AdminBusinessReferrals> {
  // Una detrás de otra: dentro de una transacción, `db` es una sola conexión.
  const referredBy = await one<NamedBusiness>(
    db,
    "select p.id, p.name from businesses b join businesses p on p.id = b.referred_by where b.id = $1",
    [businessId],
  );
  const referred = await many<ReferredBusiness>(
    db,
    `select r.id, r.name, r.status, r.created_at as "createdAt", ${qualifiedSql("r")} as qualified,
            r.referral_reward_applied_at as "rewardAppliedAt"
       from businesses r
      where r.referred_by = $1
      order by r.created_at desc, r.name`,
    [businessId],
  );
  return { referredBy: referredBy ?? null, referred };
}

/** La tarjeta «Recomienda Agenda360» del propietario (Configuración → Negocio). */
export const referralService = {
  /**
   * Su código, su enlace, cuántos recomendó y cuántos se quedaron (activos a los 30 días, o con el
   * descuento ya aplicado aunque después se suspendieran). Sólo el propietario (y el super admin en modo
   * soporte, que actúa como él): los demás roles reciben 403.
   */
  async getForBusiness(ctx: RequestContext, businessId: string): Promise<BusinessReferrals> {
    const actor = await authorize(pool, ctx, businessId);
    if (actor.role !== "owner") throw new AppError("forbidden", "Sólo el propietario ve el programa de referidos.");
    const row = await one<{ code: string; referred: number; qualified: number }>(
      pool,
      `select b.referral_code as code,
              (select count(*) from businesses r where r.referred_by = b.id)::int as referred,
              (select count(*) from businesses r
                where r.referred_by = b.id and (r.referral_reward_applied_at is not null or ${qualifiedSql("r")}))::int as qualified
         from businesses b
        where b.id = $1`,
      [businessId],
    );
    if (!row) throw new AppError("not_found", "Negocio no encontrado.");
    return { code: row.code, link: referralLink(row.code), referred: row.referred, qualified: row.qualified };
  },
};

/** La portada con `?ref=<código>`: sólo el nombre de un negocio activo, para «Me recomendó <negocio>». */
export const publicReferralService = {
  async getReferrer(code: string): Promise<{ name: string }> {
    const normalized = code.trim().toUpperCase();
    const referrer = REFERRAL_CODE_PATTERN.test(normalized)
      ? await one<{ name: string }>(pool, "select name from businesses where referral_code = $1 and status = 'active'", [
          normalized,
        ])
      : null;
    if (!referrer) throw new AppError("not_found", "No encontramos ese código de recomendación.");
    return referrer;
  },
};

/** /admin: «Recomendado por» en la ficha y «Descuentos por referidos» en el Inicio. */
export const adminReferralService = {
  /**
   * Anota, cambia o quita quién recomendó al negocio, con su entrada en la actividad. Un descuento ya
   * aplicado no se vuelve a ganar aunque cambie quién lo recomendó: cada negocio recomendado da uno solo.
   */
  async setReferredBy(ctx: RequestContext, businessId: string, input: unknown): Promise<AdminBusinessReferrals> {
    const actor = authorizeSuperAdmin(ctx);
    const { referredBy } = parseInput(referredBySchema, input ?? {});
    return transaction(async (db) => {
      const business = isUuid(businessId)
        ? await one<NamedBusiness & { referredBy: string | null }>(
            db,
            `select id, name, referred_by as "referredBy" from businesses where id = $1 for no key update`,
            [businessId],
          )
        : null;
      if (!business) throw new AppError("not_found", "Negocio no encontrado.");
      const next = await findReferrer(db, business.id, referredBy);
      if ((next?.id ?? null) !== business.referredBy) {
        const before = business.referredBy
          ? await one<NamedBusiness>(db, "select id, name from businesses where id = $1", [business.referredBy])
          : null;
        await db.query("update businesses set referred_by = $2 where id = $1", [business.id, next?.id ?? null]);
        await logReferredBy(db, actor, business, before, next);
      }
      return adminReferralsOf(db, business.id);
    });
  },

  /**
   * Los descuentos ganados y pendientes de aplicar, el más antiguo primero. Sin los que ya van en un cobro
   * abierto de la mensualidad (spec 029): se aplican solos al pagarse.
   */
  async listRewards(ctx: RequestContext): Promise<ReferralReward[]> {
    authorizeSuperAdmin(ctx);
    const rows = await many<{ businessId: string; businessName: string; referrerId: string; referrerName: string; earnedAt: string }>(
      pool,
      `select r.id as "businessId", r.name as "businessName", p.id as "referrerId", p.name as "referrerName",
              r.created_at + make_interval(days => ${REFERRAL_QUALIFY_DAYS}) as "earnedAt"
         from businesses r
         join businesses p on p.id = r.referred_by
        where r.referral_reward_applied_at is null and ${qualifiedSql("r")} and not ${inOpenChargeSql("r")}
        order by "earnedAt", p.name, r.name`,
    );
    return rows.map((row) => ({
      business: { id: row.businessId, name: row.businessName },
      referrer: { id: row.referrerId, name: row.referrerName },
      earnedAt: row.earnedAt,
      amount: REFERRAL_DISCOUNT,
    }));
  },

  /**
   * «Marcar como aplicado»: el dueño ya descontó los $1,50 al cobrar a quien recomendó. Queda en la
   * actividad de la plataforma, sin negocio: la actividad del negocio la ven también sus administradores,
   * y el descuento sólo lo ve el propietario (constitución, principio III). 409 si no se ganó, ya se aplicó
   * o ya va en un cobro abierto de la mensualidad (spec 029: se aplica solo al pagarse).
   */
  async applyReward(ctx: RequestContext, businessId: string): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    await transaction(async (db) => {
      const row = isUuid(businessId)
        ? await one<NamedBusiness & { appliedAt: string | null; qualified: boolean; inCharge: boolean; referrerName: string | null }>(
            db,
            `select r.id, r.name, r.referral_reward_applied_at as "appliedAt", ${qualifiedSql("r")} as qualified,
                    ${inOpenChargeSql("r")} as "inCharge", p.name as "referrerName"
               from businesses r
               left join businesses p on p.id = r.referred_by
              where r.id = $1
                for update of r`,
            [businessId],
          )
        : null;
      if (!row) throw new AppError("not_found", "Negocio no encontrado.");
      if (row.appliedAt) throw new AppError("conflict", "Este descuento ya se aplicó.");
      if (row.inCharge) {
        throw new AppError("conflict", "Este descuento ya va en un cobro de la mensualidad: se aplica solo al marcarlo pagado.");
      }
      if (!row.referrerName || !row.qualified) {
        throw new AppError(
          "conflict",
          `Este descuento todavía no se ganó: el negocio recomendado tiene que seguir activo ${REFERRAL_QUALIFY_DAYS} días.`,
        );
      }
      await db.query("update businesses set referral_reward_applied_at = now() where id = $1", [row.id]);
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.referral_reward_applied",
        entityType: "business",
        entityId: row.id,
        summary: `Aplicó el descuento de ${formatReferralAmount(REFERRAL_DISCOUNT)} a ${row.referrerName} por recomendar a ${row.name}`,
      });
    });
  },
};
