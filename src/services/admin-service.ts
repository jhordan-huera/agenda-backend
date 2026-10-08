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
import { PLANS, getEffectiveLimits, getPlan } from "../shared/lib/constants/plans.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { formatSupportContact, getFullName, plural } from "../shared/lib/format.ts";
import { ROLE_LABELS } from "../shared/lib/permissions.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import {
  adminBusinessSchema,
  adminMemberSchema,
  businessDeletionSchema,
  businessOwnerSchema,
  businessStatusSchema,
  isSameBusinessName,
  planIdSchema,
  planRejectionSchema,
  platformAdminSchema,
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
  AuditLogPage,
  Business,
  BusinessRole,
  BusinessStatus,
  EmailNotification,
  PlanChangeRequest,
  PlanId,
  PlatformAdmin,
  PlatformSettings,
  PlatformStats,
  Subscription,
  TeamMember,
  User,
} from "../shared/types/index.ts";
import { createUserAccount, hashPassword, isEmailRegistered } from "./accounts.ts";
import { ADMIN_AUDIT_QUERY, parseAuditFilters, queryAuditLogs } from "./activity-service.ts";
import { findTeamMember, listTeamMembers } from "./account-service.ts";
import { logAudit } from "./audit.ts";
import { insertBusiness, isSlugTaken } from "./business-factory.ts";
import { authorizeSuperAdmin, parseInput, requireUser, type RequestContext } from "./context.ts";
import { fileStorage } from "./file-storage.ts";
import { releaseImages } from "./image-service.ts";
import { receiptPaths, removeReceiptFiles } from "./payment-service.ts";
import { appOrigin, PASSWORD_MASK, queueEmail } from "./notifications.ts";
import { getPlatformSettings } from "./platform-settings.ts";
import { assertRoleAllowed, assertUserLimit } from "./plan-limits.ts";
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
  const rows = await many<
    Business & { appointmentsThisMonth: number; clients: number; users: number; professionals: number; lastActivityAt: string | null }
  >(
    db,
    `select ${businessColumns("b")},
            (select count(*) from appointments a
              where a.business_id = b.id and a.status <> 'cancelled'
                and a.date >= date_trunc('month', now() at time zone b.timezone)::date
                and a.date < (date_trunc('month', now() at time zone b.timezone) + interval '1 month')::date
            ) as "appointmentsThisMonth",
            (select count(*) from clients c where c.business_id = b.id) as clients,
            (select count(*) from business_users bu where bu.business_id = b.id) as users,
            (select count(*) from professionals p where p.business_id = b.id and p.is_active) as professionals,
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

  return rows.map(({ appointmentsThisMonth, clients, users, professionals, lastActivityAt, ...business }) => {
    const owner = owners.find((user) => user.id === business.ownerId);
    const subscription = subscriptions.find((s) => s.businessId === business.id) ?? null;
    const plan = getPlan(subscription?.plan ?? "free");
    return {
      business,
      owner: owner ? { id: owner.id, name: getFullName(owner), email: owner.email } : null,
      subscription,
      usage: {
        plan: plan.id,
        limits: getEffectiveLimits(plan, subscription?.maxProfessionals ?? null),
        appointmentsThisMonth,
        clients,
        users,
        professionals,
      },
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

/**
 * Cuentas de super admin: sólo el principal desactiva o cambia la contraseña de los demás; nadie
 * toca la del principal ni la suya propia desde aquí (la propia se cambia en su configuración).
 */
function assertCanManageAccount(ctx: RequestContext, target: User, action: string): void {
  if (!target.platformRole) return;
  const me = requireUser(ctx);
  if (target.id === me.id) {
    throw new AppError("forbidden", "Tu propia cuenta se gestiona desde tu configuración.");
  }
  if (target.platformOwner) throw new AppError("forbidden", "No se puede " + action + " el super admin principal.");
  if (!me.platformOwner) {
    throw new AppError("forbidden", "Sólo el super admin principal puede " + action + " otro super admin.");
  }
}

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
    for (const business of businesses) businessesByPlan[getPlan(business.plan ?? "free").id]++;
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
        `select ${auditLogColumns()} from audit_logs
          where business_id = $1 and entity_type <> 'session'
          order by created_at desc, id desc
          limit 15`,
        [businessId],
      ),
    };
  },

  /**
   * Crea el negocio con sus datos, servicios, horario y plan, todavía sin propietario: su cuenta se
   * agrega después (assignBusinessOwner). Su página de reservas funciona desde el primer día.
   */
  async createBusiness(ctx: RequestContext, input: unknown) {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(adminBusinessSchema, input);
    return transaction(async (db) => {
      if (await isSlugTaken(db, data.slug)) {
        throw new AppError("conflict", "Ese enlace de reservas ya está en uso. Prueba con otro.");
      }
      const business = await insertBusiness(db, {
        owner: null,
        profile: {
          name: data.name,
          category: data.category,
          timezone: data.timezone,
          phone: data.phone,
          email: data.email,
          address: data.address,
          description: data.description,
        },
        slug: data.slug,
        plan: data.plan,
        schedules: data.schedules,
        services: data.services.map((service) => ({
          ...service,
          description: "",
          showPrice: true,
          modes: ["business"],
          homeVisitFee: 0,
          clinicalTemplateId: null,
          isActive: true,
        })),
      });
      await logAudit(db, {
        businessId: business.id,
        actor,
        action: "platform.business_created",
        entityType: "business",
        entityId: business.id,
        summary: `Creó el negocio ${business.name} con el plan ${getPlan(data.plan).name} y ${plural(
          data.services.length,
          "servicio",
          "servicios",
        )}`,
      });
      return { business };
    });
  },

  /**
   * Propietario de un negocio creado sin él: cuenta nueva (o una existente sin negocio) con la
   * contraseña que elige el super admin; se le envía por email junto con su página de reservas.
   * Si el negocio tiene una sola agenda sin usuario (la del alta), pasa a ser la suya.
   */
  async assignBusinessOwner(ctx: RequestContext, businessId: string, input: unknown): Promise<TeamMember> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(businessOwnerSchema, input);
    return transaction(async (db) => {
      const business = await findBusiness(db, businessId, true);
      if (business.ownerId) throw new AppError("conflict", "Este negocio ya tiene propietario.");
      const existing = await one<User>(db, `select ${userColumns()} from users where email = $1 for update`, [data.email]);
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
      await assertUserLimit(db, businessId);
      if (existing) {
        // También a una cuenta existente se le pone la contraseña elegida (el super admin la conoce)
        // y se cierran sus sesiones abiertas, como al cambiarla desde Usuarios.
        await db.query("update users set password_hash = $2 where id = $1", [existing.id, await hashPassword(data.password)]);
        await db.query("delete from sessions where user_id = $1", [existing.id]);
      }
      const owner = existing ?? (await createUserAccount(db, data));

      await db.query("insert into business_users (business_id, user_id, role, clinical_access) values ($1, $2, 'owner', true)", [
        businessId,
        owner.id,
      ]);
      // Sin email del negocio, los avisos de reservas le llegan al propietario.
      await db.query("update businesses set owner_id = $2, email = case when email = '' then $3 else email end where id = $1", [
        businessId,
        owner.id,
        owner.email,
      ]);
      const agendas = await many<{ id: string; userId: string | null }>(
        db,
        `select id, user_id as "userId" from professionals where business_id = $1`,
        [businessId],
      );
      if (agendas.length === 1 && !agendas[0].userId) {
        await db.query(
          `update professionals
              set user_id = $2,
                  display_name = case when display_name = $3 then $4 else display_name end,
                  avatar_url = coalesce(avatar_url, $5)
            where id = $1`,
          [agendas[0].id, owner.id, business.name, getFullName(owner), owner.avatarUrl],
        );
      }

      await queueEmail(db, {
        businessId,
        type: "business_created",
        to: owner.email,
        secret: data.password,
        ...emailTemplates.businessCreated({
          firstName: owner.firstName,
          businessName: business.name,
          email: owner.email,
          password: PASSWORD_MASK,
          loginUrl: `${appOrigin()}/login`,
          bookingUrl: `${appOrigin()}/book/${business.slug}`,
        }),
      });
      await logAudit(db, {
        businessId,
        actor,
        action: "platform.owner_assigned",
        entityType: "team",
        entityId: owner.id,
        summary: `Agregó a ${getFullName(owner)} como propietario${existing ? " (cuenta que ya existía)" : ""}`,
      });
      return (await findTeamMember(db, businessId, owner.id))!;
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
        const supportContact = formatSupportContact(await getPlatformSettings(db));
        await queueEmail(db, {
          businessId,
          type: suspended ? "business_suspended" : "business_reactivated",
          to: owner.email,
          ...(suspended
            ? emailTemplates.businessSuspended(owner.firstName, business.name, supportContact)
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
    const { files, receipts, images } = await transaction(async (db) => {
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
      const receipts = await receiptPaths(db, { businessId });
      const images = await many<{ url: string | null }>(
        db,
        "select logo_url as url from businesses where id = $1 union select avatar_url from professionals where business_id = $1",
        [businessId],
      );

      // Antes que el negocio, lo que frenaría la cascada: la historia clínica (sus triggers impiden
      // modificarla, y borrar una cita le pondría appointment_id a null) y las citas (sus
      // servicios y profesionales no se pueden borrar mientras existan).
      for (const table of ["clinical_notes", "clinical_attachments", "clinical_profiles", "appointments"]) {
        await db.query(`delete from ${table} where business_id = $1`, [businessId]);
      }
      await db.query("delete from businesses where id = $1", [businessId]); // El resto cae en cascada.
      const accounts = await many<{ id: string; avatarUrl: string | null }>(
        db,
        `delete from users u
          where u.id = any($1::uuid[]) and u.platform_role is null
            and not exists (select 1 from business_users bu where bu.user_id = u.id)
            and not exists (select 1 from businesses b where b.owner_id = u.id)
          returning u.id, u.avatar_url as "avatarUrl"`,
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
      return { files, receipts, images: [...images.map((image) => image.url), ...accounts.map((account) => account.avatarUrl)] };
    });

    // Los archivos, una vez confirmado el borrado. Si falla, quedan sin ningún registro que los enlace.
    if (files.length && fileStorage) {
      await fileStorage
        .remove(files.map((file) => file.storagePath))
        .catch((error: unknown) => console.error("No se pudieron borrar los archivos del negocio eliminado:", error));
    }
    await removeReceiptFiles(receipts);
    await releaseImages(images);
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
            `${appOrigin()}/dashboard`,
          ),
        });
      }
      return subscription;
    });
  },

  /**
   * Agendas contratadas por un negocio Business (se cobran por profesional): cuántos profesionales puede
   * tener activos. null: sin tope. No desactiva a nadie: si ya hay más activos, no deja sumar ni reactivar.
   */
  async setMaxProfessionals(ctx: RequestContext, businessId: string, value: unknown): Promise<Subscription> {
    const actor = authorizeSuperAdmin(ctx);
    const max = parseInput(
      z.number({ error: "Indica cuántas agendas contrató" }).int().min(1, "Mínimo una agenda").max(200).nullable(),
      value,
    );
    return transaction(async (db) => {
      const business = await findBusiness(db, businessId, true);
      const before = await one<Subscription>(db, `select ${subscriptionColumns()} from subscriptions where business_id = $1`, [businessId]);
      if (!before) throw new AppError("not_found", "Suscripción no encontrada.");
      const subscription = (await one<Subscription>(
        db,
        `update subscriptions set max_professionals = $2 where business_id = $1 returning ${subscriptionColumns()}`,
        [businessId, max],
      ))!;
      const label = (value: number | null) => (value === null ? "Sin tope" : String(value));
      await logAudit(db, {
        businessId,
        actor,
        action: "platform.max_professionals_changed",
        entityType: "subscription",
        entityId: subscription.id,
        summary: `Cambió las agendas contratadas de ${business.name} a ${label(max)}`,
        changes: [{ label: "Agendas contratadas", before: label(before.maxProfessionals), after: label(max) }],
      });
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
            `${appOrigin()}/dashboard`,
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
        const supportContact = formatSupportContact(await getPlatformSettings(db));
        await queueEmail(db, {
          businessId: request.businessId,
          type: "plan_change_rejected",
          to: owner.email,
          ...emailTemplates.planChangeRejected(owner.firstName, owner.businessName, planName, reason, supportContact),
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
      assertCanManageAccount(ctx, current, "desactivar");
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
      assertCanManageAccount(ctx, user, "cambiar la contraseña de");
      await db.query("update users set password_hash = $2 where id = $1", [userId, await hashPassword(password)]);
      await db.query("delete from sessions where user_id = $1", [userId]);
      await queueEmail(db, {
        businessId: null,
        type: "password_reset",
        to: user.email,
        secret: password,
        ...emailTemplates.passwordChanged(user.firstName, user.email, PASSWORD_MASK, `${appOrigin()}/login`),
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

  /** El equipo de la plataforma: los super admins, con su verificación en dos pasos y su último acceso. */
  async listPlatformAdmins(ctx: RequestContext): Promise<PlatformAdmin[]> {
    authorizeSuperAdmin(ctx);
    const rows = await many<User & { twoFactorEnabled: boolean; lastSignInAt: string | null }>(
      pool,
      `select ${userColumns("u")}, u.two_factor_enabled_at is not null as "twoFactorEnabled",
              (select max(a.created_at) from audit_logs a
                where a.entity_type = 'session' and a.action = 'session.login' and a.actor_id = u.id) as "lastSignInAt"
         from users u
        where u.platform_role = 'super_admin'
        order by u.platform_owner desc, u.created_at`,
    );
    return rows.map(({ twoFactorEnabled, lastSignInAt, ...user }) => ({ user, twoFactorEnabled, lastSignInAt }));
  },

  /**
   * Agrega otro super admin para ayudar con el soporte (sólo el principal). Tiene los mismos
   * permisos de plataforma salvo gestionar a otros super admins; sus acciones quedan con su nombre.
   */
  async addPlatformAdmin(ctx: RequestContext, input: unknown): Promise<PlatformAdmin> {
    const actor = authorizeSuperAdmin(ctx);
    if (!requireUser(ctx).platformOwner) {
      throw new AppError("forbidden", "Sólo el super admin principal puede agregar a otros super admins.");
    }
    const data = parseInput(platformAdminSchema, input);
    return transaction(async (db) => {
      if (await isEmailRegistered(db, data.email)) throw new AppError("conflict", "Ya existe una cuenta con ese email.");
      const created = await createUserAccount(db, data);
      const user = (await one<User>(
        db,
        `update users set platform_role = 'super_admin' where id = $1 returning ${userColumns()}`,
        [created.id],
      ))!;
      await queueEmail(db, {
        businessId: null,
        type: "platform_admin_added",
        to: user.email,
        secret: data.password,
        ...emailTemplates.platformAdminAdded({
          firstName: user.firstName,
          addedBy: getFullName(requireUser(ctx)),
          email: user.email,
          password: PASSWORD_MASK,
          loginUrl: `${appOrigin()}/login`,
        }),
      });
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.admin_added",
        entityType: "user",
        entityId: user.id,
        summary: `Agregó a ${getFullName(user)} (${user.email}) como super admin`,
      });
      return { user, twoFactorEnabled: false, lastSignInAt: null };
    });
  },

  /** Crea un miembro del equipo de un negocio con la contraseña que elige el super admin. */
  async addBusinessMember(ctx: RequestContext, businessId: string, input: unknown): Promise<TeamMember> {
    const actor = authorizeSuperAdmin(ctx);
    const data = parseInput(adminMemberSchema, input);
    return transaction(async (db) => {
      const business = await findBusiness(db, businessId, true);
      if (await isEmailRegistered(db, data.email)) throw new AppError("conflict", "Ya existe una cuenta con ese email.");
      await assertRoleAllowed(db, businessId, data.role);
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
        secret: data.password,
        ...emailTemplates.teamInvite({
          firstName: user.firstName,
          businessName: business.name,
          roleLabel: ROLE_LABELS[data.role],
          email: user.email,
          password: PASSWORD_MASK,
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

  /**
   * Auditoría de toda la plataforma. `scope`: "admin" (acciones del super admin), "security"
   * (inicios de sesión, intentos fallidos y cierres, con IP y navegador) o "all".
   */
  async listAuditLogs(ctx: RequestContext, query: Record<string, unknown>): Promise<AuditLogPage<AdminAuditLog>> {
    authorizeSuperAdmin(ctx);
    const { scope = "all", businessId, ...rest } = query;
    const where: string[] = [];
    const values: unknown[] = [];
    const selected = parseInput(z.enum(["admin", "security", "all"]), scope);
    if (selected === "admin") where.push("l.action like 'platform.%'");
    if (selected === "security") where.push("l.entity_type = 'session'");
    if (typeof businessId === "string" && businessId) {
      if (!isUuid(businessId)) throw new AppError("validation", "Negocio no válido.");
      values.push(businessId);
      where.push(`l.business_id = $${values.length}`);
    }
    return queryAuditLogs<AdminAuditLog>(pool, { ...ADMIN_AUDIT_QUERY, where, values }, parseAuditFilters(rest));
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
        data.supportPhone !== previous.supportPhone &&
          (data.supportPhone ? `Cambió el teléfono de soporte a ${data.supportPhone}` : "Quitó el teléfono de soporte"),
      ].filter((change) => change !== false);
      await db.query("update platform_settings set allow_public_signup = $1, support_email = $2, support_phone = $3", [
        data.allowPublicSignup,
        data.supportEmail,
        data.supportPhone,
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
