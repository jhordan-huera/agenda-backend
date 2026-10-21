// Inicio del super admin con datos importantes (spec 006): el crecimiento del mes (lo que va del mes
// frente a los mismos días del mes pasado), la salud del sistema (emails de hoy, cron, copia de
// seguridad, intentos fallidos) y el crecimiento de cada negocio. Sólo el super admin, sin datos de pacientes.
// Spec 015: «En Pro desde el…», «Cerca del límite» contado como el tope del plan y el reparto por plan
// sólo con los activos. Spec 029: los comprobantes de mensualidades por revisar y los cobros atrasados.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cedulaFor } from "./helpers/cedula.mjs";
import type { AdminBusinessSummary, PlanId, PlatformStats } from "../src/shared/types/index.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
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

const admin = agent();
await admin("POST", "/auth/login", { email: "admin@demo.com", password: "demo1234", remember: true });
const owner = agent();
const ownerSession = (await owner("POST", "/auth/login", { email: "ricardo@demo.com", password: "demo1234", remember: true })).body;
const clinicId: string = ownerSession.businessId;
const stats = async () => (await admin("GET", "/admin/stats")).body as PlatformStats;
const clinicGrowth = async () =>
  ((await admin("GET", "/admin/businesses")).body as AdminBusinessSummary[]).find((b) => b.business.id === clinicId)!.growth;

// Los periodos, como los calcula el servidor (en Ecuador): un instante dentro de cada uno y, si el mes
// pasado tiene días fuera del periodo comparable, uno de esos.
const PERIODS = `with p as (
  select m.month_start, m.prev_start, least(m.prev_start + (now() - m.month_start), m.month_start) as prev_end
    from (select date_trunc('month', now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil' as month_start,
                 (date_trunc('month', now() at time zone 'America/Guayaquil') - interval '1 month') at time zone 'America/Guayaquil' as prev_start) m)`;
const instant = (which: "current" | "previous" | "outside") =>
  sql(`${PERIODS} select ${
    which === "current"
      ? "p.month_start + (now() - p.month_start) / 2"
      : which === "previous"
        ? "p.prev_start + (p.prev_end - p.prev_start) / 2"
        : "case when p.prev_end + interval '1 minute' < p.month_start then p.prev_end + interval '1 minute' end"
  } from p`);

console.log("Sólo el super admin");
let r = await owner("GET", "/admin/stats");
ok(r.status === 403, "un propietario no ve las estadísticas de la plataforma", r.status);

console.log("Crecimiento del mes");
const before = await stats();
const growthBefore = await clinicGrowth();
ok(before.growth && /^\d{4}-\d{2}-01$/.test(before.growth.from) && /^\d{4}-\d{2}-01$/.test(before.growth.previousFrom), "trae los dos periodos", before.growth);
const professional = sql(`select id from professionals where business_id = '${clinicId}' order by created_at limit 1`);
const service = sql(`select id from services where business_id = '${clinicId}' order by created_at limit 1`);
const client = sql(`select id from clients where business_id = '${clinicId}' order by created_at limit 1`);
let minute = 0;
/** Una cita creada en ese instante (para un día lejano: no choca con la agenda). */
const appointment = (createdAt: string, status = "confirmed", source = "dashboard") => {
  minute += 30;
  const start = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  sql(`insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source, created_at)
       values ('${clinicId}', '${client}', '${service}', '${professional}', '2032-02-02', '${start}', '${start}'::time + interval '15 minutes',
               '${status}', 0, '${source}', '${createdAt}')`);
};
const current = instant("current");
const previous = instant("previous");
const outside = instant("outside");
appointment(current);
appointment(current, "confirmed", "booking_page");
appointment(current, "cancelled");
appointment(previous);
appointment(previous, "pending", "booking_page");
if (outside) appointment(outside);
let seed = 0;
const newClient = (createdAt: string) =>
  sql(`insert into clients (business_id, name, document_id, email, phone, created_at)
       values ('${clinicId}', 'Crecimiento ${++seed}', '${cedulaFor(`crecimiento-${seed}`)}', '', '', '${createdAt}')`);
