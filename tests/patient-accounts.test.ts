// La cuenta del paciente y «Escanear» (spec 052): crear la cuenta (el teléfono en un solo formato), entrar y salir, el
// límite de intentos por teléfono, la sesión aparte de la del equipo (prueba 16), una cuenta nueva con el teléfono de
// otro no ve nada, la unión sólo por escaneo y dentro de las citas que el usuario puede ver, el marcado con el QR (con
// su sello), el QR nuevo invalida el anterior, el enlace de contraseña del consultorio (un uso, el aviso, la
// actividad), eliminar la cuenta, y las redes del negocio en Configuración y en la página de reservas.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import type { Business, PatientAccount, PatientCard, PatientResetLink, PublicBusinessProfile, ScanResult } from "../src/shared/types/index.ts";

const { ok, done } = checks();

let ipSeq = 0;
const nextIp = () => `198.53.0.${(ipSeq++ % 250) + 1}`;
const as = (email: string) => login(email, { ip: nextIp() });
const browser = () => agent({ ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // otro negocio
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const slug = sql(`select slug from businesses where id = '${businessId}'`);
const zone = sql(`select timezone from businesses where id = '${businessId}'`);
const T = sql(`select (now() at time zone '${zone}')::date`);
const agendaOf = (email: string) =>
  sql(`select id from professionals where business_id = '${businessId}' and user_id = (select id from users where email = '${email}')`);
const ricardoAgenda = agendaOf("ricardo@demo.com");
const valeriaAgenda = agendaOf("valeria@demo.com");
const serviceId = sql(`select id from services where business_id = '${businessId}' and is_active order by created_at limit 1`);
const tag = Date.now().toString(36);
const phoneDigits = `99${String(Date.now()).slice(-7)}`;

let seq = 0;
const patient = (name: string, phone: string) =>
  sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${businessId}', '${name}', '${cedulaFor(`cta-${tag}-${++seq}`)}', 'cta.${seq}.${tag}@correo.ec', '${phone}') returning id`,
  ).split("\n")[0];
/** Los minutos desde la medianoche, en la zona del negocio. */
const nowMinutes = () => Number(sql(`select extract(hour from now() at time zone '${zone}') * 60 + extract(minute from now() at time zone '${zone}')`));
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
let slot = 0;
/**
 * Una cita de hoy que ya empezó (desde la madrugada: al escanear, se marca sola, sin depender de la hora a la que se
 * corre la prueba). Cada una en su hora libre: si choca con otra de esa agenda, prueba la siguiente.
 */
const today = (clientId: string, agenda = ricardoAgenda, status = "confirmed") => {
  const last = Math.min(nowMinutes() + 55, 23 * 60 + 50);
  for (; slot * 5 <= last; slot++) {
    const start = hhmm(slot * 5);
    const id = sql(
      `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
       values ('${businessId}', '${clientId}', '${serviceId}', '${agenda}', '${T}', '${start}', '${start}'::time + interval '4 minutes', '${status}', 30, 'dashboard')
       on conflict do nothing returning id`,
    ).split("\n")[0];
    if (id) {
      slot++;
      return id;
    }
  }
  throw new Error("No quedó una hora libre para la cita de prueba");
};
// La tarjeta sólo en los negocios que habilita el super admin (migración 060): sin habilitar, ni «Escanear» ni la
// invitación del QR; aquí se habilita en los dos negocios de la prueba.
console.log("Sin la tarjeta habilitada (migración 060)");
ok((await ricardo("POST", `${B}/scan`, { token: "0".repeat(32) })).status === 403, "«Escanear» no responde");
ok((await browser()("GET", `/patient/invite/${slug}`)).status === 404, "ni la invitación de su QR");
const admin = await as("admin@demo.com");
for (const id of [businessId, laura.session.businessId]) {
  if ((await admin("PUT", `/admin/businesses/${id}/loyalty-allowed`, { enabled: true })).status !== 200) throw new Error("No se pudo habilitar la tarjeta");
}
const auditCount = (action: string) => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = '${action}'`);

/* ======================================================================================== */
console.log("La cuenta");
const maria = browser();
let r = await maria("POST", "/patient/signup", { name: "María Paciente", phone: `0${phoneDigits}`, password: "secreta123" });
const account = r.body as PatientAccount;
ok(r.status === 200 && account.phone === `+593${phoneDigits}` && /^[0-9a-f]{32}$/.test(account.qrToken), "crea la cuenta con su teléfono (guardado como +593…)", r.body);
ok(/agenda360_patient=/.test(maria.cookie()) && !/agendo_session/.test(maria.cookie()), "con su propia cookie, no la del equipo");
r = await browser()("POST", "/patient/signup", { name: "Otra", phone: `+593 ${phoneDigits.slice(0, 2)} ${phoneDigits.slice(2)}`, password: "otra12345" });
ok(r.status === 409, "el mismo teléfono escrito de otra forma: ya hay cuenta", r.status);
r = await browser()("POST", "/patient/signup", { name: "Otra", phone: `+593 0${phoneDigits}`, password: "otra12345" });
ok(r.status === 409, "también con el 0 después del +593 (revisión)", r.status);
ok((await browser()("POST", "/patient/signup", { name: "Corto", phone: "123", password: "secreta123" })).status === 400, "un teléfono que no es, rechazado");
ok((await browser()("POST", "/patient/signup", { name: "Corta", phone: "0987654321", password: "123" })).status === 400, "una contraseña de menos de 4, también");
ok((await browser()("POST", "/patient/signup", { name: "Común", phone: "0987654322", password: "12345678" })).status === 400, "y una de las más comunes (revisión de seguridad)");
ok(((await maria("GET", "/patient/cards")).body as PatientCard[]).length === 0, "sin escanear, no ve ninguna tarjeta");
ok((await maria("POST", "/patient/logout")).status === 204 && (await maria("GET", "/patient/me")).status === 401, "sale, y ya no entra sin sesión");
ok((await maria("POST", "/patient/login", { phone: `0${phoneDigits}`, password: "mala-clave" })).status === 401, "con otra contraseña, no entra");
r = await maria("POST", "/patient/login", { phone: `+593${phoneDigits}`, password: "secreta123" });
ok(r.status === 200 && (r.body as PatientAccount).id === account.id, "entra con su teléfono y su contraseña", r.body);

console.log("\nLa sesión del paciente va aparte (prueba 16)");
ok((await maria("GET", `${B}/clients`)).status === 401, "una sesión de paciente no entra al panel");
ok((await maria("GET", "/auth/session")).body?.user == null, "ni es una sesión del equipo");
ok((await ricardo("GET", "/patient/me")).status === 401, "y la del equipo no sirve en /patient");

console.log("\nUn PIN de 4 números (pedido del dueño)");
const pinPhone = `09${String(Date.now() + 3).slice(-8)}`;
for (const easy of ["1234", "0000", "1212", "1122", "9876", "1990", "2580"]) {
  ok((await browser()("POST", "/patient/signup", { name: "Pin Fácil", phone: pinPhone, password: easy })).status === 400, `un PIN fácil (${easy}), rechazado`);
}
r = await browser()("POST", "/patient/signup", { name: "Pin Bueno", phone: pinPhone, password: "4827" });
ok(r.status === 200, "un PIN de 4 números que no es de los fáciles, aceptado", r.body);
ok((await browser()("POST", "/patient/login", { phone: pinPhone, password: "4827" })).status === 200, "y entra con él");

console.log("\nEl bloqueo creciente");
const target = `09${String(Date.now()).slice(-8)}`;
await browser()("POST", "/patient/signup", { name: "Lucía Intentos", phone: target, password: "7351" });
const failKey = `paciente-fallos:+593${target.slice(1)}`;
let fail = await browser()("POST", "/patient/login", { phone: target, password: "1111" });
await browser()("POST", "/patient/login", { phone: target, password: "2222" });
fail = await browser()("POST", "/patient/login", { phone: target, password: "3333" });
ok(fail.status === 401 && /Te quedan 2 intentos/.test(fail.body?.error?.message ?? JSON.stringify(fail.body)), "al 3.er fallo avisa cuántos intentos le quedan", fail.body);
await browser()("POST", "/patient/login", { phone: target, password: "4444" });
fail = await browser()("POST", "/patient/login", { phone: target, password: "5555" });
ok(fail.status === 429 && /15 minutos/.test(JSON.stringify(fail.body)), "al 5.º fallo, 15 minutos de espera (aunque cambie de conexión)", fail.body);
ok((await browser()("POST", "/patient/login", { phone: target, password: "7351" })).status === 429, "mientras espera, ni con el PIN bueno entra");
sql(`update rate_limits set reset_at = reset_at - interval '16 minutes' where key = '${failKey}'`);
fail = await browser()("POST", "/patient/login", { phone: target, password: "6666" });
ok(fail.status === 429 && /30 minutos/.test(JSON.stringify(fail.body)), "pasados los 15 minutos, otro fallo duplica la espera", fail.body);
sql(`update rate_limits set reset_at = reset_at - interval '31 minutes' where key = '${failKey}'`);
ok((await browser()("POST", "/patient/login", { phone: target, password: "7351" })).status === 200, "después, con el PIN bueno entra");
ok(count(`select count(*) from rate_limits where key = '${failKey}'`) === 0, "y la cuenta de fallos vuelve a cero");
console.log("\nEl bloqueo no se salta con intentos a la vez (revisión de seguridad)");
const raceDigits = `9${String(Date.now() + 13).slice(-8)}`;
await browser()("POST", "/patient/signup", { name: "Rita Carrera", phone: `0${raceDigits}`, password: "7351" });
const raceKey = `paciente-fallos:+593${raceDigits}`;
const raced = await Promise.all(Array.from({ length: 8 }, (_, i) => browser()("POST", "/patient/login", { phone: `0${raceDigits}`, password: `${2000 + i * 7}x` })));
ok(
  count(`select hits from rate_limits where key = '${raceKey}'`) === 5 && raced.filter((item) => item.status === 401).length === 4,
  "8 a la vez: cuentan 5 fallos y los demás ya esperan",
  { hits: count(`select hits from rate_limits where key = '${raceKey}'`), statuses: raced.map((item) => item.status) },
);

console.log("\nCon la sesión abierta tampoco se prueba PIN tras PIN");
const lockedPhone = `9${String(Date.now() + 17).slice(-8)}`;
const session = browser();
await session("POST", "/patient/signup", { name: "Sara Sesión", phone: `0${lockedPhone}`, password: "7351" });
const tries: number[] = [];
for (let i = 0; i < 5; i++) tries.push((await session("PUT", "/patient/password", { currentPassword: `${3000 + i * 11}`, newPassword: "8264" })).status);
ok(tries.join() === "400,400,400,400,429", "cambiar la contraseña: al 5.º fallo, a esperar", tries);
ok((await session("PUT", "/patient/password", { currentPassword: "7351", newPassword: "8264" })).status === 429, "mientras espera, ni con la buena");
ok((await session("DELETE", "/patient/account", { password: "7351" })).status === 429, "ni para eliminar la cuenta");
ok((await browser()("POST", "/patient/login", { phone: `0${lockedPhone}`, password: "7351" })).status === 429, "y el mismo bloqueo vale para entrar");

const ghost = `09${String(Date.now() + 11).slice(-8)}`;
let ghostLast = 0;
for (let i = 0; i < 5; i++) ghostLast = (await browser()("POST", "/patient/login", { phone: ghost, password: `mala-${i}` })).status;
ok(ghostLast === 429, "un teléfono sin cuenta se bloquea igual (el aviso no dice si existe)", ghostLast);

/* ======================================================================================== */
console.log("\nCon el teléfono de otro no se ve nada");
const realPhone = `0${String(Date.now() + 7).slice(-9)}`;
const realClient = patient("Paciente Real", realPhone);
const impostor = browser();
await impostor("POST", "/patient/signup", { name: "Impostor", phone: realPhone, password: "secreta123" });
ok(((await impostor("GET", "/patient/cards")).body as PatientCard[]).length === 0, "una cuenta con el teléfono de un paciente no ve su ficha ni sus sellos");
ok(count(`select count(*) from loyalty_cards where client_id = '${realClient}' and patient_account_id is not null`) === 0, "ni queda unida a ella");

/* ======================================================================================== */
console.log("\n«Escanear»: unir la cuenta");
r = await ricardo("PUT", `${B}/loyalty`, { enabled: true, name: "Club Sonrisa", description: "", stampIcon: "tooth", afterLast: "keep" });
ok(r.status === 200, "con la tarjeta encendida");
const mariaClient = patient("María Paciente", `0${phoneDigits}`);
const mariaToday = today(mariaClient);
const otherClient = patient("Otro Hoy", "0990000000");
const otherToday = today(otherClient, valeriaAgenda);
r = await ricardo("POST", `${B}/scan`, { token: account.qrToken });
let scan = r.body as ScanResult;
ok(
  r.status === 200 && scan.status === "unlinked" && scan.accountName === "María Paciente" && scan.appointments.some((a) => a.id === mariaToday && a.clientId === mariaClient),
  "la primera vez: el nombre de la cuenta y las citas de hoy para elegir",
  r.body,
);
ok(
  (scan as { accountPhoneEnd?: string }).accountPhoneEnd === phoneDigits.slice(-4) &&
    scan.appointments.find((a) => a.id === mariaToday)?.phoneMatches === true &&
    scan.appointments.find((a) => a.id === otherToday)?.phoneMatches === false,
  "con los 4 últimos dígitos del teléfono y si coincide con el de cada ficha (el nombre lo escribe la cuenta)",
  scan,
);
ok(((await valeria("POST", `${B}/scan`, { token: account.qrToken })).body as ScanResult).appointments.every((a) => a.id !== mariaToday), "el Profesional ve sólo las citas de hoy de su agenda");
ok((await valeria("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: mariaToday, clientId: mariaClient })).status === 400, "y no une con una cita de otra agenda");
ok((await ricardo("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: otherToday, clientId: mariaClient })).status === 400, "ni con una cita que no es de ese paciente");
const lauraScan = (await laura("POST", `/businesses/${laura.session.businessId}/scan`, { token: account.qrToken })).body as ScanResult;
ok(lauraScan.status === "unlinked" && lauraScan.appointments.every((a) => a.clientId !== mariaClient), "otro negocio no ve nada de este (prueba 15)");
ok((await ricardo("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: null, clientId: otherClient })).status === 400, "sin cita, no la une a una ficha con otro teléfono");
r = await elena("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: mariaToday, clientId: mariaClient });
scan = r.body as ScanResult;
ok(r.status === 200 && scan.status === "linked" && scan.clientId === mariaClient, "Recepción la une a la ficha de la cita elegida", r.body);
ok(auditCount("loyalty.account_linked") === 1, "con la actividad");
const linkedEmails = (clientId: string) =>
  count(`select count(*) from notifications where type = 'loyalty_linked' and to_email = (select email from clients where id = '${clientId}')`);
ok(linkedEmails(mariaClient) === 1, "y el email «Tu cuenta quedó unida» al email de la ficha (si no fue ella, se entera)");

console.log("\nAl unir, la cita de hoy queda atendida sola (pedido del dueño)");
ok(scan.status === "linked" && scan.completedNow?.id === mariaToday, "lo dice la respuesta", scan);
ok(sql(`select status from appointments where id = '${mariaToday}'`) === "completed", "la cita pasa a Atendida");
const second = patient("María Duplicada", "0991111111");
ok(
  (await ricardo("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: today(second), clientId: second })).status === 409,
  "una cuenta, una sola ficha por negocio",
);

ok((await ricardo("POST", `${B}/scan/complete`, { token: account.qrToken, appointmentId: otherToday })).status === 400, "«Marcar como atendida» sólo con una cita de hoy de ese paciente");
ok(count(`select count(*) from loyalty_stamps where client_id = '${mariaClient}' and voided_at is null`) === 1, "y suma su sello");
ok(auditCount("loyalty.qr_completed") === 1 && count(`select count(*) from audit_logs where action = 'appointment.completed' and entity_id = '${mariaToday}'`) === 1, "en la actividad, como la ficha y con el QR");
ok((await ricardo("POST", `${B}/scan/complete`, { token: account.qrToken, appointmentId: mariaToday })).status === 409, "otra vez: ya está Atendida");
const cards = (await maria("GET", "/patient/cards")).body as PatientCard[];
const card = cards.find((item) => item.business.id === businessId);
ok(card !== undefined && card.stamps === 1 && card.program.name === "Club Sonrisa" && card.visits.length === 1 && card.slots >= 5, "el paciente ve su tarjeta con su sello", card);
ok(!JSON.stringify(cards).includes("Otro Hoy") && !JSON.stringify(cards).includes("notes"), "sin datos de otros pacientes");

console.log("\nEl QR nuevo");
r = await maria("POST", "/patient/qr");
ok(r.status === 200 && (r.body as PatientAccount).qrToken !== account.qrToken, "pide uno nuevo", r.body);
ok((await ricardo("POST", `${B}/scan`, { token: account.qrToken })).status === 404, "el anterior deja de servir");
const fresh = (r.body as PatientAccount).qrToken;
ok(((await ricardo("POST", `${B}/scan`, { token: fresh })).body as ScanResult).status === "linked", "el nuevo sigue unido a su ficha");

/* ======================================================================================== */
console.log("\nEl QR del consultorio para sus pacientes");
r = await browser()("GET", `/patient/invite/${slug}`);
ok(r.status === 200 && r.body?.programName === "Club Sonrisa" && typeof r.body?.name === "string" && "logoUrl" in r.body, "su nombre, su logo y el programa encendido", r.body);
ok(!JSON.stringify(r.body).includes("@") && Object.keys(r.body).sort().join() === "brandColors,logoUrl,name,programName", "nada más que eso", r.body);
ok((await browser()("GET", "/patient/invite/no-existe-este-consultorio")).status === 404, "un enlace que no es de nadie: 404");
ok((await browser()("GET", "/patient/invite/..%2F..%2Fadmin")).status === 404, "ni nada raro");

/* ======================================================================================== */
console.log("\nUnir por teléfono, sin cita de hoy");
const pedroDigits = `98${String(Date.now() + 5).slice(-7)}`;
const pedro = browser();
const pedroAccount = (await pedro("POST", "/patient/signup", { name: "Pedro Cuenta", phone: `0${pedroDigits}`, password: "8264" })).body as PatientAccount;
const pedroClient = patient("Pedro Ficha", `+593 ${pedroDigits.slice(0, 2)} ${pedroDigits.slice(2, 5)} ${pedroDigits.slice(5)}`);
const pedroDocument = sql(`select document_id from clients where id = '${pedroClient}'`);
r = await ricardo("POST", `${B}/scan`, { token: pedroAccount.qrToken });
scan = r.body as ScanResult;
ok(
  scan.status === "unlinked" && scan.phoneClients.length === 1 && scan.phoneClients[0].clientId === pedroClient &&
    scan.phoneClients[0].documentEnd === pedroDocument.slice(-4) && !scan.phoneClients[0].linkedToOther,
  "sale la ficha con su mismo teléfono (escrito de otra forma), con el final de su cédula",
  scan,
);
let pedroLoyalty = (await ricardo("GET", `${B}/clients/${pedroClient}/loyalty`)).body as { account: string };
ok(pedroLoyalty.account === "pending", "la ficha dice que creó su cuenta y falta escanear su QR", pedroLoyalty);
ok(
  ((await ricardo("GET", `${B}/clients/${otherClient}/loyalty`)).body as { account: string }).account === "none",
  "sin cuenta con su teléfono, «none»",
);
r = await valeria("POST", `${B}/scan`, { token: pedroAccount.qrToken });
ok(r.status === 200, "el Profesional también escanea", r.status);
r = await ricardo("POST", `${B}/scan/link`, { token: pedroAccount.qrToken, appointmentId: null, clientId: pedroClient });
scan = r.body as ScanResult;
ok(r.status === 200 && scan.status === "linked" && scan.clientId === pedroClient && scan.completedNow === null, "la une sin cita (no hay nada que marcar)", r.body);
ok(count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'loyalty.account_linked' and summary like '%mismo teléfono%'`) === 1, "con la actividad");
ok(linkedEmails(pedroClient) === 1, "y el email a su ficha");
pedroLoyalty = (await ricardo("GET", `${B}/clients/${pedroClient}/loyalty`)).body as { account: string };
ok(pedroLoyalty.account === "linked", "y la ficha la muestra unida", pedroLoyalty);
const pedroShared = patient("Hijo de Pedro", `0${pedroDigits}`);
ok(((await ricardo("GET", `${B}/clients/${pedroShared}/loyalty`)).body as { account: string }).account === "elsewhere", "otra ficha con el mismo teléfono: su cuenta está unida a otra ficha");
ok(
  (await ricardo("POST", `${B}/scan/link`, { token: pedroAccount.qrToken, appointmentId: null, clientId: pedroShared })).status === 409,
  "y no se une a las dos",
);

