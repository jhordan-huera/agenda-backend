// Copia de seguridad: volcado, restauración de prueba, cifrado, descifrado y protecciones.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { countCopyRows, dumpUrl, scrub } from "../scripts/backup.ts";

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};

const source = process.env.TEST_DATABASE_URL!;
const db = new pg.Pool({ connectionString: source });
const checkDb = "agenda_restore_check";
await db.query(`drop database if exists ${checkDb}`);
await db.query(`create database ${checkDb}`);
const checkUrl = source.replace(/\/[^/]+$/, `/${checkDb}`);
const dir = mkdtempSync(join(tmpdir(), "agenda-backup-"));
const PASSPHRASE = "clave-de-prueba-larga-0123456789";

const backup = (extraEnv: Record<string, string | undefined>, args = ["--out", dir]) =>
  spawnSync(process.execPath, ["scripts/backup.ts", ...args], {
    env: { ...process.env, BACKUP_PASSPHRASE: PASSPHRASE, NTFY_TOPIC: "", ...extraEnv },
    encoding: "utf8",
  });
const decrypt = (file: string, output?: string, passphrase = PASSPHRASE, extraEnv: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["scripts/decrypt-backup.ts", file, ...(output ? [output] : [])], {
    env: { ...process.env, BACKUP_PASSPHRASE: passphrase, ...extraEnv },
    encoding: "utf8",
    input: "",
  });
const ROOT = new URL("..", import.meta.url).pathname;

