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
let minute = 0;
/** Una cita de hoy (al final del día, cada una en su hora: no se pisan con las de otras suites). */
const today = (clientId: string, agenda = ricardoAgenda, status = "confirmed") => {
  minute += 5;
  const start = `23:${String(minute % 55).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${serviceId}', '${agenda}', '${T}', '${start}', '${start}'::time + interval '4 minutes', '${status}', 30, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
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
ok((await browser()("POST", "/patient/signup", { name: "Corto", phone: "123", password: "secreta123" })).status === 400, "un teléfono que no es, rechazado");
ok((await browser()("POST", "/patient/signup", { name: "Corta", phone: "0987654321", password: "123" })).status === 400, "una contraseña corta, también");
ok(((await maria("GET", "/patient/cards")).body as PatientCard[]).length === 0, "sin escanear, no ve ninguna tarjeta");
ok((await maria("POST", "/patient/logout")).status === 204 && (await maria("GET", "/patient/me")).status === 401, "sale, y ya no entra sin sesión");
ok((await maria("POST", "/patient/login", { phone: `0${phoneDigits}`, password: "mala-clave" })).status === 401, "con otra contraseña, no entra");
r = await maria("POST", "/patient/login", { phone: `+593${phoneDigits}`, password: "secreta123" });
ok(r.status === 200 && (r.body as PatientAccount).id === account.id, "entra con su teléfono y su contraseña", r.body);

console.log("\nLa sesión del paciente va aparte (prueba 16)");
ok((await maria("GET", `${B}/clients`)).status === 401, "una sesión de paciente no entra al panel");
ok((await maria("GET", "/auth/session")).body?.user == null, "ni es una sesión del equipo");
ok((await ricardo("GET", "/patient/me")).status === 401, "y la del equipo no sirve en /patient");

console.log("\nEl límite por teléfono");
const target = `09${String(Date.now()).slice(-8)}`;
await browser()("POST", "/patient/signup", { name: "Lucía Intentos", phone: target, password: "secreta123" });
let last = 0;
for (let i = 0; i < 11; i++) last = (await browser()("POST", "/patient/login", { phone: target, password: `mala-${i}` })).status;
ok(last === 429, "después de 10 intentos con un teléfono, espera (aunque cambie de conexión)", last);

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
const otherToday = today(patient("Otro Hoy", "0990000000"), valeriaAgenda);
r = await ricardo("POST", `${B}/scan`, { token: account.qrToken });
let scan = r.body as ScanResult;
ok(
  r.status === 200 && scan.status === "unlinked" && scan.accountName === "María Paciente" && scan.appointments.some((a) => a.id === mariaToday && a.clientId === mariaClient),
  "la primera vez: el nombre de la cuenta y las citas de hoy para elegir",
  r.body,
);
ok(((await valeria("POST", `${B}/scan`, { token: account.qrToken })).body as ScanResult).appointments.every((a) => a.id !== mariaToday), "el Profesional ve sólo las citas de hoy de su agenda");
ok((await valeria("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: mariaToday, clientId: mariaClient })).status === 400, "y no une con una cita de otra agenda");
ok((await ricardo("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: otherToday, clientId: mariaClient })).status === 400, "ni con una cita que no es de ese paciente");
const lauraScan = (await laura("POST", `/businesses/${laura.session.businessId}/scan`, { token: account.qrToken })).body as ScanResult;
ok(lauraScan.status === "unlinked" && lauraScan.appointments.every((a) => a.clientId !== mariaClient), "otro negocio no ve nada de este (prueba 15)");
r = await elena("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: mariaToday, clientId: mariaClient });
scan = r.body as ScanResult;
ok(r.status === 200 && scan.status === "linked" && scan.clientId === mariaClient, "Recepción la une a la ficha de la cita elegida", r.body);
ok(auditCount("loyalty.account_linked") === 1, "con la actividad");
const second = patient("María Duplicada", "0991111111");
ok(
  (await ricardo("POST", `${B}/scan/link`, { token: account.qrToken, appointmentId: today(second), clientId: second })).status === 409,
  "una cuenta, una sola ficha por negocio",
);

console.log("\n«Marcar como atendida» con el QR");
ok((await ricardo("POST", `${B}/scan/complete`, { token: account.qrToken, appointmentId: otherToday })).status === 400, "sólo una cita de hoy de ese paciente");
r = await ricardo("POST", `${B}/scan/complete`, { token: account.qrToken, appointmentId: mariaToday });
ok(r.status === 200 && sql(`select status from appointments where id = '${mariaToday}'`) === "completed", "la cita pasa a Atendida", r.body);
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
console.log("\nEl enlace de contraseña del consultorio");
ok((await elena("POST", `${B}/clients/${realClient}/patient-reset-link`)).status === 409, "sin cuenta unida, no hay enlace");
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

console.log("\nEliminar la cuenta");
r = await reset("DELETE", "/patient/account");
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
