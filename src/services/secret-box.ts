import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { AppError } from "../http/errors.ts";

/**
 * El secreto de la verificación en dos pasos, cifrado en la base (spec 009): con una copia de la base
 * (o de una copia de seguridad descifrada) no basta para generar los códigos del super admin. AES-256-GCM
 * con la clave TWO_FACTOR_KEY (obligatoria en la nube; con una base local, una fija de desarrollo).
 *
 * Formato guardado: "v1." + base64url(IV de 12 bytes | etiqueta de 16 | cifrado). Lo de antes (base32
 * en claro) se sigue leyendo y se vuelve a guardar cifrado con el siguiente código correcto (ver
 * verifySecondFactor en two-factor.ts): nadie tiene que volver a activar la verificación.
 */

const PREFIX = "v1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  if (!config.twoFactorKey) {
    throw new AppError(
      "unavailable",
      "Falta TWO_FACTOR_KEY: sin ella no se puede usar la verificación en dos pasos con esta base. Ponla en el .env (la misma que en Vercel).",
    );
  }
  return createHash("sha256").update(config.twoFactorKey).digest();
}

/** ¿Ya está cifrado? (false: base32 en claro, de antes de la spec 009). */
export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function sealSecret(secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openSecret(stored: string): string {
  if (!isSealed(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    // Otra clave que la que lo cifró: entra con un código de recuperación o con npm run db:reset-2fa.
    throw new AppError(
      "unavailable",
      "No se pudo leer la verificación en dos pasos (TWO_FACTOR_KEY no es la misma con la que se guardó). Usa un código de recuperación.",
    );
  }
}
