// Las citas completadas quedan fijas (spec 020): una Completada no cambia de estado ni desde la ficha, ni
// desde «Editar», ni desde «Por cerrar»; de ella sólo cambian sus notas, el pago, los comprobantes y la
// historia clínica. Ninguna cita vuelve a Pendiente. El propietario (y el super admin en modo soporte) la
// corrige con un motivo, que queda en la actividad; los demás roles reciben 403. Datos ficticios.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, BASE, checks, count, login, sql } from "./helpers/harness.ts";
import { ENDED_CORRECTION_MESSAGE, LOCKED_FIELDS_MESSAGE, LOCKED_STATUS_MESSAGE } from "../src/shared/lib/constants/appointment-status.ts";
import { formatNumericDate } from "../src/shared/lib/format.ts";
import { addDaysISO, durationInMinutes } from "../src/shared/lib/time.ts";
import type { Appointment } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `198.51.100.${(ipSeq++ % 250) + 1}` });
type Browser = Awaited<ReturnType<typeof as>>;

const tag = Date.now().toString(36);
const startedAt = sql("select now()");

/* ======================================================================================== */
console.log("La Clínica Dental Sonrisa: el propietario, un administrador, Recepción, el rol Profesional y el super admin");
const ricardo = await as("ricardo@demo.com"); // propietario
const dental: string = ricardo.session.businessId;
const B = `/businesses/${dental}`;
// Un administrador del negocio (los datos demo de la clínica no traen ninguno).
sql(
  `insert into users (first_name, last_name, email, password_hash)
   select 'Adela', 'Administra', 'adela.${tag}@demo.com', password_hash from users where email = 'valeria@demo.com'`,
);
sql(`insert into business_users (business_id, user_id, role) select '${dental}', id, 'admin' from users where email = 'adela.${tag}@demo.com'`);
const adela = await as(`adela.${tag}@demo.com`); // administradora
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const admin = await as("admin@demo.com"); // super admin, en modo soporte al entrar al negocio
const laura = await as("laura@demo.com"); // propietaria de otro negocio
const agendaOf = (where: string) => sql(`select id from professionals where business_id = '${dental}' and ${where}`);
const ricardoAgenda = agendaOf(`user_id = (select id from users where email = 'ricardo@demo.com')`);
const valeriaAgenda = agendaOf(`user_id = (select id from users where email = 'valeria@demo.com')`);
const zone = sql(`select timezone from businesses where id = '${dental}'`);
const today = sql(`select (now() at time zone '${zone}')::date`);
const service = sql(`select id from services where business_id = '${dental}' and name = 'Consulta odontológica'`);
const otherService = sql(`select id from services where business_id = '${dental}' and id <> '${service}' and is_active order by created_at limit 1`);
ok(Boolean(ricardoAgenda && valeriaAgenda && service && otherService), "las dos agendas y dos servicios", { ricardoAgenda, valeriaAgenda, service, otherService });
// Todos los emails encendidos: así se ve si una corrección avisa o no.
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": true, "cancellations": true, "followUps": true}'::jsonb where id = '${dental}'`);
sql(`update businesses set multi_client_appointments = true where id = '${dental}'`);

let seq = 0;
/** Un paciente con email propio. */
const patient = (name: string) => {
  const email = `fija.${++seq}.${tag}@example.com`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${dental}', '${name}', '${cedulaFor(email)}', '${email}', '') returning id`,
  ).split("\n")[0];
  return { id, name, email };
};
let minute = 0;
/** Una cita creada directamente en la base, a una hora de la noche (no choca con los datos demo). */
const appointment = (input: { professionalId: string; clientId: string; date: string; status: string }) => {
  minute += 20;
  const start = `${String(19 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, notes, source)
     values ('${dental}', '${input.clientId}', '${service}', '${input.professionalId}', '${input.date}',
             '${start}', '${start}'::time + interval '15 minutes', '${input.status}', 20, 'Primera nota', 'dashboard')
     returning id`,
  ).split("\n")[0];
};
const day = (offset: number) => addDaysISO(today, offset);
const statusOf = (id: string) => sql(`select status from appointments where id = '${id}'`);
/** Las entradas de la actividad de esa cita desde que empezó la prueba: "acción|resumen". */
const auditOf = (id: string) =>
  sql(
    `select coalesce(string_agg(action || '|' || summary, E'\\n' order by created_at, id), '') from audit_logs
      where entity_id = '${id}' and created_at >= '${startedAt}'`,
  )
    .split("\n")
    .filter(Boolean);
