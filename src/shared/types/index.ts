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
  /**
   * Super admin principal: el único que agrega, desactiva o envía el enlace para definir la contraseña
   * a los demás super admins (el equipo de soporte). Nadie puede tocar su cuenta.
   */
  platformOwner: boolean;
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
  /**
   * Citas que una misma persona (su cédula) puede tener el mismo día al reservar desde la página
   * pública; 0 = sin límite. Desde el panel, el profesional agenda las que quiera.
   */
  maxClientBookingsPerDay: number;
  /**
   * Con varias agendas: el paciente elige con quién atenderse (o "el primero disponible"). false: no
   * se le pregunta y la cita va al primer profesional libre.
   */
  chooseProfessional: boolean;
}

/** Qué emails automáticos se envían a los clientes. */
export interface NotificationSettings {
  /** Reserva, confirmación y modificación de citas. */
  confirmations: boolean;
  reminders: boolean;
  cancellations: boolean;
  reminderHoursBefore: number;
  /**
   * Al confirmar, cancelar o reprogramar una cita desde el panel, proponer el aviso por WhatsApp
   * con el mensaje ya escrito (enlace wa.me: lo envía el profesional).
   */
  whatsappOnStatusChange: boolean;
  /** Lo mismo al marcar Completada ("gracias por tu visita") o No asistió ("¿reagendamos?"). */
  whatsappFollowUps: boolean;
}

/** Avisos por WhatsApp que se proponen al cambiar una cita. */
export type WhatsAppNoticeKind = "confirmed" | "cancelled" | "rescheduled" | "completed" | "no_show" | "pending";

/** Un negocio suspendido no puede usar el panel ni recibir reservas online. */
export type BusinessStatus = "active" | "suspended";

export interface Business {
  id: string;
  /** null: el super admin lo creó y aún no le agregó propietario. */
  ownerId: string | null;
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
  /**
   * Formato de historia clínica de todo el negocio: el que se propone en cada evolución nueva
   * (salvo que el servicio de la cita tenga el suyo). null: el recomendado para la especialidad.
   */
  clinicalDefaultTemplateId: string | null;
  /** Colores del panel y de la página de reservas; null: los de Agenda360. */
  brandColors: BrandColors | null;
  /** Qué pacientes ve quien tiene el rol Profesional: todos los del negocio o sólo los suyos. */
  professionalScope: ProfessionalScope;
  createdAt: ISODateTime;
}

/** "own": sólo los pacientes con citas en su agenda o que registró él. */
export type ProfessionalScope = "all" | "own";

/**
 * Roles dentro de un negocio (tabla business_users). "staff" es Recepción (todas las agendas);
 * "professional", quien sólo atiende su propia agenda.
 */
export type BusinessRole = "owner" | "admin" | "staff" | "professional";

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

/** Colores de marca de un negocio ("#rrggbb"). De ellos sale toda la paleta (lib/brand-theme.ts). */
export interface BrandColors {
  /** Botones, títulos y lo activo. */
  primary: string;
  /** Lo elegido o lo nuevo: la hora reservada, el día elegido. */
  highlight: string;
}

/**
 * Resumen de las citas de un cliente: lo calcula la API (en la base de datos) para que el panel no
 * descargue el historial completo de citas del negocio.
 */
export interface ClientActivity {
  clientId: string;
  /** Citas no canceladas. */
  totalAppointments: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Suma de las citas completadas. */
  totalSpent: number;
  /** Fecha de su primera cita no cancelada (null si no tiene ninguna). */
  firstVisit: ISODate | null;
  /** Última cita ya pasada (no cancelada). */
  lastAppointment: Appointment | null;
  /** Próxima cita activa. */
  nextAppointment: Appointment | null;
}

/**
 * Persona que atiende citas: cada una tiene su agenda (horario, bloqueos y servicios). Los planes
 * Free y Pro tienen una; Business, las que se contraten.
 */
