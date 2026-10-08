/**
 * Pasa al almacenamiento de imágenes los logos y fotos antiguos, guardados como data URL dentro de
 * la base de datos, y deja en su lugar la dirección pública. Se puede repetir: lo ya pasado no se
 * toca y una imagen repetida (la foto del perfil copiada a su agenda) se sube una sola vez.
 *
 *   npm run db:move-images
 *
 * Usa la DATABASE_URL de .env y, para Supabase Storage, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */
import { createHash } from "node:crypto";
import { pool } from "./pool.ts";
import { imageStorage, writeLocalFile } from "../services/file-storage.ts";

/** Tabla, columna y carpeta del bucket. */
const COLUMNS = [
  ["businesses", "logo_url"],
  ["users", "avatar_url"],
  ["professionals", "avatar_url"],
] as const;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const storage = imageStorage;
if (!storage) {
  console.error("✗ No hay almacenamiento de imágenes: añade SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY a .env.");
  process.exit(1);
}

const dataUrls = new Set<string>();
for (const [table, column] of COLUMNS) {
  const { rows } = await pool.query<{ url: string }>(`select distinct ${column} as url from ${table} where ${column} like 'data:%'`);
  for (const row of rows) dataUrls.add(row.url);
}

let moved = 0;
let skipped = 0;
for (const dataUrl of dataUrls) {
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(dataUrl);
  const contentType = match?.[1].toLowerCase().replace("image/jpg", "image/jpeg") ?? "";
  const extension = EXTENSIONS[contentType];
  if (!match || !extension) {
    // GIF, SVG…: el bucket no los admite. Se quedan como están hasta que el negocio la cambie.
    skipped++;
    continue;
  }
  const bytes = Buffer.from(match[2], "base64");
  const objectPath = `antiguas/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${extension}`;
  if ((await storage.sizeOf(objectPath)) === null) {
    if (storage.kind === "local") {
      await writeLocalFile(storage.bucket, objectPath, bytes);
    } else {
      const { url, headers } = await storage.createUploadUrl(objectPath, contentType);
      const response = await fetch(url, { method: "PUT", headers, body: bytes });
      if (!response.ok) throw new Error(`No se pudo subir una imagen (${response.status}).`);
    }
  }
  const publicUrl = storage.publicUrl(objectPath);
  for (const [table, column] of COLUMNS) {
    await pool.query(`update ${table} set ${column} = $2 where ${column} = $1`, [dataUrl, publicUrl]);
  }
  moved++;
}

await pool.end();
console.info(
  dataUrls.size === 0
    ? "✓ No quedan imágenes dentro de la base de datos."
    : `✓ Imágenes pasadas al almacenamiento: ${moved}.${skipped ? ` Sin pasar (formato no admitido): ${skipped}.` : ""}`,
);
