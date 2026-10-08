/**
 * Paquete del backend para AWS Lambda: `npm run lambda:package` deja dist/lambda.zip con run.sh,
 * package.json, src/ y sólo las dependencias de producción. En Lambda lo arranca Lambda Web Adapter
 * (`node src/server.ts`, igual que en local). Lo usa .github/workflows/deploy-lambda.yml; también
 * sirve para subirlo a mano en la consola de AWS.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "dist", "lambda.zip");
const work = mkdtempSync(join(tmpdir(), "agenda-lambda-"));

try {
  for (const entry of ["run.sh", "package.json", "package-lock.json", "src"]) {
    cpSync(join(ROOT, entry), join(work, entry), { recursive: true });
  }
  chmodSync(join(work, "run.sh"), 0o755);
  console.info("Instalando las dependencias de producción…");
  execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "inherit" });
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  rmSync(OUT, { force: true });
  execFileSync("zip", ["-qr", OUT, "."], { cwd: work, stdio: "inherit" });
  console.info(`✓ ${OUT} (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