console.log("\nAl escanear, la única cita de hoy queda atendida");
const pedroToday = today(pedroClient);
r = await valeria("POST", `${B}/scan`, { token: pedroAccount.qrToken });
ok(
  r.status === 200 && (r.body as ScanResult).status === "linked" && (r.body as Extract<ScanResult, { status: "linked" }>).completedNow === null &&
    sql(`select status from appointments where id = '${pedroToday}'`) === "confirmed",
  "el Profesional no marca una cita de otra agenda",
  r.body,
);
r = await elena("POST", `${B}/scan`, { token: pedroAccount.qrToken });
scan = r.body as ScanResult;
ok(r.status === 200 && scan.status === "linked" && scan.completedNow?.id === pedroToday, "Recepción escanea y la marca", r.body);
ok(
  sql(`select status from appointments where id = '${pedroToday}'`) === "completed" &&
    count(`select count(*) from loyalty_stamps where client_id = '${pedroClient}' and voided_at is null`) === 1,
  "Atendida y con su sello",
);
scan = (await elena("POST", `${B}/scan`, { token: pedroAccount.qrToken })).body as ScanResult;
ok(scan.status === "linked" && scan.completedNow === null, "escanear otra vez no hace nada más", scan);
const pedroA = today(pedroClient);
const pedroB = today(pedroClient);
scan = (await elena("POST", `${B}/scan`, { token: pedroAccount.qrToken })).body as ScanResult;
ok(
  scan.status === "linked" && scan.completedNow === null &&
    sql(`select string_agg(status::text, ',' order by id) from appointments where id in ('${pedroA}', '${pedroB}')`) === "confirmed,confirmed",
  "con dos citas de hoy por atender no marca ninguna: se elige",
  scan,
);
r = await elena("POST", `${B}/scan/complete`, { token: pedroAccount.qrToken, appointmentId: pedroB });
ok(r.status === 200 && (r.body as Extract<ScanResult, { status: "linked" }>).completedNow?.id === pedroB, "y se marca la elegida", r.body);

