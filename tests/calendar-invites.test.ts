// Las citas, como invitaciones de calendario (spec 027). El interruptor de cada agenda (apagado al
// principio): lo cambian el profesional en la suya y el propietario en cualquiera, nunca recepción; sin
// email no se activa; va a la actividad; al activarlo salen las citas de los próximos 14 días y no las de
// más lejos. El ciclo de una cita (REQUEST con SEQUENCE 0, el mismo UID con un número mayor en cada cambio,
// CANCEL al cancelarla), lo que no envía nada (el pago, las notas, «Confirmo que voy», las completadas,
// «No asistió» y una agenda apagada), las reservas por confirmar (TENTATIVE), el cambio de agenda, la
// ventana (una serie de 24 y el cron), el iCalendar según RFC 5545 y la privacidad del paciente: sólo su
// nombre a medias, nunca su cédula, su contacto, sus notas ni su historia clínica.
// Los arreglos de la auditoría (2026-10-22): el SEQUENCE crece por cita (dos agendas con el mismo email), la
// cancelación va al buzón que tiene el evento, el texto del email, las movidas lejos con el interruptor
// apagado, el reintento que llega tarde (se descarta como reemplazado), la invitación que agota los
// reintentos o queda en cola al reiniciar dev:local (vuelve a salir), el borrado de un paciente con la cita
// bloqueada por el cron y el paso de la ventana en el servidor local.
import pg from "pg";
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, fakeNtfy, login, runCron, sleep, sql, startApi } from "./helpers/harness.ts";
import { pool } from "../src/db/pool.ts";
import { resetUndeliveredInvitesSql } from "../src/services/calendar-invite-reset.ts";
import { buildInviteIcs, escapeIcsText, foldIcsLine, readdressInvite } from "../src/services/calendar-invites.ts";
import { MAX_ATTEMPTS, processEmailQueue, type OutgoingEmail } from "../src/services/mailer.ts";
import { EMAIL_PRIORITY, emailTypesOf } from "../src/services/email-limits.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { formatShortDate } from "../src/shared/lib/format.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Appointment, AuditLog, Professional, PublicBusinessProfile, SeriesDatePreview } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipCounter = 30;
const nextIp = () => `203.0.113.${ipCounter++}`;
const as = (email: string) => login(email, { ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental (Business, 3 agendas)
const elena = await as("elena@demo.com"); // recepción
const valeria = await as("valeria@demo.com"); // rol Profesional, con su agenda
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const timezone = sql(`select timezone from businesses where id = '${businessId}'`);
const slug = sql(`select slug from businesses where id = '${businessId}'`);
const today = getZonedNow(timezone).date;
const day = (offset: number) => addDaysISO(today, offset);

/** Las invitaciones de una cita, en el orden en que salieron. */
interface Invite {
  id: string;
  status: string;
  lastError: string | null;
  to: string;
  subject: string;
  body: string;
  html: string;
  calendar: string;
}
const invitesOf = (appointmentId: string): Invite[] =>
  JSON.parse(
    sql(`select coalesce(json_agg(json_build_object('id', id, 'status', status, 'lastError', last_error, 'to', to_email, 'subject', subject,
                                                  'body', body, 'html', html, 'calendar', calendar)
                                  order by created_at, calendar like '%METHOD:CANCEL%' desc), '[]')
           from notifications where type = 'calendar_invite' and appointment_id = '${appointmentId}'`),
  );
const totalInvites = () => count("select count(*) from notifications where type = 'calendar_invite'");
/** El iCalendar con las líneas desdobladas (RFC 5545, 3.1). */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const prop = (ics: string, name: string) =>
  unfold(ics)
    .split("\r\n")
    .find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`)) ?? "";
const value = (ics: string, name: string) => prop(ics, name).replace(/^[^:]*:/, "");
/** La hora del negocio en UTC, como la escribe el iCalendar: "20261020T110000Z". */
const utc = (date: string, time: string) =>
  sql(`select to_char(((date '${date}' + time '${time}') at time zone '${timezone}') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')`);
/** La ventana de la spec: de hoy a dentro de 14 días, en la hora del negocio. */
const inWindow = (a = "a") =>
  `(${a}.date >= (now() at time zone '${timezone}')::date and ((${a}.date + ${a}.start_time) at time zone '${timezone}') < now() + interval '14 days')`;
const auditOf = async (action: string) => ((await ricardo("GET", `${B}/audit-logs?action=${action}&limit=100`)).body?.entries ?? []) as AuditLog[];

console.log("El iCalendar (RFC 5545)");
ok(escapeIcsText("a\\b;c,d\ne") === "a\\\\b\\;c\\,d\\ne", "el texto escapa \\, ;, , y los saltos de línea (\\n)", escapeIcsText("a\\b;c,d\ne"));
const longLine = `DESCRIPTION:${"ñandú ".repeat(40)}`;
const folded = foldIcsLine(longLine).split("\r\n");
ok(
  folded.length > 1 &&
    folded.every((line) => Buffer.byteLength(line, "utf8") <= 75) &&
    folded.slice(1).every((line) => line.startsWith(" ")) &&
    folded.map((line, i) => (i === 0 ? line : line.slice(1))).join("") === longLine,
  "las líneas largas se doblan a 75 octetos, sin partir una ñ ni una tilde, y se desdoblan igual",
  folded.map((line) => Buffer.byteLength(line, "utf8")),
);
// En desarrollo (EMAIL_REDIRECT_TO), la invitación pasa a nombre de la cuenta de pruebas.
const attendeeIcs = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  foldIcsLine('ATTENDEE;CN="Psicóloga de una agenda con un nombre bastante largo";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:Agenda.Larga@Example.com'),
  "END:VCALENDAR",
].join("\r\n");
const readdressed = readdressInvite(attendeeIcs, "agenda.larga@example.com", "pruebas@example.org");
const unfolded = readdressed.replace(/\r\n[ \t]/g, "");
ok(
  /ATTENDEE;[^\r\n]*:mailto:pruebas@example\.org\r\n/.test(unfolded) &&
    !/agenda\.larga/i.test(unfolded) &&
    readdressed.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75) &&
    unfolded.includes("METHOD:REQUEST"),
  "desviada en desarrollo, la invitación va a nombre de la cuenta de pruebas (y sigue doblada a 75)",
  readdressed,
);
const sample = buildInviteIcs({
  method: "CANCEL",
  uid: "abc@agenda360",
  sequence: 4,
  start: "2026-10-20T20:00:00.000Z",
  end: "2026-10-20T20:50:00.000Z",
  summary: "Juan P. · Terapia",
  location: "",
  description: "Uno\nDos",
  url: "https://agenda360.example/dashboard/calendar?date=2026-10-20&appointment=abc",
  status: "CANCELLED",
  organizer: { name: "Agenda360", email: "agenda@example.com" },
  attendee: { name: 'Dra. "Ana", Ruiz', email: "ana@example.com" },
  stamp: new Date("2026-10-19T15:04:05.000Z"),
});
ok(
  /\r\nMETHOD:CANCEL\r\nBEGIN:VEVENT\r\n/.test(sample) &&
    value(sample, "DTSTART") === "20261020T200000Z" &&
    value(sample, "DTSTAMP") === "20261019T150405Z" &&
    !prop(sample, "LOCATION") &&
    value(sample, "DESCRIPTION") === "Uno\\nDos" &&
    prop(sample, "ATTENDEE").startsWith('ATTENDEE;CN="Dra. Ana, Ruiz";'),
  "METHOD en la cabecera, horas en UTC con Z, sin LOCATION si no hay lugar y el CN entre comillas",
  unfold(sample),
);

console.log("El interruptor");
let professionals: Professional[] = (await ricardo("GET", `${B}/professionals`)).body;
const [ricardoAgenda, valeriaAgenda, andres] = professionals;
ok(professionals.length === 3 && professionals.every((p) => p.calendarInvites === false), "apagado al principio en las tres agendas", professionals.map((p) => p.calendarInvites));
ok(
  valeriaAgenda.calendarEmail === "valeria@demo.com" && ricardoAgenda.calendarEmail === "ricardo@demo.com" && andres.calendarEmail === "",
  "a dónde llegarían: sin email de avisos, el de su usuario; Andrés no tiene ninguno",
  professionals.map((p) => [p.displayName, p.calendarEmail]),
);
const seenByValeria: Professional[] = (await valeria("GET", `${B}/professionals`)).body;
ok(
  seenByValeria.find((p) => p.id === ricardoAgenda.id)?.calendarEmail === "" && seenByValeria.find((p) => p.id === valeriaAgenda.id)?.calendarEmail === "valeria@demo.com",
  "el rol Profesional no ve el email de las otras agendas",
);
const toggle = (who: typeof ricardo, professionalId: string, calendarInvites: boolean) =>
  who("PATCH", `${B}/professionals/${professionalId}/calendar-invites`, { calendarInvites });
let r = await toggle(elena, valeriaAgenda.id, true);
ok(r.status === 403, "recepción no lo cambia", r.body);
r = await toggle(valeria, ricardoAgenda.id, true);
ok(r.status === 403 && /tu propia agenda/.test(r.body.error.message), "el profesional, sólo el de su agenda", r.body);
r = await toggle(ricardo, andres.id, true);
ok(r.status === 400 && /necesita un email/.test(r.body.error.message), "una agenda sin email no lo activa, con un mensaje claro", r.body);
r = await ricardo("PATCH", `${B}/professionals/${andres.id}/calendar-invites`, {});
ok(r.status === 400, "sin el valor: 400", r.body);
ok(count("select count(*) from audit_logs where action like 'professional.calendar_invites%'") === 0 && totalInvites() === 0, "nada cambió: ni la actividad ni los emails");

const expectedWindow = count(
  `select count(*) from appointments a where a.professional_id = '${valeriaAgenda.id}' and a.status in ('pending', 'confirmed') and ${inWindow()}`,
);
const fartherDemo = count(
  `select count(*) from appointments a where a.professional_id = '${valeriaAgenda.id}' and a.status in ('pending', 'confirmed') and a.date >= '${today}' and not ${inWindow()}`,
);
r = await toggle(valeria, valeriaAgenda.id, true);
ok(r.status === 200 && r.body.calendarInvites === true, "Valeria lo activa en su agenda", r.body);
const toValeria = () => count("select count(*) from notifications where type = 'calendar_invite' and to_email = 'valeria@demo.com'");
ok(expectedWindow > 0 && toValeria() === expectedWindow, `salen enseguida las de sus ${expectedWindow} citas de los próximos 14 días`, [toValeria(), expectedWindow]);
ok(
  count(
    `select count(*) from notifications n join appointments a on a.id = n.appointment_id
      where n.type = 'calendar_invite' and not ${inWindow()}`,
  ) === 0,
  `y ninguna de las de más lejos (${fartherDemo} en los datos demo)`,
);
let audit = await auditOf("professional.calendar_invites_enabled");
ok(
  audit.length === 1 && audit[0].summary === "Activó las invitaciones de calendario de la agenda de Dra. Valeria Cruz" && /Valeria/.test(audit[0].actorName),
  "va a la actividad, en palabras y con quién lo hizo",
  audit.map((l) => [l.summary, l.actorName]),
);
let before = totalInvites();
r = await toggle(valeria, valeriaAgenda.id, true);
ok(r.status === 200 && totalInvites() === before && (await auditOf("professional.calendar_invites_enabled")).length === 1, "activarlo otra vez no repite nada");

/** La ficha de una agenda tal como la manda el formulario de Profesionales. */
const formOf = (p: Professional) => ({
  displayName: p.displayName,
  title: p.title,
  avatarUrl: p.avatarUrl,
  color: p.color,
  email: p.email,
  meetingUrl: p.meetingUrl,
  bankAccounts: p.bankAccounts,
  userId: p.userId,
  allServices: p.allServices,
  serviceIds: p.serviceIds,
  notifyNewAppointments: p.notifyNewAppointments,
  dailyAgenda: p.dailyAgenda,
  isActive: p.isActive,
  calendarInvites: p.calendarInvites,
});
r = await ricardo("PUT", `${B}/professionals/${andres.id}`, { ...formOf(andres), calendarInvites: true });
ok(r.status === 400 && /necesita un email/.test(r.body.error.message), "en Profesionales tampoco se activa sin email", r.body);
r = await elena("PUT", `${B}/professionals/${ricardoAgenda.id}`, { ...formOf(ricardoAgenda), calendarInvites: true });
ok(r.status === 403, "recepción tampoco desde Profesionales", r.body);
const editsBefore = count(`select count(*) from audit_logs where action = 'professional.updated' and entity_id = '${ricardoAgenda.id}'`);
const expectedRicardo = count(
  `select count(*) from appointments a where a.professional_id = '${ricardoAgenda.id}' and a.status in ('pending', 'confirmed') and ${inWindow()}`,
);
r = await ricardo("PUT", `${B}/professionals/${ricardoAgenda.id}`, { ...formOf(ricardoAgenda), calendarInvites: true });
ok(r.status === 200 && r.body.calendarInvites === true, "el propietario lo activa desde Profesionales (aquí, en su propia agenda)", r.body);
ok(
  count("select count(*) from notifications where type = 'calendar_invite' and to_email = 'ricardo@demo.com'") === expectedRicardo,
  `y salen las de sus ${expectedRicardo} citas de la ventana`,
);
audit = await auditOf("professional.calendar_invites_enabled");
ok(
  audit.some((l) => l.summary === `Activó las invitaciones de calendario de la agenda de ${ricardoAgenda.displayName}`) &&
    count(`select count(*) from audit_logs where action = 'professional.updated' and entity_id = '${ricardoAgenda.id}'`) === editsBefore,
  "su propia entrada en la actividad, sin un «Editó» vacío",
  audit.map((l) => l.summary),
);

console.log("El ciclo de una cita");
const tag = Date.now().toString(36);
const patient = {
  name: "Martina Zambrano Ortega",
  cedula: cedulaFor(`martina-${tag}`),
  email: `martina.${tag}@correo.ec`,
  phone: "0991234567",
  notes: "Prefiere la tarde: dato privado de la ficha",
  allergies: "Alergia a la penicilina",
};
const martina = sql(
  `insert into clients (business_id, name, document_id, email, phone, notes)
   values ('${businessId}', '${patient.name}', '${patient.cedula}', '${patient.email}', '${patient.phone}', '${patient.notes}') returning id`,
).split("\n")[0];
sql(`insert into clinical_profiles (business_id, client_id, allergies, updated_by_name) values ('${businessId}', '${martina}', '${patient.allergies}', 'Prueba')`);
const consult = sql(`select id from services where business_id = '${businessId}' and name = 'Consulta odontológica'`);
const input = (fields: Record<string, unknown> = {}) => ({
  clientId: martina,
  serviceId: consult,
  date: day(3),
  startTime: "06:00",
  durationMinutes: 30,
  price: 20,
  status: "confirmed",
  notes: "Nota interna de la cita",
  professionalId: valeriaAgenda.id,
  ...fields,
});
r = await elena("POST", `${B}/appointments`, input());
ok(r.status === 200, "recepción agenda una cita a Valeria en 3 días", r.body);
const first: Appointment = r.body;
let list = invitesOf(first.id);
let ics = list[0]?.calendar ?? "";
ok(list.length === 1 && list[0].to === "valeria@demo.com", "le llega una invitación a Valeria (al email de su usuario)", list.map((i) => i.to));
ok(
  value(ics, "METHOD") === "REQUEST" && value(ics, "SEQUENCE") === "0" && value(ics, "UID") === `${first.id}@agenda360` && value(ics, "STATUS") === "CONFIRMED",
  "REQUEST con SEQUENCE:0, el UID de la cita y CONFIRMED",
  unfold(ics),
);
ok(
  value(ics, "DTSTART") === utc(day(3), "06:00") && value(ics, "DTEND") === utc(day(3), "06:30") && /^\d{8}T\d{6}Z$/.test(value(ics, "DTSTAMP")),
  `la hora del negocio, en UTC (${value(ics, "DTSTART")}), y DTSTAMP`,
  [value(ics, "DTSTART"), utc(day(3), "06:00")],
);
ok(
  ics.startsWith("BEGIN:VCALENDAR\r\nPRODID:-//Agenda360//ES\r\nVERSION:2.0\r\n") &&
    /\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n/.test(ics) &&
    ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n") &&
    !/[^\r]\n/.test(ics) &&
    ics.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75) &&
    /\r\n /.test(ics),
  "PRODID, VERSION y METHOD en la cabecera, CRLF y líneas dobladas a 75 octetos",
);
ok(value(ics, "SUMMARY") === "Martina Z. · Consulta odontológica", "el título: el paciente a medias y el servicio", value(ics, "SUMMARY"));
ok(value(ics, "LOCATION") === "Av. 9 de Octubre 1520\\, Guayaquil", "el lugar: la dirección del negocio, con la coma escapada", value(ics, "LOCATION"));
ok(
  value(ics, "DESCRIPTION").includes("Ver en Agenda360: http") &&
    value(ics, "DESCRIPTION").includes("\\nSi la cita cambia o se cancela\\, este evento se actualiza solo.") &&
    value(ics, "URL").endsWith(`/dashboard/calendar?date=${day(3)}&appointment=${first.id}`),
  "la descripción con «Ver en Agenda360» y su URL a la cita",
  [value(ics, "DESCRIPTION"), value(ics, "URL")],
);
ok(
  prop(ics, "ORGANIZER") === 'ORGANIZER;CN="Agenda360":mailto:avisos@agenda360.invalid' &&
    prop(ics, "ATTENDEE") === 'ATTENDEE;CN="Dra. Valeria Cruz";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:valeria@demo.com',
  "el organizador (sin Gmail en las pruebas, una dirección reservada) y Valeria como invitada, sin RSVP",
  [prop(ics, "ORGANIZER"), prop(ics, "ATTENDEE")],
);
ok(
  list[0].subject === `Cita: Martina Z. · Consulta odontológica · ${formatShortDate(day(3))}, 06:00` &&
    list[0].body.includes("Ver en Agenda360: http") &&
    list[0].body.includes("Añadir al calendario"),
  "el email: «Cita: …», el botón «Ver en Agenda360» y qué hacer la primera vez",
  list[0].subject,
);

