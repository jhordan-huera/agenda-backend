// El aviso de la mañana (spec 021): a la hora en que empieza a atender, cuántas citas de días anteriores
// siguen sin cerrar, a cada profesional (su agenda) y al propietario (el negocio, cuando abre), una sola vez,
// en la campana y en el celular; y el aviso al super admin de a qué negocios salieron los recordatorios
// (la mañana y las 8 de la noche), en su campana, su celular y ntfy, sólo con nombres de negocios y cifras.
// También la migración 045 (la campana acepta los dos tipos nuevos).
//
// El cron se simula con horas fijas de un día de hace más de un año (no depende de la hora en que corre la
// prueba, y las citas de los datos demo, que son más nuevas, no cuentan); sólo la pasada real del cron
// (scripts/cron.ts) usa la hora de ahora, con un horario que empezó hace 30 minutos.
// Datos ficticios. El servicio de avisos es uno falso en 127.0.0.1 (tests/helpers/harness.ts).
import { createBusinessWithOwner, businessInput } from "./helpers/business.mjs";
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, fakeNtfy, fakePushService, login, runCron, sql } from "./helpers/harness.ts";
import { REMINDERS_SENT_MAX_BUSINESSES } from "../src/shared/lib/constants/push.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PanelNotice, PanelNoticePage } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const push = await fakePushService();
const { pool } = await import("../src/db/pool.ts");
const delivery = await import("../src/services/push-delivery.ts");
const notices = await import("../src/services/push-notices.ts");
// Lo que esta prueba pone en cola desde aquí (el cron simulado) lo envía ella misma con processPushQueue.
delivery.disableImmediatePushDelivery();

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `203.0.113.${(ipSeq++ % 250) + 1}` });
type Browser = Awaited<ReturnType<typeof as>>;
type Device = ReturnType<typeof push.device>;

const tag = Date.now().toString(36);
const GYE = "America/Guayaquil";
/** El instante (ISO) de una hora de pared en una zona. */
const instant = (date: string, time: string, zone = GYE) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)).toISOString();
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
/** Una pasada simulada del cron de 10 minutos que termina a esa hora (de ese día, en Guayaquil). */
const passAt = (date: string, time: string, reminders?: ReturnType<typeof notices.emptyRemindersTally>) => {
  const until = instant(date, time);
  return notices.queueMorningSummaries(plus(until, -10), until, undefined, reminders);
};
/** Los avisos en cola (o enviados) a ese aparato con ese tag. */
const queuedFor = (device: Device, tagValue: string) =>
  count(
    `select count(*) from push_messages m join push_subscriptions s on s.id = m.subscription_id
      where s.endpoint = '${device.endpoint}' and m.tag = '${tagValue}'`,
  );
const sentTo = (device: Device, tagValue: string) => push.to(device.endpoint).filter((item) => item.payload?.tag === tagValue);
const panelKey = (key: string) => count(`select count(*) from panel_notices where dedupe_key = '${key}'`);
const bell = async (browser: Browser, businessId: string) =>
  ((await browser("GET", `/businesses/${businessId}/notices?limit=50`)).body as PanelNoticePage).notices;

const admin = await as("admin@demo.com");
const adminDevice = push.device();
ok((await admin("PUT", "/push/device", adminDevice)).status === 200, "el super admin activa sus avisos en el celular");

/* ======================================================================================== */
console.log("La migración 045: la campana acepta los dos tipos nuevos");
const checksOf = (where: string) =>
  sql(
    `select coalesce(string_agg(conname, ',' order by conname), '') from pg_constraint
      where conrelid = 'panel_notices'::regclass and contype = 'c' and ${where}`,
  );
