import { appointmentColumns, blockedTimeColumns, clientColumns, scheduleColumns, serviceColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { offersService } from "../shared/lib/availability.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { BLOCKING_STATUSES } from "../shared/lib/constants/appointment-status.ts";
import { formatNumericDate, formatTimeRange } from "../shared/lib/format.ts";
import { documentIdError } from "../shared/lib/identity.ts";
import { addMinutesToTime, getZonedNow, minutesToTime } from "../shared/lib/time.ts";
import { appointmentSchema, appointmentStatusSchema, whatsAppNoticeSchema } from "../shared/lib/validations/appointment.ts";
import { clientSchema } from "../shared/lib/validations/client.ts";
import { dateField } from "../shared/lib/validations/fields.ts";
import { blockedTimeSchema, weeklyScheduleSchema } from "../shared/lib/validations/schedule.ts";
import { serviceSchema } from "../shared/lib/validations/service.ts";
import { z } from "zod";
import type {
  Appointment,
  AppointmentStatus,
  BlockedTime,
  Client,
  ClientActivity,
  HomeVisitAddress,
  ISODate,
  Schedule,
  Service,
  WhatsAppNoticeKind,
} from "../shared/types/index.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import {
  APPOINTMENT_FIELDS,
  CLIENT_FIELDS,
  SERVICE_FIELDS,
  diffChanges,
  scheduleChanges,
  type AppointmentForAudit,
  type ServiceForAudit,
} from "./audit-changes.ts";
import {
  agendaScope,
  assertAppointmentInScope,
  assertClientInScope,
  ownClientCondition,
  type AgendaScope,
} from "./agenda-scope.ts";
import { authorize, parseInput, type Actor, type RequestContext } from "./context.ts";
import { isRescheduled, notifyAppointmentChange } from "./notifications.ts";
import { receiptPaths, removeReceiptFiles } from "./payment-service.ts";
import { assertAppointmentLimit, assertClientLimit } from "./plan-limits.ts";
import { findProfessional, listProfessionals } from "./professional-service.ts";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

/** Busca un registro garantizando que pertenece al negocio (aislamiento multi-tenant). */
async function findOwned<T>(db: Db, table: string, columns: string, businessId: string, id: string, notFound: string) {
  const row = isUuid(id)
    ? await one<T>(db, `select ${columns} from ${table} where id = $1 and business_id = $2`, [id, businessId])
    : null;
  if (!row) throw new AppError("not_found", notFound);
  return row;
}

/* ---------------------------------- Clientes --------------------------------- */

/** La cédula identifica al cliente en el negocio: no puede repetirse y, en Ecuador, debe ser válida. */
async function assertValidClientDocument(db: Db, businessId: string, documentId: string, excludeId?: string) {
  if (!documentId) return;
  const business = await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]);
  const error = documentIdError(documentId, business?.timezone ?? "");
  if (error) throw new AppError("validation", error);
  const duplicate = await one<{ name: string }>(
    db,
    "select name from clients where business_id = $1 and document_id = $2 and ($3::uuid is null or id <> $3::uuid)",
    [businessId, documentId, excludeId ?? null],
  );
  if (duplicate) throw new AppError("conflict", `Ya existe un cliente con esa cédula: ${duplicate.name}.`);
}

