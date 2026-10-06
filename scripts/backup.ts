/**
 * Copia de seguridad semanal de la base de datos (la ejecuta .github/workflows/backup.yml). El plan
 * gratis de Supabase no hace copias: si se pierde la base, ésta es la única forma de recuperarla.
 *
 * 1. pg_dump del esquema public (todas las tablas de la aplicación, con su estructura y datos).
 * 2. Comprobación: la restaura en una base vacía de prueba (RESTORE_CHECK_URL) y compara las filas
 *    de cada tabla. Una copia que no se puede restaurar no sirve.
 * 3. La comprime y cifra con BACKUP_PASSPHRASE (scripts/backup-crypto.ts).
 * 4. La envía como adjunto a BACKUP_EMAIL por Gmail (o, con --out <carpeta>, la guarda ahí).
 * 5. Avisa por ntfy: sin sonido si salió bien, urgente si falló.
 *
 * Los archivos de la historia clínica (Supabase Storage) no van en la copia: sólo la base.
 * Los registros de Actions son públicos: aquí sólo se imprimen tamaños, nunca datos ni la URL.
 *
 * Variables: DATABASE_URL (o BACKUP_DATABASE_URL), DATABASE_SSL, BACKUP_PASSPHRASE, BACKUP_EMAIL,
 * GMAIL_*, RESTORE_CHECK_URL (opcional), PG_DUMP y PSQL (rutas, por defecto las del PATH), NTFY_*.
 *
 * Uso: node scripts/backup.ts [--out <carpeta>]
 * Recuperar una copia: npm run backup:decrypt -- <archivo>
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";
import { decryptBackup, encryptBackup, MIN_PASSPHRASE_LENGTH } from "./backup-crypto.ts";
import { env, notify } from "./notify.ts";

/** Gmail admite adjuntos de hasta 25 MB (con la codificación base64, unos 18 MB de archivo). */
const MAX_EMAIL_BYTES = 18 * 1024 * 1024;
/** Por encima, el aviso recomienda pasar a otro almacenamiento antes de llegar al límite. */
const WARN_EMAIL_BYTES = 10 * 1024 * 1024;
const TIMEZONE = "America/Guayaquil";

class BackupError extends Error {
  /** true: la copia se entregó igual (el fallo fue en la comprobación). */
  readonly delivered: boolean;

  constructor(message: string, delivered = false) {
    super(message);
    this.delivered = delivered;
  }
}

/** Sin URL, servidor ni usuario de la base: los mensajes pueden acabar en el registro público. */
export function scrub(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[url]")
    .replace(/postgres\.[a-z0-9]+/gi, "postgres.[proyecto]")
    .replace(/[a-z0-9.-]+\.supabase\.(?:com|co)/gi, "[servidor]")
    .replace(/password=\S+/gi, "password=[oculta]");
}

/**
 * pg_dump no funciona con el pooler de Supabase en modo transacción (puerto 6543): se usa el
 * modo sesión (5432) del mismo servidor y usuario.
 */
export function dumpUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") url.port = "5432";
  if (env("DATABASE_SSL") === "true" && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return url.toString();
}