ok(
  checksOf("pg_get_constraintdef(oid) like '%evening_summary%'") === "panel_notices_kind_check,panel_notices_scope_check" &&
    checksOf("pg_get_constraintdef(oid) like '%appointment_id%'") !== "" && checksOf("pg_get_constraintdef(oid) like '%url%'").includes("panel_notices_url_check"),
  "los dos check de los tipos se rehicieron con nombre; el de la cita y el del enlace siguen",
  checksOf("true"),
);
const dental = sql("select id from businesses where slug = 'dental-sonrisa'");
const rejects = (query: string) => {
  try {
    sql(query);
    return false;
  } catch {
    return true;
  }
};
const probe = sql(`insert into panel_notices (business_id, kind, data) values ('${dental}', 'morning_summary', '{"date": "2026-01-02", "count": 1}') returning id`).split("\n")[0];
ok(Boolean(probe), "morning_summary, del negocio y sin texto, se guarda");
ok(
  rejects(`insert into panel_notices (kind, data) values ('morning_summary', '{}')`) &&
    rejects(`insert into panel_notices (business_id, kind, title, body, url) values ('${dental}', 'morning_summary', 'a', 'b', '/dashboard')`),
  "morning_summary sin negocio o con texto guardado, no",
);
const platformProbe = sql(`insert into panel_notices (kind, title, body, url) values ('reminders_sent', 'Recordatorios', 'Mañana · 1 negocio: X (1 cita)', '/admin/businesses') returning id`).split("\n")[0];
ok(Boolean(platformProbe), "reminders_sent, de la plataforma y con su texto, se guarda");
ok(
  rejects(`insert into panel_notices (business_id, kind, title, body, url) values ('${dental}', 'reminders_sent', 'a', 'b', '/admin')`) &&
    rejects(`insert into panel_notices (kind) values ('reminders_sent')`) &&
    rejects(`insert into panel_notices (business_id, kind) values ('${dental}', 'otro_tipo')`),
  "reminders_sent con negocio o sin texto, y un tipo que no existe, no",
);
ok(
  rejects(`insert into panel_notices (business_id, kind) values ('${dental}', 'booking')`),
  "los que hablan de una cita siguen llevándola",
);
sql(`delete from panel_notices where id in ('${probe}', '${platformProbe}')`);

/* ======================================================================================== */
console.log("\nUn negocio con cuatro agendas: la propietaria, dos profesionales y una sin usuario");
const created = await createBusinessWithOwner(
  admin,
  { name: `Centro Mañana ${tag}`, slug: `centro-manana-${tag}`, timezone: GYE, plan: "business", category: "psychology" },
  { firstName: "Marta", lastName: "Mañana", email: `marta.${tag}@correo.ec`, password: "demo1234" },
);
ok(created.status === 200, "el super admin da de alta el negocio con su propietaria", created.body);
const centro: string = created.body.business.id;
const centroName = `Centro Mañana ${tag}`;
const service = sql(`select id from services where business_id = '${centro}' limit 1`);
const ownerAgenda = sql(`select id from professionals where business_id = '${centro}'`);
const newUser = (firstName: string, lastName: string, role: string) => {
  const email = `${firstName.toLowerCase()}.${tag}@correo.ec`;
  const id = sql(
    `insert into users (first_name, last_name, email, password_hash)
     select '${firstName}', '${lastName}', '${email}', password_hash from users where email = 'valeria@demo.com' returning id`,
  ).split("\n")[0];
  sql(`insert into business_users (business_id, user_id, role) values ('${centro}', '${id}', '${role}')`);
  return { id, email };
};
const agendaFor = (displayName: string, userId: string | null) =>
  sql(`insert into professionals (business_id, user_id, display_name) values ('${centro}', ${userId ? `'${userId}'` : "null"}, '${displayName}') returning id`).split(
    "\n",
  )[0];
const paulaUser = newUser("Paula", "Profesional", "professional");
const rosaUser = newUser("Rosa", "Profesional", "professional");
const paulaAgenda = agendaFor("Psic. Paula Profesional", paulaUser.id);
const rosaAgenda = agendaFor("Psic. Rosa Profesional", rosaUser.id);
const noUserAgenda = agendaFor("Consultorio 3", null);
/** El horario de una agenda, igual los siete días (o cerrado en `closedOn`). */
const setSchedule = (professionalId: string, intervals: { start: string; end: string }[], closedOn: number[] = [], businessId = centro) => {
  sql(`delete from schedules where professional_id = '${professionalId}'`);
  for (let day = 0; day < 7; day++) {
    sql(
      `insert into schedules (business_id, professional_id, day_of_week, is_active, intervals)
       values ('${businessId}', '${professionalId}', ${day}, ${!closedOn.includes(day)}, '${JSON.stringify(intervals)}')`,
    );
  }
};

