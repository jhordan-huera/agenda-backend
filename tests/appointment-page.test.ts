// Página «Tu cita» (spec 010): el paciente ve su cita por el enlace de sus emails, sin sesión, confirma
// que va («Confirmo que voy», una marca que no cambia el estado) o la cancela si el negocio lo permite y
// aún está en plazo (CE-002). Cada otra persona de una sesión tiene su enlace y sólo confirma. Un enlace
// que no existe responde igual que uno caducado (RF-011).
import { randomBytes } from "node:crypto";
import { cedulaFor } from "./helpers/cedula.mjs";
import { BASE, agent, checks, count, fakeNtfy, login, runCron, sql } from "./helpers/harness.ts";
import { viaProxy } from "./helpers/proxy.mjs";
import { addDaysISO, getZonedNow, minutesToTime } from "../src/shared/lib/time.ts";
import type { PublicAppointment, PublicAppointmentResult } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { pool } = await import("../src/db/pool.ts");
const { findStatusChanges, statusChangeNotice } = await import("../src/services/booking-alerts.ts");

const owner = await login("jhordan@demo.com");
const businessId: string = owner.session.businessId;
const B = `/businesses/${businessId}`;
const slug = sql(`select slug from businesses where id = '${businessId}'`);
const businessName = sql(`select name from businesses where id = '${businessId}'`);

/** Una zona (Etc/GMT±N) en la que ahora es más o menos mediodía: las citas a ±25 h caben en su día. */
function zoneWhereItIs(hour: number): string {
  const offset = ((hour - new Date().getUTCHours() + 36) % 24) - 12;
  return offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
const zone = zoneWhereItIs(12);
const BUSINESS_EMAIL = "recepcion.cita010@correo.ec";
const COPY_EMAIL = "profesional.cita010@correo.ec";
sql(
  `update businesses set timezone = '${zone}', email = '${BUSINESS_EMAIL}',
          booking_settings = booking_settings || '{"allowCancellations": true, "cancellationNoticeHours": 24}',
          notification_settings = notification_settings
            || '{"confirmations": true, "cancellations": true, "reminders": true, "reminderHoursBefore": 24}'
    where id = '${businessId}'`,
);
const bookingSettings = (patch: Record<string, unknown>) =>
  sql(`update businesses set booking_settings = booking_settings || '${JSON.stringify(patch)}' where id = '${businessId}'`);
const service = sql(
  `select id || '|' || name from services where business_id = '${businessId}' and is_active and 'business' = any(modes) order by created_at limit 1`,
).split("|");

// Cada cita en su propia agenda: así nunca se solapan (la base no deja dos citas a la vez en una agenda).
let agendas = 0;
const agenda = (meetingUrl = "") =>
  sql(
    `insert into professionals (business_id, display_name, email, all_services, meeting_url)
     values ('${businessId}', 'Agenda Cita ${++agendas}', '${COPY_EMAIL}', true, '${meetingUrl}') returning id`,
  ).split("\n")[0];

const tag = Date.now().toString(36);
let seq = 0;
/** Un paciente con nombre, email, teléfono y cédula propios. */
const patient = (name: string) => {
  const email = `${name.split(" ")[0].toLowerCase()}.${++seq}.${tag}@correo.ec`;
  const phone = `09${String(70000000 + seq * 7919).slice(0, 8)}`;
  const documentId = cedulaFor(`${tag}-${seq}`);
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone) values ('${businessId}', '${name}', '${documentId}', '${email}', '${phone}') returning id`,
  ).split("\n")[0];
  return { id, name, email, phone, documentId };
};
type Patient = ReturnType<typeof patient>;

/** Fecha y hora a `minutes` de ahora en la hora del negocio. */
function inMinutes(minutes: number): { date: string; startTime: string } {
  const now = getZonedNow(zone);
  const total = now.minutes + minutes;
  return { date: addDaysISO(now.date, Math.floor(total / 1440)), startTime: minutesToTime(((total % 1440) + 1440) % 1440) };
}

interface Created {
  id: string;
  /** El enlace del principal (el del pago). */
  token: string;
  professionalId: string;
  date: string;
  startTime: string;
}
/** Una cita de 30 min en su propia agenda, a `minutes` de ahora. `extras`: las otras personas de la sesión. */
function appointment(
  main: Patient,
  minutes: number,
  options: { status?: string; extras?: Patient[]; homeVisit?: string; virtual?: boolean; notes?: string } = {},
): Created {
  const professionalId = agenda(options.virtual ? "https://meet.example/sala-secreta-010" : "");
  const { date, startTime } = inMinutes(minutes);
  const homeVisit = options.homeVisit ? `'${JSON.stringify({ address: options.homeVisit, reference: "Portón verde", lat: null, lng: null })}'` : "null";
  const [id, token] = sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price,
                               notes, home_visit, is_virtual, source)
     values ('${businessId}', '${main.id}', '${service[0]}', '${professionalId}', '${date}', '${startTime}',
             '${startTime}'::time + interval '30 minutes', '${options.status ?? "confirmed"}', 25, '${options.notes ?? ""}',
             ${homeVisit}, ${options.virtual ? "true" : "false"}, 'dashboard')
     returning id || '|' || payment_token`,
  )
    .split("\n")[0]
    .split("|");
  for (const extra of options.extras ?? []) {
    sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${id}', '${extra.id}', '${businessId}')`);
  }
  return { id, token, professionalId, date, startTime };
}
const accessToken = (appointmentId: string, clientId: string) =>
  sql(`select access_token from appointment_clients where appointment_id = '${appointmentId}' and client_id = '${clientId}'`);

