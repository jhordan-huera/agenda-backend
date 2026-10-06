import { createBusinessWithOwner } from "./helpers/business.mjs";
import { cedulaFor } from "./helpers/cedula.mjs";
// Pruebas de extremo a extremo contra la API de prueba.
const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
};

function agent() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    if (body && typeof body === "object" && "documentId" in body && body.documentId === undefined) body = { ...body, documentId: cedulaFor(body.email) };
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-Requested-With": "fetch",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(";");
      cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: res.status, body: json, setCookie: set };
  };
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

console.log("Salud y CSRF");
const anon = agent();
ok((await anon("GET", "/health")).body?.database === true, "health con base de datos");
ok((await anon("GET", "/auth/session")).body === null, "sin sesión → null");
ok((await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 403, "POST sin X-Requested-With → 403");
ok((await anon("GET", "/nope")).status === 404, "ruta inexistente → 404");

console.log("Login");
const owner = agent();
let r = await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "mala", remember: true });
ok(r.status === 401 && r.body.error.code === "unauthorized", "contraseña incorrecta → 401", r.body);
r = await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: true });
ok(r.status === 200 && r.body.role === "owner" && r.body.businessId, "login propietario", r.body);
ok(r.setCookie.some((c) => /HttpOnly/i.test(c) && /Expires=/i.test(c)), "cookie httpOnly persistente (recordarme)", r.setCookie);
const businessId = r.body.businessId;
const ownerId = r.body.userId;
r = await owner("GET", "/auth/session");
ok(r.body?.userId === ownerId, "sesión con cookie");

console.log("Lecturas del panel");
const B = `/businesses/${businessId}`;
for (const path of ["", "/professional", "/team", "/subscription", "/subscription/usage", "/clients", "/services", "/schedules", "/blocked-times", "/notifications", "/audit-logs"]) {
  r = await owner("GET", B + path);
  ok(r.status === 200, `GET ${path || "/"}`, r.body);
}
r = await owner("GET", `${B}/appointments?from=${today}&to=${addDays(today, 6)}`);
ok(r.status === 200 && Array.isArray(r.body) && r.body.every((a) => a.date >= today && /^\d\d:\d\d$/.test(a.startTime) && typeof a.price === "number"), "citas de la semana con formatos correctos", r.body?.[0]);
r = await owner("GET", `${B}/appointments?from=nope`);
ok(r.status === 400, "fecha inválida → 400", r.body);
r = await owner("GET", B);
ok(r.body.bookingSettings?.minNoticeHours === 24 && /Z$/.test(r.body.createdAt), "negocio con ajustes JSON y createdAt ISO", r.body);
r = await owner("GET", `/users/${ownerId}`);
ok(r.body?.email === "jhordan@demo.com" && !("passwordHash" in r.body) && !("password_hash" in r.body), "perfil sin hash de contraseña", r.body);

