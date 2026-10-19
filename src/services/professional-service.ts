import { PROFESSIONAL_ORDER, professionalColumns, scheduleColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { BANK_ACCOUNT_TYPE_LABELS, DEFAULT_WEEKLY_SCHEDULE } from "../shared/lib/constants/business.ts";
import { getFullName } from "../shared/lib/format.ts";
import { hasPermission } from "../shared/lib/permissions.ts";
import { calendarInvitesSchema, type ProfessionalInput } from "../shared/lib/validations/professional.ts";
import type { BankAccount, Professional, Schedule } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { diffChanges, PROFESSIONAL_FIELDS, type ProfessionalForAudit } from "./audit-changes.ts";
import { accountsToSave, bankAccountValues, parseProfessionalInput } from "./bank-accounts.ts";
import { syncCalendarInvites, upcomingInviteIds } from "./calendar-invites.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";
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
    bankAccounts: professional.bankAccounts.length ? professional.bankAccounts.map(describeBankAccount).join(", ") : null,
    memberName: member ? getFullName(member) : null,
    servicesLabel: services,
    notifyNewAppointments: professional.notifyNewAppointments,
    dailyAgenda: professional.dailyAgenda,
    isActive: professional.isActive,
  };
}

/** Una cuenta en la auditoría, como siempre: "Banco Pichincha · Ahorros · 2200123456 · Ana Ruiz". */
const describeBankAccount = (account: BankAccount) =>
  `${account.bank} · ${BANK_ACCOUNT_TYPE_LABELS[account.accountType]} · ${account.number} · ${account.holder}`;

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

/** Sin email no hay a dónde enviar las invitaciones de calendario (spec 027). */
const CALENDAR_WITHOUT_EMAIL_MESSAGE =
  "Para recibir las citas en el calendario, la agenda necesita un email: escribe su «Email para sus avisos» o vincúlala a un usuario del equipo.";

/** El email de una agenda con estos datos: el de avisos o, si está vacío, el de su usuario ("" = ninguno). */
async function agendaEmailOf(db: Db, email: string, userId: string | null): Promise<string> {
  const row = await one<{ email: string }>(
    db,
    "select coalesce(nullif($1::text, ''), (select u.email from users u where u.id = $2::uuid), '') as email",
    [email, isUuid(userId) ? userId : null],
  );
  return row?.email ?? "";
}

/**
 * Activar o desactivar las invitaciones de calendario de una agenda va a la actividad (spec 027), con su
 * propia entrada: «Activó las invitaciones de calendario de la agenda de Dra. Valeria Cruz».
 */
async function logCalendarInvites(db: Db, actor: Actor, professional: Professional): Promise<void> {
  const enabled = professional.calendarInvites;
  await logAudit(db, {
    businessId: professional.businessId,
    actor,
    action: enabled ? "professional.calendar_invites_enabled" : "professional.calendar_invites_disabled",
    entityType: "professional",
    entityId: professional.id,
    summary: `${enabled ? "Activó" : "Desactivó"} las invitaciones de calendario de la agenda de ${professional.displayName}`,
    changes: [{ label: "Invitaciones de calendario", before: enabled ? "No" : "Sí", after: enabled ? "Sí" : "No" }],
  });
}

/**
 * Al activarlas (o si cambió el email al que llegan), salen enseguida las de las citas de la ventana: las
 * de más lejos, cuando entren (el cron). Devuelve cuántas quedaron en cola.
 */
async function syncAgendaInvites(db: Db, professional: Professional): Promise<number> {
  if (!professional.calendarInvites) return 0;
  return syncCalendarInvites(db, await upcomingInviteIds(db, { professionalId: professional.id }));
}

/** La foto de una agenda: de las fotos de agendas del negocio o la del usuario que la atiende. */
const agendaImageFolders = (businessId: string, userId: string | null) => [
  imageFolder.professional(businessId),
  ...(userId ? [imageFolder.avatar(userId)] : []),
];

