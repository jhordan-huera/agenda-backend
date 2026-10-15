// Cambios de seguridad en las cuentas de super admin (spec 009): activar o desactivar la verificación
// en dos pasos y cambiar la contraseña avisan por email (a la cuenta y al super admin principal) y,
// en la siguiente pasada del cron, por ntfy, con la cuenta a medias y sin nombres en el título.
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { codeAt, timeStep } from "../src/services/totp.ts";
import { checks, count, DEMO_PASSWORD, fakeNtfy, login, runCron, sql } from "./helpers/harness.ts";

const { ok, done } = checks();
const OWNER = "admin@demo.com";
const SECOND = "soporte.dos@example.com";
const IP = "203.0.113.50";
sql(
  `insert into users (first_name, last_name, email, password_hash, platform_role)
   values ('Sofía', 'Soporte', '${SECOND}', '${await bcrypt.hash(DEMO_PASSWORD, 10)}', 'super_admin')`,
);
let seen = 0;
/** Los emails de seguridad nuevos desde la última vez: "destino|cuerpo". */
const newAlerts = () => {
  const rows = sql(
    `select to_email || '|' || replace(body, E'\\n', ' ') from notifications where type = 'account_security_changed' order by created_at, to_email`,
  )
    .split("\n")
    .filter(Boolean);
  const fresh = rows.slice(seen);
  seen = rows.length;
  return fresh;
};
const lastStep = () => Number(sql(`select coalesce(two_factor_last_step, 0) from users where email = '${SECOND}'`));

console.log("Emails al momento");
const second = await login(SECOND, { ip: IP });
let secret: string = (await second("POST", "/auth/two-factor/setup")).body.secret;
let r = await second("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
ok(r.status === 200, "un super admin nuevo activa la verificación", r.body);
let alerts = newAlerts();
ok(
  alerts.length === 2 && alerts.some((a) => a.startsWith(`${SECOND}|`)) && alerts.some((a) => a.startsWith(`${OWNER}|`)),
  "le llega un email a su cuenta y otro al super admin principal",
  alerts,
);
ok(alerts.every((a) => a.includes("Activó la verificación en dos pasos") && a.includes(IP)), "con qué cambió y desde qué IP", alerts);
r = await second("POST", "/auth/two-factor/disable", { password: DEMO_PASSWORD, code: codeAt(secret, Math.max(lastStep() + 1, timeStep())) });
alerts = newAlerts();
ok(r.status === 204 && alerts.length === 2 && alerts.every((a) => a.includes("Desactivó la verificación")), "al desactivarla, lo mismo", { status: r.status, alerts });
r = await second("POST", "/auth/change-password", { currentPassword: DEMO_PASSWORD, newPassword: "Otra-clave-456", confirmPassword: "Otra-clave-456" });
alerts = newAlerts();
ok(r.status === 204 && alerts.length === 2 && alerts.every((a) => a.includes("Cambió su contraseña")), "y al cambiar su contraseña", { status: r.status, alerts });
ok(
  sql(
    `select l.ip from audit_logs l join users u on u.id = l.actor_id where u.email = '${SECOND}' and l.action = 'session.password_changed'`,
  ) === IP,
  "el cambio de contraseña queda en los eventos de sesión, con la IP",
);
const owner = await login(OWNER, { ip: "203.0.113.51" });
r = await owner("POST", "/auth/change-password", { currentPassword: DEMO_PASSWORD, newPassword: "Clave-del-dueño-789", confirmPassword: "Clave-del-dueño-789" });
alerts = newAlerts();
ok(r.status === 204 && alerts.length === 1 && alerts[0].startsWith(`${OWNER}|`), "si es el principal, le llega un solo email", { status: r.status, alerts });

console.log("Aviso por ntfy en la pasada del cron");
const ntfy = await fakeNtfy();
let run = await runCron(ntfy.url);
const notices = () => ntfy.received.filter((notice) => notice.title === "Agenda360: cambio en una cuenta de super admin");
ok(run.code === 0 && notices().length === 4, "un aviso por cada cambio", { code: run.code, titles: ntfy.received.map((n) => n.title) });
ok(
  notices().every((notice) => !notice.message.includes(SECOND) && !notice.message.includes(OWNER) && !/Sofía|Soporte/.test(notice.title + notice.message)),
  "sin el email completo ni nombres",
  notices().map((n) => n.message),
);
ok(notices().filter((notice) => notice.message.includes("so***@example.com")).length === 3, "con la cuenta a medias", notices().map((n) => n.message));
ok(notices().every((notice) => notice.priority === 4 && notice.message.includes("Lo hizo la propia cuenta")), "prioridad alta y quién lo hizo", notices());
ok(/cambios de cuenta: 4 ·/.test(run.output) && !/@/.test(run.output.replace(/\[ntfy\].*$/gm, "")), "el registro público sólo lleva la cifra", run.output.slice(-600));

console.log("Comando de emergencia");
secret = (await second("POST", "/auth/two-factor/setup")).body.secret;
await second("POST", "/auth/two-factor/enable", { code: codeAt(secret, Math.max(lastStep() + 1, timeStep())) });
execFileSync(process.execPath, ["src/db/reset-two-factor.ts", SECOND], {
  env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_SSL: "false" },
  stdio: "ignore",
});
ntfy.received.length = 0;
run = await runCron(ntfy.url);
const reset = notices().find((notice) => notice.message.includes("npm run db:reset-2fa"));
ok(reset?.message.includes("Desde el servidor"), "db:reset-2fa también avisa, como hecho desde el servidor", notices().map((n) => n.message));
ok(count(`select count(*) from notifications where type = 'account_security_changed' and business_id is not null`) === 0, "los emails de seguridad no son de ningún negocio");

ntfy.close();
done("de los avisos de cambios en cuentas de super admin");
