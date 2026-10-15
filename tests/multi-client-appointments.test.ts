// Citas con varios pacientes (spec 004, sesiones de pareja): el super admin lo habilita por negocio
// (PUT /admin/businesses/:id/multi-client-appointments); una cita tiene hasta 3 pacientes; cada uno
// recibe sus emails y su recordatorio; la copia al profesional sale una vez; la hora se ocupa una vez;
// el historial, la actividad, el alcance de los profesionales y la historia clínica los incluyen.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import type { Appointment, AuditLog, Business, Client, ClientActivity } from "../src/shared/types/index.ts";
import { viaProxy } from "./helpers/proxy.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
  }
};
let ipCounter = 20;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...viaProxy(`198.51.100.${ipCounter++ % 250}`),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};

const { pool, transaction } = await import("../src/db/pool.ts");
const { runReminderJob } = await import("../src/services/notifications.ts");
const { reminderCurrentSql } = await import("../src/services/reminder-rules.ts");

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const { a: elena, session: es } = await login("elena@demo.com"); // Recepción
const { a: valeria } = await login("valeria@demo.com"); // rol Profesional
const { a: admin } = await login("admin@demo.com"); // super admin
const businessId: string = rs.businessId;
const B = `/businesses/${businessId}`;
const SWITCH = `/admin/businesses/${businessId}/multi-client-appointments`;
const businessNow = async () => (await ricardo("GET", B)).body as Business;

// Los emails se cuentan en la base (no salen: no hay credenciales de Gmail en las pruebas).
sql(
  `update businesses set notification_settings = notification_settings
     || '{"confirmations": true, "cancellations": true, "reminders": true, "reminderHoursBefore": 24}'
    where id = '${businessId}'`,
);
const emails = (appointmentId: string, type?: string) =>
  sql(
    `select type || '|' || to_email from notifications where appointment_id = '${appointmentId}'
       ${type ? `and type = '${type}'` : ""} order by created_at, to_email`,
  )
    .split("\n")
    .filter(Boolean);
const countOf = (appointmentId: string, type: string) => emails(appointmentId, type).length;

const tag = Date.now().toString(36);
let seed = 700;
async function newPatient(name: string, extra: Partial<Client> = {}): Promise<Client> {
  const slug = name.split(" ")[0].toLowerCase();
  const r = await ricardo("POST", `${B}/clients`, {
    name,
    documentId: cedulaFor(seed++),
    email: `${slug}.${tag}@correo.ec`,
    phone: "",
    address: "",
    notes: "",
    isActive: true,
    ...extra,
  });
  if (r.status !== 200) throw new Error(`No se pudo crear ${name}: ${JSON.stringify(r.body)}`);
  return r.body;
}

const professionals = (await ricardo("GET", `${B}/professionals`)).body as { id: string; displayName: string }[];
const ricardoAgenda = professionals.find((p) => p.displayName === "Ricardo Paredes")!;
const valeriaAgenda = professionals.find((p) => p.displayName === "Dra. Valeria Cruz")!;
const service = ((await ricardo("GET", `${B}/services`)).body as { id: string; name: string; price: number }[]).find(
  (s) => s.name === "Consulta odontológica",
)!;
ok(ricardoAgenda && valeriaAgenda && service, "clínica demo con las agendas de Ricardo y Valeria y la consulta odontológica");

const DATE = "2031-06-03";
const input = (fields: Record<string, unknown>) => ({
  serviceId: service.id,
  date: DATE,
  startTime: "10:00",
  durationMinutes: 30,
  price: 20,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
  professionalId: ricardoAgenda.id,
  ...fields,
});

const ana = await newPatient("Ana Pareja");
const carlos = await newPatient("Carlos Pareja");
const luis = await newPatient("Luis Pareja");
const diana = await newPatient("Diana Pareja");
const inactive = await newPatient("Ines Inactiva", { isActive: false });

