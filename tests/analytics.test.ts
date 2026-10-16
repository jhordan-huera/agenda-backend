// Analítica del super admin (spec 016): la foto diaria con negocios de cifras conocidas (contadas a mano
// abajo, negocio por negocio), los tipos con sus medianas y su demanda, la salud (cada regla de R4), los
// criterios de venta (R5), las funciones y su adopción (R6), el valor generado con el antes y el después
// (R7), el cron (una foto al día, borra las de más de 30 días), GET /api/admin/analytics y la privacidad:
// la foto entera no tiene datos de pacientes.
import { spawn } from "node:child_process";
import { businessInput, createBusinessWithOwner } from "./helpers/business.mjs";
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, fakeNtfy, login, runCron, sql } from "./helpers/harness.ts";
import type { AdminBusinessDetail, AnalyticsSnapshot, BusinessAnalytics, CategoryAnalytics } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const analytics = await import("../src/services/analytics-service.ts");
const { pool } = await import("../src/db/pool.ts");
const { addDaysISO, getZonedNow, minutesToTime } = await import("../src/shared/lib/time.ts");
const { buildCategories, buildSnapshot, cleanupSnapshots, compareWithType, healthGroupOf, median, refreshAnalytics, scoreHealth, upsellReasons } =
  analytics;

const ZONE = "America/Guayaquil";
const NOW = new Date();
/** Hoy en Ecuador: los negocios de prueba están en esa zona. El periodo de 30 días es [T − 30, T). */
const T = getZonedNow(ZONE, NOW).date;
const day = (offset: number) => addDaysISO(T, offset);
/** Un instante en la hora de Ecuador (UTC−5, sin horario de verano). */
const at = (date: string, time: string) => `${date} ${time}:00-05`;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const admin = await login("admin@demo.com");
const owner = await login("ricardo@demo.com");

/* ------------------------------------------------------------ Los datos ---- */

// Los tipos de prueba son categorías del seed sin negocios demo (las categorías no se borran entre
// suites: no se crea ninguna). Tipo A: Fonoaudiología; B: Entrenamiento; C: Educación.
const TYPE_A = "speech_therapy";
const TYPE_B = "training";
const TYPE_C = "education";
if (count(`select count(*) from businesses where category in ('${TYPE_A}', '${TYPE_B}', '${TYPE_C}')`) > 0) {
  throw new Error("Los datos demo ya usan las categorías de la prueba: elige otras.");
}

interface Biz {
  key: string;
  id: string;
  ownerId: string;
  professional: string;
  service: string;
  clients: string[];
}
type Status = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
interface Row {
  offset: number;
  status: Status;
  client: string;
  online?: boolean;
  price?: number;
  paid?: boolean;
  confirmedAt?: string;
  reminderAt?: string;
  extra?: string;
  /** La cancelación en la actividad: quién y cuántas horas antes de la cita. */
  cancelled?: { byPatient: boolean; hoursBefore: number };
  // Se completan al insertar.
  date?: string;
  start?: string;
  id?: string;
}

const businesses: Record<string, Biz> = {};
const rowsOf: Record<string, Row[]> = {};
let patientSeq = 0;

/** Un paciente ficticio con nombre, email, teléfono y cédula únicos (para buscarlos después en la foto). */
function patient(biz: Biz, fields: { createdAt?: string; source?: string } = {}): string {
  patientSeq++;
  const name = `Paciente Secreto ${biz.key}${patientSeq}`;
  const id = sql(
    `insert into clients (business_id, name, email, phone, document_id, source, created_at)
     values ('${biz.id}', '${name}', 'secreto${patientSeq}.${biz.key.toLowerCase()}@paciente.ec', '0987${String(patientSeq).padStart(6, "0")}',
             '${cedulaFor(`analitica-${patientSeq}`)}', '${fields.source ?? "dashboard"}', '${fields.createdAt ?? daysAgo(200)}')
     returning id`,
  ).split("\n")[0];
  biz.clients.push(id);
  return id;
}

async function createBiz(key: string, plan: string, category: string, ageDays: number, clients: number): Promise<Biz> {
  const slug = `analitica-${key.toLowerCase()}`;
  const r = await createBusinessWithOwner(
    admin,
    { name: `Analítica ${key}`, slug, category, plan, services: [{ name: "Consulta", durationMinutes: 30, price: 25 }] },
    { firstName: "Dueño", lastName: `Negocio ${key}`, email: `dueno.${key.toLowerCase()}@negocio.ec`, password: "ClaveSegura1" },
  );
  if (r.status !== 200) throw new Error(`No se pudo crear ${key}: ${JSON.stringify(r.body)}`);
  const id: string = r.body.business.id;
  sql(`update businesses set created_at = '${daysAgo(ageDays)}' where id = '${id}'`);
  sql(`update users set phone = '+593 99 700 00${String(Object.keys(businesses).length).padStart(2, "0")}' where email = 'dueno.${key.toLowerCase()}@negocio.ec'`);
  const biz: Biz = {
    key,
    id,
    ownerId: sql(`select owner_id from businesses where id = '${id}'`),
    professional: sql(`select id from professionals where business_id = '${id}' order by created_at limit 1`),
    service: sql(`select id from services where business_id = '${id}' order by created_at limit 1`),
    clients: [],
  };
  businesses[key] = biz;
  rowsOf[key] = [];
  for (let i = 0; i < clients; i++) patient(biz);
  return biz;
}