// Cada petición pública llega por el proxy desde su propia IP: los límites por conexión no se gastan
// entre una prueba y otra (los límites se prueban aparte, con una IP fija).
let ip = 0;
const visitor = () => agent({ ip: `198.51.100.${(ip++ % 250) + 1}` });
const page = async (token: string) => visitor()("GET", `/public/appointments/${token}`);
const confirm = async (token: string) => visitor()("POST", `/public/appointments/${token}/confirm`);
const cancel = async (token: string) => visitor()("POST", `/public/appointments/${token}/cancel`);
const pageOf = async (token: string) => (await page(token)).body as PublicAppointment;

/** "tipo|destino" de los emails de una cita, en orden. */
const emailsOf = (appointmentId: string) =>
  sql(`select type || '|' || to_email from notifications where appointment_id = '${appointmentId}' order by created_at, id`)
    .split("\n")
    .filter(Boolean);
const confirmedAt = (appointmentId: string) => sql(`select coalesce(client_confirmed_at::text, '') from appointments where id = '${appointmentId}'`);
const extraConfirmedAt = (appointmentId: string, clientId: string) =>
  sql(`select coalesce(confirmed_at::text, '') from appointment_clients where appointment_id = '${appointmentId}' and client_id = '${clientId}'`);
/** Los datos de la cita como los pide la API del panel (PUT). */
const input = (created: Created, clientId: string, fields: Record<string, unknown> = {}) => ({
  clientId,
  serviceId: service[0],
  professionalId: created.professionalId,
  date: created.date,
  startTime: created.startTime,
  durationMinutes: 30,
  price: 25,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
  ...fields,
});

console.log("La página (GET)");
const zoe = patient("Zoe Privada");
const visit = appointment(zoe, 3 * 1440, { homeVisit: "Calle Secreta 123", notes: "Nota interna del negocio" });
let r = await page(visit.token);
let shown = r.body as PublicAppointment;
ok(
  r.status === 200 &&
    shown.serviceName === service[1] &&
    shown.date === visit.date &&
    shown.startTime === visit.startTime &&
    shown.professionalName.startsWith("Agenda Cita") &&
    shown.place === "home" &&
    shown.business.name === businessName &&
    shown.business.slug === slug,
  "muestra el servicio, la fecha, la hora, el profesional, la modalidad y el negocio",
  r.body,
);
ok(shown.canConfirm && shown.confirmedAt === null && shown.cancellation.status === "allowed" && shown.cancellation.noticeHours === 24, "se puede confirmar y cancelar", shown);
let json = JSON.stringify(r.body);
ok(
  [zoe.name, "Zoe", zoe.email, zoe.phone, zoe.documentId, "Calle Secreta", "Portón verde", "Nota interna", visit.token].every((value) => !json.includes(value)),
  "sin el nombre, el email, el teléfono ni la cédula del paciente, ni la dirección de la visita, las notas o el token",
  json,
);
ok(r.headers.get("cache-control") === "private, no-store" && !r.headers.get("set-cookie"), "con Cache-Control: private, no-store y sin cookie", [
  r.headers.get("cache-control"),
  r.headers.get("set-cookie"),
]);
const online = appointment(patient("Victor Virtual"), 3 * 1440, { virtual: true });
r = await page(online.token);
ok(r.status === 200 && r.body.place === "virtual" && !JSON.stringify(r.body).includes("sala-secreta-010"), "una virtual, sin el enlace de la videollamada", r.body);

