// «Por cobrar» (spec 046): lo que debe cada paciente son sus sesiones Completadas, con precio, sin la marca
// de pagada y atendidas desde PENDING_PAYMENTS_SINCE, sólo como paciente principal. El resumen por paciente
// y el total de Inicio dan lo mismo; «Marcar todas como pagadas» marca sólo las pedidas que siguen por cobrar,
// con una entrada en la actividad por cita. El rol Profesional ve y marca sólo lo de su agenda. Las fechas
// van fijas respecto de PENDING_PAYMENTS_SINCE (no dependen del día) y a horas de la noche, sin los datos
// demo. Datos ficticios.
import { cedulaFor } from "./helpers/cedula.mjs";
import { checks, count, login, sql } from "./helpers/harness.ts";
import { PENDING_PAYMENTS_SINCE } from "../src/shared/lib/constants/business.ts";
import { addDaysISO } from "../src/shared/lib/time.ts";
import type { ClientActivity, PendingPaymentsSummary } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipSeq = 0;
const as = (email: string) => login(email, { ip: `198.51.100.${(ipSeq++ % 250) + 1}` });
type Browser = Awaited<ReturnType<typeof as>>;

const tag = Date.now().toString(36);
const startedAt = sql("select now()");

/* ======================================================================================== */
console.log("La Clínica Dental Sonrisa: el propietario, Recepción, el rol Profesional y la dueña de otro negocio");
const ricardo = await as("ricardo@demo.com"); // propietario
const dental: string = ricardo.session.businessId;
const B = `/businesses/${dental}`;
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // propietaria de otro negocio
const agendaOf = (email: string) =>
  sql(`select id from professionals where business_id = '${dental}' and user_id = (select id from users where email = '${email}')`);
const ricardoAgenda = agendaOf("ricardo@demo.com");
const valeriaAgenda = agendaOf("valeria@demo.com");
const service = sql(`select id from services where business_id = '${dental}' and name = 'Consulta odontológica'`);
ok(Boolean(ricardoAgenda && valeriaAgenda && service), "las dos agendas y el servicio", { ricardoAgenda, valeriaAgenda, service });

let seq = 0;
const patient = (name: string) => {
  const email = `cobro.${++seq}.${tag}@example.com`;
  return sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${dental}', '${name}', '${cedulaFor(email)}', '${email}', '') returning id`,
  ).split("\n")[0];
};
let minute = 0;
/** Una cita creada directamente en la base, a una hora de la noche (no choca con los datos demo). */
const appointment = (input: { agenda: string; clientId: string; date: string; status: string; price?: number; paid?: boolean }) => {
  minute += 20;
  const start = `${String(19 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, paid_at, source)
     values ('${dental}', '${input.clientId}', '${service}', '${input.agenda}', '${input.date}',
             '${start}', '${start}'::time + interval '15 minutes', '${input.status}', ${input.price ?? 20},
             ${input.paid ? "now()" : "null"}, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
/** Un día desde la fecha en que empieza a contar (0 = ese mismo día). */
const since = (offset: number) => addDaysISO(PENDING_PAYMENTS_SINCE, offset);

const summaryOf = async (browser: Browser): Promise<PendingPaymentsSummary> =>
  (await browser("GET", `${B}/pending-payments/summary`)).body;
const activityOf = async (browser: Browser, clientId: string) => {
  const rows: ClientActivity[] = (await browser("GET", `${B}/clients/activity`)).body;
  const row = rows.find((r) => r.clientId === clientId);
  return { amount: row?.pendingAmount ?? 0, count: row?.pendingCount ?? 0 };
};
const pay = (browser: Browser, clientId: string, appointmentIds: string[]) =>
  browser("POST", `${B}/clients/${clientId}/pending-payments/pay`, { appointmentIds });
const isPaid = (id: string) => sql(`select paid_at is not null from appointments where id = '${id}'`) === "t";
const paidEntries = (id: string) =>
  count(`select count(*) from audit_logs where entity_id = '${id}' and action = 'appointment.paid' and created_at >= '${startedAt}'`);

const ownerBefore = await summaryOf(ricardo);
const valeriaBefore = await summaryOf(valeria);
ok(typeof ownerBefore.amount === "number" && typeof ownerBefore.sessions === "number", "el total de Inicio responde", ownerBefore);

/* ======================================================================================== */
console.log("\nQué cuenta y qué no");
const ana = patient("Ana Cobro");
const bruno = patient("Bruno Cobro");
const carla = patient("Carla Cobro");
const owed1 = appointment({ agenda: ricardoAgenda, clientId: ana, date: since(400), status: "completed", price: 20 });
const owed2 = appointment({ agenda: ricardoAgenda, clientId: ana, date: since(401), status: "completed", price: 30 });
const alreadyPaid = appointment({ agenda: ricardoAgenda, clientId: ana, date: since(402), status: "completed", paid: true });
appointment({ agenda: ricardoAgenda, clientId: ana, date: since(403), status: "completed", price: 0 });
const cancelled = appointment({ agenda: ricardoAgenda, clientId: ana, date: since(404), status: "cancelled" });
appointment({ agenda: ricardoAgenda, clientId: ana, date: since(405), status: "no_show" });
appointment({ agenda: ricardoAgenda, clientId: ana, date: since(406), status: "confirmed" });
appointment({ agenda: ricardoAgenda, clientId: ana, date: since(407), status: "confirmed", paid: true });
appointment({ agenda: ricardoAgenda, clientId: ana, date: since(-1), status: "completed", price: 50 });
// Una sesión en pareja: cuenta sólo para Ana, la principal, que es quien paga.
const couple = appointment({ agenda: ricardoAgenda, clientId: ana, date: since(408), status: "completed", price: 40 });
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${couple}', '${bruno}', '${dental}')`);
// Carla tiene una sesión en cada agenda.
const carlaValeria = appointment({ agenda: valeriaAgenda, clientId: carla, date: since(400), status: "completed", price: 25 });
const carlaRicardo = appointment({ agenda: ricardoAgenda, clientId: carla, date: since(409), status: "completed", price: 15 });

