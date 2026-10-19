import { createHash } from "node:crypto";
import { config } from "../config.ts";
import { agendaEmailSql } from "../db/columns.ts";
import { isUuid, many, type Db } from "../db/pool.ts";
import { CALENDAR_INVITE_DAYS } from "../shared/lib/constants/business.ts";
import { emailTemplates, type CalendarInviteEmailData } from "../shared/lib/email/templates.ts";
import { joinNames } from "../shared/lib/format.ts";
import type { AppointmentStatus } from "../shared/types/index.ts";
import { shortName } from "./masking.ts";
import { agendaUrlOf, queueEmail } from "./notifications.ts";

/**
 * Las citas, como invitaciones de calendario (spec 027). Con el interruptor de su agenda activado, cada
 * cita de hoy a los próximos CALENDAR_INVITE_DAYS días le llega al profesional por email como una
 * invitación (la de una reunión): Google, Apple y Outlook la añaden y, como cada cita es siempre el
 * mismo evento (mismo UID y un SEQUENCE mayor en cada cambio), la mueven si cambia y la quitan si se
 * cancela. Las de más lejos reciben la suya cuando entran en la ventana (el cron).
 *
 * Privacidad (constitución, principio II): los calendarios y sus widgets se ven en la pantalla de
 * bloqueo, así que el evento y el email llevan al paciente a medias ("Juan P.", masking.ts), el servicio,
 * la hora, el lugar (nunca la dirección de una visita a domicilio) y el enlace a la cita en el panel.
 * Nunca su contacto, su cédula, las notas ni nada de la historia clínica.
 *
 * Lo enviado a cada agenda por cada cita queda en calendar_invites, con la huella de lo que se ve en el
 * calendario: si no cambió, no sale nada. Enviar es automático y no va a la actividad.
 */

/* ------------------------------------------------------------- iCalendar -- */

export type InviteMethod = "REQUEST" | "CANCEL";

/** Un evento tal como sale en el iCalendar (RFC 5545). */
export interface InviteIcs {
  /** REQUEST: el evento nuevo o su versión nueva; CANCEL: quitarlo. */
  method: InviteMethod;
  uid: string;
  /** 0 la primera vez y uno más en cada cambio: el calendario se queda con el mayor. */
  sequence: number;
  /** Instantes en ISO ("2026-10-20T20:00:00.000Z"): salen en UTC, así no hace falta VTIMEZONE. */
  start: string;
  end: string;
  summary: string;
  /** "" = sin lugar. */
  location: string;
  description: string;
  url: string;
  status: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  /** DTSTAMP: cuándo se generó (por defecto, ahora). */
  stamp?: Date;
}

const CRLF = "\r\n";
/** Octetos de cada línea, sin el CRLF (RFC 5545, 3.1). */
const LINE_OCTETS = 75;

/** Texto de un valor TEXT (RFC 5545, 3.3.11): \, ;, , y los saltos de línea (como \n). */
export const escapeIcsText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Un parámetro (CN), entre comillas: sin comillas dentro ni saltos de línea (RFC 5545, 3.2). */
const paramValue = (value: string) => `"${value.replace(/["\r\n]/g, "").trim()}"`;

/** "20261020T200000Z" */
const icsDateTime = (at: string | Date) =>
  new Date(at)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");

/**
 * Dobla una línea a 75 octetos (RFC 5545, 3.1): las siguientes empiezan con un espacio, que cuenta. Nunca
 * parte un carácter UTF-8 (tildes, «», emojis).
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  let limit = LINE_OCTETS;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
      limit = LINE_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/**
 * En desarrollo los emails se desvían a la cuenta de pruebas (EMAIL_REDIRECT_TO): la invitación también
 * pasa a su nombre (el ATTENDEE), para que Gmail, Google Calendar o el iPhone la traten como propia y se
 * pueda comprobar de verdad que el evento se añade, se mueve y se quita.
 */
