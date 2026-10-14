import { appointmentColumns, blockedTimeColumns, businessColumns, clientColumns, serviceColumns } from "../db/columns.ts";
import { config } from "../config.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { isSlotAvailable, offersService, scopeToProfessional } from "../shared/lib/availability.ts";
import { DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY, getTimezoneInfo } from "../shared/lib/constants/business.ts";
import { isPriceVisible } from "../shared/lib/format.ts";
import { addMinutesToTime, getZonedNow } from "../shared/lib/time.ts";
import { documentIdError } from "../shared/lib/identity.ts";
import { clientLookupSchema, publicBookingSchema, type BookingPerson } from "../shared/lib/validations/booking.ts";
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
import { saveExtraClients } from "./appointment-clients.ts";
import { describeAppointment, logAudit } from "./audit.ts";
import { withLegacyBankAccount } from "./bank-accounts.ts";
import { lockBusiness, parseInput } from "./context.ts";
import { listSchedules, peopleFor } from "./business-data-service.ts";
import { receiptStorage } from "./file-storage.ts";
import { notifyAppointmentChange } from "./notifications.ts";
import { assertAppointmentLimit, assertClientLimit, planOf } from "./plan-limits.ts";
import { findProfessional, listProfessionals } from "./professional-service.ts";

/**
 * Página pública de reservas (/book/:slug), sin sesión. Sólo expone lo necesario:
 * las citas ocupadas se devuelven como franjas horarias, sin datos de otros clientes.
 *
 * Nada de la página dice si una cédula es de un paciente del negocio (la cédula es casi pública: de
 * un psicólogo, eso ya es un dato sensible). El paciente escribe siempre todos sus datos y la reserva
 * sólo se une a una ficha existente si coinciden su email o su teléfono. Si no coinciden, la reserva
 * sale igual que con una cédula nueva y queda «Por verificar» (spec 009): ni la respuesta, ni los
 * emails, ni los topes, ni la hora ocupada dejan saber que la cédula ya era de alguien.
 */

/**
 * Reservas online que recibe un negocio como mucho en 24 h, y clientes nuevos que la página le crea:
 * con cédulas inventadas (el algoritmo es público) un robot podía llenar la agenda o agotar el cupo
 * del plan. Lo normal está muy por debajo; quien llegue al tope reserva por WhatsApp.
 */
export const ONLINE_BOOKINGS_PER_DAY = 30;
export const ONLINE_NEW_CLIENTS_PER_DAY = 15;

const ONLINE_DAILY_LIMIT_MESSAGE =
  "Este negocio no puede recibir más reservas online por hoy. Escríbele por WhatsApp para agendar tu cita.";

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
 * activas de ese día, también las que agendó el profesional y las sesiones en pareja o en familia en
 * las que va como otra paciente. Va dentro de la transacción, después de lockBusiness: dos reservas a
 * la vez de la misma persona no se cuelan juntas. `otherName`: la otra persona de una reserva en
 * pareja, como la escribió quien reserva (null: quien reserva).
 */
async function assertClientDailyLimit(
  db: Db,
  business: Business,
  clientId: string,
  date: string,
  otherName: string | null = null,
): Promise<void> {
  const limit = business.bookingSettings.maxClientBookingsPerDay ?? DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY;
  if (limit <= 0) return;
  const sameDay = await one<{ count: number }>(
    db,
    `select count(*)::int as count from appointments a
      where a.business_id = $1 and a.date = $3 and a.status in ('pending', 'confirmed', 'completed')
        and (a.client_id = $2
             or exists (select 1 from appointment_clients ac where ac.appointment_id = a.id and ac.client_id = $2))`,
    [business.id, clientId, date],
  );
  if ((sameDay?.count ?? 0) < limit) return;
  const count = limit === 1 ? "una cita" : `${limit} citas`;
  throw new AppError(
    "daily_limit",
    otherName === null
      ? `Ya tienes ${count} ese día con ${business.name}. Si necesitas otra, escríbele al negocio o elige otro día.`
      : `${otherName} ya tiene ${count} ese día con ${business.name}. Si necesitan otra, escríbanle al negocio o elijan otro día.`,
  );
}

/** "María  López" y "maria lopez" son el mismo nombre: sin tildes, mayúsculas ni espacios de más. */
export function normalizePersonName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Teléfono comparable: el número internacional sólo con dígitos. "+593 99 123 4567", "099 123 4567"
 * y "+593 099…" son el mismo número en un negocio de Ecuador (los que no traen prefijo toman el de su país).
 */