newClient(current);
newClient(current);
newClient(previous);
// Negocios: todos antiguos menos uno de este mes y uno del periodo anterior.
sql(`update businesses set created_at = '2020-01-01'`);
sql(`update businesses set created_at = '${current}' where id = '${clinicId}'`);
sql(`update businesses set created_at = '${previous}' where id = (select id from businesses where id <> '${clinicId}' order by name limit 1)`);
const after = await stats();
const delta = (name: keyof PlatformStats["growth"] & ("appointments" | "onlineBookings" | "newClients")) => ({
  current: after.growth[name].current - before.growth[name].current,
  previous: after.growth[name].previous - before.growth[name].previous,
});
ok(
  delta("appointments").current === 2 && delta("appointments").previous === 2,
  "citas agendadas: cuentan por cuándo se crearon, sin las canceladas ni las fuera del periodo comparable",
  delta("appointments"),
);
ok(delta("onlineBookings").current === 1 && delta("onlineBookings").previous === 1, "reservas online", delta("onlineBookings"));
ok(delta("newClients").current === 2 && delta("newClients").previous === 1, "pacientes nuevos", delta("newClients"));
ok(after.growth.newBusinesses.current === 1 && after.growth.newBusinesses.previous === 1, "negocios nuevos", after.growth.newBusinesses);
const growthAfter = await clinicGrowth();
ok(
  growthAfter.current - growthBefore.current === 2 && growthAfter.previous - growthBefore.previous === 2,
  "el crecimiento de cada negocio, con las mismas reglas",
  { growthBefore, growthAfter },
);

console.log("Día a día (gráficos)");
const sum = (key: "appointments" | "onlineBookings" | "newClients") =>
  after.growth.daily.reduce((total, day) => total + (day.current?.[key] ?? 0), 0);
ok(
  sum("appointments") === after.growth.appointments.current && sum("onlineBookings") === after.growth.onlineBookings.current &&
    sum("newClients") === after.growth.newClients.current,
  "la suma día a día de este mes da las cifras del mes",
  { daily: sum("appointments"), month: after.growth.appointments.current },
);
const today = Number(after.growth.to.slice(8));
ok(
  after.growth.daily[0].day === 1 && after.growth.daily.length >= today && after.growth.daily.slice(today).every((day) => day.current === null),
  "del día 1 en adelante; después de hoy, sin datos de este mes",
  after.growth.daily.length,
);

console.log("Salud del sistema");
const emailsBefore = before.health.emailsToday;
const email = (status: string, lastError: string | null, sentAt = "null") =>
  sql(`insert into notifications (business_id, type, to_email, subject, body, status, last_error, sent_at, attempts, next_attempt_at)
       values ('${clinicId}', 'appointment_confirmed', 'salud@example.com', 'Prueba', '', '${status}', ${lastError === null ? "null" : `'${lastError}'`},
               ${sentAt}, 1, now() + interval '1 day')`);