console.log("Interruptor: apagado por defecto y sólo lo cambia el super admin");
let business = await businessNow();
ok(business.multiClientAppointments === false, "el negocio lo trae apagado", business.multiClientAppointments);
ok(
  sql("select count(*) from businesses where multi_client_appointments") === "0",
  "ningún negocio demo lo tiene encendido",
);
let r = await ricardo("POST", `${B}/appointments`, input({ clientId: ana.id, extraClientIds: [carlos.id] }));
ok(r.status === 400 && /no tiene habilitadas/.test(r.body?.error?.message), "sin el interruptor no se agregan pacientes", r.body);
r = await ricardo("PATCH", B, { multiClientAppointments: true });
ok(r.status === 200 && r.body.multiClientAppointments === false, "el propietario no puede encenderlo (se ignora)", r.body);
r = await ricardo("PUT", SWITCH, { enabled: true });
ok(r.status === 403, "el propietario no usa la ruta del super admin", r.status);
r = await admin("PUT", SWITCH, { enabled: "sí" });
ok(r.status === 400, "el valor tiene que ser sí o no", r.body);
r = await admin("PUT", SWITCH, { enabled: true });
ok(r.status === 200 && r.body.multiClientAppointments === true, "el super admin lo enciende", r.body);
r = await admin("PUT", SWITCH, { enabled: true });
const switchLogs = (await ricardo("GET", `${B}/audit-logs?action=platform.multi_client_appointments_changed`)).body.entries as AuditLog[];
ok(
  switchLogs.length === 1 && /Activó las citas con varios pacientes/.test(switchLogs[0].summary),
  "queda una vez en la actividad (repetir el mismo valor no deja otra)",
  switchLogs,
);
const profile = (await agent()("GET", "/public/businesses/dental-sonrisa")).body;
ok(profile && !("multiClientAppointments" in profile.business), "el perfil público no lo muestra", profile?.business);

console.log("Crear una sesión de pareja (y de tres)");
r = await ricardo("POST", `${B}/appointments`, input({ clientId: ana.id, extraClientIds: [carlos.id, luis.id] }));
const session: Appointment = r.body;
ok(r.status === 200 && JSON.stringify(session.extraClientIds) === JSON.stringify([carlos.id, luis.id]), "la cita queda con 3 pacientes, en orden", r.body);
let confirmed = emails(session.id, "appointment_confirmed");
ok(
  confirmed.length === 3 && [ana, carlos, luis].every((c) => confirmed.includes(`appointment_confirmed|${c.email}`)),
  "cada paciente recibe su confirmación",
  confirmed,
);
const trio = [ana, carlos, luis];
const bodies = (
  await pool.query(
    `select to_email as to, body from notifications where appointment_id = $1 and type = 'appointment_confirmed'`,
    [session.id],
  )
).rows as { to: string; body: string }[];
ok(
  bodies.length === 3 &&
    bodies.every(({ to, body }) => {
      const own = trio.find((c) => c.email === to)!;
      return body.includes(own.name) && trio.filter((c) => c !== own).every((c) => !body.includes(c.name) && !body.includes(c.email));
    }),
  "cada email saluda sólo a su paciente y no muestra a los demás",
  bodies.map(({ to, body }) => ({ to, body: body.slice(0, 120) })),
);
// Spec 010: cada persona, con su propio enlace a «Tu cita»; el principal, el del pago.
const linkOf = new Map([
  [ana.email, sql(`select payment_token from appointments where id = '${session.id}'`)],
  [carlos.email, sql(`select access_token from appointment_clients where appointment_id = '${session.id}' and client_id = '${carlos.id}'`)],
  [luis.email, sql(`select access_token from appointment_clients where appointment_id = '${session.id}' and client_id = '${luis.id}'`)],
]);
ok(new Set(linkOf.values()).size === 3, "tres enlaces distintos a «Tu cita»", [...linkOf.values()]);
ok(
  bodies.every(({ to, body }) => body.includes(`/cita/${linkOf.get(to)}`) && [...linkOf.values()].every((token) => token === linkOf.get(to) || !body.includes(token))),
  "cada email lleva el enlace de su paciente y no el de los demás",
  bodies.map(({ to, body }) => ({ to, link: body.match(/\/cita\/\w+/)?.[0] })),
);
const visitor = agent();
const pages = await Promise.all([...linkOf.values()].map(async (token) => (await visitor("GET", `/public/appointments/${token}`)).body));
ok(
  pages[0].cancellation.status !== "not_main" && pages.slice(1).every((page) => page.cancellation.status === "not_main" && page.payment === false),
  "sólo el principal puede cancelar y pagar desde «Tu cita»",
  pages.map((page) => [page.cancellation?.status, page.payment]),
);
const copies = sql(`select subject from notifications where appointment_id = '${session.id}' and type = 'appointment_copy'`).split("\n").filter(Boolean);
ok(copies.length === 1 && copies[0].includes("Ana Pareja, Carlos Pareja y Luis Pareja"), "una sola copia al profesional, con los tres nombres", copies);
const created = (await ricardo("GET", `${B}/audit-logs?entityType=appointment&entityId=${session.id}`)).body.entries as AuditLog[];
ok(created.some((log) => /Ana Pareja, Carlos Pareja y Luis Pareja/.test(log.summary)), "la actividad nombra a los tres", created.map((l) => l.summary));