export function readdressInvite(calendar: string, from: string, to: string): string {
  const target = `mailto:${from}`.toLowerCase();
  return calendar
    .replace(/\r\n[ \t]/g, "")
    .split(CRLF)
    .map((line) => {
      const at = line.startsWith("ATTENDEE") ? line.toLowerCase().lastIndexOf(target) : -1;
      return foldIcsLine(at < 0 ? line : `${line.slice(0, at)}mailto:${to}${line.slice(at + target.length)}`);
    })
    .join(CRLF);
}

/** El iCalendar de la invitación: METHOD también en la cabecera del VCALENDAR, CRLF y líneas dobladas. */
export function buildInviteIcs(event: InviteIcs): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Agenda360//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${icsDateTime(event.stamp ?? new Date())}`,
    `DTSTART:${icsDateTime(event.start)}`,
    `DTEND:${icsDateTime(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `URL:${event.url}`,
    `STATUS:${event.status}`,
    "TRANSP:OPAQUE",
    `ORGANIZER;CN=${paramValue(event.organizer.name)}:mailto:${event.organizer.email}`,
    // Ya es su cita: sin pedirle que responda (RSVP=FALSE) y como aceptada, para que no quede «¿Asistirás?».
    `ATTENDEE;CN=${paramValue(event.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${event.attendee.email}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** El mismo evento para cada cita, en todos los calendarios. */
export const inviteUid = (appointmentId: string) => `${appointmentId}@agenda360`;

/**
 * El organizador: la cuenta de Gmail de la plataforma, que es la que envía. Sin Gmail (las pruebas y el
 * desarrollo sin credenciales), una dirección reservada que no recibe nada.
 */
const organizer = () => ({ name: config.gmail?.fromName ?? "Agenda360", email: config.gmail?.user ?? "avisos@agenda360.invalid" });

/* ------------------------------------------------------ Lo que se envía -- */

/** Una cita con lo que sale en su evento y su agenda actual. */
interface InviteSource {
  appointmentId: string;
  businessId: string;
  status: AppointmentStatus;
  professionalId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Inicio y fin en ISO (UTC), desde la hora del negocio en su zona. */
  startsAt: string;
  endsAt: string;
  /** Empieza de hoy (en la hora del negocio, aunque ya haya empezado) a dentro de CALENDAR_INVITE_DAYS días. */
  inWindow: boolean;
  isVirtual: boolean;
  /** A domicilio: el evento dice «A domicilio», sin la dirección del paciente. */
  homeVisit: boolean;
  serviceName: string;
  businessName: string;
  businessAddress: string;
  meetingUrl: string;
  /** Los pacientes con su nombre completo, el principal primero: el evento los lleva a medias. */
  clientNames: string[];
  /** La agenda de la cita: su interruptor, a dónde le llegan y su nombre. */
  enabled: boolean;
  agendaEmail: string;
  displayName: string;
}

/** Lo último que se le envió a una agenda por una cita (calendar_invites), con esa agenda como está ahora. */
interface SentInvite {
  appointmentId: string;
  professionalId: string;
  email: string;
  sequence: number;
  fingerprint: string;
  cancelled: boolean;
  enabled: boolean;
  agendaEmail: string;
  displayName: string;
}

/** Un email con su invitación (o su cancelación) a una agenda. */
interface InviteAction {
  method: InviteMethod;
  kind: CalendarInviteEmailData["kind"];
  professionalId: string;
  to: string;
  displayName: string;
  sequence: number;
}

/**
 * La cita empieza dentro de la ventana: de hoy (en la hora del negocio; una cita de hoy que ya empezó
 * cuenta como cualquier otra) a dentro de CALENDAR_INVITE_DAYS días. `a` y `b`: los alias de appointments
 * y businesses en la consulta.
 */
const inWindowSql = (a: string, b: string) =>
  `(${a}.date >= (now() at time zone ${b}.timezone)::date
    and ((${a}.date + ${a}.start_time) at time zone ${b}.timezone) < now() + interval '${CALENDAR_INVITE_DAYS} days')`;

/** Dónde es la cita, tal como sale en el evento: nunca la dirección de una visita a domicilio. */
function placeOf(source: InviteSource): string {
  if (source.isVirtual) return source.meetingUrl ? `En línea · ${source.meetingUrl}` : "En línea";
  if (source.homeVisit) return "A domicilio";
  return source.businessAddress || source.businessName;
}

/**
 * Lo que se ve en el calendario y su huella (sha256: sin datos legibles en calendar_invites). El título
 * lleva a los pacientes a medias y, si está por confirmar, «Por confirmar · » delante.
 */
function eventOf(source: InviteSource, cancelled: boolean) {
  const clientNames = source.clientNames.map(shortName);
  const pending = !cancelled && source.status === "pending";
  const summary = `${pending ? "Por confirmar · " : ""}${joinNames(clientNames)} · ${source.serviceName}`;
  const location = placeOf(source);
  const url = agendaUrlOf({ id: source.appointmentId, date: source.date });
  const description = [
    source.isVirtual && source.meetingUrl ? `Videollamada: ${source.meetingUrl}` : null,
    `Ver en Agenda360: ${url}`,
    "Si la cita cambia o se cancela, este evento se actualiza solo.",
  ]
    .filter(Boolean)
    .join("\n");
  const status = cancelled ? "CANCELLED" : pending ? "TENTATIVE" : "CONFIRMED";
  // Sin el enlace ni la descripción, que salen de la cita, de su fecha y de la sala (ya en el lugar) más el
  // origen de la web: así la API y el cron dan la misma huella aunque los configuren con otro APP_URL.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([source.startsAt, source.endsAt, summary, location, status]))
    .digest("hex");
  return { clientNames, summary, location, description, url, status, fingerprint } as const;
}

/**
 * Qué sale para una cita, comparando lo que debería haber en cada calendario con lo enviado:
 * - las completadas y las «No asistió» no se tocan: ya pasaron;
 * - a cada agenda que la tiene y ya no debe (se canceló, se borra o pasó a otra agenda), su cancelación,
 *   si esa agenda sigue con el interruptor y un email (apagado, ya no le llega nada);
 * - a la agenda de la cita, si está por confirmar o confirmada y tiene el interruptor y un email: la
 *   primera invitación (o la de después de una cancelación) sólo dentro de la ventana, con SEQUENCE 0 o
 *   uno más; si ya está en su calendario, cada cambio de la huella o del email sale enseguida, aunque
 *   la cita quede fuera de la ventana.
 * `removing`: la cita se va a borrar (con su paciente): sólo las cancelaciones.
 */
function planInvites(source: InviteSource, sent: SentInvite[], removing: boolean): InviteAction[] {
  if (source.status === "completed" || source.status === "no_show") return [];
  const active = !removing && (source.status === "pending" || source.status === "confirmed");
  const actions: InviteAction[] = [];
  for (const invite of sent) {
    if (invite.cancelled || !invite.enabled || !invite.agendaEmail) continue;
    const own = invite.professionalId === source.professionalId;
    if (own && active) continue;
    actions.push({
      method: "CANCEL",
      kind: own ? "cancelled" : "moved",
      professionalId: invite.professionalId,
      to: invite.agendaEmail,
      displayName: invite.displayName,
      sequence: invite.sequence + 1,
    });
  }
  if (!active || !source.enabled || !source.agendaEmail) return actions;
  const own = sent.find((invite) => invite.professionalId === source.professionalId);
  const request = (kind: InviteAction["kind"], sequence: number) =>
    actions.push({
      method: "REQUEST",
      kind,
      professionalId: source.professionalId,
      to: source.agendaEmail,
      displayName: source.displayName,
      sequence,
    });
  if (!own || own.cancelled) {
    if (source.inWindow) request(own ? "updated" : "new", own ? own.sequence + 1 : 0);
  } else if (own.fingerprint !== eventOf(source, false).fingerprint || own.email !== source.agendaEmail) {
    // Otro email (cambió el de la agenda): para ese calendario es la primera.
    request(own.email === source.agendaEmail ? "updated" : "new", own.sequence + 1);
  }
  return actions;
}

/** Pone en cola el email con su invitación y anota lo enviado a esa agenda. */
async function sendInvite(db: Db, source: InviteSource, action: InviteAction): Promise<void> {
  const event = eventOf(source, action.method === "CANCEL");
  const calendar = buildInviteIcs({
    method: action.method,
    uid: inviteUid(source.appointmentId),
    sequence: action.sequence,
    start: source.startsAt,
    end: source.endsAt,
    summary: event.summary,
    location: event.location,
    description: event.description,
    url: event.url,
    status: event.status,
    organizer: organizer(),
    attendee: { name: action.displayName, email: action.to },
  });
  await queueEmail(db, {
    businessId: source.businessId,
    type: "calendar_invite",
    to: action.to,
    appointmentId: source.appointmentId,
    calendar,
    ...emailTemplates.calendarInvite({
      kind: action.kind,
      summary: event.summary,
      clientNames: event.clientNames,
      serviceName: source.serviceName,
      professionalName: action.displayName,
      businessName: source.businessName,
      date: source.date,
      startTime: source.startTime,
      endTime: source.endTime,
      place: event.location,
      agendaUrl: event.url,
    }),
  });
  await db.query(
    `insert into calendar_invites (appointment_id, professional_id, email, sequence, fingerprint, cancelled, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (appointment_id, professional_id) do update
       set email = excluded.email, sequence = excluded.sequence, fingerprint = excluded.fingerprint,
           cancelled = excluded.cancelled, updated_at = now()`,
    [source.appointmentId, action.professionalId, action.to, action.sequence, event.fingerprint, action.method === "CANCEL"],
  );
}

/** Qué falló, sin datos: el código de PostgreSQL y el mensaje (sin emails). */
function describeError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message.replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[email]").slice(0, 200) : "error";
  return typeof code === "string" ? `${code} ${text}` : text;
}

async function syncLocked(db: Db, ids: string[], removing: boolean): Promise<number> {
  // Sólo las que tienen algo que ver con los calendarios (casi siempre, ninguna: el interruptor empieza
  // apagado). Bloqueadas hasta el fin de la transacción (como las bloquea un update: no chocan con quien
  // sólo las referencia, p. ej. un email nuevo de la cita); las que cambia otra transacción (o el cron)
  // se saltan: esa transacción las sincroniza, y si no, la siguiente pasada del cron.
  const locked = await many<{ id: string }>(
    db,
    `select a.id from appointments a
      where a.id = any($1::uuid[])
        and (exists (select 1 from professionals p where p.id = a.professional_id and p.calendar_invites)
             or exists (select 1 from calendar_invites ci where ci.appointment_id = a.id))
        for no key update of a skip locked`,
    [ids],
  );
  if (locked.length === 0) return 0;
  const lockedIds = locked.map((row) => row.id);
  const sources = await many<InviteSource>(
    db,
    `select a.id as "appointmentId", a.business_id as "businessId", a.status, a.professional_id as "professionalId",
            a.date, a.start_time as "startTime", a.end_time as "endTime",
            (a.date + a.start_time) at time zone b.timezone as "startsAt",
            (a.date + a.end_time) at time zone b.timezone as "endsAt",
            ${inWindowSql("a", "b")} as "inWindow",
            a.is_virtual as "isVirtual", a.home_visit is not null as "homeVisit",
            s.name as "serviceName", b.name as "businessName", b.address as "businessAddress",
            coalesce(p.meeting_url, '') as "meetingUrl",
            array(select c.name
                    from (select a.client_id as id, 0 as ord, null::timestamptz as created_at
                          union all
                          select ac.client_id, 1, ac.created_at from appointment_clients ac where ac.appointment_id = a.id) x
                    join clients c on c.id = x.id
                   order by x.ord, x.created_at, x.id) as "clientNames",
            p.calendar_invites as enabled, ${agendaEmailSql("p")} as "agendaEmail", p.display_name as "displayName"
       from appointments a
       join businesses b on b.id = a.business_id
       join services s on s.id = a.service_id
       join professionals p on p.id = a.professional_id
      where a.id = any($1::uuid[])
      order by a.date, a.start_time`,
    [lockedIds],
  );
  const sent = await many<SentInvite>(
    db,
    `select ci.appointment_id as "appointmentId", ci.professional_id as "professionalId", ci.email, ci.sequence,
            ci.fingerprint, ci.cancelled, p.calendar_invites as enabled, ${agendaEmailSql("p")} as "agendaEmail",
            p.display_name as "displayName"
       from calendar_invites ci
       join professionals p on p.id = ci.professional_id
      where ci.appointment_id = any($1::uuid[])`,
    [lockedIds],
  );
  let queued = 0;
  for (const source of sources) {
    const actions = planInvites(
      source,
      sent.filter((invite) => invite.appointmentId === source.appointmentId),
      removing,
    );
    for (const action of actions) {
      await sendInvite(db, source, action);
      queued++;
    }
  }
  return queued;
}

/**
 * Pone al día los calendarios de estas citas: lo llama, en la misma transacción, todo lo que crea o
 * cambia algo que se ve en el evento (fecha, horas, servicio, agenda, estado, pacientes, modalidad); los
 * cambios que vienen de otro lado (el nombre de un servicio, la dirección del negocio) los recoge el
 * cron. Si algo falla, vuelve a su punto de guardado y la transacción sigue: el cambio de la cita y sus
 * emails se guardan igual. Devuelve cuántas invitaciones (o cancelaciones) quedaron en cola.
 * `removing`: las citas se van a borrar (al eliminar a su paciente): les llega la cancelación antes.
 */
export async function syncCalendarInvites(db: Db, appointmentIds: string[], options: { removing?: boolean } = {}): Promise<number> {
  const ids = [...new Set(appointmentIds.filter(isUuid))];
  if (ids.length === 0) return 0;
  let savepoint = false;
  try {
    await db.query("savepoint invitacion_calendario");
    savepoint = true;
    const queued = await syncLocked(db, ids, options.removing ?? false);
    await db.query("release savepoint invitacion_calendario");
    return queued;
  } catch (error) {
    if (savepoint) await db.query("rollback to savepoint invitacion_calendario").catch(() => undefined);
    console.error(`[calendario] No se pudieron preparar las invitaciones de calendario: ${describeError(error)}`);
    return 0;
  }
}

/**
 * Las citas de la ventana que pueden necesitar algo: las activas de las agendas con el interruptor y las
 * que tienen una invitación sin cancelar (p. ej. una cancelada mientras otra transacción la tenía). De un
 * negocio (el cron) o de una agenda (al activar su interruptor). Sin la huella cambiada no sale nada.
 */
export async function upcomingInviteIds(db: Db, filter: { businessId?: string; professionalId?: string }): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select a.id from appointments a
       join businesses b on b.id = a.business_id
      where ($1::uuid is null or a.business_id = $1::uuid)
        and ($2::uuid is null or a.professional_id = $2::uuid)
        and a.status in ('pending', 'confirmed', 'cancelled')
        and ${inWindowSql("a", "b")}
        and ((a.status <> 'cancelled' and exists (select 1 from professionals p where p.id = a.professional_id and p.calendar_invites))
             or exists (select 1 from calendar_invites ci where ci.appointment_id = a.id and not ci.cancelled))
      order by a.date, a.start_time`,
    [filter.businessId ?? null, filter.professionalId ?? null],
  );
  return rows.map((row) => row.id);
}

/** Los negocios activos con alguna agenda que recibe sus citas en el calendario (el cron). */
export async function businessesWithCalendarInvites(db: Db): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select distinct p.business_id as id
       from professionals p join businesses b on b.id = p.business_id
      where p.calendar_invites and b.status = 'active'`,
  );
  return rows.map((row) => row.id);
}