r = await elena("PUT", `${B}/appointments/${first.id}`, input({ startTime: "06:30" }));
list = invitesOf(first.id);
ics = list[1]?.calendar ?? "";
ok(
  r.status === 200 &&
    list.length === 2 &&
    value(ics, "METHOD") === "REQUEST" &&
    value(ics, "SEQUENCE") === "1" &&
    value(ics, "UID") === `${first.id}@agenda360` &&
    value(ics, "DTSTART") === utc(day(3), "06:30") &&
    list[1].subject.startsWith("Cambió: Martina Z. · Consulta odontológica"),
  "moverla: «Cambió: …», REQUEST con SEQUENCE:1 y el mismo UID, a la hora nueva",
  list.map((i) => i.subject),
);
r = await elena("PATCH", `${B}/appointments/${first.id}/payment`, { paid: true });
ok(r.status === 200 && invitesOf(first.id).length === 2, "marcarla pagada no envía nada", r.body);
r = await elena("PUT", `${B}/appointments/${first.id}`, input({ startTime: "06:30", notes: "Otra nota interna", price: 25 }));
ok(r.status === 200 && invitesOf(first.id).length === 2, "cambiar sólo las notas y el precio, tampoco", r.body);
const token = sql(`select payment_token from appointments where id = '${first.id}'`);
const visitor = agent({ ip: nextIp() });
r = await visitor("POST", `/public/appointments/${token}/confirm`);
ok(r.status === 200 && invitesOf(first.id).length === 2, "«Confirmo que voy» del paciente, tampoco", r.body);
r = await elena("PATCH", `${B}/appointments/${first.id}/status`, { status: "cancelled", notify: false });
list = invitesOf(first.id);
ics = list[2]?.calendar ?? "";
ok(
  r.status === 200 &&
    list.length === 3 &&
    value(ics, "METHOD") === "CANCEL" &&
    /\r\nMETHOD:CANCEL\r\n/.test(ics) &&
    value(ics, "SEQUENCE") === "2" &&
    value(ics, "STATUS") === "CANCELLED" &&
    value(ics, "UID") === `${first.id}@agenda360` &&
    list[2].subject.startsWith("Cancelada: "),
  "cancelarla sin avisar al paciente: igual sale «Cancelada: …», CANCEL con SEQUENCE:2",
  list.map((i) => i.subject),
);
ok(count(`select count(*) from notifications where appointment_id = '${first.id}' and type = 'appointment_cancelled'`) === 0, "(y al paciente no le escribió nada)");
r = await elena("PATCH", `${B}/appointments/${first.id}/status`, { status: "confirmed" });
list = invitesOf(first.id);
ics = list[3]?.calendar ?? "";
ok(
  r.status === 200 && list.length === 4 && value(ics, "METHOD") === "REQUEST" && value(ics, "SEQUENCE") === "3" && list[3].subject.startsWith("Cambió: "),
  "reactivarla: REQUEST con SEQUENCE:3",
  list.map((i) => i.subject),
);

