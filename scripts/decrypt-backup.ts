/**
 * `npm run backup:decrypt -- <archivo .sql.gz.enc> [salida.sql]`
 *
 * Descifra una copia de seguridad (las que llegan por email, ver scripts/backup.ts) y deja el
 * volcado SQL al lado del archivo. La clave es BACKUP_PASSPHRASE (de .env); si no está, la pide.
 * Después, restaurarlo en una base de datos VACÍA: psql "<url>" -f <salida.sql>
 */
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { BackupDecryptError, decryptBackup } from "./backup-crypto.ts";

async function askPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Clave de las copias (BACKUP_PASSPHRASE): ")).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [input, output = input?.replace(/\.gz\.enc$|\.enc$/, "").replace(/(\.sql)?$/, ".sql")] = process.argv.slice(2);
  if (!input) throw new BackupDecryptError("Uso: npm run backup:decrypt -- <archivo .sql.gz.enc> [salida.sql]");
  const file = await readFile(input).catch(() => {
    throw new BackupDecryptError(`No se encontró el archivo ${input}.`);
  });
  const passphrase = process.env.BACKUP_PASSPHRASE?.trim() || (await askPassphrase());
  const sql = decryptBackup(file, passphrase);
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
