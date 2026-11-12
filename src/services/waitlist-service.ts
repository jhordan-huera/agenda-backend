import { businessColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { offersService } from "../shared/lib/availability.ts";
import {
  describeDayParts,
  describeWaitlistDays,
  WAITLIST_MAX_OPEN_PER_PERSON,
} from "../shared/lib/constants/business.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import {
  publicWaitlistSchema,
  waitlistCloseSchema,
  waitlistEntrySchema,
  type PublicWaitlistInput,
} from "../shared/lib/validations/waitlist.ts";
import type {
  Business,
  DayOfWeek,
  ISODate,
  Professional,
  PublicWaitlistEntry,
  Service,
  WaitlistDayPart,
  WaitlistEntry,
} from "../shared/types/index.ts";
import { agendaScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { PATIENT_LINK_ACTOR } from "./business-data-service.ts";
import { authorize, lockBusiness, parseInput, type RequestContext } from "./context.ts";
import { queueEmail, waitlistUrl } from "./notifications.ts";
import { addAppointmentNotice } from "./panel-notices.ts";
import { listProfessionals } from "./professional-service.ts";
import { findActiveBusiness } from "./public-booking-service.ts";

/**
 * Lista de espera (spec 047). Quien no encuentra una hora se anota desde la página de reservas (o lo anota el
 * equipo desde el panel) con los días, las partes del día y la fecha hasta la que espera. Cuando se libera una
 * hora, el cron le avisa (`queueWaitlistOffers`, en jobs/scheduled-tasks.ts). Sólo en los negocios con
 * `bookingSettings.waitlist`, que enciende el propietario. Los emails no llevan copia al profesional: no son de
 * una cita. Los avisos de la campana no guardan el nombre de nadie.
 */

const TOKEN_FORMAT = /^[0-9a-f]{32}$/;
const NOT_FOUND = "No encontramos esta lista de espera.";
const LINK_NOT_FOUND = "Este enlace no es válido o ya no está disponible.";

const ENTRY_COLUMNS = `w.id, w.service_id as "serviceId", w.professional_id as "professionalId", w.client_id as "clientId",
  w.name, w.email, w.phone, w.days, w.day_parts as "dayParts", to_char(w.until, 'YYYY-MM-DD') as until, w.source,
  w.created_at as "createdAt"`;

type Preferences = Pick<PublicWaitlistInput, "serviceId" | "professionalId" | "days" | "dayParts" | "until">;

export const waitlistEnabled = (business: Pick<Business, "bookingSettings">) => business.bookingSettings.waitlist === true;

/** Lo que pidió, en una línea para la actividad: «Limpieza dental con Dra. Cruz · Lunes y martes · Mañana · hasta el 12/12». */
function describeRequest(service: Pick<Service, "name">, professional: Pick<Professional, "displayName"> | null, data: Preferences) {
  return `${service.name}${professional ? ` con ${professional.displayName}` : ""} · ${describeWaitlistDays(data.days as DayOfWeek[])} · ${describeDayParts(
    data.dayParts as WaitlistDayPart[],
  )} · hasta el ${data.until}`;
}

/**
 * El servicio y el profesional de una espera: activos, del negocio, y el profesional que ofrece ese servicio
 * (null: «Cualquiera»). La fecha, entre `from` y los días hacia adelante del negocio.
 */
async function resolvePreferences(db: Db, business: Business, data: Preferences, from: ISODate) {
  const service = await one<Service>(
    db,
    `select id, name, duration_minutes as "durationMinutes" from services where id = $1 and business_id = $2 and is_active`,
    [data.serviceId, business.id],
  );
  if (!service) throw new AppError("not_found", "Ese servicio ya no está disponible.");
  const professionals = (await listProfessionals(db, business.id, { activeOnly: true })).filter((professional) =>
    offersService(professional, service.id),
  );
  if (professionals.length === 0) throw new AppError("not_found", "Ese servicio ya no está disponible.");
  let professional: Professional | null = null;
  if (data.professionalId) {
    professional = professionals.find((option) => option.id === data.professionalId) ?? null;
    if (!professional) throw new AppError("not_found", "Ese profesional ya no atiende este servicio. Por favor elige otro.");
  }
  const today = getZonedNow(business.timezone).date;
  const last = addDaysISO(today, business.bookingSettings.maxAdvanceDays);
  if (data.until < from || data.until > last) {
    throw new AppError("validation", `Elige una fecha entre el ${from} y el ${last}.`);
  }
  return { service, professional };
}

/**
 * Anota a la persona o, si ya esperaba con ese email el mismo servicio con el mismo profesional, actualiza lo
 * que pidió. Devuelve la espera y si es nueva. Una persona tiene como mucho WAITLIST_MAX_OPEN_PER_PERSON
 * esperas abiertas en el negocio.
 */
async function saveEntry(
  db: Db,
  business: Business,
  data: Preferences & { name: string; email: string | null; phone: string; clientId?: string | null },
  origin: { source: "booking_page" | "dashboard"; createdBy: string | null },
): Promise<{ id: string; token: string; created: boolean }> {
  const existing = data.email
    ? await one<{ id: string }>(
        db,
        `select id from waitlist_entries
          where business_id = $1 and service_id = $2 and professional_id is not distinct from $3::uuid
            and lower(email) = lower($4) and closed_at is null`,
        [business.id, data.serviceId, data.professionalId, data.email],
      )
    : null;
  if (existing) {
    const row = (await one<{ id: string; token: string }>(
      db,
      `update waitlist_entries set name = $2, phone = $3, days = $4::smallint[], day_parts = $5::text[], until = $6,
              client_id = coalesce($7::uuid, client_id), updated_at = now()
        where id = $1 returning id, token`,
      [existing.id, data.name, data.phone, data.days, data.dayParts, data.until, data.clientId ?? null],
    ))!;
    return { ...row, created: false };
  }
  if (data.email) {
    const open = await one<{ count: number }>(
      db,
      "select count(*)::int as count from waitlist_entries where business_id = $1 and lower(email) = lower($2) and closed_at is null",
      [business.id, data.email],
    );
    if ((open?.count ?? 0) >= WAITLIST_MAX_OPEN_PER_PERSON) {
      throw new AppError(
        "validation",
        `Ya estás en ${WAITLIST_MAX_OPEN_PER_PERSON} listas de espera de este negocio. Sal de alguna desde el enlace de tus emails para anotarte en otra.`,
      );
    }
  }
  const row = (await one<{ id: string; token: string }>(
    db,
    `insert into waitlist_entries
       (business_id, service_id, professional_id, client_id, name, email, phone, days, day_parts, until, source, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::smallint[], $9::text[], $10, $11, $12)
     returning id, token`,
    [
      business.id,
      data.serviceId,
      data.professionalId,
      data.clientId ?? null,
      data.name,
      data.email,
      data.phone,
      data.days,
      data.dayParts,
      data.until,
      origin.source,
      origin.createdBy,
    ],
  ))!;
  return { ...row, created: true };
}

/** «Te anotamos en la lista de espera», con el enlace para salir. Sin copia al profesional (no es de una cita). */
async function queueJoinedEmail(
  db: Db,
  business: Business,
  entry: { id: string; token: string },
  data: Preferences & { name: string; email: string },
  service: Pick<Service, "name">,
  professional: Pick<Professional, "displayName"> | null,
) {
  await queueEmail(db, {
    businessId: business.id,
    type: "waitlist_joined",
    to: data.email,
    ...emailTemplates.waitlistJoined({
      name: data.name.trim().split(/\s+/)[0] ?? data.name,
      businessName: business.name,
      businessAddress: business.address,
      businessPhone: business.phone,
      serviceName: service.name,
      professionalName: professional?.displayName ?? null,
      days: data.days as DayOfWeek[],
      dayParts: data.dayParts as WaitlistDayPart[],
      until: data.until,
      leaveUrl: waitlistUrl(entry.token),
    }),
  });
}

/** El aviso de la campana: alguien se anotó (sin su nombre: el aviso dura 30 días y la persona puede salir antes). */
function noticeJoined(db: Db, businessId: string, service: Pick<Service, "name">, professional: Pick<Professional, "id" | "displayName"> | null) {
  return addAppointmentNotice(db, {
    kind: "waitlist_joined",
    businessId,
    appointmentId: null,
    professionalId: professional?.id ?? null,
    data: { serviceName: service.name, professionalName: professional?.displayName ?? null },
  });
}

/** La espera del enlace personal (token), con su negocio activo; null si no existe o el negocio no está activo. */
async function findByToken(db: Db, token: string, lock = false) {
  if (!TOKEN_FORMAT.test(token)) return null;
  return one<{
    id: string;
    businessId: string;
    businessName: string;
    businessSlug: string;
    serviceName: string;
    professionalName: string | null;
    days: DayOfWeek[];
    dayParts: WaitlistDayPart[];
    until: ISODate;
    name: string;
    email: string | null;
    phone: string;
    closedAt: string | null;
  }>(
    db,
    `select w.id, w.business_id as "businessId", b.name as "businessName", b.slug as "businessSlug", s.name as "serviceName",
            p.display_name as "professionalName", w.days, w.day_parts as "dayParts", to_char(w.until, 'YYYY-MM-DD') as until,
            w.name, w.email, w.phone, w.closed_at as "closedAt"
       from waitlist_entries w
       join businesses b on b.id = w.business_id and b.status = 'active'
       join services s on s.id = w.service_id
       left join professionals p on p.id = w.professional_id
      where w.token = $1
      ${lock ? "for update of w" : ""}`,
    [token],
  );
}

export const waitlistService = {
  /* ------------------------------------------------------------ Público (sin sesión) -- */

  /** Anotarse desde la página de reservas (con CAPTCHA y su límite de peticiones, en la ruta). */
  async join(slug: string, input: unknown): Promise<{ until: ISODate }> {
    const data = parseInput(publicWaitlistSchema, input);
    return transaction(async (db) => {
      const found = await findActiveBusiness(db, slug);
      if (!found || !waitlistEnabled(found.business)) throw new AppError("not_found", NOT_FOUND);
      const { business } = found;
      await lockBusiness(db, business.id);
      // Si el negocio no deja elegir profesional, la espera es para «Cualquiera».
      const preferences = { ...data, professionalId: business.bookingSettings.chooseProfessional === false ? null : data.professionalId };
      const tomorrow = addDaysISO(getZonedNow(business.timezone).date, 1);
      const { service, professional } = await resolvePreferences(db, business, preferences, tomorrow);
      const entry = await saveEntry(db, business, { ...preferences, email: data.email }, { source: "booking_page", createdBy: null });
      await logAudit(db, {
        businessId: business.id,
        actor: null,
        action: entry.created ? "waitlist.joined" : "waitlist.updated",
        entityType: "waitlist",
        entityId: entry.id,
        summary: `${data.name} ${entry.created ? "se anotó en" : "cambió lo que pidió en"} la lista de espera: ${describeRequest(service, professional, preferences)}`,
      });
      await queueJoinedEmail(db, business, entry, { ...preferences, email: data.email }, service, professional);
      if (entry.created) await noticeJoined(db, business.id, service, professional);
      return { until: preferences.until };
    });
  },

  /** El enlace personal: lo que pidió y sus datos (para «Reservar esta hora»). Una espera cerrada dice que ya no está. */
  async get(token: string): Promise<PublicWaitlistEntry> {
    const entry = await findByToken(pool, token);
    if (!entry) throw new AppError("not_found", LINK_NOT_FOUND);
    return {
      businessName: entry.businessName,
      businessSlug: entry.businessSlug,
      serviceName: entry.serviceName,
      professionalName: entry.professionalName,
      days: entry.days,
      dayParts: entry.dayParts,
      until: entry.until,
      name: entry.name,
      email: entry.email,
      phone: entry.phone,
      closed: entry.closedAt !== null,
    };
  },

  /** «Salir de la lista» desde el enlace de los emails, sin iniciar sesión. Salir dos veces no hace nada. */
  async leave(token: string): Promise<{ closed: true }> {
    return transaction(async (db) => {
      const entry = await findByToken(db, token, true);
      if (!entry) throw new AppError("not_found", LINK_NOT_FOUND);
      if (entry.closedAt === null) {
        await db.query("update waitlist_entries set closed_at = now(), closed_reason = 'left', updated_at = now() where id = $1", [entry.id]);
        await logAudit(db, {
          businessId: entry.businessId,
          actor: null,
          actorName: PATIENT_LINK_ACTOR,
          action: "waitlist.left",
          entityType: "waitlist",
          entityId: entry.id,
          summary: `${entry.name} salió de la lista de espera de ${entry.serviceName}`,
        });
      }
      return { closed: true };
    });
  },

  /* --------------------------------------------------------------------- El panel -- */

  /** Las esperas abiertas del negocio, de la más antigua a la más reciente. El rol Profesional, sólo las de su agenda. */
  async list(ctx: RequestContext, businessId: string): Promise<WaitlistEntry[]> {
    const actor = await authorize(pool, ctx, businessId, "appointments.manage");
    const { professionalId } = await agendaScope(pool, actor, businessId);
    return many<WaitlistEntry>(
      pool,
      `select ${ENTRY_COLUMNS} from waitlist_entries w
        where w.business_id = $1 and w.closed_at is null and ($2::uuid is null or w.professional_id = $2::uuid)
        order by w.created_at, w.id`,
      [businessId, professionalId],
    );
  },

  /** «Anotar» desde el panel: un paciente que ya existe o datos nuevos (el email es opcional). */
  async add(ctx: RequestContext, businessId: string, input: unknown): Promise<WaitlistEntry> {
    const data = parseInput(waitlistEntrySchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const { professionalId: ownAgenda } = await agendaScope(db, actor, businessId);
      const business = await loadBusiness(db, businessId);
      if (!waitlistEnabled(business)) throw new AppError("validation", "Enciende la lista de espera en Configuración → Agenda.");
      // El rol Profesional anota sólo en su agenda.
      const preferences = { ...data, professionalId: ownAgenda ?? data.professionalId };
      const today = getZonedNow(business.timezone).date;
      const { service, professional } = await resolvePreferences(db, business, preferences, today);
      if (data.clientId) {
        const client = await one(db, "select 1 from clients where id = $1 and business_id = $2", [data.clientId, businessId]);
        if (!client) throw new AppError("not_found", "Ese paciente ya no existe.");
      }
      const email = data.email || null;
      const entry = await saveEntry(
        db,
        business,
        { ...preferences, email, phone: data.phone, clientId: data.clientId },
        { source: "dashboard", createdBy: actor.userId },
      );
      await logAudit(db, {
        businessId,
        actor,
        action: entry.created ? "waitlist.added" : "waitlist.updated",
        entityType: "waitlist",
        entityId: entry.id,
        summary: `${entry.created ? "Anotó" : "Actualizó"} a ${data.name} en la lista de espera: ${describeRequest(service, professional, preferences)}`,
      });
      if (email) await queueJoinedEmail(db, business, entry, { ...preferences, email }, service, professional);
      return (await one<WaitlistEntry>(db, `select ${ENTRY_COLUMNS} from waitlist_entries w where w.id = $1`, [entry.id]))!;
    });
  },

  /** «Quitar» o, al guardar su cita, «Agendar»: la espera sale de la lista. Cerrarla dos veces no hace nada. */
  async close(ctx: RequestContext, businessId: string, entryId: string, input: unknown): Promise<{ closed: true }> {
    const { reason } = parseInput(waitlistCloseSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const { professionalId } = await agendaScope(db, actor, businessId);
      const entry = isUuid(entryId)
        ? await one<{ id: string; name: string; closedAt: string | null; serviceName: string }>(
            db,
            `select w.id, w.name, w.closed_at as "closedAt", s.name as "serviceName"
               from waitlist_entries w join services s on s.id = w.service_id
              where w.id = $1 and w.business_id = $2 and ($3::uuid is null or w.professional_id = $3::uuid)
              for update of w`,
            [entryId, businessId, professionalId],
          )
        : null;
      if (!entry) throw new AppError("not_found", "Esa persona ya no está en la lista de espera.");
      if (entry.closedAt === null) {
        await db.query("update waitlist_entries set closed_at = now(), closed_reason = $2, updated_at = now() where id = $1", [entry.id, reason]);
        await logAudit(db, {
          businessId,
          actor,
          action: reason === "scheduled" ? "waitlist.scheduled" : "waitlist.removed",
          entityType: "waitlist",
          entityId: entry.id,
          summary:
            reason === "scheduled"
              ? `Agendó a ${entry.name} desde la lista de espera de ${entry.serviceName}`
              : `Quitó a ${entry.name} de la lista de espera de ${entry.serviceName}`,
        });
      }
      return { closed: true };
    });
  },
};

async function loadBusiness(db: Db, businessId: string): Promise<Business> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  if (!business) throw new AppError("not_found", "Negocio no encontrado.");
  return business;
}
