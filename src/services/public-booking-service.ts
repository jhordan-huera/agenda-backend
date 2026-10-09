import { appointmentColumns, blockedTimeColumns, businessColumns, clientColumns, serviceColumns } from "../db/columns.ts";
import { config } from "../config.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { isSlotAvailable, offersService, scopeToProfessional } from "../shared/lib/availability.ts";
import { DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY } from "../shared/lib/constants/business.ts";
import { isPriceVisible } from "../shared/lib/format.ts";
import { addMinutesToTime, getZonedNow } from "../shared/lib/time.ts";
import { documentIdError } from "../shared/lib/identity.ts";
import { clientLookupSchema, newClientContactSchema, publicBookingSchema } from "../shared/lib/validations/booking.ts";
import type {
  Appointment,
  BlockedTime,
  BookingConfirmation,
  Business,
  BusySlot,
  Client,
  ISODate,
  Professional,
  PublicBlockedTime,
  PublicBusiness,
  PublicBusinessProfile,
  PublicClientLookup,
  PublicProfessional,
  PublicService,
  Service,
} from "../shared/types/index.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import { lockBusiness, parseInput } from "./context.ts";
import { listSchedules } from "./business-data-service.ts";
import { receiptStorage } from "./file-storage.ts";
import { notifyAppointmentChange } from "./notifications.ts";
import { assertAppointmentLimit, assertClientLimit } from "./plan-limits.ts";
import { findProfessional, listProfessionals } from "./professional-service.ts";

/**
 * Página pública de reservas (/book/:slug), sin sesión. Sólo expone lo necesario:
 * las citas ocupadas se devuelven como franjas horarias, sin datos de otros clientes.
 */

/**
 * Un negocio suspendido no se distingue de uno inexistente (no se expone su estado). Sólo cuentan
 * los profesionales activos: los inactivos no reciben reservas.
 */
async function findActiveBusiness(db: Db, slug: string): Promise<{ business: Business; professionals: Professional[] } | null> {
  const business = await one<Business>(
    db,
    `select ${businessColumns()} from businesses where slug = $1 and status = 'active'`,
    [slug.trim().toLowerCase()],
  );
  if (!business) return null;
  const professionals = await listProfessionals(db, business.id, { activeOnly: true });
  return professionals.length ? { business, professionals } : null;
}

/**
 * "El primero disponible": los que tienen menos citas ese día van primero (así el trabajo se reparte);
 * a igualdad, el orden del negocio.
 */
