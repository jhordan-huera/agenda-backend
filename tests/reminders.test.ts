// Recordatorios de citas: una zona horaria inválida no frena el cron, horas de silencio (21:00 a 7:00),
// citas agendadas ya dentro de la ventana, un recordatorio nuevo al reprogramar o reactivar, y el
// envío, que descarta los que ya no valen.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { OutgoingEmail } from "../src/services/mailer.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Una zona (Etc/GMT±N) en la que ahora son más o menos las `hour` (para probar el envío a cualquier hora). */
function zoneWhereItIs(hour: number): string {
  const offset = ((hour - new Date().getUTCHours() + 36) % 24) - 12;
  return offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
/** Un momento en hora de Ecuador (GMT-5, sin horario de verano). */
const ecuador = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);

const { pool, transaction } = await import("../src/db/pool.ts");
const { runReminderJob } = await import("../src/services/notifications.ts");
const { queueAllReminders, runScheduledTasks } = await import("../src/jobs/scheduled-tasks.ts");
const { processEmailQueue } = await import("../src/services/mailer.ts");

const owner = agent();
const session = (await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: true })).body;
const businessId: string = session.businessId;
const B = `/businesses/${businessId}`;
sql(
  `update businesses set notification_settings = notification_settings || '{"reminders": true, "confirmations": true, "reminderHoursBefore": 24}'
    where id = '${businessId}'`,
);
const [professional] = (await owner("GET", `${B}/professionals`)).body;
const service = (await owner("GET", `${B}/services`)).body.find((s: { isActive: boolean; modes: string[] }) => s.isActive && s.modes.includes("business"));
const client = (await owner("GET", `${B}/clients`)).body.find((c: { email: string }) => c.email);
ok(professional && service && client, "negocio de prueba con agenda, servicio y un cliente con email");
// Un email que no sea de los datos demo (a ésos nunca se les envía nada).
sql(`update clients set email = 'paciente.recordatorios@correo.ec' where id = '${client.id}'`);

// Una agenda sin citas demo para las citas de hoy o del pasado (las demás van en fechas lejanas).
const spare = sql(`insert into professionals (business_id, display_name) values ('${businessId}', 'Agenda de prueba') returning id`).split("\n")[0];

