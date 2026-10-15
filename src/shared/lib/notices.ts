// Copia de agenda-front/src/lib/notices.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { DEFAULT_TIMEZONE } from "./constants/app.ts";
import { NOTICE_AUDIENCE, type BusinessNoticeKind } from "./constants/notices.ts";
import { capitalize, formatShortDate, joinNames, plural } from "./format.ts";
import { addDaysISO, getZonedNow } from "./time.ts";
import type { BusinessRole, ISODate, NoticeKind, TimeString } from "../types/index.ts";

/**
 * Qué dice cada aviso (specs 013 y 014): los mismos textos en el celular, en la campana del panel y en
 * la beta. Sólo cambia cómo va el paciente (`name`):
 * - en el celular, a medias («Juan P.», con shortName de la API);
 * - en la campana, con su nombre completo («Juan Pérez», decisión 4 del dueño, 2026-10-15), porque
 *   está dentro del panel, donde el equipo ya lo ve así.
 *
 * Nunca la cédula, el email, el teléfono ni nada de la historia clínica (principio II). El servicio sí
 * va («Limpieza»), y el profesional («· con Dra. Pérez») sólo si el negocio tiene más de una agenda
 * activa. El día se calcula al armar el texto, en la zona del negocio: «Hoy 16:00», «Mañana 16:00» o
 * «Mar 20 oct 16:00» (el aviso de ayer dice «Hoy» si la cita es hoy).
 */

/** La cita como la cuentan los avisos: sólo lo que se muestra. */
export interface NoticeAppointment {
  id: string;
  date: ISODate;
  startTime: TimeString;
  /** La zona del negocio. */
  timezone: string;
  /** Agendas activas del negocio: con más de una, el aviso dice de quién es. */
  agendas: number;
  serviceName: string | null;
  professionalName: string | null;
  /** El principal primero y después los demás, en su orden. `toVerify`: «Por verificar» (spec 009). */
  patients: { name: string; toVerify: boolean }[];
}

/** Lo que necesita cada tipo de aviso para armar su texto. */
export interface NoticeDataByKind {
  booking: { appointment: NoticeAppointment };
  receipt: { appointment: NoticeAppointment };
  /** `confirmedBy`: quien pulsó «Confirmo que voy» (en una sesión con varias personas, cada una). */
  patient_confirm: { appointment: NoticeAppointment; confirmedBy: string };
  patient_cancel: { appointment: NoticeAppointment };
  /** `count`: una serie de citas (spec 011), contada con la primera. */
  new_appointment: { appointment: NoticeAppointment; count?: number };
  unclosed: { appointment: NoticeAppointment };
  evening_summary: { date: ISODate; count: number };
  new_business: { businessId: string; businessName: string; categoryName: string | null };
  plan_request: { businessId: string; businessName: string; currentPlanName: string; requestedPlanName: string };
  /** `account`: ya enmascarada («ma***@gmail.com»). */
  account_security: { account: string; change: string };
  /** `others`: cuántas cuentas más tienen intentos fallidos. */
  login_attack: { account: string; attempts: number; others: number };
}

export interface NoticeText {
  title: string;
  body: string;
  /** Ruta del propio sitio que abre al tocarlo. */
  url: string;
}

export interface DescribeNoticeOptions {
  /** Cómo va cada paciente: a medias en el celular, el nombre tal cual en la campana. */
  name: (fullName: string) => string;
  /** El momento en que se lee: de él salen «Hoy» y «Mañana» (por defecto, ahora). */
  now?: Date;
}

/** Hoy en la zona del negocio (con una zona inválida, la de Ecuador: un aviso no debe fallar por eso). */
function todayIn(timezone: string, now: Date): ISODate {
  try {
    return getZonedNow(timezone, now).date;
  } catch {
    return getZonedNow(DEFAULT_TIMEZONE, now).date;
  }
}

/** «hoy», «mañana» o «mar 20 oct». */
function dayLabel(date: ISODate, timezone: string, now: Date): string {
  const today = todayIn(timezone, now);
  if (date === today) return "hoy";
  if (date === addDaysISO(today, 1)) return "mañana";
  return formatShortDate(date);
}

/** «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00». */
export const describeWhen = (date: ISODate, time: TimeString, timezone: string, now: Date = new Date()) =>
  `${capitalize(dayLabel(date, timezone, now))} ${time}`;

/** La cita en la agenda (con su ficha abierta). */
export const appointmentUrl = (appointment: Pick<NoticeAppointment, "id" | "date">) =>
  `/dashboard/calendar?date=${appointment.date}&appointment=${appointment.id}`;

const ACTIVITY_SECURITY_URL = "/admin/activity?ver=seguridad";

type Builder<K extends NoticeKind> = (data: NoticeDataByKind[K], options: Required<DescribeNoticeOptions>) => NoticeText;

/** «Juan P.» / «Juan Pérez», «Juan P. y Ana M.» o «Juan P., Ana M. y Luis R.». */
const patientsOf = (appointment: NoticeAppointment, name: DescribeNoticeOptions["name"]) =>
  joinNames(appointment.patients.map((patient) => name(patient.name)));

/** «· con Dra. Pérez», sólo si el negocio tiene más de una agenda activa. */
const withProfessional = (appointment: NoticeAppointment) =>
  appointment.agendas > 1 && appointment.professionalName ? ` · con ${appointment.professionalName}` : "";

const when = (appointment: NoticeAppointment, now: Date) => describeWhen(appointment.date, appointment.startTime, appointment.timezone, now);