export const clientService = {
  /** Con el rol Profesional y "sólo sus pacientes", únicamente los suyos. */
  async list(ctx: RequestContext, businessId: string): Promise<Client[]> {
    const actor = await authorize(pool, ctx, businessId);
    const own = (await agendaScope(pool, actor, businessId)).ownClients;
    const clients = await many<Client>(
      pool,
      `select ${clientColumns("c")} from clients c
        where c.business_id = $1 ${own ? `and ${ownClientCondition("c", 2, 3)}` : ""}`,
      own ? [businessId, own.professionalId, own.userId] : [businessId],
    );
    return clients.sort(byName);
  },

  /**
   * Resumen de las citas de cada cliente (totales, primera visita, última y próxima cita),
   * calculado en la base: la lista de clientes y los reportes no descargan todo el historial.
   */
  async activity(ctx: RequestContext, businessId: string): Promise<ClientActivity[]> {
    const actor = await authorize(pool, ctx, businessId);
    // El rol Profesional ve el resumen de las citas de su agenda.
    const { professionalId } = await agendaScope(pool, actor, businessId);
    const business = await one<{ timezone: string }>(pool, "select timezone from businesses where id = $1", [businessId]);
    const now = getZonedNow(business?.timezone ?? DEFAULT_TIMEZONE);
    const nowTime = minutesToTime(now.minutes);
    const past = "(a.date < $2::date or (a.date = $2::date and a.start_time <= $3::time))";
    const rows = await many<Omit<ClientActivity, "lastAppointment" | "nextAppointment">>(
      pool,
      `select client_id as "clientId",
              count(*) filter (where status <> 'cancelled')::int as "totalAppointments",
              count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'cancelled')::int as cancelled,
              count(*) filter (where status = 'no_show')::int as "noShow",
              coalesce(sum(price) filter (where status = 'completed'), 0) as "totalSpent",
              to_char(min(date) filter (where status <> 'cancelled'), 'YYYY-MM-DD') as "firstVisit"
         from appointments where business_id = $1 and ($2::uuid is null or professional_id = $2::uuid)
        group by client_id`,
      [businessId, professionalId],
    );
    const last = await many<Appointment>(
      pool,
      `select distinct on (a.client_id) ${appointmentColumns("a")}
         from appointments a
        where a.business_id = $1 and a.status <> 'cancelled' and ${past}
          and ($4::uuid is null or a.professional_id = $4::uuid)
        order by a.client_id, a.date desc, a.start_time desc`,
      [businessId, now.date, nowTime, professionalId],
    );
    const next = await many<Appointment>(
      pool,
      `select distinct on (a.client_id) ${appointmentColumns("a")}
         from appointments a
        where a.business_id = $1 and a.status in ('pending', 'confirmed', 'completed') and not ${past}
          and ($4::uuid is null or a.professional_id = $4::uuid)
        order by a.client_id, a.date, a.start_time`,
      [businessId, now.date, nowTime, professionalId],
    );
    const lastByClient = new Map(last.map((appointment) => [appointment.clientId, appointment]));
    const nextByClient = new Map(next.map((appointment) => [appointment.clientId, appointment]));
    return rows.map((row) => ({
      ...row,
      lastAppointment: lastByClient.get(row.clientId) ?? null,
      nextAppointment: nextByClient.get(row.clientId) ?? null,
    }));
  },

  async getById(ctx: RequestContext, businessId: string, clientId: string): Promise<Client | null> {
    const actor = await authorize(pool, ctx, businessId);
    if (!isUuid(clientId)) return null;
    const own = (await agendaScope(pool, actor, businessId)).ownClients;
    return one<Client>(
      pool,
      `select ${clientColumns("c")} from clients c
        where c.id = $1 and c.business_id = $2 ${own ? `and ${ownClientCondition("c", 3, 4)}` : ""}`,
      own ? [clientId, businessId, own.professionalId, own.userId] : [clientId, businessId],
    );
  },

  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<Client> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.manage", { lock: true });
      const data = parseInput(clientSchema, input);
      if (!data.documentId) throw new AppError("validation", "La cédula es obligatoria.");
      if (!data.email) throw new AppError("validation", "El email es obligatorio.");
      await assertValidClientDocument(db, businessId, data.documentId);
      await assertClientLimit(db, businessId);
      const client = (await one<Client>(
        db,
        `insert into clients (business_id, name, document_id, email, phone, address, notes, is_active, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${clientColumns()}`,
        [businessId, data.name, data.documentId, data.email, data.phone, data.address, data.notes, data.isActive, actor.userId],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "client.created",
        entityType: "client",
        entityId: client.id,
        summary: `Creó el cliente ${client.name}`,
      });
      return client;
    });
  },

  async update(ctx: RequestContext, businessId: string, clientId: string, input: unknown): Promise<Client> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.manage", { lock: true });
      const data = parseInput(clientSchema, input);
      const current = await findOwned<Client>(db, "clients", clientColumns(), businessId, clientId, "Cliente no encontrado.");
      await assertClientInScope(db, await agendaScope(db, actor, businessId), clientId);
      // Clientes antiguos sin cédula o sin email pueden seguir así hasta que se completen; una vez
      // puestos, no se quitan (el formulario del panel ya los exige al editar).
      if (!data.documentId && current.documentId) {
        throw new AppError("validation", "La cédula es obligatoria.");
      }
      if (!data.email && current.email) throw new AppError("validation", "El email es obligatorio.");
      await assertValidClientDocument(db, businessId, data.documentId, clientId);
      const client = (await one<Client>(
        db,
        `update clients set name = $2, document_id = $3, email = $4, phone = $5, address = $6, notes = $7, is_active = $8
          where id = $1
          returning ${clientColumns()}`,
        [clientId, data.name, data.documentId, data.email, data.phone, data.address, data.notes, data.isActive],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "client.updated",
        entityType: "client",
        entityId: clientId,
        summary: `Actualizó el cliente ${client.name}`,
        changes: diffChanges(current, client, CLIENT_FIELDS),
      });
      return client;
    });
  },

  /** Elimina el cliente y su historial de citas. */
  async remove(ctx: RequestContext, businessId: string, clientId: string): Promise<void> {
    const receipts = await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "clients.delete", { lock: true });
      const client = await findOwned<Client>(db, "clients", "name", businessId, clientId, "Cliente no encontrado.");
      // La historia clínica no se puede borrar: el paciente se desactiva en su lugar.
      const hasClinicalRecord = await one(
        db,
        `select 1 where exists (select 1 from clinical_notes where client_id = $1)
                     or exists (select 1 from clinical_profiles where client_id = $1)
                     or exists (select 1 from clinical_attachments where client_id = $1)`,
        [clientId],
      );
      if (hasClinicalRecord) {
        throw new AppError("conflict", "Este paciente tiene historia clínica y no se puede eliminar. Desactívalo para ocultarlo.");
      }
      const { count } = (await one<{ count: number }>(db, "select count(*) from appointments where client_id = $1", [
        clientId,
      ]))!;
      // Los comprobantes de sus citas se borran con ellas (y sus archivos, después).
      const receipts = await receiptPaths(db, { clientId });
      await db.query("delete from clients where id = $1", [clientId]); // las citas se borran en cascada
      await logAudit(db, {
        businessId,
        actor,
        action: "client.deleted",
        entityType: "client",
        entityId: clientId,
        summary: `Eliminó el cliente ${client.name} y ${count} cita(s) de su historial`,
      });
      return receipts;
    });
    await removeReceiptFiles(receipts);
  },
};

