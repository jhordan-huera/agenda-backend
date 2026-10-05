import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { APP_NAME } from "../shared/lib/constants/app.ts";

/**
 * Códigos de 6 dígitos de las apps de autenticación (TOTP, RFC 6238: HMAC-SHA1, intervalos
 * de 30 segundos), compatibles con Google Authenticator, Microsoft Authenticator, Authy…
 * y códigos de recuperación de un solo uso. Funciones puras: la base de datos va en two-factor.ts.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Intervalos de margen a cada lado (la hora del celular puede ir un poco desfasada). */
const DRIFT_STEPS = 1;

/** Sin 0/O ni 1/I: se leen y copian sin confusiones. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_LENGTH = 10;
export const RECOVERY_CODE_COUNT = 10;

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Clave base32 no válida");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Clave nueva de 160 bits, en base32 (lo que se escanea en el QR o se escribe a mano). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Intervalo de 30 s de un instante. */
export function timeStep(at = Date.now()): number {
  return Math.floor(at / 1000 / PERIOD_SECONDS);
}

/** Código de un intervalo (HOTP, RFC 4226). `digits` sólo cambia en las pruebas con los vectores del RFC. */
export function codeAt(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** "123 456" → "123456"; null si no son 6 dígitos (p. ej. un código de recuperación). */
export function normalizeTotpCode(code: string): string | null {
  const digits = code.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Intervalo en que el código es válido (con margen de ±30 s), o null. */
export function findTotpStep(secret: string, code: string, at = Date.now()): number | null {
  const normalized = normalizeTotpCode(code);
  if (!normalized) return null;
  const current = timeStep(at);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(normalized))) return step;
  }
  return null;
}

/** Enlace que leen las apps de autenticación (el QR lo contiene). */
export function otpauthUrl(secret: string, account: string): string {
  const label = `${encodeURIComponent(APP_NAME)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer: APP_NAME, algorithm: "SHA1", digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** Códigos de recuperación nuevos, para mostrar una sola vez ("ABCDE-FGHJK"). */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from({ length: RECOVERY_LENGTH }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Hash con el que se guarda un código de recuperación (sin guion ni espacios, en mayúsculas). null: no tiene el formato. */
export function hashRecoveryCode(code: string): string | null {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== RECOVERY_LENGTH) return null;
  return createHash("sha256").update(normalized).digest("hex");
}
