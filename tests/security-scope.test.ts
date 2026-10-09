// «Sólo sus pacientes»: un profesional no abre la ficha ni la historia clínica de un paciente ajeno
// reservándole una cita en su propia agenda desde la página pública. Además: la actividad clínica sólo
// la ve quien tiene acceso clínico, y las lecturas clínicas del super admin en modo soporte quedan en
// la actividad del negocio.
import pg from "pg";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Client, Professional, PublicBusinessProfile } from "../src/shared/types/index.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const ORIGIN = BASE.replace(/\/api$/, "");
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
let ipCounter = 20;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET ?? "",
        "x-agendo-client-ip": `198.51.100.${ipCounter++ % 250}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};
const pendingOf = async (appointmentId: string) =>
  (await db.query("select client_access_pending from appointments where id = $1", [appointmentId])).rows[0]?.client_access_pending;

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario de la clínica (Business)
const { a: elena, session: es } = await login("elena@demo.com"); // recepción
const { a: valeria, session: vs } = await login("valeria@demo.com"); // profesional, con acceso clínico
const B = `/businesses/${rs.businessId}`;
const business = (await ricardo("GET", B)).body;
const professionals: Professional[] = (await ricardo("GET", `${B}/professionals`)).body;
const valeriaAgenda = professionals.find((p) => p.userId === vs.userId)!;
const ricardoAgenda = professionals.find((p) => p.userId === rs.userId)!;
let r = await ricardo("PATCH", B, {
  professionalScope: "own",
  bookingSettings: { ...business.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 },
});
ok(r.status === 200 && r.body.professionalScope === "own", "la clínica elige «sólo sus pacientes»", r.body);
ok(vs.clinicalAccess === true, "Valeria tiene acceso a las historias clínicas", vs);

const visitor = agent();
const service = (await ricardo("GET", `${B}/services`)).body.find((s: { name: string }) => s.name === "Consulta odontológica");
const used = new Set<string>();
/** Una hora libre en la agenda (según la página pública), distinta de las ya usadas en esta prueba. */
async function freeSlot(professionalId: string) {
  const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now()}`)).body;
  const context = { ...profile, settings: profile.business.bookingSettings, now: getZonedNow(profile.business.timezone) };
  for (let d = 1; d < 70; d++) {
    const date = addDaysISO(context.now.date, d);
    for (const startTime of getAvailableSlots(date, service.durationMinutes, scopeToProfessional(context, professionalId))) {
      if (used.has(`${professionalId} ${date} ${startTime}`)) continue;
      used.add(`${professionalId} ${date} ${startTime}`);
      return { date, startTime };
    }
  }
  throw new Error("sin horas libres");
}
/**
 * Reserva online en la agenda de Valeria. Con la cédula de una ficha que ya existe, la página exige
 * su email o su teléfono (que quien ataca puede conocer: p. ej. el WhatsApp del paciente).
 */
const bookOnline = async (person: { documentId: string; email?: string; phone?: string }, professionalId = valeriaAgenda.id) =>
  visitor("POST", `/public/businesses/${business.slug}/bookings`, {
    serviceId: service.id,
    ...(await freeSlot(professionalId)),
    name: "Quien reserva",
    email: person.email ?? `reserva.${person.documentId}@example.com`,
    phone: person.phone ?? "+593 99 444 5555",
    notes: "",
    documentId: person.documentId,
    professionalId,
  });
const clinicalProfile = {
  documentId: "0102030405",
  birthDate: "1985-03-02",
  sex: "female",
  bloodType: "O+",
  emergencyContact: "Hermana 0999999999",
  allergies: "Penicilina",
  conditions: "Diabetes",
  medications: "",
  surgeries: "",
  familyHistory: "",
  consentDate: "",
};
/** Paciente del negocio con historia clínica y citas sólo con Ricardo: no es de Valeria. */
async function strangerPatient(seed: string): Promise<Client> {
  const client: Client = (
    await ricardo("POST", `${B}/clients`, {
      name: `Paciente ${seed}`,
      documentId: cedulaFor(`${seed}@example.com`),
      email: `${seed}@example.com`,
      phone: "+593 99 000 1111",
      address: "Av. Privada 123",
      notes: "Nota privada del consultorio",
      isActive: true,
    })
  ).body;
  await ricardo("PUT", `${B}/clients/${client.id}/clinical-record/profile`, clinicalProfile);
  await elena("POST", `${B}/appointments`, {
    clientId: client.id,
    serviceId: service.id,
    ...(await freeSlot(ricardoAgenda.id)),
    durationMinutes: service.durationMinutes,
    price: 20,
    status: "confirmed",
    notes: "",
    professionalId: ricardoAgenda.id,
  });
  return client;
}
const canOpen = async (clientId: string) => {
  const client = await valeria("GET", `${B}/clients/${clientId}`);
  const record = await valeria("GET", `${B}/clients/${clientId}/clinical-record`);
  return { client: client.status === 200 && client.body?.id === clientId, record: record.status, body: record.body };
};

