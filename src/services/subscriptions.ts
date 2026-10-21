import { subscriptionColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getEffectiveLimits, getPlan } from "../shared/lib/constants/plans.ts";
import { plural } from "../shared/lib/format.ts";
import type { PlanId, Subscription } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import type { AuditActor } from "./context.ts";
import { countActiveProfessionals, countUsers } from "./plan-limits.ts";

/** Los planes de pago renuevan cada 30 días; Free no tiene renovación. */
export function periodEndFor(planId: PlanId): string | null {
  return planId === "free" ? null : new Date(Date.now() + 30 * 86_400_000).toISOString();
}

/**
 * Cambio de plan. Lo usa el super admin desde el panel de plataforma: en la ficha del negocio o al aprobar
 * una solicitud. Guarda desde cuándo está en el plan (plan_since, spec 015) sólo si el plan cambia. La
 * mensualidad (spec 029) sale sola del plan nuevo desde el siguiente cobro; al pasar de Free a un plan de
 * pago, el día de pago y el primer cobro vuelven a null y ensureBillingSchedule los pone otra vez desde el
 * cambio (su primer cobro, al mes). Entre planes de pago, el día de pago se mantiene.
 */
export async function applyPlanChange(
  db: Db,
  businessId: string,
  planId: PlanId,
  actor: AuditActor,
  action = "subscription.plan_changed",
): Promise<Subscription> {
  const subscription = await one<Subscription>(
    db,
    `select ${subscriptionColumns()} from subscriptions where business_id = $1 for update`,
    [businessId],
  );
  if (!subscription) throw new AppError("not_found", "Suscripción no encontrada.");
  const plan = getPlan(planId);
  const users = await countUsers(db, businessId);
  if (plan.limits.users !== null && users > plan.limits.users) {
    throw new AppError(
      "conflict",
      `El plan ${plan.name} permite ${plan.limits.users} usuario(s) y el negocio tiene ${users}. Quita miembros del equipo antes de cambiar.`,
    );
  }
  const agendas = getEffectiveLimits(plan, subscription.maxProfessionals).professionals;
  const activeProfessionals = await countActiveProfessionals(db, businessId);
  if (agendas !== null && activeProfessionals > agendas) {
    throw new AppError(
      "conflict",
      `El plan ${plan.name} permite ${agendas === 1 ? "una agenda" : `${agendas} agendas`} y el negocio tiene ${activeProfessionals} profesionales activos. Desactiva los que sobran antes de cambiar.`,
    );
  }
  if (!plan.multipleAgendas) {
    const professionals = await one<{ count: number }>(
      db,
      "select count(*)::int as count from business_users where business_id = $1 and role = 'professional'",
      [businessId],
    );
    if (professionals!.count > 0) {
      throw new AppError(
        "conflict",
        `El plan ${plan.name} no tiene el rol Profesional y ${plural(professionals!.count, "miembro lo tiene", "miembros lo tienen")}. Cámbiales el rol antes de cambiar.`,
      );
    }
  }
  const previous = getPlan(subscription.plan);
  const updated = (await one<Subscription>(
    db,
    `update subscriptions set plan = $2, status = 'active', current_period_end = $3,
            plan_since = case when plan = $2 then plan_since else now() end,
            billing_day = case when plan = 'free' and $2 <> 'free' then null else billing_day end,
            billing_start = case when plan = 'free' and $2 <> 'free' then null else billing_start end
      where id = $1
      returning ${subscriptionColumns()}`,
    [subscription.id, plan.id, periodEndFor(plan.id)],
  ))!;
  await logAudit(db, {
    businessId,
    actor,
    action,
    entityType: "subscription",
    entityId: subscription.id,
    summary: `Cambió el plan de ${previous.name} a ${plan.name}`,
  });
  return updated;
}
