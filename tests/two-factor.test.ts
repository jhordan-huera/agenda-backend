// Verificación en dos pasos del super admin: activar, iniciar sesión con el código o un código
// de recuperación, límites de intentos, desactivar y el comando de emergencia.
import { spawnSync } from "node:child_process";
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
type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any; cookie: boolean }>;
/** Cada petición desde una IP distinta (como la reenvía el proxy): no salta el límite por IP en memoria. */
function agent(): Call {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET!,
        "x-agendo-client-ip": `198.51.100.${ipCounter++ % 250}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: setCookies.length > 0 };
  };
}
const ADMIN = { email: "admin@demo.com", password: "demo1234", remember: true };
const lastStep = async () => Number((await db.query("select two_factor_last_step from users where email = $1", [ADMIN.email])).rows[0].two_factor_last_step);
/** Para no esperar 30 s entre pruebas: permite volver a usar el intervalo actual. */
const forgetLastStep = () => db.query("update users set two_factor_last_step = null where email = $1", [ADMIN.email]);

console.log("Sólo el super admin");
const owner = agent();
await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: false });
let r = await owner("GET", "/auth/two-factor");
ok(r.status === 403, "un propietario no puede activarla (por ahora)", r.body);

console.log("Activar");
const admin = agent();
await admin("POST", "/auth/login", ADMIN);
const otherDevice = agent();
await otherDevice("POST", "/auth/login", ADMIN);
r = await admin("GET", "/auth/two-factor");
ok(r.status === 200 && r.body.enabled === false && r.body.recoveryCodesLeft === 0, "al principio está desactivada", r.body);
r = await admin("POST", "/auth/two-factor/enable", { code: "123456" });
ok(r.status === 409, "no se activa sin generar antes la clave", r.body);
r = await admin("POST", "/auth/two-factor/setup");
const secret: string = r.body.secret;
ok(r.status === 200 && /^[A-Z2-7]{32}$/.test(secret), "genera una clave de 160 bits en base32", r.body);
ok(
  r.body.otpauthUrl.startsWith("otpauth://totp/Agenda360:admin%40demo.com?") && r.body.otpauthUrl.includes(`secret=${secret}`),
  "y el enlace del QR para la app",
  r.body.otpauthUrl,
);
r = await admin("POST", "/auth/two-factor/enable", { code: "12345" });
ok(r.status === 400, "el código debe tener 6 dígitos", r.body);
const wrong = codeAt(secret, timeStep() + 10);
r = await admin("POST", "/auth/two-factor/enable", { code: wrong });
ok(r.status === 400 && /no es correcto/.test(r.body.error.message), "con un código incorrecto no se activa", r.body);
r = await admin("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
const recoveryCodes: string[] = r.body.recoveryCodes ?? [];
ok(r.status === 200 && recoveryCodes.length === 10, "se activa con el código de la app y entrega 10 códigos de recuperación", r.body);
ok(recoveryCodes.every((code) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code)), "códigos legibles (sin 0/O ni 1/I)", recoveryCodes);
const stored = (await db.query("select two_factor_recovery_codes, two_factor_pending_secret from users where email = $1", [ADMIN.email])).rows[0];
ok(stored.two_factor_recovery_codes.every((hash: string) => /^[0-9a-f]{64}$/.test(hash)) && stored.two_factor_pending_secret === null, "en la base sólo queda su hash");
r = await admin("GET", "/auth/two-factor");
ok(r.body.enabled && r.body.recoveryCodesLeft === 10 && r.body.enabledAt, "el estado lo muestra activada", r.body);
ok((await otherDevice("GET", "/auth/session")).body === null, "se cierran las demás sesiones abiertas");
ok((await admin("GET", "/auth/session")).body?.platformRole === "super_admin", "la sesión actual sigue abierta");
r = await admin("POST", "/auth/two-factor/setup");
ok(r.status === 409, "no se puede generar otra clave estando activada", r.body);

console.log("Iniciar sesión");
let browser = agent();
r = await browser("POST", "/auth/login", ADMIN);
ok(r.status === 200 && r.body.twoFactorRequired === true && typeof r.body.challenge === "string", "la contraseña correcta pide el código", r.body);
ok(!r.cookie && (await browser("GET", "/auth/session")).body === null, "todavía no hay sesión");
let challenge = r.body.challenge;
r = await browser("POST", "/auth/login/two-factor", { challenge, code: wrong });
ok(r.status === 400 && /no es correcto/.test(r.body.error.message), "un código incorrecto se rechaza", r.body);
const used = codeAt(secret, (await lastStep()) + 1);
r = await browser("POST", "/auth/login/two-factor", { challenge, code: used });
ok(r.status === 200 && r.body.platformRole === "super_admin" && r.cookie, "con el código correcto entra", r.body);
ok((await browser("GET", "/auth/session")).body?.userId === r.body.userId, "y queda la sesión abierta");
r = await browser("POST", "/auth/login/two-factor", { challenge, code: used });
ok(r.status === 401, "el paso intermedio sirve para una sola sesión", r.body);
browser = agent();
challenge = (await browser("POST", "/auth/login", ADMIN)).body.challenge;
r = await browser("POST", "/auth/login/two-factor", { challenge, code: used });
ok(r.status === 400, "un código ya usado no sirve otra vez (aunque siga en su intervalo)", r.body);

console.log("Códigos de recuperación");
r = await browser("POST", "/auth/login/two-factor", { challenge, code: recoveryCodes[0].toLowerCase().replace("-", " ") });
ok(r.status === 200, "entra con un código de recuperación (sin importar mayúsculas ni guion)", r.body);
browser = agent();
challenge = (await browser("POST", "/auth/login", ADMIN)).body.challenge;
r = await browser("POST", "/auth/login/two-factor", { challenge, code: recoveryCodes[0] });
ok(r.status === 400, "cada código de recuperación sirve una sola vez", r.body);
r = await admin("GET", "/auth/two-factor");
ok(r.body.recoveryCodesLeft === 9, "quedan 9", r.body);
const log = await db.query("select summary from audit_logs where action = 'session.login' order by created_at desc limit 2");
ok(
  log.rows.some((row) => /código de recuperación \(quedan 9\)/.test(row.summary)) &&
    (await db.query("select 1 from audit_logs where summary = 'Inició sesión con verificación en dos pasos'")).rowCount === 1,
  "la auditoría dice cómo entró",
  log.rows,
);

console.log("Límites");
browser = agent();
challenge = (await browser("POST", "/auth/login", ADMIN)).body.challenge;
for (let i = 1; i <= 4; i++) await browser("POST", "/auth/login/two-factor", { challenge, code: wrong });
r = await browser("POST", "/auth/login/two-factor", { challenge, code: wrong });
ok(r.status === 401 && /Demasiados códigos incorrectos/.test(r.body.error.message), "tras 5 códigos incorrectos hay que volver a la contraseña", r.body);
await forgetLastStep();
r = await browser("POST", "/auth/login/two-factor", { challenge, code: codeAt(secret, timeStep()) });
ok(r.status === 401, "ese paso intermedio ya no sirve ni con el código correcto", r.body);
challenge = (await browser("POST", "/auth/login", ADMIN)).body.challenge;
await db.query("update login_challenges set expires_at = now() - interval '1 second'");
r = await browser("POST", "/auth/login/two-factor", { challenge, code: codeAt(secret, timeStep()) });
ok(r.status === 401 && /demasiado tiempo/.test(r.body.error.message), "el paso intermedio caduca a los pocos minutos", r.body);
const failed = await db.query("select count(*)::int as n from audit_logs where summary like '%código de verificación incorrecto'");
ok(failed.rows[0].n === 8, "los códigos incorrectos cuentan como intentos fallidos (y para el bloqueo)", failed.rows[0]);

console.log("Códigos de recuperación nuevos");
r = await admin("POST", "/auth/two-factor/recovery-codes", { code: wrong });
ok(r.status === 400, "piden un código válido", r.body);
await forgetLastStep();
r = await admin("POST", "/auth/two-factor/recovery-codes", { code: codeAt(secret, timeStep()) });
const fresh: string[] = r.body.recoveryCodes ?? [];
ok(r.status === 200 && fresh.length === 10 && !fresh.includes(recoveryCodes[1]), "genera 10 códigos nuevos", r.body);
browser = agent();
challenge = (await browser("POST", "/auth/login", ADMIN)).body.challenge;
r = await browser("POST", "/auth/login/two-factor", { challenge, code: recoveryCodes[1] });
ok(r.status === 400, "los anteriores dejan de servir", r.body);
r = await browser("POST", "/auth/login/two-factor", { challenge, code: fresh[0] });
ok(r.status === 200, "los nuevos sí", r.body);

console.log("Desactivar");
r = await admin("POST", "/auth/two-factor/disable", { password: "otra-cosa", code: fresh[1] });
ok(r.status === 400 && /contraseña/.test(r.body.error.message), "pide la contraseña", r.body);
r = await admin("POST", "/auth/two-factor/disable", { password: "demo1234", code: wrong });
ok(r.status === 400, "y un código válido", r.body);
r = await admin("POST", "/auth/two-factor/disable", { password: "demo1234", code: fresh[1] });
ok(r.status === 204, "con las dos cosas se desactiva", r.body);
r = await admin("GET", "/auth/two-factor");
ok(r.body.enabled === false && r.body.recoveryCodesLeft === 0, "queda desactivada", r.body);
r = await agent()("POST", "/auth/login", ADMIN);
ok(r.status === 200 && r.body.platformRole === "super_admin", "y se vuelve a entrar sólo con la contraseña", r.body);
const events = await db.query("select action from audit_logs where action like 'session.two_factor%' order by created_at");
ok(
  JSON.stringify(events.rows.map((row) => row.action)) ===
    JSON.stringify(["session.two_factor_enabled", "session.two_factor_recovery_codes", "session.two_factor_disabled"]),
  "activar, regenerar y desactivar quedan en la auditoría de seguridad",
  events.rows,
);

console.log("Comando de emergencia (db:reset-2fa)");
const second = agent();
await second("POST", "/auth/login", ADMIN);
const again = (await second("POST", "/auth/two-factor/setup")).body.secret;
await forgetLastStep();
await second("POST", "/auth/two-factor/enable", { code: codeAt(again, timeStep()) });
const reset = spawnSync(process.execPath, ["src/db/reset-two-factor.ts", ADMIN.email], { env: process.env, encoding: "utf8" });
ok(reset.status === 0 && /desactivada/.test(reset.stdout), "desactiva la verificación desde el servidor", reset.stdout + reset.stderr);
ok((await second("GET", "/auth/session")).body === null, "y cierra las sesiones de la cuenta");
r = await agent()("POST", "/auth/login", ADMIN);
ok(r.status === 200 && r.body.platformRole === "super_admin", "se entra con la contraseña", r.body);
ok((await db.query("select 1 from audit_logs where action = 'session.two_factor_reset'")).rowCount === 1, "queda en la auditoría");

await db.end();
console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
