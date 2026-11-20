// «¿Olvidaste tu contraseña?» con una contraseña temporal (spec 054, pedido del dueño el 2026-11-20): la misma respuesta
// para cualquier email, la temporal por email (oculta en el registro), la de siempre que sigue sirviendo, una sola vez y
// 1 hora, la sesión que sólo puede crear la contraseña nueva, la contraseña del soporte como temporal, el cambio en
// Perfil para cualquier cuenta, el super admin con su verificación en dos pasos, los topes y la actividad.
import { randomBytes } from "node:crypto";
import { pool } from "../src/db/pool.ts";
import { findAccountChanges } from "../src/services/account-alerts.ts";
import { codeAt, timeStep } from "../src/services/totp.ts";
import { TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH } from "../src/shared/lib/constants/auth.ts";
import { agent, checks, count, DEMO_PASSWORD, sql } from "./helpers/harness.ts";

const { ok, done } = checks();

let ipSeq = 0;
/** Una conexión distinta en cada pedido: el tope por conexión (10 por hora) sólo se prueba donde toca. */
const freshIp = () => `198.72.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const browser = () => agent({ ip: freshIp() });
/** Contraseñas de prueba al azar, en variables «…Password» (GitGuardian, 2026-11-18). */
const randomPassword = () => `Prueba-${randomBytes(6).toString("hex")}`;
const forgot = (email: string, ip = freshIp()) => agent({ ip })("POST", "/auth/forgot-password", { email });
const signIn = (email: string, password: string, who = browser()) =>
  who("POST", "/auth/login", { email, password, remember: true }).then((r) => Object.assign(r, { who }));
/** La contraseña temporal del último email pedido (en la cola de prueba no se envía: sigue en `secret`). */
const lastTemporary = (email: string) =>
  sql(`select secret from notifications where type = 'temporary_password' and to_email = '${email}' order by created_at desc, id desc limit 1`);
const temporaryEmails = (email: string) => count(`select count(*) from notifications where type = 'temporary_password' and to_email = '${email}'`);
const timed = async <T>(work: () => Promise<T>) => {
  const started = performance.now();
  const result = await work();
  return { result, ms: performance.now() - started };
};

const RICARDO = "ricardo@demo.com";
const ELENA = "elena@demo.com";
const VALERIA = "valeria@demo.com";
const BUSINESS = sql("select id from businesses where slug = 'dental-sonrisa'");

/* ======================================================================================== */
console.log("La misma respuesta para cualquier email");
sql(`update users set is_active = false where email = '${ELENA}'`);
const known = await timed(() => forgot(RICARDO));
const unknown = await timed(() => forgot("nadie-registrado@ejemplo.com"));
const inactive = await timed(() => forgot(ELENA));
ok(known.result.status === 204 && unknown.result.status === 204 && inactive.result.status === 204, "204 con email existente, inexistente y desactivado", [
  known.result.status,
  unknown.result.status,
  inactive.result.status,
]);
ok(
  unknown.ms > known.ms * 0.4 && unknown.ms > 60,
  "un email inexistente tarda parecido (también calcula una contraseña)",
  { known: Math.round(known.ms), unknown: Math.round(unknown.ms) },
);
ok(temporaryEmails(RICARDO) === 1 && temporaryEmails(ELENA) === 0, "sólo a la cuenta activa le llega el email");
sql(`update users set is_active = true where email = '${ELENA}'`);
let r = await forgot("no es un email");
ok(r.status === 400, "un email mal escrito: 400", r.body);

console.log("\nEl email y la contraseña temporal");
const firstTemporary = lastTemporary(RICARDO);
ok(
  firstTemporary.length === TEMPORARY_PASSWORD_LENGTH && [...firstTemporary].every((char) => TEMPORARY_PASSWORD_ALPHABET.includes(char)),
  "10 caracteres sin letras que se confunden",
  firstTemporary,
);
const stored = sql(
  `select subject || ' | ' || body from notifications where type = 'temporary_password' and to_email = '${RICARDO}' order by created_at desc limit 1`,
);
ok(/Tu contraseña temporal/.test(stored) && stored.includes("••••••••") && !stored.includes(firstTemporary), "el registro de emails la guarda oculta", stored.slice(0, 200));
ok(/1 hora/.test(stored) && /sigue funcionando/.test(stored), "dice que vence en 1 hora y que la de siempre sigue sirviendo");
ok(count(`select count(*) from temporary_passwords t join users u on u.id = t.user_id where u.email = '${RICARDO}' and t.password_hash like '$2%'`) === 1, "en la base, sólo su huella");

console.log("\nLa contraseña de siempre sigue sirviendo");
r = await signIn(RICARDO, DEMO_PASSWORD);
ok(r.status === 200 && r.body.passwordChangeRequired === false, "entra con la de siempre, sin tener que cambiarla", r.body);
r = await signIn(RICARDO, firstTemporary);
ok(r.status === 401, "y entrar con la de siempre anula la temporal pendiente", r.body);

/** Los topes de pedidos por email (3 por hora, 5 por día) se prueban al final: aquí se vacían para seguir pidiendo. */
const resetLimits = () => sql(`delete from rate_limits where key like 'recuperar:%'`);

console.log("\nSólo vale la última temporal, una vez y por 1 hora");
resetLimits();
await forgot(RICARDO);
const older = lastTemporary(RICARDO);
await forgot(RICARDO);
const newest = lastTemporary(RICARDO);
r = await signIn(RICARDO, older);
ok(r.status === 401 && older !== newest, "la anterior ya no sirve", r.body);
// Otra sesión abierta con la de siempre: se cerrará al crear la contraseña nueva.
const otherDevice = (await signIn(RICARDO, DEMO_PASSWORD)).who;
await forgot(RICARDO);
const temporary = lastTemporary(RICARDO);
const restricted = await signIn(RICARDO, temporary);
ok(restricted.status === 200 && restricted.body.passwordChangeRequired === true, "entra con la temporal: la sesión pide crear la contraseña", restricted.body);
ok(!restricted.headers.getSetCookie().some((cookie) => cookie.startsWith("agenda360_device=")), "sin dispositivo de confianza todavía");
r = await signIn(RICARDO, temporary);
ok(r.status === 401, "la temporal sirve una sola vez", r.body);
resetLimits();
await forgot(RICARDO);
sql(`update temporary_passwords set expires_at = now() - interval '1 minute' where used_at is null`);
r = await signIn(RICARDO, lastTemporary(RICARDO));
ok(r.status === 401, "vencida (más de 1 hora) no sirve", r.body);

console.log("\nLa sesión de la temporal sólo puede crear la contraseña nueva");
const me = restricted.who;
const userId = restricted.body.userId as string;
for (const [method, path] of [
  ["GET", `/businesses/${BUSINESS}`],
  ["GET", `/users/${userId}`],
  ["GET", "/admin/stats"],
  ["PUT", "/push/device"],
  ["GET", "/auth/two-factor"],
] as const) {
  r = await me(method, path, method === "GET" ? undefined : {});
  ok(r.status === 403 && r.body?.error?.code === "password_change_required", `${method} ${path}: 403 password_change_required`, r.body);
}
const mismatchPassword = randomPassword();
r = await me("POST", "/auth/change-password", { currentPassword: DEMO_PASSWORD, newPassword: randomPassword(), confirmPassword: mismatchPassword });
ok(r.status === 403 && r.body?.error?.code === "password_change_required", "cambiarla con la actual tampoco: primero la nueva", r.body);
r = await me("GET", "/auth/session");
ok(r.status === 200 && r.body.passwordChangeRequired === true, "ve su sesión (con la marca)", r.body);
r = await otherDevice("GET", `/businesses/${BUSINESS}`);
ok(r.status === 200, "su otra sesión sigue mientras no la cree", r.status);

console.log("\nCrear la contraseña nueva");
const shortPassword = randomBytes(2).toString("hex");
r = await me("POST", "/auth/new-password", { newPassword: shortPassword, confirmPassword: shortPassword });
ok(r.status === 400 && /8 caracteres/.test(r.body.error.message), "mínimo 8 caracteres", r.body);
const ricardoPassword = randomPassword();
r = await me("POST", "/auth/new-password", { newPassword: ricardoPassword, confirmPassword: `${ricardoPassword}x` });
ok(r.status === 400 && /no coinciden/.test(r.body.error.message), "tiene que coincidir con la confirmación", r.body);
r = await me("POST", "/auth/new-password", { newPassword: temporary, confirmPassword: temporary });
ok(r.status === 400 && /distinta de la temporal/.test(r.body.error.message), "distinta de la temporal", r.body);
r = await me("POST", "/auth/new-password", { newPassword: ricardoPassword, confirmPassword: ricardoPassword });
ok(r.status === 200 && r.body.passwordChangeRequired === false, "la guarda y la sesión queda libre", r.body);
ok(r.headers.getSetCookie().some((cookie) => cookie.startsWith("agenda360_device=")), "y el navegador queda de confianza con la nueva");
r = await me("GET", `/businesses/${BUSINESS}`);
ok(r.status === 200, "el panel responde sin volver a iniciar sesión", r.status);
r = await otherDevice("GET", `/businesses/${BUSINESS}`);
ok(r.status === 401, "su otra sesión se cerró", r.status);
r = await signIn(RICARDO, DEMO_PASSWORD);
ok(r.status === 401, "la contraseña de antes ya no sirve", r.body);
r = await signIn(RICARDO, ricardoPassword);
ok(r.status === 200 && r.body.passwordChangeRequired === false, "entra con la nueva", r.body);
r = await me("POST", "/auth/new-password", { newPassword: randomPassword(), confirmPassword: mismatchPassword });
ok(r.status === 409, "con la contraseña ya creada, /new-password no sirve", r.body);
const changedEmail = sql(
  `select subject || ' | ' || body from notifications where type = 'account_security_changed' and to_email = '${RICARDO}' order by created_at desc limit 1`,
);
ok(/Cambiaste tu contraseña/.test(changedEmail) && /Recuperar el acceso/.test(changedEmail), "le llega «Cambiaste tu contraseña»", changedEmail.slice(0, 160));
ok(count(`select count(*) from temporary_passwords t join users u on u.id = t.user_id where u.email = '${RICARDO}'`) === 0, "sus temporales se borran");

console.log("\nLos topes de pedidos");
resetLimits();
await forgot(VALERIA);
await forgot(VALERIA);
await forgot(VALERIA);
r = await forgot(VALERIA);
ok(r.status === 204 && temporaryEmails(VALERIA) === 3, "3 por email en una hora: el 4.º responde igual, sin email", { status: r.status, emails: temporaryEmails(VALERIA) });
sql(`delete from rate_limits where key like 'recuperar:hora:%'`);
r = await forgot(VALERIA);
const fifth = temporaryEmails(VALERIA);
sql(`update rate_limits set hits = 5 where key like 'recuperar:dia:%'`);
r = await forgot(VALERIA);
ok(r.status === 204 && fifth === 4 && temporaryEmails(VALERIA) === 4, "5 por email en un día", { fifth, now: temporaryEmails(VALERIA) });
const sameConnection = freshIp();
const statuses: number[] = [];
for (let i = 0; i < 11; i++) statuses.push((await forgot(`conexion-${i}@ejemplo.com`, sameConnection)).status);
ok(statuses.slice(0, 10).every((status) => status === 204) && statuses[10] === 429, "10 por hora desde una conexión: el 11.º, 429", statuses);

console.log("\nLa contraseña del soporte es temporal");
const admin = (await signIn("admin@demo.com", DEMO_PASSWORD)).who;
const valeriaId = sql(`select id from users where email = '${VALERIA}'`);
const supportPassword = randomPassword();
r = await admin("PUT", `/admin/users/${valeriaId}/password`, { password: supportPassword });
ok(r.status === 204 || r.status === 200, "el super admin le pone una contraseña", r.body);
ok(sql(`select password_change_required from users where id = '${valeriaId}'`) === "t", "queda marcada como temporal");
const supportEmail = sql(`select body from notifications where type = 'password_reset' and to_email = '${VALERIA}' order by created_at desc limit 1`);
ok(/temporal/.test(supportEmail) && !supportEmail.includes(supportPassword), "el email dice que es temporal y el registro no la guarda", supportEmail.slice(0, 160));
const valeria = await signIn(VALERIA, supportPassword);
ok(valeria.status === 200 && valeria.body.passwordChangeRequired === true, "al entrar con ella, tiene que crear la suya", valeria.body);
r = await valeria.who("POST", "/auth/new-password", { newPassword: supportPassword, confirmPassword: supportPassword });
ok(r.status === 400 && /distinta de la temporal/.test(r.body.error.message), "distinta de la del soporte", r.body);
const valeriaPassword = randomPassword();
r = await valeria.who("POST", "/auth/new-password", { newPassword: valeriaPassword, confirmPassword: valeriaPassword });
ok(r.status === 200 && sql(`select password_change_required from users where id = '${valeriaId}'`) === "f", "al crearla, se quita la marca", r.body);
ok((await signIn(VALERIA, valeriaPassword)).body.passwordChangeRequired === false, "y la próxima vez entra normal");
r = await admin("POST", `/admin/businesses/${BUSINESS}/members`, {
  firstName: "Nora",
  lastName: "Prueba",
  email: "nora.prueba@ejemplo.com",
  role: "staff",
  password: randomPassword(),
});
const noraTemporary = r.status === 200 || r.status === 201 ? sql(`select password_change_required from users where email = 'nora.prueba@ejemplo.com'`) : "sin alta";
ok(noraTemporary === "t", "el alta de un miembro del equipo también es temporal", { status: r.status, body: r.body, noraTemporary });

console.log("\nCambiar la contraseña en Perfil (cualquier cuenta)");
const elena = (await signIn(ELENA, DEMO_PASSWORD)).who;
const elenaSecond = (await signIn(ELENA, DEMO_PASSWORD)).who;
const elenaPassword = randomPassword();
r = await elena("POST", "/auth/change-password", { currentPassword: `${DEMO_PASSWORD}x`, newPassword: elenaPassword, confirmPassword: elenaPassword });
ok(r.status === 400 && /no es correcta/.test(r.body.error.message), "con la actual incorrecta, no", r.body);
ok(
  count(`select count(*) from audit_logs where action = 'session.login_failed' and summary like 'Contraseña actual incorrecta%' and entity_id = (select id from users where email = '${ELENA}')`) === 1,
  "y cuenta como intento fallido",
);
r = await elena("POST", "/auth/change-password", { currentPassword: DEMO_PASSWORD, newPassword: elenaPassword, confirmPassword: elenaPassword });
ok(r.status === 204, "recepción cambia su contraseña", r.body);
ok(r.headers.getSetCookie().some((cookie) => cookie.startsWith("agenda360_device=")), "con la cookie de dispositivo nueva");
ok((await elenaSecond("GET", `/businesses/${BUSINESS}`)).status === 401, "su otra sesión se cerró");
ok((await signIn(ELENA, elenaPassword)).status === 200, "entra con la nueva");

console.log("\nEl super admin, con su verificación en dos pasos");
r = await admin("POST", "/auth/two-factor/setup");
const secret = r.body.secret as string;
r = await admin("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
ok(r.status === 200, "activa la verificación en dos pasos", r.body);
sql(`update users set two_factor_last_step = null where email = 'admin@demo.com'`);
resetLimits();
await forgot("admin@demo.com");
const adminTemporary = lastTemporary("admin@demo.com");
const adminBrowser = browser();
r = await signIn("admin@demo.com", adminTemporary, adminBrowser);
ok(r.status === 200 && r.body.twoFactorRequired === true && !("userId" in r.body), "con la temporal, igual le pide el código", r.body);
const alert = sql(
  `select body from notifications where type = 'account_security_changed' and to_email = 'admin@demo.com' order by created_at desc limit 1`,
);
ok(/contraseña temporal/.test(alert), "le llega el email de seguridad (a él y al dueño de la plataforma)", alert.slice(0, 160));
r = await adminBrowser("POST", "/auth/login/two-factor", { challenge: r.body.challenge, code: codeAt(secret, timeStep()) });
ok(r.status === 200 && r.body.passwordChangeRequired === true, "con el código, entra a crear su contraseña", r.body);
r = await adminBrowser("GET", "/admin/stats");
ok(r.status === 403 && r.body?.error?.code === "password_change_required", "y /admin espera a que la cree", r.body);
const { changes } = await findAccountChanges(pool, null, new Date().toISOString(), 50);
ok(changes.some((change) => change.change === "Entró con una contraseña temporal"), "el aviso por ntfy al dueño", changes.map((change) => change.change));

console.log("\nLa actividad, sin la contraseña");
ok(count(`select count(*) from audit_logs where action = 'session.temporary_password_requested'`) >= 10, "cada pedido queda en Seguridad");
ok(
  count(`select count(*) from audit_logs where action = 'session.temporary_password_requested' and summary like '%no registrado%'`) >= 1,
  "también el de un email no registrado",
);
ok(count(`select count(*) from audit_logs where action = 'session.temporary_login'`) === 2, "y cada entrada con una temporal del email (Ricardo y el super admin)");
const leaked = [firstTemporary, temporary, adminTemporary, supportPassword].reduce(
  (total, password) => total + count(`select count(*) from audit_logs l where l::text like '%${password}%'`),
  0,
);
ok(leaked === 0, "la contraseña temporal no aparece en la actividad");

done("de recuperar la contraseña");
await pool.end();
process.exit();
