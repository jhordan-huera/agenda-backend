import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";

/**
 * Avisos en el celular (spec 013, R1): el estándar de los navegadores, sólo con node:crypto.
 * - RFC 8030: un POST a la dirección del aparato (endpoint) en el servicio de avisos de su navegador.
 * - RFC 8291 y 8188: el contenido va cifrado (aes128gcm) para ese aparato: Google, Apple, Mozilla o
 *   Microsoft lo transportan, pero no lo pueden leer.
 * - RFC 8292 (VAPID): cada envío va firmado con el par de claves propio de Agenda360.
 *
 * No lee la configuración: lo usan también `npm run push:keys` y las pruebas, sin base de datos. La
 * cola y a quién se envía están en push-delivery.ts.
 */

/** Las claves de un aparato, en base64url, como las entrega el navegador (`PushSubscription.toJSON()`). */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface PushTarget extends PushKeys {
  endpoint: string;
}

/** El par de claves de Agenda360 (base64url) y el contacto que piden los servicios de avisos. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const P256_PUBLIC_KEY_BYTES = 65;
const P256_PRIVATE_KEY_BYTES = 32;
const AUTH_SECRET_BYTES = 16;
const SALT_BYTES = 16;
/** Un solo registro (RFC 8188): el aviso cabe de sobra (menos de 1 KB). */
const RECORD_SIZE = 4096;
/** Lo que cabe en el registro: 4096 menos el delimitador (1) y la etiqueta de AES-GCM (16). */
const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 17;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const fromBase64Url = (value: string) => Buffer.from(value, "base64url");

/* ------------------------------------------------------------ Claves --- */

/** Las claves del aparato sirven: un punto P-256 sin comprimir (65 bytes) y un secreto de 16 bytes. */
export function isValidPushKeys(keys: PushKeys): boolean {
  if (!BASE64URL.test(keys.p256dh) || !BASE64URL.test(keys.auth)) return false;
  const publicKey = fromBase64Url(keys.p256dh);
  if (publicKey.length !== P256_PUBLIC_KEY_BYTES || publicKey[0] !== 0x04) return false;
  if (fromBase64Url(keys.auth).length !== AUTH_SECRET_BYTES) return false;
  try {
    // computeSecret rechaza un punto que no está en la curva.
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(publicKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Qué les falta a las claves VAPID de la configuración, sin mostrar valores ("falta VAPID_PRIVATE_KEY",
 * "VAPID_PUBLIC_KEY no es válida"…). null: sirven.
 */
export function vapidKeysProblem(publicKey: string | undefined, privateKey: string | undefined): string | null {
  if (!publicKey && !privateKey) return "faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY";
  if (!publicKey) return "falta VAPID_PUBLIC_KEY";
  if (!privateKey) return "falta VAPID_PRIVATE_KEY";
  const pub = fromBase64Url(publicKey);
  if (!BASE64URL.test(publicKey) || pub.length !== P256_PUBLIC_KEY_BYTES || pub[0] !== 0x04) return "VAPID_PUBLIC_KEY no es válida";
  const priv = fromBase64Url(privateKey);
  if (!BASE64URL.test(privateKey) || priv.length !== P256_PRIVATE_KEY_BYTES) return "VAPID_PRIVATE_KEY no es válida";
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return "VAPID_PRIVATE_KEY no corresponde a VAPID_PUBLIC_KEY";
  } catch {
    return "VAPID_PRIVATE_KEY no es válida";
  }
  return null;
}

/** Un par de claves VAPID nuevo (`npm run push:keys`): la pública de 65 bytes (87 caracteres) y la privada de 32 (43). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const publicKey = Buffer.concat([Buffer.from([0x04]), fromBase64Url(jwk.x!), fromBase64Url(jwk.y!)]);
  return { publicKey: publicKey.toString("base64url"), privateKey: jwk.d! };
}

/* ----------------------------------------------------------- Cifrado --- */

/**
 * Cifra el aviso para un aparato (RFC 8291, `aes128gcm` de la RFC 8188), en un solo registro:
 * sal (16) + tamaño del registro (4) + largo de la clave (1) + clave efímera (65) + cifrado con su
 * etiqueta. Cada envío usa una clave efímera y una sal nuevas. `fixed` es sólo para las pruebas:
 * con la sal y la clave del ejemplo de la RFC da exactamente su resultado.
 */
export function encryptPushPayload(
  payload: string | Buffer,
  keys: PushKeys,
  fixed: { salt?: Buffer; serverPrivateKey?: Buffer } = {},
): Buffer {
  const plaintext = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("El aviso es demasiado largo para enviarlo.");
  const userAgentPublicKey = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  const salt = fixed.salt ?? randomBytes(SALT_BYTES);

  const ecdh = createECDH("prime256v1");
  if (fixed.serverPrivateKey) ecdh.setPrivateKey(fixed.serverPrivateKey);
  else ecdh.generateKeys();
  const serverPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userAgentPublicKey);

  // IKM = HKDF(sal = secreto auth, IKM = secreto ECDH, info = "WebPush: info\0" + clave del aparato + clave efímera).
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), userAgentPublicKey, serverPublicKey]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12));

  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  // 0x02: delimitador del último (y único) registro, sin relleno.
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(SALT_BYTES + 5);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header[SALT_BYTES + 4] = serverPublicKey.length;
  return Buffer.concat([header, serverPublicKey, ciphertext]);
}