console.log("Privacidad");
/** Todo lo que sale en las invitaciones de una cita: el iCalendar (desdoblado), el asunto y el email. */
const contentOf = (appointmentId: string) =>
  invitesOf(appointmentId)
    .map((invite) => [invite.subject, invite.body, invite.html, unfold(invite.calendar)].join("\n"))
    .join("\n");
let content = contentOf(first.id);
const leaks = [patient.cedula, patient.email, patient.phone, "4567", "Zambrano", "Ortega", "penicilina", "Prefiere la tarde", "Nota interna", "Otra nota"].filter(
  (secret) => content.includes(secret),
);
ok(leaks.length === 0, "ni la cédula, ni el email, ni el teléfono, ni el nombre completo, ni las notas, ni la historia clínica", leaks);
ok(
  invitesOf(first.id).every((invite) => invite.calendar.includes("Martina Z.") && invite.body.includes("Martina Z.") && invite.calendar.includes(`appointment=${first.id}`)),
  "sí el nombre a medias y el enlace a la cita",
);
r = await elena("POST", `${B}/appointments`, input({ date: day(5), startTime: "07:00", homeVisit: { address: "Calle Escondida 742", reference: "Casa verde", lat: null, lng: null } }));
const atHome: Appointment = r.body;
content = contentOf(atHome.id);
ok(
  r.status === 200 && value(invitesOf(atHome.id)[0]?.calendar ?? "", "LOCATION") === "A domicilio" && !content.includes("Escondida") && !content.includes("Casa verde"),
  "a domicilio: «A domicilio», sin la dirección del paciente",
  value(invitesOf(atHome.id)[0]?.calendar ?? "", "LOCATION"),
);
r = await elena("POST", `${B}/appointments`, input({ date: day(5), startTime: "08:00", isVirtual: true }));
const online: Appointment = r.body;
ok(r.status === 200 && value(invitesOf(online.id)[0]?.calendar ?? "", "LOCATION") === "En línea", "virtual, sin sala todavía: «En línea»", invitesOf(online.id)[0]?.calendar);
ok(
  count(
    `select count(*) from notifications where type = 'calendar_invite' and to_email not in ('valeria@demo.com', 'ricardo@demo.com')`,
  ) === 0,
  "el paciente nunca recibe estas invitaciones: sólo los profesionales",
);

