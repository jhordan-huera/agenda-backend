// Cédula de los clientes (reservas sin duplicados) y fechas automáticas de la historia clínica.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else { failures++; console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
};
function agent() {
  let cookie = "";
  return async (method, path, body) => {
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
const login = async (email) => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password: "demo1234", remember: true });
  return { a, session: r.body };
};
const sql = (query) =>
  // psql del PATH (scripts/test.ts añade el de PostgreSQL) contra la base desechable de las pruebas.
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sqlError = (query) => { try { sql(query); return null; } catch (e) { return String(e.stderr || e.message); } };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());

const pub = agent();
const { a: owner, session: os } = await login("jhordan@demo.com");
const B = `/businesses/${os.businessId}`;
const clients = (await owner("GET", `${B}/clients`)).body;
const maria = clients.find((c) => c.name === "María López");
ok(/^\d{10}$/.test(maria?.documentId ?? ""), "los clientes demo tienen cédula", maria?.documentId);

console.log("Búsqueda pública por cédula");
let r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: maria.documentId });
ok(r.status === 200 && r.body.found === true && r.body.greetingName === "María L.", "cliente encontrado: sólo saluda con nombre e inicial", r.body);
ok(Object.keys(r.body).sort().join() === "found,greetingName", "la respuesta no incluye email, teléfono ni dirección", Object.keys(r.body));
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: `${maria.documentId.slice(0, 4)}-${maria.documentId.slice(4)}` });
ok(r.body?.found === true, "acepta la cédula con guiones (se normaliza)", r.body);
r = await pub("POST", "/public/businesses/estudio-bella/clients/lookup", { documentId: maria.documentId });
ok(r.body?.found === false, "sólo busca entre los clientes de ese profesional", r.body);
const badCheck = maria.documentId.slice(0, 9) + ((Number(maria.documentId[9]) + 1) % 10);
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: badCheck });
ok(r.status === 400 && /no es válida/.test(r.body.error.message), "cédula ecuatoriana con dígito verificador erróneo → 400", r.body);
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: "AB123456" });
ok(r.status === 400 && /sólo números/.test(r.body.error.message), "con letras (pasaporte) → 400", r.body);
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: "1004089445ffsfsd" });
ok(r.status === 400 && /sólo números/.test(r.body.error.message), "números con letras al final → 400", r.body);
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: "12345678" });
ok(r.status === 400 && /10 dígitos/.test(r.body.error.message), "en Ecuador, menos de 10 dígitos → 400", r.body);
r = await pub("POST", "/public/businesses/jhordan/clients/lookup", { documentId: "12" });
ok(r.status === 400, "documento demasiado corto → 400", r.body);

console.log("Reservas sin duplicados");
const profile = (await pub("GET", "/public/businesses/jhordan")).body;
const service = profile.services.find((s) => s.modes.join() === "business" && s.durationMinutes === 60);
const { getAvailableSlots } = await import("../src/shared/lib/availability.ts");
const { addDaysISO, getZonedNow } = await import("../src/shared/lib/time.ts");
const now = getZonedNow(profile.business.timezone);
// Una hora libre por día, en días en que María no tiene cita: cada persona reserva como mucho una
// cita por día desde la página (maxClientBookingsPerDay = 1 por defecto).
const mariaDates = new Set((await owner("GET", `${B}/appointments?clientId=${maria.id}`)).body.map((a) => a.date));
const freeSlots = [];
for (let d = 2; d < 60 && freeSlots.length < 6; d++) {
  const date = addDaysISO(now.date, d);
  if (mariaDates.has(date)) continue;
  const [startTime] = getAvailableSlots(date, service.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now });
  if (startTime) freeSlots.push({ date, startTime });
}
const countClients = async () => (await owner("GET", `${B}/clients`)).body.length;
const before = await countClients();
const booking = (slot, extra) => ({ serviceId: service.id, ...slot, name: "", email: "", phone: "", notes: "", ...extra });

