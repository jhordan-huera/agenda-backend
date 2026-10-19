import { config } from "../config.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { daysBetween, getZonedNow } from "../shared/lib/time.ts";
import type {
  DatabaseFiles,
  DatabaseHistoryPoint,
  DatabaseMaintenance,
  DatabaseProjection,
  DatabaseQueryStat,
  DatabaseSectionError,
  DatabaseSize,
  DatabaseStats,
  DatabaseTableGroup,
  DatabaseTables,
  DatabaseTableStat,
  DatabaseWork,
  DatabaseWorker,
} from "../shared/types/index.ts";
import { authorizeSuperAdmin, requireUser, type RequestContext } from "./context.ts";

/**
 * La pantalla «Base de datos» del super admin principal (spec 024): qué ocupa la base, qué la hace
 * trabajar, su mantenimiento y cómo crece.
 *
 * - **Sólo el principal** (`platformOwner`), con la verificación en dos pasos como el resto de /admin; los
 *   demás super admins reciben 403. La ruta tiene su propio límite de peticiones y no se guarda en caché.
 * - **Sólo lectura, con tope de tiempo:** todo va en una transacción `begin read only` con
 *   `set local statement_timeout`, nunca con un `SET` de sesión: la API entra por el pooler de Supabase
 *   (puerto 6543), que reparte la misma conexión entre peticiones, y un `SET` de sesión se quedaría en
 *   ella (ya tumbó la app una vez). Cada sección va en su propio punto de guardado: si tarda más de 5
 *   segundos o falla, dice «No se pudo leer ahora» y las demás salen igual.
 * - **Nunca datos de filas:** sólo nombres de tablas, tamaños y cifras. De `pg_stat_activity` no se lee
 *   la consulta, y el texto de `pg_stat_statements` sale sin comentarios, con los textos entre comillas,
 *   los cuerpos entre `$$` y los números tapados, y recortado.
 * - **No gasta CPU de Vercel sin motivo:** se calcula sólo al abrir la pantalla, y la foto diaria del
 *   historial la guarda el cron de GitHub (saveDailyDatabaseStats).
 * - En las bases locales y en las de las pruebas no están `pg_stat_statements` ni el esquema `storage`
 *   de Supabase: «Qué la hace trabajar» y los archivos salen como no disponibles (null).
 */

/* ---------------------------------------------------------------- Reglas ---- */

/** El tope de cada consulta de la pantalla (y de la foto del cron). */
const STATEMENT_TIMEOUT = "5s";
/** Lo que dice una sección que no se pudo leer. */
export const UNREADABLE = "No se pudo leer ahora";
/** Desde qué hora de Ecuador guarda el cron la foto del día, y cuántos días se guardan las fotos. */
export const DATABASE_STATS_HOUR = 6;
export const DATABASE_STATS_KEEP_DAYS = 400;
/** Los días de historial que muestra la pantalla, y los que hacen falta para la proyección. */
export const HISTORY_DAYS = 90;
export const PROJECTION_MIN_DAYS = 7;
/** La proyección cuenta los meses de 30 días. */
const DAYS_PER_MONTH = 30;
/** «Llega al 70 %»: el mismo umbral que la tarjeta de Salud (ámbar). */
export const WARN_SHARE = 0.7;
/** Las consultas de la lista, las tablas de mantenimiento, los índices sin uso y las de la foto diaria. */
const TOP_QUERIES = 10;
const TOP_WRITES = 10;
const MAX_UNUSED_INDEXES = 30;
const SNAPSHOT_TABLES = 10;
/** Las consultas que se clasifican (por quién y en palabras); el resto del tiempo cuenta por su cuenta. */
const CLASSIFIED_QUERIES = 200;
/** Lo que se lee del texto de cada consulta y lo que se muestra. */
const QUERY_READ_CHARS = 1000;
export const QUERY_TEXT_MAX = 160;

/**
 * Cada tabla de Agenda360 en palabras, con su regla de borrado tal como está en el código (spec 024):
 * - cron_runs: `delete from cron_runs … 30 days` (src/jobs/scheduled-tasks.ts);
 * - notifications: EMAIL_CONTENT_DAYS = 30 (purgeOldEmailContent; los que siguen en cola no se tocan);
 * - audit_logs: purge_audit_logs (migración 026): 5 meses, las sesiones 90 días y la historia clínica 5 años;
 * - sessions y login_challenges: deleteExpiredSessions, al caducar;
 * - panel_notices: NOTICE_DAYS = 30 (cleanupPanelNotices; sus lecturas, en cascada);
 * - push_messages: PUSH_MESSAGE_DAYS = 7; push_subscriptions en pausa: PAUSED_DEVICE_DAYS = 90 (cleanupPush);
 * - payment_receipts: RECEIPT_RETENTION_MONTHS = 3 después de la cita (purgeOldReceipts);
 * - analytics_snapshots: SNAPSHOT_KEEP_DAYS = 30 (cleanupSnapshots);
 * - image_uploads: UNUSED_UPLOAD_HOURS = 24 (deleteUnusedImageUploads);
 * - rate_limits: al vencer cada cuenta (deleteExpiredRateLimits);
 * - backup_runs: BACKUP_RUNS_DAYS = 365 (scripts/backup.ts);
 * - database_stats: DATABASE_STATS_KEEP_DAYS = 400 (esta foto diaria).
 * Las que no están aquí salen con su nombre técnico y sin regla.
 */
