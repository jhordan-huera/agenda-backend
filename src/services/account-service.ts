import { z } from "zod";
import {
  businessColumns,
  planRequestColumns,
  professionalColumns,
  subscriptionColumns,
  teamMemberColumns,
  userColumns,
} from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getPlan } from "../shared/lib/constants/plans.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { getFullName } from "../shared/lib/format.ts";
import { ROLE_LABELS } from "../shared/lib/permissions.ts";
import { planIdSchema } from "../shared/lib/validations/admin.ts";
import {
  bookingSettingsSchema,
  businessProfileSchema,
  notificationSettingsSchema,
  onboardingSchema,
  profileSchema,
} from "../shared/lib/validations/business.ts";
import { weeklyScheduleSchema } from "../shared/lib/validations/schedule.ts";
import { serviceSchema } from "../shared/lib/validations/service.ts";
import { teamRoleSchema } from "../shared/lib/validations/team.ts";
import type {
  Business,
  PlanChangeRequest,
  PlanId,
  PlanUsage,
  Professional,
  Subscription,
  TeamMember,
  User,
} from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { insertBusiness, isSlugTaken, uniqueSlug } from "./business-factory.ts";
import { requireAssignableCategory } from "./category-service.ts";
import { authorize, parseInput, requireUser, type RequestContext } from "./context.ts";
import { countUsers, getPlanUsage } from "./plan-limits.ts";
import { appOrigin, queueEmail } from "./notifications.ts";

const ROLE_ORDER = { owner: 0, admin: 1, staff: 2 };

export const byRoleThenName = (a: TeamMember, b: TeamMember) =>
  ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.firstName.localeCompare(b.firstName, "es");

export async function findTeamMember(db: Db, businessId: string, userId: string): Promise<TeamMember | null> {
  return one<TeamMember>(
    db,
    `select ${teamMemberColumns("bu", "u")}
       from business_users bu join users u on u.id = bu.user_id
      where bu.business_id = $1 and bu.user_id = $2`,
    [businessId, userId],
  );
}

export async function listTeamMembers(db: Db, businessId: string): Promise<TeamMember[]> {
  const members = await many<TeamMember>(
    db,
    `select ${teamMemberColumns("bu", "u")}
       from business_users bu join users u on u.id = bu.user_id
      where bu.business_id = $1`,
    [businessId],
  );
  return members.sort(byRoleThenName);
}

/* --------------------------------- Usuarios ---------------------------------- */

export const userService = {
  async getById(ctx: RequestContext, userId: string): Promise<User | null> {
    const me = requireUser(ctx);
    if (!isUuid(userId)) return null;
    // Un usuario puede leer su perfil y el de sus compañeros de negocio; el super admin, todos.
    const canRead =
      userId === me.id ||
      me.platformRole === "super_admin" ||
      Boolean(
        await one(
          pool,
          `select 1 from business_users mine
             join business_users theirs on theirs.business_id = mine.business_id
            where mine.user_id = $1 and theirs.user_id = $2`,
          [me.id, userId],
        ),
      );
    if (!canRead) return null;
    return one<User>(pool, `select ${userColumns()} from users where id = $1`, [userId]);
  },

  async update(ctx: RequestContext, userId: string, input: unknown): Promise<User> {
    const me = requireUser(ctx);
    if (me.id !== userId) throw new AppError("forbidden", "Sólo puedes editar tu propio perfil.");
    const data = parseInput(profileSchema, input);
    return transaction(async (db) => {
      if (await one(db, "select 1 from users where email = $1 and id <> $2", [data.email, userId])) {
        throw new AppError("conflict", "Ese email ya está registrado en otra cuenta.");
      }
      const user = (await one<User>(
        db,
        `update users set first_name = $2, last_name = $3, email = $4, phone = $5, avatar_url = $6
          where id = $1
          returning ${userColumns()}`,
        [userId, data.firstName, data.lastName, data.email, data.phone, data.avatarUrl],
      ))!;
      await db.query("update professionals set display_name = $2, avatar_url = $3 where user_id = $1", [
        userId,
        getFullName(user),
        user.avatarUrl,
      ]);
      return user;
    });
  },
};

/* --------------------------------- Negocios ---------------------------------- */

/** Columnas editables del perfil del negocio (camelCase → snake_case). */
const BUSINESS_PROFILE_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  category: "category",
  slug: "slug",
  timezone: "timezone",
  phone: "phone",
  email: "email",
  address: "address",
  lat: "lat",
  lng: "lng",
  logoUrl: "logo_url",
};