/* --------------------------------- Servicios --------------------------------- */

/** El formato de historia clínica de un servicio: de la plataforma o propio del negocio. */
async function assertServiceTemplate(db: Db, businessId: string, templateId: string | null): Promise<void> {
  if (!templateId) return;
  const template = await one(
    db,
    "select 1 from clinical_templates where id = $1 and (business_id is null or business_id = $2)",
    [templateId, businessId],
  );
  if (!template) throw new AppError("validation", "Ese formato de historia clínica no existe.");
}

export const serviceService = {
  async list(ctx: RequestContext, businessId: string): Promise<Service[]> {
    await authorize(pool, ctx, businessId);
    const services = await many<Service>(pool, `select ${serviceColumns()} from services where business_id = $1`, [
      businessId,
    ]);
    return services.sort((a, b) => Number(b.isActive) - Number(a.isActive) || byName(a, b));
  },

  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<Service> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "services.manage", { lock: true });
      const data = parseInput(serviceSchema, input);
      await assertServiceTemplate(db, businessId, data.clinicalTemplateId);
      const service = (await one<Service>(
        db,
        `insert into services
           (business_id, name, description, duration_minutes, price, show_price, modes, home_visit_fee,
            clinical_template_id, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning ${serviceColumns()}`,
        [
          businessId,
          data.name,
          data.description,
          data.durationMinutes,
          data.price,
          data.showPrice,
          data.modes,
          data.homeVisitFee,
          data.clinicalTemplateId,
          data.isActive,
        ],
      ))!;
      await logAudit(db, {
        businessId,
        actor,
        action: "service.created",
        entityType: "service",
        entityId: service.id,
        summary: `Creó el servicio ${service.name}`,
      });
      return service;
    });
  },

  async update(ctx: RequestContext, businessId: string, serviceId: string, input: unknown): Promise<Service> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "services.manage", { lock: true });
      const data = parseInput(serviceSchema, input);
      const before = await findOwned<Service>(db, "services", serviceColumns(), businessId, serviceId, "Servicio no encontrado.");
      await assertServiceTemplate(db, businessId, data.clinicalTemplateId);
      const service = (await one<Service>(
        db,
        `update services
            set name = $2, description = $3, duration_minutes = $4, price = $5,
                show_price = $6, modes = $7, home_visit_fee = $8, clinical_template_id = $9, is_active = $10
          where id = $1
          returning ${serviceColumns()}`,
        [
          serviceId,
          data.name,
          data.description,
          data.durationMinutes,
          data.price,
          data.showPrice,
          data.modes,
          data.homeVisitFee,
          data.clinicalTemplateId,
          data.isActive,
        ],
      ))!;
      const summary =
        before.isActive !== data.isActive
          ? `${data.isActive ? "Activó" : "Desactivó"} el servicio ${service.name}`
          : `Actualizó el servicio ${service.name}`;
      await logAudit(db, {
        businessId,
        actor,
        action: "service.updated",
        entityType: "service",
        entityId: serviceId,
        summary,
        changes: diffChanges(await serviceForAudit(db, before), await serviceForAudit(db, service), SERVICE_FIELDS),
      });
      return service;
    });
  },

  /** Falla con `conflict` si el servicio tiene citas asociadas. */
  async remove(ctx: RequestContext, businessId: string, serviceId: string): Promise<void> {
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "services.manage", { lock: true });
      const service = await findOwned<Service>(db, "services", "name", businessId, serviceId, "Servicio no encontrado.");
      if (await one(db, "select 1 from appointments where service_id = $1 limit 1", [serviceId])) {
        throw new AppError("conflict", "Este servicio tiene citas asociadas. Desactívalo para que deje de ofrecerse.");
      }
      await db.query("delete from services where id = $1", [serviceId]);
      await logAudit(db, {
        businessId,
        actor,
        action: "service.deleted",
        entityType: "service",
        entityId: serviceId,
        summary: `Eliminó el servicio ${service.name}`,
      });
    });
  },
};

