import express, { Router } from "express";
import { AppError } from "../http/errors.ts";
import {
  fileStorage,
  isPublicBucket,
  localMaxBytes,
  MAX_UPLOAD_BYTES,
  readLocalFile,
  verifyLocalToken,
  writeLocalFile,
} from "../services/file-storage.ts";

/**
 * Subida y descarga de archivos con el almacenamiento local (desarrollo y pruebas). El token
 * firmado de la URL es la autorización: lo emite la API tras comprobar permisos y caduca en minutos.
 * Las imágenes públicas (logos, fotos) se sirven sin token, como en Supabase.
 * Con Supabase Storage estas rutas no existen: el navegador habla directo con Supabase.
 */
export const fileRoutes = Router();

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
};
const typeOf = (objectPath: string) => TYPES[objectPath.split(".").pop() ?? ""] ?? "application/octet-stream";
/**
 * Un trozo de la ruta que no es un nombre de archivo o carpeta. Express decodifica cada trozo por
 * separado: "..%2F..%2F.env" llega como un solo trozo "../../.env", así que también se rechazan
 * las barras (y localFilePath comprueba además que el archivo quede dentro de su bucket).
 */
const isUnsafePart = (part: string) => !part || part === "." || part === ".." || /[/\\\0]/.test(part);

if (fileStorage?.kind === "local") {
  fileRoutes.get("/public/:bucket/*path", async (req, res) => {
    const bucket = String(req.params.bucket);
    const parts = req.params.path as unknown as string[];
    if (!isPublicBucket(bucket) || !Array.isArray(parts) || parts.some(isUnsafePart)) {
      throw new AppError("not_found", "Archivo no encontrado.");
    }
    const objectPath = parts.join("/");
    const data = await readLocalFile(bucket, objectPath).catch(() => null);
    if (!data) throw new AppError("not_found", "Archivo no encontrado.");
    res.setHeader("Content-Type", typeOf(objectPath));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(data);
  });

  fileRoutes.put(
    "/:token",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const token = verifyLocalToken(String(req.params.token), "u");
      if (!token) throw new AppError("forbidden", "Enlace de subida caducado o inválido.");
      if (req.get("content-type") !== token.label) throw new AppError("validation", "Tipo de archivo distinto del indicado.");
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError("validation", "El archivo está vacío.");
      // Como Supabase: cada bucket tiene su tamaño máximo.
      if (body.length > localMaxBytes(token.bucket)) throw new AppError("validation", "El archivo es demasiado grande.");
      try {
        await writeLocalFile(token.bucket, token.path, body);
      } catch {
        throw new AppError("conflict", "Ese archivo ya se subió.");
      }
      res.status(200).json({ ok: true });
    },
  );

  fileRoutes.get("/:token", async (req, res) => {
    const token = verifyLocalToken(String(req.params.token), "d");
    if (!token) throw new AppError("forbidden", "Enlace caducado o inválido.");
    const data = await readLocalFile(token.bucket, token.path).catch(() => null);
    if (!data) throw new AppError("not_found", "Archivo no encontrado.");
    res.setHeader("Content-Type", typeOf(token.path));
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(token.label)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
  });
}