const ana = patient("Ana Sesion");
const bruno = patient("Bruno Sesion");
const session = appointment(ana, 4 * 1440, { extras: [bruno] });
const brunoToken = accessToken(session.id, bruno.id);
r = await page(brunoToken);
ok(r.status === 200 && r.body.cancellation.status === "not_main" && r.body.canConfirm && r.body.payment === false, "la otra persona de la sesión: su enlace, sin cancelar ni pagar", r.body);
ok(brunoToken !== session.token && /^[0-9a-f]{32}$/.test(brunoToken), "con un enlace distinto del principal", brunoToken);
ok(!JSON.stringify(r.body).includes("Ana") && !JSON.stringify(r.body).includes(ana.email), "y sin nada del paciente principal", r.body);
r = await visitor()("GET", `/public/payments/${brunoToken}`);
ok(r.status === 404, "su enlace no abre la página de pago (los datos de pago son del principal)", r.body);

const NOT_FOUND = "Este enlace no existe o ya no está disponible.";
const old = appointment(patient("Olga Antigua"), -31 * 1440);
const borderline = appointment(patient("Berta Limite"), -30 * 1440);
const removed = patient("Raul Quitado");
const withRemoved = appointment(patient("Rita Queda"), 5 * 1440, { extras: [removed] });
const removedToken = accessToken(withRemoved.id, removed.id);
sql(`delete from appointment_clients where appointment_id = '${withRemoved.id}' and client_id = '${removed.id}'`);
const answers = {
  inventado: await page(randomBytes(16).toString("hex")),
  "mal formado": await page("no-es-un-token"),
  "de hace 31 días": await page(old.token),
  "de una persona quitada": await page(removedToken),
};
sql(`update businesses set status = 'suspended' where id = '${businessId}'`);
Object.assign(answers, { "de un negocio suspendido": await page(session.token) });
sql(`update businesses set status = 'active' where id = '${businessId}'`);
for (const [label, answer] of Object.entries(answers)) {
  ok(answer.status === 404 && answer.body.error.code === "not_found" && answer.body.error.message === NOT_FOUND, `un enlace ${label}: el mismo 404`, answer.body);
}
r = await page(borderline.token);
ok(r.status === 200 && r.body.past && !r.body.canConfirm && r.body.cancellation.status === "closed", "uno de hace 30 días todavía se abre: «ya pasó», sin botones", r.body);

console.log("Confirmar");
const carla = patient("Carla Confirma");
const toConfirm = appointment(carla, 3 * 1440 + 60);
r = await confirm(toConfirm.token);
let result = r.body as PublicAppointmentResult;
const firstAt = confirmedAt(toConfirm.id);
ok(r.status === 200 && result.already === false && result.appointment.confirmedAt && firstAt, "la primera vez guarda la hora", r.body);
ok(sql(`select status from appointments where id = '${toConfirm.id}'`) === "confirmed" && result.appointment.status === "confirmed", "y el estado no cambia");
const confirmLog = () =>
  sql(`select actor_name || '|' || coalesce(actor_id::text, '') || '|' || summary from audit_logs where entity_id = '${toConfirm.id}' and action = 'appointment.client_confirmed'`)
    .split("\n")
    .filter(Boolean);