console.log("Reglas al guardar");
const put = (fields: Record<string, unknown>) => ricardo("PUT", `${B}/appointments/${session.id}`, input({ clientId: ana.id, ...fields }));
r = await put({ extraClientIds: [carlos.id, luis.id, diana.id] });
ok(r.status === 400 && /como máximo 3/.test(r.body?.error?.message), "no deja un cuarto paciente", r.body);
r = await put({ extraClientIds: [carlos.id, carlos.id] });
ok(r.status === 400 && /ya está en la cita/.test(r.body?.error?.message), "no deja repetir un paciente", r.body);
r = await put({ extraClientIds: [ana.id] });
ok(r.status === 400 && /ya está en la cita/.test(r.body?.error?.message), "el principal no puede estar también entre los otros", r.body);
r = await put({ extraClientIds: [carlos.id, inactive.id] });
ok(r.status === 400 && /está inactivo/.test(r.body?.error?.message), "no agrega a un paciente inactivo", r.body);
r = await put({ extraClientIds: [carlos.id, "00000000-0000-4000-8000-000000000000"] });
ok(r.status === 404, "un paciente que no existe → 404", r.body);
r = await ricardo("POST", `${B}/appointments`, input({ clientId: diana.id }));
ok(r.status === 409, "la hora sigue ocupada una sola vez: otra cita a la misma hora en esa agenda choca", r.body);
ok(
  sql(`select count(*) from appointment_clients where appointment_id = '${session.id}'`) === "2",
  "ningún intento fallido cambió la cita",
);

console.log("Cambios: le llegan a todos");
r = await put({ extraClientIds: [carlos.id, luis.id], startTime: "11:00" });
ok(r.status === 200 && countOf(session.id, "appointment_updated") === 3, "reprogramar: un email de cambio por paciente", emails(session.id));
ok(countOf(session.id, "appointment_copy") === 2, "y una copia más al profesional");
r = await put({ extraClientIds: [carlos.id], startTime: "11:00" });
let cancelled = emails(session.id, "appointment_cancelled");
ok(
  r.status === 200 && cancelled.length === 1 && cancelled[0] === `appointment_cancelled|${luis.email}`,
  "quitar a Luis: sólo él recibe la cancelación",
  cancelled,
);
ok(countOf(session.id, "appointment_updated") === 3, "los que siguen no reciben nada", emails(session.id));
r = await put({ extraClientIds: [carlos.id, diana.id], startTime: "11:00" });
confirmed = emails(session.id, "appointment_confirmed");
ok(
  r.status === 200 && confirmed.length === 4 && confirmed.includes(`appointment_confirmed|${diana.email}`),
  "agregar a Diana a una cita confirmada: sólo ella recibe la confirmación",
  confirmed,
);
r = await ricardo("PUT", `${B}/appointments/${session.id}`, input({ clientId: ana.id, startTime: "11:00" }));
ok(
  r.status === 200 && JSON.stringify(r.body.extraClientIds) === JSON.stringify([carlos.id, diana.id]),
  "un formulario sin extraClientIds (front anterior) los conserva",
  r.body,
);
sql(`update clients set email = '${carlos.email}' where id = '${diana.id}'`);
const updatedBefore = countOf(session.id, "appointment_updated");
r = await put({ extraClientIds: [carlos.id, diana.id], startTime: "12:00" });
ok(
  r.status === 200 && countOf(session.id, "appointment_updated") === updatedBefore + 2,
  "Carlos y Diana con el mismo correo: un solo email para los dos",
  emails(session.id, "appointment_updated"),
);
sql(`update clients set email = '${diana.email}' where id = '${diana.id}'`);