console.log("El ataque: reservarse una cita con la cédula de un paciente ajeno");
const ajeno = await strangerPatient("ajeno");
let access = await canOpen(ajeno.id);
ok(!access.client && access.record === 404, "antes: su ficha y su historia no existen para Valeria (404)", access);
r = await bookOnline({ documentId: ajeno.documentId, phone: ajeno.phone });
ok(r.status === 200 && r.body.professionalId === valeriaAgenda.id, "Valeria se reserva una cita online con esa cédula, en su agenda", r.body);
const attackId: string = r.body.appointmentId;
ok((await pendingOf(attackId)) === true, "la cita queda marcada: no da acceso al paciente", await pendingOf(attackId));
access = await canOpen(ajeno.id);
ok(!access.client && access.record === 404, "tras reservar: sigue sin ver su ficha ni su historia (404)", access);
const mine = (await valeria("GET", `${B}/appointments?clientId=${ajeno.id}`)).body;
ok(mine.length === 1 && mine[0].id === attackId, "ve la cita en su agenda", mine);
let listed: Client | undefined = (await valeria("GET", `${B}/clients`)).body.find((c: Client) => c.id === ajeno.id);
ok(
  listed?.restricted === true && listed.name === ajeno.name && !listed.email && !listed.phone && !listed.notes && !listed.documentId && !listed.address,
  "en la lista sólo llega su nombre (para mostrar la cita), sin contacto, cédula ni notas",
  listed,
);
r = await valeria("PATCH", `${B}/appointments/${attackId}/status`, { status: "confirmed" });
ok(r.status === 200 && r.body.status === "confirmed", "Valeria confirma la cita ella misma", r.body);
access = await canOpen(ajeno.id);
ok(!access.client && access.record === 404 && (await pendingOf(attackId)) === true, "confirmada por ella, sigue sin acceso (404)", access);
r = await valeria("PATCH", `${B}/appointments/${attackId}/arrival`, { arrived: true });
ok(r.status === 200 && (await canOpen(ajeno.id)).record === 404, "ni marcando la llegada", r.body);
const templates = (await valeria("GET", `${B}/clinical-templates`)).body;
const general = templates.find((t: { id: string }) => t.id === "evolucion-general");
r = await valeria("POST", `${B}/clients/${ajeno.id}/clinical-record/notes`, {
  appointmentId: attackId,
  templateVersionId: general.versionId,
  data: { reason: "Intento", findings: "", diagnosis: "", treatment: "", indications: "", next_control: "" },
});
ok(r.status === 404, "ni registrar una evolución en su historia", r.body);