ok(
  confirmLog().length === 1 && confirmLog()[0].startsWith("Paciente (desde su email)||Confirmó que va, desde su email: Carla Confirma ("),
  "queda en la actividad, como hecho por el paciente desde su email",
  confirmLog(),
);
r = await confirm(toConfirm.token);
ok(r.status === 200 && r.body.already === true && confirmedAt(toConfirm.id) === firstAt, "la segunda: «ya estaba», sin cambiar la hora", r.body);
ok(confirmLog().length === 1, "ni otra actividad", confirmLog());
ok(emailsOf(toConfirm.id).length === 0, "sin ningún email", emailsOf(toConfirm.id));
r = await page(toConfirm.token);
ok(r.body.confirmedAt === result.appointment.confirmedAt && r.body.status === "confirmed", "la página la muestra confirmada, con la hora", r.body);
const panelView = (await owner("GET", `${B}/appointments/${toConfirm.id}`)).body;
ok(
  panelView.clientConfirmations.length === 1 && panelView.clientConfirmations[0].clientId === carla.id && /Z$/.test(panelView.clientConfirmations[0].confirmedAt),
  "el panel recibe quién confirmó y cuándo (clientConfirmations)",
  panelView.clientConfirmations,
);

const noHeader = appointment(patient("Nora Cabecera"), 3 * 1440);
const raw = await fetch(`${BASE}/public/appointments/${noHeader.token}/confirm`, { method: "POST", headers: viaProxy("198.51.100.251") });
ok(raw.status === 403 && confirmedAt(noHeader.id) === "", "sin la cabecera X-Requested-With: 403, y no confirma (un antivirus que abre el enlace no puede)", raw.status);
const cancelledOne = appointment(patient("Ciro Cancelada"), 3 * 1440, { status: "cancelled" });
r = await confirm(cancelledOne.token);
ok(r.status === 409 && r.body.error.message === "Esta cita ya no está activa.", "una cita cancelada: 409", r.body);
const started = appointment(patient("Elsa Empezada"), -10);
r = await confirm(started.token);
ok(r.status === 409 && r.body.error.message === "Esta cita ya pasó.", "una que ya empezó: 409", r.body);
r = await confirm(brunoToken);
ok(r.status === 200 && r.body.already === false && extraConfirmedAt(session.id, bruno.id) !== "" && confirmedAt(session.id) === "", "la otra persona de la sesión confirma la suya (y no la del principal)", r.body);
const brunoLog = sql(`select summary from audit_logs where entity_id = '${session.id}' and action = 'appointment.client_confirmed'`);
ok(brunoLog.includes("Bruno Sesion") && !brunoLog.includes("Ana Sesion"), "la actividad nombra sólo a quien confirmó", brunoLog);
let sessionView = (await owner("GET", `${B}/appointments/${session.id}`)).body;
ok(
  sessionView.clientConfirmations.length === 1 && sessionView.clientConfirmations[0].clientId === bruno.id,
  "el panel ve que confirmó Bruno, no Ana",
  sessionView.clientConfirmations,
);
r = await confirm(session.token);
sessionView = (await owner("GET", `${B}/appointments/${session.id}`)).body;
ok(
  sessionView.clientConfirmations.map((c: { clientId: string }) => c.clientId).join(",") === `${ana.id},${bruno.id}`,
  "y con los dos, el principal primero",
  sessionView.clientConfirmations,
);

