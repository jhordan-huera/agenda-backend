// Informe mensual al propietario (spec 040). Cada cifra del mes calendario anterior contada a mano (citas sin
// canceladas, online, recordatorios, confirmaciones, cancelaciones con tiempo, pacientes nuevos sin importados,
// comprobantes, ingresos y la comparación), el mes en la hora del negocio, las líneas en 0 que no salen, cuándo
// sale (día 1 desde las 8:00, una sola vez, hasta el día 7), lo que no recibe informe (suspendido, sin
// propietario, sin citas o apagado), que el email no lleva datos de pacientes ni planes ni precios, y el
// interruptor: encendido por defecto, sólo el propietario lo cambia y va a la actividad. Datos inventados en 2029,
// lejos de los de las demás pruebas.
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, login, sql } from "./helpers/harness.ts";
import { EMAIL_PRIORITY } from "../src/services/email-limits.ts";
import type { Business } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { queueMonthlyReports } = await import("../src/jobs/scheduled-tasks.ts");
const { previousMonthOf } = await import("../src/services/monthly-report.ts");

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `198.18.4.${(ipSeq++ % 250) + 1}` });
const jhordan = await as("jhordan@demo.com"); // propietario del Centro Profesional
const andrea = await as("andrea@demo.com"); // administradora del Centro
const admin = await as("admin@demo.com"); // super admin
const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const centro: string = jhordan.session.businessId;
const dental: string = ricardo.session.businessId;
const fisio = sql("select id from businesses where slug = 'fisioactiva'");
const GYE = sql(`select timezone from businesses where id = '${centro}'`);

/** La hora de pared del negocio como instante. */
const at = (date: string, time: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${GYE}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));
const run = async (date: string, time: string) => (await queueMonthlyReports(at(date, time))).queued;
const reportsOf = (business: string) => count(`select count(*) from notifications where type = 'monthly_report' and business_id = '${business}'`);
interface ReportEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
  dedupeKey: string;
}
const lastReport = (business: string): ReportEmail | null =>
  JSON.parse(
    sql(`select coalesce((select json_build_object('to', to_email, 'subject', subject, 'body', body, 'html', html, 'dedupeKey', dedupe_key)
                            from notifications where type = 'monthly_report' and business_id = '${business}'
                           order by created_at desc limit 1), 'null')`),
  );

/* ------------------------------------------------------------- El interruptor -- */

console.log("El interruptor «Informe mensual»");
const settingsOf = async (agentFn: typeof jhordan) => ((await agentFn("GET", `/businesses/${centro}`)).body as Business).notificationSettings;
const stored = () => sql(`select coalesce(notification_settings ->> 'monthlyReport', 'sin guardar') from businesses where id = '${centro}'`);
sql(`update businesses set notification_settings = notification_settings - 'monthlyReport' where id = '${centro}'`);
ok(stored() === "sin guardar", "un negocio guardado antes no tiene el campo: cuenta como encendido");
const current = await settingsOf(jhordan);
let r = await jhordan("PATCH", `/businesses/${centro}`, { notificationSettings: { ...current, monthlyReport: false } });
ok(r.status === 200 && stored() === "false", "el propietario lo apaga", [r.status, stored()]);
const audit = sql(
  `select coalesce(changes::text, '') from audit_logs where business_id = '${centro}' and changes::text like '%Informe mensual%' order by created_at desc limit 1`,
);
ok(audit.includes("Informe mensual"), "y queda en la actividad, con el antes y el después", audit.slice(0, 300));
r = await andrea("PATCH", `/businesses/${centro}`, { notificationSettings: { ...current, monthlyReport: true } });
ok([200, 403].includes(r.status) && stored() === "false", "si lo manda una administradora, se ignora", [r.status, stored()]);
r = await admin("PATCH", `/businesses/${centro}`, { notificationSettings: { ...current, monthlyReport: true } });
ok(stored() === "false", "si lo manda el super admin en modo soporte, también se ignora", [r.status, stored()]);
r = await jhordan("PATCH", `/businesses/${centro}`, { notificationSettings: { ...current, monthlyReport: true } });
ok(r.status === 200 && stored() === "true", "el propietario lo vuelve a encender", stored());
ok(EMAIL_PRIORITY.monthly_report === "business", "el informe es del nivel «negocio» del cupo de Gmail");