export function comparablePhone(phone: string, timezone: string): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  const code = getTimezoneInfo(timezone).callingCode;
  if (!trimmed.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (!digits.startsWith(code)) digits = code + digits.replace(/^0+/, "");
  }
  // El 0 de la marcación nacional sobra después del prefijo del país.
  return digits.startsWith(code) ? code + digits.slice(code.length).replace(/^0+/, "") : digits;
}

/**
 * ¿Es la persona de la ficha? Basta con que coincida el email o el teléfono guardados (sin
 * mayúsculas, espacios ni formato). Una ficha sin email ni teléfono no se puede confirmar.
 */
function sameContact(stored: { email: string; phone: string }, typed: { email: string; phone: string }, timezone: string): boolean {
  const email = stored.email.trim().toLowerCase();
  if (email !== "" && email === typed.email.trim().toLowerCase()) return true;
  return samePhone(stored.phone, typed.phone, timezone);
}

/** El mismo teléfono, escrito como sea. Al menos 7 dígitos además del prefijo: uno vacío nunca coincide. */
function samePhone(stored: string, typed: string, timezone: string): boolean {
  const phone = comparablePhone(stored, timezone);
  return phone.length >= getTimezoneInfo(timezone).callingCode.length + 7 && phone === comparablePhone(typed, timezone);
}

/** El email de la ficha sólo vuelve en la confirmación si es el que acaba de escribir el paciente. */
const shownEmail = (stored: string, typed: string) => (stored.trim().toLowerCase() === typed.trim().toLowerCase() ? stored : "");

/**
 * Tope de reservas online del negocio en 24 h (las de cualquier estado, también las canceladas). En
 * un plan con cupo mensual de citas, como mucho una cuarta parte del cupo al día (Free: 5): un robot
 * no lo agota en una tarde.
 */
async function assertOnlineBookingLimit(db: Db, businessId: string): Promise<void> {
  const { limits } = await planOf(db, businessId);
  const limit =
    limits.appointmentsPerMonth === null
      ? ONLINE_BOOKINGS_PER_DAY
      : Math.min(ONLINE_BOOKINGS_PER_DAY, Math.max(1, Math.ceil(limits.appointmentsPerMonth / 4)));
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from appointments
      where business_id = $1 and source = 'booking_page' and created_at between now() - interval '24 hours' and now()`,
    [businessId],
  );
  if ((row?.count ?? 0) >= limit) throw new AppError("rate_limited", ONLINE_DAILY_LIMIT_MESSAGE);
}

/** Tope de clientes nuevos que la página de reservas crea en un negocio en 24 h. */
async function assertOnlineNewClientLimit(db: Db, businessId: string): Promise<void> {
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from clients
      where business_id = $1 and source = 'booking_page' and created_at between now() - interval '24 hours' and now()`,
    [businessId],
  );
  if ((row?.count ?? 0) >= ONLINE_NEW_CLIENTS_PER_DAY) throw new AppError("rate_limited", ONLINE_DAILY_LIMIT_MESSAGE);
}

/**
 * La cédula con la que se reservó: la del paciente o, si está «Por verificar» (sin cédula propia), la
 * de la ficha que reclama. Así el reintento de una reserva por verificar se reconoce igual que el de
 * una con cédula nueva (spec 009).
 */
const EFFECTIVE_DOCUMENT = (alias: string) =>
  `coalesce(nullif(${alias}.document_id, ''), (select claimed.document_id from clients claimed where claimed.id = ${alias}.claimed_client_id), '')`;

/** Cuánto después de una reserva se reconoce su reintento (ver findRepeatedBooking). */
const REPEATED_BOOKING_MINUTES = 30;

/**
 * La misma reserva otra vez: se perdió la respuesta (mala conexión) y el paciente volvió a
 * confirmar. Su propia cita ocupa esa hora, así que se busca una cita activa reservada online hace
 * poco con su cédula y el mismo servicio, fecha, hora y modalidad (y el mismo profesional, si lo
 * eligió), y con las mismas otras personas (sus cédulas, en cualquier orden; ninguna en una cita
 * individual). Sólo las recientes, y sólo si coinciden el email o el teléfono (ver book).
 */