/** Las citas, cada día con sus horas de 30 en 30 desde las 07:00 (así no chocan en la agenda). */
function insertAppointments(biz: Biz, rows: Row[]) {
  const slots = new Map<string, number>(rowsOf[biz.key].map((row) => [row.date!, 0]));
  for (const row of rowsOf[biz.key]) slots.set(row.date!, (slots.get(row.date!) ?? 0) + 1);
  const values = rows.map((row, index) => {
    row.date = day(row.offset);
    const slot = slots.get(row.date) ?? 0;
    slots.set(row.date, slot + 1);
    row.start = minutesToTime(7 * 60 + slot * 30);
    const tag = `analitica:${biz.key}:${rowsOf[biz.key].length + index}`;
    return `('${biz.id}', '${row.client}', '${biz.service}', '${biz.professional}', '${row.date}', '${row.start}', '${minutesToTime(7 * 60 + slot * 30 + 25)}',
             '${row.status}', ${row.price ?? 25}, '${row.online ? "booking_page" : "dashboard"}', ${row.paid ? `'${at(row.date, "21:00")}'` : "null"},
             ${row.confirmedAt ? `'${row.confirmedAt}'` : "null"}, '${tag}')`;
  });
  const ids = sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source, paid_at, client_confirmed_at, notes)
     values ${values.join(",\n")} returning notes || '|' || id`,
  ).split("\n");
  const byTag = new Map(ids.map((line) => line.split("|") as [string, string]));
  rows.forEach((row, index) => (row.id = byTag.get(`analitica:${biz.key}:${rowsOf[biz.key].length + index}`)));
  for (const row of rows) {
    if (row.reminderAt) {
      sql(`insert into notifications (business_id, type, to_email, subject, body, appointment_id, status, sent_at, created_at)
           values ('${biz.id}', 'appointment_reminder', 'recordatorio@paciente.ec', 'Recordatorio', '', '${row.id}', 'sent', '${row.reminderAt}', '${row.reminderAt}')`);
    }
    if (row.extra) sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${row.id}', '${row.extra}', '${biz.id}')`);
    if (row.cancelled) {
      const startsAt = new Date(at(row.date!, row.start!).replace(" ", "T").replace(/-05$/, "-05:00"));
      const when = new Date(startsAt.getTime() - row.cancelled.hoursBefore * 3_600_000).toISOString();
      sql(`insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
           values ('${biz.id}', ${row.cancelled.byPatient ? "null" : `'${biz.ownerId}'`}, 'Prueba',
                   '${row.cancelled.byPatient ? "appointment.client_cancelled" : "appointment.cancelled"}', 'appointment', '${row.id}', 'Canceló', '${when}')`);
    }
  }
  rowsOf[biz.key].push(...rows);
}

/** `n` citas iguales en el periodo (de ayer hacia atrás) o en el anterior (`from` = −31), con esos pacientes. */
const many = (n: number, fields: Omit<Row, "offset" | "client">, biz: Biz, from = -1, clients = biz.clients) =>
  Array.from({ length: n }, (_, i): Row => ({ ...fields, offset: from - (i % 29), client: clients[i % clients.length] }));

const signIn = (biz: Biz, days: number, userId = biz.ownerId) =>
  sql(`insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
       values ('${biz.id}', '${userId}', 'Prueba', 'session.login', 'session', '${userId}', 'Inició sesión', '${daysAgo(days)}')`);

console.log("Preparando los negocios de prueba");
// A (Pro, tipo A): el grande. 40 citas del periodo (24 atendidas: 20 a $25 y 4 gratis; 6 no asistió;
// 5 pendientes y 5 confirmadas, ya pasadas) y 5 canceladas; 12 por la página; 20 con recordatorio (8
// confirmadas por el paciente); 10 pagadas. El anterior: 24 atendidas y 8 no asistió.
const A = await createBiz("A", "pro", TYPE_A, 200, 10);
const newA = [1, 2, 3, 4].map(() => patient(A, { createdAt: daysAgo(10) }));
patient(A, { createdAt: daysAgo(5), source: "import" });
const onlineOnly = patient(A, { createdAt: daysAgo(8), source: "booking_page" });
const extraA = patient(A);
const firstReminder = at(day(-30), "09:00");
const reminder = (offset: number) => at(day(offset - 1), "10:00");
{
  const c = A.clients;
  const rows: Row[] = [];
  for (let i = 0; i < 24; i++) {
    const offset = -1 - i;
    rows.push({
      offset,
      status: "completed",
      client: c[i % 10],
      price: i < 4 ? 0 : 25,
      online: i >= 4 && i < 10,
      paid: i >= 4 && i < 12,
      reminderAt: i < 11 ? reminder(offset) : undefined,
      confirmedAt: i < 6 ? at(day(offset - 1), "12:00") : undefined,
      extra: i === 0 ? extraA : undefined,
    });
  }
  for (let i = 0; i < 6; i++) {
    const offset = -2 - i;
    rows.push({ offset, status: "no_show", client: c[i], online: i < 2, reminderAt: i < 4 ? reminder(offset) : undefined, confirmedAt: i < 2 ? at(day(offset - 1), "13:00") : undefined });
  }
  for (let i = 0; i < 10; i++) {
    const offset = -3 - i;
    rows.push({ offset, status: i < 5 ? "pending" : "confirmed", client: c[i], online: i < 4, paid: i < 2, reminderAt: i < 4 ? reminder(offset) : undefined });
  }
  // La primera con recordatorio: el 30.º día antes de hoy (el día en que empezó a usarlos).
  rows[rows.length - 1].reminderAt = firstReminder;
  rows[rows.length - 1].offset = -29;
  // Canceladas: 3 con tiempo (el negocio, 48 h antes), 1 por el paciente 2 h antes, 1 sin registro.
  rows.push({ offset: -4, status: "cancelled", client: c[0], paid: true, reminderAt: reminder(-4), cancelled: { byPatient: false, hoursBefore: 48 } });
  rows.push({ offset: -5, status: "cancelled", client: onlineOnly, online: true, cancelled: { byPatient: false, hoursBefore: 30 } });
  rows.push({ offset: -6, status: "cancelled", client: c[2], cancelled: { byPatient: false, hoursBefore: 24 } });
  rows.push({ offset: -7, status: "cancelled", client: c[3], cancelled: { byPatient: true, hoursBefore: 2 } });
  rows.push({ offset: -8, status: "cancelled", client: c[4] });
  // El periodo anterior.
  const ten = c.slice(0, 10);
  rows.push(...many(24, { status: "completed" }, A, -31, ten), ...many(8, { status: "no_show" }, A, -31, ten));
  rows.push(...many(2, { status: "cancelled" }, A, -31, ten));
  insertAppointments(A, rows);
}
// El equipo de A: 3 de 3 usuarios de Pro; el propietario entró hace 2 días y un miembro hace 5.
for (const name of ["Uno", "Dos"]) {
  const userId = sql(
    `insert into users (first_name, last_name, email, password_hash) values ('Miembro', '${name}', 'miembro.${name.toLowerCase()}@negocio.ec', 'x') returning id`,
  ).split("\n")[0];
  sql(`insert into business_users (business_id, user_id, role) values ('${A.id}', '${userId}', 'staff')`);
  if (name === "Uno") signIn(A, 5, userId);
}
signIn(A, 2);
// Las funciones de A: una serie, una importación, un aparato con avisos, un aviso leído y una evolución.
sql(`insert into appointment_series (business_id, frequency, requested_count, created_count, created_at) values ('${A.id}', 'weekly', 2, 2, '${daysAgo(10)}')`);
sql(`insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, summary, created_at)
     values ('${A.id}', '${A.ownerId}', 'Prueba', 'client.imported', 'client', 'Importó 1 paciente', '${daysAgo(5)}')`);
sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A.ownerId}', 'https://push.example/analitica-a', 'clave', 'secreto')`);
const notice = sql(
  `insert into panel_notices (business_id, kind, appointment_id, created_at) values ('${A.id}', 'booking', '${rowsOf.A[0].id}', '${daysAgo(3)}') returning id`,
).split("\n")[0];
sql(`insert into panel_notice_reads (user_id, notice_id, read_at) values ('${A.ownerId}', '${notice}', '${daysAgo(3)}')`);
sql(`insert into clinical_notes (business_id, client_id, date, author_name, template_version_id, data, created_at)
     select '${A.id}', '${A.clients[0]}', '${day(-7)}', 'Prueba', id, '{"reason": "Motivo secreto de la consulta"}', '${daysAgo(7)}'
       from clinical_template_versions where template_id = 'evolucion-general' and version = 1`);

// B, C y E (Pro, tipo A), con 20 citas cada uno en los dos periodos. Inasistencias: B 1 de 20, C 2 de 20, E 8 de 20.
const B = await createBiz("B", "pro", TYPE_A, 200, 5);
insertAppointments(B, [
  ...many(19, { status: "completed", price: 30 }, B),
  ...many(1, { status: "no_show", price: 30 }, B),
  ...many(20, { status: "completed" }, B, -31),
]);
signIn(B, 1);
const C = await createBiz("C", "pro", TYPE_A, 200, 5);
insertAppointments(C, [
  ...many(18, { status: "completed", price: 20, online: true }, C).map((row, i) => ({ ...row, online: i < 10 })),
  ...many(2, { status: "no_show", price: 20 }, C),
  ...many(20, { status: "completed" }, C, -31),
]);
signIn(C, 1);
const E = await createBiz("E", "pro", TYPE_A, 200, 5);
insertAppointments(E, [
  ...many(12, { status: "completed" }, E).map((row, i) => ({ ...row, online: i < 5 })),
  ...many(8, { status: "no_show" }, E),
  ...many(20, { status: "completed" }, E, -31),
]);
signIn(E, 1);
// F (Free, tipo A): 5 citas, «pocos datos». G (Free, tipo A): de hace 5 días, sin citas. H: suspendido.
const F = await createBiz("F", "free", TYPE_A, 200, 3);
insertAppointments(F, [...many(3, { status: "completed" }, F), ...many(2, { status: "no_show" }, F)]);
signIn(F, 3);
const G = await createBiz("G", "free", TYPE_A, 5, 0);
signIn(G, 1);
const H = await createBiz("H", "pro", TYPE_A, 200, 3);
insertAppointments(H, many(15, { status: "completed" }, H));
sql(`update businesses set status = 'suspended' where id = '${H.id}'`);

// Tipo B: R (en riesgo), K (crítico) y P (crece +30 %). Sólo R y P tienen datos: «pocos datos».
const R = await createBiz("R", "free", TYPE_B, 300, 5);
insertAppointments(R, [...many(1, { status: "completed" }, R), ...many(11, { status: "pending" }, R), ...many(20, { status: "completed" }, R, -31)]);
signIn(R, 10);
const K = await createBiz("K", "free", TYPE_B, 300, 5);
insertAppointments(K, many(20, { status: "completed" }, K, -31));
signIn(K, 20);
const P = await createBiz("P", "pro", TYPE_B, 300, 5);
insertAppointments(P, [...many(26, { status: "completed" }, P).map((row, i) => ({ ...row, online: i < 3 })), ...many(20, { status: "completed" }, P, -31)]);
signIn(P, 1);

// Tipo C: Q (Pro, 120 citas en 30 días con una agenda), S (Business con sus 2 agendas) y U (Free, cerca del tope).
const Q = await createBiz("Q", "pro", TYPE_C, 200, 10);
insertAppointments(Q, [
  ...Array.from({ length: 120 }, (_, i): Row => ({ offset: -1 - (i % 30), status: "completed", client: Q.clients[i % 10], online: i % 2 === 0 })),
  ...Array.from({ length: 120 }, (_, i): Row => ({ offset: -31 - (i % 30), status: "completed", client: Q.clients[i % 10] })),
]);
signIn(Q, 1);
const S = await createBiz("S", "business", TYPE_C, 200, 3);
sql(`update subscriptions set max_professionals = 2 where business_id = '${S.id}'`);
sql(`insert into professionals (business_id, display_name) values ('${S.id}', 'Segunda agenda')`);
insertAppointments(S, many(3, { status: "completed" }, S));
signIn(S, 1);
const U = await createBiz("U", "free", TYPE_C, 200, 45);
insertAppointments(U, Array.from({ length: 17 }, (_, i): Row => ({ offset: 0, status: "confirmed", client: U.clients[i] })));
signIn(U, 1);
// N: creado por el super admin, todavía sin propietario ni equipo.
const created = await admin("POST", "/admin/businesses", businessInput({ name: "Analítica N", slug: "analitica-n", category: TYPE_C }));
if (created.status !== 200) throw new Error(`No se pudo crear N: ${JSON.stringify(created.body)}`);
const N: string = created.body.business.id;
sql(`update businesses set created_at = '${daysAgo(200)}' where id = '${N}'`);