console.log("La confirmación se borra si cambia la cita");
const diego = patient("Diego Mueve");
const emma = patient("Emma Mueve");
const moving = appointment(diego, 6 * 1440, { extras: [emma] });
const emmaToken = accessToken(moving.id, emma.id);
const confirmBoth = async () => {
  await confirm(moving.token);
  await confirm(emmaToken);
  return confirmedAt(moving.id) !== "" && extraConfirmedAt(moving.id, emma.id) !== "";
};
ok(await confirmBoth(), "(los dos confirman)");
r = await owner("PUT", `${B}/appointments/${moving.id}`, input(moving, diego.id, { notes: "Traer exámenes", price: 30 }));
ok(r.status === 200 && confirmedAt(moving.id) !== "" && extraConfirmedAt(moving.id, emma.id) !== "", "cambiar las notas o el precio no la borra", r.body);
ok(r.body.clientConfirmations.length === 2, "y el panel lo ve", r.body.clientConfirmations);
const before = emailsOf(moving.id).length;
const later = { ...moving, startTime: minutesToTime(Number(moving.startTime.slice(0, 2)) * 60 + Number(moving.startTime.slice(3)) + 60) };
r = await owner("PUT", `${B}/appointments/${moving.id}`, input(moving, diego.id, { startTime: later.startTime }));
ok(r.status === 200 && confirmedAt(moving.id) === "" && extraConfirmedAt(moving.id, emma.id) === "", "cambiar la hora la borra, también la de la otra persona", r.body);
ok(r.body.clientConfirmations.length === 0, "y el panel ya no la muestra", r.body.clientConfirmations);
/** Los cambios guardados en la última edición de la cita, en la actividad. */
const lastChanges = (appointmentId: string): { label: string; before: string | null; after: string | null }[] =>
  JSON.parse(
    sql(
      `select coalesce(changes::text, '[]') from audit_logs where entity_id = '${appointmentId}' and action in ('appointment.updated', 'appointment.rescheduled') order by created_at desc limit 1`,
    ) || "[]",
  );
const confirmationChange = lastChanges(moving.id).find((change) => change.label === "Confirmó que va (desde su email)");
ok(
  confirmationChange?.before === "Diego Mueve y Emma Mueve" && confirmationChange.after === "Nadie",
  "la actividad dice que se borró («Confirmó que va: Diego Mueve y Emma Mueve → Nadie»)",
  lastChanges(moving.id),
);
const updated = sql(
  `select to_email || '|' || replace(body, chr(10), ' ') from notifications where appointment_id = '${moving.id}' and type = 'appointment_updated' order by created_at`,
)
  .split("\n")
  .filter(Boolean);
ok(
  emailsOf(moving.id).length > before &&
    updated.some((row) => row.startsWith(`${diego.email}|`) && row.includes(`/cita/${moving.token}`)) &&
    updated.some((row) => row.startsWith(`${emma.email}|`) && row.includes(`/cita/${emmaToken}`)),
  "el email del cambio lleva otra vez el enlace de cada uno",
  updated.map((row) => row.slice(0, 80)),
);
ok(await confirmBoth(), "(vuelven a confirmar)");
r = await owner("PUT", `${B}/appointments/${moving.id}`, input(later, diego.id, { date: addDaysISO(moving.date, 1) }));
ok(r.status === 200 && confirmedAt(moving.id) === "" && extraConfirmedAt(moving.id, emma.id) === "", "cambiar la fecha también", r.body);
ok(await confirmBoth(), "(vuelven a confirmar)");
const movedDate = addDaysISO(moving.date, 1);
const otherAgenda = agenda();
r = await owner("PUT", `${B}/appointments/${moving.id}`, input({ ...later, date: movedDate }, diego.id, { professionalId: otherAgenda }));
ok(r.status === 200 && confirmedAt(moving.id) === "" && extraConfirmedAt(moving.id, emma.id) === "", "y cambiar el profesional", r.body);
ok(await confirmBoth(), "(vuelven a confirmar)");
r = await owner("PATCH", `${B}/appointments/${moving.id}/status`, { status: "cancelled" });
ok(r.status === 200 && confirmedAt(moving.id) === "" && extraConfirmedAt(moving.id, emma.id) === "", "cancelarla desde el panel la borra", r.body);
r = await owner("PATCH", `${B}/appointments/${moving.id}/status`, { status: "confirmed" });
ok(r.status === 200 && confirmedAt(moving.id) === "", "al reactivarla sigue sin confirmar", r.body);
r = await confirm(moving.token);
ok(r.status === 200 && r.body.already === false && confirmedAt(moving.id) !== "", "y el paciente puede volver a confirmar", r.body);
r = await owner("PATCH", `${B}/appointments/${moving.id}/status`, { status: "completed" });
ok(r.status === 200 && confirmedAt(moving.id) !== "", "marcarla Atendida la conserva («confirmó y vino»)", r.body);

