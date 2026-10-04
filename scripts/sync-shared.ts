import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `npm run sync:shared`: copia desde agenda-front los archivos que comparten frontend y
 * API (tipos, validaciones, disponibilidad, plantillas de email, planes…) a src/shared,
 * cambiando los imports `@/…` por rutas relativas con extensión .ts.
 *
 * Sólo actualiza los archivos que ya existen en src/shared. La carpeta del frontend se
 * puede indicar con FRONTEND_DIR (por defecto ../../Frontend/agenda-front).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const FRONT_SRC = path.resolve(ROOT, process.env.FRONTEND_DIR ?? "../../Frontend/agenda-front", "src");
const SHARED = path.join(ROOT, "src/shared");
const header = (file: string) =>
  `// Copia de agenda-front/src/${file}: mantener ambos archivos iguales (sólo cambian las rutas de import).\n`;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(SHARED, path.join(entry.parentPath, entry.name)));
}

/** "lib/time" → "lib/time.ts"; "types" → "types/index.ts". */
function resolveModule(target: string): string {
  if (existsSync(path.join(FRONT_SRC, `${target}.ts`))) return `${target}.ts`;
  if (existsSync(path.join(FRONT_SRC, target, "index.ts"))) return `${target}/index.ts`;
  throw new Error(`No se encontró ${target} en el frontend.`);
}

if (!existsSync(FRONT_SRC)) throw new Error(`No existe ${FRONT_SRC}. Indica la carpeta con FRONTEND_DIR.`);

const files = await listFiles(SHARED);
const changed: string[] = [];
for (const file of files) {
  const source = await readFile(path.join(FRONT_SRC, file), "utf8");
  const here = path.dirname(file);
  const rewritten = source.replace(/((?:from|import)\s+)"([^"]+)"/g, (match, keyword: string, spec: string) => {
    let target: string;
    if (spec.startsWith("@/")) target = resolveModule(spec.slice(2));
    else if (spec.startsWith(".")) target = resolveModule(path.normalize(path.join(here, spec)));
    else return match;
    if (!files.includes(target)) throw new Error(`${file} importa ${target}, que no está en src/shared: cópialo primero.`);
    let relative = path.relative(here, target);
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return `${keyword}"${relative}"`;
  });
  const output = header(file) + rewritten;
  const destination = path.join(SHARED, file);
  if ((await readFile(destination, "utf8")) !== output) {
    await writeFile(destination, output);
    changed.push(file);
  }
}
console.info(changed.length ? `Actualizados: ${changed.join(", ")}` : "src/shared ya está igual que el frontend.");