console.log("Varias personas, por confirmar y otra agenda");
sql(`update businesses set multi_client_appointments = true where id = '${businessId}'`);
const andrea = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${businessId}', 'Andrea Torres Vela', '${cedulaFor(`andrea-${tag}`)}', 'andrea.${tag}@correo.ec', '0987654321') returning id`,
).split("\n")[0];
r = await elena("POST", `${B}/appointments`, input({ date: day(5), startTime: "09:00", extraClientIds: [andrea] }));
const couple: Appointment = r.body;
ok(
  r.status === 200 && value(invitesOf(couple.id)[0]?.calendar ?? "", "SUMMARY") === "Martina Z. y Andrea T. · Consulta odontológica",
  "una sesión de dos: «Martina Z. y Andrea T. · …»",
  value(invitesOf(couple.id)[0]?.calendar ?? "", "SUMMARY"),
);

sql(
  `update businesses set booking_settings = booking_settings || '{"minNoticeHours": 0, "maxClientBookingsPerDay": 0, "allowCancellations": true, "cancellationNoticeHours": 24}'
    where id = '${businessId}'`,
);
const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
const context = { ...profile, settings: profile.business.bookingSettings, now: getZonedNow(timezone) };
let slot: { date: string; time: string } | null = null;
for (let d = 1; d < 13 && !slot; d++) {
  const time = getAvailableSlots(day(d), 30, scopeToProfessional(context, valeriaAgenda.id))[0];
  if (time) slot = { date: day(d), time };
}
ok(slot, "hay una hora libre con Valeria en la página de reservas", slot);
r = await visitor("POST", `/public/businesses/${slug}/bookings`, {
  serviceId: consult,
  date: slot!.date,
  startTime: slot!.time,
  documentId: cedulaFor(`joaquin-${tag}`),
  name: "Joaquín Ríos",
  email: `joaquin.${tag}@correo.ec`,
  phone: "+593 99 444 5555",
  notes: "",
  professionalId: valeriaAgenda.id,
});
const booked: string = r.body?.appointmentId;
list = invitesOf(booked);
ics = list[0]?.calendar ?? "";
ok(
  r.status === 200 &&
    list.length === 1 &&
    value(ics, "STATUS") === "TENTATIVE" &&
    value(ics, "SUMMARY") === "Por confirmar · Joaquín R. · Consulta odontológica" &&
    list[0].subject.startsWith("Cita: Por confirmar · Joaquín R."),
  "una reserva por la página: provisional (TENTATIVE), con «Por confirmar» delante",
  [r.body, value(ics, "SUMMARY")],
);
r = await ricardo("PATCH", `${B}/appointments/${booked}/status`, { status: "confirmed" });
list = invitesOf(booked);
ics = list[1]?.calendar ?? "";
ok(
  r.status === 200 && list.length === 2 && value(ics, "STATUS") === "CONFIRMED" && value(ics, "SEQUENCE") === "1" && value(ics, "SUMMARY") === "Joaquín R. · Consulta odontológica",
  "al confirmarla llega la actualización: CONFIRMED, sin «Por confirmar»",
  list.map((i) => i.subject),
);

