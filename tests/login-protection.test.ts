// Inicio de sesión del equipo (revisión de seguridad 2026-11-18): el dispositivo de confianza (cookie firmada), el tope
// de intentos de una cuenta en 24 horas desde conexiones nuevas, que cambiar la contraseña invalida los dispositivos, y
// el CAPTCHA después de 3 intentos desde conexiones nuevas (con un Cloudflare de mentira).
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hashPassword } from "../src/services/accounts.ts";
import { agent, checks, DEMO_PASSWORD, freePort, sleep, sql } from "./helpers/harness.ts";

const { ok, done } = checks();

let ipSeq = 0;
/** Una conexión nueva cada vez (por el proxy firmado del frontend). */
const freshIp = () => `198.61.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const accountKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
/** Como si la cuenta ya llevara `hits` intentos hoy desde conexiones nuevas. */
const setAttemptsToday = (email: string, hits: number) =>
  sql(
    `insert into rate_limits (key, hits, reset_at) values ('acceso:cuenta-dia:${accountKey(email)}', ${hits}, now() + interval '1 day')
     on conflict (key) do update set hits = ${hits}, reset_at = excluded.reset_at`,
  );
const credentials = (email: string, password = DEMO_PASSWORD) => ({ email, password, remember: true });

/* ======================================================================================== */
console.log("El dispositivo de confianza");
const OWNER = "ricardo@demo.com";
const homeIp = freshIp();
const home = agent({ ip: homeIp });
let r = await home("POST", "/auth/login", credentials(OWNER));
const deviceCookie = r.headers.getSetCookie().find((cookie) => cookie.startsWith("agenda360_device="));
ok(r.status === 200 && deviceCookie !== undefined, "al entrar bien, el navegador recibe su cookie de dispositivo", r.headers.getSetCookie());
ok(
  /HttpOnly/i.test(deviceCookie ?? "") && /Path=\/api\/auth/i.test(deviceCookie ?? "") && /Expires=/i.test(deviceCookie ?? ""),
  "HttpOnly, sólo para /api/auth y con fecha (180 días)",
  deviceCookie,
);
ok(!/agenda360_device=[^;]*demo/i.test(deviceCookie ?? ""), "no lleva la contraseña ni el email");

console.log("\nEl tope de 24 horas desde conexiones nuevas");
setAttemptsToday(OWNER, 100);
r = await agent({ ip: freshIp() })("POST", "/auth/login", credentials(OWNER));
ok(r.status === 429, "desde una conexión nueva, ni con la contraseña correcta", r.body);
r = await agent({ ip: homeIp })("POST", "/auth/login", credentials(OWNER));
ok(r.status === 200, "desde la conexión de siempre, el dueño entra", r.body);
setAttemptsToday(OWNER, 100);
const traveling = agent({ ip: freshIp() });
traveling.setCookie(home.cookie());
r = await traveling("POST", "/auth/login", credentials(OWNER));
ok(r.status === 200, "y desde otra red con su navegador de siempre (el dispositivo de confianza), también", r.body);
ok(Number(sql(`select count(*) from rate_limits where key = 'acceso:cuenta-dia:${accountKey(OWNER)}'`)) === 0, "al entrar, la cuenta del día vuelve a cero");
const forged = agent({ ip: freshIp() });
forged.setCookie(home.cookie().replace(/agenda360_device=([^;.]+)\.(\d+)\.[^;]+/, "agenda360_device=$1.$2.firma-inventada"));
setAttemptsToday(OWNER, 100);
r = await forged("POST", "/auth/login", credentials(OWNER));
ok(r.status === 429, "una cookie con la firma cambiada no sirve", r.body);

console.log("\nCambiar la contraseña invalida los dispositivos");
const STAFF = "elena@demo.com";
const staff = agent({ ip: freshIp() });
await staff("POST", "/auth/login", credentials(STAFF));
const staffDevice = staff.cookie();
// Como si el soporte le cambiara la contraseña (aquí, un hash nuevo de la misma: la firma lleva el hash; las cuentas de
// prueba comparten el mismo hash, así que hay que calcular otro).
sql(`update users set password_hash = '${await hashPassword(DEMO_PASSWORD)}' where email = '${STAFF}'`);
setAttemptsToday(STAFF, 100);
const oldDevice = agent({ ip: freshIp() });
oldDevice.setCookie(staffDevice);
r = await oldDevice("POST", "/auth/login", credentials(STAFF));
ok(r.status === 429, "la cookie de antes del cambio ya no exime del tope", r.body);

/* ======================================================================================== */
console.log("\nEl CAPTCHA después de 3 intentos desde conexiones nuevas");
const received: string[] = [];
const cloudflare = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const token = JSON.parse(raw || "{}").response as string;
    received.push(token);
    const json = token === "token-bueno" ? { success: true, hostname: "localhost" } : { success: false, "error-codes": ["invalid-input-response"] };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(json));
  });
});
await new Promise<void>((resolve) => cloudflare.listen(0, "127.0.0.1", resolve));
const port = await freePort();
const api: ChildProcess = spawn(process.execPath, ["src/server.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    TURNSTILE_SITE_KEY: "clave-del-sitio",
    TURNSTILE_SECRET_KEY: "clave-secreta",
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${(cloudflare.address() as AddressInfo).port}/siteverify`,
  },
  stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/api`;
for (let i = 0; i < 100; i++) {
  if (await fetch(`${base}/health`).then((res) => res.ok, () => false)) break;
  await sleep(100);
}
const PRO = "valeria@demo.com";
const proIp = freshIp();
await agent({ base, ip: proIp })("POST", "/auth/login", credentials(PRO));
const wrongPassword = randomBytes(8).toString("hex");
for (let i = 0; i < 3; i++) {
  r = await agent({ base, ip: freshIp() })("POST", "/auth/login", credentials(PRO, wrongPassword));
  ok(r.status === 401, `intento ${i + 1} desde una conexión nueva: sin CAPTCHA (contraseña incorrecta)`, r.body);
}
r = await agent({ base, ip: freshIp() })("POST", "/auth/login", credentials(PRO));
ok(r.status === 403 && r.body?.error?.code === "captcha_required", "al 4.º desde una conexión nueva, pide el CAPTCHA", r.body);
r = await agent({ base, ip: freshIp() })("POST", "/auth/login", { ...credentials(PRO), captchaToken: "token-malo" });
ok(r.status === 403 && r.body?.error?.code === "forbidden", "con un CAPTCHA inválido, no", r.body);
r = await agent({ base, ip: proIp })("POST", "/auth/login", credentials(PRO, wrongPassword));
ok(r.status === 401, "desde su conexión de siempre no se pide (la contraseña sigue siendo incorrecta)", r.body);
r = await agent({ base, ip: freshIp() })("POST", "/auth/login", { ...credentials(PRO), captchaToken: "token-bueno" });
ok(r.status === 200 && received.includes("token-bueno"), "con el CAPTCHA resuelto, entra", r.body);
r = await agent({ base, ip: freshIp() })("POST", "/auth/login", credentials(PRO));
ok(r.status === 200, "después de entrar, vuelve a cero: no se pide", r.body);
api.kill();
cloudflare.close();

done("del inicio de sesión del equipo");
process.exit();