email("sent", null, "now()");
email("failed", "550 buzón inexistente");
email("failed", "Recordatorio descartado: la cita se canceló o cambió de fecha u hora.");
email("failed", "Dirección de demostración: no se envía.");
email("queued", null);
sql("delete from cron_runs");
sql("delete from backup_runs");
let health = (await stats()).health;
ok(
  health.emailsToday.sent - emailsBefore.sent === 1 &&
    health.emailsToday.failed - emailsBefore.failed === 1 &&
    health.emailsToday.queued - emailsBefore.queued === 1,
  "emails de hoy: enviados, fallidos (sin los descartados a propósito) y en cola",
  { emailsBefore, now: health.emailsToday },
);
ok(health.cron.lastRunAt === null && health.backup === null, "sin pasadas del cron ni copias registradas: null", health);
ok(
  health.database !== null && health.database.sizeBytes > 0 && health.database.limitBytes === 500 * 1024 * 1024,
  "la base de datos: lo que ocupa frente al tope de 500 MB del plan gratuito de Supabase",
  health.database,
);
ok(
  health.emailsByDay.length === 14 && health.emailsByDay.at(-1)?.date === after.growth.to &&
    health.emailsByDay.at(-1)?.sent === health.emailsToday.sent && health.emailsByDay.at(-1)?.failed === health.emailsToday.failed,
  "los emails de 14 días, con hoy al final igual a «Emails de hoy»",
  health.emailsByDay.at(-1),
);
sql(`insert into cron_runs (ran_at, report) values (now() - interval '3 hours', '{"reminderFailures": 1, "emails": {"failed": 2}}')`);
health = (await stats()).health;
const cronAge = (Date.now() - Date.parse(health.cron.lastRunAt ?? "")) / 3_600_000;
ok(cronAge > 2.9 && cronAge < 3.1 && health.cron.failures === 3, "la última pasada del cron y sus errores", health.cron);
sql(`insert into backup_runs (ran_at, ok, size_bytes, error) values (now() - interval '10 days', true, 2048, '')`);
sql(`insert into backup_runs (ok, size_bytes, error) values (false, null, 'pg_dump falló')`);
health = (await stats()).health;
ok(health.backup?.ok === false && health.backup.error === "pg_dump falló" && health.backup.sizeBytes === null, "la última copia (aquí, una fallida)", health.backup);
const loginsBefore = health.security;
const failedLogin = (name: string, ago: string) =>
  sql(`insert into audit_logs (actor_name, action, entity_type, summary, created_at)
       values ('${name}', 'session.login_failed', 'session', 'Intento de inicio de sesión fallido', now() - interval '${ago}')`);
for (let i = 0; i < 12; i++) failedLogin("atacante@example.com", "10 minutes");
failedLogin("olvido@example.com", "5 hours");
failedLogin("viejo@example.com", "2 days");
health = (await stats()).health;
ok(
  health.security.failedLogins24h - loginsBefore.failedLogins24h === 13 && health.security.accountsOnAlert - loginsBefore.accountsOnAlert === 1,
  "intentos fallidos en 24 h y cuentas en alerta (10 o más en la última hora)",
  { loginsBefore, now: health.security },
);