// «Hoy» es un día de hace 400 días: nada depende de la hora en que corre la prueba, y las citas de los
// datos demo (de los últimos meses y de las próximas semanas) no son «de días anteriores» a él.
const today = getZonedNow(GYE).date;
const D = addDaysISO(today, -400);
const dow = (date: string) => Number(sql(`select extract(dow from date '${date}')::int`));
// Paula: dos horarios en el día, guardados en desorden (cuenta el primero, las 9:00).
setSchedule(paulaAgenda, [{ start: "15:00", end: "19:00" }, { start: "09:00", end: "13:00" }], [dow(addDaysISO(D, 1))]);
setSchedule(rosaAgenda, [{ start: "11:00", end: "17:00" }]);
setSchedule(ownerAgenda, [{ start: "10:00", end: "14:00" }]);
// La agenda sin usuario es la primera que abre: a las 8:00 abre el negocio.
setSchedule(noUserAgenda, [{ start: "08:00", end: "12:00" }]);

let seq = 0;
const patientNames = ["Lucía Fernanda Paredes", "Andrés Sebastián Mora", "Gabriela Ortiz Vélez"];
const patients = patientNames.map((name) =>
  sql(`insert into clients (business_id, name, document_id, email, phone) values ('${centro}', '${name}', '${cedulaFor(`${tag}-${name}`)}', '', '') returning id`).split(
    "\n",
  )[0],
);
const appointment = (professionalId: string, date: string, status = "confirmed") => {
  const start = `${String(7 + (seq % 12)).padStart(2, "0")}:${seq++ % 2 ? "30" : "00"}`;
  const [h, m] = start.split(":").map(Number);
  const end = `${String(h + (m === 30 ? 1 : 0)).padStart(2, "0")}:${m === 30 ? "00" : "30"}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${centro}', '${patients[seq % patients.length]}', '${service}', '${professionalId}', '${date}', '${start}', '${end}', '${status}', 20, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
// Paula: 3 de días anteriores sin cerrar (una Pendiente); las cerradas, la de hoy y la de mañana no cuentan.
appointment(paulaAgenda, addDaysISO(D, -1));
appointment(paulaAgenda, addDaysISO(D, -1), "pending");
appointment(paulaAgenda, addDaysISO(D, -3));
appointment(paulaAgenda, addDaysISO(D, -1), "completed");
appointment(paulaAgenda, addDaysISO(D, -2), "cancelled");
appointment(paulaAgenda, addDaysISO(D, -2), "no_show");
appointment(paulaAgenda, D);
appointment(paulaAgenda, addDaysISO(D, 1));
// Rosa: 1; la agenda sin usuario: 2; la propietaria: 1. El negocio: 7.
appointment(rosaAgenda, addDaysISO(D, -2));
appointment(noUserAgenda, addDaysISO(D, -4));
appointment(noUserAgenda, addDaysISO(D, -9), "pending");
appointment(ownerAgenda, addDaysISO(D, -1));

const marta = await as(`marta.${tag}@correo.ec`);
const paula = await as(paulaUser.email);
const rosa = await as(rosaUser.email);
const martaDevice = push.device();
const paulaDevice = push.device();
const rosaDevice = push.device();
ok(
  (await marta("PUT", "/push/device", martaDevice)).status === 200 &&
    (await paula("PUT", "/push/device", paulaDevice)).status === 200 &&
    (await rosa("PUT", "/push/device", rosaDevice)).status === 200,
  "la propietaria y las dos profesionales activan sus avisos (con todos los tipos encendidos)",
);
const config = await paula("GET", "/push/config");
ok(
  config.status === 200 && JSON.stringify(config.body.kinds) === '["evening_summary","morning_summary"]',
  "el rol Profesional tiene «Resumen al empezar el día», además del de las 8",
  config.body,
);

/* ======================================================================================== */
console.log("\nA la hora en que abre el negocio, el de la propietaria");
const morningTag = `manana-${D}`;
let queued = await passAt(D, "07:50");
ok(queued === 0 && panelKey(`manana:${centro}:${D}`) === 0, "antes de la hora (07:40–07:50), nada");
let reminders = notices.emptyRemindersTally();
queued = await passAt(D, "08:05", reminders);
await delivery.processPushQueue();
const [martaMorning] = sentTo(martaDevice, morningTag);
ok(
  queued === 1 && sentTo(martaDevice, morningTag).length === 1 && martaMorning.payload?.title === "Tu negocio tiene 7 citas de días anteriores sin cerrar" &&
    martaMorning.payload.body === "Márcalas Completada o No asistió para que la agenda y los reportes cuadren." &&
    martaMorning.payload.url === "/dashboard/calendar?por-cerrar=1" && martaMorning.payload.kind === "morning_summary" && martaMorning.headers.urgency === "normal",
  "a las 8:00 (la agenda sin usuario abre el negocio): «Tu negocio tiene 7 citas de días anteriores sin cerrar», que abre la lista «Por cerrar»",
  [queued, martaMorning?.payload],
);
ok(
  panelKey(`manana:${centro}:${D}`) === 1 && count(`select count(*) from push_messages where dedupe_key = 'manana:${centro}:${D}'`) === 1,
  "en la campana y en el celular, con la clave manana:<negocio>:<fecha>",
);
ok(queuedFor(paulaDevice, morningTag) === 0 && queuedFor(rosaDevice, morningTag) === 0, "a las profesionales todavía no: empiezan más tarde");
ok(panelKey(`manana:${noUserAgenda}:${D}`) === 0, "la agenda sin usuario no tiene aviso propio (sus 2 cuentan en el del negocio)");
ok(
  reminders.batches.morning.get(centro) === 7 && reminders.batches.morning.size === 1 && reminders.morningNotices === 1,
  "queda anotado para el super admin: este negocio, con 7 citas",
  [...reminders.batches.morning],
);

/* ======================================================================================== */
console.log("\nA cada profesional, a la hora de su horario");
queued = await passAt(D, "09:05");
await delivery.processPushQueue();
const [paulaMorning] = sentTo(paulaDevice, morningTag);
ok(
  queued === 1 && sentTo(paulaDevice, morningTag).length === 1 && paulaMorning.payload?.title === "Tienes 3 citas de días anteriores sin cerrar" &&
    paulaMorning.payload.url === "/dashboard/calendar?por-cerrar=1",
  "a las 9:00 (su primer horario, aunque esté guardado después del de las 15:00): «Tienes 3 citas de días anteriores sin cerrar»",
  [queued, paulaMorning?.payload],
);
ok(
  count(`select count(*) from push_messages where dedupe_key = 'manana:${paulaAgenda}:${D}'`) === 1 && panelKey(`manana:${paulaAgenda}:${D}`) === 1,
  "con la clave manana:<agenda>:<fecha>",
);
ok(sentTo(martaDevice, morningTag).length === 1 && queuedFor(martaDevice, morningTag) === 1, "la propietaria no lo recibe otra vez (sigue dentro de sus 2 horas)");
ok((await passAt(D, "09:15")) === 0 && (await passAt(D, "09:05")) === 0, "la pasada siguiente, o un reintento de la misma, no lo repite");
ok((await passAt(D, "10:05")) === 0 && panelKey(`manana:${ownerAgenda}:${D}`) === 0, "a las 10:00 empieza la agenda de la propietaria: no recibe uno aparte por ella");
ok((await passAt(D, "15:05")) === 0 && queuedFor(paulaDevice, morningTag) === 1, "a las 15:00 (su segundo horario) no llega otro");

// Rosa empieza a las 11:00, pero el cron estuvo parado: a las 13:00 ya pasaron las 2 horas.
ok((await passAt(D, "13:00")) === 0 && queuedFor(rosaDevice, morningTag) === 0 && panelKey(`manana:${rosaAgenda}:${D}`) === 0, "pasadas las 2 horas desde su inicio, ese día no sale");
const D2 = addDaysISO(D, 7);
const until = instant(D2, "12:59");
queued = await notices.queueMorningSummaries(plus(until, -180), until);
ok(
  queued === 1 && queuedFor(rosaDevice, `manana-${D2}`) === 1 && panelKey(`manana:${rosaAgenda}:${D2}`) === 1,
  "otro día, con el cron parado de 9:59 a 12:59: sale en la primera pasada, todavía dentro de sus 2 horas",
  queued,
);
await delivery.processPushQueue();
ok(sentTo(rosaDevice, `manana-${D2}`)[0]?.payload?.title === "Tienes 1 cita de un día anterior sin cerrar", "en singular: «Tienes 1 cita de un día anterior sin cerrar»", sentTo(rosaDevice, `manana-${D2}`)[0]?.payload);
ok(sentTo(rosaDevice, `manana-${D2}`)[0]?.payload?.body.startsWith("Márcala Completada"), "y «Márcala…»");

/* ======================================================================================== */
console.log("\nQuien no atiende ese día no lo recibe");
const D1 = addDaysISO(D, 1);
await passAt(D1, "08:05");
await passAt(D1, "09:05");
ok(panelKey(`manana:${paulaAgenda}:${D1}`) === 0 && queuedFor(paulaDevice, `manana-${D1}`) === 0, "Paula no atiende ese día de la semana: nada");
ok(panelKey(`manana:${centro}:${D1}`) === 1, "y el negocio sí abre (la propietaria lo recibe)");
const D3 = addDaysISO(D, 3);
sql(`insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day) values ('${centro}', '${paulaAgenda}', 'Congreso', '${addDaysISO(D3, -1)}', '${addDaysISO(D3, 1)}', true)`);
sql(`insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day, start_time, end_time) values ('${centro}', '${rosaAgenda}', 'Trámite', '${D3}', '${D3}', false, '10:00', '12:00')`);
await passAt(D3, "08:05");
await passAt(D3, "09:05");
await passAt(D3, "11:05");
ok(panelKey(`manana:${paulaAgenda}:${D3}`) === 0, "con un bloqueo de día completo de su agenda, no");
ok(panelKey(`manana:${rosaAgenda}:${D3}`) === 1, "un bloqueo de unas horas no cuenta: Rosa atiende y lo recibe");
const D4 = addDaysISO(D, 4);
sql(`insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day) values ('${centro}', null, 'Feriado', '${D4}', '${D4}', true)`);
for (const time of ["08:05", "09:05", "10:05", "11:05"]) await passAt(D4, time);
ok(count(`select count(*) from panel_notices where business_id = '${centro}' and data ->> 'date' = '${D4}'`) === 0, "con el negocio entero cerrado (feriado), nadie: tampoco la propietaria");

/* ======================================================================================== */
console.log("\nEl celular, sólo con el tipo encendido y con el rol Profesional");
await paula("PATCH", "/push/device", { endpoint: paulaDevice.endpoint, mutedKinds: ["morning_summary"] });
const D5 = addDaysISO(D, 5);
await passAt(D5, "09:05");
ok(
  queuedFor(paulaDevice, `manana-${D5}`) === 0 && panelKey(`manana:${paulaAgenda}:${D5}`) === 1,
  "Paula lo apagó: no le llega al celular, pero sí a la campana",
);
await paula("PATCH", "/push/device", { endpoint: paulaDevice.endpoint, mutedKinds: [] });
sql(`update business_users set role = 'staff' where user_id = '${rosaUser.id}'`);
await passAt(D5, "11:05");
ok(
  queuedFor(rosaDevice, `manana-${D5}`) === 0 && panelKey(`manana:${rosaAgenda}:${D5}`) === 1,
  "con el rol Recepción (o administrador) no le llega al celular; la campana de su agenda, sí",
);
sql(`update business_users set role = 'professional' where user_id = '${rosaUser.id}'`);

/* ======================================================================================== */
console.log("\nSin citas de días anteriores sin cerrar, nada");
const quiet = await createBusinessWithOwner(
  admin,
  { name: `Quieto ${tag}`, slug: `quieto-${tag}`, timezone: GYE, plan: "free" },
  { firstName: "Quique", lastName: "Quieto", email: `quique.${tag}@correo.ec`, password: "demo1234" },
);
const quietId: string = quiet.body.business.id;
const quietAgenda = sql(`select id from professionals where business_id = '${quietId}'`);
setSchedule(quietAgenda, [{ start: "08:00", end: "12:00" }], [], quietId);
const quietService = sql(`select id from services where business_id = '${quietId}' limit 1`);
const quietClient = sql(`insert into clients (business_id, name, document_id, email, phone) values ('${quietId}', 'Paciente Quieto', '${cedulaFor(`${tag}-quieto`)}', '', '') returning id`).split("\n")[0];
sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${quietId}', '${quietClient}', '${quietService}', '${quietAgenda}', '${addDaysISO(D, -1)}', '10:00', '10:30', 'completed', 20, 'dashboard'),
          ('${quietId}', '${quietClient}', '${quietService}', '${quietAgenda}', '${D}', '07:00', '07:30', 'confirmed', 20, 'dashboard')`,
);
reminders = notices.emptyRemindersTally();
await passAt(D, "08:05", reminders);
ok(
  count(`select count(*) from panel_notices where business_id = '${quietId}' and kind = 'morning_summary'`) === 0 && !reminders.batches.morning.has(quietId),
  "sólo una cerrada y una de hoy: no llega nada, y el super admin no lo cuenta",
);
// La de hoy queda cerrada: en los días siguientes sería «de un día anterior».
sql(`update appointments set status = 'completed' where business_id = '${quietId}'`);

