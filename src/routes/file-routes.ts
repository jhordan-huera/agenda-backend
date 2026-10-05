import express, { Router } from "express";
import { AppError } from "../http/errors.ts";
import { fileStorage, readLocalFile, verifyLocalToken, writeLocalFile } from "../services/file-storage.ts";
import { CLINICAL_ATTACHMENT_MAX_BYTES } from "../shared/lib/validations/clinical.ts";

/**
 * Subida y descarga de archivos con el almacenamiento local (desarrollo y pruebas). El token
 * firmado de la URL es la autorización: lo emite la API tras comprobar permisos y caduca en minutos.
 * Con Supabase Storage estas rutas no existen: el navegador habla directo con Supabase.
 */
export const fileRoutes = Router();

if (fileStorage?.kind === "local") {
  fileRoutes.put(
    "/:token",
    express.raw({ type: () => true, limit: CLINICAL_ATTACHMENT_MAX_BYTES }),
    async (req, res) => {
      const token = verifyLocalToken(String(req.params.token), "u");
      if (!token) throw new AppError("forbidden", "Enlace de subida caducado o inválido.");
      if (req.get("content-type") !== token.label) throw new AppError("validation", "Tipo de archivo distinto del indicado.");
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError("validation", "El archivo está vacío.");
      try {
        await writeLocalFile(token.path, body);
      } catch {
        throw new AppError("conflict", "Ese archivo ya se subió.");
      }
      res.status(200).json({ ok: true });
    },
  );

  fileRoutes.get("/:token", async (req, res) => {
    const token = verifyLocalToken(String(req.params.token), "d");
    if (!token) throw new AppError("forbidden", "Enlace caducado o inválido.");
    const data = await readLocalFile(token.path).catch(() => null);
    if (!data) throw new AppError("not_found", "Archivo no encontrado.");
    const extension = token.path.split(".").pop() ?? "";
    const types: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf" };
    res.setHeader("Content-Type", types[extension] ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(token.label)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
  });
}
