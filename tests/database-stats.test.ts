// La pantalla «Base de datos» del super admin principal (spec 024): quién la ve (el principal sí; otro super
// admin, un propietario y sin sesión, no), la verificación en dos pasos, el límite de 20 cada 15 minutos y
// no-store; las secciones, también sin pg_stat_statements ni el esquema storage de Supabase (y con uno
// falso), y con una consulta que pasa el tope de 5 segundos; la privacidad (ningún email ni nombre de los
// datos demo en toda la respuesta, ni textos entre comillas en las consultas); la foto diaria del cron y la
// proyección, calculada a mano.
//
// Con un PostgreSQL que carga pg_stat_statements (TEST_DATABASE_URL a uno con
// `-c shared_preload_libraries=pg_stat_statements`) también se prueba «Qué la hace trabajar» con datos; sin
// él (el de `npm test`), que la extensión instalada pero sin cargar da null.
import { spawn } from "node:child_process";
import { agent, checks, count, fakeNtfy, login, runCron, sleep, sql, startApi } from "./helpers/harness.ts";
import type { DatabaseFiles, DatabaseHistoryPoint, DatabaseMaintenance, DatabaseStats, DatabaseTables, DatabaseWork } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const service = await import("../src/services/database-stats-service.ts");
const { pool } = await import("../src/db/pool.ts");
const { addDaysISO, getZonedNow } = await import("../src/shared/lib/time.ts");
const { cleanQueryText, describeQuery, projectGrowth, saveDailyDatabaseStats, TABLE_INFO, UNREADABLE } = service;

const MB = 1024 * 1024;
const PATH = "/admin/database";
const T = getZonedNow("America/Guayaquil").date;
const day = (offset: number) => addDaysISO(T, offset);
const atEcuador = (time: string) => new Date(`${T}T${time}:00-05:00`);

// Lo que pudiera quedar de una pasada anterior contra la misma base (TEST_DATABASE_URL).
sql("drop schema if exists storage cascade");

// Cada uno con su IP: así el límite de la ruta (20 cada 15 minutos por conexión) sólo se prueba donde toca.
const owner = await login("admin@demo.com", { ip: "10.24.0.1" });
const ricardo = await login("ricardo@demo.com", { ip: "10.24.0.2" });

const stats = async (browser = owner) => {
  const r = await browser("GET", PATH);
  return { ...r, stats: r.body as DatabaseStats };
};
const failed = (section: unknown): section is { error: string } => typeof section === "object" && section !== null && "error" in section;

/* ---------------------------------------------------------- Quién la ve ---- */

console.log("Quién la ve");
const auditBefore = count("select count(*) from audit_logs");
let r = await stats();
ok(r.status === 200, "el super admin principal la ve", r.body);
ok(r.headers.get("cache-control") === "no-store", "la respuesta no se guarda en ninguna caché (no-store)", r.headers.get("cache-control"));
const keys = ["computedAt", "size", "files", "tables", "work", "maintenance", "history", "projection"];
ok(keys.every((key) => key in r.stats), "con todas las secciones", Object.keys(r.stats));
ok(count("select count(*) from audit_logs") === auditBefore, "verla no va a la actividad (es una consulta)");

const size = r.stats.size as { sizeBytes: number; limitBytes: number };
const realSize = Number(sql("select pg_database_size(current_database())"));
ok(!failed(size) && Math.abs(size.sizeBytes - realSize) < 2 * MB && size.limitBytes === 500 * MB, "el tamaño total frente al tope del plan (500 MB)", size);