export const businessService = {
  async getById(ctx: RequestContext, businessId: string): Promise<Business | null> {
    await authorize(pool, ctx, businessId);
    return one<Business>(pool, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  },

  /** Onboarding: crea negocio, membresía owner, profesional, suscripción Free, horario y primer servicio. */
  async create(ctx: RequestContext, input: unknown): Promise<Business> {
    const owner = requireUser(ctx);
    if (owner.platformRole) {
      throw new AppError(
        "forbidden",
        "La cuenta de super admin no gestiona negocios. Crea el negocio desde el panel de plataforma.",
      );
    }
    const raw = (input ?? {}) as { schedules?: unknown; firstService?: unknown };
    const data = parseInput(onboardingSchema, input);
    const schedules = parseInput(weeklyScheduleSchema, raw.schedules);
    const firstService = parseInput(serviceSchema, raw.firstService);

    return transaction(async (db) => {
      // Bloquea al usuario: dos envíos seguidos del onboarding no crean dos negocios.
      await db.query("select 1 from users where id = $1 for update", [owner.id]);
      if (await one(db, "select 1 from business_users where user_id = $1", [owner.id])) {
        throw new AppError("conflict", "Tu cuenta ya pertenece a un negocio.");
      }
      const business = await insertBusiness(db, {
        owner,
        profile: data,
        slug: await uniqueSlug(db, data.name),
        plan: "free",
        schedules,
        firstService,
      });
      const actor = { userId: owner.id, name: getFullName(owner) };
      await logAudit(db, {
        businessId: business.id,
        actor,
        action: "business.created",
        entityType: "business",
        entityId: business.id,
        summary: `Creó el negocio ${business.name}`,
      });
      await logAudit(db, {
        businessId: business.id,
        actor,
        action: "subscription.created",
        entityType: "subscription",
        entityId: business.id,
        summary: "Activó el plan Free",
      });
      return business;
    });
  },

  async update(ctx: RequestContext, businessId: string, input: unknown): Promise<Business> {
    const { bookingSettings, notificationSettings, clinicalRecordsEnabled, ...profile } = (input ?? {}) as Record<
      string,
      unknown
    >;
    const profileData = Object.keys(profile).length ? parseInput(businessProfileSchema.partial(), profile) : {};
    const booking = bookingSettings ? parseInput(bookingSettingsSchema, bookingSettings) : null;
    const notifications = notificationSettings ? parseInput(notificationSettingsSchema, notificationSettings) : null;
    const clinical = clinicalRecordsEnabled === undefined ? null : parseInput(z.boolean(), clinicalRecordsEnabled);

    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "business.manage", { lock: true });
      if (profileData.category) {
        const current = await one<{ category: string }>(db, "select category from businesses where id = $1", [businessId]);
        // La categoría sólo la cambia el super admin (desde /admin o en modo soporte).
        if (profileData.category !== current?.category && requireUser(ctx).platformRole !== "super_admin") {
          throw new AppError("forbidden", "Sólo el equipo de la plataforma puede cambiar la categoría del negocio.");
        }
        await requireAssignableCategory(db, profileData.category, current?.category);
      }
      // El punto del mapa va completo (latitud y longitud) o se quita entero.
      const hasLat = profileData.lat != null;
      const hasLng = profileData.lng != null;
      if (("lat" in profileData || "lng" in profileData) && hasLat !== hasLng) {
        throw new AppError("validation", "Marca la ubicación en el mapa de nuevo.");
      }
      if (profileData.slug && (await isSlugTaken(db, profileData.slug, businessId))) {
        throw new AppError("conflict", "Ese enlace ya está en uso. Prueba con otro.");
      }

      const assignments: string[] = [];
      const values: unknown[] = [businessId];
      for (const [key, value] of Object.entries(profileData)) {
        if (value === undefined) continue;
        values.push(value);
        assignments.push(`${BUSINESS_PROFILE_COLUMNS[key]} = $${values.length}`);
      }
      if (booking) {
        values.push(booking);
        assignments.push(`booking_settings = $${values.length}`);
      }
      if (notifications) {
        values.push(notifications);
        assignments.push(`notification_settings = $${values.length}`);
      }
      if (clinical !== null) {
        values.push(clinical);
        assignments.push(`clinical_records_enabled = $${values.length}`);
      }
      const business = assignments.length
        ? await one<Business>(
            db,
            `update businesses set ${assignments.join(", ")} where id = $1 returning ${businessColumns()}`,
            values,
          )
        : await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
      if (!business) throw new AppError("not_found", "Negocio no encontrado.");

      const section = booking
        ? "la configuración de agenda"
        : notifications
          ? "las notificaciones"
          : clinical !== null
            ? `la historia clínica (${clinical ? "activada" : "desactivada"})`
            : "los datos del negocio";
      await logAudit(db, {
        businessId,
        actor,
        action: "business.updated",
        entityType: "business",
        entityId: businessId,
        summary: `Actualizó ${section}`,
      });
      return business;
    });
  },

  async isSlugAvailable(ctx: RequestContext, slug: string, excludeBusinessId?: string): Promise<boolean> {
    requireUser(ctx);
    return !(await isSlugTaken(pool, slug.trim().toLowerCase(), isUuid(excludeBusinessId) ? excludeBusinessId : undefined));
  },

  async getProfessional(ctx: RequestContext, businessId: string): Promise<Professional | null> {
    await authorize(pool, ctx, businessId);
    return one<Professional>(
      pool,
      `select ${professionalColumns()} from professionals where business_id = $1 order by display_name limit 1`,
      [businessId],
    );
  },
};

