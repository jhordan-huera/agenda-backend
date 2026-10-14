// Topes de intentos exactos (spec 009): cada contraseña o código se cuenta antes de comprobarse, así
// que con muchos intentos a la vez sólo se comprueban los del tope. También las comprobaciones con la
// sesión abierta (cambiar el email o la contraseña, desactivar la verificación, códigos nuevos).
import { codeAt, timeStep } from "../src/services/totp.ts";
import { agent, checks, count, DEMO_PASSWORD, login, sql } from "./helpers/harness.ts";

const { ok, done } = checks();
const failed = (email: string, summary = "%") =>
  count(
    `select count(*) from audit_logs l join users u on u.id = l.actor_id
      where l.action = 'session.login_failed' and u.email = '${email}' and l.summary like '${summary}'`,
  );
const tally = (replies: { status: number }[]) =>
  replies.reduce<Record<number, number>>((all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }), {});

console.log("Inicio de sesión: muchas contraseñas a la vez");
const owner = "laura@demo.com";
const burst = await Promise.all(
  Array.from({ length: 100 }, () => agent({ ip: "203.0.113.10" })("POST", "/auth/login", { email: owner, password: "incorrecta", remember: false })),
);
const checked = failed(owner);
ok(checked >= 1 && checked <= 10, "de 100 contraseñas equivocadas a la vez, como mucho 10 se comprueban", { checked, respuestas: tally(burst) });
ok(burst.filter((r) => r.status === 429).length >= 90, "las demás reciben «Demasiados intentos…»", tally(burst));
let r = await agent({ ip: "203.0.113.10" })("POST", "/auth/login", { email: owner, password: DEMO_PASSWORD, remember: false });
ok(r.status === 429, "después, desde esa conexión ni la contraseña correcta entra hasta que pase el tiempo", r.body);
r = await agent({ ip: "203.0.113.11" })("POST", "/auth/login", { email: owner, password: DEMO_PASSWORD, remember: false });
ok(r.status === 200, "desde otra conexión, la dueña de la cuenta sigue entrando", r.body);

console.log("Verificación en dos pasos: muchos códigos a la vez");
const ADMIN = "admin@demo.com";
const admin = await login(ADMIN, { ip: "203.0.113.20" });
const secret: string = (await admin("POST", "/auth/two-factor/setup")).body.secret;
r = await admin("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
ok(r.status === 200, "el super admin activa la verificación", r.body);
const step = agent({ ip: "203.0.113.21" });
const { challenge } = (await step("POST", "/auth/login", { email: ADMIN, password: DEMO_PASSWORD, remember: false })).body;
const wrong = codeAt(secret, timeStep() + 10);
const codes = await Promise.all(Array.from({ length: 50 }, () => step("POST", "/auth/login/two-factor", { challenge, code: wrong })));
const wrongCodes = failed(ADMIN, "%código de verificación incorrecto%");
// Al bloquearse la conexión se borra además el paso intermedio: en una ráfaga pueden no llegar a
// comprobarse ni esos 5.
ok(wrongCodes <= 5, "de 50 códigos equivocados a la vez, como mucho 5 se comprueban", { wrongCodes, respuestas: tally(codes) });
ok(codes.every((reply) => reply.status !== 200), "y ninguno abre sesión", tally(codes));
const lastStep = Number(sql(`select coalesce(two_factor_last_step, 0) from users where email = '${ADMIN}'`));
r = await agent({ ip: "203.0.113.22" })("POST", "/auth/login/two-factor", { challenge, code: codeAt(secret, Math.max(lastStep + 1, timeStep())) });
ok(r.status === 401, "y ese paso intermedio ya no sirve, ni con el código correcto: hay que volver a escribir la contraseña", r.body);

console.log("Con la sesión abierta");
const jhordan = await login("jhordan@demo.com", { ip: "203.0.113.30" });
const me = (await jhordan("GET", `/users/${jhordan.session.userId}`)).body;
const profile = { firstName: me.firstName, lastName: me.lastName, phone: me.phone, avatarUrl: me.avatarUrl, email: "otro.email@example.com" };
const attempts: number[] = [];
for (let i = 0; i < 12; i++) attempts.push((await jhordan("PUT", `/users/${me.id}`, { ...profile, currentPassword: "incorrecta" })).status);
ok(
  attempts.slice(0, 9).every((status) => status === 400) && attempts.slice(-2).every((status) => status === 429),
  "cambiar el email con una contraseña equivocada: al llegar al tope se bloquea",
  attempts,
);
ok(failed("jhordan@demo.com", "Contraseña incorrecta al cambiar el email%") === attempts.filter((s) => s === 400).length, "y cada fallo queda en los eventos de sesión");
r = await agent({ ip: "203.0.113.30" })("POST", "/auth/login", { email: "jhordan@demo.com", password: DEMO_PASSWORD, remember: false });
ok(r.status === 429, "es el mismo tope que el del inicio de sesión desde esa conexión", r.body);

r = await admin("POST", "/auth/change-password", { currentPassword: "incorrecta", newPassword: "Nueva-clave-123", confirmPassword: "Nueva-clave-123" });
ok(r.status === 400 && failed(ADMIN, "Contraseña actual incorrecta al cambiar la contraseña%") === 1, "cambiar la contraseña con la actual equivocada queda registrado", r.body);
r = await admin("POST", "/auth/two-factor/disable", { password: "incorrecta", code: "123456" });
ok(r.status === 400 && failed(ADMIN, "Contraseña incorrecta al desactivar%") === 1, "desactivar la verificación con la contraseña equivocada, también", r.body);
r = await admin("POST", "/auth/two-factor/disable", { password: DEMO_PASSWORD, code: wrong });
ok(r.status === 400 && failed(ADMIN, "Código incorrecto al desactivar%") === 1, "y con el código equivocado", r.body);
r = await admin("POST", "/auth/two-factor/recovery-codes", { code: wrong });
ok(r.status === 400 && failed(ADMIN, "Código incorrecto al generar%") === 1, "los códigos de recuperación nuevos con un código equivocado, también", r.body);

console.log("Uso normal");
const elena = agent({ ip: "203.0.113.40" });
r = await elena("POST", "/auth/login", { email: "elena@demo.com", password: "incorrecta", remember: false });
ok(r.status === 401, "una contraseña equivocada", r.body);
r = await elena("POST", "/auth/login", { email: "elena@demo.com", password: DEMO_PASSWORD, remember: false });
ok(r.status === 200, "y después la correcta: entra", r.body);
const hash = "substr(encode(sha256(convert_to('elena@demo.com', 'UTF8')), 'hex'), 1, 32)";
ok(count(`select count(*) from rate_limits where key like 'acceso:cuenta%:' || ${hash} || '%'`) === 0, "y los fallos de su cuenta vuelven a cero");

done("de los topes de intentos");