r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[0], { documentId: maria.documentId }));
ok(r.status === 200 && /^ma\*\*\*@example\.com$/.test(r.body.clientEmail), "cliente registrado reserva sólo con su cédula (email enmascarado)", r.body);
ok((await countClients()) === before, "no se crea otro cliente");
const mariaAppts = (await owner("GET", `${B}/appointments?clientId=${maria.id}&from=${freeSlots[0].date}&to=${freeSlots[0].date}`)).body;
ok(mariaAppts.some((a) => a.startTime === freeSlots[0].startTime && a.source === "booking_page"), "la cita queda en la ficha de María", mariaAppts);

const nuevo = cedulaFor("nuevo-paciente");
r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[1], { documentId: nuevo }));
ok(r.status === 400, "cliente nuevo sin nombre, email ni teléfono → 400", r.body);
r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[1], { documentId: nuevo, name: "Pedro Nuevo", email: "pedro.nuevo@example.com", phone: "+593 99 555 0001" }));
ok(r.status === 200 && r.body.clientEmail === "pedro.nuevo@example.com", "cliente nuevo con sus datos", r.body);
ok((await countClients()) === before + 1, "se crea un cliente");
r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[2], { documentId: nuevo, name: "Otro Nombre", email: "otro@example.com", phone: "+593 99 555 0002" }));
ok(r.status === 200 && (await countClients()) === before + 1, "la segunda reserva con la misma cédula no duplica", r.body);
const pedro = (await owner("GET", `${B}/clients`)).body.find((c) => c.documentId === nuevo);
ok(pedro?.name === "Pedro Nuevo" && pedro.email === "pedro.nuevo@example.com", "y no cambia los datos del cliente", pedro);

const hijo = cedulaFor("hijo-1");
r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[3], { documentId: hijo, name: "Hijo Nuevo", email: "pedro.nuevo@example.com", phone: "+593 99 555 0003" }));
ok(r.status === 200 && (await countClients()) === before + 2, "otra persona con el mismo email (familia) es otro cliente", r.body);

const legacyId = sql(`insert into clients (business_id, name, email) values ('${os.businessId}', 'Cliente Antiguo', 'antiguo@example.com') returning id`).split("\n")[0];
const antiguo = cedulaFor("antiguo");
r = await pub("POST", "/public/businesses/jhordan/bookings", booking(freeSlots[4], { documentId: antiguo, name: "Cliente Antiguo", email: "antiguo@example.com", phone: "+593 99 555 0004" }));
const legacy = (await owner("GET", `${B}/clients/${legacyId}`)).body;
ok(r.status === 200 && legacy.documentId === antiguo && (await countClients()) === before + 3, "un cliente antiguo sin cédula (mismo email) recibe la cédula en vez de duplicarse", legacy);

