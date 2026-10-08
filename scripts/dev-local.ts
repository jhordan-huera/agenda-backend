/**
 * `npm run dev:local`: la API con una base de datos PostgreSQL EN ESTE EQUIPO y los datos demo, para
 * probar sin tocar Supabase ni Vercel. La base vive en .local-db/ (no se sube a git), se conserva
 * entre arranques y se detiene al salir (Ctrl+C).
 *
 *   npm run dev:local              # la primera vez crea la base y carga la demo
 *   npm run dev:local -- --reset   # borra los datos y vuelve a cargar la demo
 *
 *   npm run dev:local -- --recordatorios   # también los recordatorios automáticos de las citas demo
 *
 * Cada arranque aplica las migraciones nuevas: así una migración se prueba aquí antes de aplicarla
 * en producción. Del .env sólo lee la cuenta de Gmail (nunca la base, Supabase ni el CAPTCHA): con
 * ella los emails se envían de verdad, pero TODOS a tu propio correo (EMAIL_REDIRECT_TO o, si no,
 * GMAIL_USER), con el destinatario original en el asunto ("[Para maria@…]"). Sin ella quedan en
 * cola y se ven en el historial de emails del panel.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { findPostgresBin } from "./postgres-bin.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, ".local-db");
const DATA = join(DIR, "data");
const DB_PORT = 54329;
const API_PORT = 4000; // el proxy de agenda-front (npm run dev) apunta aquí
const reset = process.argv.includes("--reset");
// Los recordatorios de las citas demo son unos 20 al día: sólo si se piden.
const reminders = process.argv.includes("--recordatorios");

/** La cuenta de Gmail de .env (nada más) y el correo al que van todos los emails de prueba. */
const GMAIL_VARS = ["GMAIL_USER", "GMAIL_FROM_NAME", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
const dotEnv = existsSync(join(ROOT, ".env")) ? parseEnv(readFileSync(join(ROOT, ".env"), "utf8")) : {};
const gmail = Object.fromEntries(GMAIL_VARS.filter((name) => dotEnv[name]).map((name) => [name, dotEnv[name]]));
// Nunca a los destinatarios reales: "off" no vale aquí.
const testInbox = dotEnv.EMAIL_REDIRECT_TO && dotEnv.EMAIL_REDIRECT_TO !== "off" ? dotEnv.EMAIL_REDIRECT_TO : dotEnv.GMAIL_USER;
const sendEmails = Boolean(testInbox && ["GMAIL_USER", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"].every((name) => gmail[name]));

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (await portInUse(API_PORT)) {
  console.error(`✗ El puerto ${API_PORT} ya está en uso: ¿tienes abierto \`npm run dev\`? Detenlo (Ctrl+C) y vuelve a intentarlo.`);
  process.exit(1);
}

const pgBin = findPostgresBin();
if (!pgBin) {
  console.error("✗ No encontré PostgreSQL (initdb). Instálalo con: brew install postgresql@16");
  process.exit(1);
}
const pg = (tool: string, args: string[]) =>
  execFileSync(join(pgBin, tool), args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const sql = (query: string, database = "agenda") =>
  pg("psql", ["-h", "127.0.0.1", "-p", String(DB_PORT), "-U", "postgres", "-d", database, "-tAc", query]).trim();

if (!existsSync(DATA)) {
  console.info("Creando la base de datos local en .local-db/ …");
  mkdirSync(DIR, { recursive: true });
  pg("initdb", ["-D", DATA, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"]);
}

let startedHere = false;
try {
  pg("pg_ctl", ["-D", DATA, "status"]);
} catch {
  // Sin socket Unix (sólo TCP en 127.0.0.1): la ruta del proyecto puede superar el límite de longitud.
  pg("pg_ctl", ["-D", DATA, "-o", `-p ${DB_PORT} -c unix_socket_directories=''`, "-l", join(DIR, "postgres.log"), "-w", "start"]);
  startedHere = true;
}

function stopDatabase(): void {
  if (!startedHere) return;
  startedHere = false;
  try {
    pg("pg_ctl", ["-D", DATA, "-m", "fast", "-w", "stop"]);
    console.info("Base de datos local detenida.");
  } catch {
    // Ya estaba detenida.
  }
}

const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TERM: process.env.TERM,
  NODE_ENV: "development",
  DATABASE_URL: `postgresql://postgres@127.0.0.1:${DB_PORT}/agenda`,
  DATABASE_SSL: "false",
  PORT: String(API_PORT),
  FRONTEND_URL: "http://localhost:5173",
  LOCAL_STORAGE_DIR: join(DIR, "archivos"),
  REMINDER_JOB_INTERVAL_MINUTES: reminders ? "5" : "0",
  ...(sendEmails ? { ...gmail, EMAIL_REDIRECT_TO: testInbox } : {}),
};
const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });

try {
  if (sql("select 1 from pg_database where datname = 'agenda'", "postgres") !== "1") {
    pg("createdb", ["-h", "127.0.0.1", "-p", String(DB_PORT), "-U", "postgres", "agenda"]);
  }
  node(["src/db/migrate.ts"]);
  if (reset || sql("select count(*) from users") === "0") {
    console.info(reset ? "Borrando los datos y cargando la demo…" : "Cargando los datos demo…");
    node(["src/db/seed.ts", "--reset"]);
  }
  if (sendEmails) {
    // Lo que quedó en cola de otras sesiones no se envía de golpe: sólo lo de esta sesión.
    const skipped = sql(
      `with skipped as (
         update notifications set status = 'failed', last_error = 'No enviado: estaba en cola antes de arrancar (pruebas en local)'
          where status = 'queued' returning 1)
       select count(*) from skipped`,
    );
    if (skipped !== "0") console.info(`(${skipped} emails que estaban en cola de antes no se enviarán)`);
  }
} catch (error) {
  console.error("✗ No se pudo preparar la base de datos local:", error instanceof Error ? error.message : error);
  stopDatabase();
  process.exit(1);
}

console.info(`
  Base de datos LOCAL (.local-db/): nada de lo que hagas aquí llega a producción.
  Arranca el frontend (npm run dev en agenda-front) y abre http://localhost:5173
  Cuentas demo, contraseña demo1234: jhordan@demo.com (propietario) · admin@demo.com (super admin)
  Para empezar de cero: npm run dev:local -- --reset
  Emails: ${sendEmails ? `se envían de verdad, TODOS a ${testInbox} (con el destinatario en el asunto)` : "sin la cuenta de Gmail en .env, quedan en cola (historial de emails del panel)"}
  Recordatorios automáticos de las citas demo: ${reminders ? "activados" : "apagados (npm run dev:local -- --recordatorios para probarlos)"}
`);

const api = spawn(process.execPath, ["--watch", "src/server.ts"], { cwd: ROOT, env, stdio: "inherit" });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => {
  stopDatabase();
  process.exit(stopping ? 0 : (code ?? 1));
});
