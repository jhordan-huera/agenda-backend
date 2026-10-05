/**
 * Pruebas de integración: levantan la API contra una base de datos PostgreSQL DESECHABLE,
 * cargan los datos demo antes de cada suite (tests/*.test.*) y arrancan un servidor nuevo
 * para cada una (así los límites por IP empiezan de cero).
 *
 *   npm test                  # todas las suites
 *   npm test -- cedula cron   # sólo las que contienen esos nombres
 *
 * Base de datos: TEST_DATABASE_URL o, si no está, un PostgreSQL temporal creado con initdb
 * (en macOS: brew install postgresql@16). Nunca lee .env ni usa DATABASE_URL: la carga de
 * datos demo BORRA todas las tablas.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const filters = process.argv.slice(2);

/** Carpeta con initdb/pg_ctl/psql: PG_BIN, pg_config o las rutas habituales. */
function findPostgresBin(): string | null {
  const candidates = [
    process.env.PG_BIN,
    (() => {
      try {
        return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
      } catch {
        return undefined;
      }
    })(),
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/lib/postgresql/16/bin",
  ];
  return candidates.find((dir) => dir && existsSync(join(dir, "initdb"))) ?? null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

const run = (command: string, args: string[], env: NodeJS.ProcessEnv) =>
  execFileSync(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

const pgBin = findPostgresBin();
let tempCluster: { dir: string } | null = null;
let databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl) {
  if (/supabase/i.test(databaseUrl) || databaseUrl === process.env.DATABASE_URL) {
    console.error("TEST_DATABASE_URL apunta a una base real: las pruebas borran todas las tablas. Usa una desechable.");
    process.exit(1);
  }
} else {
  if (!pgBin) {
    console.error("No encontré PostgreSQL (initdb). Instálalo (brew install postgresql@16) o define TEST_DATABASE_URL.");
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), "agendo-test-"));
  const port = await freePort();
  run(join(pgBin, "initdb"), ["-D", join(dir, "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], process.env);
  // Sin socket Unix: la ruta de la carpeta temporal puede superar el límite de longitud.
  run(join(pgBin, "pg_ctl"), ["-D", join(dir, "data"), "-o", `-p ${port} -c unix_socket_directories=''`, "-l", join(dir, "log"), "-w", "start"], process.env);
  run(join(pgBin, "createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "agenda_test"], process.env);
  tempCluster = { dir };
  databaseUrl = `postgresql://postgres@127.0.0.1:${port}/agenda_test`;
}

const apiPort = await freePort();
const env: NodeJS.ProcessEnv = {
  // Entorno limpio: nada de .env (Supabase, Gmail…).
  PATH: [pgBin, process.env.PATH].filter(Boolean).join(delimiter),
  HOME: process.env.HOME,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: "false",
  PORT: String(apiPort),
  FRONTEND_URL: "http://localhost:5173",
  REMINDER_JOB_INTERVAL_MINUTES: "0",
  CRON_SECRET: randomBytes(24).toString("hex"),
  PROXY_SECRET: randomBytes(24).toString("hex"),
  TEST_DATABASE_URL: databaseUrl,
  // Archivos de la historia clínica en una carpeta temporal (almacenamiento local).
  LOCAL_STORAGE_DIR: mkdtempSync(join(tmpdir(), "agendo-files-")),
  TEST_API_URL: `http://127.0.0.1:${apiPort}/api`,
};

let api: ChildProcess | null = null;

async function startApi(): Promise<void> {
  const output: string[] = [];
  api = spawn(process.execPath, ["src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  api.stdout!.on("data", (chunk) => output.push(String(chunk)));
  api.stderr!.on("data", (chunk) => output.push(String(chunk)));
  for (let i = 0; i < 100; i++) {
    const healthy = await fetch(`${env.TEST_API_URL}/health`).then((res) => res.ok, () => false);
    if (healthy) return;
    if (api.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`La API de pruebas no arrancó:\n${output.join("")}`);
}

async function stopApi(): Promise<void> {
  const child = api;
  api = null;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  });
}

function cleanup(): void {
  api?.kill("SIGKILL");
  rmSync(env.LOCAL_STORAGE_DIR!, { recursive: true, force: true });
  if (tempCluster && pgBin) {
    try {
      run(join(pgBin, "pg_ctl"), ["-D", join(tempCluster.dir, "data"), "-m", "immediate", "stop"], process.env);
    } catch {
      // Ya estaba detenido.
    }
    rmSync(tempCluster.dir, { recursive: true, force: true });
    tempCluster = null;
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const suites = readdirSync(join(ROOT, "tests"))
  .filter((file) => /\.test\.(mjs|ts)$/.test(file))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort();

const results: { suite: string; passed: boolean }[] = [];
try {
  run(process.execPath, ["src/db/migrate.ts"], env);
  for (const suite of suites) {
    console.log(`\n━━ ${suite}`);
    run(process.execPath, ["src/db/seed.ts", "--reset"], env);
    await startApi();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [join("tests", suite)], { cwd: ROOT, env, stdio: "inherit" });
      child.on("exit", resolve);
    });
    await stopApi();
    results.push({ suite, passed: code === 0 });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  results.push({ suite: "(preparación)", passed: false });
} finally {
  cleanup();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length} de ${results.length} suites pasaron.`);
for (const { suite } of failed) console.log(`  ✗ ${suite}`);
process.exitCode = failed.length || results.length === 0 ? 1 : 0;
