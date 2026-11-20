// Endurecimiento: contraseñas fuera del registro de emails, bloqueo por intentos fallidos,
// CAPTCHA de la página de reservas, perfil público sin datos internos y seed sólo en local.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { outgoingContent } from "../src/services/mailer.ts";
import { createBusinessWithOwner } from "./helpers/business.mjs";
import { startApi } from "./helpers/harness.ts";
import { emailTemplates } from "../src/shared/lib/email/templates.ts";
import { homeVisitSchema, personNameField, publicHomeVisitSchema } from "../src/shared/lib/validations/fields.ts";
import { viaProxy } from "./helpers/proxy.mjs";

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
const fromIp = (ip: string) => viaProxy(ip);
const login = (a: Call, email: string, password: string, ip: string) =>
  a("POST", "/auth/login", { email, password, remember: false }, fromIp(ip));
let ipCounter = 1;
const nextIp = () => `203.0.113.${ipCounter++}`;

const admin = agent();
await login(admin, "admin@demo.com", "demo1234", nextIp());

console.log("Contraseñas fuera del registro de emails");
const ownerPassword = "ClaveSecreta-2026";
let r = await createBusinessWithOwner(
  admin,
  { plan: "pro", name: "Salón Seguro", slug: "salon-seguro" },
  { firstName: "Sara", lastName: "Segura", email: "sara@example.com", password: ownerPassword },
);
ok(r.status === 200, "crear negocio", r.body);
const businessId = r.body.business.id;
const emails = (await admin("GET", "/admin/emails")).body;
const created = emails.find((e: any) => e.type === "business_created" && e.to === "sara@example.com");
ok(created && created.body.includes("Contraseña temporal: ••••••••"), "el email guardado muestra la contraseña oculta", created?.body);
ok(!JSON.stringify(emails).includes(ownerPassword), "el super admin no ve la contraseña en el registro de emails");
let row = (await db.query("select body, html, secret from notifications where id = $1", [created.id])).rows[0];
ok(row.secret === ownerPassword, "la contraseña queda aparte hasta que se envía el email");
ok(!row.body.includes(ownerPassword) && !row.html.includes(ownerPassword), "ni el texto ni el HTML guardados la llevan");
const tricky = "A$&b<c>'d";
const outgoing = outgoingContent({ ...row, secret: tricky });
ok(
  outgoing.text.includes(`Contraseña temporal: ${tricky}`) && !outgoing.text.includes("••••••••"),
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
// Los emails de antes decían «Contraseña:» (desde la spec 054, «Contraseña temporal:»).
const oldLabel = (text: string) => text.replaceAll("Contraseña temporal", "Contraseña");
const inserted = await db.query(
  "insert into notifications (business_id, type, to_email, subject, body, html, status) values (null, 'team_invite', 'ana@example.com', $1, $2, $3, 'sent') returning id",
  [legacy.subject, oldLabel(legacy.body), oldLabel(legacy.html)],
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
  { firstName: "Pedro", lastName: "Sánchez", email: "pedro@demo.com", password: "PedroNueva-2026" },
);
ok(r.status === 200 && r.body.owner.email === "pedro@demo.com", "negocio para la cuenta existente", r.body);
ok((await pedro("GET", "/auth/session")).body === null, "se cierran las sesiones abiertas de esa cuenta");

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
ok(profile.services.every((s: any) => !("isActive" in s) && !("createdAt" in s)), "los servicios no exponen datos internos");
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

console.log("Textos enormes que hacían trabajar a la API (la regla del nombre, 2026-11-14)");
// Con la regla vieja, «a-a-a-…» de 1 MB tardaba minutos: el tiempo crecía con el cuadrado del largo.
const slowName = "a-".repeat(500_000);
const timed = async (work: () => Promise<{ status: number; body: any }>) => {
  const started = performance.now();
  const reply = await work();
  return { ...reply, ms: Math.round(performance.now() - started) };
};
let slow = await timed(() => agent()("POST", `${ownerBusiness}/waitlist`, { name: slowName, phone: "0991234567" }));
// Sin sesión, desde la revisión 2026-11-18, ni se lee un cuerpo de más de 100 kB: 400 al momento, antes de validar nada.
ok(slow.status === 400 && slow.ms < 3000, "sin sesión, «Anotar» rechaza el cuerpo enorme sin validarlo", { status: slow.status, ms: slow.ms });
slow = await timed(() => owner("POST", `${ownerBusiness}/waitlist`, { name: slowName, phone: "0991234567" }));
ok(slow.status === 400 && slow.ms < 3000, "con sesión, un nombre enorme se rechaza al momento", { status: slow.status, ms: slow.ms });
slow = await timed(() => agent()("POST", `${ownerBusiness}/clients`, { name: slowName }));
ok(slow.status === 400 && slow.ms < 3000, "las demás rutas del panel, también", { status: slow.status, ms: slow.ms });
slow = await timed(() => agent()("POST", `${ownerBusiness}/clients`, { name: "Ana" }));
ok(slow.status === 401, "y con un cuerpo pequeño, 401 como siempre", { status: slow.status });
const nameField = personNameField("El nombre");
let started = performance.now();
const tooLong = nameField.safeParse("a-".repeat(1_000_000));
ok(!tooLong.success && performance.now() - started < 500, "la regla sola con 2 MB: al momento", Math.round(performance.now() - started));
started = performance.now();
ok(!nameField.safeParse(`${"a-".repeat(55)}x.com`).success && performance.now() - started < 50, "120 caracteres con un enlace: se rechazan al momento");
ok(
  nameField.safeParse("Ana María Pérez-Soto").success && !nameField.safeParse("visita ana.com").success && !nameField.safeParse("pagina-web.ec").success,
  "sigue aceptando nombres y rechazando enlaces",
);

const bigBooking = await agent()("POST", `/public/businesses/no-existe/bookings`, { notes: "x".repeat(200_000) });
ok(bigBooking.status === 400 && /demasiado grandes/.test(bigBooking.body?.error?.message ?? ""), "las rutas públicas no reciben más de 100 kB", bigBooking.body);
const bigLogin = await agent()("POST", "/auth/login", { email: "x".repeat(200_000), password: "x" });
ok(bigLogin.status === 400, "el inicio de sesión tampoco", bigLogin.status);
// Express no distingue mayúsculas en las rutas: el tope tampoco (revisión de seguridad 2026-11-18).
const bigUpper = await agent()("POST", `/PUBLIC/businesses/no-existe/bookings`, { notes: "x".repeat(200_000) });
ok(bigUpper.status === 400 && /demasiado grandes/.test(bigUpper.body?.error?.message ?? ""), "ni escribiendo la ruta en mayúsculas", bigUpper.body);
const bigNoSession = await agent()("POST", `/businesses/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/clients`, { notes: "x".repeat(200_000) });
ok(bigNoSession.status === 400 && /demasiado grandes/.test(bigNoSession.body?.error?.message ?? ""), "y sin sesión, ninguna ruta lee más de 100 kB", bigNoSession.body);

console.log("La dirección de la visita a domicilio, sin enlaces (2026-11-15)");
const visit = (address: string, reference = "") => ({ address, reference, lat: -0.18, lng: -78.48 });
ok(
  publicHomeVisitSchema.safeParse(visit("Av. Amazonas N34-12 y Colón, edificio Torres, piso 3", "Casa azul junto a la farmacia")).success,
  "una dirección normal pasa",
);
ok(
  ["Calle 1 https://estafa.com", "Visita www.premio.ec", "Escribe a premio@correo.ec", "Gana en premio.com"].every(
    (address) => !publicHomeVisitSchema.safeParse(visit(address)).success,
  ) && !publicHomeVisitSchema.safeParse(visit("Av. Amazonas N34-12", "Entra a https://estafa.com")).success,
  "desde la página de reservas, la dirección y la referencia no admiten enlaces ni emails",
);
ok(homeVisitSchema.safeParse(visit("Av. Amazonas N34-12", "Mapa: https://maps.app.goo.gl/abc")).success, "en el panel el equipo sí puede pegar un enlace");
started = performance.now();
ok(!publicHomeVisitSchema.safeParse(visit("a-".repeat(1_000_000))).success && performance.now() - started < 500, "una dirección de 2 MB: al momento");

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
// Otra API con el CAPTCHA encendido, en un puerto libre. Antes usaba el de la API + 7 sin mirar si estaba libre y,
// en GitHub, a veces no arrancaba y la suite se caía con «fetch failed» sin decir por qué.
const captchaApi = await startApi({
  TURNSTILE_SITE_KEY: "clave-del-sitio",
  TURNSTILE_SECRET_KEY: "clave-secreta",
  TURNSTILE_VERIFY_URL: `http://127.0.0.1:${(cloudflare.address() as AddressInfo).port}/siteverify`,
});
try {
  if (!(await fetch(`${captchaApi.base}/health`).then((res) => res.ok, () => false))) {
    throw new Error(`La API con el CAPTCHA no arrancó (salida ${captchaApi.exited()}):\n${captchaApi.output().slice(-1500)}`);
  }
  const visitor = agent(captchaApi.base);
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
  captchaApi.stop();
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
