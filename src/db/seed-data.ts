/**
 * Generador de los datos de demostración (adaptado de agenda-beta: src/lib/data/mock/seed.ts).
 * Construye todo en memoria con fechas relativas a hoy; `npm run db:seed` lo inserta en PostgreSQL.
 */
import { DEFAULT_CURRENCY, DEFAULT_SUPPORT_EMAIL, DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import {
  DEFAULT_BOOKING_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "../shared/lib/constants/business.ts";
import { getPlan } from "../shared/lib/constants/plans.ts";
import {
  addDaysISO,
  getDayOfWeek,
  getZonedNow,
  isPast,
  minutesToTime,
  rangesOverlap,
  timeToMinutes,
  type ZonedNow,
} from "../shared/lib/time.ts";
import type {
  Appointment,
  AppointmentStatus,
  AuditLog,
  BlockedTime,
  Business,
  BusinessCategory,
  BusinessRole,
  BusinessStatus,
  BusinessUser,
  Client,
  ClinicalNote,
  ClinicalNoteData,
  ClinicalProfile,
  DayOfWeek,
  HomeVisitAddress,
  ISODate,
  PlanId,
  PlatformSettings,
  Professional,
  Schedule,
  Service,
  ServiceLocation,
  Subscription,
  TimeRange,
  User,
} from "../shared/types/index.ts";
import type { AuditActor } from "../services/context.ts";

/** Categorías de salud de la migración 005 (historia clínica activada por defecto). */
const HEALTH_CATEGORIES = new Set(["psychology", "speech_therapy", "dentistry", "nutrition", "physiotherapy"]);
const isHealthCategory = (category: BusinessCategory) => HEALTH_CATEGORIES.has(category);

/** Cuenta demo principal (propietario) y super admin de los datos demo. */
const DEMO_ACCOUNT = { email: "jhordan@demo.com", password: "demo1234" } as const;
const SUPER_ADMIN_ACCOUNT = { email: "admin@demo.com", password: "demo1234" } as const;

/** Datos de demostración en memoria: cada colección es una tabla. */
export interface SeedDatabase {
  platformSettings: PlatformSettings;
  users: User[];
  /** Contraseñas en texto plano sólo aquí: seed.ts las guarda con hash. */
  credentials: { userId: string; email: string; password: string }[];
  businesses: Business[];
  businessUsers: BusinessUser[];
  professionals: Professional[];
  subscriptions: Subscription[];
  /** La cédula se asigna en seed.ts. */
  clients: Omit<Client, "documentId">[];
  services: Service[];
  appointments: Appointment[];
  schedules: Schedule[];
  blockedTimes: BlockedTime[];
  notifications: never[];
  auditLogs: Omit<AuditLog, "changes">[];
  clinicalProfiles: ClinicalProfile[];
  clinicalNotes: ClinicalNote[];
}

/**
 * Datos de demostración generados en relación con la fecha actual,
 * para que el panel siempre muestre citas de hoy, de esta semana y un historial.
 * Usa un generador pseudoaleatorio con semilla: los datos son estables.
 */

type ServiceSeed = [
  name: string,
  description: string,
  durationMinutes: number,
  price: number,
  isActive?: boolean,
  location?: ServiceLocation,
  homeVisitFee?: number,
];
/** Emails de clientes con el dominio reservado example.com: el servidor nunca les envía nada. */
type ClientSeed = [name: string, email: string, phone: string, notes?: string, isActive?: boolean, address?: string];
type MemberSeed = { firstName: string; lastName: string; email: string; role: Exclude<BusinessRole, "owner"> };
type FixedAppointment = [time: string, clientName: string, serviceName: string, status: AppointmentStatus];

interface TenantSeed {
  user: { firstName: string; lastName: string; email: string; phone: string };
  password: string;
  business: { name: string; slug: string; description: string; category: BusinessCategory; address: string };
  /** Centro aproximado de la ciudad del negocio (para las visitas a domicilio de ejemplo). */
  coordinates?: [lat: number, lng: number];
  plan: PlanId;
  /** Antigüedad del negocio (días). Por defecto 120. */
  createdDaysAgo?: number;
  /** true si lo dio de alta el super admin (si no, el dueño se registró solo). */
  createdByAdmin?: boolean;
  status?: BusinessStatus;
  members: MemberSeed[];
  professionalTitle: string;
  services: ServiceSeed[];
  clients: ClientSeed[];
  weeklyHours: Partial<Record<DayOfWeek, TimeRange[]>>;
  /** Probabilidad de ocupar cada hueco del horario (0–1). */
  load: number;
  blockedTimes: (today: ISODate) => Omit<BlockedTime, "id" | "businessId" | "createdAt">[];
  todayAppointments?: FixedAppointment[];
}

const SPLIT_DAY: TimeRange[] = [
  { start: "08:00", end: "13:00" },
  { start: "14:00", end: "18:00" },
];

const TENANTS: TenantSeed[] = [
  {
    user: { firstName: "Jhordan", lastName: "Huera", email: DEMO_ACCOUNT.email, phone: "+593 99 123 4567" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "Centro Profesional",
      slug: "jhordan",
      description:
        "Atención profesional personalizada con cita previa. Reserva tu espacio en minutos y recibe la confirmación al instante.",
      category: "professional_services",
      address: "Av. República de El Salvador N36-84, Quito",
    },
    plan: "pro",
    members: [
      { firstName: "Andrea", lastName: "Vásquez", email: "andrea@demo.com", role: "admin" },
      { firstName: "Miguel", lastName: "Ortega", email: "miguel@demo.com", role: "staff" },
    ],
    professionalTitle: "Especialista",
    services: [
      ["Consulta inicial", "Primera sesión para conocer tu caso y definir un plan de trabajo.", 60, 25],
      ["Seguimiento", "Revisión de avances y ajustes del plan.", 45, 20],
      ["Evaluación", "Evaluación completa con informe de resultados.", 90, 40],
      ["Sesión estándar", "Sesión individual de trabajo.", 60, 30],
      ["Sesión online", "Sesión por videollamada.", 45, 22, false],
      ["Visita a domicilio", "Atención en tu casa u oficina. Marca tu ubicación al reservar.", 60, 35, true, "home"],
    ],
    coordinates: [-0.1807, -78.4678],
    clients: [
      ["María López", "maria.lopez@example.com", "+593 98 765 4321", "Prefiere citas por la mañana.", true, "Av. 6 de Diciembre N24-12, Quito"],
      ["Carlos Pérez", "carlos.perez@example.com", "+593 99 234 5678"],
      ["Ana Torres", "ana.torres@example.com", "+593 97 345 6789", "Alérgica a la penicilina.", true, "Calle Juan León Mera 1234, Quito"],
      ["Daniel Gómez", "daniel.gomez@example.com", "+593 96 456 7890"],
      ["Sofía Martínez", "sofia.martinez@example.com", "+593 95 567 8901", "Viene referida por María López."],
      ["Luis Fernández", "luis.fernandez@example.com", "+593 99 678 9012"],
      ["Valentina Ruiz", "valentina.ruiz@example.com", "+593 98 789 0123"],
      ["Andrés Castillo", "andres.castillo@example.com", "+593 97 890 1234", "Solicita factura a nombre de su empresa."],
      ["Camila Herrera", "camila.herrera@example.com", "+593 96 901 2345"],
      ["Javier Morales", "javier.morales@example.com", "+593 95 012 3456"],
      ["Paula Vega", "paula.vega@example.com", "+593 99 111 2233", "Se mudó a otra ciudad.", false],
      ["Diego Salazar", "diego.salazar@example.com", "+593 98 222 3344"],
    ],
    weeklyHours: { 1: SPLIT_DAY, 2: SPLIT_DAY, 3: SPLIT_DAY, 4: SPLIT_DAY, 5: SPLIT_DAY, 6: [{ start: "09:00", end: "13:00" }] },
    load: 0.42,
    blockedTimes: (today) => {
      const dayOfWeek = getDayOfWeek(today);
      const nextFriday = addDaysISO(today, (5 - dayOfWeek + 7) % 7 || 7);
      return [
        { reason: "Trámite personal", startDate: nextFriday, endDate: nextFriday, allDay: false, startTime: "14:00", endTime: "16:00" },
        { reason: "Vacaciones", startDate: addDaysISO(today, 22), endDate: addDaysISO(today, 26), allDay: true, startTime: null, endTime: null },
      ];
    },
    todayAppointments: [
      ["09:00", "María López", "Consulta inicial", "confirmed"],
      ["10:30", "Carlos Pérez", "Seguimiento", "pending"],
      ["11:30", "Ana Torres", "Sesión estándar", "confirmed"],
      ["15:00", "Daniel Gómez", "Evaluación", "confirmed"],
      ["16:30", "Sofía Martínez", "Seguimiento", "pending"],
    ],
  },
  {
    user: { firstName: "Laura", lastName: "Méndez", email: "laura@demo.com", phone: "+593 98 555 0101" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "Estudio Bella",
      slug: "estudio-bella",
      description: "Salón de belleza: cortes, color y manicure en un ambiente tranquilo.",
      category: "beauty",
      address: "Calle Larga 7-45, Cuenca",
    },
    plan: "free",
    members: [],
    professionalTitle: "Estilista",
    services: [
      ["Corte de cabello", "Corte, lavado y secado.", 45, 15],
      ["Manicure", "Manicure clásico con esmaltado.", 60, 12],
      ["Tinte completo", "Coloración completa con productos profesionales.", 120, 45],
      ["Peinado para eventos", "Peinado y fijación para ocasiones especiales.", 60, 25],
    ],
    clients: [
      ["Lucía Ramírez", "lucia.ramirez@example.com", "+593 99 300 1001"],
      ["Fernanda Ortiz", "fernanda.ortiz@example.com", "+593 98 300 1002"],
      ["Gabriela Núñez", "gabriela.nunez@example.com", "+593 97 300 1003"],
      ["Isabel Cárdenas", "isabel.cardenas@example.com", "+593 96 300 1004"],
    ],
    weeklyHours: {
      2: [{ start: "10:00", end: "19:00" }],
      3: [{ start: "10:00", end: "19:00" }],
      4: [{ start: "10:00", end: "19:00" }],
      5: [{ start: "10:00", end: "19:00" }],
      6: [{ start: "09:00", end: "15:00" }],
    },
    load: 0.3,
    blockedTimes: () => [],
  },
  {
    user: { firstName: "Ricardo", lastName: "Paredes", email: "ricardo@demo.com", phone: "+593 99 410 2030" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "Clínica Dental Sonrisa",
      slug: "dental-sonrisa",
      description: "Odontología general, ortodoncia y estética dental.",
      category: "dentistry",
      address: "Av. 9 de Octubre 1520, Guayaquil",
    },
    plan: "business",
    createdDaysAgo: 75,
    createdByAdmin: true,
    members: [{ firstName: "Elena", lastName: "Suárez", email: "elena@demo.com", role: "staff" }],
    professionalTitle: "Odontólogo",
    services: [
      ["Limpieza dental", "Profilaxis y pulido.", 45, 35],
      ["Consulta odontológica", "Revisión y diagnóstico.", 30, 20],
      ["Blanqueamiento", "Blanqueamiento en consultorio.", 90, 120],
    ],
    clients: [
      ["Marco Jiménez", "marco.jimenez@example.com", "+593 99 501 0001"],
      ["Patricia Lara", "patricia.lara@example.com", "+593 98 501 0002"],
      ["Roberto Andrade", "roberto.andrade@example.com", "+593 97 501 0003"],
      ["Silvia Mora", "silvia.mora@example.com", "+593 96 501 0004"],
    ],
    weeklyHours: { 1: SPLIT_DAY, 2: SPLIT_DAY, 3: SPLIT_DAY, 4: SPLIT_DAY, 5: SPLIT_DAY },
    load: 0.18,
    blockedTimes: () => [],
  },
  {
    user: { firstName: "Tomás", lastName: "Aguirre", email: "tomas@demo.com", phone: "+593 98 620 3344" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "FisioActiva",
      slug: "fisioactiva",
      description: "Fisioterapia deportiva y rehabilitación.",
      category: "physiotherapy",
      address: "Av. Remigio Crespo 3-40, Cuenca",
    },
    plan: "pro",
    createdDaysAgo: 40,
    members: [],
    professionalTitle: "Fisioterapeuta",
    services: [
      ["Sesión de fisioterapia", "Tratamiento personalizado, en el centro o en tu casa.", 60, 30, true, "both", 10],
      ["Masaje deportivo", "Recuperación muscular.", 45, 25],
    ],
    clients: [
      ["Esteban Rojas", "esteban.rojas@example.com", "+593 99 702 0001"],
      ["Natalia Cruz", "natalia.cruz@example.com", "+593 98 702 0002"],
      ["Héctor Villacís", "hector.villacis@example.com", "+593 97 702 0003"],
    ],
    weeklyHours: {
      1: [{ start: "09:00", end: "18:00" }],
      3: [{ start: "09:00", end: "18:00" }],
      5: [{ start: "09:00", end: "18:00" }],
    },
    coordinates: [-2.9001, -79.0059],
    load: 0.2,
    blockedTimes: () => [],
  },
  {
    user: { firstName: "Daniela", lastName: "Ríos", email: "daniela@demo.com", phone: "+593 97 830 1122" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "NutriVida",
      slug: "nutrivida",
      description: "Planes de alimentación y seguimiento nutricional.",
      category: "nutrition",
      address: "",
    },
    plan: "free",
    createdDaysAgo: 9,
    createdByAdmin: true,
    members: [],
    professionalTitle: "Nutricionista",
    services: [["Consulta nutricional", "Evaluación y plan de alimentación.", 45, 25]],
    clients: [
      ["Gabriel Ponce", "gabriel.ponce@example.com", "+593 99 840 0001"],
      ["Mónica Erazo", "monica.erazo@example.com", "+593 98 840 0002"],
    ],
    weeklyHours: { 2: [{ start: "14:00", end: "19:00" }], 4: [{ start: "14:00", end: "19:00" }] },
    load: 0.25,
    blockedTimes: () => [],
  },
  {
    user: { firstName: "Carolina", lastName: "Vega", email: "carolina@demo.com", phone: "+593 96 910 5566" },
    password: DEMO_ACCOUNT.password,
    business: {
      name: "Psicóloga Carolina Vega",
      slug: "carolina-vega",
      description: "Terapia individual y de pareja.",
      category: "psychology",
      address: "Calle Bolívar 8-22, Loja",
    },
    plan: "free",
    createdDaysAgo: 150,
    status: "suspended",
    members: [],
    professionalTitle: "Psicóloga clínica",
    services: [["Sesión de terapia", "Sesión individual de 50 minutos.", 50, 30]],
    clients: [
      ["Fabián León", "fabian.leon@example.com", "+593 99 920 0001"],
      ["Rosa Chávez", "rosa.chavez@example.com", "+593 98 920 0002"],
    ],
    weeklyHours: { 1: [{ start: "15:00", end: "19:00" }], 3: [{ start: "15:00", end: "19:00" }] },
    load: 0.15,
    blockedTimes: () => [],
  },
];

/** Usuario que se registró pero no terminó el onboarding (aparece "sin negocio" en el panel de plataforma). */
const UNFINISHED_SIGNUP = { firstName: "Pedro", lastName: "Sánchez", email: "pedro@demo.com", phone: "" };

const APPOINTMENT_NOTES = [
  "Primera visita.",
  "Trae exámenes previos.",
  "Confirmó por teléfono.",
  "Llegará 10 minutos tarde.",
  "Pidió recordatorio por email.",
];

function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  return { next, pick };
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function randomStatus(isPastAppointment: boolean, roll: number): AppointmentStatus {
  if (isPastAppointment) return roll < 0.78 ? "completed" : roll < 0.9 ? "cancelled" : "no_show";
  return roll < 0.62 ? "confirmed" : roll < 0.95 ? "pending" : "cancelled";
}

function seedTenant(
  db: SeedDatabase,
  tenant: TenantSeed,
  now: ZonedNow,
  random: ReturnType<typeof createRandom>,
  superAdmin: AuditActor,
) {
  const userId = crypto.randomUUID();
  const businessId = crypto.randomUUID();
  const professionalId = crypto.randomUUID();
  const age = tenant.createdDaysAgo ?? 120;
  const createdAt = daysAgoISO(age);

  db.users.push({ id: userId, ...tenant.user, avatarUrl: null, platformRole: null, isActive: true, createdAt });
  db.credentials.push({ userId, email: tenant.user.email, password: tenant.password });
  db.businessUsers.push({ businessId, userId, role: "owner", clinicalAccess: true, createdAt });
  const ownerActor = { userId, name: `${tenant.user.firstName} ${tenant.user.lastName}`, role: "owner" as const };
  const planName = getPlan(tenant.plan).name;

  db.auditLogs.push(
    tenant.createdByAdmin
      ? {
          id: crypto.randomUUID(),
          businessId,
          actorId: superAdmin.userId,
          actorName: superAdmin.name,
          action: "platform.business_created",
          entityType: "business",
          entityId: businessId,
          summary: `Creó el negocio ${tenant.business.name} para ${ownerActor.name} con el plan ${planName}`,
          createdAt,
        }
      : {
          id: crypto.randomUUID(),
          businessId,
          actorId: userId,
          actorName: ownerActor.name,
          action: "business.created",
          entityType: "business",
          entityId: businessId,
          summary: `Creó el negocio ${tenant.business.name}`,
          createdAt,
        },
  );
  if (tenant.status === "suspended") {
    db.auditLogs.push({
      id: crypto.randomUUID(),
      businessId,
      actorId: superAdmin.userId,
      actorName: superAdmin.name,
      action: "platform.business_suspended",
      entityType: "business",
      entityId: businessId,
      summary: `Suspendió el negocio ${tenant.business.name}`,
      createdAt: daysAgoISO(4),
    });
  }

  for (const member of tenant.members) {
    const memberId = crypto.randomUUID();
    const joinedAt = daysAgoISO(Math.min(40, age - 1));
    db.users.push({ id: memberId, firstName: member.firstName, lastName: member.lastName, email: member.email, phone: "", avatarUrl: null, platformRole: null, isActive: true, createdAt: joinedAt });
    db.credentials.push({ userId: memberId, email: member.email, password: tenant.password });
    db.businessUsers.push({ businessId, userId: memberId, role: member.role, clinicalAccess: false, createdAt: joinedAt });
    db.auditLogs.push({
      id: crypto.randomUUID(),
      businessId,
      actorId: userId,
      actorName: ownerActor.name,
      action: "team.invited",
      entityType: "team",
      entityId: memberId,
      summary: `Invitó a ${member.firstName} ${member.lastName} como ${member.role === "admin" ? "Administrador" : "Staff"}`,
      createdAt: joinedAt,
    });
  }
  db.businesses.push({
    id: businessId,
    ownerId: userId,
    status: tenant.status ?? "active",
    ...tenant.business,
    timezone: DEFAULT_TIMEZONE,
    currency: DEFAULT_CURRENCY,
    logoUrl: null,
    phone: tenant.user.phone,
    email: tenant.user.email,
    // Local marcado en el mapa (aproximado: centro de la ciudad) si el negocio tiene dirección.
    lat: tenant.business.address && tenant.coordinates ? tenant.coordinates[0] : null,
    lng: tenant.business.address && tenant.coordinates ? tenant.coordinates[1] : null,
    bookingSettings: { ...DEFAULT_BOOKING_SETTINGS },
    notificationSettings: { ...DEFAULT_NOTIFICATION_SETTINGS },
    clinicalRecordsEnabled: isHealthCategory(tenant.business.category),
    clinicalDefaultTemplateId: null,
    createdAt,
  });
  db.professionals.push({
    id: professionalId,
    businessId,
    userId,
    displayName: `${tenant.user.firstName} ${tenant.user.lastName}`,
    title: tenant.professionalTitle,
    avatarUrl: null,
  });
  db.subscriptions.push({
    id: crypto.randomUUID(),
    businessId,
    plan: tenant.plan,
    status: "active",
    currentPeriodEnd: tenant.plan === "free" ? null : new Date(Date.now() + 20 * 86_400_000).toISOString(),
  });
  if (tenant.plan !== "free" && !tenant.createdByAdmin) {
    db.auditLogs.push({
      id: crypto.randomUUID(),
      businessId,
      actorId: userId,
      actorName: ownerActor.name,
      action: "subscription.plan_changed",
      entityType: "subscription",
      entityId: businessId,
      summary: `Cambió el plan de Free a ${planName}`,
      createdAt: daysAgoISO(Math.min(70, age - 1)),
    });
  }

  const services = tenant.services.map(
    ([name, description, durationMinutes, price, isActive = true, location = "business", homeVisitFee = 0]) => ({
    id: crypto.randomUUID(),
    businessId,
    name,
    description,
    durationMinutes,
    price,
    showPrice: true,
    location,
    homeVisitFee,
    clinicalTemplateId: null,
    isActive,
    createdAt: daysAgoISO(age - 1),
  }),
  );
  db.services.push(...services);

  const clients = tenant.clients.map(([name, email, phone, notes = "", isActive = true, address = ""], index) => ({
    id: crypto.randomUUID(),
    businessId,
    name,
    email,
    phone,
    address,
    notes,
    isActive,
    createdAt: daysAgoISO(Math.max(1, age - 20 - index * 5)),
  }));
  db.clients.push(...clients);

  for (let dayOfWeek = 0 as DayOfWeek; dayOfWeek <= 6; dayOfWeek = (dayOfWeek + 1) as DayOfWeek) {
    const intervals = tenant.weeklyHours[dayOfWeek] ?? [];
    db.schedules.push({
      id: crypto.randomUUID(),
      businessId,
      dayOfWeek,
      isActive: intervals.length > 0,
      intervals: intervals.length > 0 ? intervals : [{ start: "09:00", end: "17:00" }],
    });
  }

  const blockedTimes = tenant.blockedTimes(now.date).map((block) => ({
    ...block,
    id: crypto.randomUUID(),
    businessId,
    createdAt: daysAgoISO(3),
  }));
  db.blockedTimes.push(...blockedTimes);

  const activeServices = services.filter((service) => service.isActive);
  const activeClients = clients.filter((client) => client.isActive);
  // Los primeros clientes aparecen más a menudo para tener historiales más completos.
  const weightedClients = [...activeClients, ...activeClients.slice(0, 5), ...activeClients.slice(0, 3)];

  // Visitas a domicilio de ejemplo: generador aparte para no alterar el resto de los datos.
  const placeRandom = createRandom(age * 7919);
  const homeVisitFor = (clientId: string): HomeVisitAddress => {
    const client = clients.find((c) => c.id === clientId);
    const [lat, lng] = tenant.coordinates ?? [null, null];
    const jitter = () => (placeRandom.next() - 0.5) * 0.04;
    return {
      address: client?.address || "Av. Amazonas N34-120",
      reference: placeRandom.next() < 0.5 ? "Edificio de color blanco, timbre 3" : "",
      lat: lat === null ? null : Math.round((lat + jitter()) * 1e6) / 1e6,
      lng: lng === null ? null : Math.round((lng + jitter()) * 1e6) / 1e6,
    };
  };

  // Los datos demo respetan el límite mensual del plan (Free: 20 citas no canceladas al mes).
  const monthlyLimit = getPlan(tenant.plan).limits.appointmentsPerMonth;
  const activePerMonth = new Map<string, number>();

  const addAppointment = (
    date: ISODate,
    startMinutes: number,
    clientId: string,
    service: (typeof services)[number],
    status: AppointmentStatus,
  ) => {
    const month = date.slice(0, 7);
    if (status !== "cancelled") {
      if (monthlyLimit !== null && (activePerMonth.get(month) ?? 0) >= monthlyLimit) return;
      activePerMonth.set(month, (activePerMonth.get(month) ?? 0) + 1);
    }
    const startTime = minutesToTime(startMinutes);
    const endTime = minutesToTime(startMinutes + service.durationMinutes);
    const createdAt = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86_400_000).toISOString();
    const isHome = service.location === "home" || (service.location === "both" && placeRandom.next() < 0.3);
    const appointment: Appointment = {
      id: crypto.randomUUID(),
      businessId,
      clientId,
      serviceId: service.id,
      professionalId,
      date,
      startTime,
      endTime,
      status,
      notes: random.next() < 0.25 ? random.pick(APPOINTMENT_NOTES) : "",
      price: service.price + (isHome ? service.homeVisitFee : 0),
      homeVisit: isHome ? homeVisitFor(clientId) : null,
      source: random.next() < 0.25 ? "booking_page" : "dashboard",
      createdAt,
      updatedAt: createdAt,
    };
    db.appointments.push(appointment);
    if (Date.parse(createdAt) > Date.now() - 7 * 86_400_000 && Date.parse(createdAt) <= Date.now()) {
      const client = clients.find((c) => c.id === clientId);
      db.auditLogs.push({
        id: crypto.randomUUID(),
        businessId,
        actorId: appointment.source === "booking_page" ? null : userId,
        actorName: appointment.source === "booking_page" ? "Reserva online" : ownerActor.name,
        action: appointment.source === "booking_page" ? "appointment.booked_online" : "appointment.created",
        entityType: "appointment",
        entityId: appointment.id,
        summary: `${appointment.source === "booking_page" ? "Nueva reserva online de" : "Creó la cita de"} ${client?.name} (${date.split("-").reverse().join("/")} ${startTime})`,
        createdAt,
      });
    }
  };

  const isBlocked = (date: ISODate, start: number, end: number) =>
    blockedTimes.some(
      (block) =>
        block.startDate <= date &&
        date <= block.endDate &&
        (block.allDay ||
          rangesOverlap(start, end, timeToMinutes(block.startTime!), timeToMinutes(block.endTime!))),
    );

  // El historial empieza como máximo cuando se creó el negocio.
  for (let offset = -Math.min(35, age); offset <= 21; offset++) {
    const date = addDaysISO(now.date, offset);
    const intervals = tenant.weeklyHours[getDayOfWeek(date)];
    if (!intervals) continue;

    const ranges = intervals.map((range) => ({ start: timeToMinutes(range.start), end: timeToMinutes(range.end) }));
    const fitsSchedule = (start: number, end: number) => ranges.some((r) => start >= r.start && end <= r.end);

    if (offset === 0 && tenant.todayAppointments) {
      for (const [time, clientName, serviceName, status] of tenant.todayAppointments) {
        const service = services.find((s) => s.name === serviceName)!;
        const client = clients.find((c) => c.name === clientName)!;
        const start = timeToMinutes(time);
        if (!fitsSchedule(start, start + service.durationMinutes)) continue;
        addAppointment(date, start, client.id, service, isPast(date, time, now) ? "completed" : status);
      }
      continue;
    }

    for (const range of ranges) {
      let cursor = range.start;
      while (cursor < range.end) {
        const service = random.pick(activeServices);
        const end = cursor + service.durationMinutes;
        if (end > range.end) break;

        if (random.next() < tenant.load && !isBlocked(date, cursor, end)) {
          const status = randomStatus(isPast(date, minutesToTime(cursor), now), random.next());
          addAppointment(date, cursor, random.pick(weightedClients).id, service, status);
          cursor = end + random.pick([0, 0, 15, 30]);
        } else {
          cursor += 30;
        }
      }
    }
  }

  seedClinicalRecords(db, tenant, { businessId, ownerId: userId, ownerName: ownerActor.name, clients });
}

/**
 * Ejemplos de historia clínica por especialidad, con la plantilla de cada una (migración 009).
 * El primero va en la cita completada más reciente. seed.ts cambia el id de plantilla por el de
 * su versión vigente.
 */
const CLINICAL_SAMPLES: Partial<Record<BusinessCategory, { templateId: string; data: ClinicalNoteData }[]>> = {
  dentistry: [
    {
      templateId: "odontologia-consulta",
      data: {
        reason: "Dolor en molar inferior derecho al masticar.",
        pain: 6,
        intraoral: "Caries profunda en pieza 46, sin afectación pulpar.",
        odontogram: {
          "46": { surfaces: { O: "obturado" } },
          "36": { surfaces: { O: "caries", M: "caries" } },
          "18": { whole: "ausente" },
          "11": { whole: "corona" },
        },
        procedures: [{ tooth: "46", surface: "O", procedure: "Restauración con resina compuesta", notes: "" }],
        anesthesia: "Lidocaína 2 % · 1 cartucho",
        diagnoses: [{ description: "Caries de la dentina", cie10: "K02.1" }],
        indications: "Evitar alimentos muy fríos 48 h. Cepillado 3 veces al día.",
        next_control: "En 6 meses",
      },
    },
    {
      templateId: "odontologia-consulta",
      data: {
        reason: "Control y limpieza semestral.",
        intraoral: "Placa bacteriana moderada, encías sanas.",
        procedures: [{ tooth: "", surface: "", procedure: "Profilaxis y pulido", notes: "" }],
        diagnoses: [{ description: "Gingivitis leve", cie10: "K05.1" }],
        indications: "Uso de hilo dental diario.",
      },
    },
  ],
  physiotherapy: [
    {
      templateId: "fisioterapia-sesion",
      data: {
        area: "Zona lumbar",
        session_number: 4,
        pain_before: 3,
        pain_after: 2,
        assessment: "Mejoría notable. Movilidad completa.",
        treatment: [{ technique: "Plancha", sets: 3, reps: "30 s", notes: "" }],
        home_exercises: "Continuar ejercicios de core 3 veces por semana.",
        next_session: "En 15 días",
      },
    },
    {
      templateId: "fisioterapia-sesion",
      data: {
        area: "Zona lumbar",
        session_number: 1,
        pain_before: 7,
        pain_after: 5,
        pain_map: [{ view: "back", x: 0.5, y: 0.47, note: "Contractura paravertebral lumbar" }],
        assessment: "Contractura paravertebral lumbar tras levantar peso. Flexión de tronco limitada.",
        treatment: [
          { technique: "Terapia manual", sets: null, reps: "15 min", notes: "" },
          { technique: "TENS", sets: null, reps: "20 min", notes: "" },
          { technique: "Puente glúteo", sets: 3, reps: "10", notes: "" },
        ],
        home_exercises: "Calor local 20 min dos veces al día. Evitar cargas.",
      },
    },
  ],
  nutrition: [
    {
      templateId: "nutricion-control",
      data: {
        reason: "Desea bajar de peso.",
        weight: 82,
        height: 165,
        body_fat: 34.5,
        waist: 98,
        physical_activity: "Sedentaria",
        water: 4,
        nutritional_diagnosis: "Obesidad grado I.",
        meal_plan: "Plan de alimentación de 1.600 kcal.",
        indications: "Registrar comidas en un diario. Caminar 30 min diarios.",
        next_control: "En 15 días",
      },
    },
  ],
  psychology: [
    {
      templateId: "psicologia-escalas",
      data: { phq9: [1, 1, 2, 1, 0, 1, 1, 0, 0], gad7: [1, 1, 1, 2, 0, 1, 1], observations: "Mejoría respecto de la evaluación inicial." },
    },
    {
      templateId: "psicologia-sesion",
      data: {
        topic: "Registro de pensamientos",
        mood: 6,
        dap_data: "Refiere mejor descanso; dos episodios de preocupación intensa en la semana.",
        dap_assessment: "Identifica pensamientos catastróficos con ayuda.",
        dap_plan: "Reestructuración cognitiva.",
        risk: "Sin riesgo aparente",
        homework: "Registro de pensamientos diario.",
        next_session: "En una semana",
      },
    },
    {
      templateId: "psicologia-escalas",
      data: { phq9: [2, 2, 3, 2, 1, 2, 2, 1, 0], gad7: [3, 2, 2, 3, 1, 2, 2] },
    },
    {
      templateId: "psicologia-evaluacion",
      data: {
        reason: "Ansiedad por carga laboral.",
        problem_history: "Insomnio de conciliación y preocupación constante desde hace 3 meses.",
        risk: "Sin riesgo aparente",
        diagnoses: [{ description: "Trastorno de ansiedad generalizada (en estudio)", code: "F41.1" }],
        goals: "Reducir la preocupación y mejorar el sueño.",
        plan: "Terapia cognitivo-conductual semanal y técnicas de respiración.",
      },
    },
  ],
};

function seedClinicalRecords(
  db: SeedDatabase,
  tenant: TenantSeed,
  context: { businessId: string; ownerId: string; ownerName: string; clients: { id: string }[] },
) {
  const samples = CLINICAL_SAMPLES[tenant.business.category];
  if (!samples) return;
  const timestamp = new Date().toISOString();
  for (const client of context.clients.slice(0, 2)) {
    db.clinicalProfiles.push({
      businessId: context.businessId,
      clientId: client.id,
      documentId: "1712345678",
      birthDate: "1988-04-12",
      sex: "",
      bloodType: "O+",
      emergencyContact: "Familiar · +593 99 000 0000",
      allergies: "Penicilina",
      conditions: "",
      medications: "",
      surgeries: "",
      familyHistory: "Hipertensión (madre)",
      consentDate: timestamp.slice(0, 10),
      updatedAt: timestamp,
      updatedByName: context.ownerName,
    });
    // Una evolución por cada cita completada más reciente, con los textos de ejemplo.
    const completed = db.appointments
      .filter((a) => a.clientId === client.id && a.status === "completed")
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, samples.length);
    completed.forEach((appointment, index) => {
      const { templateId, data } = samples[index];
      db.clinicalNotes.push({
        id: crypto.randomUUID(),
        businessId: context.businessId,
        clientId: client.id,
        appointmentId: appointment.id,
        date: appointment.date,
        templateVersionId: templateId,
        data,
        authorId: context.ownerId,
        authorName: context.ownerName,
        createdAt: `${appointment.date}T${appointment.endTime}:00.000Z`,
        addenda: [],
      });
    });
  }
}

