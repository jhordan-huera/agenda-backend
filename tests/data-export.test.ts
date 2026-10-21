// Descargar los datos del negocio (spec 028). Quién: el propietario se lleva todo el negocio y el rol
// Profesional sólo lo de su agenda (sus pacientes con la regla de «sólo sus pacientes» aunque el negocio
// esté en «todos», sus citas y, con acceso clínico, sus historias); el super admin en modo soporte, el
// administrador y la recepción reciben 403 en cada ruta, y sin sesión, 401. Que esté completo: recorriendo
// las partes, la suma coincide con el resumen y con la base, sin repetidos. Lo clínico: sin acceso o con la
// historia desactivada, nada; las evoluciones traen su formato; no quedan «Consultó la historia clínica»
// nuevos. Los archivos: el enlace sólo para pacientes que se lleva. La actividad: una entrada por descarga,
// con las cifras. Las respuestas: no-store y el límite de peticiones. Y la última descarga en /admin.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, BASE, checks, count, login, sql, type Reply } from "./helpers/harness.ts";
import { DATA_EXPORT_BLOCKED_MESSAGE } from "../src/shared/lib/constants/business.ts";
import type {
  AuditLog,
  DataExportAppointment,
  DataExportClient,
  DataExportClinicalPage,
  DataExportClinicalRecord,
  DataExportSummary,
  Professional,
} from "../src/shared/types/index.ts";

const { ok, done } = checks();
const ORIGIN = BASE.replace(/\/api$/, "");

