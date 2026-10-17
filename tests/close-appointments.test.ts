// Citas por cerrar (spec 018): la lista «Por cerrar» y su contador por rol (el rol Profesional sólo ve su
// agenda), de la más vieja a la más nueva y sin las ya cerradas ni las que no terminaron, en tandas de 50,
// «Marcar todas como completadas» (sólo las de su alcance que siguen sin cerrar, cada una con su entrada en
// la actividad), que sin «Avisar a los pacientes» no se pone ningún email en la cola, una cita cerrada a la
// vez por dos personas y la zona horaria del negocio. Desde la spec 021, las de un mes anterior
// (`previousMonth`), con el mismo alcance por rol y en la zona del negocio. Datos ficticios.
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, login, sql } from "./helpers/harness.ts";
import { CLOSE_ALL_MAX, TO_CLOSE_PAGE_SIZE } from "../src/shared/lib/constants/appointment-status.ts";
import { addDaysISO } from "../src/shared/lib/time.ts";
import type { AppointmentsToClose, AppointmentsToCloseCount, AppointmentToClose, CloseAllResult } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `198.51.100.${(ipSeq++ % 250) + 1}` });
type Browser = Awaited<ReturnType<typeof as>>;

const tag = Date.now().toString(36);
const startedAt = sql("select now()");

/* ======================================================================================== */
console.log("La Clínica Dental Sonrisa: tres agendas (una sin usuario) y cuatro roles");
const ricardo = await as("ricardo@demo.com"); // propietario, con su agenda
const dental: string = ricardo.session.businessId;
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional, agenda «Dra. Valeria Cruz»
const admin = await as("admin@demo.com"); // super admin (en modo soporte, al entrar al negocio)
const B = `/businesses/${dental}`;
const agendaOf = (where: string) => sql(`select id from professionals where business_id = '${dental}' and ${where}`);
const ricardoAgenda = agendaOf(`user_id = (select id from users where email = 'ricardo@demo.com')`);
const valeriaAgenda = agendaOf(`user_id = (select id from users where email = 'valeria@demo.com')`);
const andresAgenda = agendaOf(`display_name = 'Dr. Andrés Vega'`);
const zone = sql(`select timezone from businesses where id = '${dental}'`);
const today = sql(`select (now() at time zone '${zone}')::date`);
const nowMinutes = Number(sql(`select extract(hour from now() at time zone '${zone}') * 60 + extract(minute from now() at time zone '${zone}')`));
const service = sql(`select id from services where business_id = '${dental}' and name = 'Consulta odontológica'`);
ok(Boolean(ricardoAgenda && valeriaAgenda && andresAgenda && service), "las tres agendas y el servicio", { ricardoAgenda, valeriaAgenda, andresAgenda });

// Los datos demo dejan cerradas las citas que ya pasaron, pero alguna de hoy podría terminar durante la
// prueba: todas las de hoy y de antes quedan cerradas, y sólo cuentan las que crea esta prueba.
sql(`update appointments set status = 'completed' where business_id = '${dental}' and status in ('pending', 'confirmed') and date <= '${today}'`);
// Los emails de seguimiento (Completada y No asistió) encendidos: así se ve si salen o no.
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": true, "cancellations": true, "followUps": true}'::jsonb where id = '${dental}'`);

