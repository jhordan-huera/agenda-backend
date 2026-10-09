// Abusos de la página pública y de la API: el reintento de una reserva sin el enlace de pago, los
// topes diarios de reservas, clientes y emails, los límites de intentos compartidos entre servidores
// (en la base), el CAPTCHA del registro sin dejar pasar nada si Cloudflare falla, las imágenes de
// otros (ni se aceptan ni se borran), las subidas sin usar y la Function URL de Lambda.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Professional, PublicBusinessProfile } from "../src/shared/types/index.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const ORIGIN = new URL(BASE).origin;
const PROXY_SECRET = process.env.PROXY_SECRET ?? "";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
let ipCounter = 10;
/** Cada petición desde una IP distinta (salvo que se indique): no se gastan los límites por conexión. */
const nextIp = () => `198.51.${100 + Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
type Call = (method: string, path: string, body?: unknown, ip?: string) => Promise<{ status: number; body: any }>;
function agent(base = BASE, headers: Record<string, string> = {}): Call {
  let cookie = "";
  return async (method, path, body, ip = nextIp()) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": PROXY_SECRET,
        "x-agendo-client-ip": ip,
        ...headers,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const count = (query: string) => Number(sql(query));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const put = (upload: { url: string; headers: Record<string, string> }, body: Buffer) =>
  fetch(ORIGIN + upload.url, { method: "PUT", headers: upload.headers, body });
const storedFile = (url: string) => join(process.env.LOCAL_STORAGE_DIR!, "imagenes", decodeURIComponent(url.replace("/api/files/public/imagenes/", "")));

/** Otra API contra la misma base (como otra instancia en Vercel o Lambda). */
const servers: ChildProcess[] = [];
let nextPort = Number(new URL(BASE).port) + 20;
async function startApi(env: Record<string, string>): Promise<{ base: string; output: () => string }> {
  const port = nextPort++;
  let output = "";
  const child = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  servers.push(child);
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/health`).then((res) => res.ok, () => false)) break;
    await sleep(100);
  }
  return { base, output: () => output };
}
/** Servidor de pruebas que imita a otro servicio (Cloudflare, ntfy): guarda lo que recibe. */
async function fakeService(reply: (body: any) => { status: number; json?: unknown }): Promise<{ url: string; received: any[]; server: Server }> {
  const received: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      received.push(body);
      const { status, json } = reply(body);
      res.writeHead(status, { "Content-Type": "application/json" }).end(json === undefined ? "" : JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received, server };
}

const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session, B: `/businesses/${session.businessId}` };
};
const jhordan = await login("jhordan@demo.com");
const laura = await login("laura@demo.com");
const visitor = agent();
const person = (seed: string) => ({
  documentId: cedulaFor(`${seed}@correo.ec`),
  name: `Paciente ${seed}`,
  email: `${seed}@correo.ec`,
  phone: "+593 99 444 5555",
  notes: "",
});

/** Horas libres de una agenda (las primeras de varios días), desde mañana o desde `from`. */
async function freeSlots(slug: string, serviceId: string, professionalId: string, wanted: number, from?: string) {
  const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const service = profile.services.find((s) => s.id === serviceId)!;
  const now = getZonedNow(profile.business.timezone);
  const context = { ...profile, settings: profile.business.bookingSettings, now };
  const slots: { date: string; startTime: string }[] = [];
  for (let d = 1; d < 50 && slots.length < wanted; d++) {
    const date = addDaysISO(now.date, d);
    if (from && date < from) continue;
    for (const startTime of getAvailableSlots(date, service.durationMinutes, scopeToProfessional(context, professionalId)).filter((_, i) => i % 2 === 0)) {
      if (slots.length < wanted) slots.push({ date, startTime });
    }
  }
  return slots;
}

