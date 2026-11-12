// Avisos de errores a Sentry (spec 044): la API avisa de los errores inesperados (500) y de la base sin
// responder (503) al Sentry de prueba que arranca scripts/test.ts, con la ruta tal como está en el código, el
// negocio, el tipo de usuario y la versión; nunca con datos de pacientes, la consulta, el cuerpo, las cookies ni
// la IP. Los errores previstos no se avisan, el mismo error se avisa una vez por minuto y un Sentry colgado no
// demora la respuesta.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cedulaFor } from "./helpers/cedula.mjs";
import { viaProxy } from "./helpers/proxy.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const SENTRY = process.env.TEST_SENTRY_URL!;
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 600));
  }
};
let ipCounter = 10;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const started = performance.now();
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...viaProxy(`198.51.100.${ipCounter++ % 250}`),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, ms: performance.now() - started, cookie };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Received {
  auth: string;
  raw: string;
  header: { event_id: string; dsn: string };
  item: { type: string };
  event: {
    event_id: string;
    platform: string;
    release?: string;
    transaction: string;
    request?: unknown;
    user?: unknown;
    exception: { values: { type: string; value: string; stacktrace?: { frames: { filename: string; in_app: boolean }[] } }[] };
    tags: Record<string, string>;
  };
}
async function received(): Promise<Received[]> {
  const list = (await (await fetch(`${SENTRY}/recibidos`)).json()) as { auth: string; body: string }[];
  return list.map(({ auth, body }) => {
    const [header, item, event] = body.trim().split("\n");
    return { auth, raw: body, header: JSON.parse(header), item: JSON.parse(item), event: JSON.parse(event) };
  });
}
const clearInbox = () => fetch(`${SENTRY}/recibidos`, { method: "DELETE" });
/** Espera hasta tener `count` avisos (o el tiempo) y deja pasar un momento más por si llega otro. */
async function waitFor(count: number, ms = 3_000): Promise<Received[]> {
  const until = Date.now() + ms;
  while (Date.now() < until && (await received()).length < count) await sleep(50);
  await sleep(300);
  return received();
}
const setSentryMode = (mode: "colgado" | "normal") => fetch(`${SENTRY}/modo`, { method: "POST", body: mode });

// Datos ficticios de un paciente: no deben aparecer en ningún aviso.
const FAKE = {
  name: "Wilfrido Quiñónez Fantasma",
  email: "wilfrido.fantasma@correo-prueba.ec",
  phone: "0991234567",
  documentId: cedulaFor(4404),
};
const leaks = (raw: string) =>
  [FAKE.name, "Wilfrido", "Fantasma", FAKE.email, "correo-prueba", FAKE.phone, FAKE.documentId, "q=", "198.51.100", "203.0.113", "demo1234"].filter((text) =>
    raw.includes(text),
  );

await clearInbox();
const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario de Clínica Dental Sonrisa
const { a: jhordan } = await login("jhordan@demo.com"); // otro negocio
const B = `/businesses/${rs.businessId}`;

console.log("\nSin errores no se avisa nada");
let r = await ricardo("GET", `${B}/clients`);
ok(r.status === 200, "la lista de pacientes responde", r.status);
ok((await waitFor(1, 500)).length === 0, "ningún aviso");

console.log("\nLos errores previstos no se avisan");
r = await ricardo("POST", `${B}/clients`, {});
ok(r.status === 400, "datos no válidos → 400", r.status);
r = await agent()("GET", `${B}/clients`);
ok(r.status === 401, "sin sesión → 401", r.status);
r = await jhordan("GET", `${B}/clients`);
ok(r.status === 403 || r.status === 404, "el negocio de otro → 403 o 404", r.status);
r = await ricardo("GET", "/ruta-que-no-existe");
ok(r.status === 404, "ruta inexistente → 404", r.status);
const existing = sql(`select document_id from clients where business_id = '${rs.businessId}' and document_id <> '' limit 1`);
r = await ricardo("POST", `${B}/clients`, { name: "Repetido Prueba", documentId: existing, email: "repetido@prueba.ec", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 409, "cédula repetida → 409", r.body);
let lockout = 0;
// Una contraseña equivocada al azar (sin texto fijo que parezca una clave).
const wrongPassword = randomUUID();
for (let i = 0; i < 15 && lockout !== 429; i++) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...viaProxy("203.0.113.9") },
    body: JSON.stringify({ email: "nadie-044@demo.com", password: wrongPassword, remember: false }),
  });
  lockout = res.status;
}
ok(lockout === 429, "demasiados intentos → 429", lockout);
ok((await waitFor(1, 500)).length === 0, "ninguno llega a Sentry", (await received()).map((e) => e.event.transaction));

