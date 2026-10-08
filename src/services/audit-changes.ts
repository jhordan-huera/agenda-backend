import { isDeepStrictEqual } from "node:util";
import { APPOINTMENT_STATUS_CONFIG } from "../shared/lib/constants/appointment-status.ts";
import { WEEK_DAYS, describeServiceModes, getTimezoneInfo } from "../shared/lib/constants/business.ts";
import { formatCurrency, formatDuration, formatNumericDate } from "../shared/lib/format.ts";
import type {
  AppointmentStatus,
  AuditChange,
  BookingSettings,
  BrandColors,
  Business,
  Client,
  NotificationSettings,
  Schedule,
  Service,
  ServiceMode,
} from "../shared/types/index.ts";

/**
 * Qué cambió en una edición, para la auditoría: "Precio: $20 → $25". Los valores se guardan ya
 * formateados en español (así se leen igual en el panel y al exportar). Los textos largos o
 * privados (notas, descripciones) sólo dicen que cambiaron, sin guardar su contenido.
 */
interface ChangeField<T> {
  key: keyof T & string;
  label: string;
  format?: (value: never) => string;
  /** Sólo se indica que cambió: el contenido no se copia a la auditoría. */
  hideValues?: boolean;
}

const text = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const yesNo = (value: boolean) => (value ? "Sí" : "No");
const money = (value: number) => formatCurrency(value);
const hours = (value: number) => `${value} h`;

export function diffChanges<T extends object>(before: T, after: T, fields: ChangeField<T>[]): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const previous = before[field.key];
    const next = after[field.key];
    if (isDeepStrictEqual(previous, next)) continue;
    if (field.hideValues) {
      changes.push({ label: field.label, before: null, after: null });
      continue;
    }
    const format = (field.format ?? text) as (value: unknown) => string;
    changes.push({ label: field.label, before: format(previous), after: format(next) });
  }
  return changes;
}

