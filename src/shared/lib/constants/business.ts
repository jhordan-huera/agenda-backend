// Copia de agenda-front/src/lib/constants/business.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type {
  BookingSettings,
  DayOfWeek,
  NotificationSettings,
  ServiceMode,
  TimeRange,
} from "../../types/index.ts";

/**
 * Zonas horarias admitidas, con el país del negocio: prefijo telefónico (enlaces de
 * WhatsApp), código ISO (búsqueda de direcciones) y ciudad principal (centro inicial del mapa).
 */
export const TIMEZONES: {
  value: string;
  label: string;
  callingCode: string;
  countryCode: string;
  center: [lat: number, lng: number];
}[] = [
  { value: "America/Guayaquil", label: "Ecuador (GMT-5)", callingCode: "593", countryCode: "ec", center: [-0.1807, -78.4678] },
  { value: "America/Bogota", label: "Colombia (GMT-5)", callingCode: "57", countryCode: "co", center: [4.711, -74.0721] },
  { value: "America/Lima", label: "Perú (GMT-5)", callingCode: "51", countryCode: "pe", center: [-12.0464, -77.0428] },
  { value: "America/Mexico_City", label: "México – Ciudad de México (GMT-6)", callingCode: "52", countryCode: "mx", center: [19.4326, -99.1332] },
  { value: "America/Panama", label: "Panamá (GMT-5)", callingCode: "507", countryCode: "pa", center: [8.9824, -79.5199] },
  { value: "America/Caracas", label: "Venezuela (GMT-4)", callingCode: "58", countryCode: "ve", center: [10.4806, -66.9036] },
  { value: "America/La_Paz", label: "Bolivia (GMT-4)", callingCode: "591", countryCode: "bo", center: [-16.4897, -68.1193] },
  { value: "America/Santiago", label: "Chile (Santiago)", callingCode: "56", countryCode: "cl", center: [-33.4489, -70.6693] },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (GMT-3)", callingCode: "54", countryCode: "ar", center: [-34.6037, -58.3816] },
  { value: "America/Montevideo", label: "Uruguay (GMT-3)", callingCode: "598", countryCode: "uy", center: [-34.9011, -56.1645] },
  { value: "America/Sao_Paulo", label: "Brasil – São Paulo (GMT-3)", callingCode: "55", countryCode: "br", center: [-23.5505, -46.6333] },
  { value: "America/New_York", label: "EE. UU. – Este", callingCode: "1", countryCode: "us", center: [40.7128, -74.006] },
  { value: "America/Los_Angeles", label: "EE. UU. – Pacífico", callingCode: "1", countryCode: "us", center: [34.0522, -118.2437] },
  { value: "Europe/Madrid", label: "España – Madrid", callingCode: "34", countryCode: "es", center: [40.4168, -3.7038] },
];

export function getTimezoneInfo(timezone: string) {
  return TIMEZONES.find((zone) => zone.value === timezone) ?? TIMEZONES[0];
}

/** Dónde se presta un servicio (formulario de servicios y página pública). */
export const SERVICE_MODES: { value: ServiceMode; label: string; description: string }[] = [
  { value: "business", label: "En el local", description: "El cliente viene a tu negocio." },
  { value: "home", label: "A domicilio", description: "Vas a casa del cliente: marca su ubicación al reservar." },
  { value: "virtual", label: "Virtual", description: "Por videollamada: el paciente recibe el enlace de cada profesional (Profesionales → Editar)." },
];

/** "En el local", "Virtual", "En el local o virtual", "En el local, a domicilio o virtual". */
export function describeServiceModes(modes: ServiceMode[]): string {
  const labels = SERVICE_MODES.filter((mode) => modes.includes(mode.value)).map((mode, index) =>
    index === 0 ? mode.label : mode.label.toLowerCase(),
  );
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} o ${labels.at(-1)}`;
}

/** Días ordenados de lunes a domingo, como se muestran en la interfaz. */
export const WEEK_DAYS: { value: DayOfWeek; label: string; short: string }[] = [
  { value: 1, label: "Lunes", short: "Lun" },
  { value: 2, label: "Martes", short: "Mar" },
  { value: 3, label: "Miércoles", short: "Mié" },
  { value: 4, label: "Jueves", short: "Jue" },
  { value: 5, label: "Viernes", short: "Vie" },
  { value: 6, label: "Sábado", short: "Sáb" },
  { value: 0, label: "Domingo", short: "Dom" },
];

export const SLOT_INTERVAL_OPTIONS = [15, 30, 45, 60];
export const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180];

/**
 * Anticipación mínima con que los clientes reservan desde la página pública, al crear un negocio.
 * Cada profesional la cambia en Configuración → Agenda (de 0 a 720 horas). Desde su panel puede
 * agendar a cualquier hora (incluso para dentro de una hora).
 */
export const DEFAULT_MIN_NOTICE_HOURS = 24;

/**
 * Citas por día que una misma persona puede reservar desde la página pública (lo cambia cada
 * negocio en Configuración → Agenda; 0 = sin límite).
 */
export const DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY = 1;

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  alignSlotsToDuration: true,
  slotIntervalMinutes: 30,
  minNoticeHours: DEFAULT_MIN_NOTICE_HOURS,
  maxAdvanceDays: 60,
  allowCancellations: true,
  cancellationNoticeHours: 24,
  cancellationPolicy: "Puedes cancelar o reprogramar tu cita sin costo hasta 24 horas antes.",
  maxClientBookingsPerDay: DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY,
  chooseProfessional: true,
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  confirmations: true,
  reminders: true,
  cancellations: true,
  reminderHoursBefore: 24,
  whatsappOnStatusChange: true,
  whatsappFollowUps: true,
};

/** Horario sugerido en el onboarding: lunes a viernes 08:00–17:00, sábado 09:00–13:00, domingo cerrado. */
export const DEFAULT_WEEKLY_SCHEDULE: { dayOfWeek: DayOfWeek; isActive: boolean; intervals: TimeRange[] }[] =
  WEEK_DAYS.map(({ value }) => ({
    dayOfWeek: value,
    isActive: value !== 0,
    intervals: [value === 6 ? { start: "09:00", end: "13:00" } : { start: "08:00", end: "17:00" }],
  }));
