import { PROFESSIONAL_ORDER, professionalColumns, scheduleColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { BANK_ACCOUNT_TYPE_LABELS, DEFAULT_WEEKLY_SCHEDULE } from "../shared/lib/constants/business.ts";
import { getFullName } from "../shared/lib/format.ts";
import { professionalSchema, type ProfessionalInput } from "../shared/lib/validations/professional.ts";
import type { Professional, Schedule } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { diffChanges, PROFESSIONAL_FIELDS, type ProfessionalForAudit } from "./audit-changes.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";
import { assertStoredImage, imageFolder, releaseImages } from "./image-service.ts";
import { assertMultipleAgendas, assertProfessionalLimit } from "./plan-limits.ts";

/**
 * Profesionales del negocio: cada uno es una agenda con su horario, sus bloqueos y los servicios que
 * atiende. Los ven todos los miembros (el calendario los necesita); los gestionan el propietario y
 * los administradores. Cuántos pueden estar activos lo fija el plan (ver assertProfessionalLimit).
 */

export async function listProfessionals(db: Db, businessId: string, options: { activeOnly?: boolean } = {}) {
  return many<Professional>(
    db,
    `select ${professionalColumns()} from professionals
      where business_id = $1 and ($2::boolean is false or is_active)
      order by ${PROFESSIONAL_ORDER}`,
    [businessId, options.activeOnly ?? false],
  );
}

export async function findProfessional(db: Db, businessId: string, professionalId: string): Promise<Professional> {
  const professional = isUuid(professionalId)
    ? await one<Professional>(db, `select ${professionalColumns()} from professionals where id = $1 and business_id = $2`, [
        professionalId,
        businessId,
      ])
    : null;
  if (!professional) throw new AppError("not_found", "Profesional no encontrado.");
  return professional;
}

/** El usuario debe ser del equipo y no tener ya otra agenda en el negocio. */
async function assertAssignableMember(db: Db, businessId: string, userId: string | null, professionalId?: string) {
  if (!userId) return;
  const member = isUuid(userId)
    ? await one(db, "select 1 from business_users where business_id = $1 and user_id = $2", [businessId, userId])
    : null;
  if (!member) throw new AppError("validation", "Ese usuario no es parte del equipo.");
  const taken = await one<{ displayName: string }>(
    db,
    `select display_name as "displayName" from professionals
      where business_id = $1 and user_id = $2 and ($3::uuid is null or id <> $3::uuid)`,
    [businessId, userId, professionalId ?? null],
  );
  if (taken) throw new AppError("conflict", `Ese usuario ya tiene la agenda de ${taken.displayName}.`);
}

async function assertOwnServices(db: Db, businessId: string, data: ProfessionalInput) {
  if (data.allServices) return;
  const ids = data.serviceIds.filter(isUuid);
  const found = await one<{ count: number }>(
    db,
    "select count(*)::int as count from services where business_id = $1 and id = any($2::uuid[])",
    [businessId, ids],
  );
  if (ids.length !== data.serviceIds.length || found?.count !== new Set(ids).size) {
    throw new AppError("validation", "Alguno de los servicios elegidos ya no existe.");
  }
}

async function saveServices(db: Db, professionalId: string, data: ProfessionalInput) {
  await db.query("delete from professional_services where professional_id = $1", [professionalId]);
  if (data.allServices) return;
  await db.query(
    `insert into professional_services (professional_id, service_id)
     select $1, unnest($2::uuid[]) on conflict do nothing`,
    [professionalId, data.serviceIds],
  );
}

/** Siempre queda al menos una agenda activa: sin ella no se podrían crear citas. */
async function assertAnotherActive(db: Db, businessId: string, professionalId: string) {
  const others = await one<{ count: number }>(
    db,
    "select count(*)::int as count from professionals where business_id = $1 and is_active and id <> $2",
    [businessId, professionalId],
  );
  if (!others?.count) throw new AppError("conflict", "El negocio necesita al menos un profesional activo.");
}

async function professionalForAudit(db: Db, professional: Professional): Promise<ProfessionalForAudit> {
  const member = professional.userId
    ? await one<{ firstName: string; lastName: string }>(
        db,
        `select first_name as "firstName", last_name as "lastName" from users where id = $1`,
        [professional.userId],
      )
    : null;
  const services = professional.allServices
    ? "Todos"
    : (
        await many<{ name: string }>(db, "select name from services where id = any($1::uuid[]) order by name", [
          professional.serviceIds,
        ])
      )
        .map((service) => service.name)
        .join(", ") || "Ninguno";
  return {
    displayName: professional.displayName,
    title: professional.title,
    avatarUrl: professional.avatarUrl,
    color: professional.color,
    email: professional.email,
    meetingUrl: professional.meetingUrl,
    bankAccount: professional.bankAccount
      ? `${professional.bankAccount.bank} · ${BANK_ACCOUNT_TYPE_LABELS[professional.bankAccount.accountType]} · ${professional.bankAccount.number} · ${professional.bankAccount.holder}`
      : null,
    memberName: member ? getFullName(member) : null,
    servicesLabel: services,
    notifyNewAppointments: professional.notifyNewAppointments,
    dailyAgenda: professional.dailyAgenda,
    isActive: professional.isActive,
  };
}

/** El horario inicial de una agenda nueva: el del primer profesional (o el de por defecto). */
async function copyStartingSchedule(db: Db, businessId: string, professionalId: string) {
  const first = await one<{ id: string }>(
    db,
    `select id from professionals where business_id = $1 and id <> $2 order by ${PROFESSIONAL_ORDER} limit 1`,
    [businessId, professionalId],
  );
  const week = first
    ? await many<Schedule>(db, `select ${scheduleColumns()} from schedules where professional_id = $1`, [first.id])
    : DEFAULT_WEEKLY_SCHEDULE;
  for (const day of week) {
    await db.query(
      "insert into schedules (business_id, professional_id, day_of_week, is_active, intervals) values ($1, $2, $3, $4, $5)",
      [businessId, professionalId, day.dayOfWeek, day.isActive, JSON.stringify(day.intervals)],
    );
  }
}

/** La foto de una agenda: de las fotos de agendas del negocio o la del usuario que la atiende. */
const agendaImageFolders = (businessId: string, userId: string | null) => [
  imageFolder.professional(businessId),
  ...(userId ? [imageFolder.avatar(userId)] : []),
];

export const professionalService = {
  async list(ctx: RequestContext, businessId: string): Promise<Professional[]> {
    await authorize(pool, ctx, businessId);
    return listProfessionals(pool, businessId);
  },

  /** Agenda nueva con el horario del primer profesional como punto de partida. */
  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<Professional> {
    const data = parseInput(professionalSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "professionals.manage", { lock: true });
      await assertMultipleAgendas(db, businessId);
      if (data.isActive) await assertProfessionalLimit(db, businessId);
      await assertAssignableMember(db, businessId, data.userId);
      await assertOwnServices(db, businessId, data);
      assertStoredImage(data.avatarUrl, null, "La foto", agendaImageFolders(businessId, data.userId));
      const next = await one<{ order: number }>(
        db,
        `select coalesce(max(sort_order), 0) + 1 as "order" from professionals where business_id = $1`,
        [businessId],
      );
      const { id } = (await one<{ id: string }>(
        db,
        `insert into professionals
           (business_id, user_id, display_name, title, avatar_url, color, email, all_services,
            notify_new_appointments, daily_agenda, is_active, sort_order, meeting_url, bank_account)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         returning id`,
        [
          businessId,
          data.userId,
          data.displayName,
          data.title,
          data.avatarUrl,
          data.color,
          data.email,
          data.allServices,
          data.notifyNewAppointments,
          data.dailyAgenda,
          data.isActive,
          next?.order ?? 1,
          data.meetingUrl,
          data.bankAccount ? JSON.stringify(data.bankAccount) : null,
        ],
      ))!;
      await saveServices(db, id, data);
      await copyStartingSchedule(db, businessId, id);
      const professional = await findProfessional(db, businessId, id);
      await logAudit(db, {
        businessId,
        actor,
        action: "professional.created",
        entityType: "professional",
        entityId: id,
        summary: `Agregó al profesional ${professional.displayName}`,
      });
      return professional;
    });
  },

  async update(ctx: RequestContext, businessId: string, professionalId: string, input: unknown): Promise<Professional> {
    const data = parseInput(professionalSchema, input);
    const { professional, previousAvatar } = await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "professionals.manage", { lock: true });
      const before = await findProfessional(db, businessId, professionalId);
      assertStoredImage(data.avatarUrl, before.avatarUrl, "La foto", agendaImageFolders(businessId, data.userId));
      if (data.isActive && !before.isActive) await assertProfessionalLimit(db, businessId, professionalId);
      if (!data.isActive && before.isActive) await assertAnotherActive(db, businessId, professionalId);
      await assertAssignableMember(db, businessId, data.userId, professionalId);
      await assertOwnServices(db, businessId, data);
      await db.query(
        `update professionals
            set user_id = $2, display_name = $3, title = $4, avatar_url = $5, color = $6, email = $7,
                all_services = $8, notify_new_appointments = $9, daily_agenda = $10, is_active = $11,
                meeting_url = $12, bank_account = $13
          where id = $1`,
        [
          professionalId,
          data.userId,
          data.displayName,
          data.title,
          data.avatarUrl,
          data.color,
          data.email,
          data.allServices,
          data.notifyNewAppointments,
          data.dailyAgenda,
          data.isActive,
          data.meetingUrl,
          data.bankAccount ? JSON.stringify(data.bankAccount) : null,
        ],
      );
      await saveServices(db, professionalId, data);
      const professional = await findProfessional(db, businessId, professionalId);
      const verb = before.isActive && !professional.isActive ? "Desactivó" : !before.isActive && professional.isActive ? "Reactivó" : "Editó";
      await logAudit(db, {
        businessId,
        actor,
        action: "professional.updated",
        entityType: "professional",
        entityId: professionalId,
        summary: `${verb} al profesional ${professional.displayName}`,
        changes: diffChanges(await professionalForAudit(db, before), await professionalForAudit(db, professional), PROFESSIONAL_FIELDS),
      });
      return { professional, previousAvatar: before.avatarUrl };
    });
    if (previousAvatar !== professional.avatarUrl) await releaseImages([previousAvatar]);
    return professional;
  },

  /** Sólo sin citas: con historial se desactiva (así se conservan sus citas y reportes). */
  async remove(ctx: RequestContext, businessId: string, professionalId: string): Promise<void> {
    const removed = await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "professionals.manage", { lock: true });
      const professional = await findProfessional(db, businessId, professionalId);
      if (professional.isActive) await assertAnotherActive(db, businessId, professionalId);
      const hasAppointments = await one(db, "select 1 from appointments where professional_id = $1 limit 1", [professionalId]);
      if (hasAppointments) {
        throw new AppError("conflict", `${professional.displayName} tiene citas registradas: desactívalo para conservar su historial.`);
      }
      await db.query("delete from professionals where id = $1", [professionalId]);
      await logAudit(db, {
        businessId,
        actor,
        action: "professional.deleted",
        entityType: "professional",
        entityId: professionalId,
        summary: `Eliminó al profesional ${professional.displayName}`,
      });
      return professional;
    });
    await releaseImages([removed.avatarUrl]);
  },
};