async function findRepeatedBooking(
  db: Db,
  business: Business,
  serviceId: string,
  data: {
    documentId: string;
    date: string;
    startTime: string;
    isVirtual: boolean;
    homeVisit: unknown;
    professionalId: string | null;
    extraPatients: { documentId: string }[];
  },
): Promise<(Appointment & { clientEmail: string; clientPhone: string }) | null> {
  const chosen = business.bookingSettings.chooseProfessional !== false ? data.professionalId : null;
  return one<Appointment & { clientEmail: string; clientPhone: string }>(
    db,
    `select ${appointmentColumns("a")}, c.email as "clientEmail", c.phone as "clientPhone"
       from appointments a join clients c on c.id = a.client_id
      where a.business_id = $1 and ${EFFECTIVE_DOCUMENT("c")} = $2
        and a.service_id = $3 and a.date = $4 and a.start_time = $5
        and a.status in ('pending', 'confirmed') and a.source = 'booking_page'
        and a.is_virtual = $6 and (a.home_visit is not null) = $7
        and ($8::text is null or a.professional_id::text = $8)
        and a.created_at > now() - make_interval(mins => $9)
        and coalesce((select array_agg(${EFFECTIVE_DOCUMENT("ec")} order by ${EFFECTIVE_DOCUMENT("ec")})
                        from appointment_clients ac join clients ec on ec.id = ac.client_id
                       where ac.appointment_id = a.id), '{}')
            = coalesce((select array_agg(doc order by doc) from unnest($10::text[]) doc), '{}')
      order by a.created_at desc
      limit 1`,
    [
      business.id,
      data.documentId,
      serviceId,
      data.date,
      data.startTime,
      data.isVirtual,
      Boolean(data.homeVisit),
      chosen,
      REPEATED_BOOKING_MINUTES,
      data.extraPatients.map((person) => person.documentId),
    ],
  );
}

/**
 * La persona de la reserva por su cédula, como siempre: si ya existe en el negocio, sólo se reutiliza
 * (sin tocar sus datos de contacto) si coinciden su email o su teléfono. Si no coinciden, la reserva
 * sigue como la de una cédula nueva, pero con un paciente «Por verificar» aparte (ver
 * resolveClaimingClient): nadie de fuera sabe que la cédula ya era de alguien, ni llega nada a esa
 * ficha. Si la cédula no existe, se crea (con los topes de pacientes nuevos del día y del plan). Vale
 * igual para quien reserva y para las otras personas de una sesión en pareja o en familia
 * (`otherName`: cómo la escribió quien reserva; null: quien reserva).
 */
async function resolveBookingClient(
  db: Db,
  business: Business,
  person: BookingPerson,
  options: { otherName: string | null; address: string },
): Promise<Client> {
  const { otherName } = options;
  const documentError = documentIdError(person.documentId, business.timezone);
  if (documentError) throw new AppError("validation", otherName === null ? documentError : `${otherName}: ${documentError}`);
  const found = await findClientByDocument(db, business.id, person.documentId);
  if (found) {
    if (sameContact(found, person, business.timezone)) return found;
    return resolveClaimingClient(db, business, found, person, options.address);
  }
  // Cliente antiguo sin cédula con el mismo nombre, email y teléfono: se le añade la cédula en lugar
  // de duplicarlo. Con otro nombre es otra persona (una madre y su hijo con un solo email): se crea
  // aparte, para no mezclar sus citas ni sus historias clínicas. Sin el teléfono, quien conociera su
  // email y su nombre le pondría una cédula inventada (spec 009). Los «Por verificar» no cuentan.
  const legacy = (
    await many<Client>(
      db,
      `select ${clientColumns()} from clients
        where business_id = $1 and lower(email) = $2 and document_id = '' and claimed_client_id is null`,
      [business.id, person.email],
    )
  ).filter(
    (candidate) =>
      normalizePersonName(candidate.name) === normalizePersonName(person.name) && samePhone(candidate.phone, person.phone, business.timezone),
  );
  if (legacy.length === 1) {
    return (await one<Client>(db, `update clients set document_id = $2 where id = $1 returning ${clientColumns()}`, [
      legacy[0].id,
      person.documentId,
    ]))!;
  }
  return insertBookingClient(db, business, person, { documentId: person.documentId, address: options.address, claimedClientId: null });
}