/* ----------------------------------- Citas ----------------------------------- */

export interface AppointmentFilters {
  from?: ISODate;
  to?: ISODate;
  clientId?: string;
}

/**
 * Otra cita activa del mismo profesional que se solapa con esta (intervalos semiabiertos: 09:00–10:00 y
 * 10:00–11:00 no chocan). Dos profesionales sí pueden atender a la misma hora.
 */
async function assertNoConflict(db: Db, appointment: Appointment) {
  if (!BLOCKING_STATUSES.has(appointment.status)) return;
  const conflict = await one<Pick<Appointment, "startTime" | "endTime">>(
    db,
    `select start_time as "startTime", end_time as "endTime" from appointments
      where business_id = $1 and professional_id = $6 and date = $2 and id <> $3
        and status in ('pending', 'confirmed', 'completed')
        and start_time < $5::time and $4::time < end_time
      order by start_time
      limit 1`,
    [
      appointment.businessId,
      appointment.date,
      appointment.id,
      appointment.startTime,
      appointment.endTime,
      appointment.professionalId,
    ],
  );
  if (conflict) {
    throw new AppError(
      "conflict",
      `Ya existe una cita de ${formatTimeRange(conflict.startTime, conflict.endTime)} ese día en esa agenda.`,
    );
  }
}

/**
 * Agenda de una cita creada desde el panel. El rol Profesional sólo agenda en la suya. Si no se eligió:
 * la de quien la crea o, si el negocio tiene una sola activa, esa.
 */
async function resolveAppointmentProfessional(
  db: Db,
  businessId: string,
  actor: Actor,
  scope: AgendaScope,
  requested: string,
): Promise<string> {
  if (scope.professionalId) {
    if (requested && requested !== scope.professionalId) {
      throw new AppError("forbidden", "Sólo puedes agendar citas en tu propia agenda.");
    }
    return scope.professionalId;
  }
  if (requested) {
    const professional = await findProfessional(db, businessId, requested);
    if (!professional.isActive) {
      throw new AppError("validation", `${professional.displayName} está inactivo: elige otro profesional.`);
    }
    return professional.id;
  }
  const active = await listProfessionals(db, businessId, { activeOnly: true });
  const own = active.find((professional) => professional.userId === actor.userId);
  if (own) return own.id;
  if (active.length === 1) return active[0].id;
  if (active.length === 0) throw new AppError("not_found", "El negocio no tiene profesionales activos.");
  throw new AppError("validation", "Elige el profesional de la cita.");
}

/** El profesional tiene que atender el servicio de la cita (como en el formulario y en la página de reservas). */
async function assertOffersService(db: Db, businessId: string, professionalId: string, serviceId: string) {
  const professional = await findProfessional(db, businessId, professionalId);
  if (offersService(professional, serviceId)) return;
  const service = await one<{ name: string }>(db, "select name from services where id = $1", [serviceId]);
  throw new AppError("validation", `${professional.displayName} no atiende ${service?.name ?? "ese servicio"}: elige otro profesional.`);
}

/**
 * La fecha y hora de la cita se fijan de nuevo (scheduled_at, ver runReminderJob): al moverla, al
 * cambiarle algo que se le avisa al paciente o al reactivarla. Un recordatorio que estuviera en cola
 * deja de valer (era de la versión anterior) y puede salir otro.
 */
const resetsSchedule = (before: Appointment, after: Appointment) =>
  (before.status === "cancelled" && after.status !== "cancelled") || isRescheduled(before, after);

/** Una cita pasa a ocupar cupo del plan si se reactiva o se mueve a otro mes. */
async function assertLimitOnChange(db: Db, before: Appointment, after: Appointment) {
  if (after.status === "cancelled") return;
  if (before.status === "cancelled" || before.date.slice(0, 7) !== after.date.slice(0, 7)) {
    await assertAppointmentLimit(db, after.businessId, after.date, after.id);
  }
}

async function buildAppointmentFields(db: Db, businessId: string, input: unknown) {
  const data = parseInput(appointmentSchema, input);
  await findOwned<Client>(db, "clients", "id", businessId, data.clientId, "El cliente seleccionado no existe.");
  await findOwned<Service>(db, "services", "id", businessId, data.serviceId, "El servicio seleccionado no existe.");
  return {
    clientId: data.clientId,
    serviceId: data.serviceId,
    date: data.date,
    startTime: data.startTime,
    endTime: addMinutesToTime(data.startTime, data.durationMinutes),
    status: data.status,
    notes: data.notes,
    price: data.price,
    homeVisit: data.homeVisit,
    isVirtual: data.isVirtual,
    /** Vacío: sin elegir (ver resolveAppointmentProfessional). */
    requestedProfessionalId: data.professionalId,
  };
}

