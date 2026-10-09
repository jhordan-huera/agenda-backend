// Contraseñas gestionadas por el super admin. Cambiar el email de la cuenta pide la contraseña actual.
import pg from "pg";
import { businessInput, createBusinessWithOwner } from "./helpers/business.mjs";

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
const login = (a, email, password) => a("POST", "/auth/login", { email, password, remember: true });

console.log("Usuarios normales");
const owner = agent();
let r = await login(owner, "jhordan@demo.com", "demo1234");
const ownerId = r.body.userId;
const B = `/businesses/${r.body.businessId}`;
r = await owner("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "OtraClave1", confirmPassword: "OtraClave1" });
ok(r.status === 403 && /soporte/.test(r.body.error.message), "el propietario no puede cambiar su contraseña", r.body);
r = await owner("POST", `${B}/team`, { firstName: "X", lastName: "Y", email: "x@example.com", role: "staff" });
ok(r.status === 404, "el propietario ya no puede invitar (ruta eliminada)", r.status);
r = await agent()("POST", "/auth/forgot-password", { email: "jhordan@demo.com" });
ok(r.status === 404, "recuperación por enlace eliminada", r.status);

console.log("Cambiar el email de la cuenta");
const profile = { firstName: "Jhordan", lastName: "Demo", phone: "", avatarUrl: null };
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com" });
ok(r.status === 400 && /contraseña/.test(r.body.error.message), "sin la contraseña actual → 400", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", currentPassword: "OtraClave1" });
ok(r.status === 400 && /no es correcta/.test(r.body.error.message), "con una contraseña equivocada → 400", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", currentPassword: "demo1234" });
ok(r.status === 200 && r.body.email === "jhordan.nuevo@example.com", "con la contraseña actual sí", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", firstName: "Jhordan" });
ok(r.status === 200, "el resto del perfil se edita sin contraseña", r.body);
ok((await login(agent(), "jhordan.nuevo@example.com", "demo1234")).status === 200, "entra con el email nuevo y la misma contraseña");

console.log("Super admin");
const admin = agent();
await login(admin, "admin@demo.com", "demo1234");
r = await admin("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "AdminClave1", confirmPassword: "AdminClave1" });
ok(r.status === 204, "el super admin sí cambia su propia contraseña", r.body);

r = await admin("POST", "/admin/businesses", businessInput({ name: "Sin clave", slug: "sin-clave" }));
const sinClave = `/admin/businesses/${r.body.business?.id}/owner`;
r = await admin("POST", sinClave, { firstName: "Ana", lastName: "Bravo", email: "sinclave@example.com" });
ok(r.status === 400 && /contraseña/i.test(r.body.error.message), "propietario sin contraseña → 400", r.body);
r = await admin("POST", sinClave, { firstName: "Ana", lastName: "Bravo", email: "corta@example.com", password: "123" });
ok(r.status === 400 && /8 caracteres/.test(r.body.error.message), "contraseña corta → 400", r.body);
r = await createBusinessWithOwner(admin, { name: "Salón Nuevo", slug: "salon-nuevo" }, { firstName: "Rosa", lastName: "Nueva", email: "rosa@example.com", password: "RosaClave2026" });
ok(r.status === 200 && r.body.owner.email === "rosa@example.com" && !("temporaryPassword" in r.body.owner), "crear negocio y su propietario con la contraseña elegida", r.body);
const newBusinessId = r.body.business?.id;
const rosa = agent();
r = await login(rosa, "rosa@example.com", "RosaClave2026");
ok(r.status === 200 && r.body.businessId === newBusinessId, "el propietario entra con la contraseña elegida", r.body);

r = await createBusinessWithOwner(admin, { name: "Pedro Taller", slug: "pedro-taller" }, { firstName: "Pedro", lastName: "Sánchez", email: "pedro@demo.com", password: "PedroClave2026" });
ok(r.status === 200 && r.body.owner.email === "pedro@demo.com", "negocio para una cuenta existente sin negocio", r.body);
r = await login(agent(), "pedro@demo.com", "PedroClave2026");
ok(r.status === 200 && r.body.role === "owner", "la cuenta existente entra con la nueva contraseña", r.body);
r = await login(agent(), "pedro@demo.com", "demo1234");
ok(r.status === 401, "la contraseña anterior ya no sirve");

console.log("Cambiar contraseña de un usuario");
const users = (await admin("GET", "/admin/users")).body;
const miguel = users.find((u) => u.user.email === "miguel@demo.com").user;
const miguelSession = agent();
await login(miguelSession, "miguel@demo.com", "demo1234");
r = await admin("PUT", `/admin/users/${miguel.id}/password`, { password: "corta" });
ok(r.status === 400, "contraseña corta → 400", r.body);
r = await admin("PUT", `/admin/users/${miguel.id}/password`, { password: "MiguelClave2026" });
ok(r.status === 204, "el super admin pone la contraseña", r.body);
ok((await miguelSession("GET", "/auth/session")).body === null, "se cierran las sesiones abiertas del usuario");
r = await login(agent(), "miguel@demo.com", "MiguelClave2026");
ok(r.status === 200, "el usuario entra con la contraseña nueva");
const superAdminId = users.find((u) => u.user.email === "admin@demo.com").user.id;
r = await admin("PUT", `/admin/users/${superAdminId}/password`, { password: "Cualquiera123" });
ok(r.status === 403, "no se cambia así la de un super admin", r.body);
r = await owner("PUT", `/admin/users/${miguel.id}/password`, { password: "Hackeo12345" });
ok(r.status === 403, "un propietario no puede usar esa ruta", r.body);

console.log("Agregar miembros");
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Staff", email: "luis@example.com", role: "staff", password: "LuisClave2026" });
ok(r.status === 402 && r.body.error.code === "plan_limit", "plan Free (1 usuario) → límite del plan", r.body);
await admin("PUT", `/admin/businesses/${newBusinessId}/plan`, { plan: "pro" });
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Staff", email: "luis@example.com", role: "staff", password: "LuisClave2026" });
ok(r.status === 200 && r.body.role === "staff" && r.body.email === "luis@example.com", "agregar miembro con Pro", r.body);
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Otra", email: "luis@example.com", role: "admin", password: "LuisClave2026" });
ok(r.status === 409, "email repetido → 409", r.body);
r = await login(agent(), "luis@example.com", "LuisClave2026");
ok(r.status === 200 && r.body.businessId === newBusinessId && r.body.role === "staff", "el miembro entra con la contraseña elegida", r.body);
r = await rosa("GET", `/businesses/${newBusinessId}/team`);
ok(r.body?.length === 2, "el propietario ve al nuevo miembro", r.body?.length);

console.log("Emails");
// En el registro la contraseña queda oculta; el email que sale la lleva (ver security.test.ts).
const emails = (await admin("GET", "/admin/emails")).body;
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const secretOf = async (id) => (await db.query("select secret from notifications where id = $1", [id])).rows[0]?.secret;
const created = emails.find((e) => e.to === "rosa@example.com" && e.type === "business_created");
ok(
  created && /Contraseña: ••••••••/.test(created.body) && !/temporal|cambia la contraseña/i.test(created.body) && (await secretOf(created.id)) === "RosaClave2026",
  "alta de negocio: email con la contraseña elegida",
  created?.body,
);
const changed = emails.find((e) => e.to === "miguel@demo.com" && e.type === "password_reset");
ok(changed && (await secretOf(changed.id)) === "MiguelClave2026", "cambio de contraseña: email con la nueva", changed?.body);
const invite = emails.find((e) => e.to === "luis@example.com" && e.type === "team_invite");
ok(invite && (await secretOf(invite.id)) === "LuisClave2026", "miembro nuevo: email con su contraseña", invite?.body);
await db.end();
const audit = (await admin("GET", "/admin/audit-logs?scope=admin")).body.entries.map((l) => l.action);
ok(audit.includes("platform.user_password_changed") && audit.includes("platform.member_added"), "queda registrado en la auditoría", audit.slice(0, 6));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de contraseñas pasaron");
process.exitCode = failures ? 1 : 0;