console.log("\nNo se marcan solas: la sesión con varios pacientes ni la de más tarde");
const pedroGroup = today(pedroClient);
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${pedroGroup}', '${patient("Pareja de Pedro", "0992222222")}', '${businessId}')`);
// Una cita a más de una hora (si todavía queda día para ponerla).
let pedroLate = "";
for (let start = Math.ceil((nowMinutes() + 120) / 5) * 5; !pedroLate && start <= 23 * 60 + 50; start += 5) {
  pedroLate = sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${pedroClient}', '${serviceId}', '${ricardoAgenda}', '${T}', '${hhmm(start)}', '${hhmm(start)}'::time + interval '4 minutes', 'confirmed', 30, 'dashboard')
     on conflict do nothing returning id`,
  ).split("\n")[0];
}
scan = (await elena("POST", `${B}/scan`, { token: pedroAccount.qrToken })).body as ScanResult;
const group = scan.appointments.find((item) => item.id === pedroGroup);
ok(group?.withOthers === true && group.completesOnScan === false, "la sesión con varios pacientes no se marca sola", group);
ok(scan.status === "linked" && scan.completedNow?.id === pedroA, "marca sola la que ya empezó (la única así)", scan);
ok(sql(`select status from appointments where id = '${pedroGroup}'`) === "confirmed", "y la sesión sigue confirmada");
if (pedroLate) {
  const late = scan.appointments.find((item) => item.id === pedroLate);
  ok(late?.completesOnScan === false && sql(`select status from appointments where id = '${pedroLate}'`) === "confirmed", "ni la que empieza en más de una hora", late);
} else {
  console.log("  (ya es tarde para poner una cita a más de una hora: esa comprobación queda para el check del front)");
}

console.log("\nUna ficha inactiva no se une");
const inaDigits = `96${String(Date.now() + 21).slice(-7)}`;
const ina = (await browser()("POST", "/patient/signup", { name: "Ina Activa", phone: `0${inaDigits}`, password: "8264" })).body as PatientAccount;
const inaClient = patient("Ina Inactiva", `0${inaDigits}`);
sql(`update clients set is_active = false where id = '${inaClient}'`);
scan = (await ricardo("POST", `${B}/scan`, { token: ina.qrToken })).body as ScanResult;
ok(scan.status === "unlinked" && scan.phoneClients[0]?.isActive === false, "sale marcada como inactiva", scan);
ok((await ricardo("POST", `${B}/scan/link`, { token: ina.qrToken, appointmentId: null, clientId: inaClient })).status === 409, "y no se une hasta activarla");

console.log("\nPaciente nuevo");
const nuevaDigits = `97${String(Date.now() + 9).slice(-7)}`;
const nueva = (await browser()("POST", "/patient/signup", { name: "Nueva Cuenta", phone: `0${nuevaDigits}`, password: "5173" })).body as PatientAccount;
scan = (await elena("POST", `${B}/scan`, { token: nueva.qrToken })).body as ScanResult;
ok(scan.status === "unlinked" && scan.phoneClients.length === 0, "sin ficha con su teléfono", scan);
ok(
  (await elena("POST", `${B}/scan/new-client`, { token: nueva.qrToken, client: { name: "Nueva Paciente", documentId: "", email: "" } })).status === 400,
  "pide los datos obligatorios del negocio",
);
r = await elena("POST", `${B}/scan/new-client`, {
  token: nueva.qrToken,
  client: { name: "Nueva Paciente", documentId: cedulaFor(`cta-n-${tag}`), email: `cta.n.${tag}@correo.ec`, phone: "0999999999" },
});
scan = r.body as ScanResult;
ok(r.status === 200 && scan.status === "linked" && scan.clientName === "Nueva Paciente", "crea su ficha y une la cuenta", r.body);
const nuevaClient = scan.status === "linked" ? scan.clientId : "";
ok(sql(`select phone from clients where id = '${nuevaClient}'`) === `+593${nuevaDigits}`, "con el teléfono de la cuenta (no el que mande el panel)");
ok(
  count(`select count(*) from audit_logs where business_id = '${businessId}' and entity_id = '${nuevaClient}' and action in ('client.created', 'loyalty.account_linked')`) === 2,
  "con la actividad de la ficha y de la unión",
);
ok(linkedEmails(nuevaClient) === 1, "y el email a la ficha nueva");
ok(
  (await elena("POST", `${B}/scan/new-client`, { token: nueva.qrToken, client: { name: "Otra", documentId: cedulaFor(`cta-o-${tag}`), email: `cta.o.${tag}@correo.ec` } })).status === 409,
  "una cuenta ya unida no crea otra ficha",
);

/* ======================================================================================== */
console.log("\nEl enlace de contraseña del consultorio");
ok(((await ricardo("GET", `${B}/clients/${realClient}/loyalty`)).body as { account: string }).account === "pending", "una cuenta con el teléfono de la ficha, sin unir: «pending»");
ok((await elena("POST", `${B}/clients/${realClient}/patient-reset-link`)).status === 409, "sin cuenta unida, no hay enlace");
for (let i = 0; i < 5; i++) await browser()("POST", "/patient/login", { phone: `0${phoneDigits}`, password: `${5000 + i}x` });
ok((await browser()("POST", "/patient/login", { phone: `0${phoneDigits}`, password: "secreta123" })).status === 429, "después de 5 fallos, la cuenta espera");
r = await elena("POST", `${B}/clients/${mariaClient}/patient-reset-link`);
const link = r.body as PatientResetLink;
ok(r.status === 200 && link.phone === `+593${phoneDigits}` && link.url.includes("/mi-tarjeta/clave/"), "Recepción lo genera, con el teléfono de la cuenta", r.body);
ok(auditCount("loyalty.patient_reset_link") === 1, "con la actividad");
ok((await laura("POST", `${B}/clients/${mariaClient}/patient-reset-link`)).status === 403, "otro negocio, no");
const token = link.url.split("/").pop()!;
const reset = browser();
ok(((await reset("GET", `/patient/reset/${token}`)).body as { valid: boolean; firstName: string }).firstName === "María", "el enlace saluda por el nombre de pila");
r = await reset("POST", `/patient/reset/${token}`, { password: "nueva-clave-1" });
ok(r.status === 200 && (r.body as PatientAccount).passwordReset !== null, "crea la contraseña nueva y entra, con el aviso", r.body);
ok((await maria("GET", "/patient/me")).status === 401, "las sesiones de antes se cerraron");
ok((await reset("POST", `/patient/reset/${token}`, { password: "otra-clave-2" })).status === 404, "el enlace sirve una sola vez");
ok((await browser()("POST", "/patient/login", { phone: `0${phoneDigits}`, password: "nueva-clave-1" })).status === 200, "y entra con la nueva");

console.log("\nDespués de un enlace de contraseña, sólo la tarjeta de ese consultorio (revisión de seguridad)");
const lauraBusiness: string = laura.session.businessId;
await laura("PUT", `/businesses/${lauraBusiness}/loyalty`, { enabled: true, name: "Club Laura", description: "", stampIcon: "heart", afterLast: "keep" });
const lauraZone = sql(`select timezone from businesses where id = '${lauraBusiness}'`);
const lauraClient = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${lauraBusiness}', 'María en otro consultorio', '${cedulaFor(`cta-l-${tag}`)}', 'cta.l.${tag}@correo.ec', '0${phoneDigits}') returning id`,
).split("\n")[0];
const lauraAgenda = sql(`select id from professionals where business_id = '${lauraBusiness}' order by created_at limit 1`);
const lauraService = sql(`select id from services where business_id = '${lauraBusiness}' and is_active order by created_at limit 1`);
const lauraToday = sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${lauraBusiness}', '${lauraClient}', '${lauraService}', '${lauraAgenda}', (now() at time zone '${lauraZone}')::date, '23:58', '23:59', 'confirmed', 20, 'dashboard') returning id`,
).split("\n")[0];
r = await reset("POST", "/patient/login", { phone: `0${phoneDigits}`, password: "nueva-clave-1" });
const relogged = (r.body as PatientAccount).qrToken;
ok(((await laura("POST", `/businesses/${lauraBusiness}/scan/link`, { token: relogged, appointmentId: lauraToday, clientId: lauraClient })).body as ScanResult).status === "linked", "otro consultorio también la une");
ok(((await reset("GET", "/patient/cards")).body as PatientCard[]).length === 2, "y ve las dos tarjetas");
const second1 = (await elena("POST", `${B}/clients/${mariaClient}/patient-reset-link`)).body as PatientResetLink;
const second2 = (await elena("POST", `${B}/clients/${mariaClient}/patient-reset-link`)).body as PatientResetLink;
ok((await browser()("GET", `/patient/reset/${second1.url.split("/").pop()}`)).body?.valid === false, "un enlace nuevo anula el anterior");
r = await reset("POST", `/patient/reset/${second2.url.split("/").pop()}`, { password: "otra-clave-3" });
let after = (await reset("GET", "/patient/cards")).body as PatientCard[];
ok(r.status === 200 && after.length === 1 && after[0].business.id === businessId, "con el enlace de un consultorio, la cuenta ve sólo su tarjeta (no las visitas a otros)", after.map((c) => c.business.name));
await laura("POST", `/businesses/${lauraBusiness}/scan`, { token: relogged });
after = (await reset("GET", "/patient/cards")).body as PatientCard[];
ok(after.length === 2, "y la del otro vuelve cuando la escanea de nuevo en persona", after.length);