const jhordanBusiness = (await jhordan.a("GET", jhordan.B)).body;
await jhordan.a("PATCH", jhordan.B, { bookingSettings: { ...jhordanBusiness.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
const jhordanAgenda: Professional = (await jhordan.a("GET", `${jhordan.B}/professionals`)).body.find((p: Professional) => p.userId === jhordan.session.userId);
const paidService = (await jhordan.a("GET", `${jhordan.B}/services`)).body.find(
  (s: { price: number; showPrice: boolean; isActive: boolean; modes: string[] }) => s.price > 0 && s.showPrice && s.isActive && s.modes.includes("business"),
);
const slots = await freeSlots("jhordan", paidService.id, jhordanAgenda.id, 14);
let slotIndex = 0;
const bookJhordan = (who: object, call: Call = visitor) =>
  call("POST", "/public/businesses/jhordan/bookings", { serviceId: paidService.id, professionalId: jhordanAgenda.id, ...slots[slotIndex++], ...who });

try {
  console.log("Reintento de una reserva: sin el enlace de pago");
  {
    const { id: _id, businessId: _b, sortOrder: _s, createdAt: _c, ...rest } = jhordanAgenda;
    const bank = { bank: "Produbanco", accountType: "savings", number: "0200123456", holder: "Jhordan Demo", holderId: "" };
    await jhordan.a("PUT", `${jhordan.B}/professionals/${jhordanAgenda.id}`, { ...rest, bankAccount: bank });
    const ana = person("reintento-pago");
    const slot = slots[slotIndex++];
    const book = (who: object) =>
      visitor("POST", "/public/businesses/jhordan/bookings", { serviceId: paidService.id, professionalId: jhordanAgenda.id, ...slot, ...who });
    const first = await book(ana);
    const token: string = first.body?.payment?.token;
    ok(first.status === 200 && /^[0-9a-f]{32}$/.test(token) && first.body.paymentByEmail === false, "la primera vez trae los datos y el enlace de pago", first.body);
    const again = await book(ana);
    ok(again.status === 200 && again.body.appointmentId === first.body.appointmentId, "el reintento devuelve la misma cita", again.body);
    ok(again.body.payment === null && again.body.paymentByEmail === true, "pero sin datos ni enlace de pago: «revisa tu email»", again.body);
    ok(!JSON.stringify(again.body).includes(token), "el token no aparece en ninguna parte de la respuesta", again.body);
    const guessed = await book({ ...ana, email: "adivino@correo.ec", phone: "+593 98 111 2222" });
    ok(guessed.status === 409 && !JSON.stringify(guessed.body).includes(token), "con la cédula y la hora pero otro email y otro teléfono: «hora ocupada», sin token", guessed.body);
    const guessedEmail = await book({ ...ana, email: "ana@otro.ec", phone: "+593 98 111 2222" });
    ok(guessedEmail.status === 409 && guessedEmail.body.error.code === "conflict", "un email adivinado da la misma respuesta (no confirma nada)", guessedEmail.body);
    await jhordan.a("PUT", `${jhordan.B}/professionals/${jhordanAgenda.id}`, { ...rest, bankAccount: null });
  }

  console.log("Topes de emails (a terceros y a pacientes nuevos)");
  {
    const ntfy = await fakeService(() => ({ status: 200, json: {} }));
    const thirdParty = () =>
      count(`select count(*) from notifications where created_at between now() - interval '24 hours' and now()
               and type in ('welcome', 'booking_created', 'appointment_confirmed', 'appointment_updated', 'appointment_cancelled', 'appointment_reminder')
               and (status <> 'failed' or attempts > 0)`);
    const limited = await startApi({ THIRD_PARTY_EMAILS_PER_DAY: String(thirdParty() + 1), NTFY_TOPIC: "agenda-pruebas", NTFY_SERVER: ntfy.url });
    const limitedVisitor = agent(limited.base);
    const one = person("tope-email-1");
    let r = await bookJhordan(one, limitedVisitor);
    ok(r.status === 200 && r.body.emailSent === true, "hasta el tope, el paciente recibe su confirmación", r.body);
    const two = person("tope-email-2");
    r = await bookJhordan(two, limitedVisitor);
    ok(r.status === 200 && r.body.emailSent === false, "pasado el tope la reserva se hace, pero sin email al paciente", r.body);
    const held = sql(`select status || ' · ' || attempts || ' · ' || coalesce(last_error, '') from notifications where to_email = '${two.email}'`);
    ok(/^failed · 0 · No enviado: se alcanzó el tope/.test(held), "queda en el historial como no enviado, con el motivo", held);
    ok(
      sql(`select status from notifications where appointment_id = '${r.body.appointmentId}' and type = 'booking_received'`) === "queued",
      "el aviso al negocio de la reserva sí sale (no es a terceros)",
    );
    r = await agent(limited.base)("POST", "/auth/register", { firstName: "Spam", lastName: "Robot", email: "victima.spam@correo.ec", password: "contrasena123", confirmPassword: "contrasena123" });
    ok(r.status === 201, "el registro se hace", r.body);
    ok(sql("select status from notifications where to_email = 'victima.spam@correo.ec' and type = 'welcome'") === "failed", "pero la bienvenida (a una dirección sin comprobar) también se frena");
    await bookJhordan(person("tope-email-3"), limitedVisitor);
    for (let i = 0; i < 30 && ntfy.received.length === 0; i++) await sleep(100);
    await sleep(300);
    ok(
      ntfy.received.length === 1 && ntfy.received[0].topic === "agenda-pruebas" && /tope diario/i.test(ntfy.received[0].title),
      "un solo aviso por ntfy al llegar al tope (no uno por email)",
      ntfy.received,
    );
    ok(/Tope de \d+ emails a terceros/.test(limited.output()), "y queda en el registro de la API", limited.output().slice(-400));
    ntfy.server.close();

    // Un negocio con 20 emails a pacientes nuevos en 24 h (reservas de clientes creados hoy por la página).
    const appointmentId = sql(`select appointment_id from notifications where to_email = '${one.email}' limit 1`);
    sql(
      `insert into notifications (business_id, type, to_email, subject, body, appointment_id, status, attempts)
       select a.business_id, 'booking_created', 'relleno' || g || '@correo.ec', 'Reserva', '', a.id, 'sent', 1
         from appointments a, generate_series(1, 20) g where a.id = '${appointmentId}'`,
    );
    const newcomer = person("tope-email-nuevo");
    r = await bookJhordan(newcomer);
    ok(r.status === 200 && r.body.emailSent === false, "pasado el tope del negocio, otro paciente nuevo reserva sin email", r.body);
    ok(/tope de 20 emails a pacientes nuevos/.test(sql(`select last_error from notifications where to_email = '${newcomer.email}'`)), "con el motivo del tope del negocio");
    const maria = (await jhordan.a("GET", `${jhordan.B}/clients`)).body.find((c: { name: string }) => c.name === "María López");
    r = await bookJhordan({ documentId: maria.documentId, name: "María López", email: maria.email, phone: maria.phone, notes: "" });
    ok(r.status === 200 && r.body.emailSent === true, "una paciente que ya era del negocio sí recibe su confirmación", r.body);
    sql(`delete from notifications where to_email like 'relleno%@correo.ec'`);
  }

  console.log("Tope de reservas online por día");
  {
    // Free: como mucho una cuarta parte del cupo mensual (20 citas) en 24 h → 5.
    const bella = (await laura.a("GET", laura.B)).body;
    await laura.a("PATCH", laura.B, { bookingSettings: { ...bella.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
    const agendaId = sql(`select id from professionals where business_id = '${laura.session.businessId}' limit 1`);
    const service = (await laura.a("GET", `${laura.B}/services`)).body.find((s: { isActive: boolean; modes: string[] }) => s.isActive && s.modes.includes("business"));
    // El mes que viene: el actual ya tiene sus 20 citas en los datos demo.
    const nextMonth = sql("select to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM-DD')");
    const bellaSlots = await freeSlots(bella.slug, service.id, agendaId, 3, nextMonth);
    const recent = () => count(`select count(*) from appointments where business_id = '${laura.session.businessId}' and source = 'booking_page' and created_at between now() - interval '24 hours' and now()`);
    // Reservas falsas ya canceladas (también cuentan): el negocio queda a una del tope.
    const missing = 4 - recent();
    if (missing > 0) {
      sql(
        `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
         select '${laura.session.businessId}', (select id from clients where business_id = '${laura.session.businessId}' limit 1), '${service.id}', '${agendaId}',
                current_date + 40, '08:00', '08:30', 'cancelled', 0, 'booking_page'
           from generate_series(1, ${missing})`,
      );
    }
    const bookBella = (slot: object, who: object) => visitor("POST", `/public/businesses/${bella.slug}/bookings`, { serviceId: service.id, ...slot, ...who });
    let r = await bookBella(bellaSlots[0], person("bella-1"));
    ok(r.status === 200, "la quinta reserva online del día se hace", r.body);
    r = await bookBella(bellaSlots[1], person("bella-2"));
    ok(
      r.status === 429 && r.body.error.code === "rate_limited" && /no puede recibir más reservas online por hoy/.test(r.body.error.message) && /WhatsApp/.test(r.body.error.message),
      "la sexta no: «escríbele por WhatsApp»",
      r.body,
    );
    sql(`update appointments set created_at = now() - interval '25 hours' where business_id = '${laura.session.businessId}' and source = 'booking_page'`);
    r = await bookBella(bellaSlots[1], person("bella-2"));
    ok(r.status === 200, "pasadas 24 h vuelve a recibir reservas", r.body);
  }

  console.log("Tope de clientes nuevos por día (y el del plan)");
  {
    const createdToday = () => count(`select count(*) from clients where business_id = '${jhordan.session.businessId}' and source = 'booking_page' and created_at between now() - interval '24 hours' and now()`);
    sql(
      `insert into clients (business_id, name, email, source)
       select '${jhordan.session.businessId}', 'Falso ' || g, 'falso' || g || '@correo.ec', 'booking_page' from generate_series(1, ${15 - createdToday()}) g`,
    );
    let r = await bookJhordan(person("cliente-16"));
    ok(r.status === 429 && /no puede recibir más reservas online por hoy/.test(r.body.error.message), "el cliente nuevo número 16 del día no se crea", r.body);
    ok(count(`select count(*) from clients where email = 'cliente-16@correo.ec'`) === 0, "(ni queda a medias)");
    const maria = (await jhordan.a("GET", `${jhordan.B}/clients`)).body.find((c: { name: string }) => c.name === "María López");
    r = await bookJhordan({ documentId: maria.documentId, name: "María López", email: maria.email, phone: "", notes: "" });
    ok(r.status === 400, "(el teléfono es obligatorio)", r.body);
    r = await bookJhordan({ documentId: maria.documentId, name: "María López", email: maria.email, phone: maria.phone, notes: "" });
    ok(r.status === 200, "una paciente que ya existía sí reserva", r.body);
    sql(`delete from clients where business_id = '${jhordan.session.businessId}' and email like 'falso%@correo.ec'`);

    // Free: 50 clientes. Los creados por la página que nunca tuvieron una cita activa no cuentan.
    const usage = async () => (await laura.a("GET", `${laura.B}/subscription/usage`)).body.clients as number;
    const before = await usage();
    const total = count(`select count(*) from clients where business_id = '${laura.session.businessId}'`);
    sql(
      `insert into clients (business_id, name, email, source, created_at)
       select '${laura.session.businessId}', 'Reserva falsa ' || g, 'reserva-falsa' || g || '@correo.ec', 'booking_page', now() - interval '3 days'
         from generate_series(1, ${50 - total}) g`,
    );
    ok((await usage()) === before, "50 fichas, pero las de reservas falsas (sin citas) no gastan el cupo del plan", { before, now: await usage() });
    r = await laura.a("POST", `${laura.B}/clients`, { name: "Paciente Real", documentId: cedulaFor("paciente-real"), email: "real@correo.ec", phone: "", address: "", notes: "", isActive: true });
    ok(r.status === 200, "el negocio sigue pudiendo agregar clientes", r.body);
    const fake = sql(`select id from clients where email = 'reserva-falsa1@correo.ec'`);
    const service = sql(`select id from services where business_id = '${laura.session.businessId}' limit 1`);
    const agendaId = sql(`select id from professionals where business_id = '${laura.session.businessId}' limit 1`);
    sql(
      `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
       values ('${laura.session.businessId}', '${fake}', '${service}', '${agendaId}', current_date + 45, '07:00', '07:30', 'pending', 0, 'booking_page')`,
    );
    ok((await usage()) === before + 2, "con una cita sin cancelar, sí cuenta", await usage());
    sql(`delete from clients where business_id = '${laura.session.businessId}' and email like 'reserva-falsa%@correo.ec'`);
  }

  console.log("Límites de intentos compartidos entre servidores (en la base)");
  {
    const other = await startApi({});
    const lookup = (base: string, ip: string) =>
      agent(base)("POST", "/public/businesses/jhordan/clients/lookup", { documentId: cedulaFor("limite-compartido") }, ip).then((r) => r.status);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push(await lookup(i % 2 === 0 ? BASE : other.base, "203.0.113.50"));
    ok(statuses.every((s) => s === 200), "30 búsquedas repartidas entre dos servidores", statuses);
    ok((await lookup(other.base, "203.0.113.50")) === 429 && (await lookup(BASE, "203.0.113.50")) === 429, "la 31 se bloquea en los dos: cuentan juntas");
    ok((await lookup(other.base, "203.0.113.51")) === 200, "otro visitante no queda bloqueado");
    for (let i = 0; i < 30; i++) await lookup(BASE, "2001:db8:aa:1::1");
    ok((await lookup(other.base, "2001:db8:aa:1:ffff:ffff:ffff:fffe")) === 429, "IPv6: otra dirección de la misma /64 cuenta como el mismo visitante");
    ok((await lookup(other.base, "2001:db8:aa:2::1")) === 200, "otra /64 no");
    ok(count("select count(*) from rate_limits where key like 'busqueda-cedula:%'") >= 3, "las cuentas están en la tabla rate_limits");
    const { deleteExpiredRateLimits } = await import("../src/http/rate-limit-store.ts");
    sql("update rate_limits set reset_at = now() - interval '1 second' where key = 'busqueda-cedula:203.0.113.50'");
    ok((await deleteExpiredRateLimits()) >= 1 && count("select count(*) from rate_limits where key = 'busqueda-cedula:203.0.113.50'") === 0, "el cron borra las cuentas caducadas");
    ok((await lookup(BASE, "203.0.113.50")) === 200, "y al caducar, el visitante vuelve a empezar");
  }

  console.log("CAPTCHA del registro y sin dejar pasar si Cloudflare falla");
  {
    const cloudflare = await fakeService((body) =>
      body.response === "token-caido"
        ? { status: 500 }
        : body.response === "token-bueno"
          ? { status: 200, json: { success: true, hostname: "localhost" } }
          : body.response === "token-otra-web"
            ? { status: 200, json: { success: true, hostname: "copia.example.org" } }
            : { status: 200, json: { success: false, "error-codes": ["invalid-input-response"] } },
    );
    const captcha = await startApi({ TURNSTILE_SITE_KEY: "clave-del-sitio", TURNSTILE_SECRET_KEY: "clave-secreta", TURNSTILE_VERIFY_URL: `${cloudflare.url}/siteverify` });
    const health = await (await fetch(`${captcha.base}/health`)).json();
    const without = await (await fetch(`${BASE}/health`)).json();
    ok(health.captcha === true && without.captcha === false, "/api/health dice si el CAPTCHA está activo", { health, without });
    let r = await agent(captcha.base)("GET", "/public/captcha");
    ok(r.status === 200 && r.body.siteKey === "clave-del-sitio", "el registro recibe la Site Key", r.body);
    const signup = (captchaToken?: string) =>
      agent(captcha.base)("POST", "/auth/register", {
        firstName: "Ana",
        lastName: "Registro",
        email: `registro-${captchaToken ?? "sin"}@correo.ec`,
        password: "contrasena123",
        confirmPassword: "contrasena123",
        ...(captchaToken ? { captchaToken } : {}),
      });
    r = await signup();
    ok(r.status === 403 && /robot/.test(r.body.error.message), "registro sin CAPTCHA → 403", r.body);
    r = await signup("token-malo");
    ok(r.status === 403, "con un token inválido → 403", r.body);
    r = await signup("token-otra-web");
    ok(r.status === 403, "con un token resuelto en otro dominio → 403", r.body);
    r = await signup("token-caido");
    ok(r.status === 503 && /inténtalo de nuevo/.test(r.body.error.message), "si Cloudflare responde con error, se rechaza", r.body);
    ok(count("select count(*) from users where email like 'registro-%@correo.ec'") === 0, "y no se crea ninguna cuenta", null);
    r = await signup("token-bueno");
    ok(r.status === 201, "con un token válido se registra", r.body);
    cloudflare.server.close();
    const unreachable = await startApi({ TURNSTILE_SITE_KEY: "clave-del-sitio", TURNSTILE_SECRET_KEY: "clave-secreta", TURNSTILE_VERIFY_URL: "http://127.0.0.1:9/siteverify" });
    r = await agent(unreachable.base)("POST", "/public/businesses/jhordan/bookings", { captchaToken: "token-bueno" });
    ok(r.status === 503, "si Cloudflare no responde, la reserva tampoco pasa", r.body);
  }

  console.log("Imágenes de otros: ni se aceptan ni se borran");
  {
    let r = await jhordan.a("POST", "/images", { target: "logo", businessId: jhordan.session.businessId, contentType: "image/png", sizeBytes: PNG.length });
    await put(r.body.upload, PNG);
    const logo: string = r.body.url;
    r = await jhordan.a("PATCH", jhordan.B, { logoUrl: logo });
    ok(r.status === 200 && existsSync(storedFile(logo)), "Jhordan guarda su logo", r.body);
    const disguised = logo.replace(/\.png$/, "%2Epng");
    const lauraUser = (await laura.a("GET", `/users/${laura.session.userId}`)).body;
    const profile = { firstName: lauraUser.firstName, lastName: lauraUser.lastName, email: lauraUser.email, phone: lauraUser.phone };
    r = await laura.a("PUT", `/users/${laura.session.userId}`, { ...profile, avatarUrl: disguised });
    ok(r.status === 400 && /Vuelve a elegirla/.test(r.body.error.message), "Laura no puede poner de foto el logo de Jhordan disfrazado («%2Epng»)", r.body);
    const lauraAgenda: Professional = (await laura.a("GET", `${laura.B}/professionals`)).body[0];
    const { id: _id, businessId: _b, sortOrder: _s, createdAt: _c, ...agendaInput } = lauraAgenda;
    r = await laura.a("PUT", `${laura.B}/professionals/${lauraAgenda.id}`, { ...agendaInput, avatarUrl: logo });
    ok(r.status === 400, "ni de foto de su agenda (no es de la carpeta de su negocio)", r.body);
    // Lo que pudo quedar guardado antes del arreglo: al quitarlo, el archivo de Jhordan no se borra.
    sql(`update users set avatar_url = '${disguised}' where id = '${laura.session.userId}'`);
    r = await laura.a("PUT", `/users/${laura.session.userId}`, { ...profile, avatarUrl: null });
    ok(r.status === 200 && existsSync(storedFile(logo)) && (await fetch(ORIGIN + logo)).ok, "al quitar esa foto, el logo de Jhordan sigue (se compara por archivo)", r.body);
    sql(`update users set avatar_url = '${logo}' where id = '${laura.session.userId}'`);
    await laura.a("PUT", `/users/${laura.session.userId}`, { ...profile, avatarUrl: null });
    ok(existsSync(storedFile(logo)), "tampoco con la dirección exacta: sólo se borra lo que ya nadie usa");

    console.log("Subidas sin usar y cuota diaria");
    const already = count(`select count(*) from image_uploads where user_id = '${laura.session.userId}'`);
    const uploads = [];
    for (let i = already; i < 20; i++) {
      uploads.push((await laura.a("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: PNG.length })).body);
    }
    ok(uploads.length > 0 && uploads.every((u) => typeof u.url === "string"), "hasta 20 subidas al día", uploads.length);
    r = await laura.a("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: PNG.length });
    ok(r.status === 429 && /muchas imágenes/.test(r.body.error.message), "la 21 no", r.body);
    const unused = uploads[0];
    await put(unused.upload, PNG);
    ok(existsSync(storedFile(unused.url)), "una foto subida y nunca guardada…", unused.url);
    sql(`update image_uploads set created_at = now() - interval '25 hours'`);
    const { deleteUnusedImageUploads } = await import("../src/services/image-service.ts");
    const deleted = await deleteUnusedImageUploads();
    ok(deleted !== null && deleted >= 1 && !existsSync(storedFile(unused.url)), "…el cron la borra a las 24 h", deleted);
    ok(existsSync(storedFile(logo)) && (await fetch(ORIGIN + logo)).ok, "y deja el logo que sí se usa", logo);
    ok(count("select count(*) from image_uploads") === 0, "las subidas viejas se olvidan (y la cuota vuelve a empezar)");
    r = await laura.a("POST", "/images", { target: "avatar", contentType: "image/png", sizeBytes: PNG.length });
    ok(r.status === 200, "Laura puede volver a subir", r.body);
  }

  console.log("AWS Lambda: la Function URL sólo atiende al proxy del frontend");
  {
    const lambda = await startApi({ AWS_LAMBDA_FUNCTION_NAME: "agenda-pruebas" });
    const raw = (path: string, headers: Record<string, string> = {}) =>
      fetch(`${lambda.base}${path}`, { headers: { "X-Requested-With": "fetch", ...headers } }).then((res) => res.status);
    ok((await raw("/health")) === 200, "/api/health responde sin el secreto (comprobación tras publicar)");
    ok((await raw("/public/categories")) === 403, "lo demás sin el secreto → 403");
    ok((await raw("/public/categories", { "x-agendo-proxy-secret": "un-secreto-falso-de-mas-de-24-caracteres" })) === 403, "con otro secreto → 403");
    ok((await raw("/public/categories", { "x-agendo-proxy-secret": PROXY_SECRET })) === 200, "con el secreto del proxy, sí");
    const login = await fetch(`${lambda.base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ email: "jhordan@demo.com", password: "demo1234", remember: true }),
    });
    ok(login.status === 403, "ni el inicio de sesión directo", login.status);
    const open = await startApi({ AWS_LAMBDA_FUNCTION_NAME: "agenda-pruebas", PROXY_SECRET: "" });
    ok((await fetch(`${open.base}/public/categories`)).status === 200, "sin PROXY_SECRET no rechaza…");
    ok(/Lambda sin PROXY_SECRET/.test(open.output()), "…pero avisa en el registro", open.output().slice(0, 400));
    const local = await fetch(`${BASE}/public/categories`);
    ok(local.status === 200, "fuera de Lambda no se aplica", local.status);
  }
} finally {
  for (const child of servers) child.kill("SIGTERM");
  const { pool } = await import("../src/db/pool.ts");
  await pool.end();
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de abusos de la página pública pasaron");
process.exitCode = failures ? 1 : 0;