console.log("Recordatorios: uno por paciente");
const at = new Date(`2031-06-02T13:00:00-05:00`); // el día anterior, 23 h antes
let queued = await transaction((db) => runReminderJob(db, businessId, at));
let reminders = emails(session.id, "appointment_reminder");
ok(
  queued === 3 && [ana, carlos, diana].every((c) => reminders.includes(`appointment_reminder|${c.email}`)),
  "Ana, Carlos y Diana reciben su recordatorio",
  { queued, reminders },
);
queued = await transaction((db) => runReminderJob(db, businessId, at));
ok(queued === 0 && countOf(session.id, "appointment_reminder") === 3, "una sola vez cada uno");
const reminderBodies = (
  await pool.query(`select to_email as to, body from notifications where appointment_id = $1 and type = 'appointment_reminder'`, [session.id])
).rows as { to: string; body: string }[];
const reminderLinks = new Map([
  [ana.email, sql(`select payment_token from appointments where id = '${session.id}'`)],
  [carlos.email, sql(`select access_token from appointment_clients where appointment_id = '${session.id}' and client_id = '${carlos.id}'`)],
  [diana.email, sql(`select access_token from appointment_clients where appointment_id = '${session.id}' and client_id = '${diana.id}'`)],
]);
ok(
  reminderBodies.every(({ to, body }) => body.includes(`/cita/${reminderLinks.get(to)}?confirmar=1`)),
  "cada recordatorio lleva el «Confirmo que voy» de su paciente (spec 010)",
  reminderBodies.map(({ to, body }) => ({ to, link: body.match(/\/cita\/\S+/)?.[0] })),
);
const mainKey = sql(`select dedupe_key from notifications where appointment_id = '${session.id}' and type = 'appointment_reminder' and to_email = '${ana.email}'`);
ok(/^reminder:[^:]+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d+$/.test(mainKey), "el del principal conserva la clave de siempre", mainKey);
const reminderCopy = () =>
  sql(
    `select subject || ' | ' || dedupe_key from notifications
      where appointment_id = '${session.id}' and type = 'appointment_copy' and dedupe_key like 'reminder:%'`,
  )
    .split("\n")
    .filter(Boolean);
ok(
  reminderCopy().length === 1 &&
    reminderCopy()[0] === `Copia · Ana Pareja, Carlos Pareja y Diana Pareja: Recuerda que tienes una cita mañana | ${mainKey}:copy`,
  "el profesional recibe una sola copia del recordatorio, con los tres nombres",
  reminderCopy(),
);
r = await put({ extraClientIds: [carlos.id], startTime: "12:00" });
const current = (
  await pool.query(
    `select c.to_email as to, ${reminderCurrentSql("c", "a")} as current
       from notifications c join appointments a on a.id = c.appointment_id
      where c.type = 'appointment_reminder' and c.appointment_id = $1`,
    [session.id],
  )
).rows as { to: string; current: boolean }[];
const isCurrent = (email: string) => current.find((row) => row.to === email)?.current;
ok(
  isCurrent(ana.email) === true && isCurrent(carlos.email) === true && isCurrent(diana.email) === false,
  "al quitar a Diana, su recordatorio en cola deja de valer y los demás siguen",
  current,
);
const copyCurrent = (
  await pool.query(
    `select ${reminderCurrentSql("c", "a")} as current
       from notifications c join appointments a on a.id = c.appointment_id
      where c.type = 'appointment_copy' and c.dedupe_key like 'reminder:%' and c.appointment_id = $1`,
    [session.id],
  )
).rows as { current: boolean }[];
ok(copyCurrent.length === 1 && copyCurrent[0].current === true, "la copia del recordatorio sigue valiendo (la fecha y hora no cambiaron)", copyCurrent);

