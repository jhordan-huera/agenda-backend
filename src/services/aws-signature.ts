import { createHash, createHmac } from "node:crypto";

/**
 * La firma de las peticiones a AWS (Signature Version 4) para la consulta diaria de los costos (spec 031),
 * sólo con node:crypto (HMAC-SHA256), como TOTP y Web Push: así no se suman el SDK de AWS al proyecto ni al
 * paquete de Lambda (constitución VI).
 *
 * Es la firma general de AWS (la de los servicios con JSON, no la de S3):
 * 1. la petición canónica: el método, la ruta codificada, los parámetros ordenados, las cabeceras en
 *    minúsculas y ordenadas, cuáles se firman y el SHA-256 del cuerpo;
 * 2. el texto a firmar: el algoritmo, la fecha, el ámbito (día/región/servicio/aws4_request) y el SHA-256 de
 *    la petición canónica;
 * 3. la clave de firma, derivada del secreto con el día, la región y el servicio, y la firma en hexadecimal.
 *
 * Se prueba con los ejemplos oficiales de AWS (get-vanilla y post-vanilla, tests/aws-costs.test.ts). No lee la
 * configuración ni guarda nada: las credenciales llegan de quien la llama.
 */

/** Las credenciales de AWS: las de un rol que dura poco (con su token de sesión) o las de un usuario. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Con las credenciales temporales de un rol (las que deja el paso de GitHub): va en X-Amz-Security-Token. */
  sessionToken?: string;
}

/** Una petición por firmar. */
export interface AwsRequest {
  method: string;
  url: string;
  /** Las cabeceras propias (Content-Type, X-Amz-Target…). Host, X-Amz-Date y la firma las pone signAwsRequest. */
  headers?: Record<string, string>;
  body?: string;
  /** El servicio y la región del ámbito de la firma: p. ej. `ce` y `us-east-1`. */
  service: string;
  region: string;
}

const ALGORITHM = "AWS4-HMAC-SHA256";

const sha256 = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986, como lo pide AWS: sin codificar sólo las letras, los números y `- _ . ~`. */
const encode = (text: string) =>
  encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * La ruta canónica: cada tramo codificado otra vez sobre la ruta ya codificada de la URL (AWS pide la
 * codificación doble en todos los servicios menos S3). La de la consulta de los costos es `/`.
 */
const canonicalPath = (pathname: string) => pathname.split("/").map(encode).join("/") || "/";

/** Los parámetros, codificados y ordenados por nombre y valor (vacío si no hay). */
function canonicalQuery(params: URLSearchParams): string {
  return [...params]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([keyA, valueA], [keyB, valueB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** «20150830T123600Z»: el momento de la firma, en UTC y sin separadores. */
export const amzDate = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, "");

/**
 * Firma la petición y devuelve las cabeceras que hay que enviar: las propias, X-Amz-Date, X-Amz-Security-Token
 * (con credenciales temporales) y Authorization. Host se firma con el de la URL, pero no se devuelve: lo pone
 * fetch, con el mismo valor. `at`: el momento de la firma (AWS rechaza las de más de 15 minutos de diferencia).
 */
export function signAwsRequest(request: AwsRequest, credentials: AwsCredentials, at: Date = new Date()): Record<string, string> {
  const url = new URL(request.url);
  const timestamp = amzDate(at);
  const day = timestamp.slice(0, 8);
  const sent: Record<string, string> = {
    ...request.headers,
    "X-Amz-Date": timestamp,
    ...(credentials.sessionToken ? { "X-Amz-Security-Token": credentials.sessionToken } : {}),
  };
  // Las cabeceras firmadas: en minúsculas, sin espacios de más y ordenadas por nombre.
  const signed = new Map<string, string>([["host", url.host]]);
  for (const [name, value] of Object.entries(sent)) signed.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  const names = [...signed.keys()].sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    names.map((name) => `${name}:${signed.get(name)}\n`).join(""),
    signedHeaders,
    sha256(request.body ?? ""),
  ].join("\n");
  const scope = `${day}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = [ALGORITHM, timestamp, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), request.region), request.service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    ...sent,
    Authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
