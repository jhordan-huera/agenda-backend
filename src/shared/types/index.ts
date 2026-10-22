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

/**
 * Modo de pantalla de cada persona (spec 019), guardado en su cuenta. "auto": sigue al modo del
 * celular o la computadora. Las páginas de los pacientes siempre siguen a su aparato.
 */
export type ThemeMode = "light" | "dark" | "auto";

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
   * Super admin principal: el único que agrega, desactiva o cambia la contraseña de los demás
   * super admins (el equipo de soporte). Nadie puede tocar su cuenta.
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
  /**
   * Emails de seguimiento al marcar Atendida ("gracias por tu visita") o No asistió ("elige otra
   * hora"), sólo de citas de los últimos 7 días (spec 008). Los negocios guardados antes no lo
   * traen: cuenta como encendido.
   */
  followUps: boolean;
}

/**
 * Avisos por WhatsApp que se proponen al cambiar una cita. "pending": una cita cancelada vuelve a
 * quedar pendiente; "unconfirmed": una cita confirmada (o atendida, o no asistió) vuelve a
 * pendiente de confirmar (spec 008).
 */
export type WhatsAppNoticeKind =
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "completed"
  | "no_show"
  | "pending"
  | "unconfirmed"
  /** «Cancelar ésta y las siguientes» de una serie (spec 011): un mensaje con todas las fechas. */
  | "series_cancelled";

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
  /**
   * Datos del paciente obligatorios al crearlo o editarlo desde el panel (el nombre lo es siempre). Los
   * elige el super admin para cada negocio; la reserva online no cambia (pide cédula, nombre, email y teléfono).
   */
  clientRequiredFields: ClientRequiredFields;
  /**
   * Citas con varios pacientes (p. ej. sesiones de pareja): hasta 3 por cita. Lo activa el super admin
   * para cada negocio; el negocio no lo cambia.
   */
  multiClientAppointments: boolean;
  createdAt: ISODateTime;
}

/** "own": sólo los pacientes con citas en su agenda o que registró él. */
export type ProfessionalScope = "all" | "own";

/** true: el dato es obligatorio en la ficha del paciente; false: opcional (ver Business.clientRequiredFields). */
export interface ClientRequiredFields {
  documentId: boolean;
  email: boolean;
  phone: boolean;
  address: boolean;
}

/** Un dato del paciente que el negocio puede hacer obligatorio (el nombre lo es siempre). */
export type ClientRequiredField = keyof ClientRequiredFields;

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
  /**
   * Cada cita de los próximos días le llega como invitación de calendario (spec 027): Google, iPhone u
   * Outlook la añaden y la actualizan solos. Apagado al principio.
   */
  calendarInvites: boolean;
  /**
   * A dónde le llegan las invitaciones de calendario (y la copia de los emails al paciente): `email` o,
   * si está vacío, el de su usuario. "" = la agenda no tiene email y no puede activarlas.
   */
  calendarEmail: string;
  /** Enlace de su sala de videollamada (Meet, Zoom…) para las citas virtuales ("" = sin enlace). */
  meetingUrl: string;
  /**
   * Cuentas a las que le pueden transferir sus pacientes (hasta 3; la primera es la principal).
   * Vacía: no cobra por transferencia.
   */
  bankAccounts: BankAccount[];
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
  /** Para el cobro (otra spec): hoy no se muestra, porque no hay renovación. */
  currentPeriodEnd: ISODateTime | null;
  /** Desde cuándo está en su plan: el alta o el último cambio de plan (spec 015). */
  planSince: ISODateTime;
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
  /**
   * «Por verificar»: paciente creado por una reserva online con la cédula de otra ficha (su id) pero
   * con un email y un teléfono que no coinciden con ella. Va aparte, sin cédula y sin acceso a esa
   * ficha, hasta que el negocio lo une a ella o cancela la cita. null: paciente normal.
   */
  claimedClientId: string | null;
  /** De dónde salió: el panel, la página de reservas o una importación desde un archivo (spec 012). */
  source: ClientSource;
}

/**
 * Origen de un paciente. "import": lo creó una importación desde un Excel o un CSV (spec 012); no
 * cuenta como paciente nuevo del mes en el Inicio, pero sí en el total y en el tope del plan.
 */
export type ClientSource = "dashboard" | "booking_page" | "import";

/**
 * Una fila de la importación de pacientes (spec 012), tal como la manda el panel: con las columnas ya
 * asignadas y los datos como vienen en el archivo (la limpieza la hacen los dos lados con las mismas
 * reglas, ver lib/validations/client-import.ts). `row`: el número de fila en la hoja, como lo muestra Excel.
 */
export interface ClientImportRow {
  row: number;
  name: string;
  documentId: string;
  email: string;
  phone: string;
  address: string;
  /** La columna Notas y las columnas «Añadir a las notas», una por línea («Título: valor»). */
  notes: string;
}