console.log("Clientes");
r = await owner("POST", `${B}/clients`, { name: "Cliente Prueba", documentId: cedulaFor("cliente-prueba"), email: "PRUEBA@Example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 200 && r.body.email === "prueba@example.com", "crear cliente (email normalizado)", r.body);
const clientId = r.body.id;
r = await owner("POST", `${B}/clients`, { name: "Duplicado", documentId: cedulaFor("duplicado"), email: "prueba@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 200, "dos clientes pueden compartir email (lo único es la cédula)", r.body);
r = await owner("POST", `${B}/clients`, { name: "X", email: "", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 400 && r.body.error.code === "validation", "validación del servidor → 400", r.body);
r = await owner("PUT", `${B}/clients/${clientId}`, { name: "Cliente Editado", documentId: cedulaFor("cliente-prueba"), email: "prueba@example.com", phone: "+593 99 000 1111", address: "", notes: "nota", isActive: true });
ok(r.body?.name === "Cliente Editado", "editar cliente", r.body);
r = await owner("GET", `${B}/clients/no-es-uuid`);
ok(r.status === 200 && r.body === null, "cliente con id inválido → null");

console.log("Servicios");
r = await owner("POST", `${B}/services`, { name: "Servicio Prueba", description: "", durationMinutes: 60, price: "19.5", isActive: true });
ok(r.status === 200 && r.body.price === 19.5 && r.body.durationMinutes === 60, "crear servicio (precio numérico)", r.body);
const serviceId = r.body.id;

console.log("Citas");
// Busca un hueco libre de 60 min en los próximos días, de 20:00 a 21:00 (fuera de la demo).
const appt = { clientId, serviceId, date: addDays(today, 3), startTime: "20:00", durationMinutes: 60, price: 19.5, status: "confirmed", notes: "" };
r = await owner("POST", `${B}/appointments`, appt);
ok(r.status === 200 && r.body.endTime === "21:00" && r.body.source === "dashboard", "crear cita", r.body);
const appointmentId = r.body.id;
r = await owner("POST", `${B}/appointments`, { ...appt, startTime: "20:30" });
ok(r.status === 409 && /Ya existe una cita de 20:00 – 21:00/.test(r.body.error.message), "cita solapada → 409", r.body);
r = await owner("POST", `${B}/appointments`, { ...appt, startTime: "21:00", durationMinutes: 180 });
ok(r.status === 200 && r.body.endTime === "24:00", "cita que termina a medianoche (24:00)", r.body);
const midnightId = r.body.id;
r = await owner("PUT", `${B}/appointments/${appointmentId}`, { ...appt, startTime: "19:00" });
ok(r.status === 200 && r.body.startTime === "19:00" && r.body.endTime === "20:00", "reprogramar cita", r.body);
r = await owner("PATCH", `${B}/appointments/${appointmentId}/status`, { status: "cancelled" });
ok(r.body?.status === "cancelled", "cancelar cita", r.body);
r = await owner("PATCH", `${B}/appointments/${appointmentId}/status`, { status: "inventado" });
ok(r.status === 400, "estado inválido → 400", r.body);
r = await owner("PATCH", `${B}/appointments/${midnightId}/status`, { status: "cancelled" });
r = await owner("DELETE", `${B}/services/${serviceId}`);
ok(r.status === 409, "borrar servicio con citas → 409", r.body);
r = await owner("GET", `${B}/notifications`);
const types = r.body.map((n) => n.type);
ok(types.includes("appointment_confirmed") && types.includes("appointment_updated") && types.includes("appointment_cancelled"), "emails de cita en la bandeja", types.slice(0, 6));
ok(r.body.every((n) => n.status === "queued" || n.status === "sent" || n.status === "failed") && "to" in r.body[0], "bandeja con estado y destinatario", r.body[0]);
r = await owner("GET", `${B}/audit-logs?entityType=appointment&entityId=${appointmentId}`);
ok(r.body.entries.length >= 3 && r.body.entries.some((l) => l.action === "appointment.rescheduled"), "auditoría de la cita", r.body.entries?.map((l) => l.action));

console.log("Horario y bloqueos");
r = await owner("GET", `${B}/schedules`);
const week = r.body.map(({ dayOfWeek, isActive, intervals }) => ({ dayOfWeek, isActive, intervals }));
r = await owner("PUT", `${B}/schedules`, week);
ok(r.status === 200 && r.body.length === 7 && Array.isArray(r.body[1].intervals), "guardar horario semanal", r.body?.[1]);
r = await owner("POST", `${B}/blocked-times`, { reason: "Trámite", allDay: false, startDate: addDays(today, 5), endDate: addDays(today, 5), startTime: "10:00", endTime: "11:00" });
ok(r.status === 200 && r.body.startTime === "10:00", "crear bloqueo", r.body);
r = await owner("DELETE", `${B}/blocked-times/${r.body.id}`);
ok(r.status === 204, "borrar bloqueo");

console.log("Negocio y slug");
r = await owner("PATCH", B, { bookingSettings: { ...(await owner("GET", B)).body.bookingSettings, maxAdvanceDays: 45 } });
ok(r.body?.bookingSettings?.maxAdvanceDays === 45, "actualizar ajustes de agenda", r.body);
r = await owner("PATCH", B, { slug: "estudio-bella" });
ok(r.status === 409, "slug en uso → 409", r.body);
r = await owner("GET", `/businesses/slug-availability?slug=nuevo-slug-libre&exclude=${businessId}`);
ok(r.body?.available === true, "slug disponible");
r = await owner("POST", `${B}/notifications/reminders`);
ok(r.status === 404, "los recordatorios ya no se piden desde el panel (los envía el cron)", r.body);

console.log("Aislamiento entre negocios y roles");
const laura = agent();
r = await laura("POST", "/auth/login", { email: "laura@demo.com", password: "demo1234", remember: false });
ok(r.status === 200 && !r.setCookie.some((c) => /Expires=/i.test(c)), "login sin recordarme → cookie de sesión", r.setCookie);
r = await laura("GET", `${B}/clients`);
ok(r.status === 403, "otro negocio no ve mis clientes → 403", r.body);
const staff = agent();
await staff("POST", "/auth/login", { email: "miguel@demo.com", password: "demo1234", remember: true });
r = await staff("POST", `${B}/services`, { name: "No permitido", description: "", durationMinutes: 30, price: 1, isActive: true });
ok(r.status === 403, "staff no gestiona servicios → 403", r.body);
r = await staff("DELETE", `${B}/clients/${clientId}`);
ok(r.status === 403, "staff no borra clientes → 403", r.body);
r = await staff("GET", `${B}/audit-logs`);
ok(r.status === 403, "staff no ve auditoría → 403");

console.log("Límites del plan Free (Laura)");
r = await laura("GET", "/auth/session");
const LB = `/businesses/${r.body.businessId}`;
const lauraBusinessId = r.body.businessId;
const supportAdmin = agent();
await supportAdmin("POST", "/auth/login", { email: "admin@demo.com", password: "demo1234", remember: true });
const member = { firstName: "Nuevo", lastName: "Miembro", email: "nuevo@example.com", role: "staff", password: "NuevoClave1" };
r = await supportAdmin("POST", `/admin/businesses/${lauraBusinessId}/members`, member);
ok(r.status === 402 && r.body.error.code === "plan_limit", "Free: 1 usuario → plan_limit", r.body);
r = await supportAdmin("PUT", `/admin/businesses/${lauraBusinessId}/plan`, { plan: "pro" });
ok(r.body?.plan === "pro" && r.body.currentPeriodEnd, "el super admin cambia a Pro", r.body);
r = await supportAdmin("POST", `/admin/businesses/${lauraBusinessId}/members`, member);
ok(r.status === 200 && r.body.role === "staff", "el super admin agrega un miembro con Pro", r.body);
const newMemberId = r.body.userId;
r = await supportAdmin("PUT", `/admin/businesses/${lauraBusinessId}/plan`, { plan: "free" });
ok(r.status === 409, "volver a Free con 2 usuarios → 409", r.body);
r = await laura("DELETE", `${LB}/team/${newMemberId}`);
ok(r.status === 204, "quitar miembro");
r = await agent()("POST", "/auth/login", { email: "nuevo@example.com", password: "NuevoClave1", remember: true });
ok(r.status === 401 || r.status === 403, "miembro quitado no entra");

console.log("Reserva pública");
const pub = agent();
r = await pub("GET", "/public/businesses/carolina-vega");
ok(r.status === 200 && r.body === null, "negocio suspendido no se expone");
r = await pub("GET", "/public/businesses/JHORDAN");
ok(r.body?.business?.slug === "jhordan" && r.body.busySlots.every((s) => !("clientId" in s)), "perfil público sin datos de clientes", Object.keys(r.body ?? {}));
const profile = r.body;
// Primer hueco disponible según la propia lógica de la app (se replica a mano: probar días y horas).
const service = profile.services.find((s) => s.durationMinutes === 60);
let booked = null;
outer: for (let d = 2; d < 20; d++) {
  const date = addDays(today, d);
  const dow = new Date(date + "T12:00:00Z").getUTCDay();
  const day = profile.schedules.find((s) => s.dayOfWeek === dow);
  if (!day?.isActive) continue;
  for (const interval of day.intervals) {
    for (let h = Number(interval.start.slice(0, 2)); h + 1 <= Number(interval.end.slice(0, 2)); h++) {
      const startTime = `${String(h).padStart(2, "0")}:${interval.start.slice(3)}`;
      const res = await pub("POST", "/public/businesses/jhordan/bookings", { documentId: undefined, serviceId: service.id, date, startTime, name: "Reserva Web", email: "web@example.com", phone: "+593 99 111 2222", notes: "" });
      if (res.status === 200) { booked = { res, date, startTime }; break outer; }
      if (res.status !== 409) { ok(false, "reserva pública inesperada", res.body); break outer; }
    }
  }
}
ok(booked && booked.res.body.serviceName === service.name && booked.res.body.emailSent === true, "reserva pública confirmada", booked?.res.body);
if (booked) {
  r = await pub("POST", "/public/businesses/jhordan/bookings", { documentId: undefined, serviceId: service.id, date: booked.date, startTime: booked.startTime, name: "Otra", email: "otra@example.com", phone: "+593 99 111 3333", notes: "" });
  ok(r.status === 409 && /acaba de ocuparse/.test(r.body.error.message), "misma hora otra vez → 409", r.body);
}
r = await pub("POST", "/public/businesses/jhordan/bookings", { documentId: undefined, serviceId: service.id, date: today, startTime: "23:00", name: "Tarde", email: "t@example.com", phone: "+593 99 111 4444", notes: "" });
ok(r.status === 409, "reserva con menos de 24 h → 409", r.body);

// La concurrencia de reservas la cubre concurrency.test.ts (con el límite por conexión sin gastar).

console.log("Super admin");
const admin = agent();
r = await admin("POST", "/auth/login", { email: "admin@demo.com", password: "demo1234", remember: true });
ok(r.body?.platformRole === "super_admin" && r.body.businessId === null, "login super admin", r.body);
r = await owner("GET", "/admin/stats");
ok(r.status === 403, "propietario no entra al panel admin → 403");
r = await admin("GET", "/admin/stats");
ok(r.status === 200 && r.body.businesses.total === 6 && r.body.signupsByMonth.length === 6, "estadísticas", r.body);
r = await admin("GET", "/admin/businesses");
ok(r.status === 200 && r.body.length === 6 && r.body[0].usage && r.body[0].owner, "listado de negocios", r.body?.[0]?.usage);
r = await admin("GET", `/admin/businesses/${businessId}`);
ok(r.body?.members?.length === 3 && r.body.recentActivity.length > 0, "detalle de negocio", Object.keys(r.body ?? {}));
r = await createBusinessWithOwner(admin, { name: "Negocio Admin", slug: "negocio-admin", plan: "pro" }, { firstName: "Dueño", lastName: "Nuevo", email: "dueno@example.com", password: "DuenoClave1" });
ok(r.status === 200 && r.body.business.slug === "negocio-admin", "crear negocio + propietario", r.body);
const newBusinessId = r.body.business?.id;
const newOwner = agent();
r = await newOwner("POST", "/auth/login", { email: "dueno@example.com", password: "DuenoClave1", remember: true });
ok(r.body?.role === "owner" && r.body.businessId === newBusinessId, "el nuevo propietario entra con la contraseña elegida", r.body);
r = await admin("PATCH", `/admin/businesses/${newBusinessId}/status`, { status: "suspended" });
ok(r.body?.status === "suspended", "suspender negocio", r.body);
r = await newOwner("GET", `/businesses/${newBusinessId}/clients`);
ok(r.status === 403 && /suspendido/.test(r.body.error.message), "negocio suspendido → 403", r.body);
r = await newOwner("GET", "/auth/session");
ok(r.body?.businessStatus === "suspended", "la sesión indica negocio suspendido", r.body);
r = await admin("PUT", `/admin/businesses/${newBusinessId}/plan`, { plan: "business" });
ok(r.body?.plan === "business", "cambiar plan desde admin", r.body);
r = await admin("GET", "/admin/users");
const pedro = r.body.find((u) => u.user.email === "pedro@demo.com");
ok(pedro && pedro.memberships.length === 0, "usuarios con membresías", pedro);
r = await admin("PATCH", `/admin/users/${pedro.user.id}/active`, { isActive: false });
ok(r.body?.isActive === false, "desactivar usuario", r.body);
const p = agent();
r = await p("POST", "/auth/login", { email: "pedro@demo.com", password: "demo1234", remember: true });
ok(r.status === 403 && /desactivada/.test(r.body.error.message), "usuario desactivado no entra", r.body);
r = await admin("PUT", `/admin/users/${pedro.user.id}/password`, { password: "PedroNueva1" });
ok(r.status === 204, "poner contraseña a un usuario", r.body);
r = await admin("GET", "/admin/audit-logs?scope=admin");
ok(r.body.entries.length > 0 && r.body.entries.every((l) => l.action.startsWith("platform.")), "auditoría de plataforma", r.body?.entries?.[0]);
r = await admin("GET", "/admin/emails");
ok(r.status === 200 && r.body.length > 0, "todos los emails", r.body?.length);
r = await admin("PUT", "/admin/settings", { allowPublicSignup: false, supportEmail: "ayuda@example.com", supportPhone: "099 406 0669" });
ok(r.body?.allowPublicSignup === false && r.body.supportPhone === "099 406 0669", "cerrar registro y poner el teléfono de soporte", r.body);
r = await admin("PUT", "/admin/settings", { allowPublicSignup: false, supportEmail: "ayuda@example.com", supportPhone: "llámame" });
ok(r.status === 400, "teléfono de soporte no válido → 400", r.body);
r = await p("POST", "/auth/login", { email: "pedro@demo.com", password: "PedroNueva1", remember: true });
ok(r.status === 403 && r.body.error.message.includes("ayuda@example.com o al WhatsApp 099 406 0669"), "el aviso de cuenta desactivada incluye el teléfono", r.body);

console.log("Registro y onboarding");
r = await anon("POST", "/auth/register", { firstName: "Ana", lastName: "Nueva", email: "ana@example.com", password: "Clave12345", confirmPassword: "Clave12345" });
ok(r.status === 403, "registro cerrado → 403", r.body);
await admin("PUT", "/admin/settings", { allowPublicSignup: true, supportEmail: "ayuda@example.com", supportPhone: "099 406 0669" });
r = await (await Promise.resolve(anon))("GET", "/public/platform-settings");
ok(r.body?.allowPublicSignup === true && r.body.supportPhone === "099 406 0669", "configuración pública (con el teléfono)", r.body);
const ana = agent();
r = await ana("POST", "/auth/register", { firstName: "Ana", lastName: "Nueva", email: "ana@example.com", password: "Clave12345", confirmPassword: "Clave12345" });
ok(r.status === 201 && r.body.businessId === null, "registro", r.body);
r = await ana("POST", "/auth/register", { firstName: "Ana", lastName: "Nueva", email: "ana@example.com", password: "Clave12345", confirmPassword: "Clave12345" });
ok(r.status === 409, "email repetido → 409");
const onboarding = {
  name: "Centro Ana", category: "psychology", timezone: "America/Guayaquil", phone: "", email: "", address: "", description: "",
  schedules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isActive: d !== 0, intervals: [{ start: "09:00", end: "17:00" }] })),
  firstService: { name: "Sesión", description: "", durationMinutes: 50, price: 30, isActive: true },
};
const [o1, o2] = await Promise.all([ana("POST", "/businesses", onboarding), ana("POST", "/businesses", onboarding)]);
ok([o1.status, o2.status].sort().join() === "200,409", "onboarding doble simultáneo: sólo uno crea", [o1.status, o2.status, o1.body?.error ?? o2.body?.error]);
r = await ana("GET", "/auth/session");
ok(r.body?.role === "owner" && r.body.businessId, "tras onboarding la sesión tiene negocio", r.body);
const AB = `/businesses/${r.body.businessId}`;
r = await ana("GET", `${AB}/services`);
ok(r.body?.length === 1, "primer servicio creado");
r = await ana("PUT", `/users/${(await ana("GET", "/auth/session")).body.userId}`, { firstName: "Ana", lastName: "Editada", email: "ana@example.com", phone: "", avatarUrl: "data:image/png;base64," + "A".repeat(600_000) });
ok(r.status === 200 && r.body.lastName === "Editada", "perfil con imagen de ~600 KB", r.body?.error);
r = await ana("GET", `${AB}/professional`);
ok(r.body?.displayName === "Ana Editada", "el profesional se actualiza con el perfil");

console.log("Contraseñas y sesiones");
r = await ana("POST", "/auth/change-password", { currentPassword: "Clave12345", newPassword: "OtraClave123", confirmPassword: "OtraClave123" });
ok(r.status === 403, "un usuario normal no cambia su contraseña", r.body);
r = await ana("POST", "/auth/forgot-password", { email: "ana@example.com" });
ok(r.status === 404, "sin recuperación por enlace");
r = await ana("POST", "/auth/logout");
ok(r.status === 204 && (await ana("GET", "/auth/session")).body === null, "cerrar sesión");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exitCode = failures ? 1 : 0;