export function createSeedDatabase(): SeedDatabase {
  const db: SeedDatabase = {
    platformSettings: { allowPublicSignup: true, supportEmail: DEFAULT_SUPPORT_EMAIL, supportPhone: "" },
    users: [],
    credentials: [],
    businesses: [],
    businessUsers: [],
    professionals: [],
    subscriptions: [],
    clients: [],
    clinicalProfiles: [],
    clinicalNotes: [],
    services: [],
    appointments: [],
    schedules: [],
    blockedTimes: [],
    notifications: [],
    auditLogs: [],
  };

  // Super admin: opera la plataforma (panel /admin). No pertenece a ningún negocio.
  const superAdminId = crypto.randomUUID();
  db.users.push({
    id: superAdminId,
    firstName: "Admin",
    lastName: "Agenda360",
    email: SUPER_ADMIN_ACCOUNT.email,
    phone: "",
    avatarUrl: null,
    platformRole: "super_admin",
    isActive: true,
    createdAt: daysAgoISO(200),
  });
  db.credentials.push({ userId: superAdminId, email: SUPER_ADMIN_ACCOUNT.email, password: SUPER_ADMIN_ACCOUNT.password });
  const superAdmin = { userId: superAdminId, name: "Admin Agenda360 (Super admin)" };

  const now = getZonedNow(DEFAULT_TIMEZONE);
  const random = createRandom(20260930);
  for (const tenant of TENANTS) seedTenant(db, tenant, now, random, superAdmin);

  const pedroId = crypto.randomUUID();
  db.users.push({ id: pedroId, ...UNFINISHED_SIGNUP, avatarUrl: null, platformRole: null, isActive: true, createdAt: daysAgoISO(2) });
  db.credentials.push({ userId: pedroId, email: UNFINISHED_SIGNUP.email, password: DEMO_ACCOUNT.password });
  return db;
}