/** jsonb: el lugar de una visita a domicilio (o null si es en el local). */
const homeVisitJson = (visit: HomeVisitAddress | null) => (visit ? JSON.stringify(visit) : null);

/**
 * Guarda los campos editables de una cita y devuelve la fila actualizada. `rescheduled`: la fecha y
 * hora se fijaron de nuevo (ver resetsSchedule).
 */
async function saveAppointment(db: Db, appointment: Appointment, rescheduled: boolean): Promise<Appointment> {
  return (await one<Appointment>(
    db,
    `update appointments
        set client_id = $2, service_id = $3, date = $4, start_time = $5, end_time = $6,
            status = $7, notes = $8, price = $9, home_visit = $10, professional_id = $11, is_virtual = $12,
            scheduled_at = case when $13 then now() else scheduled_at end,
            updated_at = now()
      where id = $1
      returning ${appointmentColumns()}`,
    [
      appointment.id,
      appointment.clientId,
      appointment.serviceId,
      appointment.date,
      appointment.startTime,
      appointment.endTime,
      appointment.status,
      appointment.notes,
      appointment.price,
      homeVisitJson(appointment.homeVisit),
      appointment.professionalId,
      appointment.isVirtual,
      rescheduled,
    ],
  ))!;
}

/** La cita con los nombres que muestra la auditoría. */
async function appointmentForAudit(db: Db, appointment: Appointment): Promise<AppointmentForAudit> {
  const names = await one<{ clientName: string | null; serviceName: string | null; professionalName: string | null }>(
    db,
    `select (select name from clients where id = $1) as "clientName",
            (select name from services where id = $2) as "serviceName",
            (select display_name from professionals where id = $3) as "professionalName"`,
    [appointment.clientId, appointment.serviceId, appointment.professionalId],
  );
  return {
    date: appointment.date,
    time: formatTimeRange(appointment.startTime, appointment.endTime),
    clientName: names?.clientName ?? "—",
    serviceName: names?.serviceName ?? "—",
    professionalName: names?.professionalName ?? "—",
    status: appointment.status,
    price: appointment.price,
    notes: appointment.notes,
    homeAddress: appointment.homeVisit?.address ?? null,
    modality: appointment.isVirtual ? "Virtual" : appointment.homeVisit ? "A domicilio" : "En el local",
  };
}

/** El servicio con el nombre de su formato de historia clínica. */
async function serviceForAudit(db: Db, service: Service): Promise<ServiceForAudit> {
  const template = service.clinicalTemplateId
    ? await one<{ name: string }>(db, "select name from clinical_templates where id = $1", [service.clinicalTemplateId])
    : null;
  return { ...service, clinicalTemplateName: template?.name ?? null };
}

const STATUS_VERBS: Record<AppointmentStatus, string> = {
  pending: "Marcó como pendiente",
  confirmed: "Confirmó",
  completed: "Marcó como completada",
  cancelled: "Canceló",
  no_show: "Marcó como “No asistió”",
};

