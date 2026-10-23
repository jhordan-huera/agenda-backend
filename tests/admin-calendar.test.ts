// El calendario de la plataforma (spec 035): las cifras por día, por hora y del panel de un negocio, «sin
// cerrar», los filtros por tipo y por negocio, el negocio suspendido (no cuenta), los límites del rango,
// los permisos y la privacidad: la respuesta no lleva nada del paciente, del servicio ni de la cita suelta.
import { createBusinessWithOwner } from "./helpers/business.mjs";
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import type { AdminCalendar, AdminCalendarBusiness, AdminCalendarDay } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { addDaysISO, getZonedNow } = await import("../src/shared/lib/time.ts");

const T = getZonedNow("America/Guayaquil").date;
/** Un día pasado (sus citas abiertas quedan «sin cerrar») y uno futuro. */
const PAST = addDaysISO(T, -3);
const FUTURE = addDaysISO(T, 2);

const admin = await login("admin@demo.com");
const owner = await login("ricardo@demo.com");

// Tipos de prueba: categorías del seed sin negocios demo.
const TYPE = "speech_therapy";
const OTHER_TYPE = "training";
if (count(`select count(*) from businesses where category in ('${TYPE}', '${OTHER_TYPE}')`) > 0) {
  throw new Error("Los datos demo ya usan las categorías de la prueba: elige otras.");
}

/** Lo que no debe aparecer nunca en una respuesta del calendario. */
const SECRETS: string[] = [];
let seq = 0;

interface Biz {
  id: string;
  service: string;
  professionals: string[];
  client: string;
}

async function createBiz(key: string, category: string): Promise<Biz> {
  const r = await createBusinessWithOwner(
    admin,
    { name: `Calendario ${key}`, slug: `calendario-${key.toLowerCase()}`, category, services: [{ name: "Consulta", durationMinutes: 30, price: 25 }] },
    { firstName: "Dueña", lastName: `Calendario ${key}`, email: `duena.calendario.${key.toLowerCase()}@negocio.ec`, password: "ClaveSegura1" },
  );
  if (r.status !== 200) throw new Error(`No se pudo crear ${key}: ${JSON.stringify(r.body)}`);
  const id: string = r.body.business.id;
  const service = sql(`update services set name = 'Terapia Confidencial ${key}' where business_id = '${id}' returning id`).split("\n")[0];
  SECRETS.push(`Terapia Confidencial ${key}`);
  seq++;
  const name = `Paciente Secreto ${key}`;
  const email = `secreto.${key.toLowerCase()}@paciente.ec`;
  const phone = `0987${String(seq).padStart(6, "0")}`;
  const document = cedulaFor(`calendario-${seq}`);
  const client = sql(
    `insert into clients (business_id, name, email, phone, document_id)
     values ('${id}', '${name}', '${email}', '${phone}', '${document}') returning id`,
  ).split("\n")[0];
  SECRETS.push(name, email, phone, document, client);
  return {
    id,
    service,
    client,
    professionals: [sql(`select id from professionals where business_id = '${id}' order by display_name limit 1`)],
  };
}

const ids: string[] = [];