/** Cita creada en la base, con la fecha y hora fijadas en `scheduledAt`. */
const insertAppointment = (date: string, startTime: string, scheduledAt: Date, professionalId: string = professional.id) =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, scheduled_at)
     values ('${businessId}', '${client.id}', '${service.id}', '${professionalId}', '${date}', '${startTime}',
             '${startTime}'::time + interval '30 minutes', 'confirmed', 0, '${scheduledAt.toISOString()}')
     returning id`,
  ).split("\n")[0];
const reminders = (appointmentId: string) =>
  Number(sql(`select count(*) from notifications where type = 'appointment_reminder' and appointment_id = '${appointmentId}'`));
const runJob = (at: Date) => transaction((db) => runReminderJob(db, businessId, at));
const longAgo = new Date("2031-03-01T12:00:00Z");

console.log("Zona horaria inválida");
let r = await owner("PATCH", B, { timezone: "Marte/Olimpo" });
ok(r.status === 400 && /zona horaria/i.test(r.body.error.message), "la API no acepta una zona que no existe", r.body);
r = await owner("PATCH", B, { timezone: "+05:00" });
ok(r.status === 400, "ni un desfase suelto", r.body);
r = await owner("PATCH", B, { timezone: "America/Bogota" });
ok(r.status === 200 && r.body.timezone === "America/Bogota", "una de la lista sí", r.body);
await owner("PATCH", B, { timezone: "America/Guayaquil" });

// Un negocio con una zona rota (guardada antes de validarla) y el de Jhordan con una cita dentro de
// dos horas, en una zona en la que ahora es mediodía (así la prueba no depende de la hora).
const noonZone = zoneWhereItIs(12);
const broken = sql(
  `update businesses set timezone = 'Marte/Olimpo'
    where id = (select id from businesses where id <> '${businessId}' and status = 'active' order by slug limit 1)
    returning id`,
).split("\n")[0];
sql(`update businesses set timezone = '${noonZone}' where id = '${businessId}'`);
const today = sql(`select (now() at time zone '${noonZone}')::date`);
const soon = insertAppointment(today, "14:00", new Date(Date.now() - 3 * 86_400_000), spare);
const result = await queueAllReminders();
ok(result.failures >= 1, "el negocio con la zona rota falla solo", result);
ok(reminders(soon) === 1, "y los demás negocios reciben sus recordatorios igual", reminders(soon));
const report = await runScheduledTasks();
ok(report.reminderFailures >= 1 && report.emails && typeof report.pending === "number", "el cron completo termina (y sigue con la cola de emails)", report);
const migration = readFileSync(new URL("../db/migrations/027_reminders_and_email_retries.sql", import.meta.url), "utf8");
const fix = migration.slice(migration.indexOf("update businesses"), migration.indexOf(";", migration.indexOf("update businesses")) + 1);
sql(fix);
ok(sql(`select timezone from businesses where id = '${broken}'`) === "America/Guayaquil", "la migración 027 arregla las zonas guardadas que no existen");
ok(sql(`select timezone from businesses where id = '${businessId}'`) === noonZone, "y no toca las válidas");
sql(`update businesses set timezone = 'America/Guayaquil' where id = '${businessId}'`);

console.log("Horas de silencio (21:00 a 7:00 del negocio)");
const day = "2031-03-11";
const morning = insertAppointment(day, "10:00", longAgo);
const early = insertAppointment(day, "06:30", longAgo);
await runJob(ecuador("2031-03-10", "22:30"));
ok(reminders(morning) === 0, "la víspera a las 22:30 no sale", reminders(morning));
await runJob(ecuador(day, "02:28"));
ok(reminders(morning) === 0, "ni a las 2:28 de la madrugada", reminders(morning));
await runJob(ecuador(day, "07:00"));
ok(reminders(morning) === 1, "a las 7:00 sale el de la cita de las 10:00", reminders(morning));
ok(reminders(early) === 0, "el de la cita de las 6:30 ya no: empezó antes de las 7:00", reminders(early));
await runJob(ecuador(day, "08:00"));
ok(reminders(morning) === 1, "y no se repite", reminders(morning));

console.log("Citas agendadas ya dentro de la ventana del recordatorio");
const sameDay = insertAppointment("2031-03-13", "18:00", ecuador("2031-03-13", "16:47"));
await runJob(ecuador("2031-03-13", "16:50"));
ok(reminders(sameDay) === 0, "reservada a las 16:47 para las 18:00: a las 16:50 no le llega (acaba de recibir la confirmación)", reminders(sameDay));
const lateNight = insertAppointment("2031-03-14", "10:00", ecuador("2031-03-13", "22:08"));
await runJob(ecuador("2031-03-14", "02:28"));
await runJob(ecuador("2031-03-14", "07:00"));
ok(reminders(lateNight) === 0, "creada a las 22:08 para las 10:00 del día siguiente: ni a las 2:28 ni a las 7:00", reminders(lateNight));
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": false}' where id = '${businessId}'`);
await runJob(ecuador("2031-03-14", "07:00"));
ok(reminders(lateNight) === 1, "sin emails de confirmación (no recibió nada al agendarla), el recordatorio sí sale", reminders(lateNight));
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": true}' where id = '${businessId}'`);

