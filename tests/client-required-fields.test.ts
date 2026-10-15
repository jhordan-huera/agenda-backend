// Datos obligatorios del paciente, negocio por negocio: los elige el super admin (PUT
// /admin/businesses/:id/client-required-fields) y el panel del negocio los exige al crear o editar un
// cliente. El negocio no puede cambiarlos y la reserva online sigue pidiendo cédula, nombre, email y teléfono.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlotsForAny } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { AuditLog, Business, Client, ClientRequiredFields, PublicBusinessProfile } from "../src/shared/types/index.ts";
import { viaProxy } from "./helpers/proxy.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
let ipCounter = 10;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...viaProxy(`198.51.100.${ipCounter++ % 250}`),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};

const DEFAULT: ClientRequiredFields = { documentId: true, email: true, phone: false, address: false };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Los cuatro datos, en el mismo orden que DEFAULT (la base guarda el jsonb con otro orden). */
const fieldsOf = (business: Business): ClientRequiredFields => {
  const { documentId, email, phone, address } = business.clientRequiredFields;
  return { documentId, email, phone, address };
};
const newClient = (fields: Partial<Client>) => ({
  name: "Paciente Prueba",
  documentId: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  isActive: true,
  ...fields,
});

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario de Clínica Dental Sonrisa (Business)
const { a: elena } = await login("elena@demo.com"); // Recepción de la clínica
const { a: jhordan, session: js } = await login("jhordan@demo.com"); // otro negocio
const { a: admin } = await login("admin@demo.com"); // super admin
const B = `/businesses/${rs.businessId}`;
const J = `/businesses/${js.businessId}`;
const ADMIN_ROUTE = `/admin/businesses/${rs.businessId}/client-required-fields`;
const getBusiness = async () => (await ricardo("GET", B)).body as Business;

console.log("Valor por defecto: como hasta ahora");
let business = await getBusiness();
ok(same(fieldsOf(business), DEFAULT), "el negocio expone clientRequiredFields: cédula y email obligatorios", business.clientRequiredFields);
ok(
  sql(`select count(*) from businesses where client_required_fields <> '{"documentId": true, "email": true, "phone": false, "address": false}'::jsonb`) === "0",
  "todos los negocios demo tienen el valor por defecto",
);
let r = await ricardo("POST", `${B}/clients`, newClient({ email: "sin.cedula@example.com" }));
ok(r.status === 400 && r.body.error.message === "La cédula es obligatoria", "sin cédula no se crea", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: cedulaFor("sin-email") }));
ok(r.status === 400 && r.body.error.message === "El email es obligatorio", "sin email tampoco", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ name: "Con Cédula Y Email", documentId: cedulaFor("defecto"), email: "defecto@example.com" }));
ok(r.status === 200 && r.body.phone === "" && r.body.address === "", "con cédula y email, sin teléfono ni dirección, sí", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: cedulaFor("tel-malo"), email: "tel.malo@example.com", phone: "abc" }));
ok(r.status === 400 && r.body.error.message === "Ingresa un teléfono válido", "el teléfono opcional, si se escribe, tiene que ser válido", r.body);

console.log("Sólo el super admin lo cambia");
const wanted: ClientRequiredFields = { documentId: true, email: false, phone: false, address: true };
r = await ricardo("PUT", ADMIN_ROUTE, wanted);
ok(r.status === 403, "el propietario no entra a la ruta del super admin", r.body);
r = await elena("PUT", ADMIN_ROUTE, wanted);
ok(r.status === 403, "recepción tampoco", r.body);
r = await ricardo("PATCH", B, { clientRequiredFields: { documentId: false, email: false, phone: false, address: false } });
ok(r.status === 200 && same(fieldsOf(r.body), DEFAULT), "la configuración del negocio ignora el campo (propietario)", r.body?.clientRequiredFields);
r = await ricardo("PATCH", B, { name: business.name, clientRequiredFields: { documentId: false, email: false, phone: false, address: false } });
ok(r.status === 200 && same(fieldsOf(r.body), DEFAULT), "también junto con otros datos del negocio", r.body?.clientRequiredFields);
r = await elena("PATCH", B, { clientRequiredFields: { documentId: false, email: false, phone: false, address: false } });
ok(r.status === 403, "recepción no cambia la configuración del negocio", r.body);
r = await admin("PATCH", B, { clientRequiredFields: { documentId: false, email: false, phone: false, address: false } });
ok(r.status === 200 && same(fieldsOf(r.body), DEFAULT), "ni el super admin en modo soporte desde la configuración del negocio", r.body?.clientRequiredFields);
ok(same(fieldsOf(await getBusiness()), DEFAULT), "sigue con el valor por defecto");
r = await admin("PUT", ADMIN_ROUTE, { documentId: true, email: "no" });
ok(r.status === 400, "datos incompletos o que no son sí/no → 400", r.body);
r = await admin("PUT", `/admin/businesses/00000000-0000-0000-0000-000000000000/client-required-fields`, wanted);
ok(r.status === 404, "negocio que no existe → 404", r.body);
r = await admin("PUT", ADMIN_ROUTE, wanted);
ok(r.status === 200 && same(fieldsOf(r.body), wanted), "el super admin activa Cédula y Dirección y desactiva Email", r.body?.clientRequiredFields);
business = await getBusiness();
ok(same(fieldsOf(business), wanted), "el negocio lo ve en su respuesta", business.clientRequiredFields);
const detail = (await admin("GET", `/admin/businesses/${rs.businessId}`)).body;
ok(same(fieldsOf(detail.business), wanted), "y la ficha del negocio en /admin", detail.business?.clientRequiredFields);
const profile: PublicBusinessProfile = (await agent()("GET", `/public/businesses/${business.slug}?t=${Date.now()}`)).body;
ok(!("clientRequiredFields" in profile.business), "la página pública no lo muestra", Object.keys(profile.business));