/** Una cita: [día, hora, estado, agenda (índice), online, pagada]. */
type Row = [date: string, start: string, status: string, professional: number, online?: boolean, paid?: boolean];
function insert(biz: Biz, rows: Row[]) {
  const values = rows.map(([date, start, status, professional, online, paid], index) => {
    const end = `${start.slice(0, 2)}:${String(Number(start.slice(3)) + 25).padStart(2, "0")}`;
    return `('${biz.id}', '${biz.client}', '${biz.service}', '${biz.professionals[professional]}', '${date}', '${start}', '${end}', '${status}', 25,
             '${online ? "booking_page" : "dashboard"}', ${paid ? "now()" : "null"}, 'nota secreta ${seq}-${index}')`;
  });
  SECRETS.push(`nota secreta ${seq}`);
  const created = sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source, paid_at, notes)
     values ${values.join(",\n")} returning id`,
  ).split("\n");
  ids.push(...created);
}

console.log("Preparando los negocios de prueba");
// X (tipo de prueba, activo, dos agendas): el día pasado tiene 7 citas, 1 cancelada; el futuro, 2.
const X = await createBiz("X", TYPE);
X.professionals.push(sql(`insert into professionals (business_id, display_name) values ('${X.id}', 'Zoila Agenda Dos') returning id`).split("\n")[0]);
const firstName = sql(`select display_name from professionals where id = '${X.professionals[0]}'`);
insert(X, [
  [PAST, "09:00", "pending", 0],
  [PAST, "09:30", "confirmed", 0],
  [PAST, "10:00", "completed", 1],
  [PAST, "10:30", "completed", 1, false, true],
  [PAST, "11:00", "no_show", 0],
  [PAST, "11:30", "cancelled", 0],
  [PAST, "14:00", "pending", 1, true],
  [FUTURE, "09:00", "pending", 0],
  [FUTURE, "10:00", "confirmed", 1],
]);
// Z (otro tipo, activo): una confirmada el día pasado.
const Z = await createBiz("Z", OTHER_TYPE);
insert(Z, [[PAST, "09:00", "confirmed", 0]]);
// Y (tipo de prueba, suspendido): no cuenta nunca.
const Y = await createBiz("Y", TYPE);
insert(Y, [
  [PAST, "09:00", "confirmed", 0],
  [PAST, "15:00", "pending", 0],
]);
sql(`update businesses set status = 'suspended' where id = '${Y.id}'`);

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
const range = (params: Record<string, string | number | undefined>) => admin("GET", `/admin/calendar?${query(params)}`);
const dayOf = (params: Record<string, string | number | undefined>) => admin("GET", `/admin/calendar/day?${query(params)}`);

/** Ninguno de los datos del paciente, del servicio, de las notas ni el id de una cita. */
function privacy(label: string, body: unknown) {
  const json = JSON.stringify(body);
  const leaked = [...SECRETS, ...ids].filter((secret) => json.includes(secret));
  ok(leaked.length === 0, `${label}: no lleva nada del paciente, del servicio ni de la cita suelta`, leaked);
  ok(!/"(start|end)Time"|"client|"service|"notes"/.test(json), `${label}: sin campos de la cita suelta`, json.slice(0, 300));
}

console.log("El mes y la semana: cifras por día y por hora");
{
  const r = await range({ from: addDaysISO(T, -10), to: addDaysISO(T, 10), category: TYPE });
  ok(r.status === 200, "GET /admin/calendar responde", r.body);
  const calendar = r.body as AdminCalendar;
  const past = calendar.days.find((d) => d.date === PAST);
  ok(
    past?.appointments === 6 && past.cancelled === 1 && past.unclosed === 3 && past.businesses === 1,
    "el día pasado: 6 citas, 1 cancelada, 3 sin cerrar, 1 negocio (el suspendido no cuenta)",
    past,
  );
  const future = calendar.days.find((d) => d.date === FUTURE);
  ok(future?.appointments === 2 && future.unclosed === 0 && future.cancelled === 0, "el día futuro: 2 citas y ninguna sin cerrar", future);
  ok(calendar.days.length === 2, "sólo vienen los días con citas", calendar.days);
  const hours = calendar.hours.filter((h) => h.date === PAST).map((h) => `${h.hour}:${h.appointments}`);
  ok(hours.join(" ") === "9:2 10:2 11:1 14:1", "las horas del día pasado, sin la cancelada: 9→2, 10→2, 11→1, 14→1", hours);
  privacy("el mes", calendar);
}

console.log("Los filtros");
{
  const byBusiness = (await range({ from: PAST, to: PAST, businessId: Z.id })).body as AdminCalendar;
  ok(byBusiness.days.length === 1 && byBusiness.days[0].appointments === 1, "por negocio: sólo las de ese negocio", byBusiness.days);
  const other = (await range({ from: PAST, to: PAST, category: OTHER_TYPE })).body as AdminCalendar;
  ok(other.days[0]?.appointments === 1 && other.days[0].businesses === 1, "por tipo: sólo los negocios de ese tipo", other.days);
  const suspended = (await range({ from: PAST, to: PAST, businessId: Y.id })).body as AdminCalendar;
  ok(suspended.days.length === 0 && suspended.hours.length === 0, "el negocio suspendido no aparece ni filtrándolo", suspended);
  // Sin filtros: todos los activos, también los demo; se compara con una cuenta aparte.
  const all = (await range({ from: PAST, to: PAST })).body as AdminCalendar;
  const expected = count(
    `select count(*) from appointments a join businesses b on b.id = a.business_id
      where b.status = 'active' and a.date = '${PAST}' and a.status <> 'cancelled'`,
  );
  ok((all.days[0]?.appointments ?? 0) === expected && expected >= 7, `sin filtros: todos los negocios activos (${expected})`, all.days);
}

console.log("El panel de un día y de una hora");
{
  const r = await dayOf({ date: PAST, category: TYPE });
  ok(r.status === 200, "GET /admin/calendar/day responde", r.body);
  const day = r.body as AdminCalendarDay;
  ok(day.businesses.length === 1 && day.businesses[0].id === X.id, "un solo negocio: el activo del tipo", day.businesses.map((b) => b.name));
  const x = day.businesses[0] as AdminCalendarBusiness;
  ok(x.name === "Calendario X" && x.categoryName !== "" && x.categoryName !== TYPE, "con su nombre y el nombre de su tipo", x);
  ok(x.appointments === 6 && x.online === 1 && x.unclosed === 3, "6 citas, 1 online y 3 sin cerrar", x);
  ok(
    JSON.stringify(x.counts) === JSON.stringify({ pending: 2, confirmed: 1, completed: 1, paid: 1, noShow: 1, cancelled: 1 }),
    "por estado: 2 por confirmar, 1 confirmada, 1 atendida, 1 pagada, 1 no asistió y 1 cancelada",
    x.counts,
  );
  const professionals = x.professionals.map((p) => `${p.name}:${p.appointments}`).sort();
  ok(
    professionals.join(" ") === [`${firstName}:3`, "Zoila Agenda Dos:3"].sort().join(" "),
    "cada agenda con sus citas sin cancelar (3 y 3)",
    x.professionals,
  );
  ok(Object.keys(x).sort().join() === "appointments,categoryName,counts,id,name,online,professionals,unclosed", "sólo los campos de cifras", Object.keys(x));
  privacy("el panel", day);

  const hour = (await dayOf({ date: PAST, hour: 10, category: TYPE })).body as AdminCalendarDay;
  const h = hour.businesses[0];
  ok(hour.hour === 10 && h?.appointments === 2 && h.counts.completed === 1 && h.counts.paid === 1, "a las 10: la atendida y la pagada", hour);
  ok(h?.professionals.length === 1 && h.professionals[0].name === "Zoila Agenda Dos", "a las 10: sólo la agenda que atendió", h?.professionals);
  const empty = (await dayOf({ date: addDaysISO(T, 30), category: TYPE })).body as AdminCalendarDay;
  ok(empty.businesses.length === 0, "un día sin citas: el panel vacío", empty);
  const mine = (await dayOf({ date: PAST, businessId: Z.id })).body as AdminCalendarDay;
  ok(mine.businesses.length === 1 && mine.businesses[0].id === Z.id, "el panel también filtra por negocio", mine.businesses);
}

console.log("Los límites");
{
  ok((await range({ from: T, to: addDaysISO(T, 41) })).status === 200, "42 días: se puede");
  ok((await range({ from: T, to: addDaysISO(T, 42) })).status === 400, "43 días: 400");
  ok((await range({ from: T, to: addDaysISO(T, -1) })).status === 400, "el final antes del inicio: 400");
  ok((await range({ to: T })).status === 400, "sin fecha de inicio: 400");
  ok((await range({ from: "2026-02-30", to: T })).status === 400, "una fecha que no existe: 400");
  ok((await range({ from: T, to: T, businessId: "no-es-un-id" })).status === 400, "un negocio que no es un id: 400");
  ok((await dayOf({ date: T, hour: 24 })).status === 400, "la hora 24: 400");
  ok((await dayOf({ date: T, hour: "diez" })).status === 400, "una hora que no es un número: 400");
}

console.log("Los permisos");
{
  ok((await owner("GET", `/admin/calendar?${query({ from: T, to: T })}`)).status === 403, "un propietario: 403");
  ok((await owner("GET", `/admin/calendar/day?${query({ date: T })}`)).status === 403, "un propietario, el panel: 403");
  ok((await agent()("GET", `/admin/calendar?${query({ from: T, to: T })}`)).status === 401, "sin sesión: 401");
  const before = count(`select count(*) from audit_logs`);
  await range({ from: T, to: T });
  await dayOf({ date: PAST });
  ok(count(`select count(*) from audit_logs`) === before, "mirarlo no va a la actividad");
}

done("del calendario de la plataforma");