export const appointmentService = {
  /** El rol Profesional sólo recibe las citas de su agenda (y así también sus reportes). */
  async list(ctx: RequestContext, businessId: string, filters: AppointmentFilters = {}): Promise<Appointment[]> {
    const actor = await authorize(pool, ctx, businessId);
    const { professionalId } = await agendaScope(pool, actor, businessId);
    const from = filters.from ? parseInput(dateField, filters.from) : null;
    const to = filters.to ? parseInput(dateField, filters.to) : null;
    if (filters.clientId && !isUuid(filters.clientId)) return [];
    return many<Appointment>(
      pool,
      `select ${appointmentColumns()} from appointments
        where business_id = $1
          and ($2::date is null or date >= $2::date)
          and ($3::date is null or date <= $3::date)
          and ($4::uuid is null or client_id = $4::uuid)
          and ($5::uuid is null or professional_id = $5::uuid)
        order by date, start_time`,
      [businessId, from, to, filters.clientId ?? null, professionalId],
    );
  },

  /** Una cita (el detalle se abre sin descargar la agenda entera). */
  async getById(ctx: RequestContext, businessId: string, appointmentId: string): Promise<Appointment | null> {
    const actor = await authorize(pool, ctx, businessId);
    if (!isUuid(appointmentId)) return null;
    const { professionalId } = await agendaScope(pool, actor, businessId);
    return one<Appointment>(
      pool,
      `select ${appointmentColumns()} from appointments
        where id = $1 and business_id = $2 and ($3::uuid is null or professional_id = $3::uuid)`,
      [appointmentId, businessId, professionalId],
    );
  },

  /** Falla con `conflict` si se solapa con otra cita activa y con `plan_limit` si se superó el plan. */
  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<Appointment> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const { requestedProfessionalId, ...fields } = await buildAppointmentFields(db, businessId, input);
      await assertClientInScope(db, scope, fields.clientId);
      const professionalId = await resolveAppointmentProfessional(db, businessId, actor, scope, requestedProfessionalId);
      await assertOffersService(db, businessId, professionalId, fields.serviceId);

      const draft: Appointment = {
        id: "00000000-0000-0000-0000-000000000000",
        businessId,
        professionalId,
        ...fields,
        source: "dashboard",
        arrivedAt: null,
        paymentToken: "",
        receiptAt: null,
        paidAt: null,
        createdAt: "",
        updatedAt: "",
      };
      await assertNoConflict(db, draft);
      if (draft.status !== "cancelled") await assertAppointmentLimit(db, businessId, draft.date);

      const appointment = (await one<Appointment>(
        db,
        `insert into appointments
           (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, notes, price,
            home_visit, is_virtual, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'dashboard')
         returning ${appointmentColumns()}`,
        [
          businessId,
          fields.clientId,
          fields.serviceId,
          professionalId,
          fields.date,
          fields.startTime,
          fields.endTime,
          fields.status,
          fields.notes,
          fields.price,
          homeVisitJson(fields.homeVisit),
          fields.isVirtual,
        ],
      ))!;
      await notifyAppointmentChange(db, null, appointment, "dashboard", actor.userId);
      await logAudit(db, {
        businessId,
        actor,
        action: "appointment.created",
        entityType: "appointment",
        entityId: appointment.id,
        summary: `Creó la cita de ${await describeAppointment(db, appointment)}`,
      });
      return appointment;
    });
  },

  async update(ctx: RequestContext, businessId: string, appointmentId: string, input: unknown): Promise<Appointment> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const before = await findOwned<Appointment>(
        db,
        "appointments",
        appointmentColumns(),
        businessId,
        appointmentId,
        "Cita no encontrada.",
      );
      const scope = await agendaScope(db, actor, businessId);
      assertAppointmentInScope(scope, before);
      const { requestedProfessionalId, ...fields } = await buildAppointmentFields(db, businessId, input);
      if (fields.clientId !== before.clientId) await assertClientInScope(db, scope, fields.clientId);
      // Cambiar de agenda (reasignar a otro profesional): sólo a una activa y no para el rol Profesional.
      const professionalId =
        requestedProfessionalId && requestedProfessionalId !== before.professionalId
          ? await resolveAppointmentProfessional(db, businessId, actor, scope, requestedProfessionalId)
          : before.professionalId;
      const updated: Appointment = { ...before, ...fields, professionalId };
      // Otro profesional u otro servicio: tiene que atenderlo (una cita que ya estaba así se puede seguir editando).
      if (professionalId !== before.professionalId || updated.serviceId !== before.serviceId) {
        await assertOffersService(db, businessId, professionalId, updated.serviceId);
      }
      await assertNoConflict(db, updated);
      await assertLimitOnChange(db, before, updated);
      const appointment = await saveAppointment(db, updated, resetsSchedule(before, updated));
      await notifyAppointmentChange(db, before, appointment, "dashboard", actor.userId);

      const rescheduled = before.date !== appointment.date || before.startTime !== appointment.startTime;
      await logAudit(db, {
        businessId,
        actor,
        action: rescheduled ? "appointment.rescheduled" : "appointment.updated",
        entityType: "appointment",
        entityId: appointment.id,
        summary: rescheduled
          ? `Reprogramó la cita de ${await describeAppointment(db, before)} al ${formatNumericDate(appointment.date)} ${appointment.startTime}`
          : `Editó la cita de ${await describeAppointment(db, appointment)}`,
        changes: diffChanges(await appointmentForAudit(db, before), await appointmentForAudit(db, appointment), APPOINTMENT_FIELDS),
      });
      return appointment;
    });
  },

  async updateStatus(ctx: RequestContext, businessId: string, appointmentId: string, status: unknown): Promise<Appointment> {
    const nextStatus = parseInput(appointmentStatusSchema, status);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const before = await findOwned<Appointment>(
        db,
        "appointments",
        appointmentColumns(),
        businessId,
        appointmentId,
        "Cita no encontrada.",
      );
      assertAppointmentInScope(await agendaScope(db, actor, businessId), before);
      const updated: Appointment = { ...before, status: nextStatus };
      await assertNoConflict(db, updated);
      await assertLimitOnChange(db, before, updated);
      const appointment = await saveAppointment(db, updated, resetsSchedule(before, updated));
      await notifyAppointmentChange(db, before, appointment, "dashboard", actor.userId);
      await logAudit(db, {
        businessId,
        actor,
        action: `appointment.${nextStatus}`,
        entityType: "appointment",
        entityId: appointment.id,
        summary: `${STATUS_VERBS[nextStatus]} la cita de ${await describeAppointment(db, appointment)}`,
        changes: diffChanges(await appointmentForAudit(db, before), await appointmentForAudit(db, appointment), APPOINTMENT_FIELDS),
      });
      return appointment;
    });
  },

  /**
   * El profesional abrió WhatsApp con el aviso ya escrito de un cambio de la cita (enlace wa.me).
   * Sólo se sabe que lo abrió, no si lo envió: así lo dice la actividad.
   */
  async logWhatsAppNotice(ctx: RequestContext, businessId: string, appointmentId: string, kind: unknown): Promise<void> {
    const notice = parseInput(whatsAppNoticeSchema, kind);
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage");
      const appointment = await findOwned<Appointment>(
        db,
        "appointments",
        appointmentColumns(),
        businessId,
        appointmentId,
        "Cita no encontrada.",
      );
      assertAppointmentInScope(await agendaScope(db, actor, businessId), appointment);
      await logAudit(db, {
        businessId,
        actor,
        action: "appointment.whatsapp_notice",
        entityType: "appointment",
        entityId: appointment.id,
        summary: `Abrió WhatsApp para avisar ${WHATSAPP_NOTICE_LABELS[notice]} a ${await describeAppointment(db, appointment)}`,
      });
    });
  },
};

