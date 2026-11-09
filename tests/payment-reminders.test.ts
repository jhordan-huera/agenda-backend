// Recordatorios del comprobante de pago (spec 039). El interruptor «Pedir el comprobante de pago» es sólo del
// super admin (el propietario y el modo soporte no lo cambian), va a la actividad del negocio y de la
// plataforma, y al activarlo todas las agendas toman el modo por defecto. El modo de cada agenda lo cambian el
// profesional en la suya y quien gestiona los profesionales en cualquiera (recepción no; sin activar, 409). El
// paso diario (queuePaymentReminders, con el momento como parámetro para avanzar los días): los tres juegos de
// días del modo «Antes», el modo «Después», uno al día desde las 9:00, el tope de 3, nunca el día de la reserva
// ni después de empezar la cita, y que se detienen con el comprobante, el pago, la cancelación y «No asistió».
// Un email por paciente y día con todas sus citas; sólo el principal de una sesión en pareja; nada sin email,
// gratis, sin cuentas o en un negocio sin activar; sin copia al profesional y sin actividad. Al subir el
// comprobante, el profesional de la agenda recibe el email y el aviso en el celular. El cupo, la etiqueta del
// cron y el registro sólo con la cifra. Datos inventados en fechas lejanas (dentro de unos 200 días).
import { cedulaFor } from "./helpers/cedula.mjs";
import { BASE, agent, checks, count, fakeNtfy, fakePushService, login, runCron, sql } from "./helpers/harness.ts";
import { EMAIL_PRIORITY, emailTypesOf } from "../src/services/email-limits.ts";
import { AGENDA_PUSH_KINDS, AGENDA_RECEIPT_PUSH_KINDS } from "../src/shared/lib/constants/push.ts";
import { addDaysISO, getDayOfWeek, getZonedNow } from "../src/shared/lib/time.ts";
import type { AuditLog, Business, Professional } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const push = await fakePushService();
const { queuePaymentReminders } = await import("../src/jobs/scheduled-tasks.ts");
const ORIGIN = new URL(BASE).origin;

let ipSeq = 0;
const nextIp = () => `198.18.0.${(ipSeq++ % 250) + 1}`;
const as = (email: string) => login(email, { ip: nextIp() });
const anonymous = () => agent({ ip: nextIp() });

const admin = await as("admin@demo.com"); // super admin
const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa (Business, 3 agendas)
const elena = await as("elena@demo.com"); // recepción
const valeria = await as("valeria@demo.com"); // rol Profesional, con su agenda
const jhordan = await as("jhordan@demo.com"); // propietario de otro negocio (Pro), sin activar
const businessId: string = ricardo.session.businessId;
const otherBusinessId: string = jhordan.session.businessId;
const B = `/businesses/${businessId}`;
const SWITCH = `/admin/businesses/${businessId}/payment-reminders`;
const GYE = sql(`select timezone from businesses where id = '${businessId}'`);
const businessNow = async () => (await ricardo("GET", B)).body as Business;
const professionals = async () => (await ricardo("GET", `${B}/professionals`)).body as Professional[];
const mode = (who: typeof ricardo, professionalId: string, value: unknown) =>
  who("PATCH", `${B}/professionals/${professionalId}/payment-reminder-mode`, { mode: value });
const businessAudit = async (action: string) =>
  ((await ricardo("GET", `${B}/audit-logs?action=${action}&limit=100`)).body?.entries ?? []) as AuditLog[];
const changesOf = (log: AuditLog | undefined) =>
  ((typeof log?.changes === "string" ? JSON.parse(log.changes) : (log?.changes ?? [])) as { label: string; before: string; after: string }[]).map(
    ({ label, before, after }) => `${label}: ${before} → ${after}`,
  );

let agendas = await professionals();
const ricardoAgenda = agendas.find((p) => p.userId === ricardo.session.userId)!;
const valeriaAgenda = agendas.find((p) => p.userId === valeria.session.userId)!;
const andresAgenda = agendas.find((p) => p.userId === null)!;
const service = sql(`select id from services where business_id = '${businessId}' and name = 'Consulta odontológica'`);
const otherAgenda = sql(`select id from professionals where business_id = '${otherBusinessId}' order by sort_order limit 1`);
const otherService = sql(`select id from services where business_id = '${otherBusinessId}' and price > 0 and is_active order by name limit 1`);

/* ------------------------------------------------------------------ Datos -- */

const tag = Date.now().toString(36);
let seq = 0;
/** Un paciente inventado del negocio (sin email: `withEmail` false). */
function patient(name: string, options: { withEmail?: boolean; business?: string } = {}) {
  seq++;
  const email = options.withEmail === false ? "" : `paciente.${seq}.${tag}@correo.ec`;
  const id = sql(
    `insert into clients (business_id, name, email, phone, document_id)
     values ('${options.business ?? businessId}', '${name}', '${email}', '+593 98 ${String(100 + seq)} 4567', '${cedulaFor(`${tag}-${seq}`)}')
     returning id`,
  ).split("\n")[0];
  return { id, email, name };
}
type Patient = ReturnType<typeof patient>;