async function byLoadOnDate(db: Db, businessId: string, professionals: Professional[], date: ISODate) {
  const rows = await many<{ id: string; count: number }>(
    db,
    `select professional_id as id, count(*)::int as count from appointments
      where business_id = $1 and date = $2 and status in ('pending', 'confirmed', 'completed')
      group by professional_id`,
    [businessId, date],
  );
  const load = new Map(rows.map((row) => [row.id, row.count]));
  return professionals
    .map((professional, index) => ({ professional, index, count: load.get(professional.id) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.index - b.index)
    .map((entry) => entry.professional);
}

/** Franjas ocupadas por citas activas desde `from` (y hasta `to`, si se indica), con su agenda. */
async function busySlots(db: Db, businessId: string, from: ISODate, to?: ISODate): Promise<BusySlot[]> {
  return many<BusySlot>(
    db,
    `select date, start_time as "startTime", end_time as "endTime", professional_id as "professionalId" from appointments
      where business_id = $1 and date >= $2 and ($3::date is null or date <= $3::date)
        and status in ('pending', 'confirmed', 'completed')
      order by date, start_time`,
    [businessId, from, to ?? null],
  );
}

async function blockedTimesFrom(db: Db, businessId: string, from: ISODate, to?: ISODate): Promise<BlockedTime[]> {
  return many<BlockedTime>(
    db,
    `select ${blockedTimeColumns()} from blocked_times
      where business_id = $1 and end_date >= $2 and ($3::date is null or start_date <= $3::date)
      order by start_date`,
    [businessId, from, to ?? null],
  );
}

async function findClientByDocument(db: Db, businessId: string, documentId: string): Promise<Client | null> {
  return one<Client>(db, `select ${clientColumns()} from clients where business_id = $1 and document_id = $2`, [
    businessId,
    documentId,
  ]);
}

/**
 * Una misma persona (identificada por su cédula) no reserva desde la página más citas en un día de
 * las que permite el negocio (`maxClientBookingsPerDay`; 0 = sin límite). Cuenta todas sus citas
 * activas de ese día, también las que agendó el profesional. Va dentro de la transacción, después
 * de lockBusiness: dos reservas a la vez de la misma persona no se cuelan juntas.
 */
async function assertClientDailyLimit(db: Db, business: Business, clientId: string, date: string): Promise<void> {
  const limit = business.bookingSettings.maxClientBookingsPerDay ?? DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY;
  if (limit <= 0) return;
  const sameDay = await one<{ count: number }>(
    db,
    `select count(*)::int as count from appointments
      where business_id = $1 and client_id = $2 and date = $3 and status in ('pending', 'confirmed', 'completed')`,
    [business.id, clientId, date],
  );
  if ((sameDay?.count ?? 0) < limit) return;
  const already = limit === 1 ? "Ya tienes una cita" : `Ya tienes ${limit} citas`;
  throw new AppError(
    "daily_limit",
    `${already} ese día con ${business.name}. Si necesitas otra, escríbele al negocio o elige otro día.`,
  );
}

/** "María  López" y "maria lopez" son el mismo nombre: sin tildes, mayúsculas ni espacios de más. */
export function normalizePersonName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Cuánto después de una reserva se reconoce su reintento (ver findRepeatedBooking). */
const REPEATED_BOOKING_MINUTES = 30;

/**
 * La misma reserva otra vez: se perdió la respuesta (mala conexión) y el paciente volvió a
 * confirmar. Su propia cita ocupa esa hora, así que se busca una cita activa reservada online hace
 * poco con su cédula y el mismo servicio, fecha, hora y modalidad (y el mismo profesional, si lo
 * eligió). Sólo las recientes: la confirmación trae el enlace de pago y el de la videollamada.
 */
async function findRepeatedBooking(
  db: Db,
  business: Business,
  serviceId: string,
  data: { documentId: string; date: string; startTime: string; isVirtual: boolean; homeVisit: unknown; professionalId: string | null },
): Promise<(Appointment & { clientEmail: string }) | null> {
  const chosen = business.bookingSettings.chooseProfessional !== false ? data.professionalId : null;
  return one<Appointment & { clientEmail: string }>(
    db,
    `select ${appointmentColumns("a")}, c.email as "clientEmail"
       from appointments a join clients c on c.id = a.client_id
      where a.business_id = $1 and c.document_id = $2 and c.document_id <> ''
        and a.service_id = $3 and a.date = $4 and a.start_time = $5
        and a.status in ('pending', 'confirmed') and a.source = 'booking_page'
        and a.is_virtual = $6 and (a.home_visit is not null) = $7
        and ($8::text is null or a.professional_id::text = $8)
        and a.created_at > now() - make_interval(mins => $9)
      order by a.created_at desc
      limit 1`,
    [business.id, data.documentId, serviceId, data.date, data.startTime, data.isVirtual, Boolean(data.homeVisit), chosen, REPEATED_BOOKING_MINUTES],
  );
}

/** Lo que ve el paciente al reservar (y otra vez si repite la misma reserva). */
function toConfirmation(
  appointment: Appointment,
  context: { business: Business; service: Service; professional: Professional; clientEmail: string; emailSent: boolean },
): BookingConfirmation {
  const { business, service, professional } = context;
  return {
    appointmentId: appointment.id,
    serviceName: service.name,
    professionalId: professional.id,
    professionalName: professional.displayName,
    businessName: business.name,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    price: appointment.price,
    showPrice: isPriceVisible(service),
    homeVisit: appointment.homeVisit,
    isVirtual: appointment.isVirtual,
    // La sala del profesional: el paciente la recibe al reservar (no sale en la página pública).
    meetingUrl: appointment.isVirtual ? professional.meetingUrl || null : null,
    clientEmail: context.clientEmail,
    emailSent: context.emailSent,
    // Pago por transferencia: los datos de la agenda y el enlace para subir el comprobante.
    payment:
      professional.bankAccount && appointment.price > 0
        ? { bankAccount: professional.bankAccount, token: appointment.paymentToken, receiptsEnabled: Boolean(receiptStorage) }
        : null,
  };
}

/* Lo que ve la página pública: nada de datos internos (propietario, avisos, plantillas clínicas…). */

function toPublicBusiness({
  ownerId: _owner,
  status: _status,
  notificationSettings: _notifications,
  clinicalRecordsEnabled: _clinical,
  clinicalDefaultTemplateId: _template,
  createdAt: _created,
  ...business
}: Business): PublicBusiness {
  return business;
}

/** Sin su cuenta, su email ni sus avisos. */
function toPublicProfessional(professional: Professional): PublicProfessional {
  const { id, displayName, title, avatarUrl, allServices, serviceIds } = professional;
  return { id, displayName, title, avatarUrl, allServices, serviceIds };
}

/** Con el precio oculto, ni el precio ni el recargo a domicilio salen del servidor. */
function toPublicService({ clinicalTemplateId: _template, isActive: _active, createdAt: _created, ...service }: Service): PublicService {
  return isPriceVisible(service) ? service : { ...service, price: 0, homeVisitFee: 0 };
}

function toPublicBlockedTime({ reason: _reason, createdAt: _created, ...block }: BlockedTime): PublicBlockedTime {
  return block;
}

/** "María López Vera" → "María L." (para saludar sin exponer el nombre completo). */
export function greetingName(name: string): string {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
}

/** "maria.lopez@gmail.com" → "ma***@gmail.com" */
function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return domain ? `${user.slice(0, 2)}***@${domain}` : "";
}

/** Al cliente final no se le habla de "planes": se le pide contactar al negocio. */
async function withPublicLimitMessage(check: () => Promise<void>) {
  try {
    await check();
  } catch (error) {
    if (error instanceof AppError && error.code === "plan_limit") {
      throw new AppError(
        "plan_limit",
        "Este negocio no puede recibir más reservas online este mes. Contáctalo directamente para agendar.",
      );
    }
    throw error;
  }
}

export const publicBookingService = {
  /**
   * ¿La cédula ya es de un cliente del negocio? Sólo devuelve un nombre para saludar: nunca
   * email, teléfono ni dirección (la ruta tiene además límite de intentos).
   */
  async lookupClient(slug: string, input: unknown): Promise<PublicClientLookup> {
    const { documentId } = parseInput(clientLookupSchema, input);
    const found = await findActiveBusiness(pool, slug);
    if (!found) throw new AppError("not_found", "Esta página de reservas no está disponible.");
    const documentError = documentIdError(documentId, found.business.timezone);
    if (documentError) throw new AppError("validation", documentError);
    const client = await findClientByDocument(pool, found.business.id, documentId);
    return { found: Boolean(client), greetingName: client ? greetingName(client.name) : null };
  },

  /** Sólo los profesionales activos y los servicios que alguno de ellos atiende. */
  async getProfile(slug: string): Promise<PublicBusinessProfile | null> {
    const found = await findActiveBusiness(pool, slug);
    if (!found) return null;
    const { business, professionals } = found;
    const active = new Set(professionals.map((professional) => professional.id));
    const today = getZonedNow(business.timezone).date;
    const services = await many<Service>(
      pool,
      `select ${serviceColumns()} from services where business_id = $1 and is_active order by created_at, name`,
      [business.id],
    );
    const publicProfessionals = professionals.map(toPublicProfessional);
    return {
      business: toPublicBusiness(business),
      professionals: publicProfessionals,
      professional: publicProfessionals[0],
      services: services
        .filter((service) => professionals.some((professional) => offersService(professional, service.id)))
        .map(toPublicService),
      schedules: (await listSchedules(pool, business.id)).filter((schedule) => active.has(schedule.professionalId)),
      blockedTimes: (await blockedTimesFrom(pool, business.id, today))
        .filter((block) => block.professionalId === null || active.has(block.professionalId))
        .map(toPublicBlockedTime),
      busySlots: (await busySlots(pool, business.id, today)).filter((slot) => active.has(slot.professionalId)),
      captchaSiteKey: config.turnstile?.siteKey ?? null,
    };
  },

  /** Revalida la disponibilidad y el plan, crea o reutiliza el cliente (por email), crea la cita y envía emails. */
  async book(slug: string, input: unknown): Promise<BookingConfirmation> {
    const data = parseInput(publicBookingSchema, input);
    return transaction(async (db) => {
      const found = await findActiveBusiness(db, slug);
      if (!found) throw new AppError("not_found", "Esta página de reservas no está disponible.");
      const { business, professionals } = found;
      // Dos clientes que reservan la misma hora a la vez: el segundo espera y ve la hora ocupada.
      await lockBusiness(db, business.id);

      const service = await one<Service>(
        db,
        `select ${serviceColumns()} from services where id::text = $1 and business_id = $2 and is_active`,
        [data.serviceId, business.id],
      );
      if (!service) throw new AppError("not_found", "El servicio ya no está disponible.");
      // La modalidad debe ser una de las que admite el servicio.
      const mode = data.isVirtual ? "virtual" : data.homeVisit ? "home" : "business";
      if (!service.modes.includes(mode)) {
        throw new AppError(
          "validation",
          mode === "home"
            ? "Este servicio no se realiza a domicilio."
            : mode === "virtual"
              ? "Este servicio no se atiende por videollamada."
              : service.modes.includes("home")
                ? "Marca en el mapa dónde será la visita a domicilio."
                : "Elige cómo quieres la cita.",
        );
      }

      // Reintento de una reserva que ya se hizo: la misma confirmación, sin otra cita ni más emails.
      const repeated = await findRepeatedBooking(db, business, service.id, data);
      if (repeated) {
        const { clientEmail, ...appointment } = repeated;
        const emailSent = await one(
          db,
          "select 1 from notifications where appointment_id = $1 and type in ('booking_created', 'appointment_confirmed')",
          [appointment.id],
        );
        return toConfirmation(appointment, {
          business,
          service,
          professional:
            professionals.find((option) => option.id === appointment.professionalId) ??
            (await findProfessional(db, business.id, appointment.professionalId)),
          // Su email completo sólo si lo acaba de escribir él mismo.
          clientEmail: data.email && data.email === clientEmail ? clientEmail : maskEmail(clientEmail),
          emailSent: Boolean(emailSent),
        });
      }

      // Con quién: el que eligió el paciente (si el negocio lo permite) o el primero libre a esa hora.
      const candidates = professionals.filter((professional) => offersService(professional, service.id));
      if (candidates.length === 0) throw new AppError("not_found", "El servicio ya no está disponible.");
      let options = candidates;
      if (data.professionalId && business.bookingSettings.chooseProfessional !== false) {
        const chosen = candidates.find((professional) => professional.id === data.professionalId);
        if (!chosen) throw new AppError("not_found", "Ese profesional ya no atiende este servicio. Por favor elige otro.");
        options = [chosen];
      } else {
        options = await byLoadOnDate(db, business.id, candidates, data.date);
      }
      const availability = {
        schedules: await listSchedules(db, business.id),
        busySlots: await busySlots(db, business.id, data.date, data.date),
        blockedTimes: await blockedTimesFrom(db, business.id, data.date, data.date),
        settings: business.bookingSettings,
        now: getZonedNow(business.timezone),
      };
      const professional = options.find((option) =>
        isSlotAvailable(data.date, data.startTime, service.durationMinutes, scopeToProfessional(availability, option.id)),
      );
      if (!professional) throw new AppError("conflict", "Esa hora acaba de ocuparse. Por favor elige otra.");
      await withPublicLimitMessage(() => assertAppointmentLimit(db, business.id, data.date));

      // El cliente se identifica con su cédula: si ya existe en el negocio se reutiliza (sin tocar
      // sus datos de contacto); si no, se crea con los datos del formulario.
      const documentError = documentIdError(data.documentId, business.timezone);
      if (documentError) throw new AppError("validation", documentError);
      let client = await findClientByDocument(db, business.id, data.documentId);
      const knownClient = Boolean(client);
      if (!client) {
        const contact = parseInput(newClientContactSchema, data);
        // Cliente antiguo sin cédula con el mismo email y el mismo nombre: se le añade la cédula en lugar
        // de duplicarlo. Con otro nombre es otra persona (una madre y su hijo con un solo email): se crea
        // aparte, para no mezclar sus citas ni sus historias clínicas.
        const legacy = (
          await many<Client>(
            db,
            `select ${clientColumns()} from clients where business_id = $1 and email = $2 and document_id = ''`,
            [business.id, contact.email],
          )
        ).filter((candidate) => normalizePersonName(candidate.name) === normalizePersonName(contact.name));
        if (legacy.length === 1) {
          client = (await one<Client>(
            db,
            `update clients set document_id = $2 where id = $1 returning ${clientColumns()}`,
            [legacy[0].id, data.documentId],
          ))!;
        } else {
          await withPublicLimitMessage(() => assertClientLimit(db, business.id));
          client = (await one<Client>(
            db,
            `insert into clients (business_id, name, document_id, email, phone, address)
             values ($1, $2, $3, $4, $5, $6)
             returning ${clientColumns()}`,
            [business.id, contact.name, data.documentId, contact.email, contact.phone, data.homeVisit?.address ?? ""],
          ))!;
        }
      }
      await assertClientDailyLimit(db, business, client.id, data.date);
      if (!client.address && data.homeVisit) {
        // La dirección de la visita queda en la ficha del cliente si aún no tenía una.
        await db.query("update clients set address = $2 where id = $1", [client.id, data.homeVisit.address]);
      }

      const appointment = (await one<Appointment>(
        db,
        `insert into appointments
           (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, notes, price,
            home_visit, is_virtual, source)
         values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, 'booking_page')
         returning ${appointmentColumns()}`,
        [
          business.id,
          client.id,
          service.id,
          professional.id,
          data.date,
          data.startTime,
          addMinutesToTime(data.startTime, service.durationMinutes),
          data.notes,
          // A domicilio se suma el recargo del servicio.
          service.price + (data.homeVisit ? service.homeVisitFee : 0),
          data.homeVisit ? JSON.stringify(data.homeVisit) : null,
          data.isVirtual,
        ],
      ))!;
      const emailSent = await notifyAppointmentChange(db, null, appointment, "booking_page");
      await logAudit(db, {
        businessId: business.id,
        actor: null,
        action: "appointment.booked_online",
        entityType: "appointment",
        entityId: appointment.id,
        summary: `Nueva reserva online de ${await describeAppointment(db, appointment)}`,
      });

      return toConfirmation(appointment, {
        business,
        service,
        professional,
        // A quien reservó con la cédula de un cliente existente no se le muestra su email completo.
        clientEmail: knownClient ? maskEmail(client.email) : client.email,
        emailSent,
      });
    });
  },
};
