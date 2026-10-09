// Contraseñas: nadie elige ni ve la de otro. Las cuentas nuevas reciben un enlace de un solo uso para
// definirla; cualquier usuario cambia la suya desde su perfil; cambiar el email pide la contraseña.
import pg from "pg";
import { businessInput, createBusinessWithOwner, setPasswordWithLink, tokenOf } from "./helpers/business.mjs";

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
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

console.log("Cambiar la propia contraseña (cualquier usuario)");
const owner = agent();
let r = await login(owner, "jhordan@demo.com", "demo1234");
const ownerId = r.body.userId;
const B = `/businesses/${r.body.businessId}`;
const otherDevice = agent();
await login(otherDevice, "jhordan@demo.com", "demo1234");
r = await owner("POST", "/auth/change-password", { currentPassword: "mala", newPassword: "OtraClave-2026", confirmPassword: "OtraClave-2026" });
ok(r.status === 400 && /actual no es correcta/.test(r.body.error.message), "con la contraseña actual equivocada → 400", r.body);
r = await owner("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "Corta12", confirmPassword: "Corta12" });
ok(r.status === 400 && /10 caracteres/.test(r.body.error.message), "la nueva tiene al menos 10 caracteres", r.body);
r = await owner("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "OtraClave-2026", confirmPassword: "OtraClave-2026" });
ok(r.status === 204, "el propietario cambia su propia contraseña", r.body);
ok((await owner("GET", "/auth/session")).body?.userId === ownerId, "su sesión sigue abierta");
ok((await otherDevice("GET", "/auth/session")).body === null, "y se cierran las demás");
ok((await login(agent(), "jhordan@demo.com", "demo1234")).status === 401, "la anterior ya no sirve");
ok((await login(agent(), "jhordan@demo.com", "OtraClave-2026")).status === 200, "la nueva sí");
const staff = agent();
await login(staff, "miguel@demo.com", "demo1234");
r = await staff("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "MiguelClave-2026", confirmPassword: "MiguelClave-2026" });
ok(r.status === 204, "recepción también", r.body);
r = await owner("POST", `${B}/team`, { firstName: "X", lastName: "Y", email: "x@example.com", role: "staff" });
ok(r.status === 404, "el propietario no invita (lo hace el super admin)", r.status);
r = await agent()("POST", "/auth/forgot-password", { email: "jhordan@demo.com" });
ok(r.status === 404, "no hay recuperación por email sin el soporte", r.status);

console.log("Cambiar el email de la cuenta");
const profile = { firstName: "Jhordan", lastName: "Demo", phone: "", avatarUrl: null };
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com" });
ok(r.status === 400 && /contraseña/.test(r.body.error.message), "sin la contraseña actual → 400", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", currentPassword: "demo1234" });
ok(r.status === 400 && /no es correcta/.test(r.body.error.message), "con una contraseña equivocada → 400", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", currentPassword: "OtraClave-2026" });
ok(r.status === 200 && r.body.email === "jhordan.nuevo@example.com", "con la contraseña actual sí", r.body);
r = await owner("PUT", `/users/${ownerId}`, { ...profile, email: "jhordan.nuevo@example.com", firstName: "Jhordan" });
ok(r.status === 200, "el resto del perfil se edita sin contraseña", r.body);

console.log("Super admin");
const admin = agent();
await login(admin, "admin@demo.com", "demo1234");
r = await admin("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "AdminClave-2026", confirmPassword: "AdminClave-2026" });
ok(r.status === 204, "el super admin cambia su propia contraseña", r.body);
const changed = (await admin("GET", "/admin/audit-logs?scope=security")).body.entries;
ok(changed.some((l) => l.action === "session.password_changed"), "los cambios de contraseña quedan en los eventos de sesión", changed.slice(0, 3));

r = await admin("POST", "/admin/businesses", businessInput({ name: "Sin clave", slug: "sin-clave" }));
const sinClave = `/admin/businesses/${r.body.business?.id}/owner`;
r = await admin("POST", sinClave, { firstName: "Ana", lastName: "Bravo" });
ok(r.status === 400, "propietario sin email → 400", r.body);
r = await createBusinessWithOwner(admin, { name: "Salón Nuevo", slug: "salon-nuevo" }, { firstName: "Rosa", lastName: "Nueva", email: "rosa@example.com" });
ok(r.status === 200 && r.body.owner.email === "rosa@example.com" && !("password" in r.body.owner), "crear negocio y su propietario sin contraseña", r.body);
const newBusinessId = r.body.business?.id;
const rosaLink = r.body.passwordLink;
ok(rosaLink?.url.startsWith("http") && rosaLink.email === "rosa@example.com" && Date.parse(rosaLink.expiresAt) > Date.now(), "el super admin recibe el enlace para copiarlo", rosaLink);
r = await login(agent(), "rosa@example.com", "demo1234");
ok(r.status === 401, "la cuenta no entra hasta que la propietaria defina su contraseña", r.body);
r = await agent()("POST", "/auth/password-link/check", { token: "no-es-un-token-valido-123" });
ok(r.status === 404, "un enlace inventado no sirve", r.body);
r = await setPasswordWithLink(agent(), rosaLink, "RosaClave2026");
ok(r.status === 204, "define su contraseña con el enlace", r.body);
const rosa = agent();
r = await login(rosa, "rosa@example.com", "RosaClave2026");
ok(r.status === 200 && r.body.businessId === newBusinessId, "y entra con ella", r.body);

console.log("Enviar enlace para definir contraseña");
const users = (await admin("GET", "/admin/users")).body;
const laura = users.find((u) => u.user.email === "laura@demo.com").user;
const lauraSession = agent();
await login(lauraSession, "laura@demo.com", "demo1234");
r = await admin("POST", `/admin/users/${laura.id}/password-link`);
ok(r.status === 200 && r.body.email === "laura@demo.com", "el super admin envía el enlace", r.body);
const lauraLink = r.body;
ok((await lauraSession("GET", "/auth/session")).body?.userId === laura.id, "hasta que la defina, sus sesiones siguen abiertas");
ok((await login(agent(), "laura@demo.com", "demo1234")).status === 200, "y su contraseña actual sigue sirviendo");
await db.query("update password_setup_tokens set expires_at = now() - interval '1 minute' where user_id = $1 and used_at is null", [laura.id]);
r = await setPasswordWithLink(agent(), lauraLink, "LauraClave-2026");
ok(r.status === 404 && /caducó/.test(r.body.error.message), "un enlace caducado (60 minutos) no sirve", r.body);
r = await admin("POST", `/admin/users/${laura.id}/password-link`);
const lauraLink2 = r.body;
r = await setPasswordWithLink(agent(), lauraLink2, "LauraClave-2026");
ok(r.status === 204, "con un enlace nuevo, la define", r.body);
ok((await lauraSession("GET", "/auth/session")).body === null, "al definirla se cierran sus sesiones");
ok((await login(agent(), "laura@demo.com", "demo1234")).status === 401, "la anterior ya no sirve");
ok((await login(agent(), "laura@demo.com", "LauraClave-2026")).status === 200, "la nueva sí");
const superAdminId = users.find((u) => u.user.email === "admin@demo.com").user.id;
r = await admin("POST", `/admin/users/${superAdminId}/password-link`);
ok(r.status === 403, "no se envía así un enlace a la propia cuenta", r.body);
r = await rosa("POST", `/admin/users/${laura.id}/password-link`);
ok(r.status === 403, "un propietario no puede usar esa ruta", r.body);
r = await admin("PUT", `/admin/users/${laura.id}/password`, { password: "Cualquiera123" });
ok(r.status === 404, "el super admin ya no puede poner contraseñas", r.status);

console.log("Agregar miembros");
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Staff", email: "luis@example.com", role: "staff" });
ok(r.status === 402 && r.body.error.code === "plan_limit", "plan Free (1 usuario) → límite del plan", r.body);
await admin("PUT", `/admin/businesses/${newBusinessId}/plan`, { plan: "pro" });
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Staff", email: "luis@example.com", role: "staff" });
ok(r.status === 200 && r.body.member.role === "staff" && r.body.member.email === "luis@example.com" && r.body.passwordLink, "agregar miembro con Pro", r.body);
const luisLink = r.body.passwordLink;
r = await admin("POST", `/admin/businesses/${newBusinessId}/members`, { firstName: "Luis", lastName: "Otra", email: "luis@example.com", role: "admin" });
ok(r.status === 409, "email repetido → 409", r.body);
await setPasswordWithLink(agent(), luisLink, "LuisClave2026");
r = await login(agent(), "luis@example.com", "LuisClave2026");
ok(r.status === 200 && r.body.businessId === newBusinessId && r.body.role === "staff", "el miembro entra con la contraseña que definió", r.body);
r = await rosa("GET", `/businesses/${newBusinessId}/team`);
ok(r.body?.length === 2, "el propietario ve al nuevo miembro", r.body?.length);

console.log("Emails");
// En el registro el token del enlace queda oculto; el email que sale lo lleva (ver security.test.ts).
const emails = (await admin("GET", "/admin/emails")).body;
const secretOf = async (id) => (await db.query("select secret from notifications where id = $1", [id])).rows[0]?.secret;
const created = emails.find((e) => e.to === "rosa@example.com" && e.type === "business_created");
ok(
  created && /Definir mi contraseña: .*\/definir-contrasena\?token=••••••••/.test(created.body) && !/Contraseña:/.test(created.body) && (await secretOf(created.id)) === tokenOf(rosaLink),
  "alta de negocio: email con el enlace (60 minutos) y la página de reservas",
  created?.body,
);
ok(/60 minutos/.test(created?.body ?? "") && /book\/salon-nuevo/.test(created?.body ?? ""), "dice cuánto dura y trae la página de reservas", created?.body);
const resets = emails.filter((e) => e.to === "laura@demo.com" && e.type === "password_reset");
ok(resets.length === 2 && resets.every((e) => /token=••••••••/.test(e.body)), "enlace de contraseña: un email por cada enlace", resets.map((e) => e.body));
const invite = emails.find((e) => e.to === "luis@example.com" && e.type === "team_invite");
ok(invite && /token=••••••••/.test(invite.body) && (await secretOf(invite.id)) === tokenOf(luisLink), "miembro nuevo: email con su enlace", invite?.body);
await db.end();
const audit = (await admin("GET", "/admin/audit-logs?scope=admin")).body.entries.map((l) => l.action);
ok(audit.includes("platform.user_password_link") && audit.includes("platform.member_added"), "queda registrado en la auditoría", audit.slice(0, 6));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de contraseñas pasaron");
process.exitCode = failures ? 1 : 0;