const BUILDERS: { [K in NoticeKind]: Builder<K> } = {
  booking: ({ appointment }, { name, now }) => ({
    title: "Nueva reserva",
    body: `${when(appointment, now)} · ${appointment.serviceName ?? "Cita"} · ${patientsOf(appointment, name)}${withProfessional(appointment)}${
      appointment.patients.some((patient) => patient.toVerify) ? " · Por verificar" : ""
    }`,
    url: appointmentUrl(appointment),
  }),
  receipt: ({ appointment }, { name, now }) => ({
    title: "Comprobante de pago",
    body: `${patientsOf(appointment, name)} · ${when(appointment, now)}`,
    url: appointmentUrl(appointment),
  }),
  patient_confirm: ({ appointment, confirmedBy }, { name, now }) => ({
    title: "El paciente confirmó",
    body: `${when(appointment, now)} · ${name(confirmedBy)}`,
    url: appointmentUrl(appointment),
  }),
  patient_cancel: ({ appointment }, { name, now }) => ({
    title: "Cita cancelada por el paciente",
    body: `${when(appointment, now)} · ${patientsOf(appointment, name)}`,
    url: appointmentUrl(appointment),
  }),
  new_appointment: ({ appointment, count }, { name, now }) => {
    if (!count || count < 2) {
      return { title: "Cita nueva en tu agenda", body: `${when(appointment, now)} · ${patientsOf(appointment, name)}`, url: appointmentUrl(appointment) };
    }
    // Una serie: «8 citas desde el mar 20 oct 10:00», «desde hoy 10:00» o «desde mañana 10:00».
    const day = dayLabel(appointment.date, appointment.timezone, now);
    const from = day === "hoy" || day === "mañana" ? day : `el ${day}`;
    return {
      title: "Citas nuevas en tu agenda",
      body: `${count} citas desde ${from} ${appointment.startTime} · ${patientsOf(appointment, name)}`,
      url: appointmentUrl(appointment),
    };
  },
  unclosed: ({ appointment }, { name }) => ({
    title: "Cita por cerrar",
    body: `${appointment.startTime} · ${appointment.serviceName ?? "Cita"} · ${patientsOf(appointment, name)}${withProfessional(appointment)}: márcala Completada o No asistió`,
    url: appointmentUrl(appointment),
  }),
  evening_summary: ({ date, count }) => ({
    title: `Tienes ${plural(count, "cita", "citas")} de hoy sin cerrar`,
    body: `${count === 1 ? "Márcala" : "Márcalas"} Completada o No asistió para que la agenda y los reportes cuadren.`,
    url: `/dashboard/calendar?date=${date}`,
  }),
  new_business: ({ businessId, businessName, categoryName }) => ({
    title: "Negocio nuevo",
    body: categoryName ? `${businessName} · ${categoryName}` : businessName,
    url: `/admin/businesses/${businessId}`,
  }),
  plan_request: ({ businessId, businessName, currentPlanName, requestedPlanName }) => ({
    title: "Solicitud de cambio de plan",
    body: `${businessName} · de ${currentPlanName} a ${requestedPlanName}`,
    url: `/admin/businesses/${businessId}`,
  }),
  account_security: ({ account, change }) => ({
    title: "Cambio de seguridad en una cuenta de super admin",
    body: `${account} · ${change}`,
    url: ACTIVITY_SECURITY_URL,
  }),
  login_attack: ({ account, attempts, others }) => ({
    title: "Posibles intentos de adivinar contraseñas",
    body: `${account}: ${attempts} intentos fallidos en la última hora${others > 0 ? ` y ${plural(others, "cuenta más", "cuentas más")}` : ""}`,
    url: ACTIVITY_SECURITY_URL,
  }),
};

/** El título, el texto y la pantalla de un aviso, en el celular o en la campana. */
export function describeNotice<K extends NoticeKind>(kind: K, data: NoticeDataByKind[K], options: DescribeNoticeOptions): NoticeText {
  const build = BUILDERS[kind] as Builder<K>;
  return build(data, { name: options.name, now: options.now ?? new Date() });
}

/* ------------------------------------------------------- Quién lo ve (R2) -- */

/** Lo que la persona es HOY en el negocio. */
export interface NoticeViewer {
  /** Es `businesses.owner_id` (no basta el rol: si el propietario cambia, el anterior deja de verlos). */
  isOwner: boolean;
  role: BusinessRole;
  /** Su agenda: el profesional activo del negocio con su usuario (sea cual sea su rol), o null. */
  agendaId: string | null;
}

/** El aviso, con la agenda de HOY de su cita (o la del resumen: null en el del negocio entero). */
export interface NoticeTarget {
  kind: BusinessNoticeKind;
  agendaId: string | null;
}

/**
 * ¿Le llega este aviso a esta persona? La tabla NOTICE_AUDIENCE, tal cual. Aparte (en la consulta de la
 * API y en la beta) van las otras tres reglas: quien lo provocó no lo ve, sólo desde que entró al equipo
 * y sólo los últimos NOTICE_DAYS días.
 */
export function noticeVisibleTo(viewer: NoticeViewer, target: NoticeTarget): boolean {
  const audience = NOTICE_AUDIENCE[target.kind];
  if (viewer.isOwner && audience.owner === "all") return true;
  if (viewer.isOwner && audience.owner === "business") return target.agendaId === null;
  if (!viewer.isOwner && (viewer.role === "admin" || viewer.role === "staff") && audience.team === "all") return true;
  // Por su agenda: cualquiera (el propietario sólo si su regla no es otra).
  const byAgenda = audience.agenda && (!viewer.isOwner || audience.owner === null);
  return byAgenda && viewer.agendaId !== null && target.agendaId === viewer.agendaId;
}