/* ------------------------------------------------------- Firma VAPID --- */

/** El JWT dura 12 h; se renueva cuando le queda menos de 1 h. */
const JWT_LIFETIME_MS = 12 * 60 * 60_000;
const JWT_RENEW_BEFORE_MS = 60 * 60_000;

const signingKeys = new Map<string, KeyObject>();
const authorizations = new Map<string, { header: string; expiresAt: number }>();

function signingKey(vapid: VapidKeys): KeyObject {
  let key = signingKeys.get(vapid.privateKey);
  if (!key) {
    const publicKey = fromBase64Url(vapid.publicKey);
    key = createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        d: vapid.privateKey.replace(/=+$/, ""),
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    signingKeys.set(vapid.privateKey, key);
  }
  return key;
}

const jsonBase64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * Cabecera `Authorization` del envío (RFC 8292): un JWT ES256 con `aud` = el origen del servicio de
 * avisos, `exp` a 12 h y `sub` = el contacto. Se guarda en memoria por servicio mientras le quede más
 * de 1 h. `now` es para las pruebas.
 */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): string {
  const audience = new URL(endpoint).origin;
  const cacheKey = `${audience} ${vapid.publicKey} ${vapid.subject}`;
  const cached = authorizations.get(cacheKey);
  if (cached && cached.expiresAt - now > JWT_RENEW_BEFORE_MS) return cached.header;
  const expiresAt = now + JWT_LIFETIME_MS;
  const unsigned = `${jsonBase64Url({ typ: "JWT", alg: "ES256" })}.${jsonBase64Url({
    aud: audience,
    exp: Math.floor(expiresAt / 1000),
    sub: vapid.subject,
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: signingKey(vapid), dsaEncoding: "ieee-p1363" });
  const header = `vapid t=${unsigned}.${signature.toString("base64url")}, k=${vapid.publicKey}`;
  authorizations.set(cacheKey, { header, expiresAt });
  return header;
}

/* ------------------------------------------------- Servicios de avisos --- */

/**
 * Los servicios de avisos de los navegadores (R4): Chrome, Edge en Android, Opera, Samsung Internet y
 * Brave (Google); Firefox (Mozilla); Safari en el iPhone, el iPad y la Mac (Apple). Edge en Windows usa
 * un subdominio de notify.windows.com. Chrome da hoy direcciones de Google en `jmt17.google.com/fcm/send/…`
 * (comprobado con Chrome en local, 2026-10-14) además de las de fcm.googleapis.com.
 */
const PUSH_SERVICE_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const GOOGLE_PUSH_HOST = /^jmt\d{1,3}\.google\.com$/;
const WINDOWS_PUSH_SUFFIX = ".notify.windows.com";

/**
 * La dirección del aparato es de un servicio de avisos conocido: `https://`, puerto 443, sin usuario ni
 * contraseña. La manda el navegador y el servidor le hace un POST: cualquier otra cosa haría que la API
 * llamara a sitios internos (SSRF). `allowLocal`: sólo con la base local (pruebas y `dev:local`),
 * también `http://127.0.0.1:<puerto>`, para el servicio de avisos falso de las pruebas.
 */
export function isAllowedPushEndpoint(endpoint: string, options: { allowLocal?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (options.allowLocal && url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port !== "") return true;
  if (url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.has(host) ||
    GOOGLE_PUSH_HOST.test(host) ||
    (host.endsWith(WINDOWS_PUSH_SUFFIX) && host.length > WINDOWS_PUSH_SUFFIX.length)
  );
}

/** El servicio de una dirección, para los registros: nunca la dirección completa. */
export function pushServiceName(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host.endsWith(WINDOWS_PUSH_SUFFIX) ? WINDOWS_PUSH_SUFFIX.slice(1) : host;
  } catch {
    return "desconocido";
  }
}

/* ------------------------------------------------------------- Envío --- */

/** Lo que viaja cifrado (menos de 1 KB). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: string;
}

/**
 * Resultado de un envío (R6): `sent` (201), `gone` (404 o 410: el aparato ya no existe), `retry` (429,
 * 5xx, sin red o más de 10 s; con lo que pida `Retry-After`) o `rejected` (otros 4xx).
 */
export type PushResult =
  | { outcome: "sent"; status: number }
  | { outcome: "gone"; status: number }
  | { outcome: "retry"; status: number | null; retryAfterSeconds: number | null; error: string }
  | { outcome: "rejected"; status: number; error: string };

const SEND_TIMEOUT_MS = 10_000;

/** `Retry-After` en segundos (o una fecha); null si no viene o no se entiende. */
function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** El motivo que da el servicio, corto y sin la dirección del aparato (sólo queda en la base). */
async function reasonOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/https?:\/\/\S+/g, "[dirección]").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Envía un aviso a un aparato (RFC 8030): cifrado para él, firmado con VAPID, con `TTL` (lo que le
 * queda de sus 24 h: el servicio lo guarda hasta que el celular se conecte) y `Urgency` (`high`: Android
 * lo entrega aunque el celular esté en reposo). No sigue redirecciones y espera 10 s como mucho.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: PushPayload,
  options: { vapid: VapidKeys; ttlSeconds: number; urgency: "normal" | "high" },
): Promise<PushResult> {
  const body = encryptPushPayload(JSON.stringify(payload), target);
  let response: Response;
  try {
    response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        TTL: String(Math.max(0, Math.floor(options.ttlSeconds))),
        Urgency: options.urgency,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Authorization: vapidAuthorization(target.endpoint, options.vapid),
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as { name?: string })?.name === "TimeoutError";
    return { outcome: "retry", status: null, retryAfterSeconds: null, error: timedOut ? "Sin respuesta en 10 s" : "Sin conexión con el servicio de avisos" };
  }
  const { status } = response;
  if (status >= 200 && status < 300) {
    await response.body?.cancel().catch(() => undefined);
    return { outcome: "sent", status };
  }
  if (status === 404 || status === 410) {
    await response.body?.cancel().catch(() => undefined);
    return { outcome: "gone", status };
  }
  const reason = await reasonOf(response);
  if (status === 429 || status >= 500) {
    return {
      outcome: "retry",
      status,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
      error: `Respondió ${status}${reason ? `: ${reason}` : ""}`,
    };
  }
  return { outcome: "rejected", status, error: `Respondió ${status}${reason ? `: ${reason}` : ""}` };
}