const emailsOf = (id: string) => count(`select count(*) from notifications where appointment_id = '${id}'`);
const getAppointment = async (id: string): Promise<Appointment> => (await ricardo("GET", `${B}/appointments/${id}`)).body;
/** Lo que manda «Editar» con la cita tal como está (y los cambios que se pidan). */
const formOf = (a: Appointment, patch: Record<string, unknown> = {}) => ({
  clientId: a.clientId,
  extraClientIds: a.extraClientIds,
  serviceId: a.serviceId,
  professionalId: a.professionalId,
  date: a.date,
  startTime: a.startTime,
  durationMinutes: durationInMinutes(a.startTime, a.endTime),
  price: a.price,
  status: a.status,
  notes: a.notes,
  homeVisit: a.homeVisit,
  isVirtual: a.isVirtual,
  ...patch,
});
const setStatus = (browser: Browser, id: string, status: string, extra: Record<string, unknown> = {}) =>
  browser("PATCH", `${B}/appointments/${id}/status`, { status, ...extra });
const correct = (browser: Browser, id: string, body: unknown) => browser("POST", `${B}/appointments/${id}/correct-status`, body);
const REASON = "Se marcó como completada por error: el paciente no vino.";

const ana = patient("Ana Fija");
const bruno = patient("Bruno Fijo");
const carla = patient("Carla Fija");
const diego = patient("Diego Fijo");

/* ======================================================================================== */
console.log("\nUna cita completada no cambia de estado");
const fixed = appointment({ professionalId: valeriaAgenda, clientId: ana.id, date: day(-1), status: "completed" });
for (const status of ["pending", "confirmed", "no_show", "cancelled", "completed"]) {
  const r = await setStatus(ricardo, fixed, status);
  ok(
    r.status === 409 && r.body.error.message === LOCKED_STATUS_MESSAGE && statusOf(fixed) === "completed",
    `desde la ficha, ni el propietario la pasa a «${status}» (409, con el mensaje)`,
    r.body,
  );
}
let r = await setStatus(valeria, fixed, "confirmed", { notify: false });
ok(r.status === 409 && statusOf(fixed) === "completed", "ni el rol Profesional en su agenda", r.body);
r = await setStatus(elena, fixed, "no_show", { onlyIfOpen: true });
ok(r.status === 409 && /Alguien ya cerró esta cita: está «Completada»/.test(r.body.error.message), "ni desde «Por cerrar» (una por una)", r.body);
r = await ricardo("POST", `${B}/appointments/close-all`, { status: "completed", ids: [fixed] });
ok(r.status === 200 && r.body.closed === 0 && r.body.skipped === 1, "ni con «Marcar todas como completadas» (la salta)", r.body);
ok(auditOf(fixed).length === 0 && emailsOf(fixed) === 0, "y nada de eso deja entradas en la actividad ni emails");

console.log("\n«Editar» sólo cambia sus notas");
let before = await getAppointment(fixed);
r = await ricardo("PUT", `${B}/appointments/${fixed}`, formOf(before, { status: "confirmed" }));
ok(r.status === 409 && r.body.error.message === LOCKED_STATUS_MESSAGE, "con otro estado: 409", r.body);
const attempts: [string, Record<string, unknown>][] = [
  ["otra fecha", { date: day(-2) }],
  ["otra hora", { startTime: "21:50" }],
  ["otra duración", { durationMinutes: 30 }],
  ["otro precio", { price: 35 }],
  ["otro servicio", { serviceId: otherService }],
  ["otro profesional", { professionalId: ricardoAgenda }],
  ["otro paciente", { clientId: bruno.id }],
  ["otro paciente más en la sesión", { extraClientIds: [carla.id] }],
  ["a domicilio", { homeVisit: { address: "Av. Siempre Viva 742", reference: "", lat: null, lng: null } }],
  ["por videollamada", { isVirtual: true }],
];
for (const [label, patch] of attempts) {
  r = await ricardo("PUT", `${B}/appointments/${fixed}`, formOf(before, { ...patch, notes: "Nota que no se guarda" }));
  ok(r.status === 409 && r.body.error.message === LOCKED_FIELDS_MESSAGE, `${label}: 409, «${LOCKED_FIELDS_MESSAGE}»`, r.body);
}
let after = await getAppointment(fixed);
ok(
  JSON.stringify({ ...after, updatedAt: "" }) === JSON.stringify({ ...before, updatedAt: "" }) && after.notes === "Primera nota",
  "la cita sigue exactamente igual (tampoco cambió la nota de esos intentos)",
  { before, after },
);
r = await ricardo("PUT", `${B}/appointments/${fixed}`, formOf(before, { notes: "Vino con dolor; volver en un mes." }));
after = await getAppointment(fixed);
ok(r.status === 200 && after.notes === "Vino con dolor; volver en un mes." && after.status === "completed", "sólo con la nota cambiada: se guarda y sigue completada", r.body);
ok(
  auditOf(fixed).length === 1 && auditOf(fixed)[0].startsWith("appointment.updated|Editó la cita de Ana Fija") && emailsOf(fixed) === 0,
  "queda en la actividad como una edición, sin emails",
  auditOf(fixed),
);
const { extraClientIds: _extra, professionalId: _professional, ...oldForm } = formOf(after, { notes: "Nota de un panel anterior." });
r = await valeria("PUT", `${B}/appointments/${fixed}`, oldForm);
ok(r.status === 200 && r.body.notes === "Nota de un panel anterior.", "también desde un panel anterior (sin profesional ni otros pacientes), y para el rol Profesional", r.body);

