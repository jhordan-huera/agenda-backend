// Copia de agenda-front/src/lib/constants/notices.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { NoticeKind } from "../../types/index.ts";

/**
 * Centro de avisos del panel (spec 014): qué tipos hay, a quién le llega cada uno en su campana y los
 * tiempos. Lo usan el front, la API (copia en agenda-backend/src/shared) y la beta.
 */

/** Los del negocio, en el orden de la tarjeta de los avisos en el celular. */
export const BUSINESS_NOTICE_KINDS = [
  "booking",
  "receipt",
  "patient_confirm",
  "patient_cancel",
  "new_appointment",
  "unclosed",
  "evening_summary",
] as const satisfies readonly NoticeKind[];

export type BusinessNoticeKind = (typeof BUSINESS_NOTICE_KINDS)[number];

/** Los del super admin, en su campana de /admin. */
export const PLATFORM_NOTICE_KINDS = ["new_business", "plan_request", "account_security", "login_attack"] as const satisfies readonly NoticeKind[];

export type PlatformNoticeKind = (typeof PLATFORM_NOTICE_KINDS)[number];

/** Los que hablan de una cita (llevan la cita y abren la cita). El resumen de las 8 abre la agenda del día. */
export const APPOINTMENT_NOTICE_KINDS = [
  "booking",
  "receipt",
  "patient_confirm",
  "patient_cancel",
  "new_appointment",
  "unclosed",
] as const satisfies readonly BusinessNoticeKind[];

/**
 * A quién le llega un aviso del negocio, según lo que la persona es HOY en el negocio (R2):
 * - `owner`: el propietario (`businesses.owner_id`) ve todas las agendas (`"all"`), sólo el del
 *   negocio entero (`"business"`, el resumen de las 8) o, con `null`, sólo lo de su agenda (por
 *   `agenda`, como cualquiera);
 * - `team`: los administradores y Recepción ven todas las agendas (`"all"`) o sólo lo de su agenda, si
 *   tienen una (`null`);
 * - `agenda`: quien tiene la agenda de la cita (la de hoy: si se movió, la nueva) o la del resumen, sea
 *   cual sea su rol. El rol Profesional sólo ve por aquí.
 *
 * Además, en todos: quien lo provocó no lo ve, sólo desde que entró al equipo y sólo los últimos
 * NOTICE_DAYS días. La consulta de la API y el repositorio de la beta siguen esta tabla, y las pruebas
 * comparan la API con ella (noticeVisibleTo en src/lib/notices.ts).
 */
export interface NoticeAudience {
  owner: "all" | "business" | null;
  team: "all" | null;
  agenda: boolean;
}

/** La tabla «Qué le llega a cada uno» de la spec 014, aprobada por el dueño el 2026-10-15. */
export const NOTICE_AUDIENCE: Record<BusinessNoticeKind, NoticeAudience> = {
  booking: { owner: "all", team: "all", agenda: true },
  receipt: { owner: "all", team: "all", agenda: true },
  patient_confirm: { owner: "all", team: "all", agenda: true },
  patient_cancel: { owner: "all", team: "all", agenda: true },
  // «Cita nueva en tu agenda»: a quien tenga esa agenda (también el propietario), nunca a quien la agendó.
  new_appointment: { owner: null, team: null, agenda: true },
  unclosed: { owner: "all", team: null, agenda: true },
  // El del negocio, al propietario; el de cada agenda, a quien la tiene (el propietario ya recibe el del negocio).
  evening_summary: { owner: "business", team: null, agenda: true },
};

/** Días que se guardan y se muestran los avisos (como la ventana de «Tu cita», spec 010). */
export const NOTICE_DAYS = 30;
/** Avisos de la lista de la campana. */
export const NOTICE_LIST_SIZE = 20;
/** Avisos por página, como mucho (la página «Avisos» con «Cargar más»). */
export const NOTICE_PAGE_MAX = 50;
/**
 * Cada cuánto se vuelve a pedir el contador con la pestaña visible (3 min). Es lo que más gasta la CPU de
 * Vercel (R6): si sube, se alarga aquí.
 */
export const NOTICE_REFRESH_MS = 180_000;
/** Avisos que guarda la beta en su base de localStorage, como mucho. */
export const BETA_MAX_NOTICES = 200;