/**
 * «Por verificar» (spec 009): la cédula es de `claimed`, pero no coinciden ni su email ni su teléfono.
 * Antes se rechazaba la reserva, y ese rechazo decía que la cédula era de un paciente (de un
 * psicólogo, eso ya es un dato de salud). Ahora la reserva sale como la de una cédula nueva, con un
 * paciente aparte: sin cédula, con los datos que se escribieron y apuntando a la ficha, que no se toca
 * ni recibe nada. Los mismos topes de pacientes nuevos; si la misma persona vuelve a reservar con los
 * mismos datos, el mismo paciente aparte (como se reutiliza la ficha de una cédula nueva). El negocio
 * lo une a la ficha o cancela la cita (clientService.confirmClaim).
 */
async function resolveClaimingClient(db: Db, business: Business, claimed: Client, person: BookingPerson, address: string): Promise<Client> {
  const previous = (
    await many<Client>(db, `select ${clientColumns()} from clients where business_id = $1 and claimed_client_id = $2 order by created_at`, [
      business.id,
      claimed.id,
    ])
  ).find((candidate) => sameContact(candidate, person, business.timezone));
  if (previous) return previous;
  return insertBookingClient(db, business, person, { documentId: "", address, claimedClientId: claimed.id });
}

/** Paciente nuevo de la página de reservas, con los topes de pacientes nuevos del día y del plan. */
async function insertBookingClient(
  db: Db,
  business: Business,
  person: BookingPerson,
  options: { documentId: string; address: string; claimedClientId: string | null },
): Promise<Client> {
  await assertOnlineNewClientLimit(db, business.id);
  await withPublicLimitMessage(() => assertClientLimit(db, business.id));
  return (await one<Client>(
    db,
    `insert into clients (business_id, name, document_id, email, phone, address, source, claimed_client_id)
     values ($1, $2, $3, $4, $5, $6, 'booking_page', $7)
     returning ${clientColumns()}`,
    [business.id, person.name, options.documentId, person.email, person.phone, options.address, options.claimedClientId],
  ))!;
}

/**
 * Lo que ve el paciente al reservar (y otra vez si repite la misma reserva). En un reintento
 * (`repeated`) no van los datos ni el enlace de pago: los recibió por email con la confirmación.
 */
function toConfirmation(
  appointment: Appointment,
  context: { business: Business; service: Service; professional: Professional; clientEmail: string; emailSent: boolean; repeated: boolean },
): BookingConfirmation {
  const { business, service, professional } = context;
  const paysByTransfer = professional.bankAccounts.length > 0 && appointment.price > 0;
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
    // Pago por transferencia: todas las cuentas de la agenda (vale cualquiera) y el enlace para subir el comprobante.
    payment:
      paysByTransfer && !context.repeated
        ? { ...withLegacyBankAccount(professional.bankAccounts), token: appointment.paymentToken, receiptsEnabled: Boolean(receiptStorage) }
        : null,
    paymentByEmail: paysByTransfer && context.repeated,
  };
}

/* Lo que ve la página pública: nada de datos internos (propietario, avisos, plantillas clínicas…). */