/** La hora de pared del negocio como instante. */
const at = (date: string, time: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${GYE}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));
const plus30 = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
/**
 * Una cita insertada directamente (con su día de reserva si importa: `bookedAt`, la hora de pared del negocio;
 * si no, se reservó hoy, muchos días antes de la cita).
 */
function appointment(options: {
  client: Patient;
  professional?: string;
  date: string;
  start: string;
  status?: string;
  price?: number;
  bookedAt?: [date: string, time: string];
  business?: string;
  service?: string;
}): string {
  const created = options.bookedAt ? `((date '${options.bookedAt[0]}' + time '${options.bookedAt[1]}') at time zone '${GYE}')` : "now()";
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source, created_at)
     values ('${options.business ?? businessId}', '${options.client.id}', '${options.service ?? service}', '${options.professional ?? ricardoAgenda.id}',
             '${options.date}', '${options.start}', '${plus30(options.start)}', '${options.status ?? "confirmed"}', ${options.price ?? 20}, 'dashboard', ${created})
     returning id`,
  ).split("\n")[0];
}
/** «2|2026-06-04»: cuántos recordatorios salieron de la cita y el último día. */
const stateOf = (id: string) =>
  sql(`select payment_reminders_sent || '|' || coalesce(to_char(payment_reminded_on, 'YYYY-MM-DD'), '') from appointments where id = '${id}'`);
const remindersTo = (who: Patient) => count(`select count(*) from notifications where type = 'payment_reminder' and to_email = '${who.email}'`);
interface ReminderEmail {
  subject: string;
  body: string;
  html: string;
  dedupeKey: string;
  appointmentId: string;
}
const lastReminderTo = (who: Patient): ReminderEmail | null =>
  JSON.parse(
    sql(`select coalesce((select json_build_object('subject', subject, 'body', body, 'html', html, 'dedupeKey', dedupe_key, 'appointmentId', appointment_id)
                            from notifications where type = 'payment_reminder' and to_email = '${who.email}' order by created_at desc limit 1), 'null')`),
  );
const tokenOf = (id: string) => sql(`select payment_token from appointments where id = '${id}'`);
/** Una pasada del cron a esa hora de pared del negocio: cuántos emails puso en cola. */
async function run(date: string, time = "09:30"): Promise<number> {
  const result = await queuePaymentReminders(at(date, time));
  if (result.failures > 0) console.log("  ! falló algún negocio en la pasada", date, time);
  return result.queued;
}
/** Las citas de una sección ya no estorban a las siguientes. */
const retire = (ids: string[]) => sql(`update appointments set status = 'cancelled' where id in (${ids.map((id) => `'${id}'`).join(", ")})`);

/** Lunes lejano: las citas demo (alrededor de hoy) nunca tocan en estas fechas. */
const today = getZonedNow(GYE).date;
let monday = addDaysISO(today, 200);
while (getDayOfWeek(monday) !== 1) monday = addDaysISO(monday, 1);
/** El día `weekday` (1 lunes … 7 domingo) de la semana `k` desde ese lunes. */
const day = (k: number, weekday: number) => addDaysISO(monday, 7 * k + weekday - 1);

/** Sube un comprobante desde la página de pago, como el paciente (almacenamiento local de las pruebas). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function uploadReceipt(appointmentId: string): Promise<number> {
  const visitor = anonymous();
  const token = tokenOf(appointmentId);
  const request = await visitor("POST", `/public/payments/${token}/receipts`, { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length });
  if (request.status !== 200) return request.status;
  await fetch(ORIGIN + request.body.upload.url, { method: "PUT", headers: request.body.upload.headers, body: PNG });
  return (await visitor("POST", `/public/payments/${token}/receipts/${request.body.receipt.id}/complete`)).status;
}
const receiptEmailsTo = (appointmentId: string) =>
  sql(`select coalesce(string_agg(to_email, ',' order by to_email), '') from notifications where type = 'payment_receipt_received' and appointment_id = '${appointmentId}'`);

/* ======================================================================================== */
console.log("El cupo de Gmail y el historial");
ok(EMAIL_PRIORITY.payment_reminder === "patient" && emailTypesOf("patient").includes("payment_reminder"), "el recordatorio es del nivel «paciente» del cupo");

/* ======================================================================================== */
console.log("El interruptor: apagado y sólo lo cambia el super admin");
let business = await businessNow();
ok(
  business.paymentReminders?.enabled === false && business.paymentReminders.days === "before_three",
  "el negocio lo trae apagado, con los 3 días anteriores a la cita",
  business.paymentReminders,
);
ok(count("select count(*) from businesses where payment_reminders") === 0, "ningún negocio demo lo tiene encendido");
ok(agendas.every((p) => p.paymentReminderMode === "before"), "las agendas empiezan en «Antes de la cita»", agendas.map((p) => p.paymentReminderMode));
let r = await ricardo("PUT", SWITCH, { enabled: true, defaultMode: "before", days: "before_three" });
ok(r.status === 403, "el propietario no usa la ruta del super admin: 403", r.status);
r = await ricardo("PATCH", B, { paymentReminders: { enabled: true, days: "after_booking" } });
ok(r.status === 200 && r.body.paymentReminders.enabled === false && r.body.paymentReminders.days === "before_three", "ni lo enciende desde su configuración (se ignora)", r.body?.paymentReminders);
r = await admin("PATCH", B, { paymentReminders: { enabled: true, days: "after_booking" } });
ok(
  r.status === 200 && r.body.paymentReminders.enabled === false,
  "el super admin en modo soporte, desde el panel del negocio, tampoco (se ignora: sólo desde /admin)",
  r.body?.paymentReminders,
);
r = await mode(valeria, valeriaAgenda.id, "after");
ok(r.status === 409 && /no tiene activados/.test(r.body?.error?.message), "sin activar, el modo de una agenda no se cambia: 409", r.body);
r = await ricardo("PUT", `${B}/professionals/${andresAgenda.id}`, { ...formOf(andresAgenda), paymentReminderMode: "after" });
ok(r.status === 409, "ni desde la ficha de Profesionales: 409", r.body);

// Una cita que lo cumple todo, en un negocio sin activar: nada.
const offPatient = patient("Rosa Inactiva Paredes");
const offAppointment = appointment({ client: offPatient, date: day(0, 5), start: "10:00" });
ok((await run(day(0, 2))) === 0 && remindersTo(offPatient) === 0 && stateOf(offAppointment) === "0|", "sin el interruptor no sale ningún recordatorio");

// El comprobante, sin activar: como hoy (al negocio; al profesional sólo si recibe los avisos de sus citas).
sql(`update professionals set notify_new_appointments = false, email = '' where id = '${valeriaAgenda.id}'`);
const valeriaDevice = push.device();
const chromeMac = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" };
r = await valeria("PUT", "/push/device", valeriaDevice, chromeMac);
ok(r.status === 200, "Valeria activa los avisos en su celular", r.body);
r = await valeria("GET", "/push/config");
ok(JSON.stringify(r.body?.kinds) === JSON.stringify(AGENDA_PUSH_KINDS), "sin activar, el rol Profesional sólo tiene los resúmenes de su agenda", r.body?.kinds);
const comprobantePushes = (appointmentId: string) =>
  count(
    `select count(*) from push_messages m join push_subscriptions s on s.id = m.subscription_id
      where s.endpoint = '${valeriaDevice.endpoint}' and m.tag = 'comprobante-${appointmentId}'`,
  );
const offReceipt = appointment({ client: patient("Tomás Antes Ruiz"), professional: valeriaAgenda.id, date: day(0, 3), start: "10:00" });
ok((await uploadReceipt(offReceipt)) === 200, "el paciente sube su comprobante");
ok(
  receiptEmailsTo(offReceipt) === "ricardo@demo.com" && comprobantePushes(offReceipt) === 0,
  "sin activar: el email va al negocio, no a Valeria (sin los avisos de sus citas), y nada en su celular",
  [receiptEmailsTo(offReceipt), comprobantePushes(offReceipt)],
);

/* ======================================================================================== */
console.log("El super admin lo activa");
r = await admin("PUT", SWITCH, { enabled: true, days: "before_three" });
ok(r.status === 400 && /modo por defecto/.test(r.body?.error?.message), "al activarlo hay que elegir el modo por defecto: 400", r.body);
r = await admin("PUT", SWITCH, { enabled: "sí", defaultMode: "before" });
ok(r.status === 400, "el interruptor es sí o no: 400", r.body);
r = await admin("PUT", SWITCH, { enabled: true, defaultMode: "despues", days: "before_three" });
ok(r.status === 400, "un modo que no existe: 400", r.body);
r = await admin("PUT", SWITCH, { enabled: true, defaultMode: "after", days: "before_three" });
ok(r.status === 200 && r.body.paymentReminders.enabled === true && r.body.paymentReminders.days === "before_three", "el super admin lo activa", r.body?.paymentReminders);
agendas = await professionals();
ok(agendas.every((p) => p.paymentReminderMode === "after"), "todas las agendas toman el modo por defecto («Después de la cita»)", agendas.map((p) => p.paymentReminderMode));
let logs = await businessAudit("platform.payment_reminders_changed");
ok(
  logs.length === 1 &&
    logs[0].summary === "Activó «Pedir el comprobante de pago» en Clínica Dental Sonrisa: todas las agendas, «Después de la cita»" &&
    /Super admin/.test(logs[0].actorName) &&
    JSON.stringify(changesOf(logs[0])) === JSON.stringify(["Pedir el comprobante de pago: No → Sí", "Modo de las agendas: Antes de la cita → Después de la cita"]),
  "queda en la actividad del negocio, con el antes y el después",
  logs.map((log) => [log.summary, log.actorName, changesOf(log)]),
);
r = await admin("GET", `/admin/audit-logs?scope=admin&businessId=${businessId}`);
ok(
  r.status === 200 && (r.body.entries as AuditLog[]).some((log) => log.action === "platform.payment_reminders_changed"),
  "y en la de la plataforma (acciones del super admin)",
  r.status,
);
r = await admin("PUT", SWITCH, { enabled: true, defaultMode: "before", days: "before_three" });
agendas = await professionals();
ok(
  r.status === 200 && (await businessAudit("platform.payment_reminders_changed")).length === 1 && agendas.every((p) => p.paymentReminderMode === "after"),
  "repetir lo mismo no deja otra entrada ni cambia las agendas (el modo por defecto es sólo al activarlo)",
);
ok((await businessNow()).paymentReminders.enabled === true, "el panel del negocio lo ve encendido");
const profile = (await anonymous()("GET", "/public/businesses/dental-sonrisa")).body;
ok(profile?.business && !("paymentReminders" in profile.business), "la página de reservas no lo muestra", profile?.business);
r = await admin("PUT", SWITCH, { enabled: true, days: "after_booking" });
logs = await businessAudit("platform.payment_reminders_changed");
ok(
  r.status === 200 && r.body.paymentReminders.days === "after_booking" && logs.length === 2 &&
    logs[0].summary === "Cambió los días de los recordatorios del comprobante en Clínica Dental Sonrisa: los 3 días siguientes a la reserva" &&
    JSON.stringify(changesOf(logs[0])) === JSON.stringify(["Días del modo «Antes de la cita»: Los 3 días anteriores a la cita → Los 3 días siguientes a la reserva"]),
  "los días se cambian con el interruptor encendido, con su entrada (antes → después)",
  logs.map((log) => [log.summary, changesOf(log)]),
);
await admin("PUT", SWITCH, { enabled: true, days: "before_three" });

/* ======================================================================================== */
console.log("El modo de cada agenda");
r = await mode(valeria, valeriaAgenda.id, "before");
ok(r.status === 200 && r.body.paymentReminderMode === "before", "Valeria lo cambia en su agenda", r.body);
logs = await businessAudit("professional.payment_reminder_mode_changed");
ok(
  logs.length === 1 &&
    logs[0].summary === "Cambió los recordatorios del comprobante de la agenda de Dra. Valeria Cruz: Después de la cita → Antes de la cita" &&
    logs[0].actorName === "Valeria Cruz",
  "queda en la actividad del negocio, a su nombre",
  logs.map((log) => [log.summary, log.actorName]),
);
r = await mode(valeria, ricardoAgenda.id, "before");
ok(r.status === 403 && /tu propia agenda/.test(r.body?.error?.message), "el profesional no cambia la de otro: 403", r.body);
r = await mode(elena, valeriaAgenda.id, "after");
ok(r.status === 403, "recepción no lo cambia: 403", r.body);
r = await mode(ricardo, valeriaAgenda.id, "lunes");
ok(r.status === 400, "un modo que no existe: 400", r.body);
r = await mode(ricardo, ricardoAgenda.id, "before");
ok(r.status === 200 && r.body.paymentReminderMode === "before", "el propietario cambia el de cualquier agenda", r.body);
r = await mode(admin, valeriaAgenda.id, "after");
ok(r.status === 200 && r.body.paymentReminderMode === "after", "el super admin en modo soporte también (como propietario)", r.body);
const before = (await businessAudit("professional.payment_reminder_mode_changed")).length;
r = await mode(admin, valeriaAgenda.id, "after");
ok(r.status === 200 && (await businessAudit("professional.payment_reminder_mode_changed")).length === before, "repetir el mismo modo no deja otra entrada");
const andresNow = (await professionals()).find((p) => p.id === andresAgenda.id)!;
const updatedBefore = (await businessAudit("professional.updated")).length;
r = await ricardo("PUT", `${B}/professionals/${andresAgenda.id}`, { ...formOf(andresNow), paymentReminderMode: "before" });
logs = await businessAudit("professional.payment_reminder_mode_changed");
ok(
  r.status === 200 && r.body.paymentReminderMode === "before" &&
    logs[0].summary === "Cambió los recordatorios del comprobante de la agenda de Dr. Andrés Vega: Después de la cita → Antes de la cita" &&
    (await businessAudit("professional.updated")).length === updatedBefore,
  "desde la ficha de Profesionales, con su propia entrada y sin un «Editó» vacío",
  [r.status, r.body?.paymentReminderMode, logs[0]?.summary],
);
r = await ricardo("PUT", `${B}/professionals/${andresAgenda.id}`, formOf(andresNow));
ok(r.status === 200 && r.body.paymentReminderMode === "before", "sin el campo (un front anterior), la ficha conserva el modo", r.body?.paymentReminderMode);
// Ricardo y Andrés: «Antes de la cita»; Valeria: «Después de la cita».

/* ======================================================================================== */
console.log("Al subir el comprobante, el profesional de la agenda se entera");
r = await valeria("GET", "/push/config");
ok(
  JSON.stringify(r.body?.kinds) === JSON.stringify(AGENDA_RECEIPT_PUSH_KINDS) && r.body.kinds.includes("receipt"),
  "activado, el rol Profesional también tiene «Comprobantes de pago» en su celular",
  r.body?.kinds,
);
const onReceipt = appointment({ client: patient("Lucía Después Mora"), professional: valeriaAgenda.id, date: day(0, 3), start: "11:00" });
ok((await uploadReceipt(onReceipt)) === 200, "el paciente sube su comprobante");
ok(
  receiptEmailsTo(onReceipt) === "ricardo@demo.com,valeria@demo.com",
  "el email «Recibiste un comprobante de pago» llega al negocio y a Valeria, aunque tiene apagados los avisos de sus citas",
  receiptEmailsTo(onReceipt),
);
ok(comprobantePushes(onReceipt) === 1, "y el aviso, a su celular", comprobantePushes(onReceipt));
r = await valeria("PATCH", "/push/device", { endpoint: valeriaDevice.endpoint, mutedKinds: ["receipt"] }, chromeMac);
ok(r.status === 200 && JSON.stringify(r.body.mutedKinds) === '["receipt"]', "lo puede apagar en su aparato", r.body);
const mutedReceipt = appointment({ client: patient("Elsa Silencio Vera"), professional: valeriaAgenda.id, date: day(0, 3), start: "12:00" });
await uploadReceipt(mutedReceipt);
ok(comprobantePushes(mutedReceipt) === 0 && receiptEmailsTo(mutedReceipt).includes("valeria@demo.com"), "apagado, no le llega al celular (el email sí)");
await valeria("PATCH", "/push/device", { endpoint: valeriaDevice.endpoint, mutedKinds: [] }, chromeMac);
const ownReceipt = appointment({ client: patient("Iván Dueño Paz"), date: day(0, 3), start: "13:00" });
await uploadReceipt(ownReceipt);
ok(receiptEmailsTo(ownReceipt) === "ricardo@demo.com", "en la agenda del propietario, un solo email (es el mismo del negocio)", receiptEmailsTo(ownReceipt));
retire([offAppointment]);

/* ======================================================================================== */
console.log("Modo «Antes»: los 3 días anteriores a la cita");
const p1 = patient("Ana Martes Salazar");
const p2 = patient("Bruno Miércoles Ortiz");
const friday1 = day(1, 5);
const a1 = appointment({ client: p1, date: friday1, start: "10:00" });
const a2 = appointment({ client: p2, date: friday1, start: "11:00", bookedAt: [day(1, 3), "08:00"] });
const auditBefore = count("select count(*) from audit_logs");
ok((await run(day(1, 1))) === 0, "el lunes (4 días antes), nada");
ok((await run(day(1, 2), "08:30")) === 0, "el martes antes de las 9:00, nada");
ok((await run(day(1, 2))) === 1 && remindersTo(p1) === 1, "el martes a las 9:30, el de Ana");
ok((await run(day(1, 2), "16:00")) === 0 && remindersTo(p1) === 1, "uno por día: otra pasada del martes no repite");
let email = lastReminderTo(p1);
ok(
  email?.subject === "Recordatorio: envía el comprobante de tu cita en Clínica Dental Sonrisa" &&
    email.dedupeKey === `payment-reminder:${p1.id}:${day(1, 2)}` && email.appointmentId === a1,
  "asunto amable, la clave del paciente y el día, y la cita",
  email && [email.subject, email.dedupeKey],
);
ok(
  !!email &&
    email.body.includes("Si ya lo enviaste por WhatsApp, puedes ignorar este mensaje.") &&
    email.body.includes(`/pago/${tokenOf(a1)}`) &&
    email.html.includes("Enviar el comprobante") &&
    email.body.includes("Monto") &&
    email.body.includes("Banco") &&
    !/deuda|cobro|debes/i.test(email.body),
  "lleva la cita, el monto, las cuentas, el botón con su enlace de pago y la nota; nunca «deuda» ni «cobro»",
  email?.body.slice(0, 600),
);
ok(count("select count(*) from audit_logs") === auditBefore, "los recordatorios no van a la actividad (sólo al historial de emails)");
ok(
  count(`select count(*) from notifications where type = 'appointment_copy' and appointment_id in ('${a1}', '${a2}')`) === 0 &&
    count(`select count(*) from notifications where type = 'payment_reminder' and to_email in ('ricardo@demo.com', 'valeria@demo.com')`) === 0,
  "sin copia al profesional",
);
ok((await run(day(1, 3))) === 1 && remindersTo(p2) === 0, "el miércoles, el de Ana; el de Bruno no: reservó ese mismo día");
ok((await run(day(1, 4))) === 2 && remindersTo(p2) === 1, "el jueves, los dos");
ok((await run(day(1, 5))) === 0 && (await run(day(1, 6))) === 0, "el viernes (el día de la cita) y después, nada");
ok(stateOf(a1) === `3|${day(1, 4)}` && stateOf(a2) === `1|${day(1, 4)}`, "Ana llegó al tope de 3; Bruno, 1", [stateOf(a1), stateOf(a2)]);
retire([a1, a2]);

/* ======================================================================================== */
console.log("Modo «Antes»: los 3 días siguientes a la reserva");
await admin("PUT", SWITCH, { enabled: true, days: "after_booking" });
const p3 = patient("Carla Reserva Lejos");
const p4 = patient("Diego Reserva Cerca");
const a3 = appointment({ client: p3, date: day(2, 4 + 7), start: "10:00", bookedAt: [day(2, 1), "15:00"] });
const a4 = appointment({ client: p4, date: day(2, 3), start: "11:00", bookedAt: [day(2, 1), "15:00"] });
ok((await run(day(2, 1), "16:00")) === 0, "el lunes de la reserva, nada");
ok((await run(day(2, 2))) === 2, "el martes, las dos");
ok((await run(day(2, 3))) === 2 && remindersTo(p4) === 2, "el miércoles, las dos (la de Diego es a las 11:00: a las 9:30 todavía no empieza)");
ok((await run(day(2, 4))) === 1 && remindersTo(p4) === 2, "el jueves, sólo la de Carla: la de Diego ya pasó");
ok((await run(day(2, 5))) === 0, "el viernes (4 días después de la reserva), nada");
ok(stateOf(a3) === `3|${day(2, 4)}` && stateOf(a4) === `2|${day(2, 3)}`, "reservada más cerca, salen menos", [stateOf(a3), stateOf(a4)]);
retire([a3, a4]);

/* ======================================================================================== */
console.log("Modo «Antes»: los 2 días anteriores y la mañana del mismo día");
await admin("PUT", SWITCH, { enabled: true, days: "before_and_morning" });
const p5 = patient("Elena Tarde Rivas");
const p6 = patient("Fabián Temprano Rojas");
const a5 = appointment({ client: p5, date: day(3, 5), start: "15:00" });
const a6 = appointment({ client: p6, date: day(3, 5), start: "09:00" });
ok((await run(day(3, 2))) === 0, "el martes (3 días antes), nada");
ok((await run(day(3, 3))) === 2 && (await run(day(3, 4))) === 2, "el miércoles y el jueves, las dos");
ok((await run(day(3, 5))) === 1 && remindersTo(p5) === 3 && remindersTo(p6) === 2, "el viernes a las 9:30, sólo la de las 15:00: la de las 9:00 ya empezó");
ok(stateOf(a5) === `3|${day(3, 5)}` && stateOf(a6) === `2|${day(3, 4)}`, "nunca después de empezar la cita", [stateOf(a5), stateOf(a6)]);
retire([a5, a6]);

/* ======================================================================================== */
console.log("Modo «Después de la cita» (la agenda de Valeria)");
const p7 = patient("Gabriela Atendida León");
const p8 = patient("Hugo Confirmado Paz");
const p9 = patient("Inés Pendiente Mora");
const p10 = patient("Jorge Antiguo Vela");
const a7 = appointment({ client: p7, professional: valeriaAgenda.id, date: day(4, 2), start: "10:00", status: "completed" });
const a8 = appointment({ client: p8, professional: valeriaAgenda.id, date: day(4, 2), start: "11:00", status: "confirmed" });
const a9 = appointment({ client: p9, professional: valeriaAgenda.id, date: day(4, 2), start: "12:00", status: "pending" });
const a10 = appointment({ client: p10, professional: valeriaAgenda.id, date: addDaysISO(day(4, 3), -10), start: "10:00", status: "completed" });
ok((await run(day(4, 2), "18:00")) === 0, "el mismo día de la cita, nada");
ok((await run(day(4, 3))) === 2 && remindersTo(p7) === 1 && remindersTo(p8) === 1, "desde el día siguiente: la «Completada» y la «Confirmada» sin cerrar");
ok(remindersTo(p9) === 0 && stateOf(a9) === "0|", "la «Por confirmar», no");
ok((await run(day(4, 4))) === 2 && (await run(day(4, 5))) === 2 && (await run(day(4, 6))) === 0, "uno por día, hasta 3");
ok(stateOf(a7) === `3|${day(4, 5)}` && stateOf(a8) === `3|${day(4, 5)}`, "las dos llegaron al tope", [stateOf(a7), stateOf(a8)]);
ok(remindersTo(p10) === 0 && stateOf(a10) === "0|", "la de hace más de 7 días, no (al activar un negocio, nada de citas viejas)");
retire([a7, a8, a9, a10]);

/* ======================================================================================== */
console.log("Se detienen con el comprobante, el pago, la cancelación y «No asistió»");
await admin("PUT", SWITCH, { enabled: true, days: "before_three" });
const p12 = patient("Karla Sube Comprobante");
const p13 = patient("Luis Marcada Pagada");
const p14 = patient("Marta Cancela Cita");
const p15 = patient("Nicolás No Asistió");
const a12 = appointment({ client: p12, date: day(5, 5), start: "10:00" });
const a13 = appointment({ client: p13, date: day(5, 5), start: "11:00" });
const a14 = appointment({ client: p14, date: day(5, 5), start: "12:00" });
const a15 = appointment({ client: p15, professional: valeriaAgenda.id, date: day(5, 2), start: "10:00" });
ok((await run(day(5, 2))) === 3, "el martes, las tres del viernes");
ok((await uploadReceipt(a12)) === 200, "Karla sube el comprobante");
r = await ricardo("PATCH", `${B}/appointments/${a13}/payment`, { paid: true });
ok(r.status === 200 && r.body.paidAt, "el negocio marca pagada la de Luis", r.body);
r = await ricardo("PATCH", `${B}/appointments/${a14}/status`, { status: "cancelled", notify: false });
ok(r.status === 200 && r.body.status === "cancelled", "y cancela la de Marta", r.body);
ok((await run(day(5, 3))) === 1 && remindersTo(p15) === 1, "el miércoles, ninguna de las tres; sí la de Nicolás (modo «Después», del martes)");
sql(`update appointments set status = 'no_show' where id = '${a15}'`);
ok((await run(day(5, 4))) === 0 && remindersTo(p15) === 1, "Nicolás quedó en «No asistió»: el jueves, nada");
ok(
  [a12, a13, a14].every((id) => stateOf(id) === `1|${day(5, 2)}`) && remindersTo(p12) === 1 && remindersTo(p13) === 1 && remindersTo(p14) === 1,
  "cada una se quedó en 1",
  [a12, a13, a14].map(stateOf),
);
retire([a12, a13, a15]);

/* ======================================================================================== */
console.log("Un email por paciente y día, y lo que no sale");
const p16 = patient("Olga Serie Campos");
const series = [3, 4, 5].map((weekday) => appointment({ client: p16, date: day(6, weekday), start: "10:00" }));
const p17 = patient("Pablo Principal Luna");
const p18 = patient("Quinn Pareja Luna");
const couple = appointment({ client: p17, date: day(6, 5), start: "11:00" });
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${couple}', '${p18.id}', '${businessId}')`);
const p19 = patient("Raúl Sin Email", { withEmail: false });
const noEmail = appointment({ client: p19, date: day(6, 5), start: "12:00" });
const p20 = patient("Sara Gratis Ríos");
const free = appointment({ client: p20, date: day(6, 5), start: "13:00", price: 0 });
const p21 = patient("Teo Sin Cuentas Díaz");
const andresAccounts = sql(`select bank_accounts::text from professionals where id = '${andresAgenda.id}'`);
sql(`update professionals set bank_accounts = '[]' where id = '${andresAgenda.id}'`);
const noAccounts = appointment({ client: p21, professional: andresAgenda.id, date: day(6, 5), start: "10:00" });
const p22 = patient("Úrsula Otro Negocio", { business: otherBusinessId });
const otherBusiness = appointment({ client: p22, business: otherBusinessId, professional: otherAgenda, service: otherService, date: day(6, 5), start: "10:00" });
ok((await run(day(6, 2))) === 2, "el martes salen dos emails: Olga (su serie) y Pablo");
email = lastReminderTo(p16);
const buttons = (html: string) => html.split("Enviar el comprobante").length - 1;
ok(
  remindersTo(p16) === 1 &&
    email?.subject === "Recordatorio: envía el comprobante de tus citas en Clínica Dental Sonrisa" &&
    series.every((id) => email!.body.includes(`/pago/${tokenOf(id)}`)) &&
    email.body.includes("Cita 3") &&
    series.every((id) => stateOf(id) === `1|${day(6, 2)}`),
  "Olga recibe un solo email con sus 3 citas, cada una con su enlace, y a cada cita se le suma uno",
  [remindersTo(p16), email?.subject, series.map(stateOf)],
);
ok(!!email && buttons(email.html) >= 3, "cada cita con su botón «Enviar el comprobante»", email && buttons(email.html));
ok(remindersTo(p17) === 1 && remindersTo(p18) === 0, "en una sesión en pareja, sólo el paciente principal");
ok(
  [noEmail, free, noAccounts, otherBusiness].every((id) => stateOf(id) === "0|") && remindersTo(p20) === 0 && remindersTo(p21) === 0 && remindersTo(p22) === 0,
  "nada para un paciente sin email, una cita gratis, una agenda sin cuentas ni un negocio sin activar",
  [noEmail, free, noAccounts, otherBusiness].map(stateOf),
);
ok((await run(day(6, 3))) === 2 && buttons(lastReminderTo(p16)!.html) >= 2 && !lastReminderTo(p16)!.body.includes(`/pago/${tokenOf(series[0])}`), "el miércoles, Olga recibe uno con las 2 que faltan (la de hoy ya no)");
ok((await run(day(6, 4))) === 2 && remindersTo(p16) === 3 && stateOf(series[2]) === `3|${day(6, 4)}`, "el jueves, el de la última: un email al día");
sql(`update professionals set bank_accounts = '${andresAccounts.replaceAll("'", "''")}' where id = '${andresAgenda.id}'`);
retire([...series, couple, noEmail, free, noAccounts]);
sql(`update appointments set status = 'cancelled' where id = '${otherBusiness}'`);