console.log("Interruptor apagado: se conservan, se pueden quitar, no agregar");
r = await admin("PUT", SWITCH, { enabled: false });
ok(r.status === 200 && r.body.multiClientAppointments === false, "el super admin lo apaga", r.body);
r = await ricardo("GET", `${B}/appointments/${session.id}`);
ok(JSON.stringify(r.body.extraClientIds) === JSON.stringify([carlos.id]), "la cita conserva a Carlos", r.body);
r = await put({ extraClientIds: [carlos.id, luis.id], startTime: "12:00" });
ok(r.status === 400 && /no tiene habilitadas/.test(r.body?.error?.message), "no se puede agregar a otro", r.body);
r = await put({ extraClientIds: [carlos.id], startTime: "13:00" });
ok(r.status === 200, "editar la cita con los mismos pacientes sí", r.body);
const updatesNow = countOf(session.id, "appointment_updated");
ok(emails(session.id, "appointment_updated").slice(-2).some((e) => e.endsWith(carlos.email)), "y Carlos sigue recibiendo los avisos", emails(session.id));
r = await put({ extraClientIds: [], startTime: "13:00" });
ok(r.status === 200 && r.body.extraClientIds.length === 0, "quitarlo también", r.body);
ok(countOf(session.id, "appointment_updated") === updatesNow, "quitarlo no manda cambios a los demás");
await admin("PUT", SWITCH, { enabled: true });

console.log("Historial, actividad y borrado");
r = await put({ extraClientIds: [carlos.id, luis.id], startTime: "13:00" });
const history = (await ricardo("GET", `${B}/appointments?clientId=${carlos.id}`)).body as Appointment[];
ok(history.some((a) => a.id === session.id), "la sesión está en el historial de Carlos", history.map((a) => a.id));
r = await ricardo("PATCH", `${B}/appointments/${session.id}/status`, { status: "completed" });
ok(r.status === 200, "se marca como atendida", r.body);
const activity = (await ricardo("GET", `${B}/clients/activity`)).body as ClientActivity[];
const activityOf = (id: string) => activity.find((row) => row.clientId === id);
ok(
  activityOf(carlos.id)?.completed === 1 && activityOf(carlos.id)?.totalSpent === 0 && activityOf(ana.id)?.totalSpent === 20,
  "la actividad cuenta la sesión para Carlos; lo cobrado, sólo para Ana (la principal)",
  { ana: activityOf(ana.id), carlos: activityOf(carlos.id) },
);
r = await ricardo("DELETE", `${B}/clients/${luis.id}`);
const afterDelete = (await ricardo("GET", `${B}/appointments/${session.id}`)).body as Appointment;
ok(
  r.status < 300 && afterDelete?.id === session.id && JSON.stringify(afterDelete.extraClientIds) === JSON.stringify([carlos.id]),
  "borrar a Luis sólo lo quita de la cita",
  { status: r.status, extra: afterDelete?.extraClientIds },
);

console.log("Historia clínica");
const templates = (await ricardo("GET", `${B}/clinical-templates`)).body as { id: string; versionId: string }[];
const general = templates.find((t) => t.id === "evolucion-general")!;
r = await ricardo("POST", `${B}/clients/${carlos.id}/clinical-record/notes`, {
  appointmentId: session.id,
  templateVersionId: general.versionId,
  data: { reason: "Sesión de pareja", findings: "", diagnosis: "", treatment: "", indications: "", next_control: "" },
});
ok(r.status === 200, "Carlos puede tener su evolución vinculada a la sesión", r.body);
r = await ricardo("POST", `${B}/clients/${diana.id}/clinical-record/notes`, {
  appointmentId: session.id,
  templateVersionId: general.versionId,
  data: { reason: "Otra", findings: "", diagnosis: "", treatment: "", indications: "", next_control: "" },
});
ok(r.status === 400 && /otro paciente/.test(r.body?.error?.message), "Diana, que ya no está en la cita, no", r.body);