export interface Professional {
  id: string;
  businessId: string;
  /** Miembro del equipo que usa esta agenda; null: profesional sin cuenta en el sistema. */
  userId: string | null;
  displayName: string;
  /** Especialidad que ven los pacientes: "Odontóloga", "Psicólogo clínico". */
  title: string;
  avatarUrl: string | null;
  /** Color de sus citas en el calendario ("#rrggbb"). */
  color: string;
  /** A dónde se le avisa de sus citas ("" = sin avisos). */
  email: string;
  /** true: atiende todos los servicios; false: sólo los de `serviceIds`. */
  allServices: boolean;
  serviceIds: string[];
  /** Email por cada cita nueva en su agenda que no creó él. */
  notifyNewAppointments: boolean;
  /** Email cada mañana con sus citas del día. */
  dailyAgenda: boolean;
  /** Enlace de su sala de videollamada (Meet, Zoom…) para las citas virtuales ("" = sin enlace). */
  meetingUrl: string;
  /** Cuenta a la que le transfieren sus pacientes; null: no cobra por transferencia. */
  bankAccount: BankAccount | null;
  /** Inactivo: no recibe citas nuevas ni aparece en la página de reservas; su historial se conserva. */
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateTime;
}

export type BankAccountType = "savings" | "checking";

/** Datos para que el paciente pague la cita por transferencia. */
export interface BankAccount {
  /** "Banco Pichincha", "Produbanco"… */
  bank: string;
  accountType: BankAccountType;
  number: string;
  /** Nombre del titular, tal como lo pide el banco. */
  holder: string;
  /** Cédula o RUC del titular ("" = no se indica). */
  holderId: string;
}

export type PlanId = "free" | "pro" | "business";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  businessId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: ISODateTime | null;
  /** Agendas contratadas (plan Business): las fija el super admin. null: las del plan. */
  maxProfessionals: number | null;
}

/** Límites de un plan; `null` = ilimitado. */
export interface PlanLimits {
  appointmentsPerMonth: number | null;
  clients: number | null;
  users: number | null;
  /** Agendas (profesionales activos). */
  professionals: number | null;
}

export interface PlanUsage {
  plan: PlanId;
  /** Los del plan, con las agendas contratadas del negocio si el super admin las fijó. */
  limits: PlanLimits;
  /** Citas no canceladas del mes en curso. */
  appointmentsThisMonth: number;
  clients: number;
  users: number;
  /** Profesionales activos. */
  professionals: number;
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
  /**
   * Sólo para un Profesional con «sólo sus pacientes»: paciente de una reserva online en su agenda que el
   * negocio aún no confirmó. Llega sólo con el nombre (sin contacto ni notas) para mostrar la cita; su
   * ficha y su historia no se abren hasta que recepción, un administrador o el propietario la gestione.
   */
  restricted?: true;
}

/** Modalidades de un servicio: en el local, en casa del cliente o por videollamada. */
export type ServiceMode = "business" | "home" | "virtual";

export interface Service {
  id: string;
  businessId: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  /**
   * Si es false, los clientes no ven ningún precio (ni en la página pública ni en los emails); con
   * precio 0, ven "Gratis". El profesional siempre ve y edita el precio real.
   */
  showPrice: boolean;
  /** Dónde se atiende (al menos una). Con varias, el cliente elige al reservar. */
  modes: ServiceMode[];
  /** Recargo por atender a domicilio; se suma al precio. */
  homeVisitFee: number;
  /** Formato de historia clínica propuesto al registrar la evolución de una cita de este servicio. */
  clinicalTemplateId: string | null;
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
  /** null = en el local del negocio (o virtual). */
  homeVisit: HomeVisitAddress | null;
  /** Por videollamada: el enlace es el del profesional (Professional.meetingUrl). */
  isVirtual: boolean;
  source: AppointmentSource;
  /** Cuándo llegó el paciente (recepción lo marca); null: aún no llegó o no se registró. */
  arrivedAt: ISODateTime | null;
  /** Enlace privado de pago (/pago/:token): datos para transferir y subida del comprobante. */
  paymentToken: string;
  /** Último comprobante de pago que envió el paciente; null: ninguno. */
  receiptAt: ISODateTime | null;
  /** Cuándo se marcó como pagada; null: sin marcar. */
  paidAt: ISODateTime | null;
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
  /** Cada profesional tiene su horario. */
  professionalId: string;
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
  /** null: bloquea a todo el negocio (feriado, cierre); si no, sólo la agenda de ese profesional. */
  professionalId: string | null;
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
  | "plan_change_rejected"
  | "platform_admin_added"
  | "professional_new_appointment"
  | "professional_daily_agenda"
  | "payment_receipt_received";

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
  | "professional"
  | "business"
  | "team"
  | "subscription"
  | "user"
  | "platform"
  | "clinical_record"
  /** Inicios y cierres de sesión e intentos fallidos: sólo los ve el super admin. */
  | "session";

/** Un campo que cambió en una edición. `before`/`after` null: valor que no se muestra (p. ej. notas). */
export interface AuditChange {
  label: string;
  before: string | null;
  after: string | null;
}

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
  /** Qué cambió en una edición (null si no es una edición o no hubo cambios). */
  changes: AuditChange[] | null;
  createdAt: ISODateTime;
}