/* ======================================================================================== */
console.log("\nLa campana de cada una");
const notice = (list: PanelNotice[]) => list.filter((item) => item.kind === "morning_summary");
const martaBell = notice(await bell(marta, centro));
const paulaBell = notice(await bell(paula, centro));
const savedFor = (where: string) => count(`select count(*) from panel_notices where business_id = '${centro}' and kind = 'morning_summary' and ${where}`);
ok(
  martaBell.length === savedFor("professional_id is null") &&
    martaBell.every((item) => /^Tu negocio tiene \d+ citas de días anteriores sin cerrar$/.test(item.title) && item.url === "/dashboard/calendar?por-cerrar=1") &&
    martaBell.some((item) => item.title === "Tu negocio tiene 7 citas de días anteriores sin cerrar"),
  "la propietaria ve los del negocio entero («Tu negocio tiene 7…»), no los de las agendas",
  martaBell.map((item) => item.title),
);
ok(
  paulaBell.length === savedFor(`professional_id = '${paulaAgenda}'`) && paulaBell.length === 2 &&
    paulaBell.every((item) => /^Tienes \d+ citas de días anteriores sin cerrar$/.test(item.title)) &&
    paulaBell.some((item) => item.title === "Tienes 3 citas de días anteriores sin cerrar"),
  "Paula ve los de su agenda («Tienes 3…»), no los del negocio",
  paulaBell.map((item) => item.title),
);