/* ---------------------------------- Equipo ----------------------------------- */

// Los miembros los crea el super admin (adminService.addBusinessMember) con la contraseña que
// elige; el propietario puede cambiar su rol o quitarlos.

export const teamService = {
  async list(ctx: RequestContext, businessId: string): Promise<TeamMember[]> {
    await authorize(pool, ctx, businessId);
    return listTeamMembers(pool, businessId);
  },

  async updateRole(ctx: RequestContext, businessId: string, userId: string, role: unknown): Promise<void> {
    const newRole = parseInput(teamRoleSchema, role);
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "team.manage", { lock: true });
      const member = isUuid(userId) ? await findTeamMember(db, businessId, userId) : null;
      if (!member) throw new AppError("not_found", "Miembro no encontrado.");
      if (member.role === "owner") throw new AppError("forbidden", "No se puede cambiar el rol del propietario.");
      await db.query("update business_users set role = $3 where business_id = $1 and user_id = $2", [
        businessId,
        userId,
        newRole,
      ]);
      await logAudit(db, {
        businessId,
        actor,
        action: "team.role_changed",
        entityType: "team",
        entityId: userId,
        summary: `Cambió el rol de ${member.firstName} ${member.lastName} a ${ROLE_LABELS[newRole]}`,
      });
    });
  },

  /** Autoriza (o retira) el acceso de un miembro a las historias clínicas. El propietario (o el super admin en modo soporte). */
  async setClinicalAccess(ctx: RequestContext, businessId: string, userId: string, access: unknown): Promise<void> {
    const allowed = parseInput(z.boolean(), access);
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "team.manage", { lock: true });
      const member = isUuid(userId) ? await findTeamMember(db, businessId, userId) : null;
      if (!member) throw new AppError("not_found", "Miembro no encontrado.");
      if (member.role === "owner") {
        throw new AppError("forbidden", "El propietario siempre tiene acceso a las historias clínicas.");
      }
      await db.query("update business_users set clinical_access = $3 where business_id = $1 and user_id = $2", [
        businessId,
        userId,
        allowed,
      ]);
      await logAudit(db, {
        businessId,
        actor,
        action: allowed ? "team.clinical_access_granted" : "team.clinical_access_revoked",
        entityType: "team",
        entityId: userId,
        summary: `${allowed ? "Autorizó" : "Retiró"} el acceso a historias clínicas de ${member.firstName} ${member.lastName}`,
      });
    });
  },

  async remove(ctx: RequestContext, businessId: string, userId: string): Promise<void> {
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "team.manage", { lock: true });
      const member = isUuid(userId) ? await findTeamMember(db, businessId, userId) : null;
      if (!member) throw new AppError("not_found", "Miembro no encontrado.");
      if (member.role === "owner") throw new AppError("forbidden", "No se puede eliminar al propietario.");
      await db.query("delete from business_users where business_id = $1 and user_id = $2", [businessId, userId]);
      // Sin negocio, la cuenta queda desactivada (el super admin puede reactivarla) y se cierran sus sesiones.
      await db.query("update users set is_active = false where id = $1", [userId]);
      await db.query("delete from sessions where user_id = $1", [userId]);
      await logAudit(db, {
        businessId,
        actor,
        action: "team.removed",
        entityType: "team",
        entityId: userId,
        summary: `Quitó a ${member.firstName} ${member.lastName} del equipo`,
      });
    });
  },
};

