import { one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getPlan, type Plan } from "../shared/lib/constants/plans.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import type { ISODate, PlanId, PlanUsage } from "../shared/types/index.ts";

/**
 * Límites de cada plan. Se comprueban dentro de la transacción que bloquea la fila del
 * negocio (ver `authorize` con `lock`), así que dos altas simultáneas no superan el cupo.
 */

export async function planOf(db: Db, businessId: string): Promise<Plan> {
  const row = await one<{ plan: PlanId }>(db, "select plan from subscriptions where business_id = $1", [businessId]);
  return getPlan(row?.plan ?? "free");
}

/** Citas no canceladas del mes "YYYY-MM" (opcionalmente sin contar una cita que se está editando). */
async function activeAppointmentsInMonth(db: Db, businessId: string, month: string, excludeId?: string) {
  const row = await one<{ count: number }>(
    db,
    `select count(*) from appointments
      where business_id = $1 and status <> 'cancelled'
        and date >= $2::date and date < ($2::date + interval '1 month')
        and ($3::uuid is null or id <> $3::uuid)`,
    [businessId, `${month}-01`, excludeId ?? null],
  );
  return row?.count ?? 0;
}

async function countClients(db: Db, businessId: string) {
  return (await one<{ count: number }>(db, "select count(*) from clients where business_id = $1", [businessId]))?.count ?? 0;
}

export async function countUsers(db: Db, businessId: string) {
  return (await one<{ count: number }>(db, "select count(*) from business_users where business_id = $1", [businessId]))
    ?.count ?? 0;
}

export async function getPlanUsage(db: Db, businessId: string): Promise<PlanUsage> {
  const plan = await planOf(db, businessId);
  const business = await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]);
  const month = getZonedNow(business?.timezone ?? DEFAULT_TIMEZONE).date.slice(0, 7);
  return {
    plan: plan.id,
    limits: plan.limits,
    appointmentsThisMonth: await activeAppointmentsInMonth(db, businessId, month),
    clients: await countClients(db, businessId),
    users: await countUsers(db, businessId),
  };
}

/** Citas mensuales: se cuentan las no canceladas del mes de la cita. */
export async function assertAppointmentLimit(db: Db, businessId: string, date: ISODate, excludeId?: string) {
  const { limits } = await planOf(db, businessId);
  if (limits.appointmentsPerMonth === null) return;
  if ((await activeAppointmentsInMonth(db, businessId, date.slice(0, 7), excludeId)) >= limits.appointmentsPerMonth) {
    throw new AppError("plan_limit", "Has alcanzado el límite de citas de tu plan.");
  }
}

export async function assertClientLimit(db: Db, businessId: string) {
  const { limits } = await planOf(db, businessId);
  if (limits.clients !== null && (await countClients(db, businessId)) >= limits.clients) {
    throw new AppError("plan_limit", "Has alcanzado el límite de clientes de tu plan.");
  }
}

export async function assertUserLimit(db: Db, businessId: string) {
  const { limits } = await planOf(db, businessId);
  if (limits.users !== null && (await countUsers(db, businessId)) >= limits.users) {
    throw new AppError("plan_limit", "Has alcanzado el límite de usuarios de tu plan.");
  }
}