console.log("Datos correctos para el super admin (spec 015)");
{
  // «En Pro desde el…»: la migración 042 rellena plan_since con current_period_end - 30 días (la hora
  // del último cambio de plan) o, en Free, con el alta del negocio. Se prueba su UPDATE tal cual.
  const migration = readFileSync(new URL("../db/migrations/042_plan_since.sql", import.meta.url), "utf8");
  const backfill = migration.slice(migration.indexOf("update subscriptions"), migration.indexOf(";", migration.indexOf("update subscriptions")) + 1);
  sql(backfill);
  ok(
    sql(
      `select count(*) from subscriptions s join businesses b on b.id = s.business_id
        where s.plan_since is distinct from coalesce(s.current_period_end - interval '30 days', b.created_at)`,
    ) === "0" && Number(sql("select count(*) from subscriptions")) > 3,
    "la migración: el último cambio de plan (current_period_end - 30 días) o, en Free, el alta del negocio",
  );
  const bellaId = sql("select id from businesses where slug = 'estudio-bella'");
  const detail = async () => (await admin("GET", `/admin/businesses/${bellaId}`)).body as AdminBusinessSummary;
  const before = (await detail()).subscription!;
  r = await admin("PUT", `/admin/businesses/${bellaId}/plan`, { plan: "pro" });
  const changed = (await detail()).subscription!;
  const sinceAgo = (Date.now() - Date.parse(changed.planSince)) / 1000;
  ok(r.status === 200 && changed.plan === "pro" && sinceAgo >= 0 && sinceAgo < 60 && changed.planSince !== before.planSince, "al cambiar de plan, «desde» es ahora", [before, changed]);
  r = await admin("PUT", `/admin/businesses/${bellaId}/plan`, { plan: "pro" });
  ok(r.status === 200 && (await detail()).subscription!.planSince === changed.planSince, "elegir el mismo plan no cambia la fecha", r.body);
  r = await admin("PUT", `/admin/businesses/${bellaId}/plan`, { plan: "free" });
  ok(r.status === 200, "(vuelve a Free)", r.body);

  // «Cerca del límite»: los pacientes, como el tope del plan (plan-limits.ts).
  const usageOf = async () => ({
    admin: ((await admin("GET", "/admin/businesses")).body as AdminBusinessSummary[]).find((b) => b.business.id === clinicId)!.usage.clients,
    plan: (await owner("GET", `/businesses/${clinicId}/subscription/usage`)).body.clients as number,
  });
  const start = await usageOf();
  const fake = sql(
    `insert into clients (business_id, name, email, source) values ('${clinicId}', 'Reserva Falsa Cupo', 'falsa.cupo@correo.ec', 'booking_page') returning id`,
  ).split("\n")[0];
  const [serviceId, professionalId] = sql(
    `select s.id || ',' || p.id from services s, professionals p where s.business_id = '${clinicId}' and p.business_id = '${clinicId}' limit 1`,
  ).split(",");
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${clinicId}', '${fake}', '${serviceId}', '${professionalId}', current_date + 300, '06:00', '06:30', 'cancelled', 0, 'booking_page')`,
  );
  const withFake = await usageOf();
  ok(
    start.admin === start.plan && withFake.admin === start.admin && withFake.plan === start.plan,
    "un paciente de una reserva falsa (sin citas activas) no cuenta: el super admin ve lo mismo que el tope del plan",
    { start, withFake },
  );
  sql(`insert into clients (business_id, name, source) values ('${clinicId}', 'Paciente del Panel Cupo', 'dashboard')`);
  const withReal = await usageOf();
  ok(withReal.admin === start.admin + 1 && withReal.plan === start.plan + 1, "uno del panel sí cuenta, en los dos", withReal);

  // El reparto por plan, sólo con los activos (como «N negocios activos»).
  const sumByPlan = (stats: PlatformStats) => Object.values(stats.businessesByPlan).reduce((a, b) => a + b, 0);
  let overview = await stats();
  ok(overview.businesses.suspended >= 1 && sumByPlan(overview) === overview.businesses.active, "el reparto por plan suma los activos, sin los suspendidos", overview.businesses);
  const clinicPlan = sql(`select plan from subscriptions where business_id = '${clinicId}'`) as PlanId;
  const inPlan = overview.businessesByPlan[clinicPlan];
  r = await admin("PATCH", `/admin/businesses/${clinicId}/status`, { status: "suspended" });
  overview = await stats();
  ok(r.status === 200 && overview.businessesByPlan[clinicPlan] === inPlan - 1 && sumByPlan(overview) === overview.businesses.active, "al suspender un negocio, sale de su plan en el reparto", overview.businessesByPlan);
  r = await admin("PATCH", `/admin/businesses/${clinicId}/status`, { status: "active" });
  ok(r.status === 200 && (await stats()).businessesByPlan[clinicPlan] === inPlan, "y vuelve al reactivarlo", r.body);
}

console.log("Las mensualidades (spec 029)");
{
  let overview = await stats();
  ok(overview.billing?.inReview === 0 && overview.billing.overdue === 0, "sin cobros, 0 comprobantes por revisar y 0 atrasados", overview.billing);
  // Un cobro en revisión, uno atrasado (su día de pago fue hace 5 días, en la zona del negocio: es el sexto)
  // y uno todavía «Por pagar» (hace 4 días: es el quinto). Los 5 días son sólo del super admin: el
  // propietario no tiene gracia.
  const insert = (status: string, daysAgo: number) =>
    sql(`insert into billing_charges (business_id, due_date, base_amount, amount, status)
         values ('${clinicId}', (now() at time zone 'America/Guayaquil')::date - ${daysAgo}, 9.99, 9.99, '${status}')`);
  insert("in_review", 40);
  insert("due", 5);
  insert("due", 4);
  overview = await stats();
  ok(overview.billing?.inReview === 1 && overview.billing.overdue === 1, "cuenta 1 comprobante por revisar y 1 atrasado (no el que sigue «Por pagar»)", overview.billing);
  sql(`delete from billing_charges where business_id = '${clinicId}'`);
}

console.log("Privacidad");
const raw = JSON.stringify(await stats());
ok(!raw.includes("@"), "la respuesta no trae ningún email ni cuenta", raw.slice(0, 300));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del inicio del super admin pasaron");
process.exitCode = failures ? 1 : 0;
