import { z } from "zod";
import {
  auditLogColumns,
  businessColumns,
  notificationColumns,
  planRequestColumns,
  subscriptionColumns,
  userColumns,
} from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { DEFAULT_WEEKLY_SCHEDULE } from "../shared/lib/constants/business.ts";
import { PLANS, getPlan } from "../shared/lib/constants/plans.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { getFullName, plural } from "../shared/lib/format.ts";
import { ROLE_LABELS } from "../shared/lib/permissions.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import {
  adminBusinessSchema,
  adminMemberSchema,
  businessDeletionSchema,
  businessStatusSchema,
  isSameBusinessName,
  planIdSchema,
  planRejectionSchema,
  platformSettingsSchema,
  userPasswordSchema,
} from "../shared/lib/validations/admin.ts";
import type {
  AdminAuditLog,
  AdminBusinessDetail,
  AdminBusinessSummary,
  AdminPlanRequest,
  AdminUserSummary,
  AuditLog,
  Business,
  BusinessRole,
  BusinessStatus,
  EmailNotification,
  PlanChangeRequest,
  PlanId,
  PlatformSettings,
  PlatformStats,
  Subscription,
  TeamMember,
  User,
} from "../shared/types/index.ts";
import { createUserAccount, hashPassword, isEmailRegistered } from "./accounts.ts";
import { findTeamMember, listTeamMembers } from "./account-service.ts";
import { logAudit } from "./audit.ts";
import { insertBusiness, isSlugTaken } from "./business-factory.ts";
import { requireAssignableCategory } from "./category-service.ts";
import { authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";
import { fileStorage } from "./file-storage.ts";
import { appOrigin, queueEmail } from "./notifications.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import { assertUserLimit } from "./plan-limits.ts";
import { applyPlanChange } from "./subscriptions.ts";

/**
 * Panel del super admin. Cada operación empieza con authorizeSuperAdmin: aunque
 * alguien llegue a /admin desde el navegador, la API rechaza a quien no lo sea.
 */

/** Los últimos `count` meses terminando en `current` ("YYYY-MM"). */
function lastMonths(current: string, count: number): string[] {
  const [year, month] = current.split("-").map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7),
  );
}

async function findBusiness(db: Db, businessId: string, lock = false): Promise<Business> {
  const business = isUuid(businessId)
    ? await one<Business>(
        db,
        `select ${businessColumns()} from businesses where id = $1 ${lock ? "for no key update" : ""}`,
        [businessId],
      )
    : null;
  if (!business) throw new AppError("not_found", "Negocio no encontrado.");
  return business;
}

async function findUser(db: Db, userId: string, lock = false): Promise<User> {
  const user = isUuid(userId)
    ? await one<User>(db, `select ${userColumns()} from users where id = $1 ${lock ? "for update" : ""}`, [userId])
    : null;
  if (!user) throw new AppError("not_found", "Usuario no encontrado.");
  return user;
}

/**
 * Resumen de negocios (con propietario, suscripción, uso del plan y última actividad).
 * El mes en curso se calcula en la zona horaria de cada negocio.
 */
async function summarizeBusinesses(db: Db, businessId?: string): Promise<AdminBusinessSummary[]> {
  const rows = await many<Business & { appointmentsThisMonth: number; clients: number; users: number; lastActivityAt: string | null }>(
    db,
    `select ${businessColumns("b")},
            (select count(*) from appointments a
              where a.business_id = b.id and a.status <> 'cancelled'
                and a.date >= date_trunc('month', now() at time zone b.timezone)::date
                and a.date < (date_trunc('month', now() at time zone b.timezone) + interval '1 month')::date
            ) as "appointmentsThisMonth",
            (select count(*) from clients c where c.business_id = b.id) as clients,
            (select count(*) from business_users bu where bu.business_id = b.id) as users,
            (select max(l.created_at) from audit_logs l where l.business_id = b.id) as "lastActivityAt"
       from businesses b
      where ($1::uuid is null or b.id = $1::uuid)
      order by b.created_at desc`,
    [businessId ?? null],
  );
  const ids = rows.map((row) => row.id);
  const owners = await many<User>(db, `select ${userColumns()} from users where id = any($1::uuid[])`, [
    rows.map((row) => row.ownerId),
  ]);
  const subscriptions = await many<Subscription>(
    db,
    `select ${subscriptionColumns()} from subscriptions where business_id = any($1::uuid[])`,
    [ids],
  );

  return rows.map(({ appointmentsThisMonth, clients, users, lastActivityAt, ...business }) => {
    const owner = owners.find((user) => user.id === business.ownerId);
    const subscription = subscriptions.find((s) => s.businessId === business.id) ?? null;
    const plan = getPlan(subscription?.plan ?? "free");
    return {
      business,
      owner: owner ? { id: owner.id, name: getFullName(owner), email: owner.email } : null,
      subscription,
      usage: { plan: plan.id, limits: plan.limits, appointmentsThisMonth, clients, users },
      lastActivityAt,
    };
  });
}