function toPublicBusiness({
  ownerId: _owner,
  status: _status,
  notificationSettings: _notifications,
  clinicalRecordsEnabled: _clinical,
  clinicalDefaultTemplateId: _template,
  professionalScope: _scope,
  clientRequiredFields: _required,
  multiClientAppointments: _multiClient,
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

/**
 * Con el precio oculto, ni el precio ni el recargo a domicilio salen del servidor. Las personas por
 * sesión, con su valor efectivo: 1 si el negocio no tiene las citas con varios pacientes.
 */
function toPublicService(
  business: Business,
  { isActive: _active, createdAt: _created, ...service }: Service,
): PublicService {
  const shown = { ...service, peoplePerSession: peopleFor(business, service) };
  return isPriceVisible(shown) ? shown : { ...shown, price: 0, homeVisitFee: 0 };
}

function toPublicBlockedTime({ reason: _reason, createdAt: _created, ...block }: BlockedTime): PublicBlockedTime {
  return block;
}

/** "María López Vera" → "María L." (para saludar sin exponer el nombre completo). */
export function greetingName(name: string): string {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
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
   * Búsqueda por cédula de las versiones anteriores de la página: sólo comprueba el formato y
   * responde siempre lo mismo, sea o no cliente (antes devolvía su nombre para saludarlo).
   */
  async lookupClient(slug: string, input: unknown): Promise<PublicClientLookup> {
    const { documentId } = parseInput(clientLookupSchema, input);
    const found = await findActiveBusiness(pool, slug);
    if (!found) throw new AppError("not_found", "Esta página de reservas no está disponible.");
    const documentError = documentIdError(documentId, found.business.timezone);
    if (documentError) throw new AppError("validation", documentError);
    return { found: false, greetingName: null };
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
        .map((service) => toPublicService(business, service)),
      schedules: (await listSchedules(pool, business.id)).filter((schedule) => active.has(schedule.professionalId)),
      blockedTimes: (await blockedTimesFrom(pool, business.id, today))
        .filter((block) => block.professionalId === null || active.has(block.professionalId))
        .map(toPublicBlockedTime),
      busySlots: (await busySlots(pool, business.id, today)).filter((slot) => active.has(slot.professionalId)),
      captchaSiteKey: config.turnstile?.siteKey ?? null,
    };
  },

  /**
   * Revalida la disponibilidad, los topes del día y el plan, reutiliza el cliente de la cédula (si
   * coinciden su email o su teléfono) o lo crea, crea la cita y envía los emails. En un servicio para
   * 2 o 3 personas (spec 005), lo mismo con cada una: quien reserva es el paciente principal y las
   * demás quedan como los otros pacientes de la cita. Todo o nada: si algo falla, no se crea nadie.
   */
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

      // Personas por sesión: las del servicio, si el negocio tiene las citas con varios pacientes.
      const people = peopleFor(business, service);
      const missing = people - 1 - data.extraPatients.length;
      if (missing < 0) {
        throw new AppError("validation", people === 1 ? "Este servicio es para una persona." : `Este servicio es para ${people} personas.`);
      }
      if (missing > 0) {
        // Una página abierta antes de que el servicio fuera para varias personas: no las pidió.
        const who = people === 2 ? "la otra persona" : missing === 2 ? "las otras dos personas" : "una de las personas";
        throw new AppError(
          "validation",
          `Este servicio es para ${people} personas: faltan los datos de ${who}. Recarga la página e inténtalo de nuevo.`,
        );
      }

      // Reintento de una reserva que ya se hizo: la misma confirmación, sin otra cita ni más emails.
      // Con otro email y otro teléfono no es su reserva: sigue como una nueva (y esa hora está ocupada).
      const repeated = await findRepeatedBooking(db, business, service.id, data);
      if (repeated && sameContact({ email: repeated.clientEmail, phone: repeated.clientPhone }, data, business.timezone)) {
        const { clientEmail, clientPhone: _phone, ...appointment } = repeated;
        const emailSent = await one(
          db,
          "select 1 from notifications where appointment_id = $1 and type in ('booking_created', 'appointment_confirmed') and status <> 'failed'",
          [appointment.id],
        );
        return toConfirmation(appointment, {
          business,
          service,
          professional:
            professionals.find((option) => option.id === appointment.professionalId) ??
            (await findProfessional(db, business.id, appointment.professionalId)),
          clientEmail: shownEmail(clientEmail, data.email),
          emailSent: Boolean(emailSent),
          repeated: true,
        });
      }
      await assertOnlineBookingLimit(db, business.id);

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

      // Cada persona se identifica con su cédula (ver resolveBookingClient): primero quien reserva.
      const client = await resolveBookingClient(db, business, data, { otherName: null, address: data.homeVisit?.address ?? "" });
      await assertClientDailyLimit(db, business, client.id, data.date);
      if (!client.address && data.homeVisit) {
        // La dirección de la visita queda en la ficha del cliente si aún no tenía una.
        await db.query("update clients set address = $2 where id = $1", [client.id, data.homeVisit.address]);
      }
      const extraClientIds: string[] = [];
      for (const person of data.extraPatients) {
        const extra = await resolveBookingClient(db, business, person, { otherName: person.name, address: "" });
        if (extra.id === client.id || extraClientIds.includes(extra.id)) {
          throw new AppError("validation", "Cada persona debe tener su propia cédula.");
        }
        await assertClientDailyLimit(db, business, extra.id, data.date, person.name);
        extraClientIds.push(extra.id);
      }

      const created = (await one<Appointment>(
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
      // Las otras personas, antes de los avisos (cada una recibe el suyo).
      const appointment = extraClientIds.length ? await saveExtraClients(db, created, extraClientIds, []) : created;
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
        clientEmail: shownEmail(client.email, data.email),
        emailSent,
        repeated: false,
      });
    });
  },
};