const tables = r.stats.tables as DatabaseTables;
const emails = tables.app.find((table) => table.name === "notifications");
ok(
  emails?.label === "Emails (cola e historial)" && emails.retention === "El contenido a los 30 días; queda el registro",
  "cada tabla en palabras y con su regla de borrado («Emails (cola e historial)»)",
  emails,
);
const audit = tables.app.find((table) => table.name === "audit_logs");
const cron = tables.app.find((table) => table.name === "cron_runs");
ok(audit?.label === "Actividad" && /^5 meses/.test(audit.retention ?? "") && cron?.label === "Registro del cron" && cron.retention === "30 días", "«Actividad», 5 meses; «Registro del cron», 30 días", [audit, cron]);
const publicTables = sql("select tablename from pg_tables where schemaname = 'public' order by 1").split("\n");
const missing = publicTables.filter((name) => !TABLE_INFO[name]);
ok(missing.length === 0 && publicTables.length > 30, `las ${publicTables.length} tablas de Agenda360 están en TABLE_INFO (una nueva sin su regla hace fallar esta prueba)`, missing);
const appointments = tables.app.find((table) => table.name === "appointments")!;
ok(
  appointments.totalBytes === appointments.dataBytes + appointments.indexBytes + appointments.toastBytes &&
    appointments.indexBytes > 0 &&
    (appointments.rows ?? 0) >= count("select count(*) from appointments") * 0.9,
  "datos, índices y textos largos suman el total, y las filas",
  appointments,
);
ok(tables.app.every((table, i) => i === 0 || tables.app[i - 1].totalBytes >= table.totalBytes), "de la que más ocupa a la que menos");
ok(tables.supabase.length === 0 && tables.otherBytes > 0, "sin Supabase, su grupo va vacío; el catálogo de PostgreSQL, aparte", [tables.supabase, tables.otherBytes]);

const maintenance = r.stats.maintenance as DatabaseMaintenance;
ok(
  !failed(maintenance) && maintenance.tables.length === 10 && maintenance.tables[0].writes > 0 && maintenance.tables.every((table) => "deadRows" in table && "lastVacuumAt" in table),
  "mantenimiento: las 10 tablas con más escrituras, sus filas muertas y su última limpieza",
  maintenance.tables?.slice(0, 2),
);
const unusedNames = maintenance.unusedIndexes.map((index) => `'${index.name}'`).join(", ");
const kept = count(
  `select count(*) from pg_index x join pg_class i on i.oid = x.indexrelid
    where i.relname in (${unusedNames || "''"})
      and (x.indisunique or x.indisprimary or exists (select 1 from pg_constraint c where c.conindid = x.indexrelid))`,
);
const exclusion = sql("select i.relname from pg_constraint c join pg_class i on i.oid = c.conindid where c.contype = 'x' limit 1");
ok(
  maintenance.unusedIndexes.length > 0 && kept === 0 && exclusion !== "" && !maintenance.unusedIndexes.some((index) => index.name === exclusion),
  "los índices sin uso, sin los únicos ni el de la restricción que impide dos citas a la misma hora",
  [maintenance.unusedIndexes.slice(0, 3), kept, exclusion],
);
ok(
  maintenance.connections.total >= 1 &&
    maintenance.connections.max > 0 &&
    maintenance.connections.byRole.every((row) => Object.keys(row).sort().join() === "count,role,state,who"),
  "las conexiones abiertas por cuenta y estado, sin la consulta",
  maintenance.connections,
);

// Otro super admin (del equipo de soporte): no ve nada.
r = await owner("POST", "/admin/platform-admins", { firstName: "Sofía", lastName: "Soporte", email: "sofia.soporte@example.com", password: "Soporte-2026" });
ok(r.status === 200 && r.body.user.platformOwner === false, "el principal agrega a otro super admin", r.body);
const helper = agent({ ip: "10.24.0.3" });
await helper("POST", "/auth/login", { email: "sofia.soporte@example.com", password: "Soporte-2026", remember: true });
r = await stats(helper);
ok(r.status === 403 && r.body.error.message === "Sólo el super admin principal ve la base de datos.", "otro super admin: 403", r.body);
r = await stats(ricardo);
ok(r.status === 403 && !("size" in (r.body ?? {})), "un propietario: 403", r.body);
r = await stats(agent({ ip: "10.24.0.4" }));
ok(r.status === 401, "sin sesión: 401", r.body);
const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
const strictOwner = await login("admin@demo.com", { base: strict.base, ip: "10.24.0.5" });
r = await stats(strictOwner);
ok(r.status === 403 && r.body.error.code === "two_factor_required", "el principal sin la verificación en dos pasos: two_factor_required, como el resto de /admin", r.body);
strict.stop();

/* ------------------------------------------------- El límite de peticiones ---- */

console.log("El límite: 20 cada 15 minutos");
{
  const busy = await login("admin@demo.com", { ip: "10.24.0.99" });
  const statuses: number[] = [];
  for (let i = 0; i < 20; i++) statuses.push((await busy("GET", PATH)).status);
  const last = await busy("GET", PATH);
  ok(statuses.every((status) => status === 200) && last.status === 429 && last.body.error.code === "rate_limited", "las 20 primeras pasan; la 21, 429", [statuses, last.body]);
  r = await stats();
  ok(r.status === 200, "desde otra conexión sigue entrando");
}

