// Copia de agenda-front/src/lib/format.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from "./constants/app.ts";
import { parseISODate } from "./time.ts";
import type { ISODate, Service, TimeString } from "../types/index.ts";

export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * ¿Ven los clientes el precio de este servicio? No, si el profesional lo ocultó o si el
 * precio es 0 (significa que no quiere publicarlo, no que sea gratis).
 */
export function isPriceVisible(service: Pick<Service, "price" | "showPrice">): boolean {
  return service.showPrice && service.price > 0;
}

export function formatDate(iso: ISODate, pattern: string): string {
  return format(parseISODate(iso), pattern, { locale: es });
}

/** "martes, 30 de septiembre de 2026" */
export function formatLongDate(iso: ISODate): string {
  return formatDate(iso, "EEEE, d 'de' MMMM 'de' yyyy");
}

/** "mar 30 sep" */
export function formatShortDate(iso: ISODate): string {
  return formatDate(iso, "EEE d MMM");
}

/** "30/09/2026" */
export function formatNumericDate(iso: ISODate): string {
  return formatDate(iso, "dd/MM/yyyy");
}

/** "4 oct 2026, 14:35" en la zona horaria del negocio (timestamps de auditoría y emails). */
export function formatDateTime(iso: string, timezone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(
    new Date(iso),
  );
}

/** "14:35" de un instante, en la zona horaria del negocio (p. ej. la llegada de un paciente). */
export function formatClockTime(iso: string, timezone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-EC", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(
    new Date(iso),
  );
}

export function formatTimeRange(start: TimeString, end: TimeString): string {
  return `${start} – ${end}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "1 cita" / "3 citas" */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Contacto de soporte en texto: "soporte@x.com o al WhatsApp 099 406 0669" (el teléfono es opcional). */
export function formatSupportContact(settings: { supportEmail: string; supportPhone: string }): string {
  return settings.supportPhone ? `${settings.supportEmail} o al WhatsApp ${settings.supportPhone}` : settings.supportEmail;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function getFullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/** Texto comparable en búsquedas: sin acentos ni mayúsculas ("María" coincide con "maria"). */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
