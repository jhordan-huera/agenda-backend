// Historia clínica privada (spec 025): el super admin en modo soporte no la ve ni la cambia. Cada camino
// (la historia, los antecedentes, las evoluciones y sus aclaraciones, los archivos y el acceso clínico
// del equipo) da 403 sin cambiar nada ni dejar rastro en la actividad; la actividad que ve no trae los
// eventos clínicos; sigue gestionando los formatos, activando la historia y los pacientes; y el
// propietario y un miembro autorizado siguen igual. Repaso del resto de caminos del super admin
// (/admin): admin-service sólo crea y borra, analytics-service cuenta evoluciones, database-stats-service
// mide tamaños y business-data-service sólo mira si existe una historia; ninguno lee su contenido.
import { BASE, checks, count, login, sql } from "./helpers/harness.ts";
import { CLINICAL_SUPPORT_BLOCKED_MESSAGE } from "../src/shared/lib/constants/business.ts";
import type { AuditLog, Client, ClinicalTemplate } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const ORIGIN = BASE.replace(/\/api$/, "");

let ipCounter = 20;
const nextIp = () => `203.0.113.${ipCounter++}`;
const as = (email: string) => login(email, { ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental (Business, historia activada)
const elena = await as("elena@demo.com"); // recepción, sin acceso clínico
const admin = await as("admin@demo.com"); // super admin: en la clínica, modo soporte
const businessId: string = ricardo.session.businessId;
const elenaId: string = elena.session.userId;
const B = `/businesses/${businessId}`;
const ONLY_OWNER = "Sólo el propietario puede dar o quitar el acceso a la historia clínica.";
const blocked = (r: { status: number; body: any }, message = CLINICAL_SUPPORT_BLOCKED_MESSAGE) =>
  r.status === 403 && r.body?.error?.message === message;

console.log("Preparación (el propietario)");
let patient: Client | null = null;
let noteId = "";
for (const client of (await ricardo("GET", `${B}/clients`)).body as Client[]) {
  const record = (await ricardo("GET", `${B}/clients/${client.id}/clinical-record`)).body;
  if (record?.profile && record.notes?.length) {
    patient = client;
    noteId = record.notes[0].id;
    break;
  }
}
ok(patient && noteId, "un paciente de la demo con antecedentes y evoluciones", patient);
const P = `${B}/clients/${patient!.id}/clinical-record`;
const general = ((await ricardo("GET", `${B}/clinical-templates`)).body as ClinicalTemplate[]).find((t) => t.id === "evolucion-general")!;
const note = (reason: string) => ({ appointmentId: null, templateVersionId: general.versionId, data: { reason } });

const pdf = Buffer.from("%PDF-1.4 radiografía privada ".repeat(20));
/** El propietario pide la subida y el navegador sube el archivo; con `complete`, lo da por subido. */
async function ownerUpload(fileName: string, complete: boolean): Promise<string> {
  const r = await ricardo("POST", `${P}/attachments`, { fileName, contentType: "application/pdf", sizeBytes: pdf.length, description: "" });
  await fetch(ORIGIN + r.body.upload.url, { method: "PUT", headers: r.body.upload.headers, body: pdf });
  if (complete) await ricardo("POST", `${B}/clinical-attachments/${r.body.attachment.id}/complete`);
  return r.body.attachment.id;
}
const fileId = await ownerUpload("Radiografía privada.pdf", true);
const pendingId = await ownerUpload("Sin completar.pdf", false);
ok(sql(`select status from clinical_attachments where id = '${fileId}'`) === "ready", "el propietario sube un archivo", fileId);
ok(sql(`select status from clinical_attachments where id = '${pendingId}'`) === "pending", "y otro que queda a medio subir", pendingId);

/** Lo que el soporte no debe poder cambiar: si algo se mueve, alguna cuenta cambia. */
const snapshot = () => ({
  notes: count(`select count(*) from clinical_notes where business_id = '${businessId}'`),
  addenda: count(`select count(*) from clinical_note_addenda where business_id = '${businessId}'`),
  attachments: sql(`select count(*) || '/' || count(*) filter (where status = 'ready') from clinical_attachments where business_id = '${businessId}'`),
  profile: sql(`select md5(p::text) from clinical_profiles p where client_id = '${patient!.id}'`),
  auditLogs: count(`select count(*) from audit_logs where business_id = '${businessId}'`),
  elenaAccess: sql(`select clinical_access from business_users where business_id = '${businessId}' and user_id = '${elenaId}'`),
});

console.log("El soporte no abre ni cambia la historia clínica");
let before = snapshot();
ok(before.elenaAccess === "f", "Elena empieza sin acceso clínico", before);
let r = await admin("GET", P);
ok(blocked(r) && !r.body.profile && !r.body.notes, "leer la historia (también la impresión): 403 con el mensaje de privacidad", r.body);
r = await admin("PUT", `${P}/profile`, {
  documentId: "0102030405", birthDate: "1980-01-01", sex: "male", bloodType: "A+", emergencyContact: "Soporte",
  allergies: "Cambiado por el soporte", conditions: "", medications: "", surgeries: "", familyHistory: "", consentSigned: true,
});
ok(blocked(r), "guardar los antecedentes y el consentimiento: 403", r.body);
r = await admin("POST", `${P}/notes`, note("Escrita por el soporte"));
ok(blocked(r), "registrar una evolución: 403", r.body);
r = await admin("POST", `${B}/clinical-notes/${noteId}/addenda`, { text: "Aclaración del soporte" });
ok(blocked(r), "añadir una aclaración: 403", r.body);
r = await admin("POST", `${P}/attachments`, { fileName: "Del soporte.pdf", contentType: "application/pdf", sizeBytes: pdf.length, description: "" });
ok(blocked(r) && !r.body.upload, "pedir la subida de un archivo: 403, sin enlace", r.body);
r = await admin("POST", `${B}/clinical-attachments/${pendingId}/complete`);
ok(blocked(r), "completar la subida del propietario: 403", r.body);
r = await admin("GET", `${B}/clinical-attachments/${fileId}/url`);
ok(blocked(r) && !r.body.url, "abrir el archivo del propietario: 403, sin enlace", r.body);
r = await admin("PATCH", `${B}/team/${elenaId}/clinical-access`, { access: true });
ok(blocked(r, ONLY_OWNER), "dar el acceso clínico a un miembro: 403 con su propio mensaje", r.body);
let after = snapshot();
ok(JSON.stringify(after) === JSON.stringify(before), "nada cambió: evoluciones, aclaraciones, archivos, antecedentes, actividad y el acceso de Elena", { before, after });
ok(sql(`select status from clinical_attachments where id = '${pendingId}'`) === "pending", "el archivo a medio subir sigue pendiente");

r = await ricardo("PATCH", `${B}/team/${elenaId}/clinical-access`, { access: true });
ok(r.status === 204, "el propietario sí le da el acceso a Elena", r.body);
before = snapshot();
r = await admin("PATCH", `${B}/team/${elenaId}/clinical-access`, { access: false });
ok(blocked(r, ONLY_OWNER), "quitárselo: 403 con su propio mensaje", r.body);
after = snapshot();
ok(after.elenaAccess === "t" && JSON.stringify(after) === JSON.stringify(before), "Elena lo conserva y la actividad no cambia", { before, after });

console.log("La actividad que ve el soporte");
const ownerClinical = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&limit=1000`)).body.entries as AuditLog[];
ok(ownerClinical.length > 0, "el propietario ve los eventos de la historia clínica", ownerClinical.length);
r = await admin("GET", `${B}/audit-logs?limit=1000`);
const seen = (r.body?.entries ?? []) as AuditLog[];
ok(r.status === 200 && seen.length > 0 && seen.every((l) => l.entityType !== "clinical_record"), "el soporte ve la actividad, sin ningún evento clínico", seen.filter((l) => l.entityType === "clinical_record").map((l) => l.summary));
ok(seen.some((l) => l.action === "team.clinical_access_granted" && /Elena/.test(l.summary)), "pero sí los cambios de acceso del equipo", seen.filter((l) => l.entityType === "team").map((l) => l.action));
r = await admin("GET", `${B}/audit-logs?entityType=clinical_record`);
ok(r.status === 200 && r.body.entries.length === 0, "ni filtrando por historia clínica", r.body);
r = await admin("GET", `${B}/audit-logs?action=clinical_record.attachment_opened`);
ok(r.status === 200 && r.body.entries.length === 0, "ni por la acción (los nombres de los archivos)", r.body);

console.log("Lo que muestra /admin");
r = await admin("GET", `/admin/businesses/${businessId}`);
ok(
  r.status === 200 && r.body.recentActivity.length > 0 && r.body.recentActivity.every((l: AuditLog) => l.entityType !== "clinical_record"),
  "la ficha del negocio en /admin: su actividad reciente sin eventos clínicos",
  r.body?.recentActivity?.filter((l: AuditLog) => l.entityType === "clinical_record").map((l: AuditLog) => l.summary),
);
r = await admin("GET", "/admin/audit-logs?scope=all&limit=1000");
ok(
  r.status === 200 && r.body.entries.length > 0 && r.body.entries.every((l: AuditLog) => l.entityType !== "clinical_record"),
  "la actividad de toda la plataforma, tampoco",
  r.body?.entries?.filter((l: AuditLog) => l.entityType === "clinical_record").map((l: AuditLog) => l.summary),
);
r = await admin("GET", `/admin/audit-logs?scope=all&entityType=clinical_record&businessId=${businessId}`);
ok(r.status === 200 && r.body.entries.length === 0, "ni filtrando por historia clínica", r.body);

console.log("Lo que el soporte sigue haciendo");
r = await admin("GET", `${B}/clinical-templates`);
ok(r.status === 200 && r.body.some((t: ClinicalTemplate) => t.id === "evolucion-general"), "listar los formatos", r.body);
r = await admin("GET", `${B}/clinical-templates?all=1`);
ok(r.status === 200 && r.body.length > 0, "también los desactivados (?all=1)", r.status);
const fields = [
  { id: "reason", type: "text", label: "Motivo", required: true },
  { id: "plan", type: "textarea", label: "Plan" },
];
r = await admin("POST", `${B}/clinical-templates`, { name: "Formato del soporte", description: "Lo crea el soporte", fields });
const own: ClinicalTemplate = r.body;
ok(r.status === 200 && own.businessId === businessId && own.version === 1, "crear un formato", r.body);
r = await admin("GET", `${B}/clinical-templates/${own.id}`);
ok(r.status === 200 && r.body.id === own.id, "verlo", r.body);
r = await admin("PUT", `${B}/clinical-templates/${own.id}`, { name: "Formato del soporte", description: "", fields: [...fields, { id: "notes", type: "textarea", label: "Notas" }] });
ok(r.status === 200 && r.body.version === 2, "adaptarlo (versión 2)", r.body);
r = await admin("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: false });
ok(r.status === 200 && r.body.isActive === false, "desactivarlo", r.body);
r = await admin("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: true });
ok(r.status === 200 && r.body.isActive === true, "y volver a activarlo", r.body);
r = await admin("PUT", `${B}/clinical-default-template`, { templateId: own.id });
ok(r.status === 200 && r.body.isDefault === true, "elegirlo como formato del negocio", r.body);
r = await ricardo("GET", `${B}/clinical-templates`);
ok(r.body.filter((t: ClinicalTemplate) => t.isDefault).map((t: ClinicalTemplate) => t.id).join() === own.id, "el propietario lo ve como el formato del negocio", r.body);
const templateLogs = (await ricardo("GET", `${B}/audit-logs?entityType=business&limit=1000`)).body.entries as AuditLog[];
ok(
  templateLogs.some((l) => l.action === "clinical_template.created" && /\(Super admin\)/.test(l.actorName)),
  "lo que cambia el soporte queda en la actividad",
  templateLogs.map((l) => `${l.actorName}: ${l.action}`),
);

r = await admin("PATCH", B, { clinicalRecordsEnabled: false });
ok(r.status === 200 && r.body.clinicalRecordsEnabled === false, "desactivar la historia clínica del negocio", r.body);
r = await ricardo("GET", P);
ok(r.status === 403 && /no está activada/.test(r.body.error.message), "desactivada, el propietario ve el aviso de siempre", r.body);
r = await admin("GET", P);
ok(blocked(r), "y el soporte, el mensaje de privacidad (no el de «no está activada»)", r.body);
r = await admin("PATCH", B, { clinicalRecordsEnabled: true });
ok(r.status === 200 && r.body.clinicalRecordsEnabled === true, "volver a activarla", r.body);
r = await admin("GET", `${B}/clients`);
ok(r.status === 200 && r.body.some((c: Client) => c.id === patient!.id), "listar los pacientes", r.status);

console.log("El propietario y el miembro autorizado, igual que antes");
r = await ricardo("GET", P);
ok(r.status === 200 && r.body.profile && r.body.attachments.some((a: { id: string }) => a.id === fileId), "el propietario lee la historia con su archivo", r.body);
r = await ricardo("POST", `${P}/notes`, note("Control del propietario"));
ok(r.status === 200 && r.body.data.reason === "Control del propietario", "registra una evolución", r.body);
r = await ricardo("GET", `${B}/clinical-attachments/${fileId}/url`);
ok(r.status === 200 && r.body.url, "abre el archivo", r.body);
r = await elena("GET", P);
ok(r.status === 200 && r.body.profile, "Elena, con el acceso que le dio el propietario, lee la historia", r.body);
r = await elena("POST", `${P}/notes`, note("Control de Elena"));
ok(r.status === 200 && /Elena/.test(r.body.authorName), "registra una evolución", r.body);
r = await elena("GET", `${B}/clinical-attachments/${fileId}/url`);
ok(r.status === 200 && r.body.url, "abre el archivo", r.body);
const opened = (await ricardo("GET", `${B}/audit-logs?action=clinical_record.attachment_opened&entityId=${patient!.id}`)).body.entries as AuditLog[];
ok(
  opened.length === 2 && opened.every((l) => !/\(Super admin\)/.test(l.actorName)),
  "sus aperturas quedan en la actividad (las dos, ninguna del soporte)",
  opened.map((l) => l.actorName),
);

done("de la historia clínica privada (spec 025)");
