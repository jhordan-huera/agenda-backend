// Copia de agenda-front/src/types/index.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
/**
 * Modelos de dominio.
 *
 * Cada interfaz corresponde a una tabla PostgreSQL (snake_case en la base de datos,
 * camelCase aquí). Todas las entidades que pertenecen a un negocio llevan
 * `businessId`: es la clave de aislamiento multi-tenant (la API filtra siempre por él).
 *
 * Convenciones:
 * - IDs: string (uuid en PostgreSQL).
 * - Fechas de calendario: "YYYY-MM-DD" en la zona horaria del negocio.
 * - Horas: "HH:mm" (24 h) en la zona horaria del negocio.
 * - Timestamps de auditoría: ISO 8601 (timestamptz).
 */

export type ISODate = string;
export type TimeString = string;
export type ISODateTime = string;

/** Rol a nivel de plataforma (quien opera el SaaS), independiente de los negocios. */
export type PlatformRole = "super_admin";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  /** "super_admin" para el operador de la plataforma; null para el resto de usuarios. */
  platformRole: PlatformRole | null;
  /** false = el super admin desactivó el acceso de esta cuenta. */
  isActive: boolean;
  createdAt: ISODateTime;
}

/** Identificador de una categoría de negocio (tabla business_categories), p. ej. "psychology". */
export type BusinessCategory = string;

/**
 * Tipo de negocio. Las categorías están en la base de datos y las gestiona el super admin
 * (panel /admin → Categorías).
 */
export interface BusinessCategoryInfo {
  id: BusinessCategory;
  name: string;
  /** Ícono de la lista CATEGORY_ICONS (p. ej. "brain"). */
  icon: string;
  /** Negocios de salud: la historia clínica viene activada al crear el negocio. */
  isHealth: boolean;
  /** Primer servicio sugerido al crear un negocio de esta categoría. */
  suggestedService: { name: string; durationMinutes: number; price: number };
  /** Las inactivas no se ofrecen a negocios nuevos; los que ya la tienen la conservan. */
  isActive: boolean;
  sortOrder: number;
}

/** Categoría vista desde el panel del super admin. */
export interface AdminBusinessCategory extends BusinessCategoryInfo {
  businessCount: number;
}

export interface BookingSettings {
  /**
   * true: las horas se ofrecen según la duración del servicio (1 h → 08:00, 09:00, 10:00…),
   * desde el inicio de cada intervalo del horario. false: cada `slotIntervalMinutes`.
   */
  alignSlotsToDuration: boolean;
  /** Intervalo entre horas ofrecidas cuando `alignSlotsToDuration` es false. */
  slotIntervalMinutes: number;
  /** Anticipación mínima para reservar, en horas. */
  minNoticeHours: number;
  /** Anticipación máxima para reservar, en días. */
  maxAdvanceDays: number;
  allowCancellations: boolean;
  /** Horas mínimas de antelación para que el cliente pueda cancelar. */
  cancellationNoticeHours: number;
  /** Texto de la política de cancelación que ve el cliente al reservar. */
  cancellationPolicy: string;
}

/** Qué emails automáticos se envían a los clientes. */
export interface NotificationSettings {
  /** Reserva, confirmación y modificación de citas. */
  confirmations: boolean;
  reminders: boolean;
  cancellations: boolean;
  reminderHoursBefore: number;
}

/** Un negocio suspendido no puede usar el panel ni recibir reservas online. */
export type BusinessStatus = "active" | "suspended";

export interface Business {
  id: string;
  ownerId: string;
  status: BusinessStatus;
  name: string;
  /** Identificador público usado en /book/[username]. Único globalmente. */
  slug: string;
  description: string;
  category: BusinessCategory;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  phone: string;
  email: string;
  address: string;
  /** Punto exacto del local en el mapa (null si no se marcó: se usa la dirección escrita). */
  lat: number | null;
  lng: number | null;
  bookingSettings: BookingSettings;
  notificationSettings: NotificationSettings;
  /** Historia clínica de los clientes (pacientes). Por defecto, activa en negocios de salud. */
  clinicalRecordsEnabled: boolean;
  createdAt: ISODateTime;
}

/** Roles dentro de un negocio (tabla business_users). */
export type BusinessRole = "owner" | "admin" | "staff";

/** Pertenencia de un usuario a un negocio: base del multi-tenant y de los permisos. */
export interface BusinessUser {
  businessId: string;
  userId: string;
  role: BusinessRole;
  /** Puede ver y escribir historias clínicas. El propietario siempre puede; al resto lo autoriza él. */
  clinicalAccess: boolean;
  createdAt: ISODateTime;
}

/** Miembro del equipo con sus datos de usuario (vista para la interfaz). */
export interface TeamMember extends BusinessUser {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
}

