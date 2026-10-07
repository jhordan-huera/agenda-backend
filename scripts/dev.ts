/**
 * API en este equipo, eligiendo la base de datos:
 *
 *   npm run dev            → pregunta cuál
 *   npm run dev:local      → base propia en este equipo, con los datos demo (ver dev-local.ts)
 *   npm run dev:prod       → la base de PRODUCCIÓN (DATABASE_URL de .env)
 *
 * Con producción, lo que se hace es real (p. ej. dar de alta un negocio) pero no gasta CPU de
 * Vercel. El servidor no corre tareas de fondo (las hace el cron de GitHub), los emails van a sus
 * destinatarios reales con enlaces a la web publicada (APP_URL) y el frontend local muestra el aviso
 * "Base de PRODUCCIÓN".
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = join(import.meta.dirname, "..");
const ENV_FILE = join(ROOT, ".env");
/** La web publicada: los enlaces de los emails enviados desde aquí apuntan a ella (APP_URL en .env la cambia). */
const PUBLISHED_APP_URL = "https://agenda-3-6-0.vercel.app";

const [choice, ...rest] = process.argv.slice(2);

async function ask(): Promise<"local" | "prod"> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.info("\n¿Con qué base de datos?");
  console.info("  1) Local: base propia en este equipo, con datos demo (para probar)");
  console.info("  2) Producción: la de tus clientes (lo que hagas es real)");
  const answer = (await rl.question("Elige 1 o 2: ")).trim();
  rl.close();
  if (answer === "1") return "local";
  if (answer === "2") return "prod";
  console.error("Opción no válida.");
  process.exit(1);
}

function run(args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}

const target = choice === "local" || choice === "prod" ? choice : await ask();

if (target === "local") {
  run([join("scripts", "dev-local.ts"), ...rest], process.env);
} else {
  if (!existsSync(ENV_FILE)) {
    console.error("✗ Falta .env con la DATABASE_URL de producción.");
    process.exit(1);
  }
  process.loadEnvFile(ENV_FILE);
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!host || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error("✗ La DATABASE_URL de .env no es la de producción. Para la base local usa npm run dev:local.");
    process.exit(1);
  }
  run(["--watch", "src/server.ts"], {
    ...process.env,
    APP_URL: process.env.APP_URL ?? PUBLISHED_APP_URL,
  });
}