r = await elena("POST", `${B}/appointments`, input({ date: day(4), startTime: "06:00" }));
const moving: Appointment = r.body;
r = await elena("PUT", `${B}/appointments/${moving.id}`, input({ date: day(4), startTime: "06:00", professionalId: ricardoAgenda.id }));
list = invitesOf(moving.id);
const toValeriaCancel = list.find((i) => i.to === "valeria@demo.com" && value(i.calendar, "METHOD") === "CANCEL");
const toRicardo = list.find((i) => i.to === "ricardo@demo.com");
ok(
  r.status === 200 &&
    list.length === 3 &&
    toValeriaCancel &&
    value(toValeriaCancel.calendar, "SEQUENCE") === "1" &&
    toValeriaCancel.subject.startsWith("Pasó a otra agenda: ") &&
    toRicardo &&
    value(toRicardo.calendar, "METHOD") === "REQUEST" &&
    // El SEQUENCE crece por cita, no por agenda (2026-10-22): la invitación nueva, uno más que la cancelación.
    value(toRicardo.calendar, "SEQUENCE") === "2" &&
    value(toRicardo.calendar, "UID") === `${moving.id}@agenda360` &&
    toRicardo.subject.startsWith("Cita: "),
  "pasarla a otra agenda: a Valeria le llega la cancelación y a Ricardo, la invitación",
  list.map((i) => [i.to, value(i.calendar, "METHOD"), value(i.calendar, "SEQUENCE"), i.subject]),
);
r = await elena("PUT", `${B}/appointments/${moving.id}`, input({ date: day(4), startTime: "06:00", professionalId: valeriaAgenda.id }));
list = invitesOf(moving.id);
ok(
  r.status === 200 &&
    list.length === 5 &&
    list.some((i) => i.to === "valeria@demo.com" && value(i.calendar, "METHOD") === "REQUEST" && value(i.calendar, "SEQUENCE") === "4") &&
    list.some((i) => i.to === "ricardo@demo.com" && value(i.calendar, "METHOD") === "CANCEL" && value(i.calendar, "SEQUENCE") === "3"),
  "y de vuelta: Ricardo, su cancelación (SEQUENCE:3), y Valeria la recibe con un número mayor (SEQUENCE:4)",
  list.map((i) => [i.to, value(i.calendar, "METHOD"), value(i.calendar, "SEQUENCE")]),
);

console.log("Lo que no envía nada");
r = await elena("POST", `${B}/appointments`, input({ date: today, startTime: "00:05" }));
const done1: Appointment = r.body;
r = await elena("POST", `${B}/appointments`, input({ date: today, startTime: "00:40" }));
const noShow: Appointment = r.body;
ok(invitesOf(done1.id).length === 1 && invitesOf(noShow.id).length === 1, "dos citas de hoy (ya empezadas): cuentan como cualquier otra");
r = await elena("PATCH", `${B}/appointments/${done1.id}/status`, { status: "completed", notify: false });
const r2 = await elena("PATCH", `${B}/appointments/${noShow.id}/status`, { status: "no_show", notify: false });
ok(
  r.status === 200 && r2.status === 200 && invitesOf(done1.id).length === 1 && invitesOf(noShow.id).length === 1,
  "completarla o marcarla «No asistió» no envía nada: ya pasó",
  [r.body, r2.body],
);
r = await elena("POST", `${B}/appointments`, input({ date: day(2), startTime: "06:00", professionalId: andres.id }));
ok(r.status === 200 && invitesOf(r.body.id).length === 0, "una agenda con el interruptor apagado (Andrés), nada", r.body);