/** Persona que atiende citas dentro de un negocio. Por ahora hay uno por negocio (el dueño). */
export interface Professional {
  id: string;
  businessId: string;
  userId: string;
  displayName: string;
  title: string;
  avatarUrl: string | null;
}

export type PlanId = "free" | "pro" | "business";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  businessId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: ISODateTime | null;
}

/** Límites de un plan; `null` = ilimitado. */
export interface PlanLimits {
  appointmentsPerMonth: number | null;
  clients: number | null;
  users: number | null;
}

export interface PlanUsage {
  plan: PlanId;
  limits: PlanLimits;
  /** Citas no canceladas del mes en curso. */
  appointmentsThisMonth: number;
  clients: number;
  users: number;
}

export interface Client {
  id: string;
  businessId: string;
  name: string;
  /** Cédula o documento de identidad (normalizado). Único por negocio; "" si no se registró. */
  documentId: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  createdAt: ISODateTime;
}

/** Dónde se presta un servicio: en el local, en casa del cliente o en ambos sitios. */
export type ServiceLocation = "business" | "home" | "both";

export interface Service {
  id: string;
  businessId: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  /**
   * Si es false, o si el precio es 0, los clientes no ven ningún precio (ni en la página
   * pública ni en los emails). El profesional siempre ve y edita el precio real.
   */
  showPrice: boolean;
  location: ServiceLocation;
  /** Recargo por atender a domicilio; se suma al precio. */
  homeVisitFee: number;
  isActive: boolean;
  createdAt: ISODateTime;
}

/**
 * Lugar de una cita a domicilio. Las coordenadas salen del mapa donde el cliente marca
 * su ubicación exacta; pueden faltar si el profesional crea la cita sólo con la dirección.
 */
export interface HomeVisitAddress {
  address: string;
  /** Indicaciones para llegar: "casa blanca, junto a la farmacia". */
  reference: string;
  lat: number | null;
  lng: number | null;
}

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type AppointmentSource = "dashboard" | "booking_page";