/**
 * Llegada del paciente (control de asistencia): recepción la marca al verlo en la sala de espera y
 * puede quitarla si se equivocó. Sólo en citas pendientes o confirmadas.
 */
export async function setAppointmentArrival(
  ctx: RequestContext,
  businessId: string,
  appointmentId: string,
  arrived: unknown,
): Promise<Appointment> {
  const value = parseInput(z.boolean({ error: "Indica si el paciente llegó" }), arrived);
  return transaction(async (db) => {
    const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
    const before = await findOwned<Appointment>(db, "appointments", appointmentColumns(), businessId, appointmentId, "Cita no encontrada.");
    assertAppointmentInScope(await agendaScope(db, actor, businessId), before);
    if (value && !["pending", "confirmed"].includes(before.status)) {
      throw new AppError("conflict", "Sólo se marca la llegada en citas pendientes o confirmadas.");
    }
    const appointment = (await one<Appointment>(
      db,
      `update appointments set arrived_at = ${value ? "now()" : "null"}, updated_at = now()
        where id = $1 returning ${appointmentColumns()}`,
      [appointmentId],
    ))!;
    await logAudit(db, {
      businessId,
      actor,
      action: value ? "appointment.arrived" : "appointment.arrival_cleared",
      entityType: "appointment",
      entityId: appointmentId,
      summary: `${value ? "Marcó la llegada de" : "Quitó la llegada de"} ${await describeAppointment(db, appointment)}`,
    });
    return appointment;
  });
}

/** "Abrió WhatsApp para avisar que la cita está confirmada a María (06/10/2026 10:00)". */
const WHATSAPP_NOTICE_LABELS: Record<WhatsAppNoticeKind, string> = {
  confirmed: "que la cita está confirmada",
  cancelled: "que la cita se canceló",
  rescheduled: "el cambio de la cita",
  completed: "con un gracias por la visita",
  no_show: "para reagendar (No asistió)",
  pending: "que la cita vuelve a estar agendada",
};

/* --------------------------------- Horarios ---------------------------------- */

/** Horarios de todas las agendas del negocio (o de una). */
export async function listSchedules(db: Db, businessId: string, professionalId?: string | null): Promise<Schedule[]> {
  return many<Schedule>(
    db,
    `select ${scheduleColumns()} from schedules
      where business_id = $1 and ($2::uuid is null or professional_id = $2::uuid)
      order by professional_id, day_of_week`,
    [businessId, professionalId ?? null],
  );
}