/* ======================================================================================== */
console.log("\nSin datos de pacientes");
const texts = sql(`select coalesce(string_agg(title || ' ' || body || ' ' || url, ' | '), '') from push_messages where tag like 'manana-%'`);
ok(
  texts.length > 0 && !patientNames.some((name) => name.split(" ").some((part) => texts.includes(part))) && !patients.some((id) => texts.includes(id)),
  "ni nombres ni ids de pacientes: sólo la cifra (RF-005)",
  texts.slice(0, 300),
);

/* ======================================================================================== */
console.log("\nEl aviso al super admin (Historia 3)");
const D6 = addDaysISO(D, 14);
reminders = notices.emptyRemindersTally();
const since6 = plus(instant(D6, "08:05"), -10);
const until6 = instant(D6, "08:05");
await notices.queueMorningSummaries(since6, until6, undefined, reminders);
let sent = await notices.queueRemindersSentNotices(reminders, since6, until6);
await delivery.processPushQueue();
const adminMorning = push.to(adminDevice.endpoint).filter((item) => item.payload?.kind === "reminders_sent");
// Para entonces el negocio tiene 9 de días anteriores (las de Paula de D y D+1 ya lo son).
ok(
  sent.queued === 1 && adminMorning.length === 1 && adminMorning[0].payload?.title === "Recordatorios de citas por cerrar enviados" &&
    adminMorning[0].payload.body === `Mañana · 1 negocio: ${centroName} (9 citas)` && adminMorning[0].payload.url === "/admin/businesses",
  `uno solo por tanda: «Recordatorios de citas por cerrar enviados · Mañana · 1 negocio: ${centroName} (9 citas)»`,
  [sent, adminMorning.map((item) => item.payload)],
);
ok(
  sent.sent.length === 1 && sent.sent[0].batch === "morning" && sent.sent[0].businesses === 1 && sent.sent[0].body === adminMorning[0]?.payload?.body,
  "y lo mismo para ntfy",
  sent.sent,
);
const adminBell = ((await admin("GET", "/admin/notices?limit=50")).body as PanelNoticePage).notices.filter((item) => item.kind === "reminders_sent");
ok(adminBell.length === 1 && adminBell[0].body === `Mañana · 1 negocio: ${centroName} (9 citas)`, "en la campana de /admin", adminBell);
ok(
  !(await bell(marta, centro)).some((item) => item.kind === "reminders_sent"),
  "a ningún negocio le llega",
);
reminders = notices.emptyRemindersTally();
await notices.queueMorningSummaries(since6, until6, undefined, reminders);
sent = await notices.queueRemindersSentNotices(reminders, since6, until6);
ok(sent.queued === 0 && sent.sent.length === 0, "si el cron vuelve a pasar sin avisos nuevos, nada");
reminders = notices.emptyRemindersTally();
const since7 = plus(instant(D6, "09:05"), -10);
await notices.queueMorningSummaries(since7, instant(D6, "09:05"), undefined, reminders);
sent = await notices.queueRemindersSentNotices(reminders, since7, instant(D6, "09:05"));
ok(
  sent.sent.length === 1 && sent.sent[0]?.body === `Mañana · 1 negocio: ${centroName} (5 citas)`,
  "a las 9:00 sale el de Paula: otro aviso, con las citas de lo que salió en esa pasada (las 5 de su agenda)",
  sent.sent,
);

