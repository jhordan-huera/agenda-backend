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
