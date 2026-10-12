/**
 * `npm run backup:decrypt -- <archivo .sql.gz.enc> [salida.sql] [--dentro-del-repo]`
 *
 * Descifra una copia de seguridad (las que llegan por email, ver scripts/backup.ts). La clave es
 * BACKUP_PASSPHRASE (de .env); si no está, la pide.
 *
 * El volcado SQL tiene datos personales y de salud EN CLARO y este repositorio es público: por
 * defecto queda fuera de él, en ~/Agenda360-copias (carpeta sólo para tu usuario, permisos 700).
 * Una salida dentro del repositorio se rechaza salvo con --dentro-del-repo.
 * Después, restaurarlo en una base de datos VACÍA: psql "<url>" -f <salida.sql>
 */
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { BackupDecryptError, decryptBackup } from "./backup-crypto.ts";

const ROOT = realpathSync.native(join(import.meta.dirname, ".."));
/** Carpeta por defecto de las copias descifradas, fuera del repositorio. */
const COPIES_DIR = join(homedir(), "Agenda360-copias");
const ALLOW_REPO = "--dentro-del-repo";

/** macOS y Windows no distinguen mayúsculas en las rutas. */
const normalize = (path: string) => (process.platform === "darwin" || process.platform === "win32" ? path.toLowerCase() : path);

/** La carpeta real (sin enlaces simbólicos); si aún no existe, tal cual. */
async function realDir(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

async function insideRepo(file: string): Promise<boolean> {
  const dir = normalize(await realDir(dirname(resolve(file))));
  const root = normalize(ROOT);
  return dir === root || dir.startsWith(root + sep);
}

async function askPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Clave de las copias (BACKUP_PASSPHRASE): ")).trim();
  } finally {
    rl.close();
  }
}

/** La salida por defecto: ~/Agenda360-copias/<nombre>.sql, con la carpeta sólo para este usuario. */
async function defaultOutput(input: string): Promise<string> {
  await mkdir(COPIES_DIR, { recursive: true, mode: 0o700 });
  await chmod(COPIES_DIR, 0o700);
  const name = basename(input).replace(/\.gz\.enc$|\.enc$/, "").replace(/(\.sql)?$/, ".sql");
  return join(COPIES_DIR, name);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowRepo = args.includes(ALLOW_REPO);
  const [input, explicitOutput] = args.filter((arg) => arg !== ALLOW_REPO);
  if (!input) throw new BackupDecryptError(`Uso: npm run backup:decrypt -- <archivo .sql.gz.enc> [salida.sql] [${ALLOW_REPO}]`);
  if (explicitOutput && !allowRepo && (await insideRepo(explicitOutput))) {
    throw new BackupDecryptError(
      `No se descifra dentro del repositorio (es público y un "git add" la publicaría): ${resolve(explicitOutput)}. ` +
        `Deja la salida por defecto (~/Agenda360-copias) o, si de verdad la quieres ahí, añade ${ALLOW_REPO}.`,
    );
  }
  if (await insideRepo(input)) {
    console.warn("⚠ La copia cifrada está dentro del repositorio: muévela fuera (p. ej. a Descargas) cuando termines.");
  }
  const file = await readFile(input).catch(() => {
    throw new BackupDecryptError(`No se encontró el archivo ${input}.`);
  });
  const passphrase = process.env.BACKUP_PASSPHRASE?.trim() || (await askPassphrase());
  const sql = decryptBackup(file, passphrase);
  const output = explicitOutput ?? (await defaultOutput(input));
  await writeFile(output, sql, { mode: 0o600 });
  console.info(`✓ Copia descifrada en ${output} (${Math.round(Buffer.byteLength(sql) / 1024)} KB).`);
  console.info("  Contiene datos personales y de salud: bórrala cuando termines de usarla.");
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
