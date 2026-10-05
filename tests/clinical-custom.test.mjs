// Fase 2 de la historia clínica: formatos propios (planes de pago), formato por servicio y archivos.
import { execFileSync } from "node:child_process";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const ORIGIN = BASE.replace(/\/api$/, "");
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
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
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sqlError = (query) => {
  try {
    sql(query);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
};

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // Clínica Dental, plan Business
const B = `/businesses/${rs.businessId}`;
const setPlan = (plan) => sql(`update subscriptions set plan = '${plan}' where business_id = '${rs.businessId}'`);
setPlan("business");
const patient = (await ricardo("GET", `${B}/clients`)).body[0];
const { a: elena, session: es } = await login("elena@demo.com"); // staff de la clínica
await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: true });

console.log("Formatos propios");
const fields = [
  { id: "reason", type: "text", label: "Motivo", required: true },
  { id: "bleeding", type: "boolean", label: "Sangrado al sondaje" },
  { id: "pockets", type: "list", label: "Bolsas periodontales", columns: [{ id: "tooth", label: "Pieza", type: "text" }, { id: "depth", label: "Profundidad (mm)", type: "number" }] },
];
let r = await ricardo("POST", `${B}/clinical-templates`, { name: "Periodoncia", description: "Control periodontal", fields });
const own = r.body;
ok(r.status === 200 && own.businessId === rs.businessId && own.version === 1 && own.isActive && own.fields.length === 3, "el propietario crea un formato", r.body);
r = await ricardo("GET", `${B}/clinical-templates`);
ok(r.body[0]?.id === own.id, "los formatos propios aparecen primero", r.body.map((t) => t.id).slice(0, 3));
r = await elena("POST", `${B}/clinical-templates`, { name: "Del staff", description: "", fields });
ok(r.status === 403, "el staff (aunque tenga acceso clínico) no crea formatos", r.body);
r = await ricardo("POST", `${B}/clinical-templates`, { name: "Repetido", description: "", fields: [fields[0], { ...fields[1], id: "reason" }] });
ok(r.status === 400 && /repetido/i.test(r.body.error.message), "ids de campo repetidos → 400", r.body);
r = await ricardo("POST", `${B}/clinical-templates`, { name: "IMC roto", description: "", fields: [{ id: "bmi", type: "bmi", label: "IMC", weightField: "peso", heightField: "talla" }] });
ok(r.status === 400, "IMC sin peso ni talla → 400", r.body);
r = await ricardo("POST", `${B}/clinical-templates`, { name: "Vacío", description: "", fields: [] });
ok(r.status === 400, "sin campos → 400", r.body);

r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, {
  appointmentId: null,
  templateVersionId: own.versionId,
  data: { reason: "Control", bleeding: true, pockets: [{ tooth: "16", depth: "5" }] },
});
const noteV1 = r.body;
ok(r.status === 200 && noteV1.data.pockets[0].depth === 5, "se escriben evoluciones con el formato propio", r.body);

console.log("Versiones al editar");
const editedFields = [{ ...fields[0], label: "Motivo de la visita" }, fields[1], fields[2], { id: "plan", type: "textarea", label: "Plan" }];
r = await ricardo("PUT", `${B}/clinical-templates/${own.id}`, { name: "Periodoncia", description: "Control periodontal", fields: editedFields });
const v2 = r.body;
ok(r.status === 200 && v2.version === 2 && v2.versionId !== own.versionId && v2.fields.length === 4, "editar los campos crea la versión 2", r.body);
r = await ricardo("PUT", `${B}/clinical-templates/${own.id}`, { name: "Periodoncia", description: "Otra descripción", fields: editedFields });
ok(r.status === 200 && r.body.version === 2 && r.body.description === "Otra descripción", "cambiar sólo la descripción no crea versión", r.body);
r = await ricardo("PUT", `${B}/clinical-templates/${own.id}`, { name: "Periodoncia", description: "", fields: [{ ...fields[1], type: "text" }] });
ok(r.status === 400 && /otro tipo/.test(r.body.error.message), "no se cambia el tipo de un campo existente", r.body);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, { appointmentId: null, templateVersionId: own.versionId, data: { reason: "x" } });
ok(r.status === 409, "con la versión anterior → 409", r.body);
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.body.templateVersions[noteV1.templateVersionId]?.version === 1, "la evolución antigua conserva su versión 1", r.body.templateVersions[noteV1.templateVersionId]);
r = await ricardo("PUT", `${B}/clinical-templates/atencion-medica`, { name: "Mía", description: "", fields });
ok(r.status === 404 && /duplícalos/.test(r.body.error.message), "los formatos de la plataforma no se editan", r.body);
r = await ricardo("GET", `${B}/clinical-templates/atencion-medica`);
ok(r.status === 200 && r.body.businessId === null && r.body.fields.length > 10, "se puede leer uno de la plataforma (para duplicarlo)", r.body?.id);