/* ======================================================================================== */
console.log("El super admin lo desactiva");
const p23 = patient("Vera Desactivado Soto");
const a23 = appointment({ client: p23, date: day(7, 5), start: "10:00" });
r = await admin("PUT", SWITCH, { enabled: false });
logs = await businessAudit("platform.payment_reminders_changed");
ok(
  r.status === 200 && r.body.paymentReminders.enabled === false && r.body.paymentReminders.days === "before_three" &&
    logs[0].summary === "Desactivó «Pedir el comprobante de pago» en Clínica Dental Sonrisa",
  "lo apaga (los días se conservan) y queda en la actividad",
  [r.body?.paymentReminders, logs[0]?.summary],
);
ok((await run(day(7, 2))) === 0 && remindersTo(p23) === 0, "no sale ningún recordatorio más");
ok((await mode(ricardo, ricardoAgenda.id, "after")).status === 409, "y el modo de las agendas ya no se cambia");
r = await valeria("GET", "/push/config");
ok(JSON.stringify(r.body?.kinds) === JSON.stringify(AGENDA_PUSH_KINDS), "el rol Profesional vuelve a tener sólo sus resúmenes", r.body?.kinds);
const offAgain = appointment({ client: patient("Wilson Comprobante Off"), professional: valeriaAgenda.id, date: day(7, 3), start: "10:00" });
await uploadReceipt(offAgain);
ok(receiptEmailsTo(offAgain) === "ricardo@demo.com" && comprobantePushes(offAgain) === 0, "y el comprobante vuelve a avisar como antes", receiptEmailsTo(offAgain));
r = await admin("PUT", SWITCH, { enabled: true, defaultMode: "before" });
agendas = await professionals();
ok(r.status === 200 && agendas.every((p) => p.paymentReminderMode === "before"), "al volver a activarlo, las agendas toman el nuevo modo por defecto", agendas.map((p) => p.paymentReminderMode));
ok((await run(day(7, 2), "10:00")) === 1 && remindersTo(p23) === 1, "y vuelven a salir");
retire([a23]);

/* ======================================================================================== */
console.log("El cron");
const ntfy = await fakeNtfy();
const cron = await runCron(ntfy.url);
ok(cron.code === 0 && /recordatorios de pago: \d+ ·/.test(cron.output), "el registro del cron lleva la cifra de los recordatorios de pago", cron.output.slice(0, 500));
ok(!/[^\s@]+@[^\s@]+\.[a-z]/i.test(cron.output), "y ningún email (el registro de Actions es público)", cron.output.match(/[^\s@]+@[^\s@]+/)?.[0]);
ntfy.close();
push.close();

done("de los recordatorios del comprobante de pago");
process.exit();

/** La ficha de una agenda tal como la manda el formulario de Profesionales. */
function formOf(p: Professional) {
  return {
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
  };
}
