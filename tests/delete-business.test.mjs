// El super admin elimina un negocio: se borran sus datos, sus archivos y las cuentas de su equipo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createBusinessWithOwner } from "./helpers/business.mjs";

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
const count = (query) => Number(sql(query));

const { a: admin } = await login("admin@demo.com");
const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // Clínica Dental: dueño + Elena (staff)
const { a: elena } = await login("elena@demo.com");
const { a: laura, session: ls } = await login("laura@demo.com"); // otro negocio: no se toca
const id = rs.businessId;
const B = `/businesses/${id}`;
const { name, slug } = (await admin("GET", `/admin/businesses/${id}`)).body.business;

console.log("Datos de la clínica antes de eliminarla");
sql(`update subscriptions set plan = 'business' where business_id = '${id}'`);
const patient = (await ricardo("GET", `${B}/clients`)).body[0];
let r = await ricardo("POST", `${B}/clinical-templates`, {
  name: "Control",
  description: "",
  fields: [{ id: "reason", type: "text", label: "Motivo", required: true }],
});
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, {
  appointmentId: null,
  templateVersionId: r.body.versionId,
  data: { reason: "Revisión" },
});
ok(r.status === 200, "evolución con un formato propio", r.body);
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/attachments`, {
  fileName: "rx.pdf",
  contentType: "application/pdf",
  sizeBytes: 20,
  description: "",
});
await fetch(ORIGIN + r.body.upload.url, { method: "PUT", headers: r.body.upload.headers, body: Buffer.from("%PDF-1.4 prueba") });
r = await ricardo("POST", `${B}/clinical-attachments/${r.body.attachment.id}/complete`);
ok(r.status === 200, "archivo subido", r.body);
const file = join(process.env.LOCAL_STORAGE_DIR, "historias-clinicas", sql(`select storage_path from clinical_attachments where business_id = '${id}'`));
ok(existsSync(file), "el archivo está en el almacenamiento");
const before = {
  appointments: count(`select count(*) from appointments where business_id = '${id}'`),
  notes: count(`select count(*) from clinical_notes where business_id = '${id}'`),
  businesses: count("select count(*) from businesses"),
  lauraAppointments: count(`select count(*) from appointments where business_id = '${ls.businessId}'`),
};
ok(before.appointments > 0 && before.notes > 0, "tiene citas e historias clínicas", before);

console.log("Subidas que nunca se completaron (las borra el cron)");
const { pool } = await import("../src/db/pool.ts");
const { deleteStalePendingAttachments } = await import("../src/services/clinical-attachment-service.ts");
const { deleteStalePendingReceipts } = await import("../src/services/payment-service.ts");
/** Un archivo en el almacenamiento local, como si el navegador lo hubiera subido. */
const putFile = (bucket, objectPath) => {
  const path = join(process.env.LOCAL_STORAGE_DIR, bucket, objectPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x");
  return path;
};
const stalePath = `${id}/${patient.id}/abandonado.pdf`;
sql(
  `insert into clinical_attachments (business_id, client_id, file_name, content_type, size_bytes, storage_path, uploaded_by_name, created_at)
   values ('${id}', '${patient.id}', 'abandonado.pdf', 'application/pdf', 10, '${stalePath}', 'Ricardo', now() - interval '2 days')`,
);
const staleFile = putFile("historias-clinicas", stalePath);
const receiptAppointment = sql(`select id from appointments where business_id = '${id}' order by date limit 1`);
const receiptPath = `${id}/${receiptAppointment}/abandonado.jpg`;
sql(
  `insert into payment_receipts (business_id, appointment_id, file_name, content_type, size_bytes, storage_path, created_at)
   values ('${id}', '${receiptAppointment}', 'transferencia.jpg', 'image/jpeg', 10, '${receiptPath}', now() - interval '2 days')`,
);
const receiptFile = putFile("comprobantes", receiptPath);
await deleteStalePendingAttachments();
await deleteStalePendingReceipts();
ok(
  !existsSync(staleFile) && count(`select count(*) from clinical_attachments where storage_path = '${stalePath}'`) === 0,
  "un archivo de la historia sin terminar de subir se borra del almacenamiento, no sólo de la base",
);
ok(
  !existsSync(receiptFile) && count(`select count(*) from payment_receipts where storage_path = '${receiptPath}'`) === 0,
  "y un comprobante sin terminar de subir, igual",
);
ok(existsSync(file), "el archivo ya subido sigue");

console.log("Quién puede y cómo se confirma");
r = await ricardo("DELETE", `/admin/businesses/${id}`, { confirmName: name });
ok(r.status === 403, "el propietario no puede → 403", r.body);
r = await admin("DELETE", `/admin/businesses/${id}`);
ok(r.status === 400, "sin el nombre → 400", r.body);
r = await admin("DELETE", `/admin/businesses/${id}`, { confirmName: "Otro negocio" });
ok(r.status === 400 && r.body.error.message.includes(name), "con otro nombre → 400 (y le dice cuál escribir)", r.body);
ok(count(`select count(*) from businesses where id = '${id}'`) === 1, "el negocio sigue ahí");
r = await admin("DELETE", "/admin/businesses/no-existe", { confirmName: name });
ok(r.status === 404, "un negocio que no existe → 404", r.body);

// Restos sin registro en las carpetas del negocio (y uno de otro negocio, que no se toca).
const orphans = [
  putFile("historias-clinicas", `${id}/sin-registro/resto.pdf`),
  putFile("comprobantes", `${id}/sin-registro/resto.jpg`),
  putFile("imagenes", `logos/${id}/logo-anterior.png`),
  putFile("imagenes", `profesionales/${id}/foto-anterior.png`),
];
const otherBusinessFile = putFile("historias-clinicas", `${ls.businessId}/otro/archivo.pdf`);

console.log("Eliminar");
r = await admin("DELETE", `/admin/businesses/${id}`, { confirmName: `  ${name.toUpperCase()} ` });
ok(r.status === 204, "con el nombre (sin importar mayúsculas ni espacios) → 204", r.body);
const left = (table, column = "business_id") => count(`select count(*) from ${table} where ${column} = '${id}'`);
const leftovers = Object.fromEntries(
  [
    "business_users", "professionals", "subscriptions", "clients", "services", "appointments", "schedules",
    "blocked_times", "notifications", "audit_logs", "plan_change_requests", "clinical_profiles", "clinical_notes",
    "clinical_note_addenda", "clinical_attachments", "clinical_templates",
  ].map((table) => [table, left(table)]),
);
ok(left("businesses", "id") === 0 && Object.values(leftovers).every((n) => n === 0), "no queda nada del negocio", leftovers);
ok(count("select count(*) from clinical_template_versions v where not exists (select 1 from clinical_templates t where t.id = v.template_id)") === 0, "ni versiones de sus formatos");
ok(!existsSync(file), "su archivo se borró del almacenamiento");
ok(!orphans.some((orphan) => existsSync(orphan)), "y todo lo que quedaba en sus carpetas, aunque no tuviera registro", orphans.filter((orphan) => existsSync(orphan)));
ok(existsSync(otherBusinessFile), "los archivos de otro negocio no se tocan");
ok(count("select count(*) from users where email in ('ricardo@demo.com', 'elena@demo.com', 'valeria@demo.com')") === 0, "las cuentas de su equipo se eliminan");
ok((await ricardo("GET", "/auth/session")).body === null && (await elena("GET", "/auth/session")).body === null, "y sus sesiones se cierran");
ok((await login("ricardo@demo.com")).session?.error?.code !== undefined, "ya no pueden iniciar sesión");
ok((await admin("GET", `/admin/businesses/${id}`)).body === null, "la ficha ya no existe");
ok((await agent()("GET", `/public/businesses/${slug}`)).body === null, "su página de reservas tampoco");
const logs = (await admin("GET", "/admin/audit-logs?scope=admin")).body.entries;
ok(logs.some((l) => l.action === "platform.business_deleted" && l.summary.includes(name) && /3 cuentas/.test(l.summary)), "queda en la actividad de la plataforma", logs.slice(0, 2));
r = await admin("DELETE", `/admin/businesses/${id}`, { confirmName: name });
ok(r.status === 404, "eliminarlo otra vez → 404", r.body);

console.log("El resto sigue igual");
ok(count("select count(*) from businesses") === before.businesses - 1, "sólo se eliminó ese negocio");
ok(count(`select count(*) from appointments where business_id = '${ls.businessId}'`) === before.lauraAppointments, "las citas de otro negocio siguen");
ok((await laura("GET", `/businesses/${ls.businessId}/clients`)).status === 200, "y su equipo sigue trabajando");
ok(count("select count(*) from users where platform_role = 'super_admin'") === 1, "el super admin sigue");
ok(count("select count(*) from clinical_templates where business_id is null") >= 11, "los formatos de la plataforma siguen");

console.log("El email queda libre");
r = await createBusinessWithOwner(
  admin,
  { name: "Clínica Nueva", category: "dentistry", slug },
  { firstName: "Ricardo", lastName: "Paredes", email: "ricardo@demo.com", password: "NuevaClave1" },
);
ok(r.status === 200 && r.body.owner.email === "ricardo@demo.com", "se puede crear otro negocio con ese email y ese enlace", r.body);

await pool.end();
if (failures) {
  console.log(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log("\nTodo bien");