console.log("Panel");
r = await owner("POST", `${B}/clients`, { name: "Duplicado", documentId: maria.documentId, email: "dup@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 409 && /María López/.test(r.body.error.message), "cédula repetida → 409 con el nombre del cliente", r.body);
r = await owner("POST", `${B}/clients`, { name: "Mal Cédula", documentId: badCheck, email: "mal@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 400, "cédula inválida en el panel → 400", r.body);
r = await owner("POST", `${B}/clients`, { name: "Con Puntos", documentId: " 0912.3456 75 ", email: "puntos@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 200 && r.body.documentId === "0912345675", "se guarda normalizada", r.body);
r = await owner("POST", `${B}/clients`, { name: "Con Letras", documentId: "17A2345678", email: "letras@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 400 && /sólo números/.test(r.body.error.message), "panel: cédula con letras → 400", r.body);
r = await owner("POST", `${B}/clients`, { name: "Sin Cédula", documentId: "", email: "sin@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 400 && /cédula es obligatoria/.test(r.body.error.message), "desde el panel la cédula es obligatoria", r.body);
r = await owner("POST", `${B}/clients`, { name: "Sin Email", documentId: cedulaFor("sin-email"), email: "", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 400 && /email es obligatorio/.test(r.body.error.message), "y el email también", r.body);
const conPuntos = (await owner("GET", `${B}/clients`)).body.find((c) => c.name === "Con Puntos");
r = await owner("PUT", `${B}/clients/${conPuntos.id}`, { ...conPuntos, documentId: "" });
ok(r.status === 400, "no se le puede quitar la cédula a un cliente", r.body);
r = await owner("PUT", `${B}/clients/${conPuntos.id}`, { ...conPuntos, email: "" });
ok(r.status === 400, "ni el email", r.body);
const viejo = sql(`insert into clients (business_id, name) values ('${os.businessId}', 'Viejo Sin Datos') returning id`).split("\n")[0];
const viejoClient = (await owner("GET", `${B}/clients/${viejo}`)).body;
r = await owner("PUT", `${B}/clients/${viejo}`, { ...viejoClient, notes: "Nota nueva" });
ok(r.status === 200 && r.body.notes === "Nota nueva", "un cliente antiguo sin cédula ni email puede seguir usándose (p. ej. guardar notas)", r.body);

console.log("Historia clínica: fechas automáticas");
const { a: ricardo, session: rs } = await login("ricardo@demo.com");
const RB = `/businesses/${rs.businessId}`;
const patient = (await ricardo("GET", `${RB}/clients`)).body[0];
r = await ricardo("PUT", `${RB}/clients/${patient.id}/clinical-record/profile`, { documentId: "AB-123", birthDate: "", sex: "", bloodType: "", emergencyContact: "", allergies: "", conditions: "", medications: "", surgeries: "", familyHistory: "", consentSigned: false });
ok(r.status === 400 && /sólo números/.test(r.body.error.message), "historia clínica: cédula con letras → 400", r.body);
const profileBody = { documentId: "", birthDate: "", sex: "", bloodType: "", emergencyContact: "", allergies: "", conditions: "", medications: "", surgeries: "", familyHistory: "" };
sql(`delete from clinical_note_addenda where note_id in (select id from clinical_notes where client_id = '${patient.id}'); delete from clinical_notes where client_id = '${patient.id}'; delete from clinical_profiles where client_id = '${patient.id}';`);
r = await ricardo("PUT", `${RB}/clients/${patient.id}/clinical-record/profile`, { ...profileBody, consentSigned: false, consentDate: "2020-01-01" });
ok(r.status === 200 && r.body.consentDate === "", "no se puede enviar una fecha de consentimiento", r.body);
r = await ricardo("PUT", `${RB}/clients/${patient.id}/clinical-record/profile`, { ...profileBody, consentSigned: true });
ok(r.body?.consentDate === today, "al marcar el consentimiento se registra la fecha de hoy", r.body);
r = await ricardo("PUT", `${RB}/clients/${patient.id}/clinical-record/profile`, { ...profileBody, allergies: "Látex", consentSigned: false });
ok(r.body?.consentDate === today && r.body.allergies === "Látex", "después no se puede quitar", r.body);
let error = sqlError(`update clinical_profiles set consent_date = '2020-01-01' where client_id = '${patient.id}'`);
ok(error && /consentimiento informado no se puede modificar/.test(error), "ni siquiera con SQL directo", error);
const general = (await ricardo("GET", `${RB}/clinical-templates`)).body.find((t) => t.id === "evolucion-general");
r = await ricardo("POST", `${RB}/clients/${patient.id}/clinical-record/notes`, { appointmentId: null, date: "2020-01-01", templateVersionId: general.versionId, data: { reason: "Control" } });
ok(r.status === 200 && r.body.date === today, "la evolución lleva la fecha de hoy aunque se envíe otra", r.body);
error = sqlError(`update clinical_notes set date = '2020-01-01' where id = '${r.body.id}'`);
ok(error && /no se pueden modificar/.test(error), "la evolución no se puede cambiar con SQL directo", error);
error = sqlError(`update clinical_notes set data = '{"reason": "Otro"}' where id = '${r.body.id}'`);
ok(error && /no se pueden modificar/.test(error), "ni su contenido", error);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de cédula y fechas clínicas pasaron");
process.exitCode = failures ? 1 : 0;