console.log("\nEl pago, los comprobantes, la llegada y la historia clínica");
r = await ricardo("PATCH", `${B}/appointments/${fixed}/payment`, { paid: true });
ok(r.status === 200 && Boolean(r.body.paidAt) && r.body.status === "completed", "se marca como pagada", r.body);
r = await ricardo("PATCH", `${B}/appointments/${fixed}/payment`, { paid: false });
ok(r.status === 200 && r.body.paidAt === null, "y se deshace", r.body);
const token = sql(`select payment_token from appointments where id = '${fixed}'`);
const visitor = agent({ ip: "198.51.100.251" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
r = await visitor("POST", `/public/payments/${token}/receipts`, { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length });
ok(r.status === 200 && r.body.upload?.method === "PUT", "el paciente pide subir su comprobante", r.body);
const upload = r.body.upload as { url: string; headers: Record<string, string> };
const uploaded = await fetch(new URL(BASE).origin + upload.url, { method: "PUT", headers: upload.headers, body: PNG });
r = await visitor("POST", `/public/payments/${token}/receipts/${r.body.receipt.id}/complete`);
ok(uploaded.ok && r.status === 200, "lo sube", { uploaded: uploaded.status, body: r.body });
r = await ricardo("GET", `${B}/appointments/${fixed}/receipts`);
ok(r.status === 200 && r.body.length === 1 && Boolean((await getAppointment(fixed)).receiptAt), "y el negocio lo ve en la cita", r.body);
r = await ricardo("PATCH", `${B}/appointments/${fixed}/arrival`, { arrived: true });
ok(r.status === 409, "la llegada no se marca (como siempre: sólo en pendientes o confirmadas)", r.body);
sql(`update appointments set arrived_at = now() - interval '1 day' where id = '${fixed}'`);
r = await ricardo("PATCH", `${B}/appointments/${fixed}/arrival`, { arrived: false });
ok(r.status === 409 && r.body.error.message === LOCKED_STATUS_MESSAGE && sql(`select arrived_at is not null from appointments where id = '${fixed}'`) === "t", "ni se quita", r.body);
const templates = (await ricardo("GET", `${B}/clinical-templates`)).body as { id: string; versionId: string }[];
const general = templates.find((t) => t.id === "evolucion-general");
r = await ricardo("POST", `${B}/clients/${ana.id}/clinical-record/notes`, {
  appointmentId: fixed,
  templateVersionId: general?.versionId,
  data: { reason: "Control", findings: "Sin novedad", diagnosis: "", treatment: "", indications: "", next_control: "" },
});
ok(r.status === 200 && r.body.appointmentId === fixed, "se registra la evolución de esa cita en la historia clínica", r.body);

console.log("\nUna sesión con varios pacientes se fija entera");
const pair = appointment({ professionalId: ricardoAgenda, clientId: bruno.id, date: day(-1), status: "completed" });
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${pair}', '${diego.id}', '${dental}')`);
r = await setStatus(ricardo, pair, "no_show");
ok(r.status === 409 && statusOf(pair) === "completed", "no cambia de estado", r.body);
r = await ricardo("PUT", `${B}/appointments/${pair}`, formOf(await getAppointment(pair), { extraClientIds: [] }));
ok(r.status === 409 && sql(`select count(*) from appointment_clients where appointment_id = '${pair}'`) === "1", "ni se le quita un paciente", r.body);

/* ======================================================================================== */
console.log("\nNinguna cita vuelve a Pendiente");
const confirmed = appointment({ professionalId: ricardoAgenda, clientId: carla.id, date: day(2), status: "confirmed" });
r = await setStatus(ricardo, confirmed, "pending");
ok(r.status === 409 && r.body.error.message === "Una cita confirmada no vuelve a Pendiente." && statusOf(confirmed) === "confirmed", "una confirmada, desde la ficha: 409", r.body);
r = await ricardo("PUT", `${B}/appointments/${confirmed}`, formOf(await getAppointment(confirmed), { status: "pending" }));
ok(r.status === 409 && statusOf(confirmed) === "confirmed", "ni desde «Editar»", r.body);
r = await ricardo("PUT", `${B}/appointments/${confirmed}`, formOf(await getAppointment(confirmed), { startTime: "22:40" }));
ok(r.status === 200 && r.body.startTime === "22:40", "pero se sigue editando y moviendo", r.body);
const noShow = appointment({ professionalId: ricardoAgenda, clientId: carla.id, date: day(-3), status: "no_show" });
r = await setStatus(elena, noShow, "pending");
ok(r.status === 409 && /no vuelve a Pendiente/.test(r.body.error.message) && statusOf(noShow) === "no_show", "una «No asistió» no vuelve a Pendiente", r.body);
r = await setStatus(elena, noShow, "completed", { notify: false });
ok(r.status === 200 && statusOf(noShow) === "completed", "pero sí cambia: Recepción la marca Completada", r.body);
const cancelled = appointment({ professionalId: ricardoAgenda, clientId: carla.id, date: day(3), status: "cancelled" });
r = await ricardo("PUT", `${B}/appointments/${cancelled}`, formOf(await getAppointment(cancelled), { status: "pending" }));
ok(r.status === 409 && /márcala como Confirmada/.test(r.body.error.message), "una «Cancelada» tampoco vuelve a Pendiente", r.body);
r = await setStatus(ricardo, cancelled, "confirmed", { notify: false });
ok(r.status === 200 && statusOf(cancelled) === "confirmed", "se reactiva como Confirmada", r.body);
const pending = appointment({ professionalId: ricardoAgenda, clientId: carla.id, date: day(4), status: "pending" });
r = await ricardo("PUT", `${B}/appointments/${pending}`, formOf(await getAppointment(pending), { notes: "Sigue pendiente" }));
ok(r.status === 200 && r.body.status === "pending", "una pendiente se edita y sigue pendiente", r.body);

/* ======================================================================================== */
console.log("\nLa corrección: sólo el propietario");
for (const [who, browser] of [
  ["un administrador", adela],
  ["Recepción", elena],
  ["el rol Profesional (en su agenda)", valeria],
] as const) {
  r = await correct(browser, fixed, { status: "no_show", reason: REASON });
  ok(
    r.status === 403 && r.body.error.message === "Sólo el propietario puede corregir el estado de una cita completada." && statusOf(fixed) === "completed",
    `${who}: 403, «sólo el propietario»`,
    r.body,
  );
}
r = await laura("POST", `/businesses/${dental}/appointments/${fixed}/correct-status`, { status: "no_show", reason: REASON });
ok(r.status === 403 && statusOf(fixed) === "completed", "ni la propietaria de otro negocio", r.body);

console.log("\nEl motivo y el estado");
const invalid: [string, unknown][] = [
  ["sin motivo", { status: "no_show" }],
  ["con el motivo vacío", { status: "no_show", reason: "" }],
  ["con sólo espacios", { status: "no_show", reason: "            " }],
  ["con un motivo de 9 caracteres", { status: "no_show", reason: "Me equivo" }],
  ["con uno de 301", { status: "no_show", reason: "x".repeat(301) }],
  ["a Pendiente", { status: "pending", reason: REASON }],
  ["a Completada", { status: "completed", reason: REASON }],
  ["sin estado", { reason: REASON }],
  ["con notify que no es sí o no", { status: "no_show", reason: REASON, notify: "sí" }],
];
for (const [label, body] of invalid) {
  r = await correct(ricardo, fixed, body);
  ok(r.status === 400 && r.body.error.code === "validation" && statusOf(fixed) === "completed", `${label}: 400`, r.body);
}
r = await correct(ricardo, confirmed, { status: "cancelled", reason: REASON });
ok(r.status === 409 && /Sólo se corrige una cita completada, y ésta está «Confirmada»/.test(r.body.error.message) && statusOf(confirmed) === "confirmed", "una cita que no está completada: 409", r.body);
r = await correct(ricardo, crypto.randomUUID(), { status: "no_show", reason: REASON });
ok(r.status === 404, "una que no existe: 404", r.body);
r = await correct(ricardo, fixed, { status: "confirmed", reason: REASON });
ok(
  r.status === 409 && r.body.error.message === ENDED_CORRECTION_MESSAGE && statusOf(fixed) === "completed",
  "a Confirmada, una que ya pasó: 409 (volvería a quedar por cerrar)",
  r.body,
);
const early = appointment({ professionalId: ricardoAgenda, clientId: carla.id, date: day(2), status: "completed" });
r = await correct(ricardo, early, { status: "confirmed", reason: REASON });
ok(r.status === 200 && statusOf(early) === "confirmed", "a Confirmada, una que aún no pasó (se completó antes de tiempo): sí", r.body);

console.log("\nEl propietario corrige");
const emailsBefore = emailsOf(fixed);
r = await correct(ricardo, fixed, { status: "no_show", reason: `  ${REASON}  ` });
ok(r.status === 200 && r.body.status === "no_show" && statusOf(fixed) === "no_show", "de Completada a No asistió, con el motivo", r.body);
const corrected = auditOf(fixed).at(-1) ?? "";
ok(
  corrected ===
    `appointment.status_corrected|Corrigió el estado de la cita de Ana Fija (${formatNumericDate(day(-1))} ${after.startTime}) ` +
      `de «Completada» a «No asistió». Motivo: ${REASON} (sin avisar al paciente)`,
  "la actividad dice quién, de qué estado a cuál y el motivo (sin los espacios de los lados)",
  corrected,
);
const changeOf = (id: string) =>
  sql(
    `select ch->>'before' || '→' || (ch->>'after') from audit_logs l, jsonb_array_elements(l.changes) ch
      where l.entity_id = '${id}' and l.action = 'appointment.status_corrected' and ch->>'label' = 'Estado'`,
  );
ok(changeOf(fixed) === "Completada→No asistió", "con «Estado: Completada → No asistió» en los cambios (lo que leen ntfy y la actividad)", changeOf(fixed));
ok(
  sql(`select actor_name from audit_logs where entity_id = '${fixed}' and action = 'appointment.status_corrected'`) === "Ricardo Paredes",
  "a nombre del propietario",
);
ok(emailsOf(fixed) === emailsBefore, "sin notify, ningún email (con «Seguimiento» encendido, «No asistió» habría avisado)", emailsOf(fixed));
r = await setStatus(ricardo, fixed, "pending");
ok(r.status === 409 && statusOf(fixed) === "no_show", "después sigue las reglas de su nuevo estado: no vuelve a Pendiente", r.body);
r = await setStatus(elena, fixed, "completed", { notify: false });
ok(r.status === 200 && statusOf(fixed) === "completed", "y se puede volver a completar (y queda fija otra vez)", r.body);
r = await setStatus(elena, fixed, "no_show");
ok(r.status === 409, "fija otra vez", r.body);

console.log("\nEl super admin en modo soporte corrige");
r = await correct(admin, pair, { status: "cancelled", reason: "El paciente canceló por teléfono antes de la cita.", notify: true });
ok(r.status === 200 && statusOf(pair) === "cancelled", "de Completada a Cancelada, con «Avisar al paciente»", r.body);
const supportEntry = sql(
  `select actor_name || '|' || summary from audit_logs where entity_id = '${pair}' and action = 'appointment.status_corrected'`,
);
ok(
  /\(Super admin\)\|Corrigió el estado de la cita de Bruno Fijo y Diego Fijo \(.+\) de «Completada» a «Cancelada»\. Motivo: El paciente canceló por teléfono antes de la cita\.$/.test(
    supportEntry,
  ),
  "queda a su nombre, con los dos pacientes, y sin «sin avisar al paciente»",
  supportEntry,
);
const pairEmails = sql(`select string_agg(type || '→' || to_email, ',' order by created_at, id) from notifications where appointment_id = '${pair}'`);
ok(
  pairEmails.includes(`appointment_cancelled→${bruno.email}`) && pairEmails.includes(`appointment_cancelled→${diego.email}`),
  "con notify, cada paciente recibe el email del nuevo estado",
  pairEmails,
);

/* ======================================================================================== */
console.log("\nConsultar no va a la actividad");
const reads = count(
  `select count(*) from audit_logs where created_at >= '${startedAt}' and business_id = '${dental}'
      and action not like 'appointment.%' and action not like 'session.%' and action not like 'clinical_%' and action not like 'payment%'`,
);
ok(reads === 0, "sólo los cambios, las evoluciones, el pago y los inicios de sesión dejan entradas", reads);

done("de las citas completadas fijas");