console.log("Actividad del negocio");
const logs: AuditLog[] = (await ricardo("GET", `${B}/audit-logs?action=platform.client_required_fields_changed`)).body.entries;
const log = logs[0];
ok(logs.length === 1 && /\(Super admin\)$/.test(log.actorName), "queda en la actividad del negocio, hecho por el super admin", logs);
ok(
  log?.summary === "Cambió los datos obligatorios del paciente en Clínica Dental Sonrisa: nombre, cédula y dirección",
  "con los datos que quedaron obligatorios",
  log?.summary,
);
ok(
  same(
    log?.changes?.map((change) => `${change.label}: ${change.before} → ${change.after}`),
    ["Email: Obligatorio → Opcional", "Dirección: Opcional → Obligatorio"],
  ),
  "y lo que cambió (antes → después)",
  log?.changes,
);
const adminLogs: AuditLog[] = (await admin("GET", `/admin/audit-logs?scope=admin&businessId=${rs.businessId}`)).body.entries;
ok(adminLogs.some((entry) => entry.action === "platform.client_required_fields_changed"), "y en la actividad de la plataforma (acciones del super admin)");
r = await admin("PUT", ADMIN_ROUTE, wanted);
ok(r.status === 200, "guardar lo mismo otra vez", r.body);
ok(
  (await ricardo("GET", `${B}/audit-logs?action=platform.client_required_fields_changed`)).body.entries.length === 1,
  "no añade otra entrada si nada cambió",
);

console.log("Crear con la configuración del negocio");
r = await ricardo("POST", `${B}/clients`, newClient({ address: "Av. Amazonas 123" }));
ok(r.status === 400 && r.body.error.message === "La cédula es obligatoria", "sin la cédula obligatoria → 400", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: cedulaFor("sin-direccion") }));
ok(r.status === 400 && r.body.error.message === "La dirección es obligatoria", "sin la dirección obligatoria → 400", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ name: "Ana Requisitos", documentId: cedulaFor("ana-requisitos"), address: "Av. Amazonas 123" }));
ok(r.status === 200 && r.body.email === "" && r.body.phone === "", "con cédula y dirección, sin email ni teléfono, se crea", r.body);
const ana: Client = r.body;
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: cedulaFor("email-malo"), address: "Calle 1", email: "no-es-un-email" }));
ok(r.status === 400 && r.body.error.message === "Ingresa un email válido", "el email opcional, si se escribe, tiene que ser válido", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: ana.documentId.slice(0, 9) + ((Number(ana.documentId[9]) + 1) % 10), address: "Calle 1" }));
ok(r.status === 400 && /no es válida/.test(r.body.error.message), "la cédula ecuatoriana se sigue comprobando", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: ana.documentId, address: "Calle 1" }));
ok(r.status === 409, "y no puede repetirse", r.body);
r = await elena("POST", `${B}/clients`, newClient({ name: "Desde Recepción", documentId: cedulaFor("recepcion"), address: "Calle 2" }));
ok(r.status === 200, "recepción crea con la misma configuración", r.body);
r = await admin("POST", `${B}/clients`, newClient({ name: "Desde Soporte", documentId: "", address: "Calle 3" }));
ok(r.status === 400 && r.body.error.message === "La cédula es obligatoria", "y el super admin en modo soporte también", r.body);

console.log("Teléfono opcional u obligatorio");
r = await ricardo("POST", `${B}/clients`, newClient({ name: "Sin Teléfono", documentId: cedulaFor("sin-telefono"), address: "Calle 4" }));
ok(r.status === 200 && r.body.phone === "", "con el teléfono opcional se crea sin teléfono", r.body);
r = await admin("PUT", ADMIN_ROUTE, { ...wanted, phone: true });
ok(r.status === 200 && r.body.clientRequiredFields.phone === true, "el super admin hace obligatorio el teléfono", r.body?.clientRequiredFields);
r = await ricardo("POST", `${B}/clients`, newClient({ documentId: cedulaFor("tel-obligatorio"), address: "Calle 5" }));
ok(r.status === 400 && r.body.error.message === "El teléfono es obligatorio", "ahora sin teléfono → 400", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ name: "Con Teléfono", documentId: cedulaFor("tel-obligatorio"), address: "Calle 5", phone: "+593 99 111 2222" }));
ok(r.status === 200, "con teléfono sí", r.body);