/* ---------------------------------------------- Sin las piezas de Supabase ---- */

console.log("Sin pg_stat_statements ni el esquema storage (las bases locales)");
const preloaded = count("select count(*) from pg_settings where name = 'shared_preload_libraries' and setting like '%pg_stat_statements%'") > 0;
const available = count("select count(*) from pg_available_extensions where name = 'pg_stat_statements'") > 0;
sql("drop extension if exists pg_stat_statements");
r = await stats();
ok(r.status === 200 && r.stats.work === null && r.stats.files === null, "sin la extensión, work es null; sin storage, los archivos también", [r.stats.work, r.stats.files]);
ok(!failed(r.stats.size) && !failed(r.stats.tables) && !failed(r.stats.maintenance) && Array.isArray(r.stats.history), "y lo demás sale igual");

let work: DatabaseWork | null = null;
if (available) {
  sql("create extension pg_stat_statements");
  if (!preloaded) {
    r = await stats();
    ok(r.status === 200 && r.stats.work === null && !failed(r.stats.tables), "instalada pero sin cargar (shared_preload_libraries): también null, sin error");
    console.log("  · Este PostgreSQL no carga pg_stat_statements: «Qué la hace trabajar» con datos se prueba con TEST_DATABASE_URL a uno que la cargue.");
  }
} else console.log("  · Este PostgreSQL no trae pg_stat_statements: sólo se prueba sin la extensión.");

/* ------------------------------------------- Con pg_stat_statements cargada ---- */

const people = sql(
  `select email from users union select email from clients where email <> ''
   union select name from clients union select first_name || ' ' || last_name from users`,
).split("\n").filter((value) => value.trim().length >= 4);

if (available && preloaded) {
  console.log("Qué la hace trabajar (con pg_stat_statements)");
  const secretEmail = sql("select email from clients where email <> '' order by name limit 1");
  const secretName = sql("select name from clients order by name limit 1");
  sql("select pg_stat_statements_reset()");
  // Consultas lentas (para que salgan en las 10 primeras) con un paciente en los textos y en los comentarios.
  sql(`select pg_sleep(0.4), '${secretName}' as nombre -- ${secretEmail} · ${secretName}`);
  sql(`do $$ begin perform pg_sleep(0.3); raise notice '%', '${secretEmail}'; end $$ /* ${secretName} */`);
  sql(`select count(*) from clients where email = '${secretEmail}' or name = '${secretName}'`);
  sql(`comment on table backup_runs is '${secretEmail}'`);
  sql("comment on table backup_runs is null");
  sql('select ran_at as "ranAt" from cron_runs order by ran_at desc limit 1');
  r = await stats();
  work = r.stats.work as DatabaseWork;
  ok(r.status === 200 && work !== null && !failed(work) && work.top.length > 0 && work.top.length <= 10, "las 10 consultas que más tiempo consumen", work);
  ok(work.totalMs > 600 && work.calls > 0 && work.since !== null, "el tiempo total de trabajo y desde cuándo cuenta", [work.totalMs, work.since]);
  const shares = work.byWho.reduce((total, row) => total + row.share, 0);
  ok(Math.abs(shares - 1) < 1e-9 && work.byWho.some((row) => row.who === "app"), "el reparto por quién suma el 100 %", work.byWho);
  ok(work.top[0].text.startsWith("select pg_sleep($1), $2 as nombre") && work.top[0].share > 0.3 && work.top[0].calls === 1, "la más lenta primero, con su % y cuántas veces corrió", work.top[0]);
  const slowDo = work.top.find((query) => /^do /.test(query.text));
  ok(slowDo !== undefined && !/sleep|raise|notice/.test(slowDo.text), "un bloque DO sale sin su cuerpo", slowDo);
  ok(work.top.every((query) => !query.text.replace(/'…'/g, "").includes("'")), "ningún texto entre comillas en las consultas", work.top.map((query) => query.text));
  ok(work.top.every((query) => query.text.length <= 160), "cada texto, recortado a 160 caracteres");
} else if (available) sql("drop extension if exists pg_stat_statements");

/* -------------------------------------------- Los archivos (storage falso) ---- */

