// Aviso al paciente en cada cambio de estado de su cita (spec 008): el email que le toca en cada
// cambio, la copia al profesional, la casilla «Avisar al paciente» (notify: false), el interruptor
// «Seguimiento» y el límite de 7 días para Completada y No asistió.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const DEMO = "demo1234";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
  }
};
let cookie = "";
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const session = (await call("POST", "/auth/login", { email: "ricardo@demo.com", password: DEMO, remember: true })).body;
const B = `/businesses/${session.businessId}`;
const businessId: string = session.businessId;
const professional = sql(`select id from professionals where business_id = '${businessId}' and is_active order by created_at limit 1`);
const service = sql(`select id from services where business_id = '${businessId}' order by created_at limit 1`);
const copyTo = sql(
  `select coalesce(nullif(p.email, ''), u.email, '') from professionals p left join users u on u.id = p.user_id where p.id = '${professional}'`,
);
const today = sql(`select to_char(now() at time zone 'America/Guayaquil', 'YYYY-MM-DD')`);
const daysAgo = (days: number) => sql(`select to_char((now() at time zone 'America/Guayaquil')::date - ${days}, 'YYYY-MM-DD')`);

let seq = 0;
/** Un paciente con email propio. */
const patient = (name: string) => {
  const email = `estado.${++seq}.${Date.now()}@example.com`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone) values ('${businessId}', '${name}', '${cedulaFor(email)}', '${email}', '') returning id`,
  ).split("\n")[0];
  return { id, email };
};
let minute = 0;
/** Una cita (de hoy o del día que se pida) a una hora libre de la noche. */
const appointment = (clientId: string, status = "confirmed", date = today) => {
  minute += 20;
  const start = `${String(20 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${service}', '${professional}', '${date}', '${start}', '${start}'::time + interval '15 minutes', '${status}', 0, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
/** Los emails de una cita desde la última vez que se miraron: "tipo → destino". */
const seen = new Map<string, number>();
const newEmails = (appointmentId: string) => {
  const rows = sql(`select type || ' → ' || to_email from notifications where appointment_id = '${appointmentId}' order by created_at, id`)
    .split("\n")
    .filter(Boolean);
  const fresh = rows.slice(seen.get(appointmentId) ?? 0);
  seen.set(appointmentId, rows.length);
  return fresh;
};
const setStatus = (id: string, status: string, notify?: boolean) =>
  call("PATCH", `${B}/appointments/${id}/status`, notify === undefined ? { status } : { status, notify });
const settings = (patch: Record<string, unknown>) =>
  sql(`update businesses set notification_settings = notification_settings || '${JSON.stringify(patch)}'::jsonb where id = '${businessId}'`);
settings({ confirmations: true, cancellations: true, followUps: true });

console.log("Cada cambio de estado avisa al paciente");
const ana = patient("Ana Estado");
const cita = appointment(ana.id);
const step = async (status: string, type: string | null, label: string) => {
  const r = await setStatus(cita, status);
  const emails = newEmails(cita);
  const toPatient = emails.filter((e) => e.endsWith(` → ${ana.email}`));
  ok(
    r.status === 200 && (type ? toPatient.length === 1 && toPatient[0].startsWith(`${type} → `) : toPatient.length === 0),
    label,
    { status: r.status, emails },
  );
  return emails;
};
let emails = await step("pending", "appointment_pending", "de Confirmada a Pendiente: «queda pendiente de confirmar»");
ok(!copyTo || emails.includes(`appointment_copy → ${copyTo}`), "con su copia al profesional", emails);
await step("confirmed", "appointment_confirmed", "de Pendiente a Confirmada: «está confirmada»");
emails = await step("completed", "appointment_completed", "a Completada (cita de hoy): «gracias por tu visita»");
ok(!copyTo || emails.includes(`appointment_copy → ${copyTo}`), "también con copia al profesional", emails);
await step("confirmed", "appointment_confirmed", "de Completada a Confirmada (corrección que avisa)");
await step("no_show", "appointment_no_show", "a No asistió: invitación a elegir otra hora");
await step("pending", "appointment_pending", "de No asistió a Pendiente");
await step("cancelled", "appointment_cancelled", "a Cancelada: la cancelación");
await step("pending", "appointment_updated", "de Cancelada a Pendiente: «vuelve a estar agendada»");

console.log("La casilla «Avisar al paciente»");
let r = await setStatus(cita, "confirmed", false);
ok(r.status === 200 && newEmails(cita).length === 0, "con notify: false no sale ningún email ni copia", r.body);
ok(
  sql(`select summary from audit_logs where entity_id = '${cita}' order by created_at desc limit 1`).endsWith("(sin avisar al paciente)"),
  "y la actividad lo dice",
);
r = await setStatus(cita, "cancelled", false);
ok(r.status === 200 && newEmails(cita).length === 0, "también al cancelar", r.body);
r = await setStatus(cita, "pending", "sí" as never);
ok(r.status === 400, "notify que no es sí o no → 400", r.body);
r = await call("PATCH", `${B}/appointments/${cita}/status`, { status: "pending" });
emails = newEmails(cita);
ok(r.status === 200 && emails.some((e) => e.endsWith(` → ${ana.email}`)), "sin notify, avisa (versiones anteriores del panel)", emails);

console.log("Los interruptores");
settings({ followUps: false });
const luis = patient("Luis Estado");
const cita2 = appointment(luis.id);
newEmails(cita2);
await setStatus(cita2, "completed");
ok(newEmails(cita2).length === 0, "«Seguimiento» apagado: Completada no avisa");
await setStatus(cita2, "pending");
ok(newEmails(cita2).some((e) => e.startsWith("appointment_pending")), "pero volver a Pendiente sí (va con Confirmaciones)");
await setStatus(cita2, "no_show");
ok(newEmails(cita2).length === 0, "ni No asistió");
settings({ confirmations: false });
await setStatus(cita2, "confirmed");
await setStatus(cita2, "pending");
ok(newEmails(cita2).length === 0, "«Confirmaciones» apagado: ni Confirmada ni Pendiente avisan");
sql(`update businesses set notification_settings = (notification_settings - 'followUps') || '{"confirmations": true}'::jsonb where id = '${businessId}'`);
await setStatus(cita2, "completed");
ok(newEmails(cita2).some((e) => e.startsWith("appointment_completed")), "un negocio guardado sin «Seguimiento» lo tiene encendido");

console.log("El límite de 7 días");
const vieja = appointment(patient("Vera Estado").id, "confirmed", daysAgo(10));
newEmails(vieja);
await setStatus(vieja, "completed");
ok(newEmails(vieja).length === 0, "una cita de hace 10 días marcada Completada: sin email");
await setStatus(vieja, "no_show");
ok(newEmails(vieja).length === 0, "ni No asistió");
const reciente = appointment(patient("Rita Estado").id, "confirmed", daysAgo(7));
newEmails(reciente);
await setStatus(reciente, "completed");
ok(newEmails(reciente).some((e) => e.startsWith("appointment_completed")), "una de hace 7 días, sí");
const futura = appointment(patient("Fede Estado").id, "confirmed", sql(`select to_char((now() at time zone 'America/Guayaquil')::date + 3, 'YYYY-MM-DD')`));
newEmails(futura);
await setStatus(futura, "completed");
ok(newEmails(futura).length === 0, "una futura marcada Completada por error: sin «gracias por tu visita»");

console.log("Varios pacientes");
const pareja = [patient("Pía Pareja"), patient("Pablo Pareja")];
const sesion = appointment(pareja[0].id);
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${sesion}', '${pareja[1].id}', '${businessId}')`);
newEmails(sesion);
await setStatus(sesion, "pending");
emails = newEmails(sesion);
ok(
  pareja.every((p) => emails.includes(`appointment_pending → ${p.email}`)) && emails.filter((e) => e.startsWith("appointment_copy")).length <= 1,
  "cada paciente recibe el suyo y la copia sale una sola vez",
  emails,
);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de los avisos de cambio de estado pasaron");
process.exitCode = failures ? 1 : 0;