console.log("Activar y desactivar");
r = await ricardo("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: false });
ok(r.status === 200 && r.body.isActive === false, "desactivar", r.body);
r = await ricardo("GET", `${B}/clinical-templates`);
ok(!r.body.some((t) => t.id === own.id), "no se ofrece al registrar evoluciones");
r = await ricardo("GET", `${B}/clinical-templates?all=1`);
ok(r.body.some((t) => t.id === own.id && t.isActive === false), "sí aparece en la gestión", r.body.map((t) => t.id));
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, { appointmentId: null, templateVersionId: v2.versionId, data: { reason: "x" } });
ok(r.status === 404, "no se puede escribir con un formato desactivado", r.body);
r = await ricardo("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: true });

console.log("Formato del negocio");
const defaults = (list) => list.filter((t) => t.isDefault).map((t) => t.id);
r = await ricardo("GET", `${B}/clinical-templates`);
const recommended = r.body.find((t) => t.recommended);
ok(recommended && defaults(r.body).join() === recommended.id, "sin elegir, es el recomendado para la especialidad (y sólo uno)", defaults(r.body));
r = await ricardo("GET", `${B}`);
ok(r.body.clinicalDefaultTemplateId === null, "el negocio aún no eligió ninguno", r.body.clinicalDefaultTemplateId);
r = await ricardo("PUT", `${B}/clinical-default-template`, { templateId: own.id });
ok(r.status === 200 && r.body.id === own.id && r.body.isDefault, "el propietario elige uno propio para todo el negocio", r.body);
r = await ricardo("GET", `${B}/clinical-templates`);
ok(defaults(r.body).join() === own.id, "la lista lo marca como el formato del negocio", defaults(r.body));
r = await ricardo("GET", `${B}`);
ok(r.body.clinicalDefaultTemplateId === own.id, "y el negocio lo guarda", r.body.clinicalDefaultTemplateId);
r = await elena("PUT", `${B}/clinical-default-template`, { templateId: "atencion-medica" });
ok(r.status === 403, "el staff no lo cambia", r.body);
r = await ricardo("PUT", `${B}/clinical-default-template`, { templateId: "no-existe" });
ok(r.status === 404, "uno que no existe → 404", r.body);
r = await ricardo("PUT", `${B}/clinical-default-template`, {});
ok(r.status === 400, "sin formato → 400", r.body);
const { a: lauraOwner, session: lauraSession } = await login("laura@demo.com");
r = await lauraOwner("PUT", `/businesses/${lauraSession.businessId}/clinical-default-template`, { templateId: own.id });
ok(r.status === 404 || r.status === 403, "el formato propio de otro negocio no se puede elegir", r.body);
r = await ricardo("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: false });
r = await ricardo("GET", `${B}/clinical-templates?all=1`);
ok(defaults(r.body).join() === recommended.id, "si se desactiva, se vuelve al recomendado", defaults(r.body));
r = await ricardo("GET", `${B}`);
ok(r.body.clinicalDefaultTemplateId === null, "y el negocio lo olvida", r.body.clinicalDefaultTemplateId);
r = await ricardo("PUT", `${B}/clinical-default-template`, { templateId: own.id });
ok(r.status === 400 && /Activa el formato/.test(r.body.error.message), "uno desactivado no se puede elegir", r.body);
r = await ricardo("PATCH", `${B}/clinical-templates/${own.id}/active`, { active: true });
setPlan("free");
r = await ricardo("PUT", `${B}/clinical-default-template`, { templateId: "atencion-medica" });
ok(r.status === 200 && r.body.isDefault, "elegir uno de la plataforma no depende del plan", r.body);
setPlan("business");
const slug = (await ricardo("GET", `${B}`)).body.slug;
r = await agent()("GET", `/public/businesses/${slug}`);
ok(r.status === 200 && !("clinicalDefaultTemplateId" in r.body.business), "la página pública no lo muestra", Object.keys(r.body.business ?? {}));
const templateLogs = (await ricardo("GET", `${B}/audit-logs?limit=50`)).body;
const summaries = templateLogs.entries.map((l) => l.summary);
ok(
  summaries.some((s) => /Eligió «Atención médica» como formato/.test(s)) && summaries.some((s) => /era el formato del negocio/.test(s)),
  "queda en la auditoría",
  summaries.slice(0, 8),
);

console.log("Plan Free");
setPlan("free");
r = await ricardo("POST", `${B}/clinical-templates`, { name: "Otro", description: "", fields });
ok(r.status === 402 && /Pro y Business/.test(r.body.error.message), "crear formatos → 402", r.body);
r = await ricardo("PUT", `${B}/clinical-templates/${own.id}`, { name: "Periodoncia", description: "", fields: editedFields });
ok(r.status === 402, "editarlos → 402", r.body);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, { appointmentId: null, templateVersionId: v2.versionId, data: { reason: "Sigue funcionando" } });
ok(r.status === 200, "los formatos que ya tenía se siguen usando", r.body);
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.body.attachmentAccess === "upgrade", "archivos: hay que mejorar el plan", r.body.attachmentAccess);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/attachments`, { fileName: "rx.pdf", contentType: "application/pdf", sizeBytes: 100, description: "" });
ok(r.status === 402, "subir archivos → 402", r.body);
setPlan("business");

console.log("Formato por servicio");
const service = (await ricardo("GET", `${B}/services`)).body[0];
const serviceBody = (patch) => ({ ...service, ...patch });
r = await ricardo("PUT", `${B}/services/${service.id}`, serviceBody({ clinicalTemplateId: "odontologia-consulta" }));
ok(r.status === 200 && r.body.clinicalTemplateId === "odontologia-consulta", "asignar un formato de la plataforma", r.body);
r = await ricardo("PUT", `${B}/services/${service.id}`, serviceBody({ clinicalTemplateId: own.id }));
ok(r.status === 200 && r.body.clinicalTemplateId === own.id, "o uno propio", r.body);
r = await ricardo("PUT", `${B}/services/${service.id}`, serviceBody({ clinicalTemplateId: "no-existe" }));
ok(r.status === 400, "uno que no existe → 400", r.body);
const { a: laura, session: ls } = await login("laura@demo.com");
const lauraService = (await laura("GET", `/businesses/${ls.businessId}/services`)).body[0];
r = await laura("PUT", `/businesses/${ls.businessId}/services/${lauraService.id}`, { ...lauraService, clinicalTemplateId: own.id });
ok(r.status === 400, "el formato propio de otro negocio → 400", r.body);
r = await ricardo("PUT", `${B}/services/${service.id}`, serviceBody({ clinicalTemplateId: null }));
ok(r.status === 200 && r.body.clinicalTemplateId === null, "quitarlo", r.body);

console.log("Archivos");
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.body.attachmentAccess === "available" && r.body.attachments.length === 0, "disponibles (almacenamiento local en las pruebas)", r.body.attachmentAccess);
const pdf = Buffer.from("%PDF-1.4 radiografía de prueba ".repeat(40));
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/attachments`, {
  fileName: "Radiografía panorámica.pdf",
  contentType: "application/pdf",
  sizeBytes: 999,
  description: "Panorámica inicial",
});
const { attachment, upload } = r.body ?? {};
ok(r.status === 200 && upload?.method === "PUT" && !/Radiograf/.test(upload.url), "pide la subida (la URL no lleva el nombre del archivo)", r.body);
let put = await fetch(ORIGIN + upload.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: pdf });
ok(put.status === 400, "con otro tipo de archivo → 400", put.status);
r = await ricardo("POST", `${B}/clinical-attachments/${attachment.id}/complete`);
ok(r.status === 409, "completar sin haber subido → 409", r.body);
put = await fetch(ORIGIN + upload.url, { method: "PUT", headers: upload.headers, body: pdf });
ok(put.status === 200, "el navegador sube el archivo", put.status);
put = await fetch(ORIGIN + upload.url, { method: "PUT", headers: upload.headers, body: pdf });
ok(put.status === 409, "no se puede sobrescribir", put.status);
// Cambia el primer carácter de la firma (el último no sirve: en base64 sus bits sobrantes se ignoran).
put = await fetch(ORIGIN + upload.url.replace(/\.(.)/, (_, c) => `.${c === "A" ? "B" : "A"}`), { method: "PUT", headers: upload.headers, body: pdf });
ok(put.status === 403, "un enlace manipulado → 403", put.status);
r = await ricardo("POST", `${B}/clinical-attachments/${attachment.id}/complete`);
ok(r.status === 200 && r.body.sizeBytes === pdf.length && r.body.fileName === "Radiografía panorámica.pdf", "queda subido con su tamaño real", r.body);
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.body.attachments.length === 1 && r.body.attachments[0].description === "Panorámica inicial", "aparece en la historia", r.body.attachments);
r = await elena("GET", `${B}/clinical-attachments/${attachment.id}/url`);
const download = await fetch(ORIGIN + r.body.url);
const downloaded = Buffer.from(await download.arrayBuffer());
ok(download.status === 200 && downloaded.equals(pdf) && download.headers.get("content-type") === "application/pdf", "el staff autorizado lo descarga", download.status);
await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: false });
r = await elena("GET", `${B}/clinical-attachments/${attachment.id}/url`);
ok(r.status === 403, "sin acceso clínico no", r.status);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/attachments`, { fileName: "notas.txt", contentType: "text/plain", sizeBytes: 10, description: "" });
ok(r.status === 400, "tipo no permitido → 400", r.body);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/attachments`, { fileName: "enorme.pdf", contentType: "application/pdf", sizeBytes: 30 * 1024 * 1024, description: "" });
ok(r.status === 400 && /15 MB/.test(r.body.error.message), "más de 15 MB → 400", r.body);
const error = sqlError(`update clinical_attachments set file_name = 'otro.pdf' where id = '${attachment.id}'`);
ok(error && /no se pueden modificar/.test(error), "un archivo no se modifica ni con SQL directo", error);
const other = (await ricardo("GET", `${B}/clients`)).body.find((c) => c.id !== patient.id);
sql(`delete from clinical_notes where client_id = '${other.id}'; delete from clinical_profiles where client_id = '${other.id}';`);
r = await ricardo("POST", `${B}/clients/${other.id}/clinical-record/attachments`, { fileName: "foto.jpg", contentType: "image/jpeg", sizeBytes: 5, description: "" });
await fetch(ORIGIN + r.body.upload.url, { method: "PUT", headers: r.body.upload.headers, body: Buffer.from("jpeg!") });
await ricardo("POST", `${B}/clinical-attachments/${r.body.attachment.id}/complete`);
r = await ricardo("DELETE", `${B}/clients/${other.id}`);
ok(r.status === 409, "un paciente con archivos no se puede eliminar", r.body);
const logs = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&entityId=${patient.id}`)).body.entries;
ok(logs.some((l) => l.action === "clinical_record.attachment_added" && /Radiografía panorámica/.test(l.summary)), "queda en la auditoría", logs.map((l) => l.summary));
ok(logs.some((l) => l.action === "clinical_record.attachment_opened" && /Radiografía panorámica/.test(l.summary) && l.actorName === "Elena Suárez"), "y también quién abrió el archivo", logs.map((l) => l.summary));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de formatos propios y archivos pasaron");
process.exitCode = failures ? 1 : 0;