// El de las 8 de la noche: las de hoy que ya terminaron (una de Paula y una de Rosa).
appointment(paulaAgenda, D6);
appointment(rosaAgenda, D6, "pending");
reminders = notices.emptyRemindersTally();
const eight = instant(D6, "20:00");
await notices.queueEveningSummaries(plus(eight, -5), plus(eight, 5), undefined, reminders);
sent = await notices.queueRemindersSentNotices(reminders, plus(eight, -5), plus(eight, 5));
await delivery.processPushQueue();
ok(
  sent.sent.length === 1 && sent.sent[0].batch === "evening" && sent.sent[0].body === `Noche · 1 negocio: ${centroName} (2 citas)`,
  `y la tanda de la noche: «Noche · 1 negocio: ${centroName} (2 citas)»`,
  sent.sent,
);
ok(push.to(adminDevice.endpoint).filter((item) => item.payload?.kind === "reminders_sent").length === 3, "cada pasada con avisos, uno al celular del super admin");

// Más de 10 negocios: los 10 con más citas y «y N negocios más».
const many: { id: string; name: string }[] = [];
for (let i = 0; i < REMINDERS_SENT_MAX_BUSINESSES + 2; i++) {
  const name = `Negocio ${String(i + 1).padStart(2, "0")} ${tag}`;
  const r = await admin("POST", "/admin/businesses", businessInput({ name, slug: `negocio-${i + 1}-${tag}` }));
  many.push({ id: r.body.business.id, name });
}
const crowd = notices.emptyRemindersTally();
many.forEach(({ id }, index) => crowd.batches.morning.set(id, index + 1));
const crowdAt = instant(D6, "10:05");
sent = await notices.queueRemindersSentNotices(crowd, plus(crowdAt, -10), crowdAt);
const crowdBody = sent.sent[0]?.body ?? "";
const expectedNamed = [...many].reverse().slice(0, REMINDERS_SENT_MAX_BUSINESSES);
ok(
  crowdBody ===
    `Mañana · 12 negocios: ${expectedNamed.map(({ name }, index) => `${name} (${index === 0 ? "12 citas" : 12 - index})`).join(", ")} y 2 negocios más`,
  "con 12 negocios: los 10 de más citas, de mayor a menor, y «y 2 negocios más»",
  crowdBody,
);
ok(!crowdBody.includes(many[0].name) && !crowdBody.includes(many[1].name), "los dos de menos citas no se nombran");
const platformTexts = sql(`select coalesce(string_agg(title || ' ' || body, ' | '), '') from panel_notices where kind = 'reminders_sent'`);
ok(
  !patientNames.some((name) => name.split(" ").some((part) => platformTexts.includes(part))) &&
    !sql(`select coalesce(string_agg(title, ' | '), '') from panel_notices where kind = 'reminders_sent'`).includes(tag),
  "sin pacientes, y el título nunca nombra un negocio",
);

