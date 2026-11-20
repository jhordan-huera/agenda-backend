// Copia de agenda-front/src/lib/constants/auth.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
/*
 * Contraseñas temporales (spec 054): la que llega por email con «¿Olvidaste tu contraseña?» y la que genera el super
 * admin en «Cambiar contraseña». Al entrar con una, hay que crear la propia.
 */

/** Cuánto sirve la contraseña temporal del email (decisión del dueño, 2026-11-20). Sirve una sola vez. */
export const TEMPORARY_PASSWORD_MINUTES = 60;

/** Caracteres de una contraseña temporal. */
export const TEMPORARY_PASSWORD_LENGTH = 10;

/** Sin las letras y los números que se confunden al copiarla a mano (0 y O, 1, l e I). */
export const TEMPORARY_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Una contraseña temporal al azar, con `crypto.getRandomValues` (en el navegador y en la API). Se descartan los bytes
 * que harían más probables unas letras que otras.
 */
export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  const alphabet = TEMPORARY_PASSWORD_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}