/* ------------------------------------------------------------ La foto ---- */

const snapshot = await buildSnapshot(30, NOW);
const snapshot90 = await buildSnapshot(90, NOW);
const of = (biz: Biz, from: AnalyticsSnapshot = snapshot): BusinessAnalytics => from.businesses.find((b) => b.id === biz.id)!;
const type = (id: string | null): CategoryAnalytics | undefined => snapshot.categories.find((c) => c.id === id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("La foto");
ok(snapshot.periodDays === 30 && snapshot.from === day(-30) && snapshot.to === T, "el periodo: los 30 días antes de hoy", [snapshot.from, snapshot.to]);
ok(snapshot.businesses.length === count("select count(*) from businesses"), "un negocio por cada negocio (activos y suspendidos)", snapshot.businesses.length);

console.log("Las cifras de A (contadas a mano)");
const a = of(A);
ok(a.appointments === 40 && a.previousAppointments === 32, "citas: 40 en el periodo y 32 en el anterior (sin las canceladas)", [a.appointments, a.previousAppointments]);
ok(a.growth === 0.25, "crecimiento: +25 %", a.growth);
ok(a.onlineRate === 0.3, "reservas online: 12 de 40 (30 %)", a.onlineRate);
ok(a.noShowRate === 0.2, "inasistencias: 6 de 30 cerradas (20 %)", a.noShowRate);
ok(a.cancelRate === 0.1111, "cancelaciones: 5 de 45 (11 %)", a.cancelRate);
ok(a.confirmRate === 0.4, "confirmadas por el paciente: 8 de las 20 que recibieron el recordatorio (la cancelada no cuenta)", a.confirmRate);
ok(a.activeClients === 11, "pacientes activos: los 10 de sus citas y el que va de segunda persona", a.activeClients);
ok(a.newClients === 4, "pacientes nuevos: 4 (sin el importado ni el de la página con sólo una cita cancelada)", a.newClients);
ok(a.estimatedRevenue === 500 && a.averageTicket === 25, "ingresos estimados $500 (20 atendidas a $25) y ticket $25 (sin las gratis)", [a.estimatedRevenue, a.averageTicket]);
ok(a.collected === 250, "cobrado: $250 (10 pagadas, sin la cancelada)", a.collected);
ok(
  same(a.planUsage.appointments, { used: a.planUsage.appointments.used, limit: null }) && a.planUsage.clients.limit === null && same(a.planUsage.users, { used: 3, limit: 3 }),
  "uso del plan: Pro sin tope de citas ni pacientes, 3 de 3 usuarios",
  a.planUsage,
);
const monthStart = `${T.slice(0, 7)}-01`;
ok(
  a.planUsage.appointments.used === rowsOf.A.filter((row) => row.status !== "cancelled" && row.date! >= monthStart).length,
  "citas del mes en curso: las de su lista de este mes",
  a.planUsage.appointments,
);
ok(same(a.agendas, { active: 1, contracted: null }) && a.teamMembers === 3, "1 agenda y 3 personas en el equipo", [a.agendas, a.teamMembers]);
ok(Math.abs(Date.parse(a.lastTeamLoginAt!) - Date.parse(daysAgo(2))) < 1000, "último acceso: el del propietario hace 2 días (no el del super admin)", a.lastTeamLoginAt);
ok(a.unclosed === 10 && !a.fewData, "10 citas sin cerrar y datos suficientes", [a.unclosed, a.fewData]);
ok(
  same(a.owner, { name: "Dueño Negocio A", phone: "+593 99 700 0000", email: "dueno.a@negocio.ec" }) && a.category.id === TYPE_A && a.category.name === "Fonoaudiología",
  "el propietario (nombre, teléfono y email) y su tipo",
  [a.owner, a.category],
);
ok(
  same(a.features, {
    bookingPage: true,
    reminders: true,
    patientConfirm: true,
    series: true,
    clientImport: true,
    push: true,
    bell: true,
    clinical: true,
    payments: true,
    multiAgenda: false,
  }),
  "funciones de A: todas menos varias agendas",
  a.features,
);
ok(
  same(a.value, { appointments: 45, online: 12, reminders: 21, confirmations: 8, timelyCancellations: 3, noShowBefore: 0.25, noShowAfter: 0.2, since: day(-30) }),
  "valor de A: 45 citas gestionadas, 12 online, 21 recordatorios, 8 confirmaciones, 3 cancelaciones con tiempo y las inasistencias 25 % → 20 %",
  a.value,
);
ok(same(a.health, { score: 100, group: "healthy", reasons: [] }), "salud de A: 100, sano", a.health);
ok(same(a.upsell, ["Equipo completo: 3 de 3 usuarios"]), "listo para subir de plan: el equipo completo de Pro", a.upsell);
const a90 = of(A, snapshot90);
ok(a90.appointments === 72 && a90.growth === "new" && a90.previousAppointments === 0, "en 90 días: 72 citas y «nuevo» (antes no tenía)", [a90.appointments, a90.growth]);

console.log("Los demás negocios");
const [b, c, e, f, g, h] = [B, C, E, F, G, H].map((biz) => of(biz));
ok(b.noShowRate === 0.05 && b.averageTicket === 30 && b.growth === 0 && b.onlineRate === 0, "B: 1 de 20 no asistió, ticket $30, crecimiento 0 y sin reservas online", b);
ok(c.noShowRate === 0.1 && c.onlineRate === 0.5 && c.averageTicket === 20, "C: 2 de 20 no asistió, 10 de 20 online y ticket $20", c);
ok(e.noShowRate === 0.4 && e.onlineRate === 0.25, "E: 8 de 20 no asistió y 5 de 20 online", e);
ok(f.fewData && f.noShowRate === 0.4 && f.appointments === 5, "F: 5 citas, «pocos datos» (su tasa se ve, con la marca)", f);
ok(g.growth === "new" && g.appointments === 0 && g.fewData, "G (de hace 5 días): «nuevo», con ceros", g);
ok(h.status === "suspended" && h.appointments === 15, "H: suspendido, en la foto con sus cifras", h);
const s = of(S);
ok(same(s.agendas, { active: 2, contracted: 2 }) && s.features.multiAgenda, "S (Business): 2 de 2 agendas contratadas, varias agendas", s.agendas);
const u = of(U);
ok(same(u.planUsage.appointments, { used: 17, limit: 20 }) && same(u.planUsage.clients, { used: 45, limit: 50 }), "U (Free): 17 de 20 citas del mes y 45 de 50 pacientes", u.planUsage);
const n = snapshot.businesses.find((biz) => biz.id === N)!;
ok(
  n.owner === null && n.teamMembers === 0 && n.lastTeamLoginAt === null && n.health.reasons[0] === "Sin equipo: nadie entra al panel",
  "N, sin propietario ni equipo: último acceso «nadie» (y resta en la salud)",
  n,
);

console.log("Por tipo de negocio");
const typeA = type(TYPE_A)!;
ok(typeA.businesses === 6 && typeA.withData === 4 && !typeA.fewData, "tipo A: 6 activos (sin el suspendido) y 4 con datos suficientes", typeA);
ok(
  same(typeA.medians, { onlineRate: 0.275, noShowRate: 0.15, cancelRate: 0, confirmRate: 0.4 }),
  "medianas: online 27,5 %, inasistencias 15 %, cancelaciones 0 % y confirmaciones 40 %",
  typeA.medians,
);
ok(typeA.averageTicket === 25 && typeA.appointmentsPerAgenda === 20, "ticket típico $25 y 20 citas por agenda", [typeA.averageTicket, typeA.appointmentsPerAgenda]);
// La demanda, contada a mano con las citas de la lista (sin canceladas ni el suspendido).
const demandDays = new Map<number, number>();
const demandHours = new Map<number, number>();
for (const key of ["A", "B", "C", "E", "F", "G"]) {
  for (const row of rowsOf[key]) {
    if (row.status === "cancelled" || row.offset < -30 || row.offset >= 0) continue;
    const dow = new Date(`${row.date}T12:00:00Z`).getUTCDay();
    const hour = Number(row.start!.slice(0, 2));
    demandDays.set(dow, (demandDays.get(dow) ?? 0) + 1);
    demandHours.set(hour, (demandHours.get(hour) ?? 0) + 1);
  }
}
const top = (counts: Map<number, number>) => [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 3);
ok(
  same(typeA.topDays.map((d) => [d.day, d.appointments]), top(demandDays)) && same(typeA.topHours.map((d) => [d.hour, d.appointments]), top(demandHours)),
  "los 3 días y las 3 horas de más demanda",
  { snapshot: [typeA.topDays, typeA.topHours], esperado: [top(demandDays), top(demandHours)] },
);
const typeB = type(TYPE_B)!;
ok(typeB.fewData && typeB.withData === 2 && typeB.medians.noShowRate === null, "tipo B: sólo 2 con datos, «pocos datos» y sin medianas", typeB);
ok(snapshot.categories.findIndex((cat) => cat.id === TYPE_A) < snapshot.categories.findIndex((cat) => cat.id === TYPE_B), "los tipos, en el orden de las categorías");
ok(e.versusType.noShowRate === "above" && b.versusType.noShowRate === "below" && a.versusType.noShowRate === "similar", "«muy distinto»: E por encima, B por debajo y A parecido", [e.versusType, b.versusType, a.versusType]);
ok(Object.values(f.versusType).every((v) => v === null), "con «pocos datos» no se compara", f.versusType);
ok(Object.values(of(R).versusType).every((v) => v === null), "ni contra un tipo con «pocos datos»", of(R).versusType);

console.log("El último acceso cuenta también el uso de una sesión abierta («Recordarme»)");
// R inició sesión hace 10 días, pero su propietario usó ayer una sesión que sigue abierta.
const sessionId = sql(
  `insert into sessions (user_id, token_hash, expires_at, remember, last_seen_at, created_at)
   values ('${R.ownerId}', md5(random()::text), now() + interval '10 days', true, '${daysAgo(1)}', '${daysAgo(12)}') returning id`,
).split("\n")[0];
const withSession = (await buildSnapshot(30, NOW)).businesses.find((business) => business.id === R.id)!;
ok(
  Math.abs(Date.parse(withSession.lastTeamLoginAt!) - Date.parse(daysAgo(1))) < 1000 &&
    !withSession.health.reasons.some((reason) => reason.startsWith("Nadie del equipo entra")),
  "con una sesión usada ayer, el último acceso es ayer y no resta por «nadie entra»",
  [withSession.lastTeamLoginAt, withSession.health.reasons],
);
sql(`delete from sessions where id = '${sessionId}'`);

console.log("La salud");
ok(same(e.health, { score: 95, group: "healthy", reasons: ["Inasistencias 40 %, su tipo 15 %"] }), "E: −5 por inasistencias muy por encima de su tipo", e.health);
ok(same(b.health, { score: 95, group: "healthy", reasons: ["Sin reservas online"] }), "B: −5 sin reservas online", b.health);
ok(same(g.health, { score: 100, group: "healthy", reasons: [] }), "G, de menos de 14 días: sin citas no resta (sólo el último acceso)", g.health);
ok(
  same(of(R).health, {
    score: 55,
    group: "risk",
    reasons: ["Nadie del equipo entra hace 10 días", "Citas −40 % frente al periodo anterior", "11 citas sin cerrar", "Sin reservas online"],
  }),
  "R: en riesgo (55), con sus motivos",
  of(R).health,
);
ok(
  same(of(K).health, {
    score: 10,
    group: "critical",
    reasons: ["Nadie del equipo entra hace 20 días", "Sin citas en los últimos 30 días", "Citas −100 % frente al periodo anterior", "Sin reservas online"],
  }),
  "K: crítico (10), con sus motivos",
  of(K).health,
);
ok(h.health.reasons.every((reason) => reason !== "Sin reservas online"), "un suspendido no resta por la página de reservas (no está activa)", h.health);

console.log("Cada regla de la salud (R4)");
const healthy = {
  periodDays: 30,
  ageDays: 200,
  status: "active" as const,
  teamMembers: 2,
  daysSinceLogin: 1,
  appointments: 30,
  previousAppointments: 30,
  growth: 0,
  unclosed: 0,
  online: 5,
  noShowRate: 0.1,
  noShowVersusType: "similar" as const,
  typeNoShowRate: 0.1,
};
const score = (changes: Partial<typeof healthy> | Record<string, unknown>) => scoreHealth({ ...healthy, ...changes } as Parameters<typeof scoreHealth>[0]);
ok(same(score({}), { score: 100, group: "healthy", reasons: [] }), "sin señales: 100");
ok(score({ daysSinceLogin: 15 }).score === 70 && score({ daysSinceLogin: 15 }).reasons[0] === "Nadie del equipo entra hace 15 días", "nadie entra hace más de 14 días: −30");
ok(score({ daysSinceLogin: 14 }).score === 85 && score({ daysSinceLogin: 7 }).score === 85 && score({ daysSinceLogin: 6 }).score === 100, "entre 7 y 14 días: −15; 6 días, nada");
ok(score({ daysSinceLogin: null }).reasons[0] === "Nadie del equipo entra hace más de 90 días" && score({ daysSinceLogin: null }).score === 70, "nadie en los 90 días de la auditoría: −30");
ok(score({ daysSinceLogin: null, teamMembers: 0 }).reasons[0] === "Sin equipo: nadie entra al panel", "sin equipo: «nadie entra»");
ok(score({ appointments: 0, growth: -1, previousAppointments: 5 }).score === 70, "sin citas en el periodo: −30 (con menos de 10 antes, la caída no resta)");
ok(score({ growth: -0.5, previousAppointments: 10 }).score === 75 && score({ growth: -0.5 }).reasons[0] === "Citas −50 % frente al periodo anterior", "−50 % o peor: −25");
ok(score({ growth: -0.2 }).score === 85 && score({ growth: -0.19 }).score === 100, "entre −20 % y −50 %: −15; −19 %, nada");
ok(score({ unclosed: 11 }).score === 90 && score({ unclosed: 11 }).reasons[0] === "11 citas sin cerrar" && score({ unclosed: 10 }).score === 100, "más de 10 sin cerrar: −10");
ok(score({ online: 0 }).score === 95 && score({ online: 0, status: "suspended" }).score === 100, "sin reservas online (con la página activa): −5");
ok(score({ noShowVersusType: "above", noShowRate: 0.3, typeNoShowRate: 0.1 }).reasons[0] === "Inasistencias 30 %, su tipo 10 %", "inasistencias muy por encima de su tipo: −5");
ok(score({ ageDays: 10, appointments: 0, online: 0, unclosed: 20 }).score === 100 && score({ ageDays: 10, daysSinceLogin: 20 }).score === 70, "menos de 14 días: sólo el último acceso");
ok(
  healthGroupOf(100) === "healthy" && healthGroupOf(70) === "healthy" && healthGroupOf(69) === "risk" && healthGroupOf(40) === "risk" && healthGroupOf(39) === "critical",
  "grupos: 70–100 sano, 40–69 en riesgo, menos de 40 crítico",
);
ok(score({ daysSinceLogin: 30, appointments: 0, growth: -1, previousAppointments: 40, unclosed: 20, online: 0 }).score === 0, "nunca baja de 0");

console.log("Listos para subir de plan (R5)");
ok(same(u.upsell, ["Usó 17 de 20 citas del mes", "Tiene 45 de 50 pacientes"]), "Free al 80 % de su tope (citas del mes y pacientes)", u.upsell);
ok(same(of(P).upsell, ["Citas +30 % frente al periodo anterior"]), "crece +30 % con 20 o más citas", of(P).upsell);
ok(same(of(Q).upsell, ["Mucha demanda para una agenda: 120 citas en 30 días"]), "Pro con 120 citas en 30 días y una agenda", of(Q).upsell);
ok(same(s.upsell, ["Usa sus 2 agendas contratadas"]), "Business con todas sus agendas en uso", s.upsell);
const plan = (fields: Record<string, unknown>) =>
  upsellReasons(
    {
      plan: "free",
      growth: 0,
      appointments: 10,
      agendas: { active: 1, contracted: null },
      planUsage: { appointments: { used: 0, limit: 20 }, clients: { used: 0, limit: 50 }, users: { used: 1, limit: 1 } },
      ...fields,
    } as Parameters<typeof upsellReasons>[0],
    30,
  );
ok(plan({ planUsage: { appointments: { used: 16, limit: 20 }, clients: { used: 39, limit: 50 }, users: { used: 1, limit: 1 } } }).length === 1, "16 de 20 sí (80 %); 39 de 50, no");
ok(plan({ growth: 0.29, appointments: 30 }).length === 0 && plan({ growth: 0.5, appointments: 19 }).length === 0, "+29 %, no; +50 % con 19 citas, tampoco");
ok(plan({ plan: "business", growth: 0.5, appointments: 30, agendas: { active: 2, contracted: 3 } }).length === 0, "Business no sube por crecer, ni con agendas libres");
const pro = (appointments: number) =>
  upsellReasons(
    {
      plan: "pro",
      growth: 0,
      appointments,
      agendas: { active: 1, contracted: null },
      planUsage: { appointments: { used: 0, limit: null }, clients: { used: 0, limit: null }, users: { used: 2, limit: 3 } },
    },
    90,
  );
ok(same(pro(360), ["Mucha demanda para una agenda: 360 citas en 90 días"]) && pro(359).length === 0, "Pro en 90 días: 360 citas equivalen a 120 cada 30; 359, no", [pro(360), pro(359)]);
ok(same(of(B).upsell, []) && same(of(C).upsell, []), "los demás, sin motivo", [of(B).upsell, of(C).upsell]);

console.log("Comparar con el tipo, medianas y «Sin tipo»");
ok(compareWithType(0.3, 0.15) === "above" && compareWithType(0.29, 0.15) === "similar", "el doble o más: por encima");
ok(compareWithType(0.1, 0.04) === "above" && compareWithType(0.08, 0.03) === "above" && compareWithType(0.06, 0.03) === "similar", "con 5 puntos de diferencia o más");
ok(compareWithType(0.04, 0.1) === "below" && compareWithType(0.05, 0.1) === "below" && compareWithType(0.06, 0.1) === "similar" && compareWithType(0.02, 0.05) === "similar", "la mitad o menos: por debajo");
ok(compareWithType(null, 0.1) === null && compareWithType(0.1, null) === null, "sin datos: no se compara");
ok(median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5 && median([]) === null, "la mediana");
const fake = (id: string, category: { id: string | null; name: string }): BusinessAnalytics => ({ ...a, id, category, status: "active" });
const noType = buildCategories([fake("x", { id: null, name: "Sin tipo" }), fake("y", { id: "uno", name: "Uno" })], []);
ok(noType.at(-1)?.id === null && noType.at(-1)?.name === "Sin tipo" && noType.at(-1)?.businesses === 1, "un negocio sin tipo va en «Sin tipo», al final", noType);

console.log("La plataforma: totales y adopción (R6, R7)");
const active = snapshot.businesses.filter((biz) => biz.status === "active");
const sumOf = (pick: (biz: BusinessAnalytics) => number) => snapshot.businesses.reduce((total, biz) => total + pick(biz), 0);
ok(
  snapshot.platform.appointments === sumOf((biz) => biz.value.appointments) &&
    snapshot.platform.appointments ===
      count(`select count(*) from appointments a join businesses b on b.id = a.business_id
              where a.date >= ('${NOW.toISOString()}'::timestamptz at time zone b.timezone)::date - 30
                and a.date < ('${NOW.toISOString()}'::timestamptz at time zone b.timezone)::date`),
  "citas gestionadas: todas las del periodo, de todos los negocios",
  snapshot.platform.appointments,
);
ok(
  snapshot.platform.online === sumOf((biz) => biz.value.online) &&
    snapshot.platform.reminders === sumOf((biz) => biz.value.reminders) &&
    snapshot.platform.confirmations === sumOf((biz) => biz.value.confirmations) &&
    snapshot.platform.newClients === sumOf((biz) => biz.newClients),
  "reservas online, recordatorios, confirmaciones y pacientes nuevos",
  snapshot.platform,
);
ok(same(snapshot.platform.businesses, { active: active.length, total: snapshot.businesses.length }), "negocios activos y en total");
const adoption = snapshot.platform.adoption;
ok(
  Object.entries(adoption).every(([key, value]) => value.businesses === active.filter((biz) => biz.features[key as keyof BusinessAnalytics["features"]]).length) &&
    adoption.push.businesses === count("select count(distinct b.id) from businesses b join push_subscriptions p on p.user_id = b.owner_id where b.status = 'active' and p.signed_out_at is null") &&
    adoption.multiAgenda.rate === Math.round((adoption.multiAgenda.businesses / active.length) * 10_000) / 10_000,
  "adopción: el % de negocios activos que usa cada función",
  adoption,
);
const withoutData = of(B);
ok(withoutData.value.noShowBefore === null && withoutData.value.since === null, "sin recordatorios ni confirmaciones, no hay antes y después", withoutData.value);

/* -------------------------------------------------------- Privacidad ---- */

console.log("Privacidad: la foto no tiene datos de pacientes");
const photos = JSON.stringify([snapshot, snapshot90]);
const patients = sql(`select name || '|' || email || '|' || phone || '|' || document_id from clients`).split("\n").map((line) => line.split("|"));
const leaks = patients.flatMap((fields) => fields.filter((value) => value.trim().length >= 4 && photos.includes(value)));
ok(patients.length > 100 && leaks.length === 0, `ni nombres, ni emails, ni teléfonos, ni cédulas de los ${patients.length} pacientes`, leaks.slice(0, 5));
ok(!photos.includes("Paciente Secreto") && !photos.includes("@paciente.ec") && !photos.includes("Motivo secreto"), "ni los pacientes de prueba ni su historia clínica");
const ownerEmails = new Set(sql("select u.email from businesses b join users u on u.id = b.owner_id").split("\n"));
const emails = [...photos.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((match) => match[0]);
ok(emails.length > 0 && emails.every((email) => ownerEmails.has(email)), "los únicos emails son los de los propietarios", emails.filter((email) => !ownerEmails.has(email)));

/* ---------------------------------------------- El cron y la página ---- */

console.log("El cron: una foto al día");
const photosToday = () => count(`select count(*) from analytics_snapshots where day = '${T}'`);
sql("delete from analytics_snapshots");
const atEcuador = (time: string) => new Date(`${T}T${time}:00-05:00`);
let refresh = await refreshAnalytics({ now: atEcuador("05:59") });
ok(refresh.status === "early" && photosToday() === 0, "antes de las 06:00 de Ecuador no la prepara", refresh);
refresh = await refreshAnalytics({ now: atEcuador("06:00") });
ok(refresh.status === "prepared" && refresh.businesses === snapshot.businesses.length && photosToday() === 2, "a las 06:00, la de 30 y la de 90 días", refresh);
const firstAt = sql(`select computed_at from analytics_snapshots where day = '${T}' and period_days = 30`);
refresh = await refreshAnalytics({ now: atEcuador("06:10") });
ok(refresh.status === "ready" && photosToday() === 2 && sql(`select computed_at from analytics_snapshots where day = '${T}' and period_days = 30`) === firstAt, "la siguiente pasada no la repite", refresh);
sql(`delete from analytics_snapshots where period_days = 90`);
refresh = await refreshAnalytics({ now: atEcuador("06:20") });
ok(refresh.status === "prepared" && photosToday() === 2 && sql(`select computed_at from analytics_snapshots where day = '${T}' and period_days = 30`) === firstAt, "si falta una, prepara sólo esa", refresh);
sql(`insert into analytics_snapshots (period_days, day, data) select period_days, '${day(-31)}', data from analytics_snapshots where day = '${T}'`);
sql(`insert into analytics_snapshots (period_days, day, data) select period_days, '${day(-30)}', data from analytics_snapshots where day = '${T}'`);
const purged = await cleanupSnapshots(NOW);
ok(purged === 2 && count(`select count(*) from analytics_snapshots where day = '${day(-30)}'`) === 2, "borra las de más de 30 días (y deja las de hace 30)", purged);

// El cron de GitHub de verdad (scripts/cron.ts): sin la foto de hoy, la prepara si ya pasaron las 06:00.
sql(`delete from analytics_snapshots where day = '${T}'`);
const ntfy = await fakeNtfy();
const cron = await runCron(ntfy.url);
const lastReport = JSON.parse(sql("select report->'analytics' from cron_runs order by ran_at desc limit 1") || "null");
const afterSix = getZonedNow(ZONE).minutes >= 6 * 60 && getZonedNow(ZONE).date === T;
ok(
  cron.code === 0 &&
    (afterSix
      ? /· analítica: preparada \(\d+ negocios\) · \d+ ms/.test(cron.output) && photosToday() === 2 && lastReport?.status === "prepared"
      : / · analítica: se prepara después de las 06:00 · \d+ ms/.test(cron.output) && lastReport?.status === "early"),
  `el registro del cron: «analítica: ${afterSix ? "preparada (N negocios)" : "se prepara después de las 06:00"}»`,
  [cron.output.slice(-300), lastReport],
);
ok(!/@/.test(cron.output) && !cron.output.includes("Paciente Secreto"), "el registro, sólo con cifras");
ntfy.close();

// npm run analytics:refresh (sin .env: el guion directo) y su bloqueo con la base de producción.
const script = (env: Record<string, string>) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["scripts/analytics-refresh.ts"], {
      env: {
        PATH: process.env.PATH!,
        HOME: process.env.HOME!,
        NODE_ENV: "test",
        DATABASE_SSL: "false",
        FRONTEND_URL: "https://agendo.example",
        LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR!,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
sql("delete from analytics_snapshots");
let run = await script({ DATABASE_URL: process.env.TEST_DATABASE_URL! });
ok(run.code === 0 && /✓ Analítica preparada: \d+ negocios, 30 y 90 días/.test(run.output) && photosToday() === 2, "npm run analytics:refresh prepara la foto de hoy", run.output);
run = await script({ DATABASE_URL: "postgresql://lectura@db.analitica.example.com:6543/postgres", DATABASE_SSL: "true" });
ok(run.code === 1 && /Es la base de producción/.test(run.output), "con la base de producción desde el equipo, no escribe nada", run.output);

console.log("GET /api/admin/analytics");
let r = await owner("GET", "/admin/analytics");
ok(r.status === 403, "un propietario recibe 403", r.status);
r = await admin("GET", "/admin/analytics?days=45");
ok(r.status === 400 && r.body.error.code === "validation", "days distinto de 30 o 90: 400", r.body);
sql("delete from analytics_snapshots");
r = await admin("GET", "/admin/analytics");
ok(r.status === 200 && same(r.body, { snapshot: null }), "sin foto: { snapshot: null }", r.body);
r = await admin("GET", `/admin/businesses/${A.id}`);
ok(r.status === 200 && (r.body as AdminBusinessDetail).analytics === null, "la ficha, sin foto: analytics null", r.body?.analytics);
await refreshAnalytics({ now: atEcuador("07:00") });
r = await admin("GET", "/admin/analytics?days=30");
const fromApi = r.body.snapshot as AnalyticsSnapshot;
ok(r.status === 200 && fromApi.periodDays === 30 && of(A, fromApi).appointments === 40, "la foto de 30 días", fromApi?.periodDays);
ok((await admin("GET", "/admin/analytics?days=90")).body.snapshot.periodDays === 90, "y la de 90");
ok((await admin("GET", "/admin/analytics")).body.snapshot.periodDays === 30, "sin days, la de 30");
insertAppointments(A, [{ offset: -1, status: "completed", client: A.clients[0] }]);
ok(of(A, (await admin("GET", "/admin/analytics")).body.snapshot).appointments === 40, "la página lee la foto: no recalcula (la cita nueva sale mañana)");
const detail = (await admin("GET", `/admin/businesses/${A.id}`)).body as AdminBusinessDetail;
ok(
  detail.analytics?.business.id === A.id && detail.analytics.periodDays === 30 && detail.analytics.category?.id === TYPE_A && detail.analytics.category.medians.noShowRate === 0.15,
  "la ficha: su parte de la foto de 30 días y las medianas de su tipo («Frente a su tipo»)",
  detail.analytics?.category,
);
ok(!JSON.stringify(detail.analytics).includes("Paciente Secreto"), "y sin pacientes");

await pool.end();
done("de la analítica del super admin");
