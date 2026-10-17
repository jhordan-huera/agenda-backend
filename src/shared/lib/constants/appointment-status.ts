// Copia de agenda-front/src/lib/constants/appointment-status.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { AppointmentStatus } from "../../types/index.ts";

/*
 * Modo oscuro (spec 019): cada clase lleva su `dark:`. El fondo, el mismo color al 15 % (en el bloque de la
 * agenda, mezclado con --card para que no se transparenten las líneas de las horas); el texto, claro, y el
 * borde y el punto, un tono más claro que en el claro para que se vean sobre el fondo oscuro.
 */
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
    badge:
      "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40",
    dot: "bg-amber-500 dark:bg-amber-400",
    event:
      "bg-amber-50 border-amber-400 text-amber-950 hover:bg-amber-100 dark:border-amber-400 dark:bg-[color-mix(in_oklab,var(--color-amber-500)_15%,var(--card))] dark:text-amber-100 dark:hover:bg-[color-mix(in_oklab,var(--color-amber-500)_24%,var(--card))]",
  },
  confirmed: {
    label: "Confirmada",
    badge:
      "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/40",
    dot: "bg-blue-500 dark:bg-blue-400",
    event:
      "bg-blue-50 border-blue-500 text-blue-950 hover:bg-blue-100 dark:border-blue-400 dark:bg-[color-mix(in_oklab,var(--color-blue-500)_15%,var(--card))] dark:text-blue-100 dark:hover:bg-[color-mix(in_oklab,var(--color-blue-500)_24%,var(--card))]",
  },
  completed: {
    label: "Completada",
    badge:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    event:
      "bg-emerald-50 border-emerald-500 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-400 dark:bg-[color-mix(in_oklab,var(--color-emerald-500)_15%,var(--card))] dark:text-emerald-100 dark:hover:bg-[color-mix(in_oklab,var(--color-emerald-500)_24%,var(--card))]",
  },
  cancelled: {
    label: "Cancelada",
    badge:
      "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/40",
    dot: "bg-zinc-400 dark:bg-zinc-500",
    event:
      "bg-zinc-50 border-zinc-300 text-zinc-500 line-through hover:bg-zinc-100 dark:border-zinc-600 dark:bg-[color-mix(in_oklab,var(--color-zinc-500)_10%,var(--card))] dark:text-zinc-400 dark:hover:bg-[color-mix(in_oklab,var(--color-zinc-500)_18%,var(--card))]",
  },
  no_show: {
    label: "No asistió",
    badge:
      "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/40",
    dot: "bg-rose-500 dark:bg-rose-400",
    event:
      "bg-rose-50 border-rose-500 text-rose-950 hover:bg-rose-100 dark:border-rose-400 dark:bg-[color-mix(in_oklab,var(--color-rose-500)_15%,var(--card))] dark:text-rose-100 dark:hover:bg-[color-mix(in_oklab,var(--color-rose-500)_24%,var(--card))]",
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

/* ------------------------------------------ Las citas completadas quedan fijas (spec 020) -- */

/**
 * Una cita «Completada» queda fija: no cambia de estado ni de datos, salvo el pago, los comprobantes y las
 * notas. Sólo el propietario la corrige, con un motivo (decisión del dueño del producto, 2026-10-16).
 */
export const LOCKED_STATUS = "completed" satisfies AppointmentStatus;

/** Los estados a los que el propietario puede corregir una cita completada («Corregir estado»). */
export const CORRECTABLE_FROM_COMPLETED = ["confirmed", "no_show", "cancelled"] as const satisfies readonly AppointmentStatus[];

export type CorrectableStatus = (typeof CORRECTABLE_FROM_COMPLETED)[number];

/**
 * Lo que ofrece «Corregir estado»: «Confirmada» sólo si la cita aún no terminó. Una cita que ya pasó y
 * vuelve a «Confirmada» quedaría otra vez por cerrar y bloquearía el panel (spec 018).
 */
export function correctionTargets(ended: boolean): readonly CorrectableStatus[] {
  return ended ? CORRECTABLE_FROM_COMPLETED.filter((status) => status !== "confirmed") : CORRECTABLE_FROM_COMPLETED;
}

/** Lo que responde la API si se corrige a «Confirmada» una cita que ya terminó. */
export const ENDED_CORRECTION_MESSAGE =
  "Esta cita ya terminó: corrígela a «No asistió» o «Cancelada». «Confirmada» sólo se usa si la cita aún no pasó.";

/**
 * Si una cita puede pasar de `from` a `to`. Lo usan la API, el front y la beta:
 * - desde «Completada», a nada (sólo la corrección del propietario);
 * - a «Pendiente», sólo desde «Pendiente»: ninguna cita vuelve a Pendiente una vez que salió;
 * - lo demás, sí («No asistió» y «Cancelada» se siguen cambiando).
 */
export function canChangeStatus(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === LOCKED_STATUS) return false;
  if (to === "pending") return from === "pending";
  return true;
}

/**
 * Las citas del panel nacen confirmadas: «Pendiente» es sólo para las reservas online, que el negocio
 * todavía tiene que confirmar (decisión del dueño del producto, 2026-10-17). Desde el panel se puede
 * crear también como Completada, No asistió o Cancelada, para registrar una sesión que ya pasó.
 */
export const PANEL_PENDING_MESSAGE = "Las citas del panel se crean confirmadas: «Pendiente» es sólo para las reservas online.";

/** Lo que dicen la API y la ficha de una cita completada. */
export const LOCKED_STATUS_MESSAGE = "Esta cita está completada: ya no se puede cambiar. El propietario puede corregirla con un motivo.";

/** Lo que responde la API si se intenta cambiar algo más que las notas de una cita completada. */
export const LOCKED_FIELDS_MESSAGE = "Esta cita está completada: sólo se pueden cambiar sus notas, el pago y los comprobantes.";

/** Por qué una cita no puede pasar de `from` a `to` (null: sí puede). Es el mensaje de la API y la ayuda de la ficha. */
export function statusChangeError(from: AppointmentStatus, to: AppointmentStatus): string | null {
  if (canChangeStatus(from, to)) return null;
  if (from === LOCKED_STATUS) return LOCKED_STATUS_MESSAGE;
  if (from === "confirmed") return "Una cita confirmada no vuelve a Pendiente.";
  return "Una cita no vuelve a Pendiente: para reactivarla, márcala como Confirmada.";
}