console.log("Profesional con «sólo sus pacientes»");
r = await ricardo("PATCH", B, { professionalScope: "own" });
ok(r.status === 200, "la clínica elige «sólo sus pacientes»", r.body);
const yolanda = await newPatient("Yolanda Pareja");
const victor = await newPatient("Victor Pareja");
r = await valeria("GET", `${B}/clients/${yolanda.id}`);
ok(r.status === 404 || r.body === null, "antes, Valeria no ve a Yolanda", r.status);
r = await elena("POST", `${B}/appointments`, input({
  clientId: victor.id,
  extraClientIds: [yolanda.id],
  professionalId: valeriaAgenda.id,
  date: "2031-06-04",
  startTime: "10:00",
}));
ok(r.status === 200, "recepción agenda una sesión de pareja en la agenda de Valeria", r.body);
r = await valeria("GET", `${B}/clients/${yolanda.id}`);
ok(r.status === 200 && r.body?.id === yolanda.id, "ahora Valeria ve a Yolanda (paciente de su cita)", r.body);
const valeriaClients = (await valeria("GET", `${B}/clients`)).body as Client[];
ok(valeriaClients.some((c) => c.id === yolanda.id && !c.restricted), "y la tiene en su lista, con sus datos", valeriaClients.length);
ok(!valeriaClients.some((c) => c.id === carlos.id), "pero no a Carlos (su sesión es de otra agenda)");
await ricardo("PATCH", B, { professionalScope: "all" });

console.log("Avisos al profesional con los nombres de todos");
const { runDailyAgendaJob } = await import("../src/services/notifications.ts");
const { getZonedNow } = await import("../src/shared/lib/time.ts");
sql(`update professionals set email = 'agenda.ricardo.${tag}@correo.ec', notify_new_appointments = true, daily_agenda = true
      where id = '${ricardoAgenda.id}'`);
// Sin email de los pacientes no sale la copia: el profesional recibe el aviso de cita nueva.
const noEmail1 = await newPatient("Nora Sinemail");
const noEmail2 = await newPatient("Omar Sinemail");
sql(`update clients set email = '' where id in ('${noEmail1.id}', '${noEmail2.id}')`);
r = await elena("POST", `${B}/appointments`, input({ clientId: noEmail1.id, extraClientIds: [noEmail2.id], date: "2031-06-05", startTime: "10:00" }));
ok(r.status === 200, "recepción agenda una sesión de pareja de pacientes sin email", r.body);
const notice = sql(`select subject from notifications where appointment_id = '${r.body.id}' and type = 'professional_new_appointment'`);
ok(/Nora Sinemail y Omar Sinemail/.test(notice), "el aviso de cita nueva al profesional nombra a los dos", notice);
const agendaDay = getZonedNow("America/Guayaquil", new Date("2031-06-05T12:00:00Z"));
await transaction((db) => runDailyAgendaJob(db, businessId, agendaDay));
const daily = sql(`select body from notifications where type = 'professional_daily_agenda' and to_email = 'agenda.ricardo.${tag}@correo.ec'`);
ok(/Nora Sinemail y Omar Sinemail/.test(daily), "la agenda del día nombra a los dos en su fila", daily.slice(0, 300));

console.log("Citas existentes");
ok(
  sql(`select count(*) from appointments a where exists (select 1 from appointment_clients ac where ac.appointment_id = a.id)`) === "3",
  "sólo las citas de esta prueba tienen otros pacientes",
);
const demo = (await ricardo("GET", `${B}/appointments?from=2026-01-01&to=2026-12-31`)).body as Appointment[];
ok(demo.length > 0 && demo.every((a) => Array.isArray(a.extraClientIds)), "las citas demo traen extraClientIds (vacío)", demo[0]);
void es;

await pool.end();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de citas con varios pacientes pasaron");
process.exitCode = failures ? 1 : 0;
