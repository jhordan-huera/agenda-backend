import { one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getEffectiveLimits, getPlan, type Plan } from "../shared/lib/constants/plans.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import type { BusinessRole, ISODate, PlanId, PlanLimits, PlanUsage } from "../shared/types/index.ts";

/**
 * Límites de cada plan. Se comprueban dentro de la transacción que bloquea la fila del
 * negocio (ver `authorize` con `lock`), así que dos altas simultáneas no superan el cupo.
 */

export async function planOf(db: Db, businessId: string): Promise<Plan> {
  const row = await one<{ plan: PlanId }>(db, "select plan from subscriptions where business_id = $1", [businessId]);
  return getPlan(row?.plan ?? "free");
}

/** Límites del negocio: los de su plan con las agendas que contrató (Business). */
export async function limitsOf(db: Db, businessId: string): Promise<PlanLimits> {
  const row = await one<{ plan: PlanId; maxProfessionals: number | null }>(
    db,
    `select plan, max_professionals as "maxProfessionals" from subscriptions where business_id = $1`,
    [businessId],
  );
  return getEffectiveLimits(getPlan(row?.plan ?? "free"), row?.maxProfessionals ?? null);
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

/**
 * Clientes que cuentan para el plan. No cuentan los que creó la página de reservas y nunca tuvieron
 * una cita sin cancelar: una ráfaga de reservas falsas (que el negocio cancela) no le gasta el cupo.
 */
async function countClients(db: Db, businessId: string) {
  return (
    await one<{ count: number }>(
      db,
      `select count(*) from clients c
        where c.business_id = $1
          and (c.source <> 'booking_page'
               or exists (select 1 from appointments a where a.client_id = c.id and a.status <> 'cancelled'))`,
      [businessId],
    )
  )?.count ?? 0;
}

export async function countUsers(db: Db, businessId: string) {
  return (await one<{ count: number }>(db, "select count(*) from business_users where business_id = $1", [businessId]))
    ?.count ?? 0;
}

/** Agendas en uso: profesionales activos (sin contar uno que se está editando). */
export async function countActiveProfessionals(db: Db, businessId: string, excludeId?: string) {
  return (
    await one<{ count: number }>(
      db,
      "select count(*) from professionals where business_id = $1 and is_active and ($2::uuid is null or id <> $2::uuid)",
      [businessId, excludeId ?? null],
    )
  )?.count ?? 0;
}

export async function getPlanUsage(db: Db, businessId: string): Promise<PlanUsage> {
  const plan = await planOf(db, businessId);
  const business = await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]);
  const month = getZonedNow(business?.timezone ?? DEFAULT_TIMEZONE).date.slice(0, 7);
  return {
    plan: plan.id,
    limits: await limitsOf(db, businessId),
    appointmentsThisMonth: await activeAppointmentsInMonth(db, businessId, month),
    clients: await countClients(db, businessId),
    users: await countUsers(db, businessId),
    professionals: await countActiveProfessionals(db, businessId),
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

/** Agendas: se comprueba al crear un profesional activo o al reactivarlo. */
export async function assertProfessionalLimit(db: Db, businessId: string, excludeId?: string) {
  const { professionals } = await limitsOf(db, businessId);
  if (professionals !== null && (await countActiveProfessionals(db, businessId, excludeId)) >= professionals) {
    throw new AppError(
      "plan_limit",
      professionals === 1
        ? "Tu plan incluye una sola agenda. Para sumar profesionales, escríbenos."
        : `Tu plan incluye ${professionals} agendas y ya están en uso. Para sumar profesionales, escríbenos.`,
    );
  }
}

/**
 * Varios profesionales sólo en los planes con varias agendas (Business). Free y Pro son cuentas
 * individuales: su única agenda se crea con el negocio (sí se puede volver a crear si no queda ninguna).
 */
export async function assertMultipleAgendas(db: Db, businessId: string) {
  if ((await planOf(db, businessId)).multipleAgendas) return;
  if (await one(db, "select 1 from professionals where business_id = $1", [businessId])) {
    throw new AppError(
      "plan_limit",
      "Tu cuenta es individual: tiene una sola agenda. Para sumar profesionales, escríbenos.",
    );
  }
}

/** El rol Profesional (ve sólo su agenda) existe sólo con varias agendas. */
export async function assertRoleAllowed(db: Db, businessId: string, role: BusinessRole) {
  if (role === "professional" && !(await planOf(db, businessId)).multipleAgendas) {
    throw new AppError("plan_limit", "El rol Profesional es para negocios con varias agendas. Elige Administrador o Recepción.");
  }
}

export async function assertUserLimit(db: Db, businessId: string) {
  const { limits } = await planOf(db, businessId);
  if (limits.users !== null && (await countUsers(db, businessId)) >= limits.users) {
    throw new AppError("plan_limit", "Has alcanzado el límite de usuarios de tu plan.");
  }
}