/* ------------------------------------------------------------------- Datos -- */

const serviceOf = (business: string) => sql(`select id from services where business_id = '${business}' order by name limit 1`);
const agendaOf = (business: string) => sql(`select id from professionals where business_id = '${business}' order by sort_order limit 1`);
let seq = 0;
function client(business: string, options: { source?: string; createdAt?: string } = {}) {
  seq++;
  return sql(
    `insert into clients (business_id, name, email, phone, document_id, source, created_at)
     values ('${business}', 'Paciente Informe ${seq}', 'informe.${seq}@correo.ec', '+593 98 555 ${String(1000 + seq)}',
             '${cedulaFor(`informe-${seq}`)}', '${options.source ?? "dashboard"}', ${options.createdAt ? `'${options.createdAt}'::timestamptz` : "'2029-01-15T15:00:00Z'"})
     returning id`,
  ).split("\n")[0];
}
function appointment(
  business: string,
  options: { client: string; date: string; start: string; status: string; price?: number; source?: string; confirmed?: boolean },
) {
  const [h, m] = options.start.split(":").map(Number);
  const end = `${String(h).padStart(2, "0")}:${String(m + 30).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source,
                               client_confirmed_at, created_at)
     values ('${business}', '${options.client}', '${serviceOf(business)}', '${agendaOf(business)}', '${options.date}', '${options.start}',
             '${end}', '${options.status}', ${options.price ?? 0}, '${options.source ?? "dashboard"}',
             ${options.confirmed ? "now()" : "null"}, '2029-01-15T15:00:00Z')
     returning id`,
  ).split("\n")[0];
}
const cancelledAt = (id: string, business: string, action: string, hoursBefore: number) =>
  sql(`insert into audit_logs (business_id, actor_name, action, entity_type, entity_id, summary, created_at)
       select '${business}', 'Prueba', '${action}', 'appointment', a.id, 'Canceló una cita de prueba',
              ((a.date + a.start_time) at time zone '${GYE}') - make_interval(hours => ${hoursBefore})
         from appointments a where a.id = '${id}'`);
const reminder = (business: string, sentAt: string) =>
  sql(`insert into notifications (business_id, type, to_email, subject, body, status, sent_at, created_at)
       values ('${business}', 'appointment_reminder', 'recordatorio@correo.ec', 'Recordatorio', 'Cuerpo', 'sent', '${sentAt}', '${sentAt}')`);

// Centro Profesional: junio de 2029, contado a mano.
const p1 = client(centro);
const p2 = client(centro);
client(centro, { createdAt: "2029-06-10T15:00:00Z" }); // nuevo del panel: cuenta
client(centro, { source: "import", createdAt: "2029-06-11T15:00:00Z" }); // importado: no cuenta
client(centro, { source: "booking_page", createdAt: "2029-06-12T15:00:00Z" }); // reserva online sin cita: no cuenta
const online = client(centro, { source: "booking_page", createdAt: "2029-06-13T15:00:00Z" }); // con cita: cuenta
client(centro, { createdAt: "2029-07-01T03:00:00Z" }); // 30 de junio a las 22:00 en Ecuador: cuenta en junio
client(centro, { createdAt: "2029-06-01T03:00:00Z" }); // 31 de mayo a las 22:00 en Ecuador: no cuenta

