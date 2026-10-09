// Endurecimiento: enlaces para definir la contraseña fuera del registro de emails, bloqueo por intentos fallidos,
// CAPTCHA de la página de reservas, perfil público sin datos internos y seed sólo en local.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { outgoingContent } from "../src/services/mailer.ts";
import { createBusinessWithOwner, setPasswordWithLink, tokenOf } from "./helpers/business.mjs";
import { composeEmail } from "../src/shared/lib/email/layout.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
};

type Call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
function agent(base = BASE): Call {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
/** Visitante desde la IP indicada (como la reenvía el proxy del frontend). */
const fromIp = (ip: string) => ({ "x-agendo-proxy-secret": process.env.PROXY_SECRET!, "x-agendo-client-ip": ip });
const login = (a: Call, email: string, password: string, ip: string) =>
  a("POST", "/auth/login", { email, password, remember: false }, fromIp(ip));
let ipCounter = 1;
const nextIp = () => `203.0.113.${ipCounter++}`;

const admin = agent();
await login(admin, "admin@demo.com", "demo1234", nextIp());

console.log("Enlaces para definir la contraseña fuera del registro de emails");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const ownerPassword = "ClaveSecreta-2026";
let r = await createBusinessWithOwner(
  admin,
  { plan: "pro", name: "Salón Seguro", slug: "salon-seguro" },
  { firstName: "Sara", lastName: "Segura", email: "sara@example.com" },
);
ok(r.status === 200 && r.body.passwordLink?.email === "sara@example.com", "crear negocio: el super admin recibe el enlace (para copiarlo)", r.body);
const businessId = r.body.business.id;
const ownerToken = tokenOf(r.body.passwordLink)!;
ok(/^[\w-]{43}$/.test(ownerToken), "el token es de 32 bytes aleatorios (base64url)", ownerToken);
const emails = (await admin("GET", "/admin/emails")).body;
const created = emails.find((e: any) => e.type === "business_created" && e.to === "sara@example.com");
ok(
  created && created.body.includes("/definir-contrasena?token=••••••••") && !/Contraseña:/.test(created.body),
  "el email guardado lleva el enlace con el token oculto, sin contraseña",
  created?.body,
);
ok(!JSON.stringify(emails).includes(ownerToken), "el registro de emails no tiene el token");
let row = (await db.query("select body, html, secret from notifications where id = $1", [created.id])).rows[0];
ok(row.secret === ownerToken, "el token queda aparte hasta que se envía el email");
ok(!row.body.includes(ownerToken) && !row.html.includes(ownerToken), "ni el texto ni el HTML guardados lo llevan");
let outgoing = outgoingContent(row);
ok(
  outgoing.text.includes(`/definir-contrasena?token=${ownerToken}`) && !outgoing.text.includes("••••••••"),
  "el email que sale lleva el enlace real",
  outgoing.text,
);
ok(outgoing.html!.split(`token=${ownerToken}`).length >= 3 && !outgoing.html!.includes("••••••••"), "también en el HTML (botón y enlace alternativo)");
const tricky = "A$&b<c>'d";
outgoing = outgoingContent({ ...row, secret: tricky });
ok(outgoing.html!.includes("A$&amp;b&lt;c&gt;&#39;d"), "lo que reemplaza al token va escapado en el HTML");
const stored = await db.query("select token_hash, expires_at - created_at as ttl, used_at from password_setup_tokens where token_hash = $1", [sha256(ownerToken)]);
ok(stored.rowCount === 1 && stored.rows[0].used_at === null, "en la base sólo queda el hash SHA-256 del token");
ok(stored.rows[0].ttl.hours === 1 || stored.rows[0].ttl.minutes === 60, "caduca a los 60 minutos", stored.rows[0].ttl);
ok((await db.query("select 1 from password_setup_tokens where token_hash = $1", [ownerToken])).rowCount === 0, "nunca el token en claro");

r = await agent()("POST", "/auth/password-link/check", { token: ownerToken });
ok(r.status === 200 && r.body.email === "sara@example.com" && r.body.firstName === "Sara", "la página del enlace sabe a quién es (sin sesión)", r.body);
r = await agent()("POST", "/auth/password-link", { token: ownerToken, password: "corta", confirmPassword: "corta" });
ok(r.status === 400 && /10 caracteres/.test(r.body.error.message), "mínimo 10 caracteres", r.body);
r = await agent()("POST", "/auth/password-link", { token: ownerToken, password: ownerPassword, confirmPassword: ownerPassword });
ok(r.status === 204, "el propietario define su contraseña con el enlace", r.body);
r = await agent()("POST", "/auth/password-link", { token: ownerToken, password: "OtraClaveMas-1", confirmPassword: "OtraClaveMas-1" });
ok(r.status === 404, "el enlace sirve una sola vez", r.body);
ok((await db.query("select used_at from password_setup_tokens where token_hash = $1", [sha256(ownerToken)])).rows[0]?.used_at, "y queda marcado como usado");

r = await admin("POST", `/admin/businesses/${businessId}/members`, {
  firstName: "Tito",
  lastName: "Equipo",
  email: "tito@example.com",
  role: "staff",
  password: "ClaveDelEquipo-77",
});
ok(r.status === 200 && r.body.member.email === "tito@example.com" && r.body.passwordLink, "añadir miembro (la contraseña que mande el super admin se ignora)", r.body);
const titoToken = tokenOf(r.body.passwordLink)!;
r = await login(agent(), "tito@example.com", "ClaveDelEquipo-77", nextIp());
ok(r.status === 401, "nadie puede entrar con una contraseña elegida por el super admin", r.body);
const sara = agent();
await login(sara, "sara@example.com", ownerPassword, nextIp());
r = await sara("GET", `/businesses/${businessId}/notifications`);
const invite = r.body.find((e: any) => e.type === "team_invite");
ok(invite && invite.body.includes("token=••••••••"), "el propietario ve la invitación del equipo con el enlace oculto", invite?.body);
ok(!JSON.stringify(r.body).includes(titoToken), "el propietario no puede usar el enlace de su equipo");

const users = (await admin("GET", "/admin/users")).body;
const tito = users.find((u: any) => u.user.email === "tito@example.com").user;
r = await admin("POST", `/admin/users/${tito.id}/password-link`);
ok(r.status === 200 && r.body.email === "tito@example.com" && r.body.url.includes("/definir-contrasena?token="), "enviar enlace para definir contraseña", r.body);
const resetToken = tokenOf(r.body)!;
row = (await db.query("select body, secret from notifications where type = 'password_reset' and to_email = 'tito@example.com'")).rows[0];
ok(row.body.includes("token=••••••••") && !row.body.includes(resetToken) && row.secret === resetToken, "el email del enlace también lo oculta");
r = await agent()("POST", "/auth/password-link", { token: titoToken, password: "TitoClave-2026", confirmPassword: "TitoClave-2026" });
ok(r.status === 404, "pedir otro enlace anula el anterior", r.body);
const titoSession = agent();
r = await agent()("POST", "/auth/password-link", { token: resetToken, password: "TitoClave-2026", confirmPassword: "TitoClave-2026" });
ok(r.status === 204, "con el nuevo sí", r.body);
r = await login(titoSession, "tito@example.com", "TitoClave-2026", nextIp());
ok(r.status === 200 && r.body.role === "staff", "el miembro entra con la contraseña que definió", r.body);
const audit = (await admin("GET", "/admin/audit-logs?scope=admin")).body.entries.map((l: any) => l.action);
ok(audit.includes("platform.user_password_link"), "el envío del enlace queda en la auditoría de la plataforma", audit.slice(0, 6));
const security = (await admin("GET", "/admin/audit-logs?scope=security")).body.entries;
ok(security.some((l: any) => l.action === "session.password_set" && l.ip), "y cuándo y desde dónde se definió la contraseña", security.slice(0, 3));

// La migración 015 ocultó las contraseñas de los emails anteriores: se aplica su UPDATE a uno con la contraseña a la vista.
const legacy = composeEmail({
  subject: "Te invitaron a Estudio",
  preheader: "",
  brand: { name: "Agenda360" },
  title: "Te invitaron a Estudio",
  blocks: [
    {
      kind: "details",
      title: "Tus datos de acceso",
      rows: [
        { label: "Email", value: "ana@example.com" },
        { label: "Contraseña", value: "Vieja<&>Clave'1", mono: true },
      ],
    },
  ],
  signature: ["El equipo de Agenda360"],
  footer: "",
});
const inserted = await db.query(
  "insert into notifications (business_id, type, to_email, subject, body, html, status) values (null, 'team_invite', 'ana@example.com', $1, $2, $3, 'sent') returning id",
  [legacy.subject, legacy.body, legacy.html],
);
const migration = readFileSync(new URL("../db/migrations/015_email_secrets.sql", import.meta.url), "utf8");
await db.query(migration.slice(migration.indexOf("update notifications")));
row = (await db.query("select body, html from notifications where id = $1", [inserted.rows[0].id])).rows[0];
ok(
  !row.body.includes("Vieja") && row.body.includes("Contraseña: ••••••••") && row.body.includes("Email: ana@example.com"),
  "la migración oculta la contraseña del texto de los emails anteriores",
  row.body,
);
ok(!row.html.includes("Vieja") && row.html.includes("••••••••") && row.html.includes("ana@example.com"), "y la del HTML");

console.log("Cuenta existente reutilizada para un negocio");
const pedro = agent();
r = await login(pedro, "pedro@demo.com", "demo1234", nextIp());
ok(r.status === 200, "pedro inicia sesión");
r = await createBusinessWithOwner(
  admin,
  { name: "Taller Pedro", slug: "taller-pedro" },
  { firstName: "Pedro", lastName: "Sánchez", email: "pedro@demo.com" },
);
ok(r.status === 200 && r.body.owner.email === "pedro@demo.com" && r.body.passwordLink, "negocio para la cuenta existente, con su enlace", r.body);
const pedroLink = r.body.passwordLink;
ok((await pedro("GET", "/auth/session")).body === null, "se cierran las sesiones abiertas de esa cuenta");
r = await login(agent(), "pedro@demo.com", "demo1234", nextIp());
ok(r.status === 401, "y su contraseña anterior deja de servir: el negocio sólo lo recibe quien lea el email", r.body);
r = await setPasswordWithLink(agent(), pedroLink, "PedroNueva-2026");
ok(r.status === 204, "define la nueva con el enlace", r.body);
r = await login(agent(), "pedro@demo.com", "PedroNueva-2026", nextIp());
ok(r.status === 200 && r.body.role === "owner", "y entra como propietario", r.body);

console.log("Bloqueo por intentos fallidos (compartido entre servidores: se cuenta en la base)");
const miguel = "miguel@demo.com";
const attacker = nextIp();
for (let i = 0; i < 10; i++) await login(agent(), miguel, `mala-${i}`, attacker);
r = await login(agent(), miguel, "demo1234", attacker);
ok(
  r.status === 429 && /Demasiados intentos fallidos/.test(r.body.error.message),
  "10 fallos desde una conexión la bloquean para esa cuenta, aunque la contraseña sea correcta",
  r.body,
);
const lockedMessage = r.body.error?.message;
const locked = await db.query("select count(*)::int as n from audit_logs where action = 'session.login_locked'");
ok(locked.rows[0].n >= 1, "el bloqueo queda en la auditoría de seguridad");
r = await login(agent(), miguel, "demo1234", nextIp());
ok(r.status === 200, "el dueño sigue entrando desde su conexión: quien conoce su email no lo deja fuera", r.body);

const unknown = "nadie@example.com";
const unknownIp = nextIp();
for (let i = 0; i < 10; i++) await login(agent(), unknown, `mala-${i}`, unknownIp);
const unknownLocked = await login(agent(), unknown, "lo-que-sea", unknownIp);
ok(
  unknownLocked.status === 429 && unknownLocked.body.error.message === lockedMessage,
  "un email no registrado se bloquea igual (no revela qué cuentas existen)",
  unknownLocked.body,
);

const andrea = "andrea@demo.com";
const andreaIp = nextIp();
for (let i = 0; i < 9; i++) await login(agent(), andrea, `mala-${i}`, andreaIp);
ok((await login(agent(), andrea, "demo1234", andreaIp)).status === 200, "con 9 fallos todavía puede entrar");
for (let i = 0; i < 9; i++) await login(agent(), andrea, `mala-${i}`, andreaIp);
ok((await login(agent(), andrea, "demo1234", andreaIp)).status === 200, "entrar bien reinicia la cuenta de fallos");

// Ataque repartido entre muchas conexiones (una o dos contraseñas desde cada una): sigue frenado.
const tomas = "tomas@demo.com";
const tomasHome = nextIp();
ok((await login(agent(), tomas, "demo1234", tomasHome)).status === 200, "Tomás entra desde su conexión de siempre");
for (let i = 0; i < 15; i++) {
  const ip = nextIp();
  await login(agent(), tomas, `mala-${i}-a`, ip);
  await login(agent(), tomas, `mala-${i}-b`, ip);
}
r = await login(agent(), tomas, "demo1234", nextIp());
ok(r.status === 429, "30 fallos repartidos entre 15 conexiones: desde una conexión nueva ya no se puede probar", r.body);
r = await login(agent(), tomas, "demo1234", tomasHome);
ok(r.status === 200, "pero el dueño entra desde una conexión en la que ya había iniciado sesión", r.body);

// 50 fallos desde una misma conexión (contra cuentas distintas) la bloquean.
await db.query(
  `insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, summary, ip)
   select null, null, 'robot' || g || '@example.com', 'session.login_failed', 'session', 'Intento fallido', '198.51.100.7'
     from generate_series(1, 50) g`,
);
r = await login(agent(), "laura@demo.com", "demo1234", "198.51.100.7");
ok(r.status === 429, "una conexión con 50 fallos queda bloqueada", r.body);
r = await login(agent(), "laura@demo.com", "demo1234", nextIp());
ok(r.status === 200, "la misma cuenta entra desde otra conexión", r.body);

console.log("Perfil público sin datos internos");
const profile = (await agent()("GET", "/public/businesses/jhordan")).body;
ok(profile.captchaSiteKey === null, "sin claves de Turnstile no se pide CAPTCHA");
ok(
  !("ownerId" in profile.business) && !("notificationSettings" in profile.business) && !("status" in profile.business),
  "el negocio no expone propietario, avisos ni estado",
  Object.keys(profile.business),
);
ok(!("userId" in profile.professional), "el profesional no expone su cuenta");
ok(profile.services.every((s: any) => !("clinicalTemplateId" in s)), "los servicios no exponen la plantilla clínica");
ok(profile.blockedTimes.every((b: any) => !("reason" in b)), "los bloqueos no exponen el motivo");
const owner = agent();
r = await login(owner, "jhordan@demo.com", "demo1234", nextIp());
const ownerBusiness = `/businesses/${r.body.businessId}`;
const service = profile.services[0];
const full = (await owner("GET", `${ownerBusiness}/services`)).body.find((s: any) => s.id === service.id);
r = await owner("PUT", `${ownerBusiness}/services/${service.id}`, { ...full, price: 45, showPrice: false });
ok(r.status === 200, "ocultar el precio de un servicio", r.body);
const hidden = (await agent()("GET", "/public/businesses/jhordan")).body.services.find((s: any) => s.id === service.id);
ok(hidden.price === 0 && hidden.homeVisitFee === 0 && hidden.showPrice === false, "con el precio oculto no se envía el precio", hidden);

console.log("CAPTCHA (Cloudflare Turnstile, simulado)");
const verifications: any[] = [];
const cloudflare: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw);
    verifications.push(body);
    if (body.response === "token-caido") {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    // Cloudflare dice en qué dominio se resolvió: el del frontend (FRONTEND_URL) o el de otra web.
    const valid = { "token-bueno": { success: true, hostname: "localhost" }, "token-otra-web": { success: true, hostname: "copia-maliciosa.com" } };
    res.end(JSON.stringify(valid[body.response as keyof typeof valid] ?? { success: false, "error-codes": ["invalid-input-response"] }));
  });
});
await new Promise<void>((resolve) => cloudflare.listen(0, "127.0.0.1", resolve));
const captchaPort = Number(new URL(BASE).port) + 7;
const captchaBase = `http://127.0.0.1:${captchaPort}/api`;
const captchaApi: ChildProcess = spawn(process.execPath, ["src/server.ts"], {
  env: {
    ...process.env,
    PORT: String(captchaPort),
    TURNSTILE_SITE_KEY: "clave-del-sitio",
    TURNSTILE_SECRET_KEY: "clave-secreta",
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${(cloudflare.address() as AddressInfo).port}/siteverify`,
  },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${captchaBase}/health`).then((res) => res.ok, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const visitor = agent(captchaBase);
  r = await visitor("GET", "/public/businesses/jhordan");
  ok(r.body.captchaSiteKey === "clave-del-sitio", "el perfil público trae la Site Key", r.body.captchaSiteKey);
  const lookup = "/public/businesses/jhordan/clients/lookup";
  const documentId = "1710034065";
  r = await visitor("POST", lookup, { documentId });
  ok(r.status === 403 && /robot/.test(r.body.error.message), "buscar la cédula sin CAPTCHA → 403", r.body);
  r = await visitor("POST", lookup, { documentId, captchaToken: "token-malo" });
  ok(r.status === 403, "con un token inválido → 403", r.body);
  r = await visitor("POST", lookup, { documentId, captchaToken: "token-bueno" }, fromIp("192.0.2.44"));
  ok(r.status === 200 && typeof r.body.found === "boolean", "con un token válido sí busca", r.body);
  const last = verifications.at(-1);
  ok(last.secret === "clave-secreta" && last.remoteip === "192.0.2.44", "se verifica con la Secret Key y la IP del visitante", last);
  const bookings = "/public/businesses/jhordan/bookings";
  r = await visitor("POST", bookings, {});
  ok(r.status === 403, "reservar sin CAPTCHA → 403", r.body);
  r = await visitor("POST", bookings, { captchaToken: "token-bueno" });
  ok(r.status === 400, "con un token válido pasa a validar la reserva", r.body);
  r = await visitor("POST", bookings, { captchaToken: "token-caido" });
  ok(r.status === 503 && /inténtalo de nuevo/.test(r.body.error.message), "si Cloudflare falla, se rechaza (no se deja pasar a nadie)", r.body);
  r = await visitor("POST", bookings, { captchaToken: "token-otra-web" });
  ok(r.status === 403, "un token resuelto en otro dominio → 403", r.body);
} finally {
  captchaApi.kill("SIGTERM");
  cloudflare.close();
}

console.log("Datos demo sólo en una base local");
const seed = spawn(process.execPath, ["src/db/seed.ts", "--reset"], {
  env: { PATH: process.env.PATH, DATABASE_URL: "postgresql://postgres:x@db.abcdefgh.supabase.co:6543/postgres" },
  stdio: ["ignore", "pipe", "pipe"],
});
let seedOutput = "";
seed.stdout!.on("data", (chunk) => (seedOutput += chunk));
seed.stderr!.on("data", (chunk) => (seedOutput += chunk));
const seedCode = await new Promise((resolve) => seed.on("exit", resolve));
ok(seedCode === 1 && /no es una base de datos local/.test(seedOutput), "el seed se niega con una base remota", seedOutput);

await db.end();
console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