let seq = 0;
/** Un paciente con email propio. */
const patient = (name: string, businessId = dental) => {
  const email = `cierre.${++seq}.${tag}@example.com`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${businessId}', '${name}', '${cedulaFor(email)}', '${email}', '') returning id`,
  ).split("\n")[0];
  return { id, name, email };
};
/** Una cita creada directamente en la base (fuera del horario de los datos demo: no choca con ninguna). */
const appointment = (input: {
  professionalId: string;
  clientId: string;
  date: string;
  start: string;
  end: string;
  status: string;
  businessId?: string;
  serviceId?: string;
}) =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${input.businessId ?? dental}', '${input.clientId}', '${input.serviceId ?? service}', '${input.professionalId}', '${input.date}',
             '${input.start}', '${input.end}', '${input.status}', 20, 'dashboard')
     returning id`,
  ).split("\n")[0];
const day = (offset: number) => addDaysISO(today, offset);

const ana = patient("Ana Cierre");
const bruno = patient("Bruno Cierre");
const carla = patient("Carla Cierre");
const diego = patient("Diego Cierre");
const ernesto = patient("Ernesto Cierre");

// Las de días anteriores (por cerrar) de las tres agendas…
const a1 = appointment({ professionalId: ricardoAgenda, clientId: ana.id, date: day(-40), start: "19:00", end: "19:30", status: "confirmed" });
const a2 = appointment({ professionalId: valeriaAgenda, clientId: bruno.id, date: day(-3), start: "19:00", end: "19:30", status: "pending" });
const a3 = appointment({ professionalId: andresAgenda, clientId: carla.id, date: day(-1), start: "19:00", end: "19:30", status: "confirmed" });
const a4 = appointment({ professionalId: valeriaAgenda, clientId: ana.id, date: day(-1), start: "20:00", end: "20:30", status: "confirmed" });
// …una de ellas con dos pacientes (citas con varios pacientes: se cierra la cita entera)…
sql(`update businesses set multi_client_appointments = true where id = '${dental}'`);
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${a4}', '${diego.id}', '${dental}')`);
// …una de hoy que ya terminó (sólo si ya pasaron las 00:05: si no, no hay ninguna de hoy terminada)…
const todayEnded = nowMinutes >= 10;
const a5 = todayEnded ? appointment({ professionalId: ricardoAgenda, clientId: ernesto.id, date: today, start: "00:00", end: "00:05", status: "confirmed" }) : null;
// …y las que no están por cerrar: ya cerradas, de hoy sin terminar, de mañana y de otro negocio.
const closedDone = appointment({ professionalId: valeriaAgenda, clientId: bruno.id, date: day(-2), start: "19:00", end: "19:30", status: "completed" });
const closedCancelled = appointment({ professionalId: ricardoAgenda, clientId: bruno.id, date: day(-2), start: "21:00", end: "21:30", status: "cancelled" });
const closedNoShow = appointment({ professionalId: andresAgenda, clientId: bruno.id, date: day(-2), start: "21:00", end: "21:30", status: "no_show" });
const laterToday = nowMinutes < 23 * 60 + 50
  ? appointment({ professionalId: ricardoAgenda, clientId: ernesto.id, date: today, start: "23:55", end: "23:59", status: "pending" })
  : null;
const tomorrow = appointment({ professionalId: ricardoAgenda, clientId: ernesto.id, date: day(1), start: "19:00", end: "19:30", status: "pending" });
const laura = await as("laura@demo.com");
const salon: string = laura.session.businessId;
const salonAgenda = sql(`select id from professionals where business_id = '${salon}' order by created_at limit 1`);
const salonService = sql(`select id from services where business_id = '${salon}' order by created_at limit 1`);
const salonClient = patient("Fernanda Otronegocio", salon);
const otherBusiness = appointment({
  businessId: salon,
  professionalId: salonAgenda,
  clientId: salonClient.id,
  serviceId: salonService,
  date: day(-1),
  start: "21:00",
  end: "21:30",
  status: "confirmed",
});

