// Endurecimiento de seguridad (spec 009): caducidad máxima de «Recordarme», secreto de la verificación
// cifrado, respuestas públicas sin cookie, firma de la IP con caducidad, la API que no arranca
// desprotegida en la nube, datos de más, nombres sin enlaces y el tope de emails del público.
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, DEMO_PASSWORD, freePort, login, PROXY_SECRET, sql, startApi } from "./helpers/harness.ts";
import { getAvailableSlots } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";
import { codeAt, generateSecret, timeStep } from "../src/services/totp.ts";

const { ok, done } = checks();
const latestSession = (email: string) =>
  sql(`select s.id from sessions s join users u on u.id = s.user_id where u.email = '${email}' order by s.created_at desc limit 1`);
const servers: { stop: () => void }[] = [];

try {
  console.log("«Recordarme» con caducidad máxima");
  const owner = await login("jhordan@demo.com", { ip: "203.0.113.60" });
  let session = latestSession("jhordan@demo.com");
  sql(`update sessions set created_at = now() - interval '10 days', last_seen_at = now() - interval '1 hour' where id = '${session}'`);
  ok((await owner("GET", "/auth/session")).body?.userId, "una sesión de hace 10 días, en uso, sigue valiendo");
  sql(`update sessions set created_at = now() - interval '31 days', last_seen_at = now() - interval '1 hour', expires_at = now() + interval '10 days' where id = '${session}'`);
  ok((await owner("GET", "/auth/session")).body === null, "una de hace 31 días ya no, aunque se haya usado hace una hora");
  const admin = await login("admin@demo.com", { ip: "203.0.113.61" });
  session = latestSession("admin@demo.com");
  ok(count(`select count(*) from sessions where id = '${session}' and expires_at <= now() + interval '7 days 1 minute'`) === 1, "la del super admin dura 7 días");
  sql(`update sessions set created_at = now() - interval '8 days', last_seen_at = now() - interval '1 hour', expires_at = now() + interval '5 days' where id = '${session}'`);
  ok((await admin("GET", "/auth/session")).body === null, "y una suya de hace 8 días ya no vale");

  console.log("Secreto de la verificación en dos pasos, cifrado");
  const CIPHER = "cifrado.dos@example.com";
  sql(
    `insert into users (first_name, last_name, email, password_hash, platform_role)
     values ('Cifra', 'Prueba', '${CIPHER}', '${await bcrypt.hash(DEMO_PASSWORD, 10)}', 'super_admin')`,
  );
  const cipher = await login(CIPHER, { ip: "203.0.113.62" });
  const secret: string = (await cipher("POST", "/auth/two-factor/setup")).body.secret;
  ok(sql(`select two_factor_pending_secret like 'v1.%' and position('${secret}' in two_factor_pending_secret) = 0 from users where email = '${CIPHER}'`) === "t", "al generarlo se guarda cifrado");
  await cipher("POST", "/auth/two-factor/enable", { code: codeAt(secret, timeStep()) });
  ok(sql(`select two_factor_secret like 'v1.%' from users where email = '${CIPHER}'`) === "t", "y al activarlo, también");
  const legacy = generateSecret();
  sql(`update users set two_factor_secret = '${legacy}', two_factor_last_step = null where email = '${CIPHER}'`);
  const again = agent({ ip: "203.0.113.63" });
  const { challenge } = (await again("POST", "/auth/login", { email: CIPHER, password: DEMO_PASSWORD, remember: false })).body;
  let r = await again("POST", "/auth/login/two-factor", { challenge, code: codeAt(legacy, timeStep()) });
  ok(r.status === 200, "un secreto en claro de antes sigue dejando entrar", r.body);
  ok(sql(`select two_factor_secret like 'v1.%' from users where email = '${CIPHER}'`) === "t", "y queda cifrado después del código");

  console.log("Respuestas públicas sin cookie");
  const browser = await login("jhordan@demo.com", { ip: "203.0.113.64" });
  const stale = () => sql(`update sessions set last_seen_at = now() - interval '1 hour' where id = '${latestSession("jhordan@demo.com")}'`);
  stale();
  ok((await browser("GET", "/auth/session")).headers.getSetCookie().length === 1, "(una ruta con sesión sí renueva la cookie)");
  for (const path of ["/public/businesses/jhordan", "/public/platform-settings", "/public/categories", "/public/captcha"]) {
    stale();
    const reply = await browser("GET", path);
    ok(reply.status === 200 && reply.headers.getSetCookie().length === 0, `${path} no lleva la cookie de sesión`, reply.headers.getSetCookie());
  }

  console.log("Firma de la IP del proxy");
  const sign = (ip: string, ts: string) => createHmac("sha256", PROXY_SECRET).update(`${ip}.${ts}`).digest("hex");
  const raw = agent();
  const failFrom = async (ip: string, headers: Record<string, string>) => {
    await raw("POST", "/auth/login", { email: "pedro@demo.com", password: "incorrecta", remember: false }, headers);
    return sql(`select ip from audit_logs where action = 'session.login_failed' order by created_at desc limit 1`);
  };
  const now = String(Math.floor(Date.now() / 1000));
  ok((await failFrom("", { "x-agendo-client-ip": "192.0.2.77", "x-agendo-client-ts": now, "x-agendo-client-sig": sign("192.0.2.77", now) })) === "192.0.2.77", "con una firma válida se usa la IP del visitante");
  const old = String(Math.floor(Date.now() / 1000) - 200);
  ok((await failFrom("", { "x-agendo-client-ip": "192.0.2.78", "x-agendo-client-ts": old, "x-agendo-client-sig": sign("192.0.2.78", old) })) !== "192.0.2.78", "una firma de hace más de 2 minutos no sirve");
  ok((await failFrom("", { "x-agendo-client-ip": "192.0.2.79", "x-agendo-client-ts": now, "x-agendo-client-sig": sign("192.0.2.1", now) })) !== "192.0.2.79", "ni la firma de otra IP");
  ok((await failFrom("", { "x-agendo-client-ip": "192.0.2.80", "x-agendo-proxy-secret": PROXY_SECRET })) !== "192.0.2.80", "el secreto fijo de antes ya no vale (fase 2)");

  console.log("En la nube no arranca desprotegida");
  const cloud = {
    VERCEL: "1",
    TURNSTILE_SITE_KEY: "clave-del-sitio",
    TURNSTILE_SECRET_KEY: "clave-secreta",
    TWO_FACTOR_KEY: "clave-de-pruebas-del-cifrado-de-la-verificacion",
  };
  const boot = async (env: Record<string, string | undefined>) => {
    const result = spawnSync(process.execPath, ["src/server.ts"], {
      env: { ...process.env, PORT: String(await freePort()), ...cloud, ...env },
      encoding: "utf8",
      timeout: 15_000,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  for (const [label, env, expected] of [
    ["sin las claves del CAPTCHA", { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined }, "faltan TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY"],
    ["sin PROXY_SECRET", { PROXY_SECRET: undefined }, "falta PROXY_SECRET"],
    ["sin TWO_FACTOR_KEY", { TWO_FACTOR_KEY: undefined }, "falta TWO_FACTOR_KEY"],
    ["con una base remota sin cifrar", { DATABASE_URL: "postgresql://usuario:clave-muy-secreta@db.example.invalid:5432/x", DATABASE_SSL: "false" }, "DATABASE_SSL debe valer true"],
    ["con sslmode en la dirección", { DATABASE_URL: `${process.env.TEST_DATABASE_URL}?sslmode=disable` }, "no debe llevar sslmode"],
  ] as const) {
    const result = await boot(env);
    ok(
      result.status === 1 && result.output.includes("Configuración insegura para la nube") && result.output.includes(expected),
      `${label}: no arranca y dice qué falta`,
      result,
    );
    ok(!result.output.includes("clave-muy-secreta") && !result.output.includes(PROXY_SECRET), `${label}: sin mostrar ningún valor`);
  }
  const hosted = await startApi(cloud);
  servers.push(hosted);
  // Avisos en el celular (spec 013): sin claves VAPID no hay avisos, pero la API arranca igual en la nube.
  const keyless = await startApi({ ...cloud, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" });
  servers.push(keyless);
  const keylessHealth = await fetch(`${keyless.base}/health`).then((res) => res.json(), () => null);
  ok(keyless.exited() === null && keylessHealth?.ok === true && keylessHealth.push === false, "en la nube sin claves VAPID arranca igual y /api/health dice push: false", keylessHealth);
  ok(/Avisos en el celular desactivados: faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY\./.test(keyless.output()), "y el registro dice qué falta, sin valores", keyless.output().slice(0, 300));
  const hostedHealth = await fetch(`${hosted.base}/health`).then((res) => res.json(), () => null);
  ok(hostedHealth?.push === true && !JSON.stringify(hostedHealth).includes(process.env.VAPID_PUBLIC_KEY ?? "-"), "con las claves, push: true (sin mostrarlas)", hostedHealth);
  const cookie = (await fetch(`${hosted.base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: JSON.stringify({ email: "laura@demo.com", password: DEMO_PASSWORD, remember: true }),
  })).headers.getSetCookie()[0] ?? "";
  ok(/;\s*Secure/i.test(cookie), "y con todo, en la nube la cookie va siempre como segura", cookie.replace(/=[^;]+/, "=…"));

  console.log("Cada uno recibe sólo lo que necesita");
  const ownerBusiness: string = owner.session.businessId;
  const jhordan = await login("jhordan@demo.com", { ip: "203.0.113.65" });
  sql(
    `insert into notifications (business_id, type, to_email, subject, body, status)
     values ('${ownerBusiness}', 'plan_change_requested', 'admin@demo.com', 'Solicitud', 'Solicitud', 'sent'),
            ('${ownerBusiness}', 'booking_received', 'negocio@example.com', 'Nueva reserva', 'Nueva reserva', 'sent')`,
  );
  const outbox = (await jhordan("GET", `/businesses/${ownerBusiness}/notifications`)).body as { type: string }[];
  ok(!outbox.some((n) => n.type === "plan_change_requested") && outbox.some((n) => n.type === "booking_received"), "la bandeja del negocio no muestra los emails a los super admin", outbox.map((n) => n.type));

  const valeria = await login("valeria@demo.com", { ip: "203.0.113.66" });
  const clinic: string = valeria.session.businessId;
  sql(
    `update professionals set email = 'agenda@example.com', meeting_url = 'https://meet.example.com/sala',
            bank_accounts = '[{"bank":"Produbanco","accountType":"checking","number":"0200123456","holder":"Clínica","holderId":""}]'::jsonb
      where business_id = '${clinic}'`,
  );
  const seen = (await valeria("GET", `/businesses/${clinic}/professionals`)).body as { userId: string | null; email: string; meetingUrl: string; bankAccounts: unknown[] }[];
  const mine = seen.filter((p) => p.userId === valeria.session.userId);
  const others = seen.filter((p) => p.userId !== valeria.session.userId);
  ok(others.length > 0 && others.every((p) => p.email === "" && p.meetingUrl === "" && p.bankAccounts.length === 0), "el rol Profesional no recibe el email, la sala ni las cuentas de las otras agendas", others);
  ok(mine.length === 1 && mine[0].email !== "" && mine[0].bankAccounts.length === 1, "de la suya, todo", mine);
  const elena = await login("elena@demo.com", { ip: "203.0.113.67" });
  const reception = (await elena("GET", `/businesses/${clinic}/professionals`)).body as { bankAccounts: unknown[]; meetingUrl: string }[];
  ok(reception.every((p) => p.bankAccounts.length === 1 && p.meetingUrl !== ""), "Recepción sí las recibe (manda datos de pago y enlaces por WhatsApp)");

  const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
  servers.push(strict);
  const adminStrict = await login("admin@demo.com", { base: strict.base, ip: "203.0.113.68" });
  r = await adminStrict("GET", `/users/${jhordan.session.userId}`);
  ok(r.status === 403 && r.body.error.code === "two_factor_required", "un super admin sin la verificación no ve la ficha de otro usuario", r.body);
  r = await adminStrict("GET", `/users/${adminStrict.session.userId}`);
  ok(r.status === 200 && r.body.email === "admin@demo.com", "la suya sí (la necesita para activarla)", r.body);

  console.log("Nombres sin enlaces ni emails");
  const visitor = agent({ ip: "203.0.113.69" });
  const profile: PublicBusinessProfile = (await visitor("GET", "/public/businesses/jhordan")).body;
  const service = profile.services.find((s) => s.modes.includes("business") && s.peoplePerSession === 1)!;
  const zoned = getZonedNow(profile.business.timezone);
  const slots: { date: string; startTime: string }[] = [];
  for (let d = 3; d < 90 && slots.length < 6; d++) {
    const date = addDaysISO(zoned.date, d);
    const [startTime] = getAvailableSlots(date, service.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now: zoned });
    if (startTime) slots.push({ date, startTime });
  }
  let seed = 500;
  const booking = (name: string, slot = slots[0], base?: string) => {
    seed++;
    return agent({ base, ip: `203.0.113.${seed % 200}` })("POST", "/public/businesses/jhordan/bookings", {
      serviceId: service.id,
      ...slot,
      documentId: cedulaFor(`nombres-${seed}`),
      name,
      email: `persona.${seed}@example.com`,
      phone: `+593 99 ${seed} 1234`,
      notes: "",
    });
  };
  for (const name of ["Ana\nVisita nuestra web", "ana@correo.ec", "Promo http://premios.example", "Gana en www.premios", "Gana en premios.com"]) {
    r = await booking(name);
    ok(r.status === 400 && /sólo el nombre/.test(JSON.stringify(r.body)), `en la reserva, «${name.replace("\n", "↵")}» no vale como nombre`, r.body);
  }
  r = await agent({ ip: "203.0.113.70" })("POST", "/auth/register", {
    firstName: "Juan www.premios",
    lastName: "Pérez",
    email: "registro.enlace@example.com",
    password: "Clave-larga-123",
    confirmPassword: "Clave-larga-123",
  });
  ok(r.status === 400 && /sólo el nombre/.test(JSON.stringify(r.body)), "en el registro tampoco", r.body);

  console.log("Tope de emails del público");
  const publicSoFar = count(
    `select count(*) from notifications n
      where n.created_at > now() - interval '24 hours' and n.type in ('welcome', 'booking_created', 'appointment_confirmed')
        and (n.type = 'welcome' or exists (select 1 from appointments a where a.id = n.appointment_id and a.source = 'booking_page' and a.created_at = n.created_at))`,
  );
  const limited = await startApi({ PUBLIC_EMAILS_PER_DAY: String(publicSoFar + 2) });
  servers.push(limited);
  const first = await booking("Primera Persona", slots[1], limited.base);
  const second = await booking("Segunda Persona", slots[2], limited.base);
  const third = await booking("Tercera Persona", slots[3], limited.base);
  ok(first.body.emailSent !== false && second.body.emailSent !== false && third.status === 200 && third.body.emailSent === false, "pasado el tope del público, la reserva sale sin email", [first.body.emailSent, second.body.emailSent, third.body]);
  ok(/reservas online y registros/.test(sql(`select last_error from notifications where appointment_id = '${third.body.appointmentId}' and type = 'booking_created'`)), "con el motivo del tope del público");
  const ownerLimited = await login("jhordan@demo.com", { base: limited.base, ip: "203.0.113.71" });
  r = await ownerLimited("PATCH", `/businesses/${ownerBusiness}/appointments/${third.body.appointmentId}/status`, { status: "confirmed" });
  ok(
    r.status === 200 &&
      sql(`select status from notifications where appointment_id = '${third.body.appointmentId}' and type = 'appointment_confirmed'`).split("\n").every((status) => status !== "failed"),
    "pero el aviso que manda el negocio al confirmarla sí sale",
    sql(`select type || ':' || status || ':' || coalesce(last_error, '') from notifications where appointment_id = '${third.body.appointmentId}'`),
  );
} finally {
  for (const server of servers) server.stop();
}

done("del endurecimiento de seguridad");