const a1 = appointment(centro, { client: p1, date: "2029-06-04", start: "09:00", status: "completed", price: 30, confirmed: true });
appointment(centro, { client: online, date: "2029-06-05", start: "09:00", status: "completed", price: 20, source: "booking_page" });
const a3 = appointment(centro, { client: p2, date: "2029-06-06", start: "09:00", status: "confirmed", price: 25, source: "booking_page", confirmed: true });
const a4 = appointment(centro, { client: p1, date: "2029-06-07", start: "09:00", status: "cancelled", price: 30 });
const a5 = appointment(centro, { client: p2, date: "2029-06-08", start: "09:00", status: "cancelled", price: 30 });
appointment(centro, { client: p1, date: "2029-06-11", start: "09:00", status: "no_show", price: 40 });
appointment(centro, { client: p2, date: "2029-06-30", start: "20:00", status: "completed", price: 10 });
cancelledAt(a4, centro, "appointment.cancelled", 48); // con tiempo
cancelledAt(a5, centro, "appointment.client_cancelled", 1); // tarde
for (const day of ["2029-05-07", "2029-05-08", "2029-05-09", "2029-05-10"]) {
  appointment(centro, { client: p1, date: day, start: "10:00", status: "completed", price: 30 });
}
appointment(centro, { client: p1, date: "2029-05-11", start: "10:00", status: "cancelled", price: 30 });
reminder(centro, "2029-06-03T14:00:00Z");
reminder(centro, "2029-06-20T14:00:00Z");
reminder(centro, "2029-07-01T00:30:00Z"); // 30 de junio a las 19:30 en Ecuador: cuenta
reminder(centro, "2029-06-01T03:00:00Z"); // 31 de mayo a las 22:00 en Ecuador: no cuenta
sql(`insert into payment_receipts (business_id, appointment_id, file_name, content_type, size_bytes, storage_path, status, created_at)
     values ('${centro}', '${a3}', 'transferencia.png', 'image/png', 100, 'prueba-informe/${a3}/listo.png', 'ready', '2029-06-05T15:00:00Z'),
            ('${centro}', '${a1}', 'transferencia.png', 'image/png', 100, 'prueba-informe/${a1}/pendiente.png', 'pending', '2029-06-03T15:00:00Z')`);

// Clínica Dental: 2 citas del panel en junio, sin nada más (las líneas en 0 no salen) y sin el campo guardado.
const d1 = client(dental);
appointment(dental, { client: d1, date: "2029-06-12", start: "11:00", status: "completed" });
appointment(dental, { client: d1, date: "2029-06-13", start: "11:00", status: "confirmed" });
sql(`update businesses set notification_settings = notification_settings - 'monthlyReport' where id = '${dental}'`);

/* ---------------------------------------------------------------- El mes -- */

console.log("El mes del informe");
const june = previousMonthOf("2029-07-01");
ok(june.key === "2029-06" && june.from === "2029-06-01" && june.to === "2029-07-01" && june.previousFrom === "2029-05-01", "el 1 de julio, el de junio", june);
const january = previousMonthOf("2030-01-03");
ok(january.key === "2029-12" && january.previousFrom === "2029-11-01", "en enero, el de diciembre del año anterior", january);

/* ------------------------------------------------------------- Cuándo sale -- */

console.log("Cuándo sale");
ok((await run("2029-07-01", "07:59")) === 0 && reportsOf(centro) === 0, "el día 1 a las 7:59, nada");
await run("2029-07-01", "08:00");
ok(reportsOf(centro) === 1 && reportsOf(dental) === 1, "a las 8:00 sale el de cada negocio con citas en junio", [reportsOf(centro), reportsOf(dental)]);
ok(reportsOf(fisio) === 0, "un negocio sin citas en el mes no recibe informe");
ok((await run("2029-07-01", "08:10")) === 0 && (await run("2029-07-03", "09:00")) === 0, "una sola vez por mes: las pasadas siguientes no lo repiten");
// Como si el día 1 no hubiera salido el de la Clínica Dental (p. ej. el cron no pasó).
sql(`delete from notifications where type = 'monthly_report' and business_id = '${dental}'`);
ok(
  (await run("2029-07-04", "09:00")) === 1 && reportsOf(dental) === 1 && reportsOf(centro) === 1,
  "si no salió el día 1, sale en la primera pasada siguiente de esa semana (aquí, el día 4)",
);

/* ------------------------------------------------------------- Lo que dice -- */