console.log("Los archivos, con un esquema storage como el de Supabase");
sql(`create schema storage;
     create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
     insert into storage.objects (bucket_id, name, metadata) values
       ('historias-clinicas', 'n1/a.pdf', '{"size": 1048576}'), ('historias-clinicas', 'n1/b.pdf', '{"size": 524288}'),
       ('comprobantes', 'n1/c.jpg', '{"size": 200000}'),
       ('imagenes', 'n1/logo.png', '{"size": 50000}'), ('imagenes', 'n1/raro.png', '{"size": "no es un número"}');`);
r = await stats();
const files = r.stats.files as DatabaseFiles;
ok(
  !failed(files) &&
    files !== null &&
    files.totalBytes === 1048576 + 524288 + 200000 + 50000 &&
    files.limitBytes === 1024 * MB &&
    JSON.stringify(files.buckets) ===
      JSON.stringify([
        { bucket: "historias-clinicas", files: 2, bytes: 1572864, label: "Historias clínicas" },
        { bucket: "comprobantes", files: 1, bytes: 200000, label: "Comprobantes de pago" },
        { bucket: "imagenes", files: 2, bytes: 50000, label: "Logos y fotos" },
      ]),
  "los archivos por bucket frente a su tope de 1 GB (un tamaño que no es un número no cuenta)",
  files,
);
const storageGroup = (r.stats.tables as DatabaseTables).supabase.find((group) => group.key === "storage");
ok(
  storageGroup?.label === "Almacenamiento (storage)" && storageGroup.tables[0]?.name === "objects" && storageGroup.tables[0].label === "Registro de cada archivo (los archivos van aparte)",
  "y su tabla, en «Lo que trae Supabase»",
  storageGroup,
);
ok(!(r.stats.tables as DatabaseTables).app.some((table) => table.schema !== "public"), "las de Agenda360 son sólo las de public");

/* -------------------------------------------------------------- Privacidad ---- */

console.log("Privacidad (CE-003)");
{
  const text = JSON.stringify(r.body);
  const all = work ? `${text} ${JSON.stringify(work)}` : text;
  const leaks = people.filter((value) => all.includes(value));
  ok(people.length > 30 && leaks.length === 0, `ninguno de los ${people.length} emails y nombres de los datos demo aparece en toda la respuesta`, leaks.slice(0, 5));
  ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(all), "ni ningún email", all.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]);
  ok(!/"query"/.test(all), "pg_stat_activity: nunca la columna query");
}
{
  const dirty =
    "-- source: dashboard\n-- user: juan.perez@demo.com\nselect \"ranAt\", E'it\\'s ana@x.com', 'O''Brien', $tag$ secreto $tag$, $1, 1712345678 /* María /* López */ */ from t where x = 'a@b.c'";
  const clean = cleanQueryText(dirty);
  ok(clean === `select "ranAt", '…', '…', $$…$$, $1, … from t where x = '…'`, "el texto: sin comentarios, con las comillas, los cuerpos y los números tapados", clean);
  ok(cleanQueryText("select a, 'secreto', b", 12) === "select a,…", "el recorte no deja a medias lo tapado", cleanQueryText("select a, 'secreto', b", 12));
  ok(cleanQueryText("select x from t where y = 'sin cerrar") === "select x from t where y = '…'", "un texto sin la comilla de cierre se tapa hasta el final");
  const cronQuery = describeQuery('select ran_at as "ranAt" from cron_runs order by ran_at desc limit $1', "postgres", "postgres");
  const pooler = describeQuery("select * from pgbouncer.get_auth($1)", "pgbouncer", "postgres");
  const zones = describeQuery("SELECT name FROM pg_timezone_names", "authenticator", "postgres");
  const dashboard = describeQuery("-- source: dashboard\n-- user: x@y.com\nselect * from clients", "postgres", "postgres");
  const session = describeQuery("with found as (select s.id from sessions s join users u on u.id = s.user_id where s.token_hash = $1)", "postgres", "postgres");
  ok(
    cronQuery.label === "El cron revisa su última pasada" &&
      cronQuery.who === "cron" &&
      pooler.who === "pooler" &&
      pooler.label === "El pooler autentica una conexión" &&
      zones.who === "supabase" &&
      dashboard.who === "supabase" &&
      dashboard.label === "El panel de Supabase lee la base" &&
      dashboard.text === "select * from clients" &&
      session.label === "Se busca la sesión de cada petición" &&
      session.who === "app",
    "en palabras y por quién: el cron, el pooler, Supabase y la app",
    [cronQuery, pooler, zones, dashboard, session],
  );
}

