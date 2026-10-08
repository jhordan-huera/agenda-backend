import { randomUUID } from "node:crypto";
import { many, pool } from "../db/pool.ts";
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
 */

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const imageService = {
  async requestUpload(ctx: RequestContext, input: unknown): Promise<ImageUpload> {
    const data = parseInput(imageUploadSchema, input);
    const user = requireUser(ctx);
    const storage = imageStorage;
    if (!storage) throw new AppError("unavailable", "Las imágenes no se pueden subir ahora: falta configurar el almacenamiento.");
    let folder = `perfiles/${user.id}`;
    if (data.target !== "avatar") {
      if (!data.businessId) throw new AppError("validation", "Falta el negocio de la imagen.");
      await authorize(pool, ctx, data.businessId, data.target === "logo" ? "business.manage" : "professionals.manage");
      folder = `${data.target === "logo" ? "logos" : "profesionales"}/${data.businessId}`;
    }
    // Un nombre nuevo cada vez: la dirección pública nunca cambia de contenido (se puede cachear).
    const objectPath = `${folder}/${randomUUID()}.${EXTENSIONS[data.contentType]}`;
    const upload = await storage.createUploadUrl(objectPath, data.contentType);
    return { upload: { url: upload.url, method: "PUT", headers: upload.headers }, url: storage.publicUrl(objectPath) };
  },
};

/** ¿Es una imagen de nuestro almacenamiento? */
export const isStoredImage = (url: string | null | undefined): url is string => Boolean(url && imageStorage?.pathOfPublicUrl(url));

/**
 * Una imagen nueva tiene que estar en el almacenamiento: no se aceptan data URL ni direcciones
 * de otros sitios. La que ya estaba guardada (aunque sea antigua) se puede dejar como está.
 */
export function assertStoredImage(value: string | null | undefined, current: string | null, what = "La imagen"): void {
  if (value == null || value === current || isStoredImage(value)) return;
  throw new AppError("validation", `${what} no se subió bien. Vuelve a elegirla.`);
}

/**
 * Borra del almacenamiento las imágenes que ya nadie usa (tras cambiarlas, quitarlas o borrar a su
 * dueño). Va después de confirmar la transacción y nunca falla: lo peor es un archivo huérfano.
 */
export async function releaseImages(urls: (string | null | undefined)[]): Promise<void> {
  const storage = imageStorage;
  const candidates = [...new Set(urls.filter(isStoredImage))];
  if (!storage || candidates.length === 0) return;
  try {
    const used = await many<{ url: string }>(
      pool,
      `select logo_url as url from businesses where logo_url = any($1::text[])
       union select avatar_url from users where avatar_url = any($1::text[])
       union select avatar_url from professionals where avatar_url = any($1::text[])`,
      [candidates],
    );
    const unused = candidates.filter((url) => !used.some((row) => row.url === url));
    if (unused.length) await storage.remove(unused.map((url) => storage.pathOfPublicUrl(url)!));
  } catch (error) {
    console.error("No se pudieron borrar imágenes sin uso:", error);
  }
}
