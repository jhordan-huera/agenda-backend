// Plantillas de historia clínica: formatos por especialidad, validación según la plantilla y versiones.
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { clinicalTemplateFieldsSchema } from "../src/shared/lib/validations/clinical.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
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

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // Clínica Dental
const B = `/businesses/${rs.businessId}`;
const patient = (await ricardo("GET", `${B}/clients`)).body[0];
const addNote = (templateVersionId, data, clientId = patient.id) =>
  ricardo("POST", `${B}/clients/${clientId}/clinical-record/notes`, { appointmentId: null, templateVersionId, data });

console.log("Plantillas disponibles");
let r = await ricardo("GET", `${B}/clinical-templates`);
const templates = r.body;
ok(r.status === 200 && templates.length === 11, "11 plantillas de la plataforma", templates?.map((t) => t.id));
ok(templates[0].id === "odontologia-consulta" && templates[0].recommended === true, "la de su especialidad (odontología) va primero y recomendada", templates.slice(0, 2));
ok(templates.filter((t) => t.recommended).length === 1 && templates.find((t) => t.id === "evolucion-general").recommended === false, "las demás no se recomiendan");
const invalid = templates.filter((t) => !clinicalTemplateFieldsSchema.safeParse(t.fields).success);
ok(invalid.length === 0, "todas las plantillas cumplen el esquema de campos", invalid.map((t) => [t.id, clinicalTemplateFieldsSchema.safeParse(t.fields).error?.issues[0]]));
const { a: elena } = await login("elena@demo.com");
r = await elena("GET", `${B}/clinical-templates`);
ok(r.status === 403, "el staff sin acceso clínico no las ve", r.status);
const byId = Object.fromEntries(templates.map((t) => [t.id, t]));

console.log("Evolución con la plantilla de atención médica");
const medical = byId["atencion-medica"];
r = await addNote(medical.versionId, {
  reason: "Dolor al tragar",
  current_illness: "Hace 4 días, tras comer un hueso.",
  temperature: "38,5",
  heart_rate: 92,
  pain: 7,
  exam_regions: ["Cuello", "Cabeza"],
  diagnoses: [{ description: "Caries dental, no especificada", cie10: "K02.9" }, { description: "", cie10: "" }],
  prescription: [{ quantity: "15", active_ingredient: "Acetaminofén", brand: "Analgan 1 g", instructions: "Cada 8 horas por 5 días" }],
  refuses_treatment: false,
  campo_inventado: "se descarta",
});
const medicalNote = r.body;
ok(r.status === 200, "se guarda", r.body);
ok(medicalNote.data.temperature === 38.5 && medicalNote.data.heart_rate === 92 && medicalNote.data.pain === 7, "números normalizados (\"38,5\" → 38.5)", medicalNote.data);
ok(JSON.stringify(medicalNote.data.exam_regions) === JSON.stringify(["Cabeza", "Cuello"]), "opciones múltiples en el orden de la plantilla", medicalNote.data.exam_regions);
ok(medicalNote.data.diagnoses.length === 1 && medicalNote.data.prescription[0].quantity === 15, "filas vacías descartadas y columnas numéricas convertidas", medicalNote.data);
ok(medicalNote.data.refuses_treatment === false, "«No» se guarda (no es un campo vacío)", medicalNote.data);
ok(!("campo_inventado" in medicalNote.data) && !("blood_pressure" in medicalNote.data), "sólo se guardan campos de la plantilla con contenido", Object.keys(medicalNote.data));

console.log("Odontograma, mapa del cuerpo y escalas (versión 2)");
const dental = byId["odontologia-consulta"];
ok(dental.version === 2 && dental.fields.some((f) => f.type === "odontogram"), "odontología trae odontograma", dental.fields.map((f) => f.type));
ok(byId["atencion-medica"].fields.some((f) => f.id === "injury_map" && f.type === "bodymap"), "atención médica trae el mapa de lesiones");
ok(byId["psicologia-escalas"]?.fields.filter((f) => f.type === "questionnaire").length === 2, "plantilla de escalas con PHQ-9 y GAD-7");
r = await addNote(dental.versionId, {
  reason: "Control",
  odontogram: { "16": { surfaces: { O: "caries", M: null }, note: "  vigilar  " }, "21": { whole: "corona" }, "48": {} },
});
ok(
  r.status === 200 && isDeepStrictEqual(r.body.data.odontogram, { "16": { surfaces: { O: "caries" }, note: "vigilar" }, "21": { whole: "corona" } }),
  "odontograma normalizado (sin piezas vacías)",
  r.body.data?.odontogram,
);
r = await addNote(dental.versionId, { reason: "x", odontogram: { "19": { whole: "corona" } } });
ok(r.status === 400 && /19 no existe/.test(r.body.error.message), "pieza inexistente → 400", r.body);
r = await addNote(dental.versionId, { reason: "x", odontogram: { "11": { surfaces: { X: "caries" } } } });
ok(r.status === 400, "superficie inválida → 400", r.body);
r = await addNote(byId["atencion-medica"].versionId, { reason: "Caída", injury_map: [{ view: "front", x: 0.4, y: 0.8, note: "Herida en rodilla" }] });
ok(r.status === 200 && r.body.data.injury_map[0].note === "Herida en rodilla", "marca en el mapa del cuerpo", r.body.data?.injury_map);
r = await addNote(byId["atencion-medica"].versionId, { reason: "x", injury_map: [{ view: "side", x: 2, y: 0 }] });
ok(r.status === 400, "marca fuera del mapa → 400", r.body);
const scales = byId["psicologia-escalas"];
r = await addNote(scales.versionId, { phq9: [1, 1, 1, 1, 1, 1, 1, 1, 1], gad7: [0, 0, 0, 0, 0, 0, 0] });
ok(r.status === 200 && r.body.data.phq9.length === 9, "cuestionarios completos", r.body);
r = await addNote(scales.versionId, { phq9: [1, 1, null, 1, 1, 1, 1, 1, 1] });
ok(r.status === 400 && /Responde las 9 preguntas/.test(r.body.error.message), "cuestionario a medias → 400", r.body);
r = await addNote(scales.versionId, { phq9: [5, 1, 1, 1, 1, 1, 1, 1, 1] });
ok(r.status === 400, "respuesta con puntos inexistentes → 400", r.body);