export const TABLE_INFO: Record<string, { label: string; retention: string }> = {
  notifications: { label: "Emails (cola e historial)", retention: "El contenido a los 30 días; queda el registro" },
  audit_logs: { label: "Actividad", retention: "5 meses (las sesiones, 90 días; la historia clínica, 5 años)" },
  cron_runs: { label: "Registro del cron", retention: "30 días" },
  appointments: { label: "Citas", retention: "Nunca" },
  appointment_clients: { label: "Pacientes de cada cita (sesiones de pareja)", retention: "Nunca" },
  appointment_series: { label: "Series de citas", retention: "Nunca" },
  clients: { label: "Pacientes", retention: "Nunca" },
  clinical_profiles: { label: "Historia clínica: ficha de cada paciente", retention: "Nunca" },
  clinical_notes: { label: "Historia clínica: evoluciones", retention: "Nunca" },
  clinical_note_addenda: { label: "Historia clínica: notas añadidas", retention: "Nunca" },
  clinical_attachments: { label: "Historia clínica: registro de archivos", retention: "Nunca (las subidas sin terminar, al día)" },
  clinical_templates: { label: "Plantillas de historia clínica", retention: "Nunca" },
  clinical_template_versions: { label: "Versiones de las plantillas", retention: "Nunca" },
  businesses: { label: "Negocios", retention: "Nunca" },
  business_users: { label: "Equipo de cada negocio", retention: "Nunca" },
  business_categories: { label: "Tipos de negocio", retention: "Nunca" },
  professionals: { label: "Profesionales (agendas)", retention: "Nunca" },
  professional_services: { label: "Servicios de cada profesional", retention: "Nunca" },
  services: { label: "Servicios", retention: "Nunca" },
  schedules: { label: "Horarios", retention: "Nunca" },
  blocked_times: { label: "Bloqueos de la agenda", retention: "Nunca" },
  subscriptions: { label: "Plan de cada negocio", retention: "Nunca" },
  plan_change_requests: { label: "Solicitudes de cambio de plan", retention: "Nunca" },
  payment_receipts: { label: "Comprobantes de pago (registro)", retention: "3 meses después de la cita (las subidas sin terminar, al día)" },
  users: { label: "Cuentas", retention: "Nunca" },
  sessions: { label: "Sesiones abiertas", retention: "Al caducar (como mucho 30 días)" },
  login_challenges: { label: "Verificación en dos pasos (códigos por usar)", retention: "Al caducar" },
  rate_limits: { label: "Límites de peticiones", retention: "Al vencer cada límite" },
  image_uploads: { label: "Subidas de logos y fotos", retention: "24 horas" },
  push_subscriptions: { label: "Aparatos con avisos en el celular", retention: "Los pausados, a los 90 días" },
  push_messages: { label: "Avisos al celular", retention: "7 días" },
  panel_notices: { label: "Avisos de la campana", retention: "30 días" },
  panel_notice_reads: { label: "Avisos de la campana leídos", retention: "30 días, con su aviso" },
  panel_notice_state: { label: "«Marcar todo como leído» de cada persona", retention: "Nunca (una fila por persona)" },
  analytics_snapshots: { label: "Fotos de la analítica", retention: "30 días" },
  database_stats: { label: "Historial del tamaño de la base", retention: "400 días" },
  backup_runs: { label: "Copias de seguridad registradas", retention: "1 año" },
  platform_settings: { label: "Configuración de la plataforma", retention: "Nunca (una fila)" },
  schema_migrations: { label: "Migraciones aplicadas", retention: "Nunca" },
};

/** Algunas tablas de Supabase en palabras (las demás, con su nombre técnico). Agenda360 no usa su inicio de sesión. */
const SUPABASE_TABLE_LABELS: Record<string, string> = {
  "auth.users": "Cuentas de Supabase Auth",
  "auth.audit_log_entries": "Registro de Supabase Auth",
  "auth.sessions": "Sesiones de Supabase Auth",
  "auth.refresh_tokens": "Renovaciones de Supabase Auth",
  "storage.objects": "Registro de cada archivo (los archivos van aparte)",
  "storage.buckets": "Buckets",
  "realtime.messages": "Mensajes de Realtime",
  "realtime.subscription": "Suscripciones de Realtime",
  "net._http_response": "Respuestas de pg_net",
  "supabase_migrations.schema_migrations": "Migraciones de Supabase",
};

