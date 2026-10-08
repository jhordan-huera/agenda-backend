// Copia de agenda-front/src/lib/validations/images.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";

/** Imágenes públicas (logo, fotos de perfil): el navegador las reduce antes de subirlas. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const imageUploadSchema = z.object({
  target: z.enum(["avatar", "logo", "professional"]),
  /** Negocio del logo o del profesional (la foto propia no lo necesita). */
  businessId: z.string().nullable().default(null),
  contentType: z.enum(IMAGE_TYPES, { error: "La imagen debe ser JPG, PNG o WebP" }),
  sizeBytes: z.number().int().min(1, "La imagen está vacía").max(IMAGE_MAX_BYTES, "La imagen supera los 2 MB"),
});

export type ImageUploadInput = z.infer<typeof imageUploadSchema>;

/**
 * Logo o foto guardados: la URL del almacenamiento. Las imágenes antiguas (data URL) siguen
 * valiendo mientras no se cambien; la API no acepta imágenes nuevas que no estén en el almacenamiento.
 */
export const imageUrlField = z.string().trim().max(700_000, "La imagen es demasiado grande").nullable();
