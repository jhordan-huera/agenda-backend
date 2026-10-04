import { subscriptionColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getPlan } from "../shared/lib/constants/plans.ts";
import type { PlanId, Subscription } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import type { AuditActor } from "./context.ts";
import { countUsers } from "./plan-limits.ts";

/** Los planes de pago renuevan cada 30 días; Free no tiene renovación. */
export function periodEndFor(planId: PlanId): string | null {
  return getPlan(planId).price > 0 ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;
}

/**
 * Cambio de plan (sin cobro hasta integrar pagos). Lo usan el propietario desde
 * Configuración y el super admin desde el panel de plataforma. Con pagos reales lo
 * aplicaría el webhook del proveedor (Stripe).
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
  const previous = getPlan(subscription.plan);
  const updated = (await one<Subscription>(
    db,
    `update subscriptions set plan = $2, status = 'active', current_period_end = $3
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