console.log("\nUn error inesperado (500) con datos de un paciente en la consulta y en el cuerpo");
sql("alter table clients rename to clients_oculta_044");
let baseline = 0;
try {
  r = await ricardo("GET", `${B}/clients?q=${encodeURIComponent(FAKE.name)}&email=${encodeURIComponent(FAKE.email)}`);
  baseline = r.ms;
  ok(r.status === 500 && r.body?.error?.message === "Ocurrió un error inesperado. Inténtalo de nuevo.", "la persona recibe el 500 de siempre", r);
  r = await ricardo("POST", `${B}/clients`, { ...FAKE, address: "", notes: `Notas de ${FAKE.name}`, isActive: true });
  ok(r.status === 500, "crear el paciente → 500", r.body);
  for (let i = 0; i < 4; i++) await ricardo("GET", `${B}/clients?q=${FAKE.phone}`);
} finally {
  sql("alter table clients_oculta_044 rename to clients");
}
let events = await waitFor(2);
ok(events.length === 2, "llegan dos avisos: uno por ruta, aunque la lista falló cinco veces (una vez por minuto)", events.map((e) => e.event.transaction));
const list = events.find((e) => e.event.transaction === "GET /api/businesses/:businessId/clients");
const create = events.find((e) => e.event.transaction === "POST /api/businesses/:businessId/clients");
ok(list && create, "con la ruta tal como está en el código", events.map((e) => e.event.transaction));
if (list) {
  const { event } = list;
  ok(event.tags.ruta === "GET /api/businesses/:businessId/clients" && event.tags.estado === "500", "etiquetas de ruta y estado", event.tags);
  ok(event.tags.negocio === rs.businessId, "el negocio por su identificador interno", event.tags);
  ok(event.tags.usuario === "equipo", "el tipo de usuario: equipo", event.tags);
  ok(event.release === "commit-de-prueba", "la versión publicada", event.release);
  const main = event.exception.values.at(-1)!;
  ok(main.type === "DatabaseError" && main.value === "PostgreSQL 42P01", "el error de la base, sólo con su código", main);
  ok(main.stacktrace?.frames.some((frame) => frame.in_app && frame.filename.startsWith("src/")), "la pila con rutas del repositorio", main.stacktrace?.frames.slice(-3));
  ok(event.request === undefined && event.user === undefined, "sin la petición ni el usuario", { request: event.request, user: event.user });
  ok(list.auth.includes("sentry_key=prueba") && list.header.dsn.startsWith("http://prueba@127.0.0.1"), "con la clave del DSN", list.auth);
  ok(list.item.type === "event" && list.header.event_id === event.event_id, "un sobre de Sentry bien armado", list.header);
}
for (const e of events) ok(leaks(e.raw).length === 0, `«${e.event.transaction}» no lleva datos del paciente, la consulta, la IP ni la contraseña`, leaks(e.raw));
ok(events.every((e) => !/cookie|set-cookie|x-agendo|session/i.test(e.raw)), "ni cookies ni cabeceras");

console.log("\nCon Sentry colgado, la respuesta no lo espera");
await clearInbox();
const someClient = sql(`select id from clients where business_id = '${rs.businessId}' limit 1`);
await setSentryMode("colgado");
sql("alter table clients rename to clients_oculta_044");
try {
  r = await ricardo("GET", `${B}/clients/${someClient}`);
} finally {
  sql("alter table clients_oculta_044 rename to clients");
  await setSentryMode("normal");
}
ok(r.status === 500, "la ficha de un paciente también → 500", r.status);
ok(r.ms < Math.max(baseline, 50) + 500, `responde igual de rápido (${Math.round(r.ms)} ms; antes ${Math.round(baseline)} ms)`);
ok((await waitFor(1)).length === 1, "el aviso salió igual");