/* ---------------------------------------------------------- El tope de 5 s ---- */

console.log("Si una consulta tarda (tope de 5 segundos)");
{
  // Otra conexión bloquea una tabla 9 segundos: medirla espera y pasa el tope.
  const locker = spawn("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", "begin; lock table backup_runs in access exclusive mode; select pg_sleep(9); commit;"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 50 && count("select count(*) from pg_locks where relation = 'backup_runs'::regclass and mode = 'AccessExclusiveLock' and granted") === 0; i++) {
    await sleep(100);
  }
  const started = Date.now();
  r = await stats();
  const took = Date.now() - started;
  ok(
    r.status === 200 && failed(r.stats.tables) && (r.stats.tables as { error: string }).error === UNREADABLE && took >= 4500 && took < 8500,
    "«Qué ocupa» dice «No se pudo leer ahora» a los 5 segundos",
    [r.stats.tables, took],
  );
  ok(!failed(r.stats.size) && !failed(r.stats.maintenance) && Array.isArray(r.stats.history) && !failed(r.stats.files), "y lo demás se ve igual", r.stats);
  await new Promise((resolve) => locker.on("exit", resolve));
}

/* ----------------------------------------------------- La foto diaria del cron ---- */

console.log("El cron: una foto al día");
const photosToday = () => count(`select count(*) from database_stats where day = '${T}'`);
sql("delete from database_stats");
let refresh = await saveDailyDatabaseStats({ now: atEcuador("05:59") });
ok(refresh.status === "early" && photosToday() === 0, "antes de las 06:00 de Ecuador no la guarda", refresh);
refresh = await saveDailyDatabaseStats({ now: atEcuador("06:00") });
const photo = JSON.parse(sql(`select json_build_object('size', size_bytes, 'files', files_bytes, 'tables', tables) from database_stats where day = '${T}'`));
ok(
  refresh.status === "saved" && photosToday() === 1 && refresh.sizeBytes === photo.size && photo.size > 0 && photo.files === 1822864,
  "a las 06:00 guarda el tamaño de la base y el de los archivos",
  [refresh, photo.size, photo.files],
);
ok(
  photo.tables.length === 10 && photo.tables.every((table: { schema: string; name: string; bytes: number }) => Object.keys(table).sort().join() === "bytes,name,schema" && table.bytes > 0),
  "y las 10 tablas que más ocupan (sólo su nombre y sus bytes)",
  photo.tables.slice(0, 2),
);
const firstAt = sql(`select created_at from database_stats where day = '${T}'`);
refresh = await saveDailyDatabaseStats({ now: atEcuador("06:10") });
ok(refresh.status === "ready" && photosToday() === 1 && sql(`select created_at from database_stats where day = '${T}'`) === firstAt, "la siguiente pasada no la repite", refresh);
sql(`delete from database_stats where day = '${T}';
     insert into database_stats (day, size_bytes) values ('${day(-401)}', 1), ('${day(-400)}', 1);`);
refresh = await saveDailyDatabaseStats({ now: atEcuador("06:20") });
ok(refresh.status === "saved" && refresh.purged === 1 && count(`select count(*) from database_stats where day = '${day(-400)}'`) === 1, "borra las de más de 400 días (y deja la de hace 400)", refresh);
sql("drop schema storage cascade");

// El cron de GitHub de verdad (scripts/cron.ts): sin la foto de hoy, la guarda si ya pasaron las 06:00.
sql("delete from database_stats");
const ntfy = await fakeNtfy();
let run = await runCron(ntfy.url);
const lastReport = () => JSON.parse(sql("select report->'databaseStats' from cron_runs order by ran_at desc limit 1") || "null");
const afterSix = getZonedNow("America/Guayaquil").minutes >= 6 * 60 && getZonedNow("America/Guayaquil").date === T;
ok(
  run.code === 0 &&
    (afterSix
      ? / · base de datos: foto guardada \(\d+,\d MB\) · analítica: /.test(run.output) && photosToday() === 1 && lastReport()?.status === "saved" && sql(`select files_bytes from database_stats where day = '${T}'`) === ""
      : / · base de datos: se guarda después de las 06:00 · analítica: /.test(run.output) && lastReport()?.status === "early"),
  `el registro del cron: «base de datos: ${afterSix ? "foto guardada (N MB)" : "se guarda después de las 06:00"}» (sin storage, los archivos en null)`,
  [run.output.slice(-400), lastReport()],
);
if (afterSix) {
  run = await runCron(ntfy.url);
  ok(run.code === 0 && / · base de datos: ya estaba la de hoy · /.test(run.output) && photosToday() === 1, "la segunda pasada: «ya estaba la de hoy»", run.output.slice(-300));
}
ok(!/@/.test(run.output), "el registro, sólo con cifras");
ntfy.close();