console.log("Editar un paciente antiguo");
const viejo: Client = (await ricardo("GET", `${B}/clients`)).body.find((c: Client) => c.name === "Ana Requisitos");
r = await ricardo("PUT", `${B}/clients/${viejo.id}`, { ...viejo, notes: "Nota nueva" });
ok(r.status === 400 && r.body.error.message === "El teléfono es obligatorio", "le falta el teléfono que ahora es obligatorio: no se guarda", r.body);
r = await ricardo("PUT", `${B}/clients/${viejo.id}`, { ...viejo, phone: "+593 99 333 4444", notes: "Nota nueva" });
ok(r.status === 200 && r.body.phone === "+593 99 333 4444" && r.body.notes === "Nota nueva", "al completarlo, se guarda", r.body);
r = await ricardo("PUT", `${B}/clients/${viejo.id}`, { ...r.body, address: "" });
ok(r.status === 400 && r.body.error.message === "La dirección es obligatoria", "y no se le puede quitar un dato obligatorio", r.body);
r = await admin("PUT", ADMIN_ROUTE, { documentId: false, email: false, phone: false, address: false });
ok(r.status === 200, "con todo opcional (salvo el nombre)", r.body?.clientRequiredFields);
r = await ricardo("PUT", `${B}/clients/${viejo.id}`, { ...viejo, documentId: "", address: "", phone: "" });
ok(r.status === 200 && r.body.documentId === "" && r.body.address === "", "se pueden dejar vacíos", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ name: "Sólo Nombre" }));
ok(r.status === 200, "y crear un paciente sólo con el nombre", r.body);
r = await ricardo("POST", `${B}/clients`, newClient({ name: "" }));
ok(r.status === 400 && r.body.error.message === "El nombre es obligatorio", "el nombre sigue siendo obligatorio", r.body);

console.log("Otro negocio no cambia");
r = await jhordan("POST", `${J}/clients`, newClient({ email: "otro.negocio@example.com" }));
ok(r.status === 400 && r.body.error.message === "La cédula es obligatoria", "en otro negocio la cédula sigue siendo obligatoria", r.body);
r = await jhordan("POST", `${J}/clients`, newClient({ documentId: cedulaFor("otro-negocio") }));
ok(r.status === 400 && r.body.error.message === "El email es obligatorio", "y el email", r.body);

console.log("La reserva online no cambia");
await ricardo("PATCH", B, { bookingSettings: { ...business.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
const fresh: PublicBusinessProfile = (await agent()("GET", `/public/businesses/${business.slug}?t=${Date.now() + 1}`)).body;
const now = getZonedNow(fresh.business.timezone);
const consult = fresh.services.find((s) => s.name === "Consulta odontológica")!;
const context = { ...fresh, settings: fresh.business.bookingSettings, now };
let slot: { date: string; time: string } | null = null;
for (let d = 1; d < 40 && !slot; d++) {
  const date = addDaysISO(now.date, d);
  const [time] = getAvailableSlotsForAny(date, consult.durationMinutes, context, fresh.professionals.map((p) => p.id));
  if (time) slot = { date, time };
}
ok(slot, "hay una hora libre en la página de reservas", slot);
const visitor = agent();
const booking = (fields: Record<string, string>) => ({
  serviceId: consult.id,
  date: slot!.date,
  startTime: slot!.time,
  documentId: cedulaFor("online-requisitos"),
  name: "Paciente Online",
  email: "paciente.online@example.com",
  phone: "+593 99 777 8888",
  notes: "",
  professionalId: null,
  ...fields,
});
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, booking({ email: "" }));
ok(r.status === 400, "con el email opcional en el panel, la reserva online lo sigue pidiendo", r.body);
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, booking({ phone: "" }));
ok(r.status === 400, "y el teléfono", r.body);
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, booking({ documentId: "" }));
ok(r.status === 400, "y la cédula", r.body);
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, booking({}));
ok(r.status === 200, "con cédula, nombre, email y teléfono se reserva", r.body);
const online = sql(`select document_id, email, phone, source from clients where document_id = '${cedulaFor("online-requisitos")}'`);
ok(online === `${cedulaFor("online-requisitos")}|paciente.online@example.com|+593 99 777 8888|booking_page`, "y crea al paciente con todos sus datos", online);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de datos obligatorios del paciente pasaron");
process.exitCode = failures ? 1 : 0;