console.log("\nDesunir la cuenta");
ok((await laura("POST", `${B}/clients/${mariaClient}/patient-unlink`)).status === 403, "otro negocio, no");
r = await elena("POST", `/businesses/${lauraBusiness}/clients/${lauraClient}/patient-unlink`);
ok(r.status === 403, "ni el equipo de otro negocio en el suyo", r.status);
r = await laura("POST", `/businesses/${lauraBusiness}/clients/${lauraClient}/patient-unlink`);
ok(r.status === 200 && ((await reset("GET", "/patient/cards")).body as PatientCard[]).length === 1, "el negocio la desune y la cuenta deja de ver esa tarjeta", r.body);
ok(count(`select count(*) from audit_logs where business_id = '${lauraBusiness}' and action = 'loyalty.account_unlinked'`) === 1, "con la actividad");
ok((await laura("POST", `/businesses/${lauraBusiness}/clients/${lauraClient}/patient-unlink`)).status === 409, "sin cuenta unida, no hay nada que desunir");

console.log("\nEliminar la cuenta");
ok((await reset("DELETE", "/patient/account", { password: "mala" })).status === 400, "pide la contraseña");
r = await reset("DELETE", "/patient/account", { password: "otra-clave-3" });
ok(r.status === 204 && count(`select count(*) from patient_accounts where id = '${account.id}'`) === 0, "la elimina", r.status);
ok(
  count(`select count(*) from loyalty_cards where client_id = '${mariaClient}' and patient_account_id is null`) === 1 &&
    count(`select count(*) from loyalty_stamps where client_id = '${mariaClient}'`) === 1,
  "el negocio conserva la ficha y sus sellos",
);