console.log("Tu cita y borrar al paciente");
r = await elena("POST", `${B}/appointments`, input({ date: day(6), startTime: "06:00" }));
const byPatient: Appointment = r.body;
r = await agent({ ip: nextIp() })("POST", `/public/appointments/${sql(`select payment_token from appointments where id = '${byPatient.id}'`)}/cancel`);
list = invitesOf(byPatient.id);
ok(r.status === 200 && list.length === 2 && value(list[1].calendar, "METHOD") === "CANCEL", "el paciente la cancela desde «Tu cita»: sale la cancelación", [r.body, list.map((i) => i.subject)]);
const removable = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${businessId}', 'Paciente Borrable', '${cedulaFor(`borrable-${tag}`)}', 'borrable.${tag}@correo.ec', '0981112222') returning id`,
).split("\n")[0];
r = await elena("POST", `${B}/appointments`, input({ clientId: removable, date: day(7), startTime: "06:00" }));
const removed: Appointment = r.body;
ok(invitesOf(removed.id).length === 1, "una cita de un paciente que se va a borrar, ya en el calendario");
r = await ricardo("DELETE", `${B}/clients/${removable}`);
ok(
  r.status === 204 &&
    count(
      `select count(*) from notifications where type = 'calendar_invite' and calendar like '%UID:${removed.id}@agenda360%' and calendar like '%METHOD:CANCEL%'`,
    ) === 1,
  "al borrar al paciente (y sus citas), el evento se cancela antes",
  r.body,
);

console.log("La ventana de 14 días");
r = await elena("POST", `${B}/appointments`, input({ date: day(20), startTime: "06:00" }));
const far: Appointment = r.body;
ok(r.status === 200 && invitesOf(far.id).length === 0, "una cita a 20 días: nada todavía", r.body);
r = await elena("PUT", `${B}/appointments/${far.id}`, input({ date: day(21), startTime: "06:15" }));
ok(r.status === 200 && invitesOf(far.id).length === 0, "si cambia, tampoco: le llegará con los datos nuevos", r.body);
const seriesAppointment = input({ date: day(1), startTime: "05:00" });
r = await elena("POST", `${B}/appointment-series/preview`, { appointment: seriesAppointment, repeat: { frequency: "weekly", count: 24 } });
const rows = (r.body?.dates ?? []) as SeriesDatePreview[];
r = await elena("POST", `${B}/appointment-series`, {
  appointment: seriesAppointment,
  repeat: { frequency: "weekly", count: 24 },
  dates: rows.map((row) => ({ date: row.date, startTime: row.startTime, allowOutsideHours: true })),
});
const seriesIds = ((r.body?.created ?? []) as Appointment[]).map((a) => `'${a.id}'`).join(", ") || "null";
const seriesSent = count(`select count(*) from notifications where type = 'calendar_invite' and appointment_id in (${seriesIds})`);
const seriesInWindow = count(`select count(*) from appointments a where a.id in (${seriesIds}) and ${inWindow()}`);
ok(
  r.status === 201 && r.body.created.length === 24 && seriesSent === seriesInWindow && seriesSent >= 2 && seriesSent <= 3,
  `una serie de 24 semanales: sólo las ${seriesSent} de los próximos 14 días`,
  [r.status, r.body?.created?.length, seriesSent, seriesInWindow],
);

// Un cambio que viene de otro lado (la sala de videollamada de la agenda): lo recoge el cron.
professionals = (await ricardo("GET", `${B}/professionals`)).body;
r = await ricardo("PUT", `${B}/professionals/${valeriaAgenda.id}`, {
  ...formOf(professionals.find((p) => p.id === valeriaAgenda.id)!),
  meetingUrl: "https://meet.google.com/abc-defg-hij",
});
ok(r.status === 200 && r.body.calendarInvites === true && invitesOf(online.id).length === 1, "su sala de videollamada nueva: el interruptor sigue igual", r.body);

sql(`update appointments set date = '${day(10)}' where id = '${far.id}'`);
const ntfy = await fakeNtfy();
before = totalInvites();
const cronStarted = sql("select now()");
// El cron corre con otro APP_URL que la API de las pruebas: la huella no depende del origen de los enlaces.
let cron = await runCron(ntfy.url);
const lastReport = () => JSON.parse(sql("select report from cron_runs order by ran_at desc limit 1"));
let report = lastReport();
list = invitesOf(far.id);
ok(
  cron.code === 0 &&
    list.length === 1 &&
    value(list[0].calendar, "METHOD") === "REQUEST" &&
    value(list[0].calendar, "SEQUENCE") === "0" &&
    value(list[0].calendar, "DTSTART") === utc(day(10), "06:15"),
  "al llevarla a 10 días, el cron le envía la suya, ya con los datos nuevos",
  [cron.code, list.map((i) => i.subject), cron.output.slice(-400)],
);
const onlineList = invitesOf(online.id);
ok(
  onlineList.length === 2 && value(onlineList[1].calendar, "LOCATION") === "En línea · https://meet.google.com/abc-defg-hij" && value(onlineList[1].calendar, "SEQUENCE") === "1",
  "y la cita virtual sale actualizada, con el enlace de la sala",
  onlineList.map((i) => value(i.calendar, "LOCATION")),
);
const cronUpdates = count(
  `select count(*) from notifications
    where type = 'calendar_invite' and created_at >= '${cronStarted}' and subject like 'Cambió:%' and appointment_id <> '${online.id}'`,
);
ok(cronUpdates === 0, "las demás citas, sin cambios, no se reenvían (ni con otro APP_URL en el cron)", cronUpdates);
ok(
  report.calendarInvites === totalInvites() - before &&
    new RegExp(`invitaciones de calendario: ${report.calendarInvites} · `).test(cron.output) &&
    !/@/.test(cron.output.split("\n").find((line) => line.startsWith("Recordatorios:")) ?? "@"),
  `el registro del cron sólo lleva la cifra («invitaciones de calendario: ${report.calendarInvites}»)`,
  cron.output.split("\n").find((line) => line.startsWith("Recordatorios:")),
);
before = totalInvites();
cron = await runCron(ntfy.url);
report = lastReport();
ok(cron.code === 0 && invitesOf(far.id).length === 1 && totalInvites() === before && report.calendarInvites === 0, "en la siguiente pasada no se repite nada", report.calendarInvites);
ntfy.close();