let a = await activityOf(ricardo, ana);
ok(a.amount === 90 && a.count === 3, "Ana debe 3 sesiones, $90: dos sueltas y la de pareja (no cuentan la pagada, la gratis, la cancelada, «No asistió», las confirmadas ni la anterior a la fecha de inicio)", a);
a = await activityOf(ricardo, bruno);
ok(a.amount === 0 && a.count === 0, "Bruno, el otro de la pareja, no debe nada", a);
a = await activityOf(ricardo, carla);
ok(a.amount === 40 && a.count === 2, "Carla debe $40 entre las dos agendas", a);

const ownerAfter = await summaryOf(ricardo);
ok(
  ownerAfter.amount - ownerBefore.amount === 130 && ownerAfter.sessions - ownerBefore.sessions === 5 && ownerAfter.clients - ownerBefore.clients === 2,
  "el total de Inicio suma $130, 5 sesiones y 2 pacientes más",
  { ownerBefore, ownerAfter },
);
const allRows: ClientActivity[] = (await ricardo("GET", `${B}/clients/activity`)).body;
const activityTotal = allRows.reduce((sum, r) => sum + r.pendingAmount, 0);
const activitySessions = allRows.reduce((sum, r) => sum + r.pendingCount, 0);
ok(
  activityTotal === ownerAfter.amount && activitySessions === ownerAfter.sessions,
  "el resumen por paciente y el total de Inicio dan lo mismo",
  { activityTotal, activitySessions, ownerAfter },
);
const elenaSummary = await summaryOf(elena);
ok(elenaSummary.amount === ownerAfter.amount, "Recepción ve el mismo total que el propietario", elenaSummary);

console.log("\nEl rol Profesional, sólo su agenda");
a = await activityOf(valeria, carla);
ok(a.amount === 25 && a.count === 1, "Valeria ve sólo los $25 de Carla en su agenda", a);
const valeriaAfter = await summaryOf(valeria);
ok(
  valeriaAfter.amount - valeriaBefore.amount === 25 && valeriaAfter.sessions - valeriaBefore.sessions === 1,
  "su total de Inicio suma sólo esa sesión",
  { valeriaBefore, valeriaAfter },
);

/* ======================================================================================== */
console.log("\nMarcar todas como pagadas");
let r = await pay(elena, ana, [owed1, owed2, alreadyPaid, cancelled, carlaRicardo]);
ok(r.status === 200 && r.body.paid === 2, "Recepción marca las dos de Ana que seguían por cobrar", r.body);
ok(isPaid(owed1) && isPaid(owed2), "quedan pagadas");
ok(!isPaid(cancelled) && !isPaid(carlaRicardo), "no toca la cancelada ni la de otro paciente");
ok(paidEntries(owed1) === 1 && paidEntries(owed2) === 1, "una entrada en la actividad por cita");
ok(paidEntries(alreadyPaid) === 0, "la que ya estaba pagada no deja otra entrada");
a = await activityOf(ricardo, ana);
ok(a.amount === 40 && a.count === 1, "a Ana le queda la de pareja", a);

r = await pay(valeria, carla, [carlaValeria, carlaRicardo]);
ok(r.status === 200 && r.body.paid === 1, "Valeria marca sólo la de su agenda", r.body);
ok(isPaid(carlaValeria) && !isPaid(carlaRicardo), "la de la otra agenda sigue por cobrar");

r = await pay(laura, ana, [couple]);
ok(r.status === 403 && !isPaid(couple), "la dueña de otro negocio recibe 403", r.status);
r = await pay(ricardo, ana, []);
ok(r.status === 400, "sin sesiones, un error de validación", r.status);
r = await pay(ricardo, ana, Array.from({ length: 101 }, () => couple));
ok(r.status === 400, "más de 100 sesiones, un error de validación", r.status);
r = await pay(ricardo, ana, ["no-es-un-id"]);
ok(r.status === 400, "un id que no es de una cita, un error de validación", r.status);

r = await pay(ricardo, ana, [couple]);
ok(r.status === 200 && r.body.paid === 1, "el propietario marca la de pareja", r.body);
a = await activityOf(ricardo, ana);
ok(a.amount === 0 && a.count === 0, "Ana ya no debe nada", a);
const ownerEnd = await summaryOf(ricardo);
ok(ownerEnd.amount - ownerBefore.amount === 15 && ownerEnd.clients - ownerBefore.clients === 1, "en el total sólo queda la sesión de Carla con Ricardo", {
  ownerBefore,
  ownerEnd,
});

done("de lo que debe cada paciente");
