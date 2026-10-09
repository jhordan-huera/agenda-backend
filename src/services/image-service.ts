import { randomUUID } from "node:crypto";
import { many, one, pool, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { imageUploadSchema } from "../shared/lib/validations/images.ts";
import type { ImageUpload } from "../shared/types/index.ts";
import { authorize, parseInput, requireUser, type RequestContext } from "./context.ts";
import { imageStorage } from "./file-storage.ts";

/**
 * Logos y fotos de perfil en el bucket público de imágenes: el navegador sube la imagen (ya
 * reducida) con una URL firmada y luego guarda su dirección en el perfil, el negocio o la agenda.
 * Las imágenes antiguas (data URL guardadas en la base) siguen valiendo hasta que se cambian;
 * src/db/move-images-to-storage.ts (npm run db:move-images) las pasa al almacenamiento.
 *
 * Cada subida queda anotada (tabla image_uploads): a las 24 h el cron borra las que nadie usa (el
 * bucket es público y no debe servir de alojamiento gratis), y cada usuario tiene una cuota diaria.
 */

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Subidas de imágenes por usuario en 24 h (un logo y unas fotos se cambian pocas veces). */
export const IMAGE_UPLOADS_PER_DAY = 20;
/** Horas que una imagen subida puede esperar a que se guarde antes de borrarla. */
const UNUSED_UPLOAD_HOURS = 24;

/** Carpeta de cada imagen: sólo se acepta una imagen de la carpeta de quien la guarda. */
export const imageFolder = {
  avatar: (userId: string) => `perfiles/${userId}`,
  logo: (businessId: string) => `logos/${businessId}`,
  professional: (businessId: string) => `profesionales/${businessId}`,
};

/** "<carpeta>/<id>/<uuid>.<ext>": la forma de los archivos que crea requestUpload. */
const UPLOADED_PATH = /^(perfiles|logos|profesionales)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export const imageService = {
  async requestUpload(ctx: RequestContext, input: unknown): Promise<ImageUpload> {
    const data = parseInput(imageUploadSchema, input);
    const user = requireUser(ctx);
    const storage = imageStorage;
    if (!storage) throw new AppError("unavailable", "Las imágenes no se pueden subir ahora: falta configurar el almacenamiento.");
    let folder = imageFolder.avatar(user.id);
    if (data.target !== "avatar") {
      if (!data.businessId) throw new AppError("validation", "Falta el negocio de la imagen.");
      await authorize(pool, ctx, data.businessId, data.target === "logo" ? "business.manage" : "professionals.manage");
      folder = data.target === "logo" ? imageFolder.logo(data.businessId) : imageFolder.professional(data.businessId);
    }
    const recent = await one<{ count: number }>(
      pool,
      "select count(*)::int as count from image_uploads where user_id = $1 and created_at > now() - make_interval(hours => $2)",
      [user.id, UNUSED_UPLOAD_HOURS],
    );
    if ((recent?.count ?? 0) >= IMAGE_UPLOADS_PER_DAY) {
      throw new AppError("rate_limited", "Ya subiste muchas imágenes hoy. Inténtalo de nuevo mañana.");
    }
    // Un nombre nuevo cada vez: la dirección pública nunca cambia de contenido (se puede cachear).
    const objectPath = `${folder}/${randomUUID()}.${EXTENSIONS[data.contentType]}`;
    await pool.query("insert into image_uploads (object_path, user_id) values ($1, $2)", [objectPath, user.id]);
    const upload = await storage.createUploadUrl(objectPath, data.contentType);
    return { upload: { url: upload.url, method: "PUT", headers: upload.headers }, url: storage.publicUrl(objectPath) };
  },
};

/** El archivo de una dirección de nuestro almacenamiento de imágenes (null si no es de aquí). */
export function imagePathOf(url: string | null | undefined): string | null {
  return (url && imageStorage?.pathOfPublicUrl(url)) || null;
}

/** ¿Es una imagen de nuestro almacenamiento? */
export const isStoredImage = (url: string | null | undefined): url is string => imagePathOf(url) !== null;

/**
 * Una imagen nueva tiene que estar en el almacenamiento, escrita tal como la devolvió la subida
 * (la dirección canónica: "%2Ejpg" en vez de ".jpg" apuntaría al mismo archivo con otro texto) y
 * ser un archivo subido por la API. Con `folders`, además, de una de esas carpetas: la foto de un
 * usuario, de su carpeta; el logo, de la de su negocio. No se aceptan data URL ni direcciones de
 * otros sitios. La que ya estaba guardada (aunque sea antigua) se puede dejar como está.
 */
export function assertStoredImage(value: string | null | undefined, current: string | null, what = "La imagen", folders?: string[]): void {
  if (value == null || value === current) return;
  const path = imagePathOf(value);
  const valid =
    path !== null &&
    value === imageStorage!.publicUrl(path) &&
    UPLOADED_PATH.test(path) &&
    (!folders || folders.some((folder) => path.startsWith(`${folder}/`)));
  if (!valid) throw new AppError("validation", `${what} no se subió bien. Vuelve a elegirla.`);
}

/**
 * De estos archivos, los que alguna fila (logo, foto de un usuario o de una agenda) aún usa. Se
 * compara por archivo, no por texto: una dirección escrita de otra forma ("%2Ejpg") cuenta como el
 * mismo archivo. Las direcciones guardadas son canónicas salvo las que lleven "%" (se decodifican aquí).
 */
async function pathsInUse(db: Db, paths: string[]): Promise<Set<string>> {
  const storage = imageStorage!;
  const urls = paths.map((path) => storage.publicUrl(path));
  const rows = await many<{ url: string }>(
    db,
    `select logo_url as url from businesses where logo_url = any($1::text[]) or position('%' in logo_url) > 0
     union select avatar_url from users where avatar_url = any($1::text[]) or position('%' in avatar_url) > 0
     union select avatar_url from professionals where avatar_url = any($1::text[]) or position('%' in avatar_url) > 0`,
    [urls],
  );
  const wanted = new Set(paths);
  return new Set(rows.map((row) => imagePathOf(row.url)).filter((path): path is string => path !== null && wanted.has(path)));
}

/**
 * Borra del almacenamiento las imágenes que ya nadie usa (tras cambiarlas, quitarlas o borrar a su
 * dueño). Va después de confirmar la transacción y nunca falla: lo peor es un archivo huérfano.
 */
export async function releaseImages(urls: (string | null | undefined)[]): Promise<void> {
  const storage = imageStorage;
  const candidates = [...new Set(urls.map(imagePathOf).filter((path): path is string => path !== null))];
  if (!storage || candidates.length === 0) return;
  try {
    const used = await pathsInUse(pool, candidates);
    const unused = candidates.filter((path) => !used.has(path));
    // La subida sigue anotada hasta que el cron la olvide: cuenta para la cuota del día.
    if (unused.length) await storage.remove(unused);
  } catch (error) {
    console.error("No se pudieron borrar imágenes sin uso:", error);
  }
}

/**
 * Subidas de hace más de 24 h: si nadie usa la imagen se borra el archivo; en los dos casos se
 * olvida la subida. La ejecuta el cron. Devuelve cuántos archivos borró (null: sin almacenamiento).
 * Si el almacenamiento falla, las subidas quedan anotadas y se reintenta en la próxima ejecución.
 */
export async function deleteUnusedImageUploads(): Promise<number | null> {
  const storage = imageStorage;
  if (!storage) return null;
  const stale = await many<{ path: string }>(
    pool,
    `select object_path as path from image_uploads
      where created_at < now() - make_interval(hours => $1)
      order by created_at
      limit 500`,
    [UNUSED_UPLOAD_HOURS],
  );
  if (stale.length === 0) return 0;
  const paths = stale.map((row) => row.path);
  const used = await pathsInUse(pool, paths);
  const unused = paths.filter((path) => !used.has(path));
  try {
    if (unused.length) await storage.remove(unused);
  } catch (error) {
    console.error("[imágenes] No se pudieron borrar las subidas sin usar:", error instanceof Error ? error.message : error);
    return 0;
  }
  await pool.query("delete from image_uploads where object_path = any($1::text[])", [paths]);
  return unused.length;
}