export const scheduleService = {
  /** El rol Profesional sólo ve el suyo. */
  async list(ctx: RequestContext, businessId: string): Promise<Schedule[]> {
    const actor = await authorize(pool, ctx, businessId);
    return listSchedules(pool, businessId, (await agendaScope(pool, actor, businessId)).professionalId);
  },

  /**
   * Horario semanal de un profesional. Sin `professionalId` (versiones anteriores del panel): el de quien
   * guarda o, si no atiende, el primer profesional activo.
   */
  async saveWeek(ctx: RequestContext, businessId: string, days: unknown, requestedProfessionalId?: string): Promise<Schedule[]> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "schedule.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const week = parseInput(weeklyScheduleSchema, days);
      if (new Set(week.map((day) => day.dayOfWeek)).size !== week.length) {
        throw new AppError("validation", "Cada día de la semana sólo puede aparecer una vez.");
      }
      const professionalId = requestedProfessionalId
        ? (await findProfessional(db, businessId, requestedProfessionalId)).id
        : await resolveAppointmentProfessional(db, businessId, actor, scope, "").catch(async () => {
            const [first] = await listProfessionals(db, businessId, { activeOnly: true });
            if (!first) throw new AppError("not_found", "El negocio no tiene profesionales activos.");
            return first.id;
          });
      if (scope.professionalId && professionalId !== scope.professionalId) {
        throw new AppError("forbidden", "Sólo puedes cambiar tu propio horario.");
      }
      const professional = await findProfessional(db, businessId, professionalId);
      const previousWeek = await listSchedules(db, businessId, professionalId);
      await db.query("delete from schedules where professional_id = $1", [professionalId]);
      for (const day of week) {
        const intervals = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start));
        await db.query(
          "insert into schedules (business_id, professional_id, day_of_week, is_active, intervals) values ($1, $2, $3, $4, $5)",
          [businessId, professionalId, day.dayOfWeek, day.isActive, JSON.stringify(intervals)],
        );
      }
      const savedWeek = await listSchedules(db, businessId, professionalId);
      await logAudit(db, {
        businessId,
        actor,
        action: "schedule.updated",
        entityType: "schedule",
        entityId: professionalId,
        summary: `Actualizó el horario semanal de ${professional.displayName}`,
        changes: scheduleChanges(previousWeek, savedWeek),
      });
      return savedWeek;
    });
  },
};

/* --------------------------------- Bloqueos ---------------------------------- */

export const blockedTimeService = {
  /** Los de todo el negocio y los de cada agenda (el rol Profesional: los generales y los suyos). */
  async list(ctx: RequestContext, businessId: string): Promise<BlockedTime[]> {
    const actor = await authorize(pool, ctx, businessId);
    const { professionalId } = await agendaScope(pool, actor, businessId);
    return many<BlockedTime>(
      pool,
      `select ${blockedTimeColumns()} from blocked_times
        where business_id = $1 and ($2::uuid is null or professional_id is null or professional_id = $2::uuid)
        order by start_date, start_time nulls first`,
      [businessId, professionalId],
    );
  },

  /** El rol Profesional sólo bloquea su agenda; los bloqueos de todo el negocio son de los administradores. */
  async create(ctx: RequestContext, businessId: string, input: unknown): Promise<BlockedTime> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "schedule.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const data = parseInput(blockedTimeSchema, input);
      if (scope.professionalId && data.professionalId !== scope.professionalId) {
        if (data.professionalId) throw new AppError("forbidden", "Sólo puedes bloquear tu propia agenda.");
        data.professionalId = scope.professionalId;
      }
      const professional = data.professionalId ? await findProfessional(db, businessId, data.professionalId) : null;
      const blockedTime = (await one<BlockedTime>(
        db,
        `insert into blocked_times (business_id, reason, start_date, end_date, all_day, start_time, end_time, professional_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning ${blockedTimeColumns()}`,
        [
          businessId,
          data.reason,
          data.startDate,
          data.endDate,
          data.allDay,
          data.allDay ? null : data.startTime,
          data.allDay ? null : data.endTime,
          professional?.id ?? null,
        ],
      ))!;
      const range =
        data.startDate === data.endDate
          ? formatNumericDate(data.startDate)
          : `${formatNumericDate(data.startDate)} – ${formatNumericDate(data.endDate)}`;
      await logAudit(db, {
        businessId,
        actor,
        action: "blocked_time.created",
        entityType: "blocked_time",
        entityId: blockedTime.id,
        summary: `Bloqueó ${professional ? `la agenda de ${professional.displayName}` : "la agenda de todo el negocio"}: ${data.reason} (${range}${data.allDay ? "" : `, ${data.startTime}–${data.endTime}`})`,
      });
      return blockedTime;
    });
  },

  async remove(ctx: RequestContext, businessId: string, blockedTimeId: string): Promise<void> {
    await transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "schedule.manage", { lock: true });
      const block = await findOwned<BlockedTime>(
        db,
        "blocked_times",
        blockedTimeColumns(),
        businessId,
        blockedTimeId,
        "Bloqueo no encontrado.",
      );
      const { professionalId } = await agendaScope(db, actor, businessId);
      if (professionalId && block.professionalId !== professionalId) {
        throw new AppError("forbidden", "Sólo puedes quitar los bloqueos de tu propia agenda.");
      }
      await db.query("delete from blocked_times where id = $1", [blockedTimeId]);
      await logAudit(db, {
        businessId,
        actor,
        action: "blocked_time.deleted",
        entityType: "blocked_time",
        entityId: blockedTimeId,
        summary: `Eliminó el bloqueo ${block.reason}`,
      });
    });
  },
};
