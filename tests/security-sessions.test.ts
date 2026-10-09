// Sesiones con caducidad por inactividad (12 h sin «Recordarme», 14 días renovables con él) y
// verificación en dos pasos obligatoria para el super admin (en una API aparte con SUPER_ADMIN_2FA=required:
// la de las pruebas usa la base local, donde es opcional).
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import pg from "pg";
import { codeAt, timeStep } from "../src/services/totp.ts";

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

let ipCounter = 1;
type Response = { status: number; body: any; setCookie: string[] };
type Call = (method: string, path: string, body?: unknown) => Promise<Response>;
function agent(base = BASE): Call & { token: () => string } {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET!,
        "x-agendo-client-ip": `203.0.113.${ipCounter++ % 250}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, setCookie };
  };
  return Object.assign(call, { token: () => decodeURIComponent(cookie.split("=")[1] ?? "") });
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sessionRow = async (token: string) =>
  (
    await db.query(
      `select remember, (extract(epoch from expires_at - now()) / 3600)::float8 as "hoursLeft", last_seen_at::text as "lastSeenAt"
         from sessions where token_hash = $1`,
      [sha256(token)],
    )
  ).rows[0];
const login = async (email: string, remember: boolean, base = BASE) => {
  const a = agent(base);
  const r = await a("POST", "/auth/login", { email, password: "demo1234", remember });
  return { a, r };
};

console.log("Sesiones");
const { a: shortSession, r: shortLogin } = await login("jhordan@demo.com", false);
let row = await sessionRow(shortSession.token());
ok(shortLogin.status === 200 && row && row.remember === false, "sin «Recordarme»: sesión corta", row);
ok(row.hoursLeft > 11.9 && row.hoursLeft <= 12, "caduca a las 12 horas sin usarla", row.hoursLeft);
ok(!shortLogin.setCookie.some((c) => /Expires=/i.test(c)), "y la cookie se borra al cerrar el navegador", shortLogin.setCookie);
const { a: longSession, r: longLogin } = await login("ricardo@demo.com", true);
row = await sessionRow(longSession.token());
ok(row.remember === true && row.hoursLeft > 14 * 24 - 0.1 && row.hoursLeft <= 14 * 24, "con «Recordarme»: 14 días", row.hoursLeft);
ok(longLogin.setCookie.some((c) => /Expires=/i.test(c)), "con cookie persistente", longLogin.setCookie);

// Uso reciente: no se escribe en cada petición.
let before = await sessionRow(longSession.token());
await longSession("GET", "/auth/session");
ok((await sessionRow(longSession.token())).lastSeenAt === before.lastSeenAt, "una petición seguida no reescribe la sesión");

// Con «Recordarme», se renueva con el uso: 14 días desde ahora, también en la cookie.
await db.query(
  "update sessions set last_seen_at = now() - interval '3 days', expires_at = now() + interval '11 days' where token_hash = $1",
  [sha256(longSession.token())],
);
let r = await longSession("GET", "/auth/session");
row = await sessionRow(longSession.token());
ok(r.body?.userId && row.hoursLeft > 14 * 24 - 0.1, "con «Recordarme», cada uso la renueva otros 14 días", row.hoursLeft);
const renewed = r.setCookie.find((c) => c.startsWith("agendo_session="));
ok(renewed && /Expires=/i.test(renewed) && Date.parse(/Expires=([^;]+)/i.exec(renewed)![1]) > Date.now() + 13 * 86_400_000, "y la cookie también", r.setCookie);

// Sin «Recordarme»: 12 horas desde el último uso, y como mucho 24 desde que se inició.
await db.query(
  `update sessions set created_at = now() - interval '20 hours', last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 hour'
    where token_hash = $1`,
  [sha256(shortSession.token())],
);
r = await shortSession("GET", "/auth/session");
row = await sessionRow(shortSession.token());
ok(r.body?.userId && row.hoursLeft > 3.9 && row.hoursLeft < 4.1, "sin «Recordarme» se renueva, pero no más allá de 24 h desde el inicio", row.hoursLeft);
ok(!r.setCookie.length, "sin tocar la cookie de sesión", r.setCookie);
await db.query("update sessions set expires_at = now() - interval '1 second' where token_hash = $1", [sha256(shortSession.token())]);
r = await shortSession("GET", "/auth/session");
ok(r.body === null, "pasadas 12 h sin usarla, ya no vale", r.body);
r = await shortSession("GET", "/businesses/x/clients");
ok(r.status === 401 || r.status === 403, "ni para el panel", r.status);

// Las sesiones que ya existían: con la migración siguen valiendo, con los límites nuevos.
const user = (await db.query("select id from users where email = 'laura@demo.com'")).rows[0].id;
const legacy = await db.query(
  `insert into sessions (user_id, token_hash, expires_at, created_at)
   values ($1, 'antigua-larga', now() + interval '29 days', now() - interval '1 day'),
          ($1, 'antigua-corta', now() + interval '20 hours', now() - interval '4 hours')
   returning id`,
  [user],
);
const migration = readFileSync(new URL("../db/migrations/028_account_security.sql", import.meta.url), "utf8");
await db.query(migration.slice(migration.indexOf("update sessions set remember")));
const migrated = (
  await db.query(
    `select token_hash, remember, (extract(epoch from expires_at - now()) / 3600)::float8 as "hoursLeft"
       from sessions where id = any($1::uuid[])`,
    [legacy.rows.map((x) => x.id)],
  )
).rows;
const longOld = migrated.find((x) => x.token_hash === "antigua-larga");
const shortOld = migrated.find((x) => x.token_hash === "antigua-corta");
ok(longOld.remember === true && longOld.hoursLeft > 14 * 24 - 0.1 && longOld.hoursLeft <= 14 * 24, "una sesión con «Recordarme» de antes queda en 14 días", longOld);
ok(shortOld.remember === false && shortOld.hoursLeft > 11.9 && shortOld.hoursLeft <= 12, "y una sin él, en 12 horas", shortOld);
await db.query("delete from sessions where id = any($1::uuid[])", [legacy.rows.map((x) => x.id)]);

console.log("Verificación en dos pasos obligatoria para el super admin");
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
const port = await freePort();
const strictBase = `http://127.0.0.1:${port}/api`;
const strictApi: ChildProcess = spawn(process.execPath, ["src/server.ts"], {
  env: { ...process.env, PORT: String(port), SUPER_ADMIN_2FA: "required" },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${strictBase}/health`).then((res) => res.ok, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { a: admin, r: adminLogin } = await login("admin@demo.com", true, strictBase);
  ok(adminLogin.status === 200 && adminLogin.body.twoFactorSetupRequired === true, "el super admin sin la verificación inicia sesión: la sesión dice que debe activarla", adminLogin.body);
  r = await admin("GET", "/admin/stats");
  ok(r.status === 403 && r.body.error.code === "two_factor_required", "el panel /admin responde two_factor_required", r.body);
  const { a: owner, r: ownerLogin } = await login("ricardo@demo.com", true, strictBase);
  const B = `/businesses/${ownerLogin.body.businessId}`;
  r = await admin("GET", `${B}/clients`);
  ok(r.status === 403 && r.body.error.code === "two_factor_required", "el modo soporte («Gestionar negocio») también", r.body);
  r = await admin("POST", "/images", { target: "logo", contentType: "image/png", sizeBytes: 100 });
  ok(r.status === 403 && r.body.error.code === "two_factor_required", "y las subidas de imágenes del modo soporte", r.body);
  r = await owner("GET", `${B}/clients`);
  ok(r.status === 200 && ownerLogin.body.twoFactorSetupRequired === false, "los demás usuarios siguen igual", r.status);

  r = await admin("GET", "/auth/two-factor");
  ok(r.status === 200 && r.body.enabled === false, "puede ver el estado de su verificación", r.body);
  r = await admin("POST", "/auth/two-factor/setup");
  ok(r.status === 200 && r.body.secret, "y empezar a activarla", r.status);
  const secret: string = r.body.secret;
  r = await admin("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
  ok(r.status === 200 && r.body.recoveryCodes?.length, "la activa con el código de la app", r.body);
  r = await admin("GET", "/auth/session");
  ok(r.body?.twoFactorSetupRequired === false, "su sesión ya no la pide", r.body);
  r = await admin("GET", "/admin/stats");
  ok(r.status === 200, "y entra al panel", r.status);
  r = await admin("GET", `${B}/clients`);
  ok(r.status === 200, "y al modo soporte", r.status);
  r = await agent(strictBase)("POST", "/auth/login", { email: "admin@demo.com", password: "demo1234", remember: false });
  ok(r.status === 200 && r.body.twoFactorRequired === true, "desde entonces, iniciar sesión pide el código", r.body);
  r = await agent()("POST", "/auth/login", { email: "admin@demo.com", password: "demo1234", remember: false });
  ok(r.body?.twoFactorRequired === true, "también en la API sin la obligación (es la misma cuenta)", r.body);
} finally {
  strictApi.kill("SIGTERM");
}

await db.end();
console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
