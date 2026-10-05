import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";

/**
 * Almacenamiento de archivos (historia clínica). El navegador sube y descarga directamente con
 * URLs firmadas de corta duración: los archivos no pasan por la función de Vercel (límite de 4,5 MB
 * por petición) y nunca son públicos.
 *
 * - Supabase Storage (producción): SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. El bucket privado se
 *   crea solo la primera vez.
 * - Carpeta local (desarrollo y pruebas, nunca en Vercel): `storage/` en el proyecto; la API sirve
 *   la subida y la descarga en /api/files con tokens firmados.
 */
export interface FileStorage {
  kind: "supabase" | "local";
  /** URL para que el navegador suba el archivo con PUT (y las cabeceras que debe enviar). */
  createUploadUrl(objectPath: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** URL para ver o descargar el archivo durante unos minutos. */
  createDownloadUrl(objectPath: string, fileName: string): Promise<string>;
  /** Tamaño del archivo subido, o null si no existe. */
  sizeOf(objectPath: string): Promise<number | null>;
  /** Borra los archivos (los que no existan se ignoran). */
  remove(objectPaths: string[]): Promise<void>;
}

const UPLOAD_URL_SECONDS = 10 * 60;
const DOWNLOAD_URL_SECONDS = 5 * 60;

/* ------------------------------------------------------------- Supabase Storage -- */

function supabaseStorage(baseUrl: string, key: string, bucket: string): FileStorage {
  const api = `${baseUrl.replace(/\/+$/, "")}/storage/v1`;
  // Las claves nuevas (sb_secret_…) van sólo en `apikey`; las antiguas (JWT), también como Bearer.
  const auth: Record<string, string> = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
  const encodePath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");

  async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${api}${route}`, {
      method,
      headers: { ...auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase Storage ${response.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  let bucketReady: Promise<void> | null = null;
  const ensureBucket = () =>
    (bucketReady ??= request("POST", "/bucket", { id: bucket, name: bucket, public: false }).then(
      () => undefined,
      (error: Error) => {
        // Ya existe: perfecto. Otro error: se reintenta en la próxima petición.
        if (/already exists|Duplicate|409/i.test(error.message)) return;
        bucketReady = null;
        throw error;
      },
    ));

  return {
    kind: "supabase",
    async createUploadUrl(objectPath, contentType) {
      await ensureBucket();
      const { url } = await request<{ url: string }>("POST", `/object/upload/sign/${bucket}/${encodePath(objectPath)}`, {
        expiresIn: UPLOAD_URL_SECONDS,
      });
      return { url: `${api}${url}`, headers: { "Content-Type": contentType, "x-upsert": "false" } };
    },
    async createDownloadUrl(objectPath) {
      const { signedURL } = await request<{ signedURL: string }>("POST", `/object/sign/${bucket}/${encodePath(objectPath)}`, {
        expiresIn: DOWNLOAD_URL_SECONDS,
      });
      return `${api}${signedURL}`;
    },
    async sizeOf(objectPath) {
      const folder = path.posix.dirname(objectPath);
      const name = path.posix.basename(objectPath);
      const objects = await request<{ name: string; metadata?: { size?: number } }[]>("POST", `/object/list/${bucket}`, {
        prefix: `${folder}/`,
        search: name,
        limit: 5,
      });
      const found = objects.find((object) => object.name === name);
      return found ? (found.metadata?.size ?? null) : null;
    },
    async remove(objectPaths) {
      // Hasta 1.000 archivos por petición.
      for (let i = 0; i < objectPaths.length; i += 1000) {
        await request("DELETE", `/object/${bucket}`, { prefixes: objectPaths.slice(i, i + 1000) });
      }
    },
  };
}

/* ------------------------------------------------------------- Carpeta local -- */

/** Carpeta del almacenamiento local (las pruebas usan una temporal con LOCAL_STORAGE_DIR). */
export const LOCAL_STORAGE_DIR = path.resolve(process.env.LOCAL_STORAGE_DIR ?? path.join(import.meta.dirname, "../../storage"));
/** Secreto de los tokens locales: nuevo en cada arranque (los tokens duran minutos). */
const localSecret = randomBytes(32);

interface LocalToken {
  /** u: subida · d: descarga */
  op: "u" | "d";
  path: string;
  /** Subida: tipo que debe declarar el navegador. Descarga: nombre con que se muestra. */
  label: string;
  exp: number;
}

export function signLocalToken(token: LocalToken): string {
  const payload = Buffer.from(JSON.stringify(token)).toString("base64url");
  const signature = createHmac("sha256", localSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Comprueba firma, operación y caducidad de un token local. */
export function verifyLocalToken(raw: string, op: LocalToken["op"]): LocalToken | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", localSecret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const token = JSON.parse(Buffer.from(payload, "base64url").toString()) as LocalToken;
    return token.op === op && token.exp > Date.now() && !token.path.includes("..") ? token : null;
  } catch {
    return null;
  }
}

export const localFilePath = (objectPath: string) => path.join(LOCAL_STORAGE_DIR, objectPath);

export async function writeLocalFile(objectPath: string, data: Buffer): Promise<void> {
  const file = localFilePath(objectPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: "wx" }); // Nunca sobrescribe.
}

export const readLocalFile = (objectPath: string) => readFile(localFilePath(objectPath));

const localStorage: FileStorage = {
  kind: "local",
  async createUploadUrl(objectPath, contentType) {
    const token = signLocalToken({ op: "u", path: objectPath, label: contentType, exp: Date.now() + UPLOAD_URL_SECONDS * 1000 });
    return { url: `/api/files/${token}`, headers: { "Content-Type": contentType } };
  },
  async createDownloadUrl(objectPath, fileName) {
    const token = signLocalToken({ op: "d", path: objectPath, label: fileName, exp: Date.now() + DOWNLOAD_URL_SECONDS * 1000 });
    return `/api/files/${token}`;
  },
  async sizeOf(objectPath) {
    return stat(localFilePath(objectPath)).then(
      (info) => info.size,
      () => null,
    );
  },
  async remove(objectPaths) {
    await Promise.all(objectPaths.map((objectPath) => rm(localFilePath(objectPath), { force: true })));
  },
};

/** El almacenamiento configurado, o null si no hay (los archivos quedan desactivados). */
export const fileStorage: FileStorage | null =
  config.supabaseUrl && config.supabaseServiceRoleKey
    ? supabaseStorage(config.supabaseUrl, config.supabaseServiceRoleKey, config.storageBucket)
    : config.onVercel || config.isProduction
      ? null
      : localStorage;
