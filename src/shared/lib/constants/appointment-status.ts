// Copia de agenda-front/src/lib/constants/appointment-status.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { AppointmentStatus } from "../../types/index.ts";

interface StatusStyle {
  label: string;
  /** Badge en tablas y listas. */
  badge: string;
  /** Punto indicador (leyendas, calendario mensual). */
  dot: string;
  /** Bloque de la cita en las vistas día/semana. */
  event: string;
}

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
];

export const APPOINTMENT_STATUS_CONFIG: Record<AppointmentStatus, StatusStyle> = {
  pending: {
    label: "Pendiente",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
    dot: "bg-amber-500",
    event: "bg-amber-50 border-amber-400 text-amber-950 hover:bg-amber-100",
  },
  confirmed: {
    label: "Confirmada",
    badge: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
    dot: "bg-blue-500",
    event: "bg-blue-50 border-blue-500 text-blue-950 hover:bg-blue-100",
  },
  completed: {
    label: "Completada",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dot: "bg-emerald-500",
    event: "bg-emerald-50 border-emerald-500 text-emerald-950 hover:bg-emerald-100",
  },
  cancelled: {
    label: "Cancelada",
    badge: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20",
    dot: "bg-zinc-400",
    event: "bg-zinc-50 border-zinc-300 text-zinc-500 line-through hover:bg-zinc-100",
  },
  no_show: {
    label: "No asistió",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dot: "bg-rose-500",
    event: "bg-rose-50 border-rose-500 text-rose-950 hover:bg-rose-100",
  },
};

/** Estados que ocupan la agenda (impiden reservar esa franja). */
export const BLOCKING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "pending",
  "confirmed",
  "completed",
]);

/** Estados que cuentan como ingreso estimado. */
export const REVENUE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "pending",
  "confirmed",
  "completed",
]);

/* ------------------------------------------- Citas por cerrar (spec 018) -- */

/**
 * Una cita que ya terminó con uno de estos estados está «por cerrar». Lo usan la API, el front y la beta.
 */
export const OPEN_STATUSES: ReadonlySet<AppointmentStatus> = new Set(["pending", "confirmed"]);

/** Los botones de cada cita de la lista «Por cerrar», en ese orden. */
export const CLOSING_STATUSES = ["completed", "no_show", "cancelled"] as const satisfies readonly AppointmentStatus[];

export type ClosingStatus = (typeof CLOSING_STATUSES)[number];

/** Citas por tanda de la lista «Por cerrar» («Cargar más» trae las siguientes). */
export const TO_CLOSE_PAGE_SIZE = 50;

/** Citas que cierra, como mucho, un «Marcar todas como completadas» (una transacción). */
export const CLOSE_ALL_MAX = 200;

/**
 * Horas que dura un «Más tarde» de la pantalla «Antes de seguir, cierra tus citas pendientes», en ese
 * aparato (decisión del dueño del producto, 2026-10-15).
 */
export const CLOSE_LATER_HOURS = 4;
