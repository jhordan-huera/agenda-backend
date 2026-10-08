// Auditoría: sesiones (sólo super admin, con IP y navegador), qué cambió en cada edición,
// filtros y "Cargar más", registros no editables y limpieza por antigüedad.
import { execFileSync } from "node:child_process";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** Como si llegara por el proxy del frontend desde esa IP. */
const viaProxy = (ip) => ({ "x-agendo-proxy-secret": process.env.PROXY_SECRET, "x-agendo-client-ip": ip, "User-Agent": CHROME });
function agent(extraHeaders = {}) {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...extraHeaders, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const login = async (email, password = "demo1234", headers = {}) => {
  const a = agent(headers);
  const r = await a("POST", "/auth/login", { email, password, remember: true });
  return { a, r };
};
const sql = (query) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sqlError = (query) => {
  try {
    sql(query);
    return null;
  } catch (error) {
    return String(error.stderr || error.message);
  }
};

console.log("Sesiones");
const { a: owner, r: ownerLogin } = await login("jhordan@demo.com", "demo1234", viaProxy("203.0.113.50"));
const B = `/businesses/${ownerLogin.body.businessId}`;
await login("jhordan@demo.com", "contraseña-mala", viaProxy("203.0.113.51"));
await login("nadie@ejemplo.com", "x12345678", viaProxy("203.0.113.52"));
const { a: admin } = await login("admin@demo.com");
const pedroId = sql("select id from users where email = 'pedro@demo.com'");
await admin("PATCH", `/admin/users/${pedroId}/active`, { isActive: false });
await login("pedro@demo.com", "demo1234", viaProxy("203.0.113.53"));
await owner("POST", "/auth/logout");

let r = await admin("GET", "/admin/audit-logs?scope=security&limit=100");
const security = r.body.entries;
const find = (action, predicate = () => true) => security.find((l) => l.action === action && predicate(l));
const okLogin = find("session.login", (l) => l.ip === "203.0.113.50");
ok(okLogin && okLogin.actorName === "Jhordan Huera" && /Chrome/.test(okLogin.userAgent) && okLogin.businessId, "inicio de sesión con IP, navegador y negocio", okLogin);
ok(find("session.login_failed", (l) => l.ip === "203.0.113.51" && /contraseña incorrecta/.test(l.summary) && l.actorName === "Jhordan Huera"), "contraseña incorrecta", security.slice(0, 4));
ok(find("session.login_failed", (l) => l.actorName === "nadie@ejemplo.com" && /no registrado/.test(l.summary) && l.actorId === null), "email que no existe");
ok(find("session.login_blocked", (l) => l.ip === "203.0.113.53"), "cuenta desactivada");
ok(find("session.logout", (l) => l.ip === "203.0.113.50" && l.summary === "Cerró sesión"), "cierre de sesión");
ok(find("session.login", (l) => /\(Super admin\)/.test(l.actorName) && l.businessId === null), "el super admin también queda registrado (sin negocio)");
ok(security.every((l) => l.entityType === "session"), "la pestaña de seguridad sólo trae sesiones");
ok(!JSON.stringify(security).includes("contraseña-mala"), "nunca se guarda la contraseña escrita");

const { a: owner2 } = await login("jhordan@demo.com");
r = await owner2("GET", `${B}/audit-logs?limit=1000`);
ok(r.status === 200 && r.body.entries.length > 0 && r.body.entries.every((l) => l.entityType !== "session"), "el negocio no ve los eventos de sesión", r.body.entries?.[0]);
ok(r.body.entries.every((l) => !("ip" in l) && !("userAgent" in l)), "ni la IP ni el navegador");
r = await owner2("GET", `${B}/audit-logs?entityType=session`);
ok(r.status === 200 && r.body.entries.length === 0, "aunque filtre por sesiones", r.body);

console.log("Qué cambió");
const service = (await owner2("GET", `${B}/services`)).body[0];
await owner2("PUT", `${B}/services/${service.id}`, { ...service, price: service.price + 5, description: "Otra descripción" });
r = await owner2("GET", `${B}/audit-logs?entityType=service&entityId=${service.id}`);
const serviceLog = r.body.entries[0];
const price = serviceLog?.changes?.find((c) => c.label === "Precio");
ok(price && price.before !== price.after && /\$/.test(price.after), "servicio: precio antes y después", serviceLog?.changes);
ok(serviceLog?.changes?.some((c) => c.label === "Descripción" && c.before === null && c.after === null), "los textos largos sólo dicen que cambiaron");
ok(serviceLog.changes.length === 2, "sólo lo que cambió", serviceLog.changes);

const client = (await owner2("GET", `${B}/clients`)).body.find((c) => c.documentId && c.email);
await owner2("PUT", `${B}/clients/${client.id}`, { ...client, phone: "0991112233", notes: "Dato privado del cliente" });
r = await owner2("GET", `${B}/audit-logs?entityType=client&entityId=${client.id}`);
const clientChanges = r.body.entries[0]?.changes ?? [];
ok(clientChanges.some((c) => c.label === "Teléfono" && c.after === "0991112233"), "cliente: teléfono nuevo", clientChanges);
ok(!JSON.stringify(r.body).includes("Dato privado"), "las notas no se copian a la auditoría");

const appointment = (await owner2("GET", `${B}/appointments?from=2000-01-01&to=2100-01-01`)).body.find((a) => a.status === "pending");
await owner2("PATCH", `${B}/appointments/${appointment.id}/status`, { status: "confirmed" });
r = await owner2("GET", `${B}/audit-logs?entityType=appointment&entityId=${appointment.id}`);
ok(r.body.entries[0]?.changes?.some((c) => c.label === "Estado" && c.before === "Pendiente" && c.after === "Confirmada"), "cita: estado", r.body.entries[0]);

const week = (await owner2("GET", `${B}/schedules`)).body.map(({ dayOfWeek, isActive, intervals }) => ({ dayOfWeek, isActive, intervals }));
const sunday = week.find((d) => d.dayOfWeek === 0);
sunday.isActive = true;
sunday.intervals = [{ start: "09:00", end: "12:00" }];
await owner2("PUT", `${B}/schedules`, week);
r = await owner2("GET", `${B}/audit-logs?entityType=schedule`);
ok(r.body.entries[0]?.changes?.some((c) => c.label === "Domingo" && c.before === "Cerrado" && c.after === "09:00–12:00"), "horario: el día que cambió", r.body.entries[0]?.changes);

await owner2("PATCH", B, { phone: "+593 98 765 4321" });
r = await owner2("GET", `${B}/audit-logs?entityType=business`);
ok(r.body.entries[0]?.changes?.some((c) => c.label === "Teléfono" && c.after === "+593 98 765 4321"), "negocio: teléfono", r.body.entries[0]?.changes);

console.log("Filtros y Cargar más");
const total = Number(sql(`select count(*) from audit_logs where business_id = '${ownerLogin.body.businessId}' and entity_type <> 'session'`));
const seen = [];
let cursor = null;
let pages = 0;
do {
  r = await owner2("GET", `${B}/audit-logs?limit=40${cursor ? `&cursor=${cursor}` : ""}`);
  seen.push(...r.body.entries);
  cursor = r.body.nextCursor;
  pages++;
} while (cursor && pages < 100);
ok(seen.length === total && new Set(seen.map((l) => l.id)).size === total, "Cargar más recorre todo sin repetir ni saltarse nada", [seen.length, total]);
ok(seen.every((l, i) => i === 0 || l.createdAt <= seen[i - 1].createdAt), "de la más reciente a la más antigua");

// Varias entradas con la misma hora exacta (p. ej. de una misma transacción) no se pierden al paginar.
const ownerId = sql("select id from users where email = 'jhordan@demo.com'");
sql(`insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, summary, created_at)
     select '${ownerLogin.body.businessId}', '${ownerId}', 'Jhordan Huera', 'client.updated', 'client', 'Misma hora ' || n, '2001-01-01T10:00:00.123456Z'
       from generate_series(1, 5) n`);
const sameTime = [];
cursor = null;
do {
  r = await owner2("GET", `${B}/audit-logs?q=Misma%20hora&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
  sameTime.push(...r.body.entries);
  cursor = r.body.nextCursor;
} while (cursor);
ok(sameTime.length === 5, "misma hora exacta: las 5 entradas", sameTime.map((l) => l.summary));

r = await owner2("GET", `${B}/audit-logs?actorId=online&limit=1000`);
ok(r.body.entries.length > 0 && r.body.entries.every((l) => l.actorId === null && l.actorName === "Reserva online"), "filtro: reservas online");
r = await owner2("GET", `${B}/audit-logs?actorId=${ownerId}&limit=1000`);
ok(r.body.entries.length > 0 && r.body.entries.every((l) => l.actorId === ownerId), "filtro: una persona");
r = await owner2("GET", `${B}/audit-logs?q=${encodeURIComponent(client.name.split(" ")[0])}`);
ok(r.body.entries.length > 0 && r.body.entries.every((l) => (l.summary + l.actorName).toLowerCase().includes(client.name.split(" ")[0].toLowerCase())), "buscador");
r = await owner2("GET", `${B}/audit-logs?from=2001-01-01T00:00:00Z&to=2001-01-02T00:00:00Z`);
ok(r.body.entries.length === 5, "rango de fechas", r.body.entries.length);
r = await owner2("GET", `${B}/audit-logs?q=${encodeURIComponent("100%_")}`);
ok(r.status === 200 && r.body.entries.length === 0, "el buscador no interpreta % ni _");
r = await owner2("GET", `${B}/audit-logs?from=ayer`);
ok(r.status === 400, "fecha inválida → 400", r.body);
r = await admin("GET", `/admin/audit-logs?businessId=${ownerLogin.body.businessId}&entityType=service`);
ok(r.body.entries.length > 0 && r.body.entries.every((l) => l.businessId === ownerLogin.body.businessId && l.entityType === "service" && l.businessName), "super admin: filtro por negocio y tipo");

console.log("No editable y limpieza");
const logId = serviceLog.id;
ok(/no se puede modificar ni borrar/.test(sqlError(`update audit_logs set summary = 'cambiado' where id = '${logId}'`) ?? ""), "no se puede editar");
ok(/no se puede modificar ni borrar/.test(sqlError(`delete from audit_logs where id = '${logId}'`) ?? ""), "ni borrar");
ok(sqlError(`update audit_logs set actor_id = null where id = '${logId}'`) === null, "el autor sí puede quedar en null (cuenta eliminada)");
const old = (entityType, days, summary) =>
  sql(`insert into audit_logs (actor_name, action, entity_type, summary, created_at)
       values ('Prueba', '${entityType}.test', '${entityType}', '${summary}', now() - interval '${days} days')`);
old("session", 100, "sesión vieja");
old("session", 10, "sesión reciente");
old("client", 160, "acción vieja");
old("client", 140, "acción reciente");
old("clinical_record", 730, "acceso clínico de hace 2 años");
const purged = Number(sql("select purge_audit_logs()"));
const left = sql("select string_agg(summary, ', ' order by summary) from audit_logs where actor_name = 'Prueba'");
ok(purged >= 2 && left === "acceso clínico de hace 2 años, acción reciente, sesión reciente", "limpieza: sesiones 90 días, acciones 5 meses, historia clínica 5 años", [purged, left]);
ok(/no se puede modificar ni borrar/.test(sqlError("delete from audit_logs where actor_name = 'Prueba'") ?? ""), "tras limpiar, vuelve a estar protegida");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de la auditoría pasaron");
process.exitCode = failures ? 1 : 0;