function run(command: string, args: string[], input?: string): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) =>
      fail(new BackupError(`No se pudo ejecutar ${command}: ${error.message}. ¿Está instalado el cliente de PostgreSQL?`)),
    );
    child.on("close", (code) => done({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

async function dumpDatabase(databaseUrl: string): Promise<string> {
  const { code, stdout, stderr } = await run(env("PG_DUMP") ?? "pg_dump", [
    `--dbname=${dumpUrl(databaseUrl)}`,
    "--schema=public",
    "--no-owner",
    "--no-privileges",
    "--encoding=UTF8",
  ]);
  if (code !== 0) throw new BackupError(`pg_dump falló: ${scrub(stderr.trim()).slice(0, 400) || `código ${code}`}`);
  const header = [
    `-- Copia de seguridad de Agenda360 (esquema public) · ${new Date().toISOString()}`,
    "-- Restaurar en una base de datos VACÍA: psql \"<url de la base>\" -f <este archivo>",
    "",
    // pg_dump --schema no incluye las extensiones; la restricción de citas solapadas necesita ésta.
    "CREATE EXTENSION IF NOT EXISTS btree_gist;",
    "",
  ].join("\n");
  return header + stdout.toString("utf8");
}

/** Filas de cada tabla según los bloques COPY del volcado (una línea por fila). */
export function countCopyRows(sql: string): Map<string, number> {
  const counts = new Map<string, number>();
  let table: string | null = null;
  let rows = 0;
  for (const line of sql.split("\n")) {
    if (table === null) {
      const match = /^COPY (\S+) \(.*\) FROM stdin;$/.exec(line);
      if (match) {
        table = match[1];
        rows = 0;
      }
    } else if (line === "\\.") {
      counts.set(table, rows);
      table = null;
    } else {
      rows++;
    }
  }
  return counts;
}

/** Errores de psql esperables al restaurar en una base nueva (ya trae el esquema public). */
const HARMLESS_RESTORE_ERRORS = [/^schema "public" already exists$/, /^extension "[^"]+" already exists$/];

interface RestoreCheck {
  /** Errores esperables de psql (no afectan a la copia). */
  warnings: string[];
  /** Lo que salió mal: filas que faltan o errores al crear tablas, restricciones, funciones… */
  problems: string[];
}

/**
 * Restaura el volcado en una base vacía y compara las filas de cada tabla. Cualquier error de
 * psql fuera de los esperables (p. ej. una restricción que no se pudo crear) es un problema,
 * aunque estén todas las filas.
 */
async function verifyRestore(sql: string, counts: Map<string, number>, checkUrl: string): Promise<RestoreCheck> {
  const db = new pg.Client({ connectionString: checkUrl });
  await db.connect();
  try {
    const existing = await db.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    if (existing.rows[0].n > 0) {
      throw new BackupError("La base de comprobación (RESTORE_CHECK_URL) no está vacía: por seguridad no se restaura en ella.");
    }
    const { stderr } = await run(env("PSQL") ?? "psql", ["-X", "-q", "-v", "ON_ERROR_STOP=0", `--dbname=${checkUrl}`, "-f", "-"], sql);
    const errors = stderr
      .split("\n")
      .filter((line) => line.includes("ERROR:"))
      .map((line) => scrub(line.replace(/^.*?ERROR:\s*/, "").trim()));
    const warnings = errors.filter((error) => HARMLESS_RESTORE_ERRORS.some((pattern) => pattern.test(error)));
    const problems = errors.filter((error) => !warnings.includes(error)).map((error) => `Error de psql: ${error}`);
    for (const [table, expected] of counts) {
      const restored = await db.query(`select count(*)::int as n from ${table}`).then(
        (result) => result.rows[0].n as number,
        () => null,
      );
      if (restored !== expected) problems.push(`${table}: ${restored ?? "no existe"} filas de ${expected}`);
    }
    return { warnings, problems };
  } finally {
    await db.end();
  }
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());

async function sendByEmail(file: Buffer, fileName: string, summary: string[]): Promise<string> {
  const to = env("BACKUP_EMAIL");
  if (!to) throw new BackupError("Falta BACKUP_EMAIL: la dirección que recibe las copias.");
  const { config } = await import("../src/config.ts");
  if (!config.gmail) throw new BackupError("Faltan las credenciales de Gmail (GMAIL_*): no se puede enviar la copia.");
  if (file.length > MAX_EMAIL_BYTES) {
    throw new BackupError(
      `La copia cifrada pesa ${formatSize(file.length)} y Gmail no admite adjuntos tan grandes: hay que guardar las copias en otro sitio.`,
    );
  }
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { type: "OAuth2", user: config.gmail.user, clientId: config.gmail.clientId, clientSecret: config.gmail.clientSecret, refreshToken: config.gmail.refreshToken },
  });
  const recipient = config.emailRedirectTo ?? to;
  try {
    await transporter.sendMail({
      from: { name: config.gmail.fromName, address: config.gmail.user },
      to: recipient,
      subject: `Copia de seguridad de Agenda360 · ${today()}`,
      text: [
        "Adjunta va la copia de seguridad semanal de la base de datos de Agenda360, cifrada.",
        "",
        ...summary,
        "",
        "Para recuperarla:",
        "1. Guarda el adjunto en la carpeta agenda-backend de tu ordenador.",
        `2. Ejecuta: npm run backup:decrypt -- ${fileName}`,
        "   (usa la clave BACKUP_PASSPHRASE de tu .env o te la pide).",
        "3. Restaura el .sql resultante en una base de datos VACÍA (ver el README, «Copias de seguridad»).",
        "",
        "Sin la clave nadie puede abrir la copia, tampoco Google. Si pierdes la clave, las copias no sirven:",
        "guárdala también en tu gestor de contraseñas.",
      ].join("\n"),
      attachments: [{ filename: fileName, content: file, contentType: "application/octet-stream" }],
    });
  } finally {
    transporter.close();
  }
  return recipient;
}

/** Base de 500 MB del plan gratis de Supabase: se avisa con margen antes de llenarla. */
const DATABASE_LIMIT_MB = 500;
const DATABASE_WARN_MB = Number(env("DATABASE_WARN_MB") ?? 350);

/** Tamaño de la base en bytes (null si no se pudo leer: no impide la copia). */
async function databaseSize(databaseUrl: string): Promise<number | null> {
  // Supabase exige SSL (con su propia CA); la base local de las pruebas, no.
  const ssl = env("DATABASE_SSL") === "false" ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: databaseUrl, ssl });
  try {
    await client.connect();
    const result = await client.query<{ bytes: string }>("select pg_database_size(current_database()) as bytes");
    return Number(result.rows[0]?.bytes ?? 0);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex === -1 ? null : process.argv[outIndex + 1];
  if (outIndex !== -1 && !outDir) throw new BackupError("Uso: node scripts/backup.ts --out <carpeta>");
  const passphrase = env("BACKUP_PASSPHRASE");
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupError(`Falta BACKUP_PASSPHRASE (la clave de las copias, mínimo ${MIN_PASSPHRASE_LENGTH} caracteres).`);
  }
  const databaseUrl = env("BACKUP_DATABASE_URL") ?? env("DATABASE_URL");
  if (!databaseUrl) throw new BackupError("Falta DATABASE_URL.");

  const started = Date.now();
  const sql = await dumpDatabase(databaseUrl);
  const counts = countCopyRows(sql);
  if (counts.size === 0) throw new BackupError("El volcado no tiene ninguna tabla: algo va mal con la conexión o el esquema.");
  const totalRows = [...counts.values()].reduce((sum, rows) => sum + rows, 0);

  const checkUrl = env("RESTORE_CHECK_URL");
  const check = checkUrl ? await verifyRestore(sql, counts, checkUrl) : null;

  const file = encryptBackup(sql, passphrase);
  // Antes de enviarla: que se pueda descifrar y quede idéntica.
  if (decryptBackup(file, passphrase) !== sql) throw new BackupError("La copia cifrada no coincide con el volcado.");
  const fileName = `agenda360-${today()}.sql.gz.enc`;

  const sizeBytes = await databaseSize(databaseUrl);
  const sizeMb = sizeBytes === null ? null : sizeBytes / 1024 / 1024;
  const databaseFull = sizeMb !== null && sizeMb >= DATABASE_WARN_MB;
  const key = (table: string) => counts.get(`public.${table}`) ?? 0;
  const summary = [
    `Tablas: ${counts.size} · filas: ${totalRows} (negocios ${key("businesses")}, clientes ${key("clients")}, citas ${key("appointments")}, evoluciones clínicas ${key("clinical_notes")}).`,
    `Tamaño: ${formatSize(file.length)} cifrada.`,
    sizeMb === null
      ? "No se pudo leer el tamaño de la base."
      : `Base de datos: ${Math.round(sizeMb)} MB de ${DATABASE_LIMIT_MB} MB del plan gratis de Supabase.`,
    check === null
      ? "Sin comprobación de restauración (falta RESTORE_CHECK_URL)."
      : check.problems.length === 0
        ? "Comprobada: se restauró en una base de prueba con la estructura completa y todas las filas."
        : `ATENCIÓN: al restaurarla en una base de prueba hubo problemas: ${check.problems.slice(0, 5).join(" | ")}`,
  ];

  let destination: string;
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    destination = resolve(join(outDir, fileName));
    await writeFile(destination, file, { mode: 0o600 });
  } else {
    destination = `email a ${await sendByEmail(file, fileName, summary)}`;
  }

  // Registro público: sólo el tamaño, el resultado y los mensajes de psql (nombres de objetos, sin datos).
  const verdict = check === null ? "sin comprobar" : check.problems.length === 0 ? "restauración comprobada" : "restauración con PROBLEMAS";
  console.info(`Copia de seguridad: ${formatSize(file.length)} cifrada · ${verdict} · ${Date.now() - started} ms`);
  if (outDir) console.info(`Guardada en ${destination}`);
  for (const line of [...(check?.problems ?? []), ...(check?.warnings ?? []).map((warning) => `(esperable) ${warning}`)].slice(0, 10)) {
    console.info(`  - ${line}`);
  }
  // La copia se entrega igual (mejor una copia con un defecto que ninguna), pero el trabajo falla y avisa.
  if (check && check.problems.length > 0) {
    throw new BackupError(
      `La copia se ${outDir ? "guardó" : "envió"}, pero al restaurarla en una base de prueba hubo problemas: ${check.problems.slice(0, 5).join(" | ")}`,
      true,
    );
  }
  await notify({
    title: "Agenda360: copia de seguridad hecha",
    message: [
      ...summary,
      `Destino: ${outDir ? "archivo local" : destination}.`,
      ...(file.length > WARN_EMAIL_BYTES
        ? ["", `La copia se acerca al límite de adjuntos de Gmail (${formatSize(MAX_EMAIL_BYTES)}): conviene pasar a otro almacenamiento.`]
        : []),
      ...(databaseFull
        ? ["", `La base pasa de ${DATABASE_WARN_MB} MB: conviene revisar qué ocupa espacio o pasar a un plan de pago de Supabase antes de llegar a ${DATABASE_LIMIT_MB} MB.`]
        : []),
    ].join("\n"),
    priority: file.length > WARN_EMAIL_BYTES || databaseFull ? 4 : 2,
    tags: ["floppy_disk"],
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const reason = scrub(error instanceof Error ? error.message : String(error));
    console.error(`✗ ${reason}`);
    const delivered = error instanceof BackupError && error.delivered;
    await notify({
      title: delivered ? "Agenda360: la copia de seguridad tiene problemas" : "Agenda360: la copia de seguridad falló",
      message: `${reason}\n\n${delivered ? "" : "Hoy no hay copia nueva. "}Revisa la ejecución en GitHub → Actions → Copia de seguridad.`,
      priority: 5,
      tags: ["rotating_light"],
    }).catch((notifyError) => console.error("No se pudo avisar por ntfy:", scrub(String(notifyError))));
    process.exitCode = 1;
  }
}