console.log("Desactivarlo");
before = totalInvites();
r = await toggle(valeria, valeriaAgenda.id, false);
ok(r.status === 200 && r.body.calendarInvites === false && totalInvites() === before, "al desactivarlo no sale nada: los eventos que ya están no se borran", r.body);
audit = await auditOf("professional.calendar_invites_disabled");
ok(audit.length === 1 && audit[0].summary === "Desactivó las invitaciones de calendario de la agenda de Dra. Valeria Cruz", "va a la actividad", audit.map((l) => l.summary));
const firstInvites = invitesOf(first.id).length;
r = await elena("PUT", `${B}/appointments/${first.id}`, input({ startTime: "07:30" }));
ok(r.status === 200 && firstInvites === 4 && invitesOf(first.id).length === 4, "y después, los cambios de sus citas ya no le llegan", [firstInvites, invitesOf(first.id).length]);

console.log("Dos agendas con el mismo email (2026-10-22)");
r = await ricardo("PUT", `${B}/professionals/${andres.id}`, { ...formOf(andres), email: "ricardo@demo.com", calendarInvites: true });
ok(r.status === 200 && r.body.calendarEmail === "ricardo@demo.com" && r.body.calendarInvites, "Andrés recibe sus avisos en el email de Ricardo, con el interruptor", r.body);
r = await elena("POST", `${B}/appointments`, input({ date: day(6), startTime: "02:00", professionalId: ricardoAgenda.id }));
const shared: Appointment = r.body;
r = await elena("PUT", `${B}/appointments/${shared.id}`, input({ date: day(6), startTime: "02:00", professionalId: andres.id }));
list = invitesOf(shared.id);
ok(
  r.status === 200 &&
    list.length === 3 &&
    list.every((i) => i.to === "ricardo@demo.com") &&
    list.map((i) => `${value(i.calendar, "METHOD")} ${value(i.calendar, "SEQUENCE")}`).join() === "REQUEST 0,CANCEL 1,REQUEST 2",
  "la cita pasa de una a otra: el mismo buzón recibe la cancelación (1) y la invitación con un número mayor (2), que es la que se queda",
  list.map((i) => [i.to, value(i.calendar, "METHOD"), value(i.calendar, "SEQUENCE")]),
);
const movedCancel = list[1];
r = await ricardo("PUT", `${B}/professionals/${andres.id}`, { ...formOf(andres), email: "andres.vega@correo.ec", calendarInvites: true });
ok(r.status === 200 && r.body.calendarEmail === "andres.vega@correo.ec", "(Andrés pasa a su propio email: las pruebas de envío necesitan uno que no sea de demostración)", r.body);

console.log("La cancelación va al buzón que tiene el evento (2026-10-22)");
r = await elena("POST", `${B}/appointments`, input({ date: day(7), startTime: "02:00", professionalId: ricardoAgenda.id }));
const renamed: Appointment = r.body;
// El email de su usuario cambia sin pasar por Profesionales, y la cita se cancela antes de la siguiente pasada del cron.
sql(`update users set email = 'ricardo.nuevo@correo.ec' where email = 'ricardo@demo.com'`);
r = await elena("PATCH", `${B}/appointments/${renamed.id}/status`, { status: "cancelled", notify: false });
sql(`update users set email = 'ricardo@demo.com' where email = 'ricardo.nuevo@correo.ec'`);
list = invitesOf(renamed.id);
ok(
  r.status === 200 &&
    list.length === 2 &&
    value(list[1].calendar, "METHOD") === "CANCEL" &&
    list[1].to === "ricardo@demo.com" &&
    value(list[1].calendar, "ATTENDEE") === "mailto:ricardo@demo.com",
  "a ricardo@demo.com, donde está el evento, aunque la agenda tenga ya otro email (decisión del dueño)",
  list.map((i) => [i.to, value(i.calendar, "METHOD")]),
);

console.log("El texto del email (2026-10-22)");
const note = "Te llega porque tu agenda tiene activado «Recibir mis citas en mi calendario».";
ok(
  [list[1], movedCancel].every((i) => i.body.includes(note) && !i.body.includes("Añadir al calendario") && !i.html.includes("Añadir al calendario")),
  "la cancelación y «Pasó a otra agenda»: sin «activaste» y sin invitar a «Añadir al calendario»",
  [list[1].body, movedCancel.body],
);
ok(list[0].body.includes(note) && list[0].body.includes("Añadir al calendario"), "la invitación sí explica «Añadir al calendario»", list[0].body);

console.log("Apagado, movida lejos y vuelta a activar (2026-10-22)");
r = await toggle(valeria, valeriaAgenda.id, true);
r = await elena("POST", `${B}/appointments`, input({ date: day(4), startTime: "02:00" }));
const away: Appointment = r.body;
await toggle(valeria, valeriaAgenda.id, false);
r = await elena("PUT", `${B}/appointments/${away.id}`, input({ date: day(25), startTime: "02:00" }));
ok(r.status === 200 && invitesOf(away.id).length === 1, "apagado: moverla a 25 días no envía nada (por diseño)");
await toggle(valeria, valeriaAgenda.id, true);
list = invitesOf(away.id);
ok(
  list.length === 2 && value(list[1].calendar, "METHOD") === "REQUEST" && value(list[1].calendar, "SEQUENCE") === "1" && value(list[1].calendar, "DTSTART") === utc(day(25), "02:00"),
  "al activarlo otra vez, el evento pasa al día nuevo aunque esté fuera de la ventana",
  list.map((i) => [value(i.calendar, "SEQUENCE"), value(i.calendar, "DTSTART")]),
);

