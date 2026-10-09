// Equipo de la plataforma: el super admin principal agrega a otros super admins para el soporte.
import { execFileSync } from "node:child_process";

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
const login = async (email, password = "demo1234") => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password, remember: true });
  return { a, session: r.body, status: r.status };
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

const { a: owner, session: ownerSession } = await login("admin@demo.com");
ok(ownerSession.platformRole === "super_admin" && ownerSession.platformOwner === true, "el super admin del seed es el principal", ownerSession);

console.log("Agregar");
let r = await owner("GET", "/admin/platform-admins");
ok(r.status === 200 && r.body.length === 1 && r.body[0].user.platformOwner && r.body[0].twoFactorEnabled === false, "lista del equipo (el principal primero)", r.body);
const helper = { firstName: "Sofía", lastName: "Soporte", email: "sofia.soporte@example.com", password: "Soporte-2026" };
r = await owner("POST", "/admin/platform-admins", helper);
ok(r.status === 200 && r.body.user.platformRole === "super_admin" && r.body.user.platformOwner === false, "el principal agrega un super admin", r.body);
const helperId = r.body.user.id;
r = await owner("POST", "/admin/platform-admins", helper);
ok(r.status === 409, "con un email que ya existe → 409", r.body);
r = await owner("POST", "/admin/platform-admins", { ...helper, email: "otro@example.com", password: "corta" });
ok(r.status === 400, "contraseña débil → 400", r.body);
const mail = sql(`select type || '|' || body || '|' || coalesce(secret, '') from notifications where to_email = '${helper.email}' order by created_at desc limit 1`);
ok(/^platform_admin_added\|/.test(mail) && mail.includes("••••••••") && !mail.split("|")[1].includes(helper.password), "le llega un email con sus datos (la contraseña no queda en el registro)", mail.slice(0, 120));

console.log("El nuevo super admin");
const { a: sofia, session: sofiaSession } = await login(helper.email, helper.password);
ok(sofiaSession.platformRole === "super_admin" && sofiaSession.platformOwner === false, "entra como super admin (no principal)", sofiaSession);
r = await sofia("GET", "/admin/stats");
ok(r.status === 200, "ve el panel de plataforma", r.status);
r = await sofia("GET", "/auth/two-factor");
ok(r.status === 200, "puede activar la verificación en dos pasos", r.body);
r = await sofia("POST", "/admin/platform-admins", { ...helper, email: "tercero@example.com" });
ok(r.status === 403 && /principal/.test(r.body.error.message), "no puede agregar a otros super admins", r.body);
r = await sofia("PATCH", `/admin/users/${ownerSession.userId}/active`, { isActive: false });
ok(r.status === 403, "no puede desactivar al principal", r.body);
r = await sofia("PUT", `/admin/users/${ownerSession.userId}/password`, { password: "Hackeo-2026" });
ok(r.status === 403, "ni cambiarle la contraseña", r.body);
r = await owner("POST", "/admin/platform-admins", { ...helper, firstName: "Tomás", email: "tomas.soporte@example.com" });
const tomasId = r.body.user.id;
r = await sofia("PATCH", `/admin/users/${tomasId}/active`, { isActive: false });
ok(r.status === 403 && /principal/.test(r.body.error.message), "ni desactivar a otro super admin", r.body);
const business = (await sofia("GET", "/admin/businesses")).body.find((row) => row.subscription?.plan === "free");
r = await sofia("PUT", `/admin/businesses/${business.business.id}/plan`, { plan: "pro" });
ok(r.status === 200 && r.body.plan === "pro", "sí gestiona negocios (p. ej. cambia un plan)", r.body);
await owner("PUT", `/admin/businesses/${business.business.id}/plan`, { plan: "free" });

console.log("El principal gestiona el equipo");
r = await owner("PUT", `/admin/users/${helperId}/password`, { password: "Nueva-Clave-2026" });
ok(r.status === 204, "cambia la contraseña de un super admin", r.body);
ok((await login(helper.email, helper.password)).status === 401 && (await sofia("GET", "/admin/stats")).status === 401, "la anterior deja de servir y se cierran sus sesiones");
const { a: sofia2 } = await login(helper.email, "Nueva-Clave-2026");
r = await owner("PATCH", `/admin/users/${tomasId}/active`, { isActive: false });
ok(r.status === 200 && r.body.isActive === false, "desactiva a un super admin", r.body);
ok((await login("tomas.soporte@example.com", helper.password)).status !== 200, "y ya no puede entrar");
r = await owner("PATCH", `/admin/users/${ownerSession.userId}/active`, { isActive: false });
ok(r.status === 403 && /propia cuenta/.test(r.body.error.message), "nadie se desactiva a sí mismo", r.body);
r = await owner("GET", "/admin/platform-admins");
const sofiaRow = r.body.find((row) => row.user.id === helperId);
ok(r.body.length === 3 && sofiaRow?.lastSignInAt && r.body.find((row) => row.user.id === tomasId)?.user.isActive === false, "la lista muestra el último acceso y quién está desactivado", r.body.map((row) => [row.user.email, row.user.isActive, row.lastSignInAt]));

console.log("Permisos y auditoría");
const { a: jhordan } = await login("jhordan@demo.com");
r = await jhordan("GET", "/admin/platform-admins");
ok(r.status === 403, "un usuario normal no ve el equipo", r.status);
const summaries = (await owner("GET", "/admin/audit-logs?limit=100")).body.entries.map((entry) => `${entry.actorName}: ${entry.summary}`);
ok(summaries.some((s) => /Admin Agenda360 \(Super admin\): Agregó a Sofía Soporte \(sofia.soporte@example.com\) como super admin/.test(s)), "agregar queda en la actividad", summaries.slice(0, 6));
ok(summaries.some((s) => s.startsWith("Sofía Soporte (Super admin):")), "lo que hace cada super admin queda con su nombre", summaries.slice(0, 8));
const error = sqlError(`update users set platform_owner = true where email = 'jhordan@demo.com'`);
ok(error && /platform_owner_check/.test(error), "la base no deja marcar como principal a quien no es super admin", error);
await sofia2("POST", "/auth/logout");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del equipo de la plataforma pasaron");
process.exitCode = failures ? 1 : 0;