/** Los grupos de «Lo que trae Supabase». */
const SUPABASE_GROUPS: { key: DatabaseTableGroup["key"]; label: string }[] = [
  { key: "auth", label: "Inicio de sesión (auth)" },
  { key: "storage", label: "Almacenamiento (storage)" },
  { key: "internal", label: "Lo interno" },
];

/** Los buckets de Agenda360 en palabras (ver file-storage.ts). */
const BUCKET_LABELS: Record<string, string> = {
  [config.storageBucket]: "Historias clínicas",
  comprobantes: "Comprobantes de pago",
  imagenes: "Logos y fotos",
};

/** Las cuentas de Supabase (las demás, salvo la de la API y la del pooler, son «otras cuentas»). */
const SUPABASE_ROLES = new Set(["authenticator", "anon", "authenticated", "service_role", "dashboard_user", "pgsodium_keymaker"]);
const POOLER_ROLES = new Set(["pgbouncer", "supavisor"]);

const WORKER_LABELS: Record<DatabaseWorker, string> = {
  app: "La app (la API)",
  cron: "El cron",
  pooler: "Las conexiones (el pooler)",
  supabase: "Supabase",
  other: "Otras cuentas",
};

/**
 * Las consultas en palabras (spec 024), sobre el texto ya limpio y en minúsculas: gana la primera que
 * coincide. `cron`: sólo la hace el cron, que entra con la misma cuenta que la API (así se separan).
 * `onlySupabase`: sólo cuando la hace una cuenta de Supabase.
 */