async function findPendingRequest(db: Db, requestId: string): Promise<PlanChangeRequest> {
  const request = isUuid(requestId)
    ? await one<PlanChangeRequest>(
        db,
        `select ${planRequestColumns()} from plan_change_requests where id = $1 for update`,
        [requestId],
      )
    : null;
  if (!request) throw new AppError("not_found", "Solicitud no encontrada.");
  if (request.status !== "pending") throw new AppError("conflict", "Esta solicitud ya fue resuelta.");
  return request;
}

async function findOwner(db: Db, businessId: string) {
  return one<{ email: string; firstName: string; businessName: string }>(
    db,
    `select u.email, u.first_name as "firstName", b.name as "businessName"
       from businesses b join users u on u.id = b.owner_id
      where b.id = $1`,
    [businessId],
  );
}

/** Configuración pública: la página de registro necesita saber si está abierto. */
export const platformService = {
  getSettings: (): Promise<PlatformSettings> => getPlatformSettings(pool),
};

export const adminService = {
  async getStats(ctx: RequestContext): Promise<PlatformStats> {
    authorizeSuperAdmin(ctx);
    const month = getZonedNow(DEFAULT_TIMEZONE).date.slice(0, 7);
    const businesses = await many<{
      status: BusinessStatus;
      createdAt: string;
      plan: PlanId | null;
      subscriptionStatus: string | null;
    }>(
      pool,
      `select b.status, b.created_at as "createdAt", s.plan, s.status as "subscriptionStatus"
         from businesses b left join subscriptions s on s.business_id = b.id`,
    );
    const businessesByPlan = Object.fromEntries(PLANS.map((plan) => [plan.id, 0])) as Record<PlanId, number>;
    let monthlyRecurringRevenue = 0;
    for (const business of businesses) {
      const plan = getPlan(business.plan ?? "free");
      businessesByPlan[plan.id]++;
      if (business.status === "active" && business.subscriptionStatus === "active") monthlyRecurringRevenue += plan.price;
    }
    const active = businesses.filter((b) => b.status === "active").length;
    const counts = (await one<{ users: number; appointments: number; online: number }>(
      pool,
      `select (select count(*) from users where platform_role is null) as users,
              count(*) as appointments,
              count(*) filter (where source = 'booking_page') as online
         from appointments
        where status <> 'cancelled' and date >= $1::date and date < ($1::date + interval '1 month')`,
      [`${month}-01`],
    ))!;
    return {
      businesses: {
        total: businesses.length,
        active,
        suspended: businesses.length - active,
        newThisMonth: businesses.filter((b) => b.createdAt.startsWith(month)).length,
      },
      businessesByPlan,
      monthlyRecurringRevenue: Math.round(monthlyRecurringRevenue * 100) / 100,
      users: counts.users,
      appointmentsThisMonth: counts.appointments,
      onlineBookingsThisMonth: counts.online,
      signupsByMonth: lastMonths(month, 6).map((m) => ({
        month: m,
        count: businesses.filter((b) => b.createdAt.startsWith(m)).length,
      })),
    };
  },

  async listBusinesses(ctx: RequestContext): Promise<AdminBusinessSummary[]> {
    authorizeSuperAdmin(ctx);
    return summarizeBusinesses(pool);
  },

  async getBusiness(ctx: RequestContext, businessId: string): Promise<AdminBusinessDetail | null> {
    authorizeSuperAdmin(ctx);
    if (!isUuid(businessId)) return null;
    const [summary] = await summarizeBusinesses(pool, businessId);
    if (!summary) return null;
    return {
      ...summary,
      members: await listTeamMembers(pool, businessId),
      recentActivity: await many<AuditLog>(
        pool,
        `select ${auditLogColumns()} from audit_logs where business_id = $1 order by created_at desc limit 15`,
        [businessId],
      ),
    };
  },

  /**
   * Crea el negocio y su propietario (cuenta nueva, o una existente sin negocio) con la
   * contraseña que elige el super admin; se le envía por email junto con su página de reservas.
   */
  async createBusiness(ctx: RequestContext, input: unknown) {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(adminBusinessSchema, input);
    return transaction(async (db) => {
      if (await isSlugTaken(db, data.slug)) {
        throw new AppError("conflict", "Ese enlace de reservas ya está en uso. Prueba con otro.");
      }
      const existing = await one<User>(db, `select ${userColumns()} from users where email = $1 for update`, [
        data.ownerEmail,
      ]);
      if (existing?.platformRole) throw new AppError("conflict", "Ese email pertenece a una cuenta de super admin.");
      if (existing && (await one(db, "select 1 from business_users where user_id = $1", [existing.id]))) {
        throw new AppError("conflict", "Ese email ya pertenece a otro negocio. Usa otro email para el propietario.");
      }
      if (existing && !existing.isActive) {
        throw new AppError(
          "conflict",
          "La cuenta con ese email está desactivada. Reactívala en Usuarios antes de asignarle un negocio.",
        );
      }
      if (existing) {
        // También a una cuenta existente se le pone la contraseña elegida: el super admin la conoce.
        await db.query("update users set password_hash = $2 where id = $1", [
          existing.id,
          await hashPassword(data.ownerPassword),
        ]);
      }
      const owner =
        existing ??
        (await createUserAccount(db, {
          firstName: data.ownerFirstName,
          lastName: data.ownerLastName,
          email: data.ownerEmail,
          password: data.ownerPassword,
        }));

      // Horario y primer servicio sugeridos: el negocio puede recibir reservas desde el primer día.
      const { suggestedService: suggestion } = await requireAssignableCategory(db, data.category);
      const business = await insertBusiness(db, {
        owner,
        profile: {
          name: data.name,
          category: data.category,
          timezone: data.timezone,
          phone: data.phone,
          email: data.email,
          address: data.address,
          description: "",
        },
        slug: data.slug,
        plan: data.plan,
        schedules: structuredClone(DEFAULT_WEEKLY_SCHEDULE),
        firstService: {
          ...suggestion,
          description: "",
          showPrice: true,
          location: "business",
          homeVisitFee: 0,
          clinicalTemplateId: null,
          isActive: true,
        },
      });

      await queueEmail(db, {
        businessId: business.id,
        type: "business_created",
        to: owner.email,
        ...emailTemplates.businessCreated({
          firstName: owner.firstName,
          businessName: business.name,
          email: owner.email,
          password: data.ownerPassword,
          loginUrl: `${appOrigin()}/login`,
          bookingUrl: `${appOrigin()}/book/${business.slug}`,
        }),
      });
      await logAudit(db, {
        businessId: business.id,
        actor,
        action: "platform.business_created",
        entityType: "business",
        entityId: business.id,
        summary: `Creó el negocio ${business.name} para ${getFullName(owner)} con el plan ${getPlan(data.plan).name}`,
      });
      return { business, ownerEmail: owner.email, existingAccount: Boolean(existing) };
    });
  },

  /** Suspender bloquea el panel y la página pública del negocio; reactivar lo devuelve a la normalidad. */
  async setBusinessStatus(ctx: RequestContext, businessId: string, status: unknown): Promise<Business> {
    const actor = authorizeSuperAdmin(ctx);
    const next = parseInput(businessStatusSchema, status);
    return transaction(async (db) => {
      const current = await findBusiness(db, businessId, true);
      if (current.status === next) return current;
      const business = (await one<Business>(
        db,
        `update businesses set status = $2 where id = $1 returning ${businessColumns()}`,
        [businessId, next],
      ))!;

      const suspended = next === "suspended";
      const owner = await one<User>(db, `select ${userColumns()} from users where id = $1`, [business.ownerId]);
      if (owner) {
        const { supportEmail } = await getPlatformSettings(db);
        await queueEmail(db, {
          businessId,
          type: suspended ? "business_suspended" : "business_reactivated",
          to: owner.email,
          ...(suspended
            ? emailTemplates.businessSuspended(owner.firstName, business.name, supportEmail)
            : emailTemplates.businessReactivated(owner.firstName, business.name, `${appOrigin()}/login`)),
        });
      }
      await logAudit(db, {
        businessId,
        actor,
        action: suspended ? "platform.business_suspended" : "platform.business_reactivated",
        entityType: "business",
        entityId: businessId,
        summary: `${suspended ? "Suspendió" : "Reactivó"} el negocio ${business.name}`,
      });
      return business;
    });
  },

  /**
   * Elimina el negocio para siempre con todos sus datos (citas, clientes, historias clínicas y
   * archivos) y las cuentas de su equipo, que sólo pertenecían a él. Hay que escribir su nombre.
   */
  async deleteBusiness(ctx: RequestContext, businessId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { confirmName } = parseInput(businessDeletionSchema, input);
    const files = await transaction(async (db) => {
      const business = await findBusiness(db, businessId);
      if (!isSameBusinessName(confirmName, business.name)) {
        throw new AppError("validation", `El nombre no coincide. Escribe «${business.name}» para confirmar.`);
      }
      // Mientras se borra, nadie puede reservar ni crear nada en el negocio.
      await db.query("select 1 from businesses where id = $1 for update", [businessId]);
      const files = await many<{ storagePath: string }>(
        db,
        `select storage_path as "storagePath" from clinical_attachments where business_id = $1`,
        [businessId],
      );
      const members = await many<{ id: string }>(db, "select user_id as id from business_users where business_id = $1", [businessId]);

      // Antes que el negocio, lo que frenaría la cascada: la historia clínica (sus triggers impiden
      // modificarla, y borrar una cita le pondría appointment_id a null) y las citas (sus
      // servicios y profesionales no se pueden borrar mientras existan).
      for (const table of ["clinical_notes", "clinical_attachments", "clinical_profiles", "appointments"]) {
        await db.query(`delete from ${table} where business_id = $1`, [businessId]);
      }
      await db.query("delete from businesses where id = $1", [businessId]); // El resto cae en cascada.
      const accounts = await many<{ id: string }>(
        db,
        `delete from users u
          where u.id = any($1::uuid[]) and u.platform_role is null
            and not exists (select 1 from business_users bu where bu.user_id = u.id)
            and not exists (select 1 from businesses b where b.owner_id = u.id)
          returning u.id`,
        [members.map((member) => member.id)],
      );

      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.business_deleted",
        entityType: "business",
        entityId: businessId,
        summary: `Eliminó el negocio ${business.name} (/book/${business.slug})${
          accounts.length ? ` y ${plural(accounts.length, "cuenta", "cuentas")} de su equipo` : ""
        }`,
      });
      return files;
    });

    // Los archivos, una vez confirmado el borrado. Si falla, quedan sin ningún registro que los enlace.
    if (files.length && fileStorage) {
      await fileStorage
        .remove(files.map((file) => file.storagePath))
        .catch((error: unknown) => console.error("No se pudieron borrar los archivos del negocio eliminado:", error));
    }
  },

  /** Cambio de plan desde el panel de plataforma: se aplica y se avisa al propietario por email. */
  async changeBusinessPlan(ctx: RequestContext, businessId: string, planId: unknown): Promise<Subscription> {
    const actor = authorizeSuperAdmin(ctx);
    const plan = parseInput(planIdSchema, planId);
    return transaction(async (db) => {
      await findBusiness(db, businessId, true);
      const previous = await one<{ plan: PlanId }>(db, "select plan from subscriptions where business_id = $1", [businessId]);
      const subscription = await applyPlanChange(db, businessId, plan, actor, "platform.plan_changed");
      const owner = await findOwner(db, businessId);
      if (owner && previous?.plan !== plan) {
        await queueEmail(db, {
          businessId,
          type: "plan_changed",
          to: owner.email,
          ...emailTemplates.planChanged(
            owner.firstName,
            owner.businessName,
            getPlan(plan).name,
            `${appOrigin()}/dashboard/settings?tab=suscripcion`,
          ),
        });
      }
      return subscription;
    });
  },

  /** Solicitudes de cambio de plan: las pendientes primero y después las resueltas en los últimos 30 días. */
  async listPlanRequests(ctx: RequestContext): Promise<AdminPlanRequest[]> {
    authorizeSuperAdmin(ctx);
    return many<AdminPlanRequest>(
      pool,
      `select ${planRequestColumns("r")}, b.name as "businessName", o.email as "ownerEmail"
         from plan_change_requests r
         join businesses b on b.id = r.business_id
         left join users o on o.id = b.owner_id
        where r.status = 'pending' or r.resolved_at > now() - interval '30 days'
        order by (r.status = 'pending') desc, coalesce(r.resolved_at, r.created_at) desc
        limit 100`,
    );
  },

  /** Aplica el plan solicitado y avisa al propietario. */
  async approvePlanRequest(ctx: RequestContext, requestId: string): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    await transaction(async (db) => {
      const request = await findPendingRequest(db, requestId);
      await findBusiness(db, request.businessId, true);
      await applyPlanChange(db, request.businessId, request.requestedPlan, actor, "platform.plan_change_approved");
      await db.query(
        "update plan_change_requests set status = 'approved', resolved_at = now(), resolved_by_name = $2 where id = $1",
        [requestId, actor.name],
      );
      const owner = await findOwner(db, request.businessId);
      if (owner) {
        await queueEmail(db, {
          businessId: request.businessId,
          type: "plan_change_approved",
          to: owner.email,
          ...emailTemplates.planChangeApproved(
            owner.firstName,
            owner.businessName,
            getPlan(request.requestedPlan).name,
            `${appOrigin()}/dashboard/settings?tab=suscripcion`,
          ),
        });
      }
    });
  },

  /** Rechaza la solicitud (con un motivo opcional) y avisa al propietario. */
  async rejectPlanRequest(ctx: RequestContext, requestId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { reason } = parseInput(planRejectionSchema, input ?? {});
    await transaction(async (db) => {
      const request = await findPendingRequest(db, requestId);
      await db.query(
        `update plan_change_requests
            set status = 'rejected', resolved_at = now(), resolved_by_name = $2, rejection_reason = $3
          where id = $1`,
        [requestId, actor.name, reason],
      );
      const planName = getPlan(request.requestedPlan).name;
      const owner = await findOwner(db, request.businessId);
      if (owner) {
        const { supportEmail } = await getPlatformSettings(db);
        await queueEmail(db, {
          businessId: request.businessId,
          type: "plan_change_rejected",
          to: owner.email,
          ...emailTemplates.planChangeRejected(owner.firstName, owner.businessName, planName, reason, supportEmail),
        });
      }
      await logAudit(db, {
        businessId: request.businessId,
        actor,
        action: "platform.plan_change_rejected",
        entityType: "subscription",
        entityId: requestId,
        summary: `Rechazó la solicitud del plan ${planName}${reason ? `: ${reason}` : ""}`,
      });
    });
  },

  async listUsers(ctx: RequestContext): Promise<AdminUserSummary[]> {
    authorizeSuperAdmin(ctx);
    const users = await many<User>(pool, `select ${userColumns()} from users order by created_at desc`);
    const memberships = await many<{ userId: string; businessId: string; businessName: string; role: BusinessRole }>(
      pool,
      `select bu.user_id as "userId", bu.business_id as "businessId", b.name as "businessName", bu.role
         from business_users bu join businesses b on b.id = bu.business_id`,
    );
    return users.map((user) => ({
      user,
      memberships: memberships
        .filter((m) => m.userId === user.id)
        .map(({ businessId, businessName, role }) => ({ businessId, businessName, role })),
    }));
  },

  async setUserActive(ctx: RequestContext, userId: string, isActive: unknown): Promise<User> {
    const actor = authorizeSuperAdmin(ctx);
    const active = parseInput(z.boolean(), isActive);
    return transaction(async (db) => {
      const current = await findUser(db, userId, true);
      if (current.platformRole) throw new AppError("forbidden", "No se puede desactivar una cuenta de super admin.");
      if (current.isActive === active) return current;
      const user = (await one<User>(db, `update users set is_active = $2 where id = $1 returning ${userColumns()}`, [
        userId,
        active,
      ]))!;
      if (!active) await db.query("delete from sessions where user_id = $1", [userId]);
      await logAudit(db, {
        businessId: null,
        actor,
        action: active ? "platform.user_enabled" : "platform.user_disabled",
        entityType: "user",
        entityId: userId,
        summary: `${active ? "Reactivó" : "Desactivó"} el acceso de ${getFullName(user)} (${user.email})`,
      });
      return user;
    });
  },

  /** Pone la contraseña que elige el super admin, se la envía por email y cierra sus sesiones abiertas. */
  async setUserPassword(ctx: RequestContext, userId: string, input: unknown): Promise<void> {
    const actor = authorizeSuperAdmin(ctx);
    const { password } = parseInput(userPasswordSchema, input);
    await transaction(async (db) => {
      const user = await findUser(db, userId, true);
      if (user.platformRole) {
        throw new AppError("forbidden", "La contraseña del super admin se cambia desde su propia configuración.");
      }
      await db.query("update users set password_hash = $2 where id = $1", [userId, await hashPassword(password)]);
      await db.query("delete from sessions where user_id = $1", [userId]);
      await queueEmail(db, {
        businessId: null,
        type: "password_reset",
        to: user.email,
        ...emailTemplates.passwordChanged(user.firstName, user.email, password, `${appOrigin()}/login`),
      });
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.user_password_changed",
        entityType: "user",
        entityId: userId,
        summary: `Cambió la contraseña de ${getFullName(user)} (${user.email})`,
      });
    });
  },

  /** Crea un miembro del equipo de un negocio con la contraseña que elige el super admin. */
  async addBusinessMember(ctx: RequestContext, businessId: string, input: unknown): Promise<TeamMember> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(adminMemberSchema, input);
    return transaction(async (db) => {
      const business = await findBusiness(db, businessId, true);
      if (await isEmailRegistered(db, data.email)) throw new AppError("conflict", "Ya existe una cuenta con ese email.");
      await assertUserLimit(db, businessId);
      const user = await createUserAccount(db, data);
      await db.query("insert into business_users (business_id, user_id, role) values ($1, $2, $3)", [
        businessId,
        user.id,
        data.role,
      ]);
      await queueEmail(db, {
        businessId,
        type: "team_invite",
        to: user.email,
        ...emailTemplates.teamInvite({
          firstName: user.firstName,
          businessName: business.name,
          roleLabel: ROLE_LABELS[data.role],
          email: user.email,
          password: data.password,
          loginUrl: `${appOrigin()}/login`,
        }),
      });
      await logAudit(db, {
        businessId,
        actor,
        action: "platform.member_added",
        entityType: "team",
        entityId: user.id,
        summary: `Añadió a ${getFullName(user)} al equipo como ${ROLE_LABELS[data.role]}`,
      });
      return (await findTeamMember(db, businessId, user.id))!;
    });
  },

  async listAuditLogs(ctx: RequestContext, scope: unknown): Promise<AdminAuditLog[]> {
    authorizeSuperAdmin(ctx);
    const onlyAdmin = parseInput(z.enum(["admin", "all"]), scope) === "admin";
    return many<AdminAuditLog>(
      pool,
      `select ${auditLogColumns("l")}, b.name as "businessName"
         from audit_logs l left join businesses b on b.id = l.business_id
        where not $1 or l.action like 'platform.%'
        order by l.created_at desc
        limit 200`,
      [onlyAdmin],
    );
  },

  /** Todos los emails de la plataforma (bandeja de salida global). */
  async listEmails(ctx: RequestContext): Promise<EmailNotification[]> {
    authorizeSuperAdmin(ctx);
    return many<EmailNotification>(
      pool,
      `select ${notificationColumns()} from notifications order by created_at desc limit 200`,
    );
  },

  async updateSettings(ctx: RequestContext, input: unknown): Promise<PlatformSettings> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(platformSettingsSchema, input);
    return transaction(async (db) => {
      const previous = await getPlatformSettings(db);
      const changes = [
        data.allowPublicSignup !== previous.allowPublicSignup &&
          (data.allowPublicSignup ? "Abrió el registro público" : "Cerró el registro público"),
        data.supportEmail !== previous.supportEmail && `Cambió el email de soporte a ${data.supportEmail}`,
      ].filter((change) => change !== false);
      await db.query("update platform_settings set allow_public_signup = $1, support_email = $2", [
        data.allowPublicSignup,
        data.supportEmail,
      ]);
      if (changes.length > 0) {
        await logAudit(db, {
          businessId: null,
          actor,
          action: "platform.settings_updated",
          entityType: "platform",
          entityId: null,
          summary: changes.join(" · "),
        });
      }
      return data;
    });
  },
};