try {
  console.log("Copia comprobada");
  let r = backup({ RESTORE_CHECK_URL: checkUrl });
  const firstRun = r.stdout;
  ok(r.status === 0 && /restauración comprobada/.test(r.stdout), "hace la copia y la restaura en una base vacía de prueba", r.stdout + r.stderr);
  ok(!/postgres(ql)?:\/\//.test(r.stdout + r.stderr), "el registro no muestra la URL de la base");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql.gz.enc"));
  ok(files.length === 1 && /^agenda360-\d{4}-\d{2}-\d{2}\.sql\.gz\.enc$/.test(files[0]), "archivo con la fecha", files);
  const file = join(dir, files[0]);
  const raw = readFileSync(file);
  ok(raw.subarray(0, 18).toString() === "AGENDA360-BACKUP-1" && !raw.includes("COPY public"), "va cifrado (no se lee el SQL)");

  const restored = new pg.Pool({ connectionString: checkUrl });
  const tables = ["businesses", "users", "clients", "appointments", "audit_logs", "clinical_templates", "schema_migrations"];
  const mismatched: string[] = [];
  for (const table of tables) {
    const [a, b] = await Promise.all(
      [db, restored].map(async (pool) => (await pool.query(`select count(*)::int as n from public.${table}`)).rows[0].n as number),
    );
    if (a !== b || a === 0) mismatched.push(`${table}: ${a} vs ${b}`);
  }
  ok(mismatched.length === 0, "la base restaurada tiene las mismas filas que la original", mismatched);
  const overlap = await restored.query(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'appointments_no_overlap'",
  );
  ok(overlap.rowCount === 1, "con la estructura completa (p. ej. la restricción de citas solapadas)", firstRun);
  await restored.end();

  console.log("Descifrar");
  const sqlPath = join(dir, "copia.sql");
  r = decrypt(file, sqlPath);
  ok(r.status === 0 && existsSync(sqlPath), "npm run backup:decrypt la descifra", r.stdout + r.stderr);
  const sql = readFileSync(sqlPath, "utf8");
  ok(sql.startsWith("-- Copia de seguridad de Agenda360") && sql.includes("COPY public.appointments"), "y queda el volcado SQL");
  const counts = countCopyRows(sql);
  const users = (await db.query("select count(*)::int as n from users")).rows[0].n;
  ok(counts.get("public.users") === users && counts.size > 20, "con todas las tablas y filas", { tables: counts.size, users });
  // Sin salida: fuera del repositorio, en ~/Agenda360-copias (sólo para este usuario).
  const home = join(dir, "casa");
  r = decrypt(file, undefined, PASSPHRASE, { HOME: home });
  const defaultCopy = join(home, "Agenda360-copias", files[0].replace(/\.gz\.enc$/, ""));
  ok(r.status === 0 && existsSync(defaultCopy), "por defecto la deja en ~/Agenda360-copias", r.stdout + r.stderr);
  ok(
    (statSync(join(home, "Agenda360-copias")).mode & 0o777) === 0o700 && (statSync(defaultCopy).mode & 0o777) === 0o600,
    "carpeta 700 y archivo 600",
  );
  const insideRepo = join(ROOT, "agenda360-prueba-descifrada.sql");
  r = decrypt(file, insideRepo);
  ok(r.status === 1 && /dentro del repositorio/.test(r.stderr) && !existsSync(insideRepo), "se niega a dejarla dentro del repositorio", r.stderr);
  r = decrypt(file, join(ROOT, "db", "copia.sql"));
  ok(r.status === 1 && !existsSync(join(ROOT, "db", "copia.sql")), "ni en una subcarpeta del repositorio", r.stderr);
  rmSync(insideRepo, { force: true });

  r = decrypt(file, join(dir, "mala.sql"), "otra-clave-cualquiera-123456");
  ok(r.status === 1 && /clave no es correcta/.test(r.stderr) && !existsSync(join(dir, "mala.sql")), "con otra clave no se abre", r.stderr);
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 10] ^= 1;
  writeFileSync(join(dir, "alterada.enc"), tampered);
  r = decrypt(join(dir, "alterada.enc"), join(dir, "alterada.sql"));
  ok(r.status === 1 && /dañado/.test(r.stderr), "un archivo alterado se detecta", r.stderr);

  console.log("Protecciones");
  r = backup({ RESTORE_CHECK_URL: checkUrl });
  ok(r.status === 1 && /no está vacía/.test(r.stderr), "nunca restaura en una base que ya tiene datos", r.stderr);
  r = backup({ RESTORE_CHECK_URL: source });
  ok(r.status === 1 && /no está vacía/.test(r.stderr), "ni por error en la base original", r.stderr);
  r = backup({ BACKUP_PASSPHRASE: "corta" });
  ok(r.status === 1 && /BACKUP_PASSPHRASE/.test(r.stderr), "exige una clave larga", r.stderr);
  r = backup({ BACKUP_EMAIL: "copias@example.com", GMAIL_USER: "" }, []);
  ok(r.status === 1 && /credenciales de Gmail/.test(r.stderr), "sin --out la envía por Gmail (y avisa si faltan las credenciales)", r.stderr);
  r = backup({ DATABASE_URL: "postgresql://postgres:secreta@db.abcdefgh.supabase.co:5432/postgres", PG_DUMP: "pg_dump" });
  ok(r.status === 1 && !/secreta|abcdefgh/.test(r.stdout + r.stderr), "si pg_dump falla, el error no muestra la URL ni el proyecto", r.stderr);

  // Un psql que da un error y no restaura nada: la copia se guarda igual, pero el trabajo falla.
  const fakePsql = join(dir, "psql-roto.sh");
  writeFileSync(fakePsql, "#!/bin/sh\ncat > /dev/null\necho 'psql:<stdin>:99: ERROR:  algo salió mal' >&2\n", { mode: 0o755 });
  await db.query(`drop database ${checkDb} with (force)`);
  await db.query(`create database ${checkDb}`);
  rmSync(file);
  r = backup({ RESTORE_CHECK_URL: checkUrl, PSQL: fakePsql });
  ok(
    r.status === 1 && /se guardó, pero/.test(r.stderr) && /algo salió mal/.test(r.stderr) && existsSync(file),
    "si la restauración de prueba falla, guarda la copia igual pero el trabajo falla y avisa",
    r.stdout + r.stderr,
  );

  console.log("Conexión");
  ok(
    dumpUrl("postgresql://postgres.ref:clave@aws-0-us-west-2.pooler.supabase.com:6543/postgres").includes(
      "pooler.supabase.com:5432/",
    ),
    "usa el modo sesión del pooler de Supabase (pg_dump no funciona en el 6543)",
  );
  const previousSsl = process.env.DATABASE_SSL;
  process.env.DATABASE_SSL = "true";
  try {
    const verified = new URL(dumpUrl("postgresql://postgres.ref:clave@aws-0-us-west-2.pooler.supabase.com:6543/postgres", "/tmp/ca/supabase-ca.crt"));
    ok(
      verified.searchParams.get("sslmode") === "verify-full" && verified.searchParams.get("sslrootcert") === "/tmp/ca/supabase-ca.crt",
      "con SSL, pg_dump comprueba el certificado de Supabase y el nombre del servidor (verify-full)",
      verified.search,
    );
    const other = new URL(dumpUrl("postgresql://u:c@db.otro-proveedor.com:5432/postgres", "/tmp/ca/supabase-ca.crt"));
    ok(other.searchParams.get("sslrootcert") === "system", "otro proveedor: los certificados del sistema", other.search);
    ok(new URL(dumpUrl("postgresql://u:c@127.0.0.1:5432/postgres")).searchParams.get("sslmode") === "require", "este equipo: cifrada sin comprobar");
  } finally {
    if (previousSsl === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = previousSsl;
  }
  ok(
    scrub("connection to server at \"aws-0-us-west-2.pooler.supabase.com\" failed: FATAL: password authentication failed for user \"postgres.owrmbz\"") ===
      'connection to server at "[servidor]" failed: FATAL: password authentication failed for user "postgres.[proyecto]"',
    "oculta servidor y proyecto en los mensajes",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
  await db.query(`drop database if exists ${checkDb} with (force)`);
  await db.end();
}

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