/* ======================================================================================== */
console.log("\nEl cron de GitHub (scripts/cron.ts), con la hora de ahora");
// Las citas de los días simulados ya pasaron de verdad: se cierran para que sólo cuente el negocio de aquí abajo.
sql(`update appointments set status = 'completed' where business_id = '${centro}' and status in ('pending', 'confirmed')`);
// Un negocio cuyo horario de hoy empezó hace 30 minutos (en su zona), con una cita de ayer sin cerrar.
const now = sql(`select to_char(now() at time zone '${GYE}' - interval '30 minutes', 'YYYY-MM-DD|HH24:MI')`).split("|");
const [startDate, startTime] = now;
const live = await createBusinessWithOwner(
  admin,
  { name: `Ahora Mismo ${tag}`, slug: `ahora-${tag}`, timezone: GYE, plan: "free" },
  { firstName: "Nelly", lastName: "Ahora", email: `nelly.${tag}@correo.ec`, password: "demo1234" },
);
const liveId: string = live.body.business.id;
const liveAgenda = sql(`select id from professionals where business_id = '${liveId}'`);
sql(`delete from schedules where professional_id = '${liveAgenda}'`);
sql(
  `insert into schedules (business_id, professional_id, day_of_week, is_active, intervals)
   values ('${liveId}', '${liveAgenda}', ${dow(startDate)}, true, '[{"start": "${startTime}", "end": "23:59"}]')`,
);
const liveService = sql(`select id from services where business_id = '${liveId}' limit 1`);
const liveClient = sql(`insert into clients (business_id, name, document_id, email, phone) values ('${liveId}', 'Paciente Ahora', '${cedulaFor(`${tag}-ahora`)}', '', '') returning id`).split("\n")[0];
sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${liveId}', '${liveClient}', '${liveService}', '${liveAgenda}', '${addDaysISO(startDate, -1)}', '10:00', '10:30', 'confirmed', 20, 'dashboard')`,
);
const ntfy = await fakeNtfy();
const cron = await runCron(ntfy.url, { VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY });
const reminderNotice = ntfy.received.find((item) => item.title === "Agenda360: recordatorios de citas por cerrar enviados");
ok(cron.code === 0 && panelKey(`manana:${liveId}:${startDate}`) === 1, "el cron prepara el aviso de la mañana (junto al resumen de las 8)", cron.output.slice(-400));
ok(
  Boolean(reminderNotice?.message.split("\n").some((line) => line.startsWith("Mañana · ") && line.includes(`Ahora Mismo ${tag} (1 cita)`))) && Boolean(reminderNotice?.click?.endsWith("/admin/businesses")),
  "ntfy: «Agenda360: recordatorios de citas por cerrar enviados», con los negocios y sus cifras en el mensaje",
  ntfy.received.map((item) => [item.title, item.message.slice(0, 200)]),
);
ok(
  / · avisos de la mañana: \d+ · recordatorios: mañana [1-9]\d* negocios? · noche \d+ negocios? · /.test(cron.output),
  "la línea del registro suma los avisos de la mañana y los recordatorios, sólo con cifras",
  cron.output.slice(-600),
);
ok(!cron.output.includes(`Ahora Mismo ${tag}`) && !cron.output.includes(centroName) && !cron.output.includes("Paciente Ahora"), "el registro (público) no nombra negocios ni pacientes");
ok(
  push.to(adminDevice.endpoint).some((item) => item.payload?.kind === "reminders_sent" && item.payload.body.includes(`Ahora Mismo ${tag} (1 cita)`)),
  "y el celular del super admin",
);
const report = JSON.parse(sql("select report::text from cron_runs order by ran_at desc limit 1"));
ok((report.push?.morning ?? 0) >= 1 && report.push?.reminders?.some((item: { batch: string }) => item.batch === "morning"), "y queda en cron_runs.report", report.push);
ntfy.close();

push.close();
await pool.end();
done("del aviso de la mañana");