/* ======================================================================================== */
console.log("\nLas redes del negocio");
const current = (await ricardo("GET", B)).body as Business;
ok(current.socialLinks?.facebook === "", "vacías al empezar", current.socialLinks);
r = await ricardo("PATCH", B, { socialLinks: { facebook: "", instagram: "@sonrisa.dental", tiktok: "" } });
ok(r.status === 200 && (r.body as Business).socialLinks?.instagram === "https://www.instagram.com/sonrisa.dental", "el @usuario se guarda como enlace de esa red", r.body);
ok((await ricardo("PATCH", B, { socialLinks: { facebook: "https://otra-web.com/pagina", instagram: "", tiktok: "" } })).status === 400, "un enlace que no es de esa red, no");
ok((await elena("PATCH", B, { socialLinks: { facebook: "", instagram: "", tiktok: "" } })).status === 403, "Recepción no las cambia");
ok(count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'business.updated' and summary like '%redes%'`) >= 1, "con la actividad");
const publicProfile = (await browser()("GET", `/public/businesses/${slug}`)).body as PublicBusinessProfile;
ok(publicProfile.business.socialLinks?.instagram === "https://www.instagram.com/sonrisa.dental", "la página de reservas las recibe");
await ricardo("PATCH", B, { socialLinks: { facebook: "", instagram: "", tiktok: "" } });

done("de la cuenta del paciente y «Escanear»");
process.exit();