console.log("Validación según la plantilla");
r = await addNote(medical.versionId, { current_illness: "Sin motivo" });
ok(r.status === 400 && /Motivo de consulta/.test(r.body.error.message), "campo obligatorio vacío → 400", r.body);
r = await addNote(medical.versionId, { reason: "Fiebre", temperature: 60 });
ok(r.status === 400 && /Temperatura.*entre 30 y 45/.test(r.body.error.message), "número fuera de rango → 400", r.body);
r = await addNote(medical.versionId, { reason: "Fiebre", pain: 11 });
ok(r.status === 400 && /Dolor/.test(r.body.error.message), "escala fuera de rango → 400", r.body);
r = await addNote(medical.versionId, { reason: "Fiebre", exams_requested: ["Tomografía mágica"] });
ok(r.status === 400 && /Opción no válida/.test(r.body.error.message), "opción que no existe → 400", r.body);
r = await addNote(medical.versionId, { reason: "Fiebre", prescription: [{ quantity: "muchas", active_ingredient: "Ibuprofeno" }] });
ok(r.status === 400 && /Receta.*fila 1.*Cantidad/.test(r.body.error.message), "error en una fila de la lista → 400 con la fila", r.body);
r = await addNote(byId["evolucion-general"].versionId, { reason: "   ", findings: "" });
ok(r.status === 400, "nada completado → 400", r.body);
r = await addNote(byId["nota-libre"].versionId, {});
ok(r.status === 400 && /al menos un dato|Nota/.test(r.body.error.message), "nota libre vacía → 400", r.body);
r = await addNote("00000000-0000-4000-8000-000000000000", { reason: "x" });
ok(r.status === 404, "plantilla que no existe → 404", r.body);

console.log("Plantillas de otro negocio e inactivas");
const { session: ls } = await login("laura@demo.com");
const foreignVersion = crypto.randomUUID();
sql(`insert into clinical_templates (id, business_id, name, current_version_id) values ('propia-laura', '${ls.businessId}', 'Propia de Laura', '${foreignVersion}');
     insert into clinical_template_versions (id, template_id, version, name, fields) values ('${foreignVersion}', 'propia-laura', 1, 'Propia de Laura', '[{"id":"note","type":"textarea","label":"Nota"}]')`);
r = await ricardo("GET", `${B}/clinical-templates`);
ok(!r.body.some((t) => t.id === "propia-laura"), "no ve las plantillas de otro negocio");
r = await addNote(foreignVersion, { note: "intento" });
ok(r.status === 404, "ni puede escribir con ellas", r.body);
sql("update clinical_templates set is_active = false where id = 'estetica-procedimiento'");
r = await ricardo("GET", `${B}/clinical-templates`);
ok(!r.body.some((t) => t.id === "estetica-procedimiento"), "las desactivadas no aparecen");
r = await addNote(byId["estetica-procedimiento"].versionId, { procedure: "Bótox" });
ok(r.status === 404, "ni se pueden usar", r.body);

console.log("Versiones");
const freeV1 = byId["nota-libre"].versionId;
r = await addNote(freeV1, { note: "Escrita con la versión 1" });
const oldNoteId = r.body.id;
const freeV2 = sql(`insert into clinical_template_versions (template_id, version, name, fields) values ('nota-libre', 2, 'Nota libre', '[{"id":"note","type":"textarea","label":"Nota de la sesión","required":true},{"id":"mood","type":"scale","label":"Ánimo","min":0,"max":10}]') returning id`).split("\n")[0];
sql(`update clinical_templates set current_version_id = '${freeV2}' where id = 'nota-libre'`);
r = await addNote(freeV1, { note: "Con la versión vieja" });
ok(r.status === 409 && /Recarga/.test(r.body.error.message), "con la versión anterior → 409 (recargar)", r.body);
r = await addNote(freeV2, { note: "Versión nueva", mood: 8 });
ok(r.status === 200 && r.body.data.mood === 8, "con la versión vigente se guarda", r.body);
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
const record = r.body;
const oldNote = record.notes.find((n) => n.id === oldNoteId);
ok(
  record.templateVersions[oldNote.templateVersionId]?.version === 1 && record.templateVersions[oldNote.templateVersionId].fields[0].label === "Nota",
  "la evolución antigua se sigue mostrando con los campos de su versión",
  record.templateVersions[oldNote.templateVersionId],
);
ok(record.templateVersions[medicalNote.templateVersionId]?.templateId === "atencion-medica", "el historial trae cada versión usada", Object.values(record.templateVersions).map((v) => v.templateId));
const versionError = (() => {
  try {
    sql(`update clinical_template_versions set name = 'otro' where id = '${freeV1}'`);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
})();
ok(versionError && /no se modifica/.test(versionError), "una versión de plantilla no se puede modificar", versionError);

console.log("Auditoría");
const logs = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&entityId=${patient.id}`)).body;
ok(logs.some((l) => l.action === "clinical_record.note_added" && /Atención médica/.test(l.summary)), "el registro indica la plantilla", logs.map((l) => l.summary));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de plantillas clínicas pasaron");
process.exitCode = failures ? 1 : 0;