const QUERY_LABELS: { pattern: RegExp; label: string; cron?: true; onlySupabase?: true }[] = [
  { pattern: /^<insufficient privilege>$/, label: "De otra cuenta: PostgreSQL no deja ver su texto" },
  // El cron (scripts/cron.ts → runScheduledTasks).
  { pattern: /^select ran_at as "ranat" from cron_runs order by ran_at desc/, label: "El cron revisa su última pasada", cron: true },
  { pattern: /^insert into cron_runs\b/, label: "El cron guarda su resumen", cron: true },
  { pattern: /^delete from cron_runs\b/, label: "El cron borra sus pasadas de más de 30 días", cron: true },
  { pattern: /\bpurge_audit_logs\(\)/, label: "El cron borra la actividad vieja", cron: true },
  { pattern: /^update notifications set body = /, label: "El cron borra el contenido de los emails viejos", cron: true },
  { pattern: /^delete from sessions where expires_at\b/, label: "El cron borra las sesiones caducadas", cron: true },
  { pattern: /^delete from login_challenges where expires_at\b/, label: "El cron borra los códigos de verificación caducados", cron: true },
  { pattern: /^select id from businesses where status = .*notification_settings/, label: "El cron busca los negocios con recordatorios", cron: true },
  { pattern: /^with zones as materialized\b/, label: "El cron prepara la analítica", cron: true },
  { pattern: /^insert into analytics_snapshots\b/, label: "El cron guarda la foto de la analítica", cron: true },
  { pattern: /^insert into database_stats\b/, label: "El cron guarda la foto del tamaño de la base", cron: true },
  // La API.
  { pattern: /\bfrom sessions s\b.*\btoken_hash = \$/, label: "Se busca la sesión de cada petición" },
  { pattern: /^insert into sessions\b/, label: "Se abre una sesión (alguien inicia sesión)" },
  { pattern: /^insert into notifications\b/, label: "Se pone un email en la cola" },
  { pattern: /^insert into audit_logs\b/, label: "Se anota algo en la actividad" },
  { pattern: /^delete from rate_limits where reset_at\b/, label: "Se borran los límites de peticiones vencidos" },
  { pattern: /\brate_limits\b/, label: "Se cuentan los límites de peticiones" },
  { pattern: /\bfrom notifications n\b.*\bfor update skip locked\b/, label: "Se toma un lote de la cola de emails" },
  { pattern: /^with periods as\b/, label: "El inicio de /admin calcula el crecimiento del mes" },
  { pattern: /^with days as \(select generate_series\b.*\bnotifications\b/, label: "El inicio de /admin cuenta los emails de cada día" },
  { pattern: /\bfrom push_messages m\b.*\bfor update skip locked\b/, label: "Se toma un lote de los avisos al celular" },
  { pattern: /^select (\$1|…)$/, label: "Se comprueba que la base responde" },
  { pattern: /\bfrom \S*pg_stat_statements(_info)?\b/, label: "Esta pantalla lee las estadísticas de consultas" },
  { pattern: /\bfrom database_stats\b/, label: "Esta pantalla lee el historial del tamaño" },
  { pattern: /\bpg_total_relation_size\b|\bpg_stat_user_(tables|indexes)\b|\bpg_stat_activity\b/, label: "Esta pantalla mide las tablas y las conexiones" },
  { pattern: /\bpg_database_size\b/, label: "Se mide el tamaño de la base" },
  { pattern: /^(savepoint|release savepoint|rollback to savepoint)\b/, label: "Un punto de guardado dentro de una transacción" },
  { pattern: /^(begin|commit|rollback|start transaction)\b/, label: "Se abre o se cierra una transacción" },
  { pattern: /^set local\b/, label: "Un tope de tiempo dentro de una transacción" },
  { pattern: /^(create|alter|drop|comment on) /, label: "Un cambio en la estructura (una migración)" },
  // Las conexiones y Supabase.
  { pattern: /\bpgbouncer\.get_auth\b|\bfrom pg_shadow\b|\bfrom pg_authid\b/, label: "El pooler autentica una conexión" },
  // Visto en producción el 2026-10-18: al abrir cada conexión nueva, el pooler (Supavisor) lee los tipos.
  { pattern: /^select t\.oid, t\.typname, t\.typsend, t\.typreceive\b/, label: "El pooler prepara una conexión nueva (lee los tipos)" },
  { pattern: /^select pg_sleep\(/, label: "Una pausa a propósito (pg_sleep) de alguna herramienta" },
  { pattern: /\brealtime\.list_changes\b/, label: "Supabase Realtime revisa los cambios" },
  { pattern: /\bpg_timezone_names\b/, label: "Se leen las zonas horarias (es lento en PostgreSQL)" },
  { pattern: /\bwith pgrst_source\b/, label: "La API REST de Supabase responde una petición" },
  { pattern: /\bset_config\(/, label: "La API REST de Supabase prepara una petición" },
  { pattern: /\bstorage\.objects\b/, label: "Se leen o guardan los archivos de Supabase Storage" },
  { pattern: /\bauth\.\w+/, label: "El inicio de sesión de Supabase (auth)" },
  { pattern: /\bnet\.(http_request_queue|_http_response)\b/, label: "pg_net revisa su cola" },
  { pattern: /\bcron\.job\b/, label: "pg_cron revisa sus tareas" },
  {
    pattern: /\bpg_catalog\.|\binformation_schema\.|\bpg_(namespace|class|attribute|proc|type|constraint)\b/,
    label: "Supabase lee el esquema de la base",
    onlySupabase: true,
  },
];

/* ------------------------------------------------------ El texto de las consultas ---- */

/** Una dirección de email que quedara fuera de las comillas (p. ej. en un nombre entre comillas dobles). */
const EMAIL_PATTERN = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;
/** Un número suelto, que no es parte de un nombre ni un parámetro ($1). */
const NUMBER_PATTERN = /(?<![\w$.])\d+(?:\.\d+)?(?![\w.])/g;
/** Una etiqueta de texto entre dólares: $$ o $cuerpo$. */
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * El texto de una consulta de pg_stat_statements, para mostrarlo (spec 024). PostgreSQL ya lo trae
 * normalizado ($1 en lugar de cada valor), salvo en las órdenes que no son consultas (SET, CREATE, DO…):
 * por eso aquí se quitan los comentarios (el panel de Supabase pone en ellos quién la escribió), se tapan
 * los textos entre comillas ('…'), los cuerpos entre dólares ($$…$$), los números sueltos y cualquier
 * email que quedara, y se recorta a `max` caracteres. Los nombres entre comillas dobles ("ranAt") quedan.
 */
export function cleanQueryText(raw: string, max = QUERY_TEXT_MAX): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const char = raw[i];
    const next = raw[i + 1];
    if (char === "-" && next === "-") {
      const end = raw.indexOf("\n", i);
      i = end === -1 ? raw.length : end;
      out += " ";
    } else if (char === "/" && next === "*") {
      // Los comentarios de bloque se pueden anidar.
      let depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === "/" && raw[i + 1] === "*") (depth++, (i += 2));
        else if (raw[i] === "*" && raw[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      out += " ";
    } else if (char === "'") {
      // '' es una comilla dentro del texto; en E'…' también \'. Sin la comilla de cierre, hasta el final.
      const escapes = /(^|[^\w$])[eE]$/.test(out);
      if (escapes) out = out.slice(0, -1);
      i++;
      while (i < raw.length) {
        if (escapes && raw[i] === "\\") i += 2;
        else if (raw[i] === "'" && raw[i + 1] === "'") i += 2;
        else if (raw[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out += "'…'";
    } else if (char === '"') {
      // Un nombre entre comillas dobles ("" es una comilla dentro): se deja como está.
      let end = i + 1;
      while (end < raw.length && !(raw[end] === '"' && raw[end + 1] !== '"')) end += raw[end] === '"' ? 2 : 1;
      out += raw.slice(i, end + 1);
      i = end + 1;
    } else if (char === "$" && DOLLAR_TAG.test(raw.slice(i, i + 64)) && !/[\w$]$/.test(out)) {
      const tag = DOLLAR_TAG.exec(raw.slice(i, i + 64))![0];
      const end = raw.indexOf(tag, i + tag.length);
      i = end === -1 ? raw.length : end + tag.length;
      out += "$$…$$";
    } else {
      out += char;
      i++;
    }
  }
  const text = out.replace(/\s+/g, " ").trim().replace(NUMBER_PATTERN, "…").replace(EMAIL_PATTERN, "…");
  if (text.length <= max) return text;
  // Sin dejar a medias lo tapado ('…' o $$…$$): si el corte cae dentro, se corta antes.
  let end = max - 1;
  for (const mask of text.matchAll(/'…'|\$\$…\$\$/g)) {
    if (mask.index < end && mask.index + mask[0].length > end) {
      end = mask.index;
      break;
    }
  }
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Quién hizo la consulta, por su cuenta: la de la API (`current_user`), el pooler, Supabase u otra. */
function workerOfRole(role: string, apiRole: string): DatabaseWorker {
  if (role === apiRole) return "app";
  if (POOLER_ROLES.has(role)) return "pooler";
  if (role.startsWith("supabase") || SUPABASE_ROLES.has(role)) return "supabase";
  return "other";
}

/** La consulta en palabras y quién la hizo (el cron se separa de la API por sus consultas). */
export function describeQuery(raw: string, role: string, apiRole: string): { label: string | null; text: string; who: DatabaseWorker } {
  const text = cleanQueryText(raw, QUERY_READ_CHARS);
  let who = workerOfRole(role, apiRole);
  // El panel de Supabase marca sus consultas («-- source: dashboard»), aunque entre con la cuenta de la API.
  const fromDashboard = /--\s*source:\s*dashboard/i.test(raw);
  if (fromDashboard) who = "supabase";
  const lower = text.toLowerCase();
  const match = QUERY_LABELS.find((entry) => entry.pattern.test(lower) && (!entry.onlySupabase || who === "supabase"));
  if (match?.cron && who === "app") who = "cron";
  const label = match?.label ?? (fromDashboard ? "El panel de Supabase lee la base" : null);
  return { label, text: cleanQueryText(raw), who };
}

/* --------------------------------------------------------------- Lectura ---- */

/**
 * Lee todo en una transacción de sólo lectura con su tope de tiempo (`set local`, sólo para esta
 * transacción). Al terminar se deshace: no hay nada que guardar.
 */
async function readOnly<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    return await work(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** PostgreSQL dice que una extensión no está cargada (p. ej. pg_stat_statements sin shared_preload_libraries). */
const NOT_LOADED = "55000";

/**
 * Una sección en su punto de guardado: si falla o pasa el tope de tiempo, `{ error }` y la transacción
 * sigue para las demás. `nullOn`: los códigos de PostgreSQL con los que la sección no está disponible (null).
 */
async function section<T>(db: Db, name: string, read: () => Promise<T>, nullOn: string[] = []): Promise<T | DatabaseSectionError | null> {
  await db.query("savepoint seccion");
  try {
    const value = await read();
    await db.query("release savepoint seccion");
    return value;
  } catch (error) {
    await db.query("rollback to savepoint seccion");
    const code = (error as { code?: string })?.code ?? "error";
    if (nullOn.includes(code)) return null;
    // Sólo el código: el mensaje podría traer parte de una consulta.
    console.error(`[base de datos] No se pudo leer ${name} (${code}).`);
    return { error: UNREADABLE };
  }
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Lo que ocupa la base frente al tope del plan. */
async function readSize(db: Db): Promise<DatabaseSize> {
  const row = await one<{ sizeBytes: number }>(db, `select pg_database_size(current_database()) as "sizeBytes"`);
  return { sizeBytes: row!.sizeBytes, limitBytes: config.databaseLimitBytes };
}

/**
 * Los archivos de Supabase Storage (`storage.objects`, con el tamaño en `metadata->>'size'`), por bucket.
 * null: no hay esquema `storage` (en local) o esta cuenta no ve sus filas (con RLS y sin saltarla, la
 * suma saldría en 0 y engañaría).
 */
async function readFiles(db: Db): Promise<DatabaseFiles | null> {
  const access = await one<{ hidden: boolean }>(
    db,
    `select c.relrowsecurity and not (r.rolsuper or r.rolbypassrls or pg_has_role(c.relowner, 'USAGE')) as hidden
       from pg_class c join pg_roles r on r.rolname = current_user
      where c.oid = to_regclass('storage.objects')`,
  );
  if (!access || access.hidden) return null;
  const rows = await many<{ bucket: string; files: number; bytes: number }>(
    db,
    `select o.bucket_id as bucket, count(*)::int as files,
            coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end), 0)::bigint as bytes
       from storage.objects o
      group by o.bucket_id
      order by bytes desc, bucket`,
  );
  return {
    totalBytes: rows.reduce((total, row) => total + row.bytes, 0),
    limitBytes: config.filesLimitBytes,
    buckets: rows.map((row) => ({ ...row, bucket: row.bucket ?? "", label: BUCKET_LABELS[row.bucket] ?? row.bucket ?? "Sin bucket" })),
  };
}

/** Todas las tablas (también las de Supabase), de la que más ocupa a la que menos. */
async function readAllTables(db: Db): Promise<DatabaseTableStat[]> {
  const rows = await many<{ schema: string; name: string; totalBytes: number; indexBytes: number; toastBytes: number; rows: number | null }>(
    db,
    `select n.nspname as schema, c.relname as name,
            pg_total_relation_size(c.oid) as "totalBytes",
            pg_indexes_size(c.oid) as "indexBytes",
            case when c.reltoastrelid = 0 then 0 else pg_total_relation_size(c.reltoastrelid) end as "toastBytes",
            coalesce(nullif(s.n_live_tup, 0), nullif(c.reltuples, -1)::bigint, s.n_live_tup) as rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_all_tables s on s.relid = c.oid
      where c.relkind in ('r', 'p', 'm')
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
      order by 3 desc, 1, 2`,
  );
  return rows.map((row) => {
    const info = row.schema === "public" ? TABLE_INFO[row.name] : undefined;
    return {
      schema: row.schema,
      name: row.name,
      label: labelOf(row.schema, row.name),
      retention: info?.retention ?? null,
      totalBytes: row.totalBytes,
      dataBytes: Math.max(0, row.totalBytes - row.indexBytes - row.toastBytes),
      indexBytes: row.indexBytes,
      toastBytes: row.toastBytes,
      rows: row.rows,
    };
  });
}

/** El nombre en palabras de una tabla (las de Agenda360 y algunas de Supabase); null si no se conoce. */
const labelOf = (schema: string, name: string): string | null =>
  (schema === "public" ? TABLE_INFO[name]?.label : SUPABASE_TABLE_LABELS[`${schema}.${name}`]) ?? null;

const groupOf = (schema: string): DatabaseTableGroup["key"] => (schema === "auth" ? "auth" : schema === "storage" ? "storage" : "internal");

/** «Qué ocupa»: las de Agenda360, lo que trae Supabase (por grupo) y lo que no es de ninguna tabla. */
async function readTables(db: Db): Promise<DatabaseTables> {
  const tables = await readAllTables(db);
  const size = await readSize(db);
  const supabase = SUPABASE_GROUPS.map(({ key, label }) => {
    const inGroup = tables.filter((table) => table.schema !== "public" && groupOf(table.schema) === key);
    return { key, label, totalBytes: inGroup.reduce((total, table) => total + table.totalBytes, 0), tables: inGroup };
  }).filter((group) => group.tables.length > 0);
  const listed = tables.reduce((total, table) => total + table.totalBytes, 0);
  return { app: tables.filter((table) => table.schema === "public"), supabase, otherBytes: Math.max(0, size.sizeBytes - listed) };
}

/**
 * «Qué la hace trabajar», de pg_stat_statements en el esquema donde esté la extensión (en Supabase,
 * `extensions`), sólo de esta base. null: la extensión no está o no está cargada.
 */
async function readWork(db: Db): Promise<DatabaseWork | null> {
  const extension = await one<{ schema: string; hasInfo: boolean }>(
    db,
    `select n.nspname as schema, to_regclass(quote_ident(n.nspname) || '.pg_stat_statements_info') is not null as "hasInfo"
       from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pg_stat_statements'`,
  );
  if (!extension) return null;
  const view = `${quoteIdent(extension.schema)}.pg_stat_statements`;
  const thisDatabase = "s.dbid = (select oid from pg_database where datname = current_database())";
  // El total por cuenta (de todas las consultas) y las CLASSIFIED_QUERIES que más tiempo llevan, con el
  // principio de su texto (para ponerles nombre y separar las del cron).
  const byRole = await many<{ role: string; totalMs: number; calls: number }>(
    db,
    `select pg_get_userbyid(s.userid) as role, sum(s.total_exec_time)::float8 as "totalMs", sum(s.calls)::float8 as calls
       from ${view} s where ${thisDatabase}
      group by 1`,
  );
  const queries = await many<{ role: string; query: string; totalMs: number; calls: number }>(
    db,
    `select pg_get_userbyid(s.userid) as role, left(s.query, $1) as query, s.total_exec_time as "totalMs", s.calls::float8 as calls
       from ${view} s where ${thisDatabase}
      order by s.total_exec_time desc
      limit $2`,
    [QUERY_READ_CHARS, CLASSIFIED_QUERIES],
  );
  const info = extension.hasInfo
    ? await one<{ since: string | null }>(db, `select stats_reset as since from ${quoteIdent(extension.schema)}.pg_stat_statements_info`)
    : null;
  const apiRole = (await one<{ role: string }>(db, "select current_user as role"))!.role;

  const totalMs = byRole.reduce((total, row) => total + row.totalMs, 0);
  const calls = byRole.reduce((total, row) => total + row.calls, 0);
  const share = (ms: number) => (totalMs > 0 ? ms / totalMs : 0);
  const described = queries.map((row) => ({ ...row, ...describeQuery(row.query, row.role, apiRole) }));
  // Por quién: el total de cada cuenta; lo que se reconoce como del cron o del panel de Supabase pasa a ellos.
  const workers = new Map<DatabaseWorker, { totalMs: number; calls: number }>();
  const add = (who: DatabaseWorker, ms: number, count: number) => {
    const current = workers.get(who) ?? { totalMs: 0, calls: 0 };
    workers.set(who, { totalMs: current.totalMs + ms, calls: current.calls + count });
  };
  for (const row of byRole) add(workerOfRole(row.role, apiRole), row.totalMs, row.calls);
  for (const row of described) {
    const byAccount = workerOfRole(row.role, apiRole);
    if (row.who === byAccount) continue;
    add(byAccount, -row.totalMs, -row.calls);
    add(row.who, row.totalMs, row.calls);
  }
  const top: DatabaseQueryStat[] = described.slice(0, TOP_QUERIES).map((row) => ({
    label: row.label,
    text: row.text,
    who: row.who,
    calls: row.calls,
    totalMs: row.totalMs,
    meanMs: row.calls > 0 ? row.totalMs / row.calls : 0,
    share: share(row.totalMs),
  }));
  return {
    since: info?.since ?? null,
    totalMs,
    calls,
    byWho: [...workers.entries()]
      .filter(([, value]) => value.totalMs > 0 || value.calls > 0)
      .map(([who, value]) => ({ who, label: WORKER_LABELS[who], totalMs: value.totalMs, calls: value.calls, share: share(value.totalMs) }))
      .sort((a, b) => b.totalMs - a.totalMs),
    top,
  };
}

/** «Mantenimiento»: escrituras y filas muertas, los índices sin uso y las conexiones (sin su consulta). */
async function readMaintenance(db: Db): Promise<DatabaseMaintenance> {
  const since = await one<{ since: string | null }>(db, "select stats_reset as since from pg_stat_database where datname = current_database()");
  const tables = await many<{ schema: string; name: string; writes: number; liveRows: number; deadRows: number; lastVacuumAt: string | null }>(
    db,
    `select s.schemaname as schema, s.relname as name, (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) as writes,
            s.n_live_tup as "liveRows", s.n_dead_tup as "deadRows", greatest(s.last_vacuum, s.last_autovacuum) as "lastVacuumAt"
       from pg_stat_user_tables s
      order by writes desc, s.n_dead_tup desc, s.relname
      limit $1`,
    [TOP_WRITES],
  );
  // Sin los únicos ni los que sostienen una restricción (p. ej. la que impide dos citas a la misma hora):
  // ésos se usan aunque nunca se lean.
  const unusedIndexes = await many<{ name: string; table: string; bytes: number }>(
    db,
    `select i.indexrelname as name, i.relname as "table", pg_relation_size(i.indexrelid) as bytes
       from pg_stat_user_indexes i join pg_index x on x.indexrelid = i.indexrelid
      where i.schemaname = 'public' and i.idx_scan = 0 and not x.indisunique and not x.indisprimary
        and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      order by bytes desc, name
      limit $1`,
    [MAX_UNUSED_INDEXES],
  );
  // Sólo la cuenta y el estado de cada conexión: nunca la columna `query`.
  const connections = await many<{ role: string; state: string; count: number }>(
    db,
    `select coalesce(a.usename::text, '') as role, coalesce(a.state, 'unknown') as state, count(*)::int as count
       from pg_stat_activity a
      where a.backend_type = 'client backend'
      group by 1, 2
      order by count desc, role, state`,
  );
  const limits = await one<{ max: number; role: string }>(db, "select current_setting('max_connections')::int as max, current_user as role");
  return {
    since: since?.since ?? null,
    tables: tables.map((table) => ({ ...table, label: labelOf(table.schema, table.name) })),
    unusedIndexes: unusedIndexes.map((index) => ({ ...index, tableLabel: TABLE_INFO[index.table]?.label ?? null })),
    connections: {
      total: connections.reduce((total, row) => total + row.count, 0),
      max: limits!.max,
      byRole: connections.map((row) => ({ ...row, who: workerOfRole(row.role, limits!.role) })),
    },
  };
}

/** Los últimos HISTORY_DAYS días del historial (hasta `today`, en Ecuador), del más viejo al más nuevo. */
async function readHistory(db: Db, today: string): Promise<DatabaseHistoryPoint[]> {
  return many<DatabaseHistoryPoint>(
    db,
    `select day, size_bytes as "sizeBytes", files_bytes as "filesBytes"
       from database_stats
      where day > $1::date - $2::int and day <= $1::date
      order by day`,
    [today, HISTORY_DAYS],
  );
}

/**
 * «A este ritmo, se llena en…» (spec 024): con PROJECTION_MIN_DAYS fotos o más, una regresión lineal
 * simple del tamaño por día (mínimos cuadrados, con los días reales entre fotos). Los meses se cuentan
 * desde la última foto: 0 si ya llegó, null si no crece. null: faltan días.
 */
export function projectGrowth(history: DatabaseHistoryPoint[], limitBytes: number): DatabaseProjection | null {
  if (history.length < PROJECTION_MIN_DAYS) return null;
  const xs = history.map((point) => daysBetween(history[0].day, point.day));
  const ys = history.map((point) => point.sizeBytes);
  const meanX = xs.reduce((total, x) => total + x, 0) / xs.length;
  const meanY = ys.reduce((total, y) => total + y, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sxx === 0) return null;
  const bytesPerMonth = (sxy / sxx) * DAYS_PER_MONTH;
  const last = ys[ys.length - 1];
  const monthsTo = (target: number) => (last >= target ? 0 : bytesPerMonth > 0 ? (target - last) / bytesPerMonth : null);
  return { days: history.length, bytesPerMonth, monthsTo70: monthsTo(limitBytes * WARN_SHARE), monthsToFull: monthsTo(limitBytes) };
}

/* ---------------------------------------------------------- La foto del cron ---- */

/** Lo que hizo una pasada del cron con la foto del tamaño (para su registro: sólo la cifra). */
export interface DatabaseStatsRefresh {
  /** saved: guardó la de hoy · ready: ya estaba · early: antes de las 06:00 de Ecuador · failed: falló. */
  status: "saved" | "ready" | "early" | "failed";
  /** El tamaño de la base en la foto guardada (null si no guardó ninguna). */
  sizeBytes: number | null;
  /** Fotos de más de DATABASE_STATS_KEEP_DAYS días borradas en esta pasada. */
  purged: number;
}

/**
 * La foto de cada mañana (spec 024): después de las 06:00 de Ecuador, si falta la de hoy, guarda el
 * tamaño de la base, el de los archivos (null si no se pueden medir) y las SNAPSHOT_TABLES tablas que más
 * ocupan, y borra las de más de 400 días. Una sola vez por día: las demás pasadas ven que ya está.
 */
export async function saveDailyDatabaseStats(options: { now?: Date } = {}): Promise<DatabaseStatsRefresh> {
  const now = options.now ?? new Date();
  const zoned = getZonedNow(DEFAULT_TIMEZONE, now);
  if (zoned.minutes < DATABASE_STATS_HOUR * 60) return { status: "early", sizeBytes: null, purged: 0 };
  if (await one(pool, "select 1 from database_stats where day = $1", [zoned.date])) return { status: "ready", sizeBytes: null, purged: 0 };
  const saved = await transaction(async (db) => {
    await db.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const size = await readSize(db);
    const files = await section(db, "los archivos", () => readFiles(db));
    const tables = (await readAllTables(db))
      .slice(0, SNAPSHOT_TABLES)
      .map((table) => ({ schema: table.schema, name: table.name, bytes: table.totalBytes }));
    const filesBytes = files && !("error" in files) ? files.totalBytes : null;
    const row = await one<{ sizeBytes: number }>(
      db,
      `insert into database_stats (day, size_bytes, files_bytes, tables) values ($1, $2, $3, $4)
       on conflict (day) do nothing
       returning size_bytes as "sizeBytes"`,
      [zoned.date, size.sizeBytes, filesBytes, JSON.stringify(tables)],
    );
    return row?.sizeBytes ?? null;
  });
  const purged = await pool.query("delete from database_stats where day < $1::date - $2::int", [zoned.date, DATABASE_STATS_KEEP_DAYS]);
  return { status: saved === null ? "ready" : "saved", sizeBytes: saved, purged: purged.rowCount ?? 0 };
}

/* ------------------------------------------------------------- La API ---- */

export const databaseStatsService = {
  /**
   * GET /api/admin/database: sólo el super admin principal (los demás super admins y cualquier otra
   * cuenta, 403). Se calcula al abrir la pantalla, en una transacción de sólo lectura. Ver la pantalla no
   * va a la actividad: es una consulta.
   */
  async get(ctx: RequestContext): Promise<DatabaseStats> {
    authorizeSuperAdmin(ctx);
    if (!requireUser(ctx).platformOwner) throw new AppError("forbidden", "Sólo el super admin principal ve la base de datos.");
    const today = getZonedNow(DEFAULT_TIMEZONE).date;
    return readOnly(async (db) => {
      const size = (await section(db, "el tamaño", () => readSize(db)))!;
      const files = await section(db, "los archivos", () => readFiles(db));
      const tables = (await section(db, "las tablas", () => readTables(db)))!;
      const work = await section(db, "las consultas", () => readWork(db), [NOT_LOADED]);
      const maintenance = (await section(db, "el mantenimiento", () => readMaintenance(db)))!;
      const history = (await section(db, "el historial", () => readHistory(db, today)))!;
      const projection = Array.isArray(history) ? projectGrowth(history, config.databaseLimitBytes) : null;
      return { computedAt: new Date().toISOString(), size, files, tables, work, maintenance, history, projection };
    });
  },
};