export const CLIENT_FIELDS: ChangeField<Client>[] = [
  { key: "name", label: "Nombre" },
  { key: "documentId", label: "Cédula" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Teléfono" },
  { key: "address", label: "Dirección" },
  { key: "notes", label: "Notas", hideValues: true },
  { key: "isActive", label: "Activo", format: yesNo },
];

/** El servicio con el nombre de su formato clínico (lo resuelve quien llama). */
export type ServiceForAudit = Service & { clinicalTemplateName: string | null };

export const SERVICE_FIELDS: ChangeField<ServiceForAudit>[] = [
  { key: "name", label: "Nombre" },
  { key: "description", label: "Descripción", hideValues: true },
  { key: "durationMinutes", label: "Duración", format: formatDuration },
  { key: "price", label: "Precio", format: money },
  { key: "showPrice", label: "Precio visible", format: yesNo },
  { key: "modes", label: "Modalidad", format: (value: ServiceMode[]) => describeServiceModes(value) },
  { key: "homeVisitFee", label: "Recargo a domicilio", format: money },
  { key: "clinicalTemplateName", label: "Formato de historia clínica" },
  { key: "isActive", label: "Activo", format: yesNo },
];

/** Una cita con los nombres que se muestran (los resuelve quien llama). */
export interface AppointmentForAudit {
  date: string;
  time: string;
  clientName: string;
  serviceName: string;
  professionalName: string;
  status: AppointmentStatus;
  price: number;
  notes: string;
  homeAddress: string | null;
  /** "En el local", "A domicilio" o "Virtual". */
  modality: string;
}

export const APPOINTMENT_FIELDS: ChangeField<AppointmentForAudit>[] = [
  { key: "date", label: "Fecha", format: formatNumericDate },
  { key: "time", label: "Hora" },
  { key: "clientName", label: "Cliente" },
  { key: "serviceName", label: "Servicio" },
  { key: "professionalName", label: "Profesional" },
  { key: "status", label: "Estado", format: (value: AppointmentStatus) => APPOINTMENT_STATUS_CONFIG[value].label },
  { key: "price", label: "Precio", format: money },
  { key: "modality", label: "Modalidad" },
  { key: "homeAddress", label: "Dirección a domicilio" },
  { key: "notes", label: "Notas", hideValues: true },
];

/** Horario semanal por día: "08:00–13:00, 14:00–18:00" o "Cerrado". */
export function scheduleChanges(before: Schedule[], after: Schedule[]): AuditChange[] {
  const describe = (week: Schedule[], day: number) => {
    const schedule = week.find((item) => item.dayOfWeek === day);
    if (!schedule?.isActive || schedule.intervals.length === 0) return "Cerrado";
    return schedule.intervals.map((interval) => `${interval.start}–${interval.end}`).join(", ");
  };
  return WEEK_DAYS.flatMap((day) => {
    const previous = describe(before, day.value);
    const next = describe(after, day.value);
    return previous === next ? [] : [{ label: day.label, before: previous, after: next }];
  });
}

/** Un profesional con los nombres que se muestran (los resuelve quien llama). */
export interface ProfessionalForAudit {
  displayName: string;
  title: string;
  avatarUrl: string | null;
  color: string;
  email: string;
  meetingUrl: string;
  /** "Banco Pichincha · Ahorros · 2200123456 · Ana Ruiz" (null: sin datos bancarios). */
  bankAccount: string | null;
  memberName: string | null;
  servicesLabel: string;
  notifyNewAppointments: boolean;
  dailyAgenda: boolean;
  isActive: boolean;
}

export const PROFESSIONAL_FIELDS: ChangeField<ProfessionalForAudit>[] = [
  { key: "displayName", label: "Nombre" },
  { key: "title", label: "Especialidad" },
  { key: "avatarUrl", label: "Foto", hideValues: true },
  { key: "color", label: "Color", format: (value: string) => value.toUpperCase() },
  { key: "email", label: "Email de avisos" },
  { key: "meetingUrl", label: "Enlace de videollamada" },
  { key: "bankAccount", label: "Datos bancarios", format: (value: string | null) => value ?? "Sin datos bancarios" },
  { key: "memberName", label: "Usuario del equipo", format: (value: string | null) => value ?? "Sin usuario" },
  { key: "servicesLabel", label: "Servicios que atiende" },
  { key: "notifyNewAppointments", label: "Aviso de cada cita nueva", format: yesNo },
  { key: "dailyAgenda", label: "Agenda del día por email", format: yesNo },
  { key: "isActive", label: "Activo", format: yesNo },
];

/** El negocio con el nombre de su categoría y la ubicación en una sola clave. */
export type BusinessForAudit = Business & { categoryName: string; location: string | null };

const BOOKING_FIELDS: ChangeField<BookingSettings>[] = [
  { key: "alignSlotsToDuration", label: "Horas según la duración del servicio", format: yesNo },
  { key: "slotIntervalMinutes", label: "Intervalo entre horas", format: formatDuration },
  { key: "minNoticeHours", label: "Anticipación mínima para reservar", format: hours },
  { key: "maxAdvanceDays", label: "Anticipación máxima para reservar", format: (value: number) => `${value} días` },
  { key: "allowCancellations", label: "El cliente puede cancelar", format: yesNo },
  { key: "cancellationNoticeHours", label: "Antelación para cancelar", format: hours },
  { key: "cancellationPolicy", label: "Política de cancelación", hideValues: true },
  {
    key: "maxClientBookingsPerDay",
    label: "Citas por día por cliente desde la página",
    format: (value: number) => (value === 0 ? "Sin límite" : String(value)),
  },
  { key: "chooseProfessional", label: "El paciente elige con quién atenderse", format: yesNo },
];

const NOTIFICATION_FIELDS: ChangeField<NotificationSettings>[] = [
  { key: "confirmations", label: "Emails de reserva y confirmación", format: yesNo },
  { key: "reminders", label: "Recordatorios", format: yesNo },
  { key: "cancellations", label: "Emails de cancelación", format: yesNo },
  { key: "reminderHoursBefore", label: "Recordatorio con antelación de", format: hours },
  { key: "whatsappOnStatusChange", label: "Aviso por WhatsApp al confirmar, cancelar o reprogramar", format: yesNo },
  { key: "whatsappFollowUps", label: "Aviso por WhatsApp al completar o marcar No asistió", format: yesNo },
];

const BUSINESS_FIELDS: ChangeField<BusinessForAudit>[] = [
  { key: "name", label: "Nombre" },
  { key: "slug", label: "Enlace de reservas", format: (value: string) => `/book/${value}` },
  { key: "description", label: "Descripción", hideValues: true },
  { key: "categoryName", label: "Tipo de negocio" },
  { key: "timezone", label: "Zona horaria", format: (value: string) => getTimezoneInfo(value).label },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Email" },
  { key: "address", label: "Dirección" },
  { key: "location", label: "Ubicación en el mapa", hideValues: true },
  { key: "logoUrl", label: "Logo", hideValues: true },
  { key: "clinicalRecordsEnabled", label: "Historia clínica", format: (value: boolean) => (value ? "Activada" : "Desactivada") },
  {
    key: "professionalScope",
    label: "Pacientes que ve cada profesional",
    format: (value: string) => (value === "own" ? "Sólo los suyos" : "Todos"),
  },
  {
    key: "brandColors",
    label: "Colores de la marca",
    format: (value: BrandColors | null) =>
      value ? `${value.primary.toUpperCase()} y ${value.highlight.toUpperCase()}` : "Los de Agenda360",
  },
];

export function businessChanges(before: BusinessForAudit, after: BusinessForAudit): AuditChange[] {
  return [
    ...diffChanges(before, after, BUSINESS_FIELDS),
    ...diffChanges(before.bookingSettings, after.bookingSettings, BOOKING_FIELDS),
    ...diffChanges(before.notificationSettings, after.notificationSettings, NOTIFICATION_FIELDS),
  ];
}