console.log("Otras puertas");
r = await valeria("POST", `${B}/clients`, {
  name: "Otro Nombre",
  documentId: ajeno.documentId,
  email: "otro.nombre@example.com",
  phone: "",
  address: "",
  notes: "",
  isActive: true,
});
ok(r.status === 409 && !r.body.error.message.includes(ajeno.name) && !/Paciente/.test(r.body.error.message), "la cédula repetida no revela de quién es", r.body);
r = await ricardo("POST", `${B}/clients`, { name: "Repetido", documentId: ajeno.documentId, email: "rep@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 409 && r.body.error.message.includes(ajeno.name), "al propietario sí se le dice (ve a todos)", r.body);
r = await valeria("POST", `${B}/appointments`, {
  clientId: ajeno.id,
  serviceId: service.id,
  ...(await freeSlot(valeriaAgenda.id)),
  durationMinutes: service.durationMinutes,
  price: 20,
  status: "confirmed",
  notes: "",
});
ok(r.status === 404, "desde el panel no puede agendarle una cita (el cliente no está en su alcance)", r.body);
const own = (
  await valeria("POST", `${B}/clients`, {
    name: "Paciente de Valeria",
    documentId: cedulaFor("propia@example.com"),
    email: "propia@example.com",
    phone: "",
    address: "",
    notes: "",
    isActive: true,
  })
).body;
const ownSlot = await freeSlot(valeriaAgenda.id);
r = await valeria("POST", `${B}/appointments`, {
  clientId: own.id,
  serviceId: service.id,
  ...ownSlot,
  durationMinutes: service.durationMinutes,
  price: 20,
  status: "confirmed",
  notes: "",
});
ok(r.status === 200, "con su propio paciente sí", r.body);
r = await valeria("PUT", `${B}/appointments/${r.body.id}`, {
  clientId: ajeno.id,
  serviceId: service.id,
  ...ownSlot,
  durationMinutes: service.durationMinutes,
  price: 20,
  status: "confirmed",
  notes: "",
});
ok(r.status === 404, "ni pasarle a ese paciente una cita suya al editarla", r.body);

console.log("Lo gestiona recepción");
r = await elena("PATCH", `${B}/appointments/${attackId}/status`, { status: "cancelled" });
ok(r.status === 200 && (await canOpen(ajeno.id)).record === 404, "si recepción la cancela, sigue sin acceso", r.body);
r = await elena("PATCH", `${B}/appointments/${attackId}/status`, { status: "confirmed" });
ok(r.status === 200 && (await pendingOf(attackId)) === false, "recepción la confirma: la cita ya cuenta", r.body);
access = await canOpen(ajeno.id);
ok(access.client && access.record === 200 && access.body.profile?.allergies === "Penicilina", "ahora Valeria abre su ficha y su historia (200)", access);
listed = (await valeria("GET", `${B}/clients`)).body.find((c: Client) => c.id === ajeno.id);
ok(listed && !listed.restricted && listed.email === ajeno.email, "y en la lista llega completo", listed);

console.log("Lo gestiona el propietario");
const segundo = await strangerPatient("segundo");
r = await bookOnline({ documentId: segundo.documentId, email: segundo.email });
const secondId: string = r.body.appointmentId;
ok(r.status === 200 && (await canOpen(segundo.id)).record === 404, "otra reserva online con la cédula de otro paciente ajeno: 404", r.body);
r = await ricardo("PATCH", `${B}/appointments/${secondId}/status`, { status: "confirmed" });
ok(r.status === 200 && (await canOpen(segundo.id)).record === 200, "el propietario la confirma: 200", r.body);

console.log("Pacientes nuevos y propios");
r = await bookOnline({ documentId: cedulaFor("nuevo.online@example.com") });
ok(r.status === 200 && (await pendingOf(r.body.appointmentId)) === false, "un paciente nuevo, creado por la reserva, cuenta enseguida (no tiene historia previa)", r.body);
const created: Client | undefined = (await valeria("GET", `${B}/clients`)).body.find((c: Client) => c.documentId === cedulaFor("nuevo.online@example.com"));
ok(created && !created.restricted && (await canOpen(created.id)).record === 200, "Valeria abre su ficha y su historia", created);
r = await bookOnline({ documentId: own.documentId, email: own.email });
ok(r.status === 200 && (await pendingOf(r.body.appointmentId)) === false, "su propio paciente que reserva online sigue siendo suyo", r.body);
await ricardo("PATCH", B, { professionalScope: "all" });
ok((await canOpen(ajeno.id)).record === 200, "con «todos los pacientes», ve a todos", null);

console.log("Actividad clínica sólo con acceso clínico");
r = await ricardo("PATCH", `${B}/team/${es.userId}`, { role: "admin" });
ok(r.status === 204 || r.status === 200, "Elena pasa a administradora (sin acceso clínico)", r.body);
const ownerClinical = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&limit=200`)).body.entries;
ok(ownerClinical.length > 0 && ownerClinical.some((l: { summary: string }) => /historia clínica/.test(l.summary)), "el propietario ve los eventos de la historia clínica", ownerClinical.length);
let entries = (await elena("GET", `${B}/audit-logs?limit=1000`)).body.entries;
ok(entries.length > 0 && entries.every((l: { entityType: string }) => l.entityType !== "clinical_record"), "la administradora sin acceso clínico no los ve", entries.length);
r = await elena("GET", `${B}/audit-logs?entityType=clinical_record`);
ok(r.status === 200 && r.body.entries.length === 0, "ni filtrando por historia clínica", r.body);
await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: true });
entries = (await elena("GET", `${B}/audit-logs?entityType=clinical_record`)).body.entries;
ok(entries.length === ownerClinical.length, "con acceso clínico, sí", [entries.length, ownerClinical.length]);
await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: false });
await ricardo("PATCH", `${B}/team/${es.userId}`, { role: "staff" });

console.log("Lecturas clínicas del super admin en modo soporte");
const { a: admin } = await login("admin@demo.com");
r = await admin("GET", `${B}/clients/${ajeno.id}/clinical-record`);
ok(r.status === 200, "el super admin abre una historia en modo soporte", r.status);
const views = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&entityId=${ajeno.id}`)).body.entries;
ok(
  views.some((l: { action: string; actorName: string }) => l.action === "clinical_record.viewed" && /\(Super admin\)/.test(l.actorName)),
  "queda en la actividad del negocio, a la vista del propietario",
  views.map((l: { actorName: string; action: string }) => `${l.actorName}: ${l.action}`),
);
const pdf = Buffer.from("%PDF-1.4 informe ".repeat(20));
r = await ricardo("POST", `${B}/clients/${ajeno.id}/clinical-record/attachments`, {
  fileName: "Informe.pdf",
  contentType: "application/pdf",
  sizeBytes: pdf.length,
  description: "",
});
await fetch(ORIGIN + r.body.upload.url, { method: "PUT", headers: r.body.upload.headers, body: pdf });
await ricardo("POST", `${B}/clinical-attachments/${r.body.attachment.id}/complete`);
r = await admin("GET", `${B}/clinical-attachments/${r.body.attachment.id}/url`);
ok(r.status === 200 && r.body.url, "el super admin descarga un archivo de la historia", r.body);
const opened = (await ricardo("GET", `${B}/audit-logs?action=clinical_record.attachment_opened&entityId=${ajeno.id}`)).body.entries;
ok(opened.length === 1 && /\(Super admin\)/.test(opened[0].actorName) && /Informe\.pdf/.test(opened[0].summary), "la descarga también queda registrada", opened);

await db.end();
console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