/* -------------------------------- Suscripción -------------------------------- */

export const subscriptionService = {
  async get(ctx: RequestContext, businessId: string): Promise<Subscription | null> {
    await authorize(pool, ctx, businessId);
    return one<Subscription>(pool, `select ${subscriptionColumns()} from subscriptions where business_id = $1`, [
      businessId,
    ]);
  },

  async getUsage(ctx: RequestContext, businessId: string): Promise<PlanUsage> {
    await authorize(pool, ctx, businessId);
    return getPlanUsage(pool, businessId);
  },

  async getPendingRequest(ctx: RequestContext, businessId: string): Promise<PlanChangeRequest | null> {
    await authorize(pool, ctx, businessId);
    return one<PlanChangeRequest>(
      pool,
      `select ${planRequestColumns()} from plan_change_requests where business_id = $1 and status = 'pending'`,
      [businessId],
    );
  },

  /**
   * El propietario pide otro plan: se avisa por email a los super admins, que lo aprueban o
   * rechazan desde su panel. El plan sólo cambia allí (adminService), nunca desde el panel del negocio.
   */
  async requestPlanChange(ctx: RequestContext, businessId: string, plan: unknown): Promise<PlanChangeRequest> {
    if (ctx.user?.platformRole === "super_admin") {
      throw new AppError("validation", "Como super admin, cambia el plan directamente.");
    }
    const requested = getPlan(parseInput(planIdSchema, plan));
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "billing.manage", { lock: true });
      const subscription = await one<{ plan: PlanId }>(db, "select plan from subscriptions where business_id = $1", [
        businessId,
      ]);
      const current = getPlan(subscription?.plan ?? "free");
      if (current.id === requested.id) throw new AppError("conflict", `Ya tienes el plan ${requested.name}.`);
      if (await one(db, "select 1 from plan_change_requests where business_id = $1 and status = 'pending'", [businessId])) {
        throw new AppError("conflict", "Ya tienes una solicitud pendiente. Cancélala para pedir otro plan.");
      }
      const users = await countUsers(db, businessId);
      if (requested.limits.users !== null && users > requested.limits.users) {
        throw new AppError(
          "conflict",
          `El plan ${requested.name} permite ${requested.limits.users} usuario(s) y tu negocio tiene ${users}. Quita miembros del equipo antes de pedirlo.`,
        );
      }
      const request = (await one<PlanChangeRequest>(
        db,
        `insert into plan_change_requests (business_id, current_plan, requested_plan, requested_by, requested_by_name)
         values ($1, $2, $3, $4, $5)
         returning ${planRequestColumns()}`,
        [businessId, current.id, requested.id, actor.userId, actor.name],
      ))!;
      const business = (await one<{ name: string }>(db, "select name from businesses where id = $1", [businessId]))!;
      const superAdmins = await many<{ email: string }>(
        db,
        "select email from users where platform_role = 'super_admin' and is_active",
      );
      for (const admin of superAdmins) {
        await queueEmail(db, {
          businessId,
          type: "plan_change_requested",
          to: admin.email,
          ...emailTemplates.planChangeRequested({
            businessName: business.name,
            requestedByName: actor.name,
            requestedByEmail: ctx.user!.email,
            currentPlanName: current.name,
            requestedPlanName: requested.name,
            reviewUrl: `${appOrigin()}/admin`,
          }),
        });
      }
      await logAudit(db, {
        businessId,
        actor,
        action: "subscription.plan_change_requested",
        entityType: "subscription",
        entityId: request.id,
        summary: `Solicitó cambiar el plan de ${current.name} a ${requested.name}`,
      });
      return request;
    });
  },

  async cancelPlanRequest(ctx: RequestContext, businessId: string): Promise<void> {
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "billing.manage", { lock: true });
      const request = await one<PlanChangeRequest>(
        db,
        `update plan_change_requests set status = 'cancelled', resolved_at = now(), resolved_by_name = $2
          where business_id = $1 and status = 'pending'
          returning ${planRequestColumns()}`,
        [businessId, actor.name],
      );
      if (!request) throw new AppError("not_found", "No hay ninguna solicitud pendiente.");
      await logAudit(db, {
        businessId,
        actor,
        action: "subscription.plan_change_cancelled",
        entityType: "subscription",
        entityId: request.id,
        summary: `Canceló la solicitud del plan ${getPlan(request.requestedPlan).name}`,
      });
    });
  },
};
