// Endurecimiento: contraseñas fuera del registro de emails, bloqueo por intentos fallidos,
// CAPTCHA de la página de reservas, perfil público sin datos internos y seed sólo en local.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { outgoingContent } from "../src/services/mailer.ts";
import { emailTemplates } from "../src/shared/lib/email/templates.ts";

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

console.log("Contraseñas fuera del registro de emails");
const ownerPassword = "ClaveSecreta-2026";
const base = { category: "beauty", timezone: "America/Guayaquil", phone: "", email: "", address: "", plan: "free" };
let r = await admin("POST", "/admin/businesses", {
  ...base,
  plan: "pro",
  name: "Salón Seguro",
  slug: "salon-seguro",
  ownerFirstName: "Sara",
  ownerLastName: "Segura",
  ownerEmail: "sara@example.com",
  ownerPassword,
});
ok(r.status === 200, "crear negocio", r.body);
const businessId = r.body.business.id;
const emails = (await admin("GET", "/admin/emails")).body;
const created = emails.find((e: any) => e.type === "business_created" && e.to === "sara@example.com");
ok(created && created.body.includes("Contraseña: ••••••••"), "el email guardado muestra la contraseña oculta", created?.body);
ok(!JSON.stringify(emails).includes(ownerPassword), "el super admin no ve la contraseña en el registro de emails");
let row = (await db.query("select body, html, secret from notifications where id = $1", [created.id])).rows[0];
ok(row.secret === ownerPassword, "la contraseña queda aparte hasta que se envía el email");
ok(!row.body.includes(ownerPassword) && !row.html.includes(ownerPassword), "ni el texto ni el HTML guardados la llevan");
const tricky = "A$&b<c>'d";
const outgoing = outgoingContent({ ...row, secret: tricky });
ok(
  outgoing.text.includes(`Contraseña: ${tricky}`) && !outgoing.text.includes("••••••••"),
  "el email que sale lleva la contraseña real",
  outgoing.text,
);
ok(outgoing.html!.includes("A$&amp;b&lt;c&gt;&#39;d") && !outgoing.html!.includes("••••••••"), "también en el HTML, escapada");

const memberPassword = "ClaveDelEquipo-77";
r = await admin("POST", `/admin/businesses/${businessId}/members`, {
  firstName: "Tito",
  lastName: "Equipo",
  email: "tito@example.com",
  password: memberPassword,
  role: "staff",
});
ok(r.status === 200, "añadir miembro", r.body);
const sara = agent();
await login(sara, "sara@example.com", ownerPassword, nextIp());
r = await sara("GET", `/businesses/${businessId}/notifications`);
const invite = r.body.find((e: any) => e.type === "team_invite");
ok(invite && invite.body.includes("••••••••"), "el propietario ve la invitación del equipo con la contraseña oculta", invite?.body);
ok(!JSON.stringify(r.body).includes(memberPassword), "el propietario no puede leer la contraseña de su equipo");

const users = (await admin("GET", "/admin/users")).body;
const tito = users.find((u: any) => u.user.email === "tito@example.com").user;
const resetPassword = "OtraClaveNueva-55";
r = await admin("PUT", `/admin/users/${tito.id}/password`, { password: resetPassword });
ok(r.status === 204, "cambiar la contraseña de un usuario", r.body);
row = (await db.query("select body, secret from notifications where type = 'password_reset' and to_email = 'tito@example.com'")).rows[0];
ok(row.body.includes("••••••••") && !row.body.includes(resetPassword) && row.secret === resetPassword, "el email de contraseña cambiada también");

// La migración 015 ocultó las contraseñas de los emails anteriores: se aplica su UPDATE a uno con la contraseña a la vista.
const legacy = emailTemplates.teamInvite({
  firstName: "Ana",
  businessName: "Estudio",
  roleLabel: "Staff",
  email: "ana@example.com",
  password: "Vieja<&>Clave'1",
  loginUrl: "https://agenda.example/login",
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
r = await admin("POST", "/admin/businesses", {
  ...base,
  name: "Taller Pedro",
  slug: "taller-pedro",
  ownerFirstName: "Pedro",
  ownerLastName: "Sánchez",
  ownerEmail: "pedro@demo.com",
  ownerPassword: "PedroNueva-2026",
});
ok(r.status === 200 && r.body.existingAccount, "negocio para la cuenta existente", r.body);
ok((await pedro("GET", "/auth/session")).body === null, "se cierran las sesiones abiertas de esa cuenta");

console.log("Bloqueo por intentos fallidos (compartido entre servidores: se cuenta en la base)");
const miguel = "miguel@demo.com";
for (let i = 0; i < 10; i++) await login(agent(), miguel, `mala-${i}`, nextIp());
r = await login(agent(), miguel, "demo1234", nextIp());
ok(r.status === 429 && /Demasiados intentos fallidos/.test(r.body.error.message), "10 fallos bloquean la cuenta aunque la contraseña sea correcta", r.body);
const locked = await db.query("select count(*)::int as n from audit_logs where action = 'session.login_locked'");
ok(locked.rows[0].n >= 1, "el bloqueo queda en la auditoría de seguridad");

const unknown = "nadie@example.com";
for (let i = 0; i < 10; i++) await login(agent(), unknown, `mala-${i}`, nextIp());
const unknownLocked = await login(agent(), unknown, "lo-que-sea", nextIp());
ok(
  unknownLocked.status === 429 && unknownLocked.body.error.message === r.body.error.message,
  "un email no registrado se bloquea igual (no revela qué cuentas existen)",
  unknownLocked.body,
);

const andrea = "andrea@demo.com";
for (let i = 0; i < 9; i++) await login(agent(), andrea, `mala-${i}`, nextIp());
ok((await login(agent(), andrea, "demo1234", nextIp())).status === 200, "con 9 fallos todavía puede entrar");
for (let i = 0; i < 9; i++) await login(agent(), andrea, `mala-${i}`, nextIp());
ok((await login(agent(), andrea, "demo1234", nextIp())).status === 200, "entrar bien reinicia la cuenta de fallos");

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
    res.end(JSON.stringify(body.response === "token-bueno" ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] }));
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
  ok(r.status === 400, "si Cloudflare no responde, la reserva no se bloquea", r.body);
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
