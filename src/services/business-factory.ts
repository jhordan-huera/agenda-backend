import { businessColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import { DEFAULT_CURRENCY } from "../shared/lib/constants/app.ts";
import { DEFAULT_BOOKING_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from "../shared/lib/constants/business.ts";
import { getFullName, slugify } from "../shared/lib/format.ts";
import type { OnboardingInput } from "../shared/lib/validations/business.ts";
import type { ScheduleDayInput } from "../shared/lib/validations/schedule.ts";
import type { ServiceInput } from "../shared/lib/validations/service.ts";
import type { Business, PlanId, User } from "../shared/types/index.ts";
import { requireAssignableCategory } from "./category-service.ts";
import { periodEndFor } from "./subscriptions.ts";

export async function isSlugTaken(db: Db, slug: string, excludeBusinessId?: string): Promise<boolean> {
  return Boolean(
    await one(db, "select 1 from businesses where slug = $1 and ($2::uuid is null or id <> $2::uuid)", [
      slug,
      excludeBusinessId ?? null,
    ]),
  );
}

export async function uniqueSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || "mi-negocio";
  let slug = root;
  for (let suffix = 2; await isSlugTaken(db, slug); suffix++) slug = `${root}-${suffix}`;
  return slug;
}

/**
 * Alta completa de un negocio (dentro de la transacción de quien llama): negocio,
 * membresía owner, profesional, suscripción, horario semanal y servicios.
 * La usan el onboarding (el propio dueño) y el panel del super admin, que lo crea sin
 * propietario (owner null): la agenda lleva entonces el nombre del negocio.
 */
export async function insertBusiness(
  db: Db,
  params: {
    owner: User | null;
    profile: OnboardingInput;
    slug: string;
    plan: PlanId;
    schedules: ScheduleDayInput[];
    services: ServiceInput[];
  },
): Promise<Business> {
  const { owner, profile } = params;
  const category = await requireAssignableCategory(db, profile.category);
  const business = (await one<Business>(
    db,
    `insert into businesses
       (owner_id, name, slug, description, category, timezone, currency, phone, email, address,
        booking_settings, notification_settings, clinical_records_enabled)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning ${businessColumns()}`,
    [
      owner?.id ?? null,
      profile.name,
      params.slug,
      profile.description,
      profile.category,
      profile.timezone,
      DEFAULT_CURRENCY,
      profile.phone || owner?.phone || "",
      profile.email || owner?.email || "",
      profile.address,
      DEFAULT_BOOKING_SETTINGS,
      DEFAULT_NOTIFICATION_SETTINGS,
      // Historia clínica activada por defecto en negocios de salud.
      category.isHealth,
    ],
  ))!;

  if (owner) {
    await db.query("insert into business_users (business_id, user_id, role, clinical_access) values ($1, $2, 'owner', true)", [
      business.id,
      owner.id,
    ]);
  }
  // La agenda del dueño. Sin email de avisos: las reservas ya le llegan al email del negocio.
  const professional = (await one<{ id: string }>(
    db,
    "insert into professionals (business_id, user_id, display_name, avatar_url) values ($1, $2, $3, $4) returning id",
    [business.id, owner?.id ?? null, owner ? getFullName(owner) : profile.name, owner?.avatarUrl ?? null],
  ))!;
  await db.query(
    "insert into subscriptions (business_id, plan, status, current_period_end) values ($1, $2, 'active', $3)",
    [business.id, params.plan, periodEndFor(params.plan)],
  );
  for (const day of params.schedules) {
    await db.query(
      "insert into schedules (business_id, professional_id, day_of_week, is_active, intervals) values ($1, $2, $3, $4, $5)",
      [business.id, professional.id, day.dayOfWeek, day.isActive, JSON.stringify(day.intervals)],
    );
  }
  for (const service of params.services) {
    await db.query(
      `insert into services
         (business_id, name, description, duration_minutes, price, show_price, modes, home_visit_fee, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        business.id,
        service.name,
        service.description,
        service.durationMinutes,
        service.price,
        // Precio 0 en el alta: aún sin precio (no "Gratis"), hasta que el negocio lo elija.
        service.showPrice && service.price > 0,
        service.modes,
        service.homeVisitFee,
        service.isActive,
      ],
    );
  }
  return business;
}
