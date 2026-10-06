// Rendimiento: el panel ya no descarga el historial completo, caché de la página de reservas y
// limpieza del contenido de los emails viejos.
import { execFileSync, spawn } from "node:child_process";
import { getZonedNow } from "../src/shared/lib/time.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
function agent() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };
}
const login = async (email) => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password: "demo1234", remember: true });
  return { a, session: r.body };
};
const sql = (query) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const { a: owner, session } = await login("jhordan@demo.com");
const B = `/businesses/${session.businessId}`;
const business = (await owner("GET", B)).body;
const all = (await owner("GET", `${B}/appointments`)).body;

console.log("Una cita por su id");
let r = await owner("GET", `${B}/appointments/${all[0].id}`);
ok(r.status === 200 && r.body.id === all[0].id && r.body.startTime === all[0].startTime, "devuelve la cita", r.body);
const { a: laura, session: lauraSession } = await login("laura@demo.com");
r = await laura("GET", `/businesses/${lauraSession.businessId}/appointments/${all[0].id}`);
ok(r.status === 200 && r.body === null, "la de otro negocio no (null)", r.body);
r = await owner("GET", `${B}/appointments/no-es-un-id`);
ok(r.status === 200 && r.body === null, "un id inválido → null", r.body);

console.log("Resumen de citas por cliente (calculado en la base)");
r = await owner("GET", `${B}/clients/activity`);
ok(r.status === 200 && Array.isArray(r.body) && r.body.length > 0, "responde con un resumen por cliente", r.status);
// Lo mismo que calculaba antes el panel con todas las citas (features/clients/client-summary.ts).
const now = getZonedNow(business.timezone);
const isPast = (a) => (a.date !== now.date ? a.date < now.date : Number(a.startTime.slice(0, 2)) * 60 + Number(a.startTime.slice(3)) <= now.minutes);
const expected = new Map();
for (const a of [...all].sort((x, y) => x.date.localeCompare(y.date) || x.startTime.localeCompare(y.startTime))) {
  const s = expected.get(a.clientId) ?? { total: 0, completed: 0, cancelled: 0, noShow: 0, spent: 0, first: null, last: null, next: null };
  if (a.status !== "cancelled") {
    s.total++;
    s.first ??= a.date;
  }
  if (a.status === "completed") {
    s.completed++;
    s.spent += a.price;
  }
  if (a.status === "cancelled") s.cancelled++;
  if (a.status === "no_show") s.noShow++;
  if (isPast(a)) {
    if (a.status !== "cancelled") s.last = a.id;
  } else if (!s.next && ["pending", "confirmed", "completed"].includes(a.status)) s.next = a.id;
  expected.set(a.clientId, s);
}
const mismatches = r.body.filter((row) => {
  const s = expected.get(row.clientId);
  return (
    !s ||
    s.total !== row.totalAppointments ||
    s.completed !== row.completed ||
    s.cancelled !== row.cancelled ||
    s.noShow !== row.noShow ||
    Math.abs(s.spent - row.totalSpent) > 0.001 ||
    s.first !== row.firstVisit ||
    s.last !== (row.lastAppointment?.id ?? null) ||
    s.next !== (row.nextAppointment?.id ?? null)
  );
});
ok(mismatches.length === 0 && r.body.length === expected.size, "coincide con lo que calculaba el panel con todo el historial", mismatches.slice(0, 2));
r = await laura("GET", `${B}/clients/activity`);
ok(r.status === 403, "otro negocio no lo ve", r.status);

console.log("Citas por rango");
const from = now.date;
r = await owner("GET", `${B}/appointments?from=${from}`);
ok(r.body.length > 0 && r.body.length < all.length && r.body.every((a) => a.date >= from), "con `from` sólo llegan las de ese día en adelante", [r.body.length, all.length]);

console.log("Caché de la página de reservas");
const visitor = agent();
r = await visitor("GET", `/public/businesses/${business.slug}`);
ok(r.status === 200 && /s-maxage=30/.test(r.headers.get("cache-control") ?? ""), "el perfil público se puede guardar 30 s en la CDN", r.headers.get("cache-control"));
r = await visitor("GET", "/public/businesses/no-existe-este-negocio");
ok(!/s-maxage/.test(r.headers.get("cache-control") ?? ""), "un enlace que no existe no se guarda", r.headers.get("cache-control"));
r = await owner("GET", `${B}/appointments`);
ok(!/public|s-maxage/.test(r.headers.get("cache-control") ?? ""), "los datos del panel nunca son públicos", r.headers.get("cache-control"));

console.log("Contenido de los emails viejos");
const insert = (label, days, status) =>
  sql(`insert into notifications (business_id, type, to_email, subject, body, html, status, created_at, sent_at)
       values ('${session.businessId}', 'appointment_confirmed', 'prueba-${label}@example.com', 'Asunto ${label}', 'Cuerpo ${label}', '<p>${label}</p>',
               '${status}', now() - interval '${days} days', ${status === "sent" ? `now() - interval '${days} days'` : "null"})
       returning id`);
const oldSent = insert("vieja", 100, "sent");
const oldQueued = insert("encola", 100, "queued");
const recent = insert("reciente", 10, "sent");
const run = await new Promise((resolve) => {
  let output = "";
  const child = spawn(process.execPath, ["scripts/cron.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      DATABASE_SSL: "false",
      FRONTEND_URL: "https://agendo.example",
      LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
      NTFY_TOPIC: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("exit", (code) => resolve({ code, output }));
});
const row = (id) => sql(`select subject || '|' || body || '|' || coalesce(html, 'NULL') || '|' || to_email from notifications where id = '${id}'`);
ok(run.code === 0 && /emails sin contenido \(más de 90 días\): [1-9]/.test(run.output), "el cron lo cuenta en su registro", run.output.slice(-300));
ok(row(oldSent) === "Asunto vieja||NULL|prueba-vieja@example.com", "a los 90 días se borra el contenido y queda el registro", row(oldSent));
ok(row(oldQueued).includes("Cuerpo encola"), "uno que sigue en cola no se toca", row(oldQueued));
ok(row(recent).includes("Cuerpo reciente"), "uno reciente no se toca", row(recent));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de rendimiento pasaron");
process.exitCode = failures ? 1 : 0;