const expectedAll = [a1, a2, a3, a4, ...(a5 ? [a5] : [])];
const ids = (list: AppointmentToClose[]) => list.map((item) => item.id);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
const listOf = async (browser: Browser, cursor?: string, businessId = dental) => {
  const r = await browser("GET", `/businesses/${businessId}/appointments/to-close${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return { status: r.status, body: r.body as AppointmentsToClose };
};
const countOf = async (browser: Browser) => {
  const r = await browser("GET", `${B}/appointments/to-close/count`);
  return { status: r.status, body: r.body as AppointmentsToCloseCount };
};
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

/* ======================================================================================== */
console.log("\nLa lista y las cifras de cada rol");
let list = await listOf(ricardo);
ok(list.status === 200, "el propietario recibe la lista", list.body);
ok(same(ids(list.body.appointments), expectedAll), "de la más vieja a la más nueva: primero las de días anteriores y después la de hoy", {
  got: ids(list.body.appointments),
  expectedAll,
});
ok(
  list.body.overdue === 4 && list.body.today === (a5 ? 1 : 0) && list.body.nextCursor === null,
  `las cifras: 4 de días anteriores y ${a5 ? 1 : 0} de hoy, sin más tandas`,
  { overdue: list.body.overdue, today: list.body.today, nextCursor: list.body.nextCursor },
);
const excluded = [closedDone, closedCancelled, closedNoShow, tomorrow, otherBusiness, ...(laterToday ? [laterToday] : [])];
ok(!list.body.appointments.some((item) => excluded.includes(item.id)), "sin las ya cerradas (Completada, Cancelada, No asistió), ni las que no terminaron, ni las de otro negocio");
const row4 = list.body.appointments.find((item) => item.id === a4);
ok(
  row4?.date === day(-1) &&
    row4.startTime === "20:00" &&
    row4.endTime === "20:30" &&
    row4.status === "confirmed" &&
    row4.serviceName === "Consulta odontológica" &&
    row4.professionalName === "Dra. Valeria Cruz" &&
    row4.professionalId === valeriaAgenda &&
    row4.clientNames.join() === "Ana Cierre,Diego Cierre" &&
    row4.overdue === true,
  "cada fila trae el día, la hora, los pacientes (el principal primero), el servicio y el profesional",
  row4,
);
const row5 = a5 ? list.body.appointments.find((item) => item.id === a5) : null;
if (a5) ok(row5?.overdue === false, "la de hoy que ya terminó sale, marcada como de hoy (no bloquea)", row5);
else console.log("  · (son las 00:0x: todavía no hay ninguna cita de hoy terminada)");

let counted = await countOf(ricardo);
ok(counted.status === 200 && counted.body.overdue === 4 && counted.body.today === (a5 ? 1 : 0), "el contador del panel da lo mismo", counted.body);
ok(Object.keys(counted.body).sort().join() === "overdue,previousMonth,today", "y sólo trae las tres cifras, sin nombres (la del mes anterior, spec 021)", counted.body);

const elenaList = await listOf(elena);
ok(same(ids(elenaList.body.appointments), expectedAll), "Recepción ve las de todo el negocio (también las de la agenda sin usuario)", ids(elenaList.body.appointments));
const supportCount = await countOf(admin);
ok(supportCount.status === 200 && supportCount.body.overdue === 4, "el super admin en modo soporte también ve la cifra del negocio", supportCount.body);

const valeriaList = await listOf(valeria);
ok(
  same(ids(valeriaList.body.appointments), [a2, a4]) && valeriaList.body.overdue === 2 && valeriaList.body.today === 0,
  "el rol Profesional sólo ve las de su agenda: 2 de días anteriores",
  { ids: ids(valeriaList.body.appointments), overdue: valeriaList.body.overdue, today: valeriaList.body.today },
);
counted = await countOf(valeria);
ok(counted.body.overdue === 2 && counted.body.today === 0, "y su contador, también", counted.body);

// Una profesional sin agenda asignada: no tiene nada que cerrar (403, como el resto de su panel).
sql(
  `insert into users (first_name, last_name, email, password_hash)
   select 'Paula', 'Sinagenda', 'paula.${tag}@demo.com', password_hash from users where email = 'valeria@demo.com'`,
);
sql(`insert into business_users (business_id, user_id, role) select '${dental}', id, 'professional' from users where email = 'paula.${tag}@demo.com'`);
const paula = await as(`paula.${tag}@demo.com`);
counted = await countOf(paula);
ok(counted.status === 403 && /agenda asignada/.test((counted.body as unknown as { error: { message: string } }).error.message), "una profesional sin agenda: 403 («no tiene una agenda asignada»)", counted.body);

const otherList = await valeria("GET", `/businesses/${salon}/appointments/to-close/count`);
ok(otherList.status === 403, "nadie ve las de otro negocio (403)", otherList.body);
const badCursor = await ricardo("GET", `${B}/appointments/to-close?cursor=no-vale`);
ok(badCursor.status === 400 && badCursor.body.error.code === "validation", "un cursor que no vale: error de validación", badCursor.body);
const byIdStill = await ricardo("GET", `${B}/appointments/${a1}`);
ok(byIdStill.status === 200 && byIdStill.body?.id === a1, "la ruta de una cita (/appointments/:id) sigue igual", byIdStill.status);

/* ======================================================================================== */
console.log("\nEn tandas de 50");
const extra: string[] = [];
for (let i = 0; i < 55; i++) {
  extra.push(appointment({ professionalId: andresAgenda, clientId: carla.id, date: day(-100 + i), start: "19:00", end: "19:15", status: "pending" }));
}
const first = await listOf(ricardo);
const second = first.body.nextCursor ? await listOf(ricardo, first.body.nextCursor) : null;
const paged = [...first.body.appointments, ...(second?.body.appointments ?? [])];
ok(
  first.body.appointments.length === TO_CLOSE_PAGE_SIZE && Boolean(first.body.nextCursor) && second?.body.nextCursor === null,
  `la primera tanda trae ${TO_CLOSE_PAGE_SIZE} y un cursor; la segunda, el resto y ninguno`,
  { first: first.body.appointments.length, cursor: first.body.nextCursor, second: second?.body.appointments.length },
);
ok(
  same(ids(paged), [...extra, ...expectedAll]) && new Set(ids(paged)).size === paged.length,
  "entre las dos, todas, en orden y sin repetir",
  ids(paged).length,
);
ok(first.body.overdue === 59 && second?.body.overdue === 59, "las cifras son de toda la lista en cada tanda (59 de días anteriores)", first.body.overdue);

const bulk = await ricardo("POST", `${B}/appointments/close-all`, { status: "completed", ids: ids(first.body.appointments) });
ok(
  bulk.status === 200 && (bulk.body as CloseAllResult).closed === TO_CLOSE_PAGE_SIZE && (bulk.body as CloseAllResult).skipped === 0,
  `«Marcar todas como completadas» con la primera tanda: cierra las ${TO_CLOSE_PAGE_SIZE} de una vez`,
  bulk.body,
);
const rest = await listOf(ricardo);
ok(same(ids(rest.body.appointments), [...extra.slice(TO_CLOSE_PAGE_SIZE), ...expectedAll]) && rest.body.overdue === 9, "la lista sigue con las demás (9 de días anteriores)", ids(rest.body.appointments).length);
const restBulk = await ricardo("POST", `${B}/appointments/close-all`, { status: "completed", ids: extra.slice(TO_CLOSE_PAGE_SIZE) });
ok(restBulk.status === 200 && restBulk.body.closed === 5, "y otra vez con las que quedaban de esas 55", restBulk.body);
ok(
  count(`select count(*) from appointments where id = any('{${extra.join(",")}}'::uuid[]) and status = 'completed'`) === 55 &&
    count(
      `select count(*) from audit_logs where entity_id = any('{${extra.join(",")}}'::uuid[]) and action = 'appointment.completed'
          and created_at >= '${startedAt}'`,
    ) === 55,
  "las 55 quedan completadas, cada una con su entrada en la actividad",
);
ok(count(`select count(*) from notifications where appointment_id = any('{${extra.join(",")}}'::uuid[])`) === 0, "sin «Avisar a los pacientes», ningún email en la cola");

/* ======================================================================================== */
console.log("\n«Marcar todas» sólo cierra las de su alcance que siguen sin cerrar");
let r = await valeria("POST", `${B}/appointments/close-all`, { status: "completed", ids: [a4, a1, a3, closedDone, tomorrow] });
ok(r.status === 200 && r.body.closed === 1 && r.body.skipped === 4, "Valeria manda cinco: se cierra sólo la de su agenda que seguía sin cerrar", r.body);
ok(statusOf(a4) === "completed", "la cita de dos pacientes queda completada entera");
ok(
  statusOf(a1) === "confirmed" && statusOf(a3) === "confirmed" && statusOf(closedDone) === "completed" && statusOf(tomorrow) === "pending",
  "las de otras agendas, la ya cerrada y la que no terminó (de mañana) no cambian: nada se cierra solo",
);
const audit4 = auditOf(a4);
ok(
  audit4.length === 1 &&
    audit4[0] === "appointment.completed|Marcó como completada la cita de Ana Cierre y Diego Cierre (" +
      `${day(-1).split("-").reverse().join("/")} 20:00) (sin avisar al paciente)`,
  "una entrada en la actividad, como un cambio de estado normal (y dice que fue sin avisar al paciente)",
  audit4,
);
const change4 = sql(
  `select ch->>'before' || '→' || (ch->>'after') from audit_logs l, jsonb_array_elements(l.changes) ch
    where l.entity_id = '${a4}' and ch->>'label' = 'Estado' and l.created_at >= '${startedAt}'`,
);
ok(change4 === "Confirmada→Completada", "con «Estado: Confirmada → Completada» en los cambios (lo que leen ntfy y la actividad)", change4);
ok(emailsOf(a4) === 0, "sin la casilla, ningún email en la cola (ni a los pacientes ni la copia al profesional)");
counted = await countOf(valeria);
ok(counted.body.overdue === 1, "a Valeria le queda una", counted.body);

/* ======================================================================================== */
console.log("\nUna por una, desde la lista");
r = await valeria("PATCH", `${B}/appointments/${a2}/status`, { status: "no_show", notify: false, onlyIfOpen: true });
ok(r.status === 200 && r.body.status === "no_show", "Valeria marca «No asistió» (con la ruta de siempre)", r.body);
ok(emailsOf(a2) === 0 && auditOf(a2).length === 1 && auditOf(a2)[0].startsWith("appointment.no_show|"), "en la actividad y sin emails");
const activity = (await ricardo("GET", `${B}/clients/activity`)).body as { clientId: string; noShow: number }[];
ok(activity.find((item) => item.clientId === bruno.id)?.noShow === 2, "«No asistió» suma a las inasistencias del paciente (ya tenía una)", activity.find((item) => item.clientId === bruno.id));
r = await ricardo("PATCH", `${B}/appointments/${a2}/status`, { status: "completed", notify: false, onlyIfOpen: true });
ok(
  r.status === 409 && /Alguien ya cerró esta cita: está «No asistió»/.test(r.body.error.message) && statusOf(a2) === "no_show",
  "el propietario, con la lista vieja, la quiere cerrar otra vez: se respeta el estado que ya tiene (409)",
  r.body,
);
ok(auditOf(a2).length === 1, "y no queda otra entrada en la actividad");
counted = await countOf(valeria);
ok(counted.body.overdue === 0 && counted.body.today === 0, "Valeria queda al día", counted.body);

/* ======================================================================================== */
console.log("\nUna cita cerrada a la vez por dos personas");
const [together, single] = await Promise.all([
  ricardo("POST", `${B}/appointments/close-all`, { status: "completed", ids: [a1, a3] }),
  elena("PATCH", `${B}/appointments/${a3}/status`, { status: "cancelled", notify: false, onlyIfOpen: true }),
]);
const closedByElena = single.status === 200;
ok(
  together.status === 200 &&
    (closedByElena
      ? together.body.closed === 1 && together.body.skipped === 1 && statusOf(a3) === "cancelled"
      : single.status === 409 && together.body.closed === 2 && statusOf(a3) === "completed"),
  `van una detrás de otra: ${closedByElena ? "Elena la canceló primero y «Marcar todas» la saltó" : "«Marcar todas» la cerró primero y Elena recibe 409"}`,
  { together: together.body, single: single.status },
);
ok(auditOf(a3).length === 1, "una sola entrada en la actividad para esa cita", auditOf(a3));
ok(statusOf(a1) === "completed", "la otra cita de «Marcar todas» también queda completada");

/* ======================================================================================== */
console.log("\nCon «Avisar a los pacientes»");
const gaby = patient("Gabriela Aviso");
const a6 = appointment({ professionalId: ricardoAgenda, clientId: gaby.id, date: day(-1), start: "21:00", end: "21:30", status: "confirmed" });
r = await ricardo("POST", `${B}/appointments/close-all`, { status: "completed", notify: true, ids: [a6] });
const emails6 = sql(`select string_agg(type || '→' || to_email, ',' order by created_at, id) from notifications where appointment_id = '${a6}'`);
ok(r.status === 200 && r.body.closed === 1, "el propietario la marca con la casilla", r.body);
ok(emails6.split(",").includes(`appointment_completed→${gaby.email}`), "le escribe a la paciente (el email de la spec 008, que entra en el cupo de Gmail al enviarse)", emails6);
ok(!auditOf(a6)[0]?.endsWith("(sin avisar al paciente)"), "y la actividad no dice «sin avisar al paciente»", auditOf(a6));

/* ======================================================================================== */
console.log("\nLo que no se puede");
const bad = async (body: unknown, label: string) => {
  const reply = await ricardo("POST", `${B}/appointments/close-all`, body);
  ok(reply.status === 400 && reply.body.error.code === "validation", label, reply.body);
};
await bad({ status: "no_show", ids: [a5 ?? a1] }, "todas juntas sólo como «Completada»");
await bad({ status: "completed", ids: [] }, "sin citas");
await bad({ status: "completed", ids: ["no-es-un-id"] }, "con un id que no vale");
await bad({ status: "completed", ids: [a1, a1] }, "con una cita repetida");
await bad(
  { status: "completed", ids: Array.from({ length: CLOSE_ALL_MAX + 1 }, () => crypto.randomUUID()) },
  `con más de ${CLOSE_ALL_MAX} a la vez`,
);
r = await valeria("POST", `/businesses/${salon}/appointments/close-all`, { status: "completed", ids: [otherBusiness] });
ok(r.status === 403 && statusOf(otherBusiness) === "confirmed", "ni las de otro negocio (403)", r.body);
r = await laura("POST", `/businesses/${salon}/appointments/close-all`, { status: "completed", ids: [a5 ?? a1] });
ok(r.status === 200 && r.body.closed === 0 && r.body.skipped === 1, "ni con el id de una cita de otro negocio desde el suyo", r.body);

/* ======================================================================================== */
console.log("\nTodo al día");
if (a5) {
  r = await ricardo("PATCH", `${B}/appointments/${a5}/status`, { status: "completed", notify: false, onlyIfOpen: true });
  ok(r.status === 200, "cierra la de hoy", r.body);
}
list = await listOf(ricardo);
ok(list.body.appointments.length === 0 && list.body.overdue === 0 && list.body.today === 0, "la lista queda vacía y el contador en 0", list.body);
ok(statusOf(tomorrow) === "pending" && (!laterToday || statusOf(laterToday) === "pending"), "las que no terminaron siguen como estaban");
ok(statusOf(otherBusiness) === "confirmed", "y la del otro negocio, también");

/* ======================================================================================== */
console.log("\nLas de un mes anterior (spec 021)");
// El primer día del mes de hoy, en la zona del negocio. La del último día del mes pasado cuenta siempre; la del
// día 1 de este mes, nunca (aunque hoy sea el 1: entonces es de hoy).
const monthStart = sql(`select date_trunc('month', now() at time zone '${zone}')::date`);
const lastOfPrevious = addDaysISO(monthStart, -1);
const m1 = appointment({ professionalId: ricardoAgenda, clientId: ana.id, date: lastOfPrevious, start: "22:00", end: "22:30", status: "confirmed" });
const m2 = appointment({ professionalId: valeriaAgenda, clientId: bruno.id, date: addDaysISO(monthStart, -20), start: "22:00", end: "22:30", status: "pending" });
const m3 = appointment({ professionalId: andresAgenda, clientId: carla.id, date: monthStart, start: "00:00", end: "00:05", status: "confirmed" });
const m3Overdue = monthStart < today;
const m3Listed = m3Overdue || nowMinutes >= 10;
counted = await countOf(ricardo);
ok(
  counted.body.previousMonth === 2 && counted.body.overdue === 2 + (m3Overdue ? 1 : 0) && counted.body.today === (m3Listed && !m3Overdue ? 1 : 0),
  `el propietario: 2 de un mes anterior (la del ${lastOfPrevious} cuenta; la del ${monthStart}, no)`,
  counted.body,
);
list = await listOf(ricardo);
const flags = new Map(list.body.appointments.map((item) => [item.id, item.previousMonth]));
ok(
  flags.get(m1) === true && flags.get(m2) === true && (!m3Listed || flags.get(m3) === false) && list.body.previousMonth === 2,
  "cada fila dice si es de un mes anterior, y las de meses anteriores van primero",
  [...flags],
);
ok(list.body.appointments[0]?.id === m2 && list.body.appointments[1]?.id === m1, "de la más vieja a la más nueva", ids(list.body.appointments));
counted = await countOf(valeria);
ok(counted.body.previousMonth === 1 && counted.body.overdue === 1, "el rol Profesional, sólo la de su agenda", counted.body);
counted = await countOf(elena);
ok(counted.body.previousMonth === 2, "Recepción, las del negocio", counted.body);
counted = await countOf(admin);
ok(counted.body.previousMonth === 2, "el super admin en modo soporte, también (el front no lo bloquea: sólo la franja)", counted.body);
r = await ricardo("POST", `${B}/appointments/close-all`, { status: "completed", ids: [m1, m2, m3] });
counted = await countOf(ricardo);
ok(r.status === 200 && counted.body.previousMonth === 0 && counted.body.overdue === 0 && counted.body.today === 0, "al cerrarlas, vuelve a 0", [r.body, counted.body]);

/* ======================================================================================== */
console.log("\nLa zona horaria del negocio");
// El salón de Laura pasa a Kiritimati (UTC+14): «hoy» y «ayer» son los de allí, no los del servidor.
const KIRI = "Pacific/Kiritimati";
sql(`update businesses set timezone = '${KIRI}' where id = '${salon}'`);
const kiriToday = sql(`select (now() at time zone '${KIRI}')::date`);
const kiriMinutes = Number(sql(`select extract(hour from now() at time zone '${KIRI}') * 60 + extract(minute from now() at time zone '${KIRI}')`));
sql(`update appointments set status = 'completed' where business_id = '${salon}' and status in ('pending', 'confirmed') and date <= '${addDaysISO(kiriToday, 1)}'`);
const k1 = appointment({ businessId: salon, professionalId: salonAgenda, clientId: salonClient.id, serviceId: salonService, date: addDaysISO(kiriToday, -1), start: "23:00", end: "23:30", status: "confirmed" });
const k2 = kiriMinutes >= 10
  ? appointment({ businessId: salon, professionalId: salonAgenda, clientId: salonClient.id, serviceId: salonService, date: kiriToday, start: "00:00", end: "00:05", status: "pending" })
  : null;
const k3 = kiriMinutes < 23 * 60 + 50
  ? appointment({ businessId: salon, professionalId: salonAgenda, clientId: salonClient.id, serviceId: salonService, date: kiriToday, start: "23:55", end: "23:59", status: "pending" })
  : null;
const kiri = await listOf(laura, undefined, salon);
const kiriRows = new Map(kiri.body.appointments.map((item) => [item.id, item]));
ok(kiriRows.get(k1)?.overdue === true, `la de ayer en Kiritimati (${addDaysISO(kiriToday, -1)} 23:00) es de un día anterior`, kiri.body);
if (k2) ok(kiriRows.get(k2)?.overdue === false && kiri.body.today === 1, `la de hoy en Kiritimati a las 00:00 ya terminó y es de hoy (${kiriToday})`, kiri.body);
if (k3) ok(!kiriRows.has(k3), "la de hoy a las 23:55 todavía no terminó allí: no sale");
ok(kiri.body.overdue === 1 && kiri.body.appointments.length === 1 + (k2 ? 1 : 0), "las cifras, con el «hoy» de Kiritimati", { overdue: kiri.body.overdue, today: kiri.body.today });
console.log(`  · hoy: ${today} en ${zone} y ${kiriToday} en ${KIRI}`);

// El mes anterior, en la zona del negocio y a una hora fija (sin depender del día en que corre la prueba): el
// último día de un mes, a las 19:00 UTC, en Kiritimati ya es el día 1 del siguiente (09:00) y en Guayaquil
// sigue siendo ese día (14:00).
const { countToClose } = await import("../src/services/appointments-to-close.ts");
const { pool } = await import("../src/db/pool.ts");
const lastDay = sql("select to_char(date_trunc('month', current_date + 400) + interval '1 month - 1 day', 'YYYY-MM-DD')");
const firstDay = addDaysISO(lastDay, 1);
const at = `${lastDay}T19:00:00Z`;
sql(`update appointments set status = 'completed' where business_id = '${salon}' and status in ('pending', 'confirmed')`);
const salonAt = (date: string, start: string, end: string) =>
  appointment({ businessId: salon, professionalId: salonAgenda, clientId: salonClient.id, serviceId: salonService, date, start, end, status: "confirmed" });
salonAt(addDaysISO(lastDay, -10), "10:00", "10:30");
salonAt(lastDay, "08:00", "08:30");
salonAt(firstDay, "00:00", "00:05");
const inKiri = await countToClose(pool, salon, null, at);
ok(
  inKiri.previousMonth === 2 && inKiri.overdue === 2 && inKiri.today === 1,
  `en Kiritimati (ya es el ${firstDay}): las del ${addDaysISO(lastDay, -10)} y del ${lastDay} son de un mes anterior; la del día 1, de hoy`,
  inKiri,
);
sql(`update businesses set timezone = '${zone}' where id = '${salon}'`);
const inGye = await countToClose(pool, salon, null, at);
ok(
  inGye.previousMonth === 0 && inGye.overdue === 1 && inGye.today === 1,
  `en ${zone} (todavía es el ${lastDay}): ninguna es de un mes anterior; la del día 1 todavía no llega`,
  inGye,
);
const otherAgenda = await countToClose(pool, salon, crypto.randomUUID(), at);
ok(otherAgenda.previousMonth === 0 && otherAgenda.overdue === 0, "con el alcance de otra agenda, ninguna", otherAgenda);
sql(`update appointments set status = 'completed' where business_id = '${salon}' and status in ('pending', 'confirmed')`);
await pool.end();

/* ======================================================================================== */
console.log("\nConsultar no va a la actividad");
const reads = count(
  `select count(*) from audit_logs where created_at >= '${startedAt}' and business_id in ('${dental}', '${salon}')
      and action not like 'appointment.%' and action not like 'session.%'`,
);
ok(reads === 0, "la lista y el contador no dejan ninguna entrada (sólo los cierres y los inicios de sesión)", reads);

done("de las citas por cerrar");