console.log("Un reintento que llega tarde (2026-10-22)");
r = await elena("POST", `${B}/appointments`, input({ date: day(8), startTime: "02:00", professionalId: andres.id }));
const retried: Appointment = r.body;
const firstTry = invitesOf(retried.id)[0];
// Gmail falló en el primer intento: el reintento queda para dentro de 5 minutos. Mientras, se cancela.
sql(`update notifications set attempts = 1, last_error = 'Timeout simulado', next_attempt_at = now() + interval '5 minutes' where id = '${firstTry.id}'`);
r = await elena("PATCH", `${B}/appointments/${retried.id}/status`, { status: "cancelled", notify: false });
const delivered: string[] = [];
const fakeGmail = async (email: OutgoingEmail) => {
  if (email.calendar?.includes(`UID:${retried.id}@agenda360`)) delivered.push(`${value(email.calendar, "METHOD")} ${value(email.calendar, "SEQUENCE")}`);
};
await processEmailQueue({ send: fakeGmail });
sql(`update notifications set next_attempt_at = now() where id = '${firstTry.id}'`);
await processEmailQueue({ send: fakeGmail });
const stale = invitesOf(retried.id)[0];
ok(
  delivered.join() === "CANCEL 1" && stale.status === "failed" && stale.lastError === "Invitación reemplazada por una versión más nueva.",
  "la invitación vieja no sale después de su cancelación: se descarta como reemplazada",
  { delivered, stale: [stale.status, stale.lastError] },
);

console.log("Una invitación que agota los reintentos (2026-10-22)");
r = await elena("POST", `${B}/appointments`, input({ date: day(9), startTime: "02:00", professionalId: andres.id }));
const lost: Appointment = r.body;
sql(`update notifications set attempts = ${MAX_ATTEMPTS - 1} where id = '${invitesOf(lost.id)[0].id}'`);
await processEmailQueue({
  send: async (email) => {
    if (email.calendar?.includes(`UID:${lost.id}@agenda360`)) throw new Error("421 Gmail no responde");
  },
});
ok(
  invitesOf(lost.id)[0].status === "failed" && sql(`select fingerprint from calendar_invites where appointment_id = '${lost.id}'`) === "",
  "el último intento falla: queda fallida y su fila de calendar_invites, sin huella",
  invitesOf(lost.id).map((i) => i.status),
);
const demoInvites = () => count("select count(*) from notifications where type = 'calendar_invite' and to_email like '%@demo.com'");
const demoBefore = demoInvites();
const ntfy2 = await fakeNtfy();
cron = await runCron(ntfy2.url);
list = invitesOf(lost.id);
ok(
  cron.code === 0 && list.length === 2 && list[1].status === "queued" && value(list[1].calendar, "SEQUENCE") === "1" && list[1].subject.startsWith("Cita: "),
  "la siguiente pasada del cron la vuelve a enviar entera, con un número mayor",
  list.map((i) => [i.status, value(i.calendar, "SEQUENCE"), i.subject]),
);
ok(demoInvites() === demoBefore, "las descartadas por ser de demostración no se reenvían (si no, se repetirían en cada pasada)", [demoBefore, demoInvites()]);

console.log("Al reiniciar dev:local con invitaciones en cola (2026-10-22)");
r = await elena("POST", `${B}/appointments`, input({ date: day(10), startTime: "02:00", professionalId: andres.id }));
const restarted: Appointment = r.body;
// Lo mismo que hace scripts/dev-local.ts al arrancar con Gmail.
sql(resetUndeliveredInvitesSql("n.status = 'queued'"));
sql("update notifications set status = 'failed', last_error = 'No enviado: estaba en cola antes de arrancar (pruebas en local)' where status = 'queued'");
cron = await runCron(ntfy2.url);
ntfy2.close();
list = invitesOf(restarted.id);
ok(
  cron.code === 0 &&
    list.length === 2 &&
    list[0].status === "failed" &&
    list[1].status === "queued" &&
    value(list[1].calendar, "SEQUENCE") === "1" &&
    list[1].subject.startsWith("Cita: "),
  "la invitación que no se envió vuelve a salir entera en la siguiente pasada («Cita:», no «Cambió:»)",
  list.map((i) => [i.status, value(i.calendar, "SEQUENCE"), i.subject]),
);

console.log("Borrar al paciente mientras el cron tiene la cita (2026-10-22)");
const lockedClient = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${businessId}', 'Paciente Bloqueada', '${cedulaFor(`bloqueada-${tag}`)}', 'bloqueada.${tag}@correo.ec', '0983334444') returning id`,
).split("\n")[0];
r = await elena("POST", `${B}/appointments`, input({ clientId: lockedClient, date: day(11), startTime: "02:00", professionalId: andres.id }));
const lockedAppointment: Appointment = r.body;
const cronLock = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await cronLock.connect();
await cronLock.query("begin");
// Como la tiene el cron mientras la sincroniza (syncLocked).
await cronLock.query("select 1 from appointments where id = $1 for no key update", [lockedAppointment.id]);
const deleting = ricardo("DELETE", `${B}/clients/${lockedClient}`);
await sleep(1500);
await cronLock.query("commit");
await cronLock.end();
r = await deleting;
ok(
  r.status === 204 &&
    count(
      `select count(*) from notifications where type = 'calendar_invite' and calendar like '%UID:${lockedAppointment.id}@agenda360%' and calendar like '%METHOD:CANCEL%'`,
    ) === 1,
  "el borrado espera a que la suelte y el evento se cancela igual",
  r.body,
);

console.log("El servidor local hace el paso de la ventana (2026-10-22)");
r = await elena("POST", `${B}/appointments`, input({ date: day(20), startTime: "02:30", professionalId: andres.id }));
const later: Appointment = r.body;
sql(`update appointments set date = '${day(12)}' where id = '${later.id}'`);
const localApi = await startApi({ CALENDAR_INVITE_JOB_INTERVAL_MINUTES: "1" });
for (let i = 0; i < 40 && invitesOf(later.id).length === 0; i++) await sleep(500);
localApi.stop();
ok(invitesOf(later.id).length === 1, "una cita que entra en la ventana recibe su invitación sin el cron de GitHub", localApi.output().slice(-300));

console.log("Los topes");
ok(EMAIL_PRIORITY.calendar_invite === "business" && emailTypesOf("business").includes("calendar_invite"), "cuentan como emails del negocio para el cupo de Gmail");

await pool.end();
done("de las invitaciones de calendario");