console.log("El email");
const email = lastReport(centro)!;
ok(email.to === "jhordan@demo.com" && email.dedupeKey === `monthly-report:${centro}:2029-06`, "al propietario, con la clave del negocio y el mes", [email.to, email.dedupeKey]);
ok(email.subject === "Tu mes de junio en Agenda360", "el asunto con el mes", email.subject);
const lines = [
  "Citas gestionadas: 5",
  "Reservas por tu página: 2",
  "Recordatorios enviados: 3",
  "Pacientes que confirmaron que van: 2",
  "Cancelaciones con tiempo (la hora quedó libre): 1",
  "Pacientes nuevos: 3",
  "Comprobantes de pago recibidos: 1",
];
ok(lines.every((line) => email.body.includes(line)), "cada cifra, contada a mano", lines.filter((line) => !email.body.includes(line)));
ok(/Ingresos estimados \(citas completadas\): \$?\s?60/.test(email.body), "los ingresos: 30 + 20 + 10 de las completadas", email.body.match(/Ingresos[^\n]*/)?.[0]);
ok(email.body.includes("Tuviste 25 % más citas que en mayo."), "la comparación con mayo (5 frente a 4)", email.body.match(/Tuviste[^\n]*/)?.[0]);
ok(email.body.includes("/dashboard/reports") && email.html.includes("Ver mis reportes"), "el botón a Reportes");
const referral = sql(`select coalesce(referral_code, '') from businesses where id = '${centro}'`);
ok(!referral || email.body.includes(`/?ref=${referral}`), "su enlace de referidos, si lo tiene", referral);
ok(email.body.includes("Configuración → Notificaciones"), "la nota para apagarlo");
ok(
  !/Paciente Informe|informe\.\d+@|\+593 98 555|plan|Pro\b|Business|\$14|LOPDP/i.test(email.body + email.html),
  "ningún dato de pacientes, ni planes ni precios de Agenda360, ni la LOPDP",
);
const dentalEmail = lastReport(dental)!;
ok(
  dentalEmail.body.includes("Citas gestionadas: 2") &&
    !/Reservas por tu página|Recordatorios enviados|Pacientes que confirmaron|Cancelaciones con tiempo|Comprobantes|Ingresos|Tuviste/.test(dentalEmail.body),
  "las cifras en 0 no salen, ni la comparación sin citas el mes anterior",
  dentalEmail.body.slice(0, 600),
);

/* -------------------------------------------------- Lo que no recibe informe -- */

console.log("Lo que no recibe informe");
const again = async (business: string, date = "2029-07-02", time = "09:00") => {
  sql(`delete from notifications where type = 'monthly_report' and business_id = '${business}'`);
  await run(date, time);
  return reportsOf(business);
};
ok((await again(centro, "2029-07-08", "08:00")) === 0, "desde el día 8, ya no sale ese mes");
// El botón «Enviar el informe mensual ahora» de Actions (2026-11-10): otro día del mes, el del mes anterior.
const manual = async (date: string, time: string) => (await queueMonthlyReports(at(date, time), true)).queued;
ok(
  (await manual("2029-07-10", "07:59")) === 0 && reportsOf(centro) === 0,
  "a mano, el día 10 antes de las 8:00, nada",
);
ok(
  (await manual("2029-07-10", "18:00")) >= 1 && reportsOf(centro) === 1 && lastReport(centro)?.dedupeKey === `monthly-report:${centro}:2029-06`,
  "a mano, el día 10 desde las 8:00 sale el de junio",
  lastReport(centro),
);
ok((await manual("2029-07-12", "09:00")) === 0 && reportsOf(centro) === 1, "y apretarlo otra vez no lo repite");
ok((await run("2029-07-12", "09:00")) === 0, "las pasadas programadas siguen sin enviarlo desde el día 8");
sql(`update businesses set notification_settings = jsonb_set(notification_settings, '{monthlyReport}', 'false') where id = '${dental}'`);
ok((await again(dental)) === 0, "con el informe apagado, nada");
sql(`update businesses set notification_settings = notification_settings - 'monthlyReport', status = 'suspended' where id = '${dental}'`);
ok((await again(dental)) === 0, "un negocio suspendido, nada");
const owner = sql(`select owner_id from businesses where id = '${dental}'`);
sql(`update businesses set status = 'active', owner_id = null where id = '${dental}'`);
ok((await again(dental)) === 0, "un negocio sin propietario, nada");
sql(`update businesses set owner_id = '${owner}' where id = '${dental}'`);
ok((await again(dental)) === 1, "y con todo en orden, vuelve a salir");

/* ------------------------------------------------------------------ Limpieza -- */

sql(`delete from notifications where type in ('monthly_report', 'appointment_reminder') and business_id in ('${centro}', '${dental}')
       and (type = 'monthly_report' or to_email = 'recordatorio@correo.ec')`);
sql(`delete from payment_receipts where storage_path like 'prueba-informe/%'`);
sql(`update appointments set status = 'cancelled' where date >= '2029-01-01' and business_id in ('${centro}', '${dental}')`);

done("del informe mensual");
process.exit();