let ipCounter = 20;
const nextIp = () => `203.0.113.${ipCounter++}`;
const as = (email: string) => login(email, { ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental (Business, historia activada)
const elena = await as("elena@demo.com"); // recepción
const valeria = await as("valeria@demo.com"); // rol Profesional, con acceso clínico
const admin = await as("admin@demo.com"); // super admin: en la clínica, modo soporte
const businessId: string = ricardo.session.businessId;
const ricardoId: string = ricardo.session.userId;
const valeriaId: string = valeria.session.userId;
const elenaId: string = elena.session.userId;
const B = `/businesses/${businessId}`;
const E = `${B}/export`;
const blocked = (r: Reply) => r.status === 403 && r.body?.error?.message === DATA_EXPORT_BLOCKED_MESSAGE;
const exportsOf = () => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'business.data_exported'`);
const auditCount = () => count(`select count(*) from audit_logs where business_id = '${businessId}'`);
const clinicalViews = () =>
  count(`select count(*) from audit_logs where business_id = '${businessId}'
           and action in ('clinical_record.viewed', 'clinical_record.attachment_opened')`);
const list = (ids: string[]) => (ids.length ? ids.map((id) => `'${id}'`).join(",") : "null");
const ids = (query: string) => sql(query).split("\n").filter(Boolean);
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

console.log("Preparación");
const professionals: Professional[] = (await ricardo("GET", `${B}/professionals`)).body;
const valeriaAgenda = professionals.find((p) => p.userId === valeriaId)!;
const ricardoAgenda = professionals.find((p) => p.userId === ricardoId)!;
const andresAgenda = professionals.find((p) => p.displayName === "Dr. Andrés Vega")!;
ok(valeriaAgenda && ricardoAgenda && andresAgenda && !andresAgenda.userId, "las tres agendas: Valeria, Ricardo y Andrés (sin usuario)", professionals.map((p) => p.displayName));
ok((await ricardo("GET", B)).body.professionalScope === "all", "la clínica está en «todos los pacientes»");
ok(valeria.session.clinicalAccess === true, "Valeria tiene acceso clínico");

const service = (await ricardo("GET", `${B}/services`)).body.find((s: { name: string }) => s.name === "Consulta odontológica");
const tag = Date.now().toString(36);
async function newClient(who: typeof ricardo, name: string) {
  const r = await who("POST", `${B}/clients`, {
    name,
    documentId: cedulaFor(`${name}-${tag}`),
    email: `${name.toLowerCase().replace(/\s+/g, ".")}.${tag}@correo.ec`,
    phone: "0991234567",
    address: "",
    notes: "",
    isActive: true,
  });
  if (r.status !== 200) throw new Error(`No se pudo crear a ${name}: ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}
const futureDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
async function newAppointment(clientId: string, professionalId: string, days: number) {
  const r = await ricardo("POST", `${B}/appointments`, {
    clientId, serviceId: service.id, date: futureDay(days), startTime: "06:00", durationMinutes: 30, price: 20,
    status: "confirmed", notes: "", homeVisit: null, isVirtual: false, professionalId,
  });
  if (r.status !== 200) throw new Error(`No se pudo agendar: ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}
// Un paciente sólo de la agenda de Andrés y otro sólo de la de Ricardo (los registra el propietario), y
// uno que registra Valeria sin citas: es suyo aunque no tenga ninguna.
const andresOnly = await newClient(ricardo, "Exclusivo Andres");
await newAppointment(andresOnly, andresAgenda.id, 120);
const ricardoOnly = await newClient(ricardo, "Exclusivo Ricardo");
await newAppointment(ricardoOnly, ricardoAgenda.id, 121);
const valeriaOwn = await newClient(valeria, "Registrado Por Valeria");
const valeriaPatient = sql(
  `select c.id from clients c where c.business_id = '${businessId}'
      and exists (select 1 from appointments a where a.client_id = c.id and a.professional_id = '${valeriaAgenda.id}' and not a.client_access_pending)
    order by c.name limit 1`,
);
ok(valeriaPatient !== "", "un paciente de la demo con citas en la agenda de Valeria", valeriaPatient);

// Historias: una evolución en el paciente de Andrés y los archivos (uno de un paciente de Valeria, otro del
// de Andrés y otro a medio subir, que no cuenta).
const general = (await ricardo("GET", `${B}/clinical-templates`)).body.find((t: { id: string }) => t.id === "evolucion-general");
let r = await ricardo("POST", `${B}/clients/${andresOnly}/clinical-record/notes`, {
  appointmentId: null, templateVersionId: general.versionId, data: { reason: "Control de Andrés" },
});
ok(r.status === 200, "el propietario registra una evolución al paciente de Andrés", r.body);
const pdf = Buffer.from("%PDF-1.4 radiografía de la descarga ".repeat(20));
async function upload(clientId: string, fileName: string, complete = true): Promise<string> {
  const res = await ricardo("POST", `${B}/clients/${clientId}/clinical-record/attachments`, {
    fileName, contentType: "application/pdf", sizeBytes: pdf.length, description: "",
  });
  await fetch(ORIGIN + res.body.upload.url, { method: "PUT", headers: res.body.upload.headers, body: pdf });
  if (complete) await ricardo("POST", `${B}/clinical-attachments/${res.body.attachment.id}/complete`);
  return res.body.attachment.id;
}
const valeriaFile = await upload(valeriaPatient, "Radiografía de Valeria.pdf");
const andresFile = await upload(andresOnly, "Radiografía de Andrés.pdf");
const pendingFile = await upload(valeriaPatient, "A medio subir.pdf", false);
ok(sql(`select string_agg(status, ',' order by file_name) from clinical_attachments where id in (${list([valeriaFile, andresFile, pendingFile])})`) === "pending,ready,ready", "dos archivos subidos y uno a medio subir");

// Volumen para recorrer varias partes: 520 pacientes más (sin citas: no son de Valeria), 60 de ellos con
// antecedentes, uno con 1.001 evoluciones (una parte no puede pasar de 1.000 salvo que sea un solo
// paciente), 1.100 citas canceladas en la agenda de Andrés y un paciente «Por verificar».
sql(`insert into clients (business_id, name, email, phone, created_by)
     select '${businessId}', 'Paciente Volumen ' || lpad(n::text, 3, '0'), 'volumen' || n || '@correo.ec', '099000' || lpad(n::text, 4, '0'), '${ricardoId}'
       from generate_series(1, 520) n`);
sql(`insert into clinical_profiles (business_id, client_id, allergies, updated_by_name)
     select business_id, id, 'Ninguna', 'Ricardo Paredes' from clients
      where business_id = '${businessId}' and name like 'Paciente Volumen %' and name <= 'Paciente Volumen 060'`);
const heavy = sql(`select id from clients where business_id = '${businessId}' and name = 'Paciente Volumen 030'`);
sql(`insert into clinical_notes (business_id, client_id, date, template_version_id, data, author_id, author_name)
     select '${businessId}', '${heavy}', current_date, '${general.versionId}', '{"reason":"Control"}'::jsonb, '${ricardoId}', 'Ricardo Paredes'
       from generate_series(1, 1001)`);
const bulkPatient = sql(`select id from clients where business_id = '${businessId}' and name = 'Paciente Volumen 500'`);
sql(`insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price)
     select '${businessId}', '${bulkPatient}', '${service.id}', '${andresAgenda.id}', current_date - n, '07:00', '07:30', 'cancelled', 20
       from generate_series(1, 1100) n`);
const claimed = sql(`update clients set claimed_client_id = '${valeriaPatient}' where business_id = '${businessId}' and name = 'Paciente Volumen 501' returning id`);

console.log("Nadie más descarga");
const ROUTES: [string, string][] = [
  ["GET", E],
  ["GET", `${E}/clients`],
  ["GET", `${E}/appointments`],
  ["GET", `${E}/clinical`],
  ["POST", `${E}/attachments/${valeriaFile}`],
];
const anonymous = agent({ ip: nextIp() });
let before = auditCount();
const rejected = async (who: typeof ricardo | typeof anonymous, expect: (r: Reply) => boolean) => {
  const replies = [];
  for (const [method, path] of ROUTES) replies.push(await who(method, path));
  return { all: replies.every(expect), replies: replies.map((reply) => [reply.status, reply.body?.error?.message, reply.body?.items?.length, reply.body?.url]) };
};
let result = await rejected(admin, blocked);
ok(result.all, "el super admin en modo soporte: 403 con el mensaje de privacidad en cada ruta, también la de pacientes", result.replies);
result = await rejected(elena, blocked);
ok(result.all, "la recepción: 403 en cada ruta", result.replies);
sql(`update business_users set role = 'admin' where business_id = '${businessId}' and user_id = '${elenaId}'`);
result = await rejected(elena, blocked);
ok(result.all, "un administrador: 403 en cada ruta", result.replies);
sql(`update business_users set role = 'staff' where business_id = '${businessId}' and user_id = '${elenaId}'`);
result = await rejected(anonymous, (reply) => reply.status === 401 && !reply.body?.items);
ok(result.all, "sin sesión: 401 en cada ruta", result.replies);
ok(auditCount() === before, "ningún intento rechazado deja rastro en la actividad", { before, after: auditCount() });
r = await (await as("andrea@demo.com"))("GET", E);
ok(r.status === 403, "un miembro de otro negocio: 403", r.body);

console.log("El propietario se lleva todo el negocio");
let views = clinicalViews();
let exports = exportsOf();
r = await ricardo("GET", E);
const summary: DataExportSummary = r.body;
const dbClients = ids(`select id from clients where business_id = '${businessId}'`);
const dbAppointments = ids(`select id from appointments where business_id = '${businessId}'`);
const dbRecords = ids(`select c.id from clients c where c.business_id = '${businessId}' and (
  exists (select 1 from clinical_profiles p where p.client_id = c.id) or exists (select 1 from clinical_notes n where n.client_id = c.id)
  or exists (select 1 from clinical_attachments a where a.client_id = c.id and a.status = 'ready'))`);
const dbFiles = count(`select count(*) from clinical_attachments where business_id = '${businessId}' and status = 'ready'`);
ok(
  r.status === 200 && summary.scope === "business" && summary.clinical === "included" && summary.business.slug === "dental-sonrisa" &&
    summary.exportedBy === "Ricardo Paredes" && Boolean(Date.parse(summary.exportedAt)),
  "el resumen: todo el negocio, con lo clínico, el negocio y quién descarga",
  r.body,
);
ok(
  summary.counts.clients === dbClients.length && summary.counts.appointments === dbAppointments.length &&
    summary.counts.clinicalRecords === dbRecords.length && summary.counts.attachments === dbFiles && dbFiles === 2,
  "las cifras del resumen son las de la base (el archivo a medio subir no cuenta)",
  { counts: summary.counts, db: { clients: dbClients.length, appointments: dbAppointments.length, records: dbRecords.length, files: dbFiles } },
);
ok(r.headers.get("cache-control") === "no-store", "la respuesta lleva Cache-Control: no-store", r.headers.get("cache-control"));
const policy = r.headers.get("ratelimit-policy") ?? "";
ok(/q=600/.test(policy) && /w=900/.test(policy), "y el límite de 600 peticiones cada 15 minutos", policy);
ok(exportsOf() === exports + 1, "la descarga queda una vez en la actividad", exportsOf() - exports);
const ownerLog = (await ricardo("GET", `${B}/audit-logs?action=business.data_exported&limit=1`)).body.entries[0] as AuditLog;
const number = (text: string) => Number(text.replace(/\./g, ""));
const match = /^Descargó los datos del negocio \(([\d.]+) pacientes, ([\d.]+) citas y ([\d.]+) historias clínicas\)$/.exec(ownerLog?.summary ?? "");
ok(
  match && number(match[1]) === dbClients.length && number(match[2]) === dbAppointments.length && number(match[3]) === dbRecords.length &&
    match[2].includes(".") && ownerLog.entityType === "business" && ownerLog.actorName === "Ricardo Paredes",
  "con las cifras y el punto de los miles: «Descargó los datos del negocio (… pacientes, 1.xxx citas y … historias clínicas)»",
  ownerLog,
);

/** Recorre una parte tras otra con el cursor; devuelve todo y el tamaño de cada respuesta. */
async function walk<T>(who: typeof ricardo, path: string) {
  const items: T[] = [];
  const pages: { items: number; bytes: number; noStore: boolean; status: number; notes?: number; patients?: number }[] = [];
  let cursor: string | null = null;
  const templateVersions: DataExportClinicalPage["templateVersions"] = {};
  do {
    const reply: Reply = await who("GET", `${path}${cursor ? `?cursor=${cursor}` : ""}`);
    if (reply.status !== 200) {
      pages.push({ items: 0, bytes: 0, noStore: false, status: reply.status });
      break;
    }
    items.push(...reply.body.items);
    Object.assign(templateVersions, reply.body.templateVersions ?? {});
    pages.push({
      items: reply.body.items.length,
      bytes: Buffer.byteLength(JSON.stringify(reply.body)),
      noStore: reply.headers.get("cache-control") === "no-store",
      status: reply.status,
      notes: (reply.body.items as DataExportClinicalRecord[]).reduce((sum, item) => sum + (item.notes?.length ?? 0), 0),
      patients: reply.body.items.length,
    });
    cursor = reply.body.nextCursor;
  } while (cursor);
  return { items, pages, templateVersions };
}
const SIX_MB = 6 * 1024 * 1024;
const distinct = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;

const clients = await walk<DataExportClient>(ricardo, `${E}/clients`);
ok(
  clients.pages.length === 2 && clients.pages[0].items === 500 && clients.pages.every((p) => p.noStore && p.bytes < SIX_MB),
  "los pacientes, de 500 en 500 (dos partes), sin caché y lejos de los 6 MB",
  clients.pages,
);
ok(
  clients.items.length === summary.counts.clients && distinct(clients.items) && sameSet(clients.items.map((c) => c.id), dbClients),
  "recorridas las partes: todos los pacientes de la base, sin repetidos",
  { got: clients.items.length, db: dbClients.length },
);
const exclusive = clients.items.find((c) => c.id === andresOnly);
ok(
  exclusive && exclusive.email.endsWith("@correo.ec") && !exclusive.email.includes("*") && /^\d{10}$/.test(exclusive.documentId) && exclusive.phone === "0991234567",
  "con el email, la cédula y el teléfono completos (son del negocio)",
  exclusive,
);
ok(clients.items.find((c) => c.id === claimed)?.pendingVerification === true && clients.items.filter((c) => c.pendingVerification).length >= 1, "el paciente «Por verificar» va marcado", clients.items.find((c) => c.id === claimed));

const appointments = await walk<DataExportAppointment>(ricardo, `${E}/appointments`);
ok(
  appointments.pages.length >= 2 && appointments.pages[0].items === 1000 && appointments.pages.every((p) => p.noStore && p.bytes < SIX_MB),
  "las citas, de 1000 en 1000, sin caché y lejos de los 6 MB",
  appointments.pages,
);
ok(
  appointments.items.length === summary.counts.appointments && distinct(appointments.items) && sameSet(appointments.items.map((a) => a.id), dbAppointments),
  "recorridas las partes: todas las citas de la base, sin repetidos",
  { got: appointments.items.length, db: dbAppointments.length },
);
const andresVisit = appointments.items.find((a) => a.clients[0] === "Exclusivo Andres" && a.status === "confirmed");
ok(
  andresVisit && andresVisit.professional === "Dr. Andrés Vega" && andresVisit.service === "Consulta odontológica" && andresVisit.startTime === "06:00" &&
    andresVisit.endTime === "06:30" && andresVisit.modality === "business" && andresVisit.price === 20 && andresVisit.paid === false,
  "cada cita con su paciente, la agenda, el servicio, las horas, la modalidad, el precio y si se pagó",
  andresVisit,
);

const clinical = await walk<DataExportClinicalRecord>(ricardo, `${E}/clinical`);
ok(
  clinical.pages.length >= 2 && clinical.pages.every((p) => p.noStore && p.bytes < SIX_MB && (p.patients ?? 0) <= 50) &&
    clinical.pages.every((p) => (p.notes ?? 0) <= 1000 || p.patients === 1),
  "las historias, de hasta 50 pacientes y 1.000 evoluciones por parte (salvo un paciente solo), sin caché",
  clinical.pages,
);
ok(
  clinical.items.length === summary.counts.clinicalRecords && sameSet(clinical.items.map((item) => item.client.id), dbRecords) &&
    new Set(clinical.items.map((item) => item.client.id)).size === clinical.items.length,
  "recorridas las partes: todas las historias de la base, sin repetidas",
  { got: clinical.items.length, db: dbRecords.length },
);
const heavyRecord = clinical.items.find((item) => item.client.id === heavy);
ok(heavyRecord?.notes.length === 1001 && clinical.pages.some((p) => p.patients === 1 && p.notes === 1001), "el paciente de 1.001 evoluciones va solo en su parte", clinical.pages);
const seeded = clinical.items.find((item) => item.notes.some((note) => note.data.odontogram));
const seededNote = seeded?.notes.find((note) => note.data.odontogram);
ok(
  seeded && seeded.profile?.allergies === "Penicilina" && seeded.profile.consentDate !== "" && seededNote &&
    clinical.templateVersions[seededNote.templateVersionId]?.fields.some((f) => f.type === "odontogram") && seededNote.serviceName &&
    seeded.notes.every((note, i, all) => i === 0 || `${all[i - 1].date}${all[i - 1].createdAt}` <= `${note.date}${note.createdAt}`),
  "con los antecedentes, el consentimiento y las evoluciones en orden, cada una con su formato (sus campos) y su servicio",
  { profile: seeded?.profile, note: seededNote, version: seededNote && clinical.templateVersions[seededNote.templateVersionId]?.name },
);
const notesInDb = count(`select count(*) from clinical_notes where business_id = '${businessId}'`);
ok(clinical.items.reduce((sum, item) => sum + item.notes.length, 0) === notesInDb, "todas las evoluciones de la base", notesInDb);
const andresRecord = clinical.items.find((item) => item.client.id === andresOnly);
ok(
  andresRecord?.notes[0]?.data.reason === "Control de Andrés" && andresRecord.attachments.map((a) => a.id).join() === andresFile,
  "y los datos de sus archivos (sin los que están a medio subir)",
  andresRecord,
);
ok(clinicalViews() === views, "leer las historias para la descarga no deja «Consultó la historia clínica»", { before: views, after: clinicalViews() });

console.log("Los archivos");
r = await ricardo("POST", `${E}/attachments/${andresFile}`);
const file = r.status === 200 ? await fetch(ORIGIN + r.body.url) : null;
ok(r.status === 200 && r.headers.get("cache-control") === "no-store" && file?.ok && Buffer.from(await file.arrayBuffer()).equals(pdf), "el propietario recibe el enlace firmado y descarga el archivo original", r.body);
r = await ricardo("POST", `${E}/attachments/${pendingFile}`);
ok(r.status === 404, "un archivo a medio subir: 404", r.body);
r = await ricardo("POST", `${E}/attachments/00000000-0000-4000-8000-000000000000`);
ok(r.status === 404, "un archivo que no existe: 404", r.body);
ok(clinicalViews() === views, "pedir los enlaces no deja «Abrió el archivo»", { before: views, after: clinicalViews() });
r = await ricardo("GET", `${E}/clients?cursor=no-es-un-id`);
ok(r.status === 400, "un cursor que no es de la descarga: 400", r.body);

console.log("Cada profesional se lleva lo suyo");
views = clinicalViews();
exports = exportsOf();
r = await valeria("GET", E);
const own: DataExportSummary = r.body;
const OWN_RULE = `(c.created_by = '${valeriaId}'
  or exists (select 1 from appointments a where a.client_id = c.id and a.professional_id = '${valeriaAgenda.id}' and not a.client_access_pending)
  or exists (select 1 from appointment_clients ac join appointments a on a.id = ac.appointment_id
              where ac.client_id = c.id and a.professional_id = '${valeriaAgenda.id}' and not a.client_access_pending and not ac.client_access_pending))`;
const valeriaClients = ids(`select c.id from clients c where c.business_id = '${businessId}' and ${OWN_RULE}`);
const valeriaAppointments = ids(`select id from appointments where business_id = '${businessId}' and professional_id = '${valeriaAgenda.id}'`);
ok(
  r.status === 200 && own.scope === "agenda" && own.clinical === "included" && own.exportedBy === "Valeria Cruz" &&
    own.counts.clients === valeriaClients.length && own.counts.appointments === valeriaAppointments.length &&
    own.counts.attachments === 1 && valeriaClients.length < dbClients.length,
  "Valeria: su agenda, con sus pacientes, sus citas y su archivo",
  { counts: own.counts, db: { clients: valeriaClients.length, appointments: valeriaAppointments.length } },
);
const ownClients = await walk<DataExportClient>(valeria, `${E}/clients`);
const ownIds = ownClients.items.map((c) => c.id);
ok(sameSet(ownIds, valeriaClients) && distinct(ownClients.items), "sus pacientes: los de sus citas y los que registró ella, aunque el negocio esté en «todos»", { got: ownIds.length, db: valeriaClients.length });
ok(
  ownIds.includes(valeriaOwn) && ownIds.includes(valeriaPatient) && !ownIds.includes(andresOnly) && !ownIds.includes(ricardoOnly) && !ownIds.includes(heavy),
  "ni un paciente sólo de Andrés, ni uno sólo de Ricardo, ni los del volumen",
  { valeriaOwn: ownIds.includes(valeriaOwn), andres: ownIds.includes(andresOnly), ricardo: ownIds.includes(ricardoOnly) },
);
const ownAppointments = await walk<DataExportAppointment>(valeria, `${E}/appointments`);
ok(
  sameSet(ownAppointments.items.map((a) => a.id), valeriaAppointments) && ownAppointments.items.every((a) => a.professional === "Dra. Valeria Cruz"),
  "sus citas: sólo las de su agenda, ninguna de Andrés ni de Ricardo",
  { got: ownAppointments.items.length, db: valeriaAppointments.length, others: ownAppointments.items.filter((a) => a.professional !== "Dra. Valeria Cruz").length },
);
const ownClinical = await walk<DataExportClinicalRecord>(valeria, `${E}/clinical`);
const ownRecords = ownClinical.items.map((item) => item.client.id);
ok(
  ownRecords.length === own.counts.clinicalRecords && ownRecords.every((id) => ownIds.includes(id)) && ownRecords.includes(valeriaPatient) &&
    !ownRecords.includes(andresOnly) && !ownRecords.includes(heavy),
  "sus historias: sólo de sus pacientes, ninguna del paciente de Andrés",
  { records: ownRecords.length, counts: own.counts.clinicalRecords },
);
ok(
  ownClinical.items.flatMap((item) => item.attachments.map((a) => a.id)).join() === valeriaFile,
  "y sólo el archivo de su paciente",
  ownClinical.items.flatMap((item) => item.attachments.map((a) => a.fileName)),
);
r = await valeria("POST", `${E}/attachments/${valeriaFile}`);
ok(r.status === 200 && r.body.url, "el enlace del archivo de su paciente", r.body);
r = await valeria("POST", `${E}/attachments/${andresFile}`);
ok(r.status === 404 && !r.body.url, "el del paciente de Andrés: 404, como si no existiera", r.body);
ok(clinicalViews() === views, "sin «Consultó la historia clínica» ni «Abrió el archivo»", { before: views, after: clinicalViews() });
const valeriaLog = (await ricardo("GET", `${B}/audit-logs?action=business.data_exported&limit=1`)).body.entries[0] as AuditLog;
ok(
  exportsOf() === exports + 1 && valeriaLog.actorName === "Valeria Cruz" &&
    valeriaLog.summary === `Descargó sus datos (${own.counts.clients} pacientes, ${own.counts.appointments} citas y ${own.counts.clinicalRecords === 1 ? "1 historia clínica" : `${own.counts.clinicalRecords} historias clínicas`})`,
  "su descarga queda una vez en la actividad, con su nombre: «Descargó sus datos (…)»",
  valeriaLog,
);

console.log("Sin acceso clínico, ni historias ni archivos");
r = await ricardo("PATCH", `${B}/team/${valeriaId}/clinical-access`, { access: false });
ok(r.status === 204, "el propietario le quita el acceso clínico a Valeria", r.body);
r = await valeria("GET", E);
ok(r.status === 200 && r.body.clinical === "no_access" && r.body.counts.clinicalRecords === 0 && r.body.counts.attachments === 0, "el resumen dice que no lleva historias", r.body);
const noClinicalLog = (await ricardo("GET", `${B}/audit-logs?action=business.data_exported&limit=1`)).body.entries[0] as AuditLog;
ok(/^Descargó sus datos \([\d.]+ pacientes? y [\d.]+ citas?\)$/.test(noClinicalLog.summary), "y la actividad, sólo pacientes y citas", noClinicalLog.summary);
r = await valeria("GET", `${E}/clinical`);
ok(r.status === 403 && !r.body.items && /acceso a las historias/.test(r.body.error.message), "las historias: 403", r.body);
r = await valeria("POST", `${E}/attachments/${valeriaFile}`);
ok(r.status === 403 && !r.body.url, "los archivos: 403", r.body);
r = await valeria("GET", `${E}/clients`);
ok(r.status === 200 && r.body.items.length > 0, "los pacientes y las citas, sí", r.status);
await ricardo("PATCH", `${B}/team/${valeriaId}/clinical-access`, { access: true });

console.log("Con la historia desactivada");
await ricardo("PATCH", B, { clinicalRecordsEnabled: false });
r = await ricardo("GET", E);
ok(r.status === 200 && r.body.clinical === "disabled" && r.body.counts.clinicalRecords === 0, "el propietario: sin historias", r.body);
r = await ricardo("GET", `${E}/clinical`);
ok(r.status === 403 && /no está activada/.test(r.body.error.message), "las historias: 403", r.body);
await ricardo("PATCH", B, { clinicalRecordsEnabled: true });

console.log("La última descarga en /admin");
r = await admin("GET", `/admin/businesses/${businessId}`);
const last = sql(`select to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from audit_logs where business_id = '${businessId}' and action = 'business.data_exported'`);
ok(r.status === 200 && r.body.lastDataExportAt === last, "la ficha del negocio trae la fecha de la última descarga", { got: r.body.lastDataExportAt, db: last });
r = await admin("GET", `/admin/businesses/${(await as("jhordan@demo.com")).session.businessId}`);
ok(r.status === 200 && r.body.lastDataExportAt === null, "y null en un negocio que nunca descargó", r.body.lastDataExportAt);

console.log("El límite de peticiones");
const visitor = agent({ ip: nextIp() });
const statuses: number[] = [];
for (let i = 0; i < 601; i++) statuses.push((await visitor("GET", `${E}/clients`)).status);
ok(statuses.slice(0, 600).every((s) => s === 401) && statuses[600] === 429, "la petición 601 en 15 minutos desde la misma conexión: 429", statuses.slice(595));
r = await visitor("POST", `${E}/attachments/${valeriaFile}`);
ok(r.status === 429, "el límite lo comparten todas las rutas de la descarga", r.status);

done("de la descarga de los datos (spec 028)");
