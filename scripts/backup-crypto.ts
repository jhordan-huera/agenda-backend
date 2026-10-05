import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Formato de las copias de seguridad (.sql.gz.enc): el volcado SQL comprimido con gzip y cifrado
 * con AES-256-GCM. La clave sale de BACKUP_PASSPHRASE con scrypt (lento a propósito: adivinarla
 * por fuerza bruta es inviable) y GCM detecta cualquier cambio en el archivo.
 *
 * Archivo: MAGIC · sal (16 bytes) · IV (12) · etiqueta GCM (16) · datos cifrados.
 */

const MAGIC = Buffer.from("AGENDA360-BACKUP-1\n");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** scrypt N=2^16, r=8: ~64 MB de memoria y una fracción de segundo por intento. */
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 2 ** 16 * 8 * 2 };
/** Mínimo para que la clave no se pueda adivinar. */
export const MIN_PASSPHRASE_LENGTH = 20;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

export function encryptBackup(sql: string, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(sql, "utf8"), { level: 9 })), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

export class BackupDecryptError extends Error {}

export function decryptBackup(file: Buffer, passphrase: string): string {
  if (file.length < MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupDecryptError("Ese archivo no es una copia de seguridad de Agenda360.");
  }
  let offset = MAGIC.length;
  const salt = file.subarray(offset, (offset += SALT_BYTES));
  const iv = file.subarray(offset, (offset += IV_BYTES));
  const tag = file.subarray(offset, (offset += TAG_BYTES));
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(file.subarray(offset)), decipher.final()])).toString("utf8");
  } catch {
    throw new BackupDecryptError("La clave no es correcta o el archivo está dañado.");
  }
}