// Lo que no se puede provocar con la API de pruebas: el manejador de errores y el envío, en este mismo proceso
// (con el mismo Sentry de prueba).
console.log("\nEl manejador de errores, directamente");
await clearInbox();
const { errorHandler, AppError } = await import("../src/http/errors.ts");
const { flushErrorReports } = await import("../src/services/error-reports.ts");
type FakeRes = { code: number; body: unknown; status(code: number): FakeRes; json(body: unknown): FakeRes };
function handle(error: unknown, req: Record<string, unknown>): FakeRes {
  const res: FakeRes = {
    code: 0,
    body: undefined,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  (errorHandler as unknown as (e: unknown, q: unknown, s: unknown, n: () => void) => void)(error, req, res, () => undefined);
  return res;
}
const panelReq = (path: string, routePath: string, platformRole: string | null = null) => ({
  method: "GET",
  originalUrl: `/api/businesses/${rs.businessId}${path}`,
  route: { path: routePath },
  ctx: { user: { id: "u", platformRole }, sessionId: "s" },
});
const quiet = console.error;
console.error = () => undefined; // los «Error inesperado» de abajo son a propósito
const down = handle(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }), panelReq("/agenda", "/:businessId/agenda"));
const check = handle(
  Object.assign(new Error('new row for relation "clients" violates check constraint "clients_email_check"'), {
    severity: "ERROR",
    code: "23514",
    table: "clients",
    constraint: "clients_email_check",
    detail: `Failing row contains (${FAKE.email}, ${FAKE.name}, ${FAKE.documentId})`,
  }),
  panelReq("/clients/x", "/:businessId/clients/:clientId"),
);
const plain = handle(new Error(`No se pudo avisar a ${FAKE.email} al ${FAKE.phone} (cédula ${FAKE.documentId})`), panelReq("/settings", "/:businessId/settings", "super_admin"));
const publicPage = handle(new TypeError("x is undefined"), {
  method: "POST",
  originalUrl: "/api/public/businesses/psicovalle/bookings?cedula=1",
  route: { path: "/businesses/:slug/bookings" },
  ctx: { user: null, sessionId: null },
});
const expected = handle(new AppError("conflict", "Ya existe."), panelReq("/clients", "/:businessId/clients"));
console.error = quiet;
await flushErrorReports();
events = await waitFor(4);
const byRoute = (route: string) => events.find((e) => e.event.transaction === route)?.event;
ok(down.code === 503, "la base sin responder → 503", down.code);
ok(byRoute(`GET /api/businesses/:businessId/agenda`)?.tags.estado === "503", "y se avisa con su estado", events.map((e) => e.event.tags));
const checkEvent = byRoute("GET /api/businesses/:businessId/clients/:clientId");
ok(
  checkEvent?.exception.values.at(-1)?.value === "PostgreSQL 23514 · restricción clients_email_check · tabla clients",
  "un error de la base con valores: sólo el código, la restricción y la tabla",
  checkEvent?.exception.values,
);
const plainEvent = byRoute("GET /api/businesses/:businessId/settings");
ok(/\[email\].*\[número\].*\[número\]/.test(plainEvent?.exception.values.at(-1)?.value ?? ""), "el mensaje con email, teléfono y cédula tapados", plainEvent?.exception.values);
ok(plainEvent?.tags.usuario === "super admin", "el super admin", plainEvent?.tags);
const publicEvent = byRoute("POST /api/public/businesses/:slug/bookings");
ok(publicEvent?.tags.usuario === "paciente" && publicEvent.tags.negocio === undefined, "la página de reservas: paciente, sin el nombre del negocio", publicEvent?.tags);
ok(expected.code === 409 && events.length === 4, "un AppError no se avisa", events.length);
for (const e of events) ok(leaks(e.raw).length === 0 && !e.raw.includes("psicovalle"), `«${e.event.transaction}» sin datos del paciente ni el nombre del negocio`, leaks(e.raw));

console.log("\nSólo con un DSN, y en local sólo a un Sentry de este equipo");
const sentryOf = (dsn: string) => {
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", "const { config } = await import('./src/config.ts'); console.log(JSON.stringify(config.sentry));"], {
    env: { ...process.env, SENTRY_DSN: dsn },
    encoding: "utf8",
  });
  return { value: out.stdout.trim().split("\n").at(-1), warning: out.stderr };
};
ok(sentryOf("").value === "null", "sin SENTRY_DSN, apagado");
ok(sentryOf("https://clave@o1.ingest.us.sentry.io/123").value === "null", "un DSN real en un equipo propio no envía nada");
const bad = sentryOf("no-es-un-dsn");
ok(bad.value === "null" && /SENTRY_DSN no es un DSN válido/.test(bad.warning) && !bad.warning.includes("no-es-un-dsn"), "mal escrito: avisa sin mostrar el valor", bad);
const local = JSON.parse(sentryOf("http://clave@127.0.0.1:9/7").value ?? "null");
ok(local?.endpoint === "http://127.0.0.1:9/api/7/envelope/" && local.publicKey === "clave", "el de prueba: el sobre en /api/<proyecto>/envelope/", local);

if (failures) {
  console.log(`\n${failures} comprobación(es) fallida(s)`);
  process.exit(1);
}
console.log("\nTodo bien");
process.exit(0);