/* ------------------------------------------------------------ La proyección ---- */

console.log("El historial y la proyección");
// 10 días seguidos, de hace 9 días a hoy, en MB: 100, 102, 101, 104, 103, 106, 105, 108, 107, 110.
// A mano: x = 0…9 (media 4,5), y media 104,6; Sxy = 83 y Sxx = 82,5. Crece 83/82,5 = 1,00606 MB por día,
// 30,1818 MB cada 30 días. Desde la última (110 MB): al 70 % de 500 MB (350) faltan 240 MB, 240 · 82,5 /
// (83 · 30) = 7,9518 meses; al tope, 390 · 82,5 / 2490 = 12,9217 meses.
const SIZES = [100, 102, 101, 104, 103, 106, 105, 108, 107, 110];
const history: DatabaseHistoryPoint[] = SIZES.map((mb, i) => ({ day: day(i - 9), sizeBytes: mb * MB, filesBytes: null }));
const projection = projectGrowth(history, 500 * MB)!;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
ok(
  projection.days === 10 &&
    close(projection.bytesPerMonth, ((83 / 82.5) * 30) * MB) &&
    close(projection.monthsTo70!, 19800 / 2490) &&
    close(projection.monthsToFull!, 32175 / 2490),
  "con 10 días, la regresión da 30,18 MB por mes, 7,95 meses al 70 % y 12,92 al tope (como a mano)",
  projection,
);
const flat = projectGrowth(SIZES.map((_, i) => ({ day: day(i - 9), sizeBytes: 100 * MB, filesBytes: null })), 500 * MB)!;
const over = projectGrowth(SIZES.map((mb, i) => ({ day: day(i - 9), sizeBytes: (mb + 300) * MB, filesBytes: null })), 500 * MB)!;
ok(flat.bytesPerMonth === 0 && flat.monthsTo70 === null && flat.monthsToFull === null, "si no crece, no hay fecha", flat);
ok(over.monthsTo70 === 0 && over.monthsToFull! > 0, "si ya pasó el 70 %, 0 meses hasta el 70 %", over);
ok(projectGrowth(history.slice(0, 6), 500 * MB) === null, "con 6 días, todavía no hay proyección");

sql("delete from database_stats");
sql(
  `insert into database_stats (day, size_bytes) values ${SIZES.map((mb, i) => `('${day(i - 9)}', ${mb * MB})`).join(", ")}, ('${day(-90)}', ${99 * MB}), ('${day(-89)}', ${99 * MB})`,
);
r = await stats();
const points = r.stats.history as DatabaseHistoryPoint[];
ok(
  Array.isArray(points) && points.length === 11 && points[0].day === day(-89) && points.at(-1)!.day === T && points.at(-1)!.sizeBytes === 110 * MB,
  "el historial: los últimos 90 días (el de hace 89 sí, el de hace 90 no), del más viejo al más nuevo",
  points?.map((point) => point.day),
);
sql(`delete from database_stats where day = '${day(-89)}'`);
r = await stats();
const apiProjection = r.stats.projection!;
ok(
  apiProjection?.days === 10 && close(apiProjection.bytesPerMonth, projection.bytesPerMonth) && close(apiProjection.monthsToFull!, projection.monthsToFull!),
  "la API da la misma proyección",
  apiProjection,
);
sql(`delete from database_stats where day < '${day(-2)}'`);
r = await stats();
ok((r.stats.history as DatabaseHistoryPoint[]).length === 3 && r.stats.projection === null, "con 3 días: sin proyección («Hacen falta unos días de datos»)", r.stats.projection);

if (available && preloaded) sql("drop extension if exists pg_stat_statements");
await pool.end();
done("de la pantalla «Base de datos»");