console.log("Cancelar (CE-002)");
const fer = patient("Fer Cancela");
const gus = patient("Gus Cancela");
const onTime = appointment(fer, 25 * 60, { extras: [gus] });
const busy = async (created: Created) =>
  ((await visitor()("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body.busySlots as { date: string; startTime: string; professionalId: string }[]).some(
    (slot) => slot.date === created.date && slot.startTime === created.startTime && slot.professionalId === created.professionalId,
  );
ok(await busy(onTime), "(la hora está ocupada en la página de reservas)");
r = await page(onTime.token);
ok(r.body.cancellation.status === "allowed" && r.body.cancellation.policy !== "", "a 25 h con 24 h de antelación: se puede, con la política del negocio", r.body.cancellation);
r = await cancel(onTime.token);
ok(r.status === 200 && r.body.already === false && r.body.appointment.status === "cancelled", "cancela", r.body);
ok(sql(`select status from appointments where id = '${onTime.id}'`) === "cancelled", "la cita queda Cancelada");
ok(!(await busy(onTime)), "y la hora aparece libre en la página de reservas");
let emails = emailsOf(onTime.id);
ok(
  emails.includes(`appointment_cancelled|${fer.email}`) && emails.includes(`appointment_cancelled|${gus.email}`),
  "sale la cancelación a cada persona",
  emails,
);
ok(emails.filter((e) => e.startsWith("appointment_copy|")).length === 1 && emails.includes(`appointment_copy|${COPY_EMAIL}`), "una sola copia al profesional", emails);
ok(emails.includes(`patient_cancelled|${BUSINESS_EMAIL}`), "y el aviso al negocio (su email no es el del profesional)", emails);
const copyBody = sql(`select body from notifications where appointment_id = '${onTime.id}' and type = 'appointment_copy'`);
ok(/La canceló el paciente desde su email\./.test(copyBody) && !copyBody.includes("/cita/"), "la copia dice que la canceló el paciente, sin los enlaces del paciente", copyBody.slice(0, 300));
const noticeBody = sql(`select subject || '|' || body from notifications where appointment_id = '${onTime.id}' and type = 'patient_cancelled'`);
ok(noticeBody.startsWith("Cita cancelada por el paciente: Fer Cancela y Gus Cancela") && !noticeBody.includes("/cita/"), "el aviso al negocio nombra a los pacientes, sin sus enlaces", noticeBody.slice(0, 300));
const cancelLog = sql(
  `select actor_name || '|' || coalesce(actor_id::text, '') || '|' || summary || '|' || changes::text from audit_logs where entity_id = '${onTime.id}' and action = 'appointment.client_cancelled'`,
);
const estado = JSON.parse(cancelLog.split("|").at(-1) ?? "[]").find((change: { label: string }) => change.label === "Estado");
ok(
  cancelLog.startsWith("Paciente (desde su email)||Cancelada por el paciente desde su email: Fer Cancela y Gus Cancela (") &&
    estado?.before === "Confirmada" &&
    estado?.after === "Cancelada",
  "la actividad: «Cancelada por el paciente desde su email», con «Estado» en los cambios",
  cancelLog,
);
r = await page(onTime.token);
ok(r.status === 200 && r.body.status === "cancelled" && r.body.cancellation.status === "closed" && !r.body.canConfirm, "la página la muestra cancelada, sin botones", r.body);
const emailCount = emailsOf(onTime.id).length;
r = await cancel(onTime.token);
ok(r.status === 200 && r.body.already === true && emailsOf(onTime.id).length === emailCount, "cancelar otra vez: «ya estaba», sin otro email", r.body);

const late = appointment(patient("Hugo Tarde"), 23 * 60);
r = await page(late.token);
ok(r.body.cancellation.status === "too_late", "a 23 h: fuera de plazo", r.body.cancellation);
r = await cancel(late.token);
ok(
  r.status === 409 && r.body.error.message === `Para cancelar con menos de 24 h, escríbele a ${businessName}.` && sql(`select status from appointments where id = '${late.id}'`) === "confirmed",
  "y cancelar da 409, sin tocar la cita",
  r.body,
);
bookingSettings({ cancellationNoticeHours: 0 });
const soon = appointment(patient("Ines Pronto"), 10);
r = await cancel(soon.token);
ok(r.status === 200 && r.body.appointment.status === "cancelled", "con la antelación en 0, se cancela hasta el inicio", r.body);
bookingSettings({ cancellationNoticeHours: 24, allowCancellations: false });
const disabled = appointment(patient("Juan Sin"), 3 * 1440);
r = await page(disabled.token);
ok(r.body.cancellation.status === "disabled" && r.body.cancellation.policy === "", "sin «Permitir cancelaciones»: la página dice disabled", r.body.cancellation);
r = await cancel(disabled.token);
ok(r.status === 409 && r.body.error.message === `${businessName} no permite cancelar desde aquí: escríbele para avisarle.`, "y cancelar da 409", r.body);
bookingSettings({ allowCancellations: true });
r = await cancel(brunoToken);
ok(r.status === 409 && r.body.error.message === `Para no asistir, escríbele a ${businessName}.` && sql(`select status from appointments where id = '${session.id}'`) === "confirmed", "la otra persona de la sesión no cancela: 409", r.body);

const raced = appointment(patient("Kira Doble"), 3 * 1440);
const [first, second] = await Promise.all([cancel(raced.token), cancel(raced.token)]);
ok(
  first.status === 200 && second.status === 200 && [first.body.already, second.body.already].sort().join(",") === "false,true",
  "dos cancelaciones a la vez: una sola cancela",
  [first.body, second.body],
);
ok(emailsOf(raced.id).filter((e) => e.startsWith("appointment_cancelled|")).length === 1, "y sale un solo juego de emails", emailsOf(raced.id));
ok(count(`select count(*) from audit_logs where entity_id = '${raced.id}' and action = 'appointment.client_cancelled'`) === 1, "con una sola actividad");

console.log("Cambiar el paciente principal desde el panel");
const leo = patient("Leo Antes");
const mia = patient("Mia Despues");
const swapped = appointment(leo, 3 * 1440);
await confirm(swapped.token);
r = await owner("PUT", `${B}/appointments/${swapped.id}`, input(swapped, mia.id));
const newToken: string = r.body.paymentToken;
ok(r.status === 200 && newToken && newToken !== swapped.token, "la cita recibe un enlace nuevo", r.body);
ok((await page(swapped.token)).status === 404 && (await visitor()("GET", `/public/payments/${swapped.token}`)).status === 404, "el enlace viejo da 404, también el de pago");
shown = await pageOf(newToken);
ok(shown.confirmedAt === null && shown.canConfirm, "el nuevo abre la página, sin la confirmación del anterior", shown);
ok(confirmedAt(swapped.id) === "", "y la base tampoco la guarda");

console.log("«Por verificar» (spec 009)");
// Una paciente de la ficha y otra persona que reservó con su cédula y otros datos (la crea la reserva online).
const real = patient("Nadia Ficha");
const provisional = sql(
  `insert into clients (business_id, name, document_id, email, phone, source, claimed_client_id)
   values ('${businessId}', 'Nadia Otra', '', 'nadia.otra.${tag}@correo.ec', '0998887777', 'booking_page', '${real.id}') returning id`,
).split("\n")[0];
const asMain = appointment({ ...real, id: provisional }, 4 * 1440);
const asExtra = appointment(patient("Omar Principal"), 5 * 1440, { extras: [{ ...real, id: provisional }] });
const extraToken = accessToken(asExtra.id, provisional);
ok((await confirm(asMain.token)).status === 200 && (await confirm(extraToken)).status === 200, "(confirma como principal de una cita y como otra persona de otra)");
const keptAt = [confirmedAt(asMain.id), extraConfirmedAt(asExtra.id, provisional)];
r = await owner("POST", `${B}/clients/${provisional}/confirm-claim`, {});
ok(r.status === 200 && r.body.id === real.id, "el negocio la une a la ficha", r.body);
ok(sql(`select client_id || '|' || payment_token from appointments where id = '${asMain.id}'`) === `${real.id}|${asMain.token}`, "la cita pasa a la ficha con el mismo enlace");
ok(accessToken(asExtra.id, real.id) === extraToken, "y como otra persona de la sesión, también con el mismo enlace", accessToken(asExtra.id, real.id));
ok(confirmedAt(asMain.id) === keptAt[0] && extraConfirmedAt(asExtra.id, real.id) === keptAt[1], "las dos confirmaciones se conservan", [keptAt, confirmedAt(asMain.id), extraConfirmedAt(asExtra.id, real.id)]);
ok((await pageOf(asMain.token)).confirmedAt && (await pageOf(extraToken)).confirmedAt, "y los enlaces de los emails siguen funcionando");

console.log("Límites por conexión");
const fixed = agent({ ip: "203.0.113.77" });
const statuses: number[] = [];
for (let i = 0; i < 61; i++) statuses.push((await fixed("GET", `/public/appointments/${randomBytes(16).toString("hex")}`)).status);
ok(statuses.slice(0, 60).every((s) => s === 404) && statuses[60] === 429, "61 vistas seguidas desde una IP: la 61 da 429", statuses.slice(58));
const actions = agent({ ip: "203.0.113.78" });
const posted: number[] = [];
for (let i = 0; i < 21; i++) posted.push((await actions("POST", `/public/appointments/${randomBytes(16).toString("hex")}/${i % 2 ? "cancel" : "confirm"}`)).status);
ok(posted.slice(0, 20).every((s) => s === 404) && posted[20] === 429, "y 21 confirmaciones o cancelaciones: la 21 da 429", posted.slice(18));
ok((await page(session.token)).status === 200, "otra conexión sigue entrando");

console.log("Aviso por ntfy (cron)");
const ntfy = await fakeNtfy();
let cron = await runCron(ntfy.url);
ok(cron.code === 0, "(una pasada del cron antes, para empezar de cero)", cron.output.slice(-500));
ntfy.received.length = 0;
const paula = patient("Paula Cancela");
const quique = patient("Quique Confirma");
const byPatient = appointment(paula, 3 * 1440);
const onlyConfirmed = appointment(quique, 3 * 1440 + 120);
await cancel(byPatient.token);
await confirm(onlyConfirmed.token);
cron = await runCron(ntfy.url);
const statusNotices = ntfy.received.filter((notice) => /\nDe .+ a .+\n/.test(notice.message));
const mine = statusNotices.filter((notice) => notice.message.includes("Paula C."));
ok(
  cron.code === 0 &&
    mine.length === 1 &&
    mine[0].title === "Agenda360: cita cancelada por el paciente" &&
    mine[0].message.includes("Cancelada por el paciente desde su email") &&
    !mine[0].message.includes("Cambiado desde el panel") &&
    mine[0].message.includes("De Confirmada a Cancelada"),
  "la cancelación: «Agenda360: cita cancelada por el paciente», «Cancelada por el paciente desde su email»",
  ntfy.received,
);
ok(mine[0] && !mine[0].message.includes("Paula Cancela") && !mine[0].message.includes(paula.email) && mine[0].message.includes("pa***@correo.ec"), "con la paciente a medias", mine[0]?.message);
ok(mine[0] && !mine[0].title.includes(businessName), "y sin el negocio en el título", mine[0]?.title);
ok(mine[0] && /Aviso al negocio → re\*\*\*@correo\.ec/.test(mine[0].message) && /Copia al profesional → pr\*\*\*@correo\.ec/.test(mine[0].message), "con los emails: el del paciente, la copia y el aviso al negocio", mine[0]?.message);
ok(!statusNotices.some((notice) => notice.message.includes("Quique C.")), "«Confirmo que voy» no avisa por ntfy", statusNotices.map((n) => n.title));
ntfy.close();
const change = (await findStatusChanges(pool, null, new Date().toISOString(), 500)).changes.find((c) => c.clients[0]?.name === "Paula Cancela");
ok(change?.byPatient === true && statusChangeNotice(change).title === "Agenda360: cita cancelada por el paciente", "findStatusChanges la marca como del paciente", change);

sql(`update businesses set timezone = 'America/Guayaquil' where id = '${businessId}'`);
await pool.end();
done("de la página «Tu cita»");