/** Una página de la auditoría. `nextCursor`: para "Cargar más" (null si no hay más). */
export interface AuditLogPage<T extends AuditLog = AuditLog> {
  entries: T[];
  nextCursor: string | null;
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

/* ------------------------------------------ Plantillas de historia clínica ---- */

/** Columna de un campo de tipo lista (p. ej. la receta: cantidad, principio activo…). */
export interface ClinicalListColumn {
  id: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}

interface ClinicalFieldBase {
  /** Clave del valor en `ClinicalNote.data`: no cambia entre versiones de la plantilla. */
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
}

/**
 * Campo de una plantilla de evolución. Cada especialidad registra cosas distintas (signos
 * vitales, odontograma, antropometría…): la plantilla dice qué se pide y cómo.
 */
export type ClinicalField =
  /** Título que agrupa los campos siguientes (no guarda valor). */
  | (ClinicalFieldBase & { type: "section" })
  | (ClinicalFieldBase & { type: "text" | "textarea"; placeholder?: string })
  | (ClinicalFieldBase & { type: "number"; unit?: string; min?: number; max?: number; step?: number })
  /** Escala de puntos, p. ej. dolor 0–10. */
  | (ClinicalFieldBase & { type: "scale"; min: number; max: number; minLabel?: string; maxLabel?: string })
  | (ClinicalFieldBase & { type: "select" | "multiselect"; options: string[] })
  /** Sí / No. */
  | (ClinicalFieldBase & { type: "boolean" })
  | (ClinicalFieldBase & { type: "date" })
  /** Filas con columnas: receta, diagnósticos CIE-10, procedimientos por pieza… */
  | (ClinicalFieldBase & { type: "list"; columns: ClinicalListColumn[]; addLabel?: string })
  /** Índice de masa corporal calculado de otros dos campos (peso en kg y talla en cm); no guarda valor. */
  | (ClinicalFieldBase & { type: "bmi"; weightField: string; heightField: string })
  /** Cuestionario con puntaje (PHQ-9, GAD-7…): cada pregunta se responde con una opción que suma puntos. */
  | (ClinicalFieldBase & {
      type: "questionnaire";
      /** Enunciado común de las preguntas ("Durante las últimas 2 semanas…"). */
      prompt?: string;
      items: string[];
      options: { label: string; points: number }[];
      /** Interpretación del total: el primer rango que lo contiene. */
      ranges: { min: number; max: number; label: string }[];
      /** Avisos por pregunta (p. ej. ideación suicida en la 9 del PHQ-9). */
      alerts?: { item: number; minPoints: number; message: string }[];
    })
  /** Odontograma (numeración FDI): estado por superficie y de la pieza completa. */
  | (ClinicalFieldBase & { type: "odontogram" })
  /** Mapa del cuerpo (frente y espalda) para marcar lesiones o zonas de dolor. */
  | (ClinicalFieldBase & { type: "bodymap" });

export type ClinicalFieldType = ClinicalField["type"];

export type ClinicalListRow = Record<string, string | number | null>;

/** Superficies de una pieza: oclusal/incisal, mesial, distal, vestibular y lingual/palatina. */
export type ToothSurface = "O" | "M" | "D" | "V" | "L";
export type ToothSurfaceState = "caries" | "obturado" | "sellante" | "fractura";
export type ToothWholeState = "corona" | "endodoncia" | "extraccion" | "ausente" | "implante";

/** Estado de una pieza en el odontograma (sólo las piezas con hallazgos). */
export interface ToothState {
  surfaces?: Partial<Record<ToothSurface, ToothSurfaceState>>;
  whole?: ToothWholeState;
  note?: string;
}

/** Odontograma: por número de pieza FDI ("16", "21", "55"…). */
export type OdontogramValue = Record<string, ToothState>;

/** Marca en el mapa del cuerpo: vista y posición relativa (0 a 1). */
export interface BodyMapMark {
  view: "front" | "back";
  x: number;
  y: number;
  note: string;
}

/**
 * Valor de un campo: texto, número, sí/no, opciones elegidas, filas de una lista, respuestas de un
 * cuestionario (puntos por pregunta), odontograma o marcas del mapa del cuerpo.
 */
export type ClinicalFieldValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | ClinicalListRow[]
  | OdontogramValue
  | BodyMapMark[];

/** Contenido de una evolución: sólo los campos completados, por id de campo. */
export type ClinicalNoteData = Record<string, ClinicalFieldValue>;

/** Formato de evolución disponible para el negocio, en su versión vigente. */
export interface ClinicalTemplate {
  /** "atencion-medica" en las de la plataforma. */
  id: string;
  /** null: plantilla de la plataforma, disponible para todos los negocios. */
  businessId: string | null;
  name: string;
  description: string;
  /** Especialidades (ids de categoría) para las que se recomienda; vacío = general. */
  categories: string[];
  /** Recomendada para la especialidad de este negocio. */
  recommended: boolean;
  /**
   * Formato de todo el negocio: el elegido por el propietario o, si no eligió ninguno, el
   * recomendado para su especialidad. Siempre hay exactamente uno.
   */
  isDefault: boolean;
  /** Las propias se pueden desactivar (dejan de ofrecerse; sus evoluciones se siguen viendo). */
  isActive: boolean;
  /** Versión vigente: las evoluciones nuevas se escriben con ella. */
  versionId: string;
  version: number;
  fields: ClinicalField[];
}

/**
 * Versión de una plantilla tal como era al escribir una evolución. Nunca cambia: si la
 * plantilla se modifica, las evoluciones antiguas se siguen mostrando con sus campos.
 */
export interface ClinicalTemplateVersion {
  id: string;
  templateId: string;
  name: string;
  version: number;
  fields: ClinicalField[];
}

/** Evolución: registro de una consulta con el formato (plantilla) de la especialidad. */
export interface ClinicalNote {
  id: string;
  businessId: string;
  clientId: string;
  appointmentId: string | null;
  date: ISODate;
  templateVersionId: string;
  data: ClinicalNoteData;
  authorId: string;
  authorName: string;
  createdAt: ISODateTime;
  addenda: ClinicalNoteAddendum[];
}

/** Archivo de la historia clínica (radiografía, examen, foto…). No se borra. */
export interface ClinicalAttachment {
  id: string;
  clientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  description: string;
  uploadedByName: string;
  createdAt: ISODateTime;
}

/** Subida directa al almacenamiento (Supabase Storage): el navegador envía el archivo a esta URL. */
export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface ClinicalAttachmentUpload {
  attachment: ClinicalAttachment;
  upload: UploadTarget;
}

/** Para qué es una imagen: foto del propio perfil, logo del negocio o foto de un profesional. */
export type ImageTarget = "avatar" | "logo" | "professional";

/** Subida de una imagen pública: `url` es la dirección que se guarda (logoUrl, avatarUrl). */
export interface ImageUpload {
  upload: UploadTarget;
  url: string;
}

/** Comprobante de pago (foto o PDF) que envió el paciente desde su enlace de pago. */
export interface PaymentReceipt {
  id: string;
  appointmentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: ISODateTime;
}

export interface PaymentReceiptUpload {
  receipt: PaymentReceipt;
  upload: UploadTarget;
}

export interface ClinicalRecord {
  profile: ClinicalProfile | null;
  /** De la más reciente a la más antigua. */
  notes: ClinicalNote[];
  /** Versiones de plantilla con que se escribieron las evoluciones (por id). */
  templateVersions: Record<string, ClinicalTemplateVersion>;
  /** Archivos ya subidos, del más reciente al más antiguo. */
  attachments: ClinicalAttachment[];
  /**
   * ¿Se pueden subir archivos? "upgrade": el plan no lo incluye (Pro y Business sí);
   * "unavailable": el almacenamiento no está configurado.
   */
  attachmentAccess: "available" | "upgrade" | "unavailable";
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
  /** Teléfono de soporte (WhatsApp) que se muestra junto al email; "" si no hay. */
  supportPhone: string;
}

/** Métricas globales para el panel del super admin. */
export interface PlatformStats {
  businesses: { total: number; active: number; suspended: number; newThisMonth: number };
  businessesByPlan: Record<PlanId, number>;
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

/** Un super admin del equipo de la plataforma (Configuración del panel /admin). */
export interface PlatformAdmin {
  user: User;
  /** Tiene activada la verificación en dos pasos. */
  twoFactorEnabled: boolean;
  /** Último inicio de sesión (null si nunca entró). */
  lastSignInAt: ISODateTime | null;
}

/**
 * Enlace de un solo uso para que un usuario defina su contraseña (el super admin nunca la ve ni la
 * elige). Se envía por email; el super admin puede copiarlo (p. ej. para pasarlo por WhatsApp).
 */
export interface PasswordLink {
  url: string;
  /** Caduca a los 60 minutos. */
  expiresAt: ISODateTime;
  /** A quién se le envió por email. */
  email: string;
}

/** Cuenta que agrega el super admin a un negocio, con el enlace para que defina su contraseña. */
export interface AddedTeamMember {
  member: TeamMember;
  passwordLink: PasswordLink;
}

/** Super admin nuevo, con el enlace para que defina su contraseña. */
export interface AddedPlatformAdmin {
  admin: PlatformAdmin;
  passwordLink: PasswordLink;
}

/** Lo que muestra la página /definir-contrasena antes de pedir la contraseña. */
export interface PasswordLinkInfo {
  firstName: string;
  email: string;
  expiresAt: ISODateTime;
}

export interface AdminUserSummary {
  user: User;
  memberships: { businessId: string; businessName: string; role: BusinessRole }[];
}

export interface AdminAuditLog extends AuditLog {
  businessName: string | null;
  /** Sólo en los eventos de sesión: desde dónde se conectó. */
  ip: string | null;
  userAgent: string | null;
}

/** Inicio de sesión con la verificación en dos pasos activada: la contraseña es correcta y falta el código. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  /** Token del paso intermedio (unos minutos): se envía junto con el código. */
  challenge: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: ISODateTime | null;
  /** Códigos de recuperación sin usar. */
  recoveryCodesLeft: number;
  /** Obligatoria (con datos reales, siempre): sin ella no se usa el panel /admin ni el modo soporte. */
  required: boolean;
}

/** Clave para la app de autenticación: el QR lleva `otpauthUrl`; `secret`, para escribirla a mano. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

/** Códigos de recuperación de un solo uso: sólo se muestran al generarlos. */
export interface RecoveryCodes {
  recoveryCodes: string[];
}

/** Franja ocupada expuesta a la página pública: sin datos personales del cliente. */
export type BusySlot = Pick<Appointment, "date" | "startTime" | "endTime" | "professionalId">;

/** El negocio en la página pública: sin datos internos (propietario, estado, avisos…). */
export type PublicBusiness = Omit<
  Business,
  "ownerId" | "status" | "notificationSettings" | "clinicalRecordsEnabled" | "clinicalDefaultTemplateId" | "professionalScope" | "createdAt"
>;
/** Sin su cuenta, su email ni sus avisos. */
export type PublicProfessional = Pick<Professional, "id" | "displayName" | "title" | "avatarUrl" | "allServices" | "serviceIds">;
/** Con el precio oculto (`showPrice` false), `price` y `homeVisitFee` llegan a 0. */
export type PublicService = Omit<Service, "clinicalTemplateId" | "isActive" | "createdAt">;
/** Sin el motivo: el cliente sólo necesita saber que esas horas no están disponibles. */
export type PublicBlockedTime = Omit<BlockedTime, "reason" | "createdAt">;

/** Información pública de un negocio para la página de reservas. */
export interface PublicBusinessProfile {
  business: PublicBusiness;
  /** Profesionales activos, en el orden del negocio. */
  professionals: PublicProfessional[];
  /** El primero de `professionals` (compatibilidad con páginas abiertas antes de las varias agendas). */
  professional: PublicProfessional;
  services: PublicService[];
  schedules: Schedule[];
  blockedTimes: PublicBlockedTime[];
  busySlots: BusySlot[];
  /** Site Key de Cloudflare Turnstile: buscar por cédula y reservar exigen el CAPTCHA. null: no se pide. */
  captchaSiteKey: string | null;
}

/**
 * Resultado de buscar una cédula en la página pública de reservas. Nunca incluye datos de
 * contacto: sólo el nombre y la inicial del apellido para saludar ("María L.").
 */
/**
 * Respuesta de la búsqueda por cédula de las versiones anteriores de la página pública: siempre la
 * misma, para no revelar si alguien es paciente del negocio.
 */
export interface PublicClientLookup {
  found: false;
  greetingName: null;
}

export interface BookingConfirmation {
  appointmentId: string;
  serviceName: string;
  /** Quién atiende (también si el paciente eligió "el primero disponible"). */
  professionalId: string;
  professionalName: string;
  businessName: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  price: number;
  /** false: no se muestra el precio al cliente. */
  showPrice: boolean;
  homeVisit: HomeVisitAddress | null;
  isVirtual: boolean;
  /** Enlace de la videollamada (citas virtuales, si el profesional lo configuró). */
  meetingUrl: string | null;
  /** A dónde se envió la confirmación; "" si no es el email que escribió el paciente (va al de su ficha). */
  clientEmail: string;
  /** true si se envió el email de confirmación al cliente. */
  emailSent: boolean;
  /** Pago por transferencia: la agenda tiene datos bancarios y la cita tiene precio. */
  payment: BookingPayment | null;
  /**
   * La misma reserva otra vez (se perdió la respuesta y el paciente volvió a confirmar): la cita se
   * paga por transferencia, pero los datos y el enlace de pago no van en la respuesta (le llegaron por email).
   */
  paymentByEmail: boolean;
}

export interface BookingPayment {
  bankAccount: BankAccount;
  /** Enlace privado de pago de la cita (/pago/:token). */
  token: string;
  /** false: no se pueden subir comprobantes (sólo enviarlos por WhatsApp). */
  receiptsEnabled: boolean;
}

/** Página de pago de una cita (/pago/:token), sin sesión: el token es la autorización. */
export interface PublicPayment {
  business: Pick<PublicBusiness, "name" | "slug" | "logoUrl" | "phone" | "timezone" | "currency" | "brandColors">;
  /** Para el mensaje de WhatsApp: "María L.". */
  clientName: string;
  serviceName: string;
  professionalName: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: AppointmentStatus;
  /** Monto a transferir; null: el negocio no muestra el precio de este servicio. */
  amount: number | null;
  /** null: la agenda ya no tiene datos bancarios. */
  bankAccount: BankAccount | null;
  /** Comprobantes enviados, del más antiguo al más reciente. */
  receipts: Pick<PaymentReceipt, "id" | "fileName" | "createdAt">[];
  /** El negocio ya marcó la cita como pagada. */
  paid: boolean;
  receiptsEnabled: boolean;
}
