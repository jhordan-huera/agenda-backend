// Historia clínica y precio visible.
const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
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

console.log("Acceso");
const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // Clínica Dental (salud)
ok(rs.clinicalAccess === true, "el propietario tiene acceso clínico en su sesión", rs);
const B = `/businesses/${rs.businessId}`;
const clients = (await ricardo("GET", `${B}/clients`)).body;
let patient = null;
for (const c of clients) {
  const r = await ricardo("GET", `${B}/clients/${c.id}/clinical-record`);
  if (r.body?.profile || r.body?.notes?.length) { patient = { ...c, record: r.body }; break; }
}
ok(patient && patient.record.profile && Array.isArray(patient.record.notes), "el propietario lee la historia (datos demo)", patient?.record);
ok(!patient || /^\d{4}-\d{2}-\d{2}$|^$/.test(patient.record.profile.birthDate), "fechas de antecedentes en formato YYYY-MM-DD", patient?.record.profile);

const { a: elena, session: es } = await login("elena@demo.com"); // staff de la clínica
ok(es.clinicalAccess === false, "el staff no tiene acceso por defecto", es);
let r = await elena("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.status === 403, "el staff sin permiso no ve la historia", r.body);
r = await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: true });
ok(r.status === 204, "el propietario le da acceso", r.body);
ok((await elena("GET", "/auth/session")).body.clinicalAccess === true, "su sesión ya tiene acceso");
r = await elena("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.status === 200, "el staff autorizado ve la historia", r.status);
r = await ricardo("PATCH", `${B}/team/${rs.userId}/clinical-access`, { access: false });
ok(r.status === 403, "al propietario no se le puede quitar", r.body);

const { a: admin } = await login("admin@demo.com");
r = await admin("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.status === 200 && r.body.profile, "el super admin ve la historia en modo soporte", r.body);
r = await admin("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: true });
ok(r.status === 204, "el super admin puede dar acceso clínico", r.body);
r = await admin("GET", `${B}/clients`);
ok(r.status === 200, "pero sí gestiona el resto del negocio", r.status);

console.log("Registro");
r = await ricardo("PUT", `${B}/clients/${patient.id}/clinical-record/profile`, {
  documentId: "0102030405", birthDate: "1990-05-17", sex: "female", bloodType: "O+", emergencyContact: "Mamá 0999999999",
  allergies: "Penicilina", conditions: "", medications: "", surgeries: "", familyHistory: "", consentDate: "",
});
ok(r.status === 200 && r.body.birthDate === "1990-05-17" && r.body.consentDate === (patient.record.profile?.consentDate ?? "") && /Ricardo/.test(r.body.updatedByName), "guardar antecedentes", r.body);
const appts = (await ricardo("GET", `${B}/appointments?clientId=${patient.id}`)).body;
const other = clients.find((c) => c.id !== patient.id);
const otherAppt = (await ricardo("GET", `${B}/appointments?clientId=${other.id}`)).body[0];
const note = { appointmentId: null, date: "2026-10-04", reason: "Dolor en muela", findings: "Caries", diagnosis: "K02", treatment: "Obturación", indications: "", nextControl: "1 mes" };
if (otherAppt) {
  r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, { ...note, appointmentId: otherAppt.id });
  ok(r.status === 400 && /otro paciente/.test(r.body.error.message), "no se une a la cita de otro paciente", r.body);
}
r = await ricardo("POST", `${B}/clients/${patient.id}/clinical-record/notes`, { ...note, appointmentId: appts[0]?.id ?? null });
ok(r.status === 200 && r.body.reason === "Dolor en muela" && r.body.addenda.length === 0, "registrar evolución", r.body);
const noteId = r.body.id;
r = await elena("POST", `${B}/clinical-notes/${noteId}/addenda`, { text: "Paciente refiere mejoría." });
ok(r.status === 200 && r.body.addenda.length === 1 && /Elena/.test(r.body.addenda[0].authorName), "añadir aclaración (staff autorizado)", r.body);
r = await ricardo("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.body.notes[0].id === noteId && r.body.notes[0].addenda.length === 1, "la evolución aparece primero con su aclaración", r.body.notes[0]);
r = await ricardo("DELETE", `${B}/clients/${patient.id}`);
ok(r.status === 409 && /historia clínica/.test(r.body.error.message), "un paciente con historia no se puede eliminar", r.body);
r = await ricardo("PATCH", `${B}/team/${es.userId}/clinical-access`, { access: false });
r = await elena("GET", `${B}/clients/${patient.id}/clinical-record`);
ok(r.status === 403, "al retirar el permiso deja de verla", r.status);

console.log("Auditoría");
const logs = (await ricardo("GET", `${B}/audit-logs?entityType=clinical_record&entityId=${patient.id}`)).body;
const views = logs.filter((l) => l.action === "clinical_record.viewed");
ok(views.length === 3 && views.some((l) => /\(Super admin\)/.test(l.actorName)), "cada persona queda registrada una vez al consultar (Ricardo, Elena y el super admin)", views.map((l) => l.actorName));
ok(["clinical_record.profile_updated", "clinical_record.note_added", "clinical_record.addendum_added"].every((a) => logs.some((l) => l.action === a)), "cambios registrados", logs.map((l) => l.action));

console.log("Negocio sin historia clínica");
const { a: jhordan, session: js } = await login("jhordan@demo.com");
const JB = `/businesses/${js.businessId}`;
const jClient = (await jhordan("GET", `${JB}/clients`)).body[0];
r = await jhordan("GET", `${JB}/clients/${jClient.id}/clinical-record`);
ok(r.status === 403 && /no está activada/.test(r.body.error.message), "desactivada en negocios que no son de salud", r.body);
r = await jhordan("PATCH", JB, { clinicalRecordsEnabled: true });
ok(r.body?.clinicalRecordsEnabled === true, "el propietario la activa", r.body);
r = await jhordan("GET", `${JB}/clients/${jClient.id}/clinical-record`);
ok(r.status === 200 && r.body.profile === null && r.body.notes.length === 0, "historia vacía de un paciente nuevo", r.body);

console.log("Precio visible");
r = await jhordan("POST", `${JB}/services`, { name: "Sin precio público", description: "", durationMinutes: 30, price: 40, showPrice: false, location: "business", homeVisitFee: 0, isActive: true });
ok(r.status === 200 && r.body.showPrice === false, "servicio con precio oculto", r.body);
const service = r.body;
r = await jhordan("POST", `${JB}/appointments`, { clientId: jClient.id, serviceId: service.id, date: "2026-12-01", startTime: "20:00", durationMinutes: 30, price: 40, status: "confirmed", notes: "" });
const emails = (await jhordan("GET", `${JB}/notifications`)).body;
const conf = emails.find((e) => e.appointmentId === r.body.id);
ok(conf && !/Precio:/.test(conf.body), "el email al cliente no muestra el precio", conf?.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de historia clínica pasaron");
process.exitCode = failures ? 1 : 0;
