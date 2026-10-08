import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from "../shared/lib/validations/images.ts";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "../shared/lib/validations/payment.ts";
import { CLINICAL_ATTACHMENT_MAX_BYTES, CLINICAL_ATTACHMENT_TYPES } from "../shared/lib/validations/clinical.ts";

/**
 * Almacenamiento de archivos, en tres buckets:
 *
 * - Historias clínicas (privado): radiografías, exámenes, PDFs.
 * - Comprobantes (privado): fotos o PDFs de las transferencias que suben los pacientes.
 * - Imágenes (público): logos y fotos de perfil, con una dirección fija que se guarda en la base.
 *
 * El navegador sube y descarga directamente con URLs firmadas de corta duración: los archivos no
 * pasan por la función de Vercel (límite de 4,5 MB por petición) y los privados nunca son públicos.
 *
 * - Supabase Storage (producción): SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Los buckets se crean
 *   solos la primera vez, con su tamaño máximo y los tipos de archivo que admiten.
 * - Carpeta local (desarrollo y pruebas, nunca en Vercel): `storage/<bucket>/` en el proyecto; la
 *   API sirve la subida y la descarga en /api/files con tokens firmados (y las imágenes, en
 *   /api/files/public/<bucket>/…).
 */
export interface FileStorage {
  kind: "supabase" | "local";
  bucket: string;
  /** URL para que el navegador suba el archivo con PUT (y las cabeceras que debe enviar). */
  createUploadUrl(objectPath: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** URL para ver o descargar el archivo durante unos minutos (buckets privados). */
  createDownloadUrl(objectPath: string, fileName: string): Promise<string>;
  /** Dirección permanente del archivo (buckets públicos). */
  publicUrl(objectPath: string): string;
  /** El archivo de una dirección pública de este bucket; null si no es de aquí. */
  pathOfPublicUrl(url: string): string | null;
  /** Tamaño del archivo subido, o null si no existe. */
  sizeOf(objectPath: string): Promise<number | null>;
  /** Borra los archivos (los que no existan se ignoran). */
  remove(objectPaths: string[]): Promise<void>;
}

interface BucketSpec {
  name: string;
  public: boolean;
  maxBytes: number;
  types: readonly string[];
}

const UPLOAD_URL_SECONDS = 10 * 60;
const DOWNLOAD_URL_SECONDS = 5 * 60;

const encodePath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");

/** Una dirección pública de `base`: el archivo, sin ".." ni partes vacías; null si no lo es. */
function pathAfter(base: string, url: string): string | null {
  if (!url.startsWith(base)) return null;
  try {
    const objectPath = url.slice(base.length).split("/").map(decodeURIComponent).join("/");
    return objectPath && !objectPath.split("/").some((part) => !part || part === "." || part === "..") ? objectPath : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- Supabase Storage -- */

function supabaseStorage(baseUrl: string, key: string, spec: BucketSpec): FileStorage {
  const api = `${baseUrl.replace(/\/+$/, "")}/storage/v1`;
  const bucket = spec.name;
  // Las claves nuevas (sb_secret_…) van sólo en `apikey`; las antiguas (JWT), también como Bearer.
  const auth: Record<string, string> = key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
  const publicBase = `${api}/object/public/${bucket}/`;

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
    (bucketReady ??= request("POST", "/bucket", {
      id: bucket,
      name: bucket,
      public: spec.public,
      // Supabase rechaza lo que no cumpla, aunque la URL firmada sea válida.
      file_size_limit: spec.maxBytes,
      allowed_mime_types: spec.types,
    }).then(
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
    bucket,
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
    publicUrl: (objectPath) => publicBase + encodePath(objectPath),
    pathOfPublicUrl: (url) => pathAfter(publicBase, url),
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
  bucket: string;
  path: string;
  /** Subida: tipo que debe declarar el navegador. Descarga: nombre con que se muestra. */
  label: string;
  exp: number;
}

const isSafePath = (objectPath: string) => !objectPath.split("/").some((part) => !part || part === "." || part === "..");

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
    return token.op === op && token.exp > Date.now() && isSafePath(token.bucket) && isSafePath(token.path) ? token : null;
  } catch {
    return null;
  }
}

export const localFilePath = (bucket: string, objectPath: string) => path.join(LOCAL_STORAGE_DIR, bucket, objectPath);

export async function writeLocalFile(bucket: string, objectPath: string, data: Buffer): Promise<void> {
  const file = localFilePath(bucket, objectPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: "wx" }); // Nunca sobrescribe.
}

export const readLocalFile = (bucket: string, objectPath: string) => readFile(localFilePath(bucket, objectPath));

/** Prefijo de las imágenes públicas locales: el frontend de desarrollo pasa /api a la API. */
const LOCAL_PUBLIC_PREFIX = "/api/files/public/";

function localStorage(spec: BucketSpec): FileStorage {
  const bucket = spec.name;
  const publicBase = `${LOCAL_PUBLIC_PREFIX}${bucket}/`;
  return {
    kind: "local",
    bucket,
    async createUploadUrl(objectPath, contentType) {
      const token = signLocalToken({ op: "u", bucket, path: objectPath, label: contentType, exp: Date.now() + UPLOAD_URL_SECONDS * 1000 });
      return { url: `/api/files/${token}`, headers: { "Content-Type": contentType } };
    },
    async createDownloadUrl(objectPath, fileName) {
      const token = signLocalToken({ op: "d", bucket, path: objectPath, label: fileName, exp: Date.now() + DOWNLOAD_URL_SECONDS * 1000 });
      return `/api/files/${token}`;
    },
    publicUrl: (objectPath) => publicBase + encodePath(objectPath),
    pathOfPublicUrl: (url) => pathAfter(publicBase, url),
    async sizeOf(objectPath) {
      return stat(localFilePath(bucket, objectPath)).then(
        (info) => info.size,
        () => null,
      );
    },
    async remove(objectPaths) {
      await Promise.all(objectPaths.map((objectPath) => rm(localFilePath(bucket, objectPath), { force: true })));
    },
  };
}

/** Tamaño máximo que acepta la subida local de cada bucket. */
export const localMaxBytes = (bucket: string) => BUCKETS.find((spec) => spec.name === bucket)?.maxBytes ?? 0;
/** ¿Se sirve sin token? (sólo el de imágenes). */
export const isPublicBucket = (bucket: string) => BUCKETS.some((spec) => spec.name === bucket && spec.public);

/* --------------------------------------------------------------- Los buckets -- */

const CLINICAL: BucketSpec = { name: config.storageBucket, public: false, maxBytes: CLINICAL_ATTACHMENT_MAX_BYTES, types: CLINICAL_ATTACHMENT_TYPES };
const RECEIPTS: BucketSpec = { name: "comprobantes", public: false, maxBytes: RECEIPT_MAX_BYTES, types: RECEIPT_TYPES };
const IMAGES: BucketSpec = { name: "imagenes", public: true, maxBytes: IMAGE_MAX_BYTES, types: IMAGE_TYPES };
const BUCKETS = [CLINICAL, RECEIPTS, IMAGES];
/** Lo más grande que admite algún bucket (límite de la subida local). */
export const MAX_UPLOAD_BYTES = Math.max(...BUCKETS.map((spec) => spec.maxBytes));

/** Sin Supabase: la carpeta local, salvo con la base de producción (dejaría enlaces rotos). */
const localAllowed = !(config.onVercel || config.isProduction || config.productionDbFromHere);

function storageFor(spec: BucketSpec): FileStorage | null {
  const { supabaseUrl, supabaseServiceRoleKey } = config;
  if (supabaseUrl && supabaseServiceRoleKey) return supabaseStorage(supabaseUrl, supabaseServiceRoleKey, spec);
  return localAllowed ? localStorage(spec) : null;
}

/** Archivos de la historia clínica, o null si no hay almacenamiento (quedan desactivados). */
export const fileStorage = storageFor(CLINICAL);
/** Comprobantes de pago de los pacientes (null: sólo se pueden enviar por WhatsApp). */
export const receiptStorage = storageFor(RECEIPTS);
/** Logos y fotos de perfil (null: no se pueden subir imágenes). */
export const imageStorage = storageFor(IMAGES);
