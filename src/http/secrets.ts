import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Compara secretos en tiempo constante (también si tienen distinta longitud). */
export function sameSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/**
 * Firma de la IP que reenvía el proxy del frontend (middleware.ts), en vez del PROXY_SECRET fijo en
 * una cabecera (spec 009): HMAC-SHA256 en hex de "<ip>.<segundos>" con PROXY_SECRET. Quien vea una
 * petición reenviada sólo puede reutilizar su firma durante CLIENT_IP_SIGNATURE_SECONDS.
 */
export const CLIENT_IP_SIGNATURE_SECONDS = 120;

export function signClientIp(ip: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ip}.${timestamp}`).digest("hex");
}

/** ¿Firma válida y reciente? `ip` puede ser "" (el proxy no la supo): sirve para la guarda de Lambda. */
export function validClientIpSignature(
  ip: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > CLIENT_IP_SIGNATURE_SECONDS) return false;
  return sameSecret(signature, signClientIp(ip, timestamp, secret));
}