console.log("Reprogramar o reactivar una cita que ya tuvo recordatorio");
const input = (date: string, startTime: string) => ({
  clientId: client.id,
  serviceId: service.id,
  professionalId: professional.id,
  date,
  startTime,
  durationMinutes: service.durationMinutes,
  price: 0,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
});
r = await owner("PUT", `${B}/appointments/${morning}`, input("2031-03-20", "11:00"));
ok(r.status === 200 && r.body.date === "2031-03-20", "se mueve al 20 de marzo a las 11:00", r.body);
await runJob(ecuador("2031-03-19", "12:00"));
ok(reminders(morning) === 2, "le llega otro recordatorio para la fecha nueva", reminders(morning));
await runJob(ecuador("2031-03-19", "13:00"));
ok(reminders(morning) === 2, "uno solo", reminders(morning));
r = await owner("PATCH", `${B}/appointments/${morning}/status`, { status: "cancelled" });
ok(r.status === 200, "se cancela", r.body);
r = await owner("PATCH", `${B}/appointments/${morning}/status`, { status: "confirmed" });
ok(r.status === 200, "y se reactiva", r.body);
const restored = sql(
  `select subject from notifications where appointment_id = '${morning}' and type = 'appointment_updated' order by created_at desc limit 1`,
);
ok(restored === "Tu cita ha sido restablecida", "al reactivarla, el paciente recibe que su cita está en pie", restored);
await runJob(ecuador("2031-03-19", "14:00"));
ok(reminders(morning) === 3, "y vuelve a tener recordatorio", reminders(morning));

console.log("Al enviarlos se vuelven a comprobar");
// Sin otros emails en cola: sólo los de esta prueba.
sql(
  `update notifications set status = 'failed'
    where status = 'queued' and not (type = 'appointment_reminder' and appointment_id is not distinct from '${morning}')`,
);
const queued = sql(
  `select id from notifications where appointment_id = '${morning}' and type = 'appointment_reminder' and status = 'queued' order by created_at`,
).split("\n");
ok(queued.length === 3, "los tres recordatorios siguen en cola (sin Gmail)", queued);
const sent: OutgoingEmail[] = [];
const capture = async (email: OutgoingEmail) => {
  sent.push(email);
};
// Una zona en la que ahora son las 23: horas de silencio.
sql(`update businesses set timezone = '${zoneWhereItIs(23)}' where id = '${businessId}'`);
let pass = await processEmailQueue({ send: capture });
const status = (id: string) => sql(`select status || ' · ' || attempts || ' · ' || coalesce(last_error, '') from notifications where id = '${id}'`);
ok(/^failed/.test(status(queued[0])) && /descartado/.test(status(queued[0])), "el de la fecha anterior se descarta (diría una fecha falsa)", status(queued[0]));
ok(/^failed/.test(status(queued[1])), "el de antes de la cancelación, también", status(queued[1]));
ok(sent.length === 0 && /^queued · 0/.test(status(queued[2])), "el vigente, a las 23:00 del negocio, espera (sin gastar un intento)", [sent.length, status(queued[2])]);
const waitHours = Number(sql(`select extract(epoch from next_attempt_at - now()) / 3600 from notifications where id = '${queued[2]}'`));
ok(waitHours > 6.9 && waitHours <= 8, "hasta las 7:00", waitHours);
sql(`update notifications set next_attempt_at = now() where id = '${queued[2]}'`);
sql(`update businesses set timezone = '${noonZone}' where id = '${businessId}'`);
pass = await processEmailQueue({ send: capture });
ok(pass.sent === 1 && sent.length === 1 && /^sent/.test(status(queued[2])), "de día sale", [pass, status(queued[2])]);

const past = insertAppointment("2025-01-06", "10:00", longAgo, spare);
sql(
  `insert into notifications (business_id, type, to_email, subject, body, appointment_id, status, dedupe_key)
   select a.business_id, 'appointment_reminder', 'paciente@correo.ec', 'Recordatorio', 'Texto', a.id, 'queued',
          'reminder:' || a.id || ':' || to_char(a.date, 'YYYY-MM-DD') || 'T' || to_char(a.start_time, 'HH24:MI') || ':' ||
          floor(extract(epoch from a.scheduled_at) * 1000)::bigint
     from appointments a where a.id = '${past}'`,
);
pass = await processEmailQueue({ send: capture });
const pastStatus = sql(`select status || ' · ' || last_error from notifications where appointment_id = '${past}'`);
ok(pass.skipped === 1 && /^failed · .*ya empezó/.test(pastStatus) && sent.length === 1, "el de una cita que ya pasó no se envía", pastStatus);
sql(`update businesses set timezone = 'America/Guayaquil' where id = '${businessId}'`);

await pool.end();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de recordatorios pasaron");
process.exitCode = failures ? 1 : 0;