export const professionalService = {
  /**
   * Las agendas del negocio. El rol Profesional sólo ve las suyas enteras: de las demás, lo que necesita
   * la agenda (nombre, foto, color, especialidad, servicios), sin su email (tampoco el de sus invitaciones
   * de calendario), su sala de videollamada ni sus cuentas bancarias (spec 009). Recepción sí las recibe:
   * manda por WhatsApp los datos de pago y el enlace de la consulta de cualquier agenda.
   */
  async list(ctx: RequestContext, businessId: string): Promise<Professional[]> {
    const actor = await authorize(pool, ctx, businessId);
    const professionals = await listProfessionals(pool, businessId);
    if (actor.role !== "professional") return professionals;
    return professionals.map((professional) =>
      professional.userId === actor.userId
        ? professional
        : { ...professional, email: "", calendarEmail: "", meetingUrl: "", bankAccounts: [], bankAccount: null },
    );
  },

  /** Agenda nueva con el horario del primer profesional como punto de partida. */
  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<Professional> {
    const parsed = parseProfessionalInput(input);
    const { data } = parsed;
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "professionals.manage", { lock: true });
      await assertMultipleAgendas(db, businessId);
      if (data.isActive) await assertProfessionalLimit(db, businessId);
      await assertAssignableMember(db, businessId, data.userId);
      await assertOwnServices(db, businessId, data);
      assertStoredImage(data.avatarUrl, null, "La foto", agendaImageFolders(businessId, data.userId));
      if (data.calendarInvites && !(await agendaEmailOf(db, data.email, data.userId))) {
        throw new AppError("validation", CALENDAR_WITHOUT_EMAIL_MESSAGE);
      }
      const next = await one<{ order: number }>(
        db,
        `select coalesce(max(sort_order), 0) + 1 as "order" from professionals where business_id = $1`,
        [businessId],
      );
      const { id } = (await one<{ id: string }>(
        db,
        `insert into professionals
           (business_id, user_id, display_name, title, avatar_url, color, email, all_services,
            notify_new_appointments, daily_agenda, is_active, sort_order, meeting_url, bank_accounts, bank_account,
            calendar_invites)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
          // La primera cuenta también en bank_account, para el código anterior (ver bank-accounts.ts).
          ...bankAccountValues(accountsToSave(parsed, [])),
          data.calendarInvites ?? false,
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
      // Una agenda nueva aún no tiene citas: sólo queda en la actividad que nace con las invitaciones.
      if (professional.calendarInvites) await logCalendarInvites(db, actor, professional);
      return professional;
    });
  },

  async update(ctx: RequestContext, businessId: string, professionalId: string, input: unknown): Promise<Professional> {
    const parsed = parseProfessionalInput(input);
    const { data } = parsed;
    const { professional, previousAvatar } = await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "professionals.manage", { lock: true });
      const before = await findProfessional(db, businessId, professionalId);
      assertStoredImage(data.avatarUrl, before.avatarUrl, "La foto", agendaImageFolders(businessId, data.userId));
      if (data.isActive && !before.isActive) await assertProfessionalLimit(db, businessId, professionalId);
      if (!data.isActive && before.isActive) await assertAnotherActive(db, businessId, professionalId);
      await assertAssignableMember(db, businessId, data.userId, professionalId);
      await assertOwnServices(db, businessId, data);
      // Las invitaciones de calendario (spec 027): sin el campo (un front anterior), las que tenía. Sin email
      // no se activan; si ya estaban y la agenda se queda sin email, se apagan (no hay a dónde enviarlas).
      let calendarInvites = data.calendarInvites ?? before.calendarInvites;
      if (calendarInvites && !(await agendaEmailOf(db, data.email, data.userId))) {
        if (!before.calendarInvites) throw new AppError("validation", CALENDAR_WITHOUT_EMAIL_MESSAGE);
        calendarInvites = false;
      }
      await db.query(
        `update professionals
            set user_id = $2, display_name = $3, title = $4, avatar_url = $5, color = $6, email = $7,
                all_services = $8, notify_new_appointments = $9, daily_agenda = $10, is_active = $11,
                meeting_url = $12, bank_accounts = $13, bank_account = $14, calendar_invites = $15
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
          // La primera cuenta también en bank_account, para el código anterior (ver bank-accounts.ts).
          ...bankAccountValues(accountsToSave(parsed, before.bankAccounts)),
          calendarInvites,
        ],
      );
      await saveServices(db, professionalId, data);
      const professional = await findProfessional(db, businessId, professionalId);
      const verb = before.isActive && !professional.isActive ? "Desactivó" : !before.isActive && professional.isActive ? "Reactivó" : "Editó";
      const changes = diffChanges(await professionalForAudit(db, before), await professionalForAudit(db, professional), PROFESSIONAL_FIELDS);
      const calendarChanged = professional.calendarInvites !== before.calendarInvites;
      // Sólo el interruptor: basta su propia entrada (abajo), sin un «Editó» vacío.
      if (!calendarChanged || changes.length > 0 || verb !== "Editó") {
        await logAudit(db, {
          businessId,
          actor,
          action: "professional.updated",
          entityType: "professional",
          entityId: professionalId,
          summary: `${verb} al profesional ${professional.displayName}`,
          changes,
        });
      }
      if (calendarChanged) await logCalendarInvites(db, actor, professional);
      // Recién activadas, o con otro email: las citas de la ventana, a su calendario (el nuevo).
      if (calendarChanged || professional.calendarEmail !== before.calendarEmail) await syncAgendaInvites(db, professional);
      return { professional, previousAvatar: before.avatarUrl };
    });
    if (previousAvatar !== professional.avatarUrl) await releaseImages([previousAvatar]);
    return professional;
  },

  /**
   * El interruptor de las invitaciones de calendario, solo (spec 027): lo cambian el profesional en su
   * agenda («Tu agenda» en su perfil, también el rol Profesional) y quien gestiona los profesionales en
   * cualquiera. Va a la actividad y, al activarlo, salen enseguida las de las citas de la ventana.
   */
  async setCalendarInvites(ctx: RequestContext, businessId: string, professionalId: string, input: unknown): Promise<Professional> {
    const { calendarInvites } = parseInput(calendarInvitesSchema, input ?? {});
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, undefined, { lock: true });
      const before = await findProfessional(db, businessId, professionalId);
      if (!hasPermission(actor.role, "professionals.manage") && before.userId !== actor.userId) {
        throw new AppError("forbidden", "Sólo puedes cambiar las invitaciones de calendario de tu propia agenda.");
      }
      if (calendarInvites === before.calendarInvites) return before;
      if (calendarInvites && !before.calendarEmail) throw new AppError("validation", CALENDAR_WITHOUT_EMAIL_MESSAGE);
      await db.query("update professionals set calendar_invites = $2 where id = $1", [professionalId, calendarInvites]);
      const professional = await findProfessional(db, businessId, professionalId);
      await logCalendarInvites(db, actor, professional);
      await syncAgendaInvites(db, professional);
      return professional;
    });
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