/** Resultado de una importación (o de su revisión): los números de fila son los de la hoja. */
export interface ClientImportResult {
  /** Pacientes creados (en la revisión, los que se crearán). */
  created: number;
  /** Ya eran pacientes del negocio: no se tocan. `clientId`: su ficha. */
  existing: { row: number; clientId: string }[];
  /** La misma persona que una fila anterior del archivo (`firstRow`, la que se usa). */
  repeated: { row: number; firstRow: number }[];
  /** No pasan las reglas del formulario del paciente. `reason` nunca repite el valor de la celda. */
  errors: { row: number; reason: string }[];
  /** No entran por el tope de pacientes del plan. */
  overLimit: number[];
  /**
   * Con «Importar también los que tienen datos por completar» (ampliación del 2026-10-15): las filas
   * que se crean aunque les falte un dato obligatorio del negocio (`missing`, en el orden del
   * formulario). Ya cuentan en `created`; quedan «Por completar» hasta que se completan en su ficha.
   * Sin la casilla, esas filas van a `errors` y esta lista queda vacía.
   */
  incomplete: { row: number; missing: ClientRequiredField[] }[];
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
  /**
   * Personas por sesión: 1 (individual), 2 (pareja) o 3 (familia). Sólo vale si el negocio tiene
   * multiClientAppointments; en la página de reservas llega ya con el valor efectivo (1 sin él).
   */
  peoplePerSession: number;
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
  /** Paciente principal: el de la reserva y el del pago. */
  clientId: string;
  /** Otros pacientes de la sesión (hasta 2, en orden; vacío si no hay). Ver Business.multiClientAppointments. */
  extraClientIds: string[];
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
  /**
   * Quienes confirmaron que van desde su email (spec 010), el principal primero. Vacía: nadie. Un
   * backend anterior no la manda: el panel la trata como vacía.
   */
  clientConfirmations: ClientConfirmation[];
  /**
   * La serie con la que se agendó («cada semana, 8 sesiones», spec 011); null: una cita suelta. Un
   * backend anterior no la manda: el panel la trata como null.
   */
  series: AppointmentSeriesRef | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** «Confirmo que voy» de un paciente de la cita (spec 010): no cambia el estado de la cita. */
export interface ClientConfirmation {
  clientId: string;
  confirmedAt: ISODateTime;
}

/**
 * Cada cuánto se repite una serie de citas (spec 011). «Cada mes» es el mismo día del mes que la primera
 * (el 15 de cada mes); si ese mes no lo tiene, el último.
 */
export type AppointmentSeriesFrequency = "weekly" | "biweekly" | "monthly";

/** La serie de una cita (spec 011): «Cita 3 de 8 · cada semana». */
export interface AppointmentSeriesRef {
  id: string;
  /** Su número en la serie: 1, 2, 3… sin huecos. */
  index: number;
  /** Cuántas citas se crearon con la serie («Cita 3 de 8»): sin las quitadas ni las que chocaron. */
  total: number;
  frequency: AppointmentSeriesFrequency;
}

/**
 * La marca de una fecha en la lista de la serie, antes de crearla (spec 011): libre, otra cita del
 * profesional, un bloqueo, un día que no atiende, fuera de su horario o más allá del cupo del plan.
 */
export type SeriesDateStatus = "free" | "busy" | "blocked" | "day_off" | "outside_hours" | "plan_limit";

/** Una fecha de la lista de la serie (respuesta de la vista previa: no se guarda). */
export interface SeriesDatePreview {
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: SeriesDateStatus;
  /** Lo que se muestra («Ya hay una cita de 10:00 a 11:00», «Bloqueado: Vacaciones»…); null si está libre. */
  reason: string | null;
  /** Las horas libres de ese día para «Otra hora» (sólo en las marcadas busy, blocked y outside_hours). */
  freeTimes: TimeString[];
}

/** Las citas que quedan en el cupo del plan en cada mes de la serie ("2026-11": 12), topadas en 24. */
export type SeriesPlanRemaining = Record<string, number>;

/** La lista de fechas de una serie, antes de crearla (POST …/appointment-series/preview). */
export interface AppointmentSeriesPreview {
  dates: SeriesDatePreview[];
  /** null: el plan no tiene tope de citas al mes. */
  planRemaining: SeriesPlanRemaining | null;
  /** El tope de citas al mes del plan (20 en Free), para el motivo de la marca; null: sin tope. */
  monthlyLimit: number | null;
}

/** La serie creada (POST …/appointment-series): las citas, en orden, y las fechas que no se crearon. */
export interface AppointmentSeriesCreated {
  series: { id: string; total: number; frequency: AppointmentSeriesFrequency };
  created: Appointment[];
  /** Llegaron y no se crearon: se ocuparon, se bloquearon o pasaron el cupo mientras se revisaba la lista. */
  skipped: { date: ISODate; startTime: TimeString; reason: string }[];
}

/* ------------------------------------------- Citas por cerrar (spec 018) -- */

/**
 * Una cita de la lista «Por cerrar» (GET …/appointments/to-close): ya terminó, en la hora del negocio, y
 * sigue Pendiente o Confirmada. Trae lo que se ve en la agenda, sin tener que cargar los pacientes.
 */
export interface AppointmentToClose {
  id: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: Extract<AppointmentStatus, "pending" | "confirmed">;
  professionalId: string;
  /** Los pacientes de la cita, el principal primero (con varios pacientes se cierra la cita entera). */
  clientNames: string[];
  serviceName: string;
  professionalName: string;
  /** De un día anterior al de hoy en la zona del negocio: ésas bloquean el panel. false: de hoy. */
  overdue: boolean;
  /**
   * De un mes anterior al de hoy en la zona del negocio (spec 021): ésas bloquean sin «Más tarde». Una API
   * antigua no lo trae: cuenta como false.
   */
  previousMonth?: boolean;
}

/** Cuántas hay por cerrar, en el alcance de quien pregunta (el rol Profesional, sólo su agenda). */
export interface AppointmentsToCloseCount {
  /** De días anteriores: con alguna, el panel pide cerrarlas al entrar. */
  overdue: number;
  /** De hoy que ya terminaron: salen en la lista, pero no bloquean (el día aún no termina). */
  today: number;
  /**
   * De ellas, las de un mes anterior al de hoy en la zona del negocio (spec 021): con alguna, el panel se
   * bloquea sin «Más tarde» hasta cerrarlas. Una API antigua no lo trae: cuenta como 0.
   */
  previousMonth?: number;
}

/** Una tanda de la lista «Por cerrar», de la más vieja a la más nueva, con las cifras de toda la lista. */
export interface AppointmentsToClose extends AppointmentsToCloseCount {
  appointments: AppointmentToClose[];
  /** Para «Cargar más»: la fecha, la hora y el id de la última («2026-10-14|09:30|…»); null si no hay más. */
  nextCursor: string | null;
}

/** «Marcar todas como completadas» (POST …/appointments/close-all). */
export interface CloseAllResult {
  /** Las que se cerraron, cada una con su entrada en la actividad. */
  closed: number;
  /** Las que ya no estaban por cerrar (alguien las cerró antes) o no son de su alcance: no se tocan. */
  skipped: number;
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
  | "payment_receipt_received"
  /** Copia al profesional de un email al paciente sobre su cita (también la de los recordatorios). */
  | "appointment_copy"
  /** La cita vuelve a quedar pendiente de confirmar (spec 008). */
  | "appointment_pending"
  /** La cita quedó como atendida: gracias por la visita (spec 008). */
  | "appointment_completed"
  /** El paciente no asistió: invitación a elegir otra hora (spec 008). */
  | "appointment_no_show"
  /** Cambio de seguridad en una cuenta de super admin: verificación en dos pasos o contraseña (spec 009). */
  | "account_security_changed"
  /** Aviso al negocio: el paciente canceló su cita desde «Tu cita», el enlace de sus emails (spec 010). */
  | "patient_cancelled"
  /** Al paciente: todas las fechas de una serie de citas nueva, en un solo email (spec 011). */
  | "appointment_series"
  /** Al paciente: «Cancelar ésta y las siguientes» de una serie, con las fechas canceladas (spec 011). */
  | "appointment_series_cancelled"
  /** Al profesional: la cita como invitación de calendario, su cambio o su cancelación (spec 027). */
  | "calendar_invite"
  /** Al propietario, tres días antes del día de pago: el monto y las cuentas para transferir (spec 029). */
  | "billing_reminder"
  /** Al propietario: el super admin confirmó el pago de su mensualidad (spec 029). */
  | "billing_paid"
  /** Al propietario: el super admin rechazó el comprobante, con el motivo (spec 029). */
  | "billing_rejected"
  /** Al propietario: el super admin anuló el cobro de un mes, con el motivo (spec 029). */
  | "billing_voided";

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
  /** Sólo en la bandeja del super admin (/admin → Actividad): el negocio (null en los de cuenta o de plataforma). */
  businessName?: string | null;
  /** Sólo en la del super admin: cuándo salió (null si no salió). */
  sentAt?: ISODateTime | null;
  /** Sólo en la del super admin: el motivo, si falló. */
  error?: string | null;
  /** Sólo en la del super admin: falló a propósito (un recordatorio de una cita que cambió, una dirección de demostración). */
  discarded?: boolean;
}

/** El filtro de los emails de /admin → Actividad: los de «Emails de hoy», los fallidos de verdad o todos. */
export type AdminEmailFilter = "today" | "failed" | "all";

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
 * el propietario y los miembros que él autoriza; ni el super admin en modo soporte (spec 025).
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

/* -------------------------------------- Descargar los datos del negocio (spec 028) -- */

/**
 * Qué se lleva quien descarga: el propietario, todo el negocio (`business`); el rol Profesional, lo de
 * su agenda (`agenda`): sus pacientes (con la regla de «sólo sus pacientes», aunque el negocio esté en
 * «todos»), sus citas y, con acceso clínico, las historias de esos pacientes. Nadie más descarga: ni el
 * administrador, ni la recepción, ni el super admin, tampoco en modo soporte.
 */
export type DataExportScope = "business" | "agenda";

/**
 * ¿Lleva las historias clínicas y sus archivos? `no_access`: el profesional no tiene acceso clínico;
 * `disabled`: la historia clínica no está activada en el negocio.
 */
export type DataExportClinical = "included" | "no_access" | "disabled";

/** GET …/export: con qué empieza cada descarga. Pedirlo la deja en la actividad (una entrada por descarga). */
export interface DataExportSummary {
  scope: DataExportScope;
  business: { name: string; slug: string; timezone: string; currency: string; address: string; phone: string };
  /** Quién descarga: va al pie de cada historia. */
  exportedBy: string;
  /** Cuándo empezó: la fecha del ZIP y del LEEME. */
  exportedAt: ISODateTime;
  clinical: DataExportClinical;
  /** Lo que trae; las historias y los archivos, 0 si no lleva lo clínico. */
  counts: { clients: number; appointments: number; clinicalRecords: number; attachments: number };
}

/** Una parte de la descarga. `nextCursor`: con qué pedir la siguiente (null: era la última). */
export interface DataExportPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Un paciente de pacientes.xlsx, con todos sus datos: el email y el teléfono completos (son del negocio). */
export interface DataExportClient {
  id: string;
  name: string;
  documentId: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  /** «Por verificar» (spec 009): una reserva online con la cédula de otro paciente, aún sin unir. */
  pendingVerification: boolean;
  createdAt: ISODateTime;
}

/** Una cita de citas.xlsx. */
export interface DataExportAppointment {
  id: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: AppointmentStatus;
  /** El paciente principal primero y luego los demás de la sesión. */
  clients: string[];
  service: string;
  professional: string;
  /** En el local, a domicilio o por videollamada. */
  modality: ServiceMode;
  /** La dirección de la visita a domicilio ("" si no es a domicilio). */
  homeAddress: string;
  price: number;
  paid: boolean;
  notes: string;
}

/** La historia clínica de un paciente, como «Imprimir / PDF». */
export interface DataExportClinicalRecord {
  client: Pick<Client, "id" | "name" | "documentId" | "email" | "phone" | "address">;
  profile: ClinicalProfile | null;
  /** De la más antigua a la más reciente, con el servicio de su cita (null: sin cita o sin servicio). */
  notes: (ClinicalNote & { serviceName: string | null })[];
  /** Los archivos ya subidos, del más antiguo al más reciente. */
  attachments: ClinicalAttachment[];
}

/** Una parte de las historias: unos pocos pacientes y las versiones de formato de sus evoluciones. */
export interface DataExportClinicalPage extends DataExportPage<DataExportClinicalRecord> {
  /** Las versiones de formato con que se escribieron sus evoluciones (por id). */
  templateVersions: Record<string, ClinicalTemplateVersion>;
}

/* ------------------------------------------------------- Cambios de plan ---- */

export type PlanRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * Solicitud de cambio de plan: el super admin la aprueba (se aplica el plan) o la rechaza. Hay como
 * mucho una pendiente por negocio. El panel del negocio ya no tiene la pestaña Suscripción (no ve
 * planes ni precios): hoy nadie la crea desde la web, aunque la API la sigue aceptando.
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

/** Una cifra de lo que va del mes y la de los mismos días del mes pasado (inicio del super admin). */
export interface GrowthPair {
  current: number;
  previous: number;
}

/** Lo de un día en la plataforma: citas agendadas, reservas online y pacientes nuevos (inicio del super admin). */
export interface DailyCounts {
  appointments: number;
  onlineBookings: number;
  newClients: number;
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
  /**
   * Crecimiento del mes (spec 006): desde el día 1 hasta hoy, frente a los mismos días del mes pasado
   * (en Ecuador). Citas agendadas (creadas, sin las canceladas), reservas online, pacientes y negocios nuevos.
   */
  growth: {
    from: ISODate;
    to: ISODate;
    previousFrom: ISODate;
    previousTo: ISODate;
    appointments: GrowthPair;
    onlineBookings: GrowthPair;
    newClients: GrowthPair;
    newBusinesses: GrowthPair;
    /**
     * Día a día, del 1 al mayor entre hoy y el último día del mes pasado (para el gráfico): `current`
     * es null después de hoy y `previous`, si el mes pasado no tuvo ese día.
     */
    daily: { day: number; current: DailyCounts | null; previous: DailyCounts | null }[];
  };
  /** Salud del sistema (spec 006). Sólo cifras: sin emails ni cuentas. */
  health: {
    /** Emails de hoy: enviados, fallidos (sin los descartados a propósito) y los que siguen en cola. */
    emailsToday: { sent: number; failed: number; queued: number };
    /**
     * El cupo diario de la cuenta de Gmail (spec 015): los envíos de las últimas 24 h frente al cupo, el
     * límite de los emails al paciente (el cupo menos la reserva del equipo) y los que esperan cupo en la
     * cola, al paciente y al negocio (copias al profesional y avisos).
     */
    emailQuota: { quota: number; sent24h: number; patientLimit: number; waiting: { patient: number; business: number } };
    /** Última pasada del cron (null: ninguna) y sus errores (negocios con fallos y emails que no salieron). */
    cron: { lastRunAt: ISODateTime | null; failures: number };
    /** Última copia de seguridad registrada (null: ninguna todavía). */
    backup: { ranAt: ISODateTime; ok: boolean; sizeBytes: number | null; error: string } | null;
    /**
     * Lo que ocupa la base de datos frente al tope del plan gratuito de Supabase (500 MB por defecto,
     * DATABASE_LIMIT_MB). null: no se pudo medir.
     */
    database: { sizeBytes: number; limitBytes: number } | null;
    /** Intentos fallidos de inicio de sesión en 24 h y cuentas con 10 o más en la última hora. */
    security: { failedLogins24h: number; accountsOnAlert: number };
    /** Emails de los últimos 14 días (hoy el último), en Ecuador: enviados y fallidos (sin los descartados). */
    emailsByDay: { date: ISODate; sent: number; failed: number }[];
  };
  /**
   * El cobro de las mensualidades (spec 029): los comprobantes por revisar y los cobros atrasados (por pagar
   * desde hace BILLING_OVERDUE_DAYS días o más). Una API anterior no lo trae.
   */
  billing?: { inReview: number; overdue: number };
}

export interface AdminBusinessSummary {
  business: Business;
  owner: { id: string; name: string; email: string } | null;
  subscription: Subscription | null;
  usage: PlanUsage;
  lastActivityAt: ISODateTime | null;
  /** Citas agendadas en lo que va del mes y en los mismos días del mes pasado (spec 006). */
  growth: GrowthPair;
  /** Su código del programa de referidos (spec 023): el buscador de «Recomendado por» también lo encuentra. */
  referralCode: string;
  /** Quién lo recomendó (el id de otro negocio), o null. */
  referredBy: string | null;
}

export interface AdminBusinessDetail extends AdminBusinessSummary {
  members: TeamMember[];
  recentActivity: AuditLog[];
  /** Su parte de la última foto de 30 días de la analítica (spec 016), para «Frente a su tipo»; null: aún no hay foto. */
  analytics: AdminBusinessAnalytics | null;
  /** El programa de referidos (spec 023): quién lo recomendó y a quién recomendó. Una API anterior no lo trae. */
  referrals?: AdminBusinessReferrals;
  /**
   * La última vez que el propietario o un profesional descargó sus datos (spec 028), según la actividad;
   * null: ninguna. Una API anterior no lo trae.
   */
  lastDataExportAt?: ISODateTime | null;
  /** Su mensualidad (spec 029): no va en `Subscription`, que la ve todo el equipo. Una API anterior no la trae. */
  billing?: AdminBusinessBilling;
}

/* ------------------------------------------------ Programa de referidos (spec 023) -- */

/** La tarjeta «Recomienda Agenda360» de Configuración → Negocio: sólo la ve el propietario. */
export interface BusinessReferrals {
  /** Su código (6 caracteres): no cambia aunque cambie el enlace de reservas. */
  code: string;
  /** `<portada>/?ref=<código>`. */
  link: string;
  /** Negocios que recomendó. */
  referred: number;
  /** De ellos, los que se quedaron: activos a los 30 días de crearse (o con el descuento ya aplicado). */
  qualified: number;
}

/** Un negocio que otro recomendó, en la ficha de /admin («Recomendó a»). */
export interface ReferredBusiness {
  id: string;
  name: string;
  status: BusinessStatus;
  createdAt: ISODateTime;
  /** Activo y con 30 días o más: su recomendación se quedó y ganó el descuento. */
  qualified: boolean;
  /** Cuándo se aplicó su descuento; null: todavía no. */
  rewardAppliedAt: ISODateTime | null;
}

/** Los referidos de un negocio en su ficha de /admin. */
export interface AdminBusinessReferrals {
  /** Quién lo recomendó (null: nadie). */
  referredBy: { id: string; name: string } | null;
  /** A quién recomendó, el más nuevo primero. */
  referred: ReferredBusiness[];
}

/** Un descuento ganado y pendiente de aplicar, en «Descuentos por referidos» del Inicio de /admin. */
export interface ReferralReward {
  /** El negocio recomendado: cada uno da un solo descuento. */
  business: { id: string; name: string };
  /** Quién lo recomendó: paga menos en su siguiente mensualidad. */
  referrer: { id: string; name: string };
  /** Cuándo se ganó: 30 días después del alta del recomendado. */
  earnedAt: ISODateTime;
  /** En USD (REFERRAL_DISCOUNT). */
  amount: number;
}

/* ------------------------------------- El cobro de las mensualidades (spec 029) -- */

/**
 * El estado de un cobro: por pagar (`due`), en revisión (con comprobante), pagado, rechazado (con un
 * motivo: vuelve a pedir el comprobante) o anulado (con un motivo: ya no se cobra).
 */
export type BillingStatus = "due" | "in_review" | "paid" | "rejected" | "void";

/** Cómo se pagó: por transferencia (el comprobante aprobado) u otra vía (efectivo…, sin comprobante). */
export type BillingPaidMethod = "transfer" | "other";

/** El comprobante de una mensualidad (foto o PDF): privado, lo ven el propietario y el super admin. */
export interface BillingReceipt {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: ISODateTime;
}

export interface BillingReceiptUpload {
  receipt: BillingReceipt;
  upload: UploadTarget;
}

/**
 * El cobro de un mes. Se crea en su día de pago con la mensualidad de ese momento, menos el descuento de
 * las recomendaciones ganadas y sin aplicar (REFERRAL_DISCOUNT cada una, sin pasar de la mensualidad).
 */
export interface BillingCharge {
  id: string;
  /** Su día de pago (el del mes o, si el mes no lo tiene, el último). */
  dueDate: ISODate;
  /** La mensualidad de ese mes. */
  baseAmount: number;
  /** El descuento de referidos (0: ninguno). */
  referralDiscount: number;
  /** Cuántas recomendaciones usa ese descuento. */
  referralCount: number;
  /** Lo que se paga: `baseAmount − referralDiscount`. */
  amount: number;
  status: BillingStatus;
  /** El motivo del último rechazo (null: nunca se rechazó). */
  rejectionReason: string | null;
  /** El motivo de la anulación (sólo en los anulados). */
  voidReason: string | null;
  paidMethod: BillingPaidMethod | null;
  paidAt: ISODateTime | null;
  /** El último comprobante que llegó (null: ninguno). */
  receipt: BillingReceipt | null;
  createdAt: ISODateTime;
}

/**
 * La mensualidad del propietario (Configuración → Negocio y la pantalla de pago). Sólo la ve el propietario
 * (y el super admin en modo soporte): nunca la lista de planes ni los precios de otros (constitución,
 * principio III).
 */
export interface BusinessBilling {
  /**
   * Su total en USD, antes del descuento de referidos (que va en cada cobro): el de su plan o su precio
   * especial, sin decir de dónde sale. 0: sin cobros (plan gratis o cortesía).
   */
  monthlyFee: number;
  /** El día del mes en que paga (null: sin cobros). */
  billingDay: number | null;
  /** El próximo día de pago que todavía no tiene su cobro (null: sin cobros). */
  nextDueDate: ISODate | null;
  /** El cobro pendiente más antiguo (por pagar o rechazado): el que abre la pantalla de pago. */
  pending: BillingCharge | null;
  /**
   * Hay un pendiente: desde su día de pago, la pantalla de pago no se cierra hasta subir el comprobante (sin
   * «Más tarde» ni días de gracia, desde el 2026-10-20). La API no bloquea nada: lo hace la pantalla.
   */
  blocked: boolean;
  /** Las cuentas de Agenda360 para transferir (las pone el super admin en /admin → Configuración). */
  bankAccounts: BankAccount[];
  /** Su historial, el más nuevo primero. */
  charges: BillingCharge[];
  /** false: la API no tiene dónde guardar los comprobantes (se envían por WhatsApp al soporte). */
  receiptsEnabled: boolean;
}

/** La mensualidad de un negocio en su ficha de /admin («Suscripción y uso»). */
export interface AdminBusinessBilling {
  /**
   * La mensualidad que se le cobra (effectiveMonthlyFee): su precio especial o, sin él, el de su plan con sus
   * agendas. 0: sin cobros (el plan gratis o un negocio de cortesía).
   */
  monthlyFee: number;
  /** El precio de su plan con sus agendas (planMonthlyPrice), aunque tenga un precio especial. */
  planPrice: number;
  /** Su precio especial (null: el de su plan; 0: cortesía, sin cobros). */
  customFee: number | null;
  /** Las agendas que cuenta el precio de Business: las contratadas o, sin tope, las activas. */
  agendas: number;
  billingDay: number | null;
  /** La fecha del primer cobro (null: todavía sin cobros). */
  billingStart: ISODate | null;
  /** El próximo día de pago (null: sin cobros: mensualidad 0, plan gratis o sin el día de pago). */
  nextDueDate: ISODate | null;
  /** Sus cobros pendientes: por pagar, en revisión o rechazados. */
  openCharges: number;
}

/**
 * Los precios de los planes, en USD (spec 029, ampliación del 2026-10-20): los cambia el super admin en
 * /admin → Planes y valen desde el siguiente cobro de cada negocio. Free no tiene precio (sin cobros). Nunca
 * los ve un negocio ni van en la configuración pública: el propietario sólo ve su mensualidad.
 */
export interface PlanPrices {
  proPrice: number;
  /** Business con sus agendas incluidas. */
  businessPrice: number;
  /** Las agendas que incluye el precio de Business. */
  businessIncludedAgendas: number;
  /** Lo que suma cada agenda de Business sobre las incluidas. */
  businessExtraAgendaPrice: number;
}

/**
 * Los filtros de /admin → Cobros: cada cobro está en uno solo. Los por pagar se separan por los días desde
 * su día de pago (BILLING_OVERDUE_DAYS, sólo para el super admin: el propietario no tiene gracia): «Por
 * pagar» (menos de 5) y «Atrasados» (5 o más); los rechazados van aparte, con su motivo.
 */
export type AdminBillingFilter = "in_review" | "due" | "overdue" | "paid" | "rejected" | "void";

/** Un cobro en /admin → Cobros. */
export interface AdminBillingCharge extends BillingCharge {
  business: { id: string; name: string };
  /**
   * Días que le faltan a un cobro por pagar para salir como «Atrasado»: 5 en su día de pago, 1 el quinto
   * día y 0 desde el sexto (0 también si no está por pagar). Sólo para el super admin.
   */
  overdueInDays: number;
  /** Lo que escribió el super admin al marcarlo pagado sin comprobante (sólo lo ve él). */
  paidNote: string | null;
  /** Quién lo marcó pagado, lo rechazó o lo anuló (null: nadie todavía, o ya no existe la cuenta). */
  reviewedByName: string | null;
  updatedAt: ISODateTime;
}

/** /admin → Cobros: los de un filtro y cuántos hay en cada uno. */
export interface AdminBillingList {
  charges: AdminBillingCharge[];
  counts: Record<AdminBillingFilter, number>;
}

/* ------------------------------------------ Analítica del super admin (spec 016) -- */

/**
 * Periodo de la analítica: los últimos 30 o 90 días, sin contar hoy (en la zona de cada negocio),
 * siempre comparado con el periodo anterior de la misma duración.
 */
export type AnalyticsPeriodDays = 30 | 90;

/** Las funciones de Agenda360 cuyo uso se mide en cada negocio (R6). */
export type FeatureKey =
  | "bookingPage"
  | "reminders"
  | "patientConfirm"
  | "series"
  | "clientImport"
  | "push"
  | "bell"
  | "clinical"
  | "payments"
  | "multiAgenda";

/** Las tasas que se comparan con las del tipo de negocio. */
export type AnalyticsRateKey = "onlineRate" | "noShowRate" | "cancelRate" | "confirmRate";

/** Salud de un negocio: de 70 a 100 sano, de 40 a 69 en riesgo y menos de 40 crítico (R4). */
export type HealthGroup = "healthy" | "risk" | "critical";

/**
 * Una tasa del negocio frente a la de su tipo (R3): muy por encima o muy por debajo (el doble o la
 * mitad, con 5 puntos de diferencia o más), parecida, o null si no se puede comparar (pocos datos).
 */
export type VersusType = "above" | "below" | "similar" | null;

/**
 * Las cifras de un negocio en el periodo (R2–R7). Las tasas son fracciones de 0 a 1 (0,25 = 25 %);
 * null cuando no hay con qué calcularlas (p. ej. ninguna cita pasada). Con menos de 10 citas en el
 * periodo, `fewData`: las tasas se muestran con «pocos datos» y no cuentan para su tipo.
 */
export interface BusinessAnalytics {
  id: string;
  name: string;
  /** El tipo de negocio (su categoría); id null: «Sin tipo». */
  category: { id: string | null; name: string };
  plan: PlanId;
  status: BusinessStatus;
  createdAt: ISODateTime;
  timezone: string;
  currency: string;
  /** Sólo el propietario, para llamarlo (nunca datos de pacientes). null: el negocio aún no tiene. */
  owner: { name: string; phone: string; email: string } | null;
  /** Citas con fecha en el periodo, sin las canceladas. */
  appointments: number;
  /** Las mismas, en el periodo anterior. */
  previousAppointments: number;
  /** Frente al periodo anterior (0,45 = +45 %); "new" si el negocio es más nuevo que el periodo o antes no tuvo citas. */
  growth: number | "new";
  /** Reservas desde la página ÷ citas. */
  onlineRate: number | null;
  /** No asistió ÷ (atendidas + no asistió). */
  noShowRate: number | null;
  /** Canceladas ÷ todas las del periodo. */
  cancelRate: number | null;
  /** «Confirmo que voy» ÷ citas que recibieron un recordatorio o un email con el enlace «Tu cita». */
  confirmRate: number | null;
  versusType: Record<AnalyticsRateKey, VersusType>;
  /** Pacientes con alguna cita en el periodo. */
  activeClients: number;
  /** Pacientes creados en el periodo (como cuenta el tope del plan y sin los importados). */
  newClients: number;
  /** El precio de las citas atendidas, en la moneda del negocio. */
  estimatedRevenue: number;
  /** El precio de las citas marcadas como pagadas. */
  collected: number;
  /** Ingresos estimados ÷ atendidas con precio (null: ninguna con precio). */
  averageTicket: number | null;
  /** El mes en curso frente al tope del plan (limit null: sin tope). */
  planUsage: {
    appointments: { used: number; limit: number | null };
    clients: { used: number; limit: number | null };
    users: { used: number; limit: number | null };
  };
  /** Profesionales activos y, en Business, las agendas contratadas. */
  agendas: { active: number; contracted: number | null };
  /** Personas del equipo (0: «nadie», ni siquiera el propietario). */
  teamMembers: number;
  /** El último inicio de sesión de alguien del equipo (la auditoría guarda 90 días); null: ninguno. */
  lastTeamLoginAt: ISODateTime | null;
  /** Citas pasadas del periodo que siguen Pendientes o Confirmadas. */
  unclosed: number;
  health: { score: number; group: HealthGroup; reasons: string[] };
  /** Por qué está listo para subir de plan (R5); vacío si no lo está. */
  upsell: string[];
  features: Record<FeatureKey, boolean>;
  /** Lo que le dio Agenda360 en el periodo (R7). */
  value: {
    /** Todas las citas del periodo, también las canceladas. */
    appointments: number;
    online: number;
    reminders: number;
    confirmations: number;
    /** Canceladas 24 h o más antes de la cita: la hora quedó libre. */
    timelyCancellations: number;
    /**
     * Inasistencias de los 60 días antes y después de empezar a usar los recordatorios o «Confirmo que
     * voy» (`since`), si cada lado tiene 20 citas cerradas o más; si no, null.
     */
    noShowBefore: number | null;
    noShowAfter: number | null;
    since: ISODate | null;
  };
  fewData: boolean;
}

/** Las cifras de un tipo de negocio (R3), sólo con sus negocios activos. */
export interface CategoryAnalytics {
  /** null: «Sin tipo». */
  id: string | null;
  name: string;
  /** Negocios activos del tipo. */
  businesses: number;
  /** Los que tienen datos suficientes (10 citas o más): sólo ellos cuentan para las medianas. */
  withData: number;
  /** La mediana de cada tasa (null con «pocos datos»: menos de 3 negocios con datos). */
  medians: Record<AnalyticsRateKey, number | null>;
  /** La mediana del ticket promedio. */
  averageTicket: number | null;
  /** La mediana de las citas por agenda en el periodo. */
  appointmentsPerAgenda: number | null;
  /** Los 3 días de la semana y las 3 horas de inicio con más citas en el periodo. */
  topDays: { day: DayOfWeek; appointments: number }[];
  topHours: { hour: number; appointments: number }[];
  fewData: boolean;
}

/** Los totales de la plataforma en el periodo (R7) y la adopción de cada función (R6). */
export interface PlatformTotals {
  businesses: { active: number; total: number };
  /** Todas las citas del periodo, también las canceladas («Agenda360 gestionó…»). */
  appointments: number;
  online: number;
  reminders: number;
  confirmations: number;
  newClients: number;
  /** Negocios activos que usan cada función y su parte (0 a 1). */
  adoption: Record<FeatureKey, { businesses: number; rate: number }>;
}

/** La foto diaria de la analítica (tabla analytics_snapshots): la prepara el cron, la página sólo la lee. */
export interface AnalyticsSnapshot {
  computedAt: ISODateTime;
  periodDays: AnalyticsPeriodDays;
  /** El periodo en la hora de Ecuador: desde (incluido) y hasta (hoy, sin incluir). */
  from: ISODate;
  to: ISODate;
  /** Una por negocio, activos y suspendidos (la página filtra). */
  businesses: BusinessAnalytics[];
  /** Una por tipo con negocios activos, más «Sin tipo» si hace falta. */
  categories: CategoryAnalytics[];
  platform: PlatformTotals;
}

/** La parte de un negocio en la última foto de 30 días, para la tarjeta «Frente a su tipo» de su ficha. */
export interface AdminBusinessAnalytics {
  computedAt: ISODateTime;
  periodDays: AnalyticsPeriodDays;
  business: BusinessAnalytics;
  category: CategoryAnalytics | null;
}

/** Un super admin del equipo de la plataforma (Configuración del panel /admin). */
export interface PlatformAdmin {
  user: User;
  /** Tiene activada la verificación en dos pasos. */
  twoFactorEnabled: boolean;
  /** Último inicio de sesión (null si nunca entró). */
  lastSignInAt: ISODateTime | null;
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
  | "ownerId"
  | "status"
  | "notificationSettings"
  | "clinicalRecordsEnabled"
  | "clinicalDefaultTemplateId"
  | "professionalScope"
  | "clientRequiredFields"
  | "multiClientAppointments"
  | "createdAt"
>;
/** Sin su cuenta, su email ni sus avisos. */
export type PublicProfessional = Pick<Professional, "id" | "displayName" | "title" | "avatarUrl" | "allServices" | "serviceIds">;
/** Con el precio oculto (`showPrice` false), `price` y `homeVisitFee` llegan a 0. */
export type PublicService = Omit<Service, "isActive" | "createdAt">;
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
  /** Cuentas de la agenda (al menos una): el paciente transfiere a cualquiera. */
  bankAccounts: BankAccount[];
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
  /** Cuentas de la agenda (la primera es la principal); vacía: ya no tiene datos bancarios. */
  bankAccounts: BankAccount[];
  /** Comprobantes enviados, del más antiguo al más reciente. */
  receipts: Pick<PaymentReceipt, "id" | "fileName" | "createdAt">[];
  /** El negocio ya marcó la cita como pagada. */
  paid: boolean;
  receiptsEnabled: boolean;
}

/** Página «Tu cita» (/cita/:token), sin sesión: el token es la autorización (spec 010). */
export interface PublicAppointment {
  business: Pick<
    PublicBusiness,
    "name" | "slug" | "logoUrl" | "phone" | "address" | "lat" | "lng" | "timezone" | "brandColors"
  >;
  serviceName: string;
  professionalName: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  /** En el local, virtual o a domicilio (sin la dirección de la visita ni el enlace de la videollamada). */
  place: ServiceMode;
  status: AppointmentStatus;
  /** Ya empezó o pasó, en la hora del negocio. */
  past: boolean;
  /** Cuándo confirmó que va quien abre el enlace; null: aún no. */
  confirmedAt: ISODateTime | null;
  /** Puede pulsar «Confirmo que voy»: la cita está pendiente o confirmada y aún no empieza. */
  canConfirm: boolean;
  cancellation: {
    /**
     * allowed: puede cancelar aquí · too_late: falta menos que la antelación · disabled: el negocio no
     * permite cancelaciones · not_main: es otra persona de la sesión · closed: cancelada, atendida,
     * no asistió o ya pasó.
     */
    status: "allowed" | "too_late" | "disabled" | "not_main" | "closed";
    /** La antelación del negocio, en horas («Para cancelar con menos de 24 h…»). */
    noticeHours: number;
    /** La política de cancelación del negocio ("" si no permite cancelaciones). */
    policy: string;
  };
  /** Quien abre es el principal y la cita tiene un pago por transferencia pendiente: la página lleva a /pago/:token. */
  payment: boolean;
}

/** Respuesta de «Confirmo que voy» y de «Cancelar mi cita». */
export interface PublicAppointmentResult {
  appointment: PublicAppointment;
  /** Ya estaba confirmada (o cancelada, en /cancel): no se hizo nada. */
  already: boolean;
}

/* ------------------------------------ La pantalla «Base de datos» (spec 024) -- */

/**
 * Una sección de la pantalla que no se pudo leer (tardó más de 5 segundos o falló): dice «No se pudo
 * leer ahora» y las demás se ven igual.
 */
export interface DatabaseSectionError {
  error: string;
}

/** Lo que ocupa la base frente al tope del plan de Supabase (DATABASE_LIMIT_MB). */
export interface DatabaseSize {
  sizeBytes: number;
  limitBytes: number;
}

/** Los archivos de Supabase Storage, frente a su tope (FILES_LIMIT_MB): no cuentan en la base. */
export interface DatabaseFiles {
  totalBytes: number;
  limitBytes: number;
  /** Uno por bucket, del que más ocupa al que menos. */
  buckets: { bucket: string; label: string; files: number; bytes: number }[];
}

/** Una tabla en «Qué ocupa»: sólo su nombre y cifras, nunca sus filas. */
export interface DatabaseTableStat {
  /** El esquema: «public» (las de Agenda360), «auth», «storage»… */
  schema: string;
  /** El nombre técnico: «notifications». */
  name: string;
  /** En palabras: «Emails (cola e historial)». null: una tabla que no está en el mapa (sale su nombre técnico). */
  label: string | null;
  /** Si se borra sola y cuándo: «El contenido a los 30 días; queda el registro», «Nunca». null: no se sabe (las de Supabase). */
  retention: string | null;
  /** Lo que ocupa en total: los datos, los índices y los textos largos (toast). */
  totalBytes: number;
  dataBytes: number;
  indexBytes: number;
  toastBytes: number;
  /** Filas, según la última estimación de PostgreSQL (null: todavía no la calculó). */
  rows: number | null;
}

/** Lo que trae Supabase, aparte: el inicio de sesión (auth), el almacenamiento (storage) y lo interno. */
export interface DatabaseTableGroup {
  key: "auth" | "storage" | "internal";
  label: string;
  totalBytes: number;
  tables: DatabaseTableStat[];
}

/** «Qué ocupa». */
export interface DatabaseTables {
  /** Las de Agenda360 (esquema public), de la que más ocupa a la que menos. */
  app: DatabaseTableStat[];
  /** Sólo los grupos que tienen tablas. */
  supabase: DatabaseTableGroup[];
  /** Lo que no es de ninguna tabla: el catálogo de PostgreSQL y lo demás (el total menos las tablas). */
  otherBytes: number;
}

/** Quién hace trabajar a la base: la app, el cron, las conexiones (el pooler), Supabase u otra cuenta. */
export type DatabaseWorker = "app" | "cron" | "pooler" | "supabase" | "other";

/** Una de las consultas que más tiempo consumen (pg_stat_statements), sin valores. */
export interface DatabaseQueryStat {
  /** En palabras, cuando se reconoce: «El cron revisa su última pasada». */
  label: string | null;
  /** El texto normalizado ($1), sin comentarios, con los textos entre comillas tapados ('…') y recortado. */
  text: string;
  who: DatabaseWorker;
  calls: number;
  totalMs: number;
  meanMs: number;
  /** Su parte del tiempo total (0 a 1). */
  share: number;
}

/** «Qué la hace trabajar». */
export interface DatabaseWork {
  /** Desde cuándo cuentan las estadísticas de consultas (null: no se sabe). */
  since: ISODateTime | null;
  totalMs: number;
  calls: number;
  /** El reparto por quién, del que más trabaja al que menos (sólo los que trabajaron). */
  byWho: { who: DatabaseWorker; label: string; totalMs: number; calls: number; share: number }[];
  /** Las 10 que más tiempo consumen. */
  top: DatabaseQueryStat[];
}

/** Una tabla con muchas escrituras: sus filas vivas y muertas y su última limpieza (vacuum). */
export interface DatabaseTableActivity {
  schema: string;
  name: string;
  label: string | null;
  /** Filas insertadas, cambiadas y borradas desde que se reiniciaron las estadísticas. */
  writes: number;
  liveRows: number;
  deadRows: number;
  /** La última limpieza, a mano o automática (null: nunca). */
  lastVacuumAt: ISODateTime | null;
}

/** «Mantenimiento». */
export interface DatabaseMaintenance {
  /** Desde cuándo cuentan las estadísticas de las tablas (null: desde que arrancó la base). */
  since: ISODateTime | null;
  /** Las 10 con más escrituras. */
  tables: DatabaseTableActivity[];
  /** Los índices de Agenda360 que nunca se usaron (sin los únicos ni los de una restricción). */
  unusedIndexes: { name: string; table: string; tableLabel: string | null; bytes: number }[];
  /** Las conexiones abiertas ahora, por cuenta y estado, frente al máximo de PostgreSQL. */
  connections: {
    total: number;
    max: number;
    byRole: { role: string; who: DatabaseWorker; state: string; count: number }[];
  };
}

/** Una foto diaria del historial (la guarda el cron después de las 06:00 de Ecuador). */
export interface DatabaseHistoryPoint {
  day: ISODate;
  sizeBytes: number;
  /** null: no se pudieron medir los archivos ese día. */
  filesBytes: number | null;
}

/** «A este ritmo, se llena en…»: una regresión lineal del historial (7 días o más). */
export interface DatabaseProjection {
  /** Días de historial con los que se calculó. */
  days: number;
  /** Lo que crece cada 30 días (negativo si baja). */
  bytesPerMonth: number;
  /** Meses hasta el 70 % y hasta el tope desde la última foto (0: ya llegó; null: no crece). */
  monthsTo70: number | null;
  monthsToFull: number | null;
}

/**
 * GET /api/admin/database (spec 024): sólo el super admin principal, con la verificación en dos pasos.
 * Sólo nombres de tablas, tamaños y cifras; nunca datos de filas. Cada sección puede venir con su error.
 */
export interface DatabaseStats {
  computedAt: ISODateTime;
  size: DatabaseSize | DatabaseSectionError;
  /** null: sin Supabase Storage (en local los archivos van a una carpeta). */
  files: DatabaseFiles | DatabaseSectionError | null;
  tables: DatabaseTables | DatabaseSectionError;
  /** null: la estadística de consultas (pg_stat_statements) no está disponible. */
  work: DatabaseWork | DatabaseSectionError | null;
  maintenance: DatabaseMaintenance | DatabaseSectionError;
  /** Los últimos 90 días, del más viejo al más nuevo. */
  history: DatabaseHistoryPoint[] | DatabaseSectionError;
  /** null: menos de 7 días de historial («Hacen falta unos días de datos para calcularlo»). */
  projection: DatabaseProjection | null;
}

/* ------------------------------------------- Avisos en el celular (spec 013) -- */

/**
 * Tipos de aviso en el celular (Web Push). Los ocho primeros son del propietario del negocio y los
 * seis siguientes, del super admin (ver src/lib/constants/push.ts). `test` es el aviso de prueba:
 * siempre sale y no se puede apagar. `morning_summary` y `reminders_sent` son de la spec 021, y
 * `billing_receipt` (un propietario subió el comprobante de su mensualidad), de la spec 029.
 */
export type PushKind =
  | "booking"
  | "receipt"
  | "patient_confirm"
  | "patient_cancel"
  | "new_appointment"
  | "unclosed"
  | "evening_summary"
  | "morning_summary"
  | "new_business"
  | "plan_request"
  | "account_security"
  | "login_attack"
  | "reminders_sent"
  | "billing_receipt"
  | "test";

/** Lo que necesita el front antes de activar los avisos (GET /api/push/config). */
export interface PushConfig {
  /** false: la API no tiene las claves del servicio de avisos (no se ofrece activarlos). */
  available: boolean;
  /** Clave pública VAPID en base64url (87 caracteres); null si no están disponibles. */
  publicKey: string | null;
  /** Los tipos del rol, en el orden de la tarjeta. */
  kinds: PushKind[];
}

/** El aparato (este navegador) con los avisos activados. La dirección y las claves nunca salen de la API. */
export interface PushDevice {
  /** Los tipos apagados en este aparato: los demás llegan (también los que se añadan en el futuro). */
  mutedKinds: PushKind[];
  createdAt: ISODateTime;
}

/* ----------------------------------------- Centro de avisos del panel (spec 014) -- */

/**
 * Los avisos de la campana del panel: los mismos tipos que en el celular, sin el aviso de prueba (R13).
 * Los ocho del negocio y los seis del super admin (ver src/lib/constants/notices.ts).
 */
export type NoticeKind = Exclude<PushKind, "test">;

/** Un aviso de la campana, ya armado para quien lo lee (con el nombre completo del paciente). */
export interface PanelNotice {
  id: string;
  kind: NoticeKind;
  /** «Nueva reserva» */
  title: string;
  /** «Mañana 16:00 · Limpieza · Juan Pérez» */
  body: string;
  /** La pantalla que abre al tocarlo: «/dashboard/calendar?date=…&appointment=…». */
  url: string;
  createdAt: ISODateTime;
  /** Esta persona ya lo leyó (cada una lleva el suyo). */
  read: boolean;
}

/** Una página de la campana o de la página «Avisos». */
export interface PanelNoticePage {
  notices: PanelNotice[];
  /** Los sin leer de esta persona (todos, no sólo los de esta página). */
  unread: number;
  /** Para «Cargar más»: el createdAt y el id del último («2026-10-15T09:12:00.000000Z|…»); null si no hay más. */
  nextCursor: string | null;
}