export interface Appointment {
  id: string;
  businessId: string;
  clientId: string;
  serviceId: string;
  professionalId: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: AppointmentStatus;
  notes: string;
  /** Precio congelado al crear la cita: los cambios de tarifa no alteran el historial. */
  price: number;
  /** null = en el local del negocio. */
  homeVisit: HomeVisitAddress | null;
  source: AppointmentSource;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TimeRange {
  start: TimeString;
  end: TimeString;
}

/** 0 = domingo … 6 = sábado (igual que Date.getDay y EXTRACT(DOW) en PostgreSQL). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Horario de atención de un día de la semana. Admite varios intervalos (horario partido). */
export interface Schedule {
  id: string;
  businessId: string;
  dayOfWeek: DayOfWeek;
  isActive: boolean;
  intervals: TimeRange[];
}

/**
 * Bloqueo de agenda (vacaciones, trámites…). Cubre todos los días entre
 * `startDate` y `endDate`; si `allDay` es false, sólo la franja startTime–endTime de cada día.
 */
export interface BlockedTime {
  id: string;
  businessId: string;
  reason: string;
  startDate: ISODate;
  endDate: ISODate;
  allDay: boolean;
  startTime: TimeString | null;
  endTime: TimeString | null;
  createdAt: ISODateTime;
}

export type EmailType =
  | "welcome"
  | "password_reset"
  | "team_invite"
  | "booking_created"
  | "booking_received"
  | "appointment_confirmed"
  | "appointment_updated"
  | "appointment_cancelled"
  | "appointment_reminder"
  | "business_created"
  | "business_suspended"
  | "business_reactivated"
  | "plan_change_requested"
  | "plan_change_approved"
  | "plan_changed"
  | "plan_change_rejected";

/**
 * Email generado por el sistema (tabla notifications). La API lo guarda "en cola" y lo
 * envía por Gmail en segundo plano; queda "enviado" o, tras varios intentos, "fallido".
 */
export interface EmailNotification {
  id: string;
  /** null para emails de cuenta (registro, recuperación de contraseña). */
  businessId: string | null;
  type: EmailType;
  to: string;
  subject: string;
  body: string;
  appointmentId: string | null;
  status: "queued" | "sent" | "failed";
  createdAt: ISODateTime;
}

export type AuditEntityType =
  | "appointment"
  | "client"
  | "service"
  | "schedule"
  | "blocked_time"
  | "business"
  | "team"
  | "subscription"
  | "user"
  | "platform"
  | "clinical_record";

/** Registro de auditoría: quién hizo qué y cuándo (tabla audit_logs). */
export interface AuditLog {
  id: string;
  /** null en acciones de plataforma que no afectan a un negocio (usuarios, configuración). */
  businessId: string | null;
  /** null cuando la acción la origina un cliente desde la página pública. */
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string | null;
  summary: string;
  createdAt: ISODateTime;
}

/* -------------------------------------------------------- Historia clínica ---- */

/**
 * Antecedentes del paciente (uno por cliente). Datos de salud: datos sensibles. Sólo los ven
 * el propietario y los miembros que él autoriza; nunca la plataforma (super admin).
 */
export interface ClinicalProfile {
  businessId: string;
  clientId: string;
  /** Cédula o documento de identidad. */
  documentId: string;
  birthDate: ISODate | "";
  sex: "" | "female" | "male" | "other";
  bloodType: string;
  emergencyContact: string;
  allergies: string;
  conditions: string;
  medications: string;
  surgeries: string;
  familyHistory: string;
  /** Fecha en que el paciente firmó el consentimiento informado. */
  consentDate: ISODate | "";
  updatedAt: ISODateTime;
  updatedByName: string;
}

/** Aclaración posterior a una evolución: la nota original nunca se edita ni se borra. */
export interface ClinicalNoteAddendum {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: ISODateTime;
}

/** Evolución: registro de una consulta, normalmente unida a su cita. */
export interface ClinicalNote {
  id: string;
  businessId: string;
  clientId: string;
  appointmentId: string | null;
  date: ISODate;
  reason: string;
  findings: string;
  diagnosis: string;
  treatment: string;
  indications: string;
  nextControl: string;
  authorId: string;
  authorName: string;
  createdAt: ISODateTime;
  addenda: ClinicalNoteAddendum[];
}

export interface ClinicalRecord {
  profile: ClinicalProfile | null;
  /** De la más reciente a la más antigua. */
  notes: ClinicalNote[];
}

/* ------------------------------------------------------- Cambios de plan ---- */

export type PlanRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * Solicitud de cambio de plan: el propietario la pide desde Configuración → Suscripción y el
 * super admin la aprueba (se aplica el plan) o la rechaza. Hay como mucho una pendiente por negocio.
 */
export interface PlanChangeRequest {
  id: string;
  businessId: string;
  currentPlan: PlanId;
  requestedPlan: PlanId;
  status: PlanRequestStatus;
  requestedByName: string;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
  resolvedByName: string | null;
  /** Motivo del rechazo (puede estar vacío). */
  rejectionReason: string;
}

/** Solicitud vista desde el panel del super admin. */
export interface AdminPlanRequest extends PlanChangeRequest {
  businessName: string;
  ownerEmail: string | null;
}

/* ------------------------------------------------------------- Plataforma ---- */

/** Configuración global de la plataforma (tabla platform_settings, una sola fila). */
export interface PlatformSettings {
  /** Si es false, sólo el super admin puede crear negocios y cuentas. */
  allowPublicSignup: boolean;
  /** Contacto que se muestra a negocios suspendidos y cuentas desactivadas. */
  supportEmail: string;
}

/** Métricas globales para el panel del super admin. */
export interface PlatformStats {
  businesses: { total: number; active: number; suspended: number; newThisMonth: number };
  businessesByPlan: Record<PlanId, number>;
  /** Ingresos recurrentes mensuales: suma del precio de las suscripciones de pago activas. */
  monthlyRecurringRevenue: number;
  users: number;
  appointmentsThisMonth: number;
  onlineBookingsThisMonth: number;
  /** Negocios creados por mes (últimos 6 meses, "YYYY-MM"). */
  signupsByMonth: { month: string; count: number }[];
}

export interface AdminBusinessSummary {
  business: Business;
  owner: { id: string; name: string; email: string } | null;
  subscription: Subscription | null;
  usage: PlanUsage;
  lastActivityAt: ISODateTime | null;
}

export interface AdminBusinessDetail extends AdminBusinessSummary {
  members: TeamMember[];
  recentActivity: AuditLog[];
}

export interface AdminUserSummary {
  user: User;
  memberships: { businessId: string; businessName: string; role: BusinessRole }[];
}

export interface AdminAuditLog extends AuditLog {
  businessName: string | null;
}

/** Franja ocupada expuesta a la página pública: sin datos personales del cliente. */
export type BusySlot = Pick<Appointment, "date" | "startTime" | "endTime">;

/** Información pública de un negocio para la página de reservas. */
export interface PublicBusinessProfile {
  business: Business;
  professional: Professional;
  services: Service[];
  schedules: Schedule[];
  blockedTimes: BlockedTime[];
  busySlots: BusySlot[];
}

/**
 * Resultado de buscar una cédula en la página pública de reservas. Nunca incluye datos de
 * contacto: sólo el nombre y la inicial del apellido para saludar ("María L.").
 */
export interface PublicClientLookup {
  found: boolean;
  greetingName: string | null;
}

export interface BookingConfirmation {
  appointmentId: string;
  serviceName: string;
  professionalName: string;
  businessName: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  price: number;
  /** false: no se muestra el precio al cliente. */
  showPrice: boolean;
  homeVisit: HomeVisitAddress | null;
  clientEmail: string;
  /** true si se envió el email de confirmación al cliente. */
  emailSent: boolean;
}
