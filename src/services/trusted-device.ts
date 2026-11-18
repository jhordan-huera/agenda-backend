import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";

/*
 * «Dispositivo de confianza» del inicio de sesión del equipo (revisión de seguridad 2026-11-18): al entrar bien, el
 * navegador recibe una cookie firmada con la cuenta, una fecha y la contraseña actual (su hash). Desde ese navegador no
 * cuentan los topes de la cuenta repartidos entre muchas conexiones ni se pide el CAPTCHA: un ataque desde otras IP no
 * deja fuera al dueño en su computador de siempre, aunque cambie de red. Cambiar la contraseña invalida todas estas
 * cookies (la firma lleva el hash). No se guarda nada en la base: la firma usa una clave derivada de TWO_FACTOR_KEY.
 */

export const DEVICE_COOKIE = "agenda360_device";
export const DEVICE_DAYS = 180;

/** La clave de la firma, separada de la del cifrado del 2FA. null: sin TWO_FACTOR_KEY no hay dispositivos de confianza. */
function deviceKey(): Buffer | null {
  return config.twoFactorKey ? createHmac("sha256", config.twoFactorKey).update("agenda360:dispositivo-de-confianza").digest() : null;
}

const signature = (key: Buffer, userId: string, until: number, passwordHash: string) =>
  createHmac("sha256", key).update(`${userId}.${until}.${passwordHash}`).digest("base64url");

/** La cookie para el navegador que acaba de entrar bien. null si no hay clave. */
export function issueDeviceToken(userId: string, passwordHash: string): { token: string; expiresAt: Date } | null {
  const key = deviceKey();
  if (!key) return null;
  const until = Math.floor(Date.now() / 1000) + DEVICE_DAYS * 24 * 60 * 60;
  return { token: `${userId}.${until}.${signature(key, userId, until, passwordHash)}`, expiresAt: new Date(until * 1000) };
}

/** ¿La cookie es de esta cuenta, no venció y se firmó con su contraseña actual? */
export function isTrustedDevice(token: unknown, userId: string, passwordHash: string): boolean {
  const key = deviceKey();
  if (!key || typeof token !== "string" || token.length > 300) return false;
  const [id, untilText, given] = token.split(".");
  if (id !== userId || !untilText || !given) return false;
  const until = Number(untilText);
  if (!Number.isInteger(until) || until * 1000 < Date.now()) return false;
  const expected = Buffer.from(signature(key, userId, until, passwordHash));
  const received = Buffer.from(given);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
