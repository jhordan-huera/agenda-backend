/**
 * Qué es de verdad un archivo subido, por sus primeros bytes (su «firma»), y no por el tipo que
 * declara el navegador, que cualquiera puede inventar. Lo usa el comprobante del enlace de pago
 * (/pago/:token, sin sesión): una página web o un programa con nombre de foto se rechaza y se borra.
 */

/** Bytes que se leen del principio del archivo: un PDF puede traer algo antes de «%PDF-». */
export const SIGNATURE_BYTES = 1024;

/** Marcas de una foto HEIC o HEIF (las del iPhone) dentro de su caja «ftyp». */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export type FileKind = "image" | "pdf";

/** ¿Es una foto (JPG, PNG, WebP o HEIC) o un PDF? null: ninguna de las dos cosas. */
export function fileKindOf(head: Buffer): FileKind | null {
  const text = (start: number, end: number) => head.toString("latin1", start, end);
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image";
  if (head.length >= 12 && text(4, 8) === "ftyp") {
    // La marca principal y, después de la versión, las compatibles, hasta el final de la caja.
    const boxEnd = Math.min(head.readUInt32BE(0), head.length);
    const brands = [text(8, 12)];
    for (let i = 16; i + 4 <= boxEnd; i += 4) brands.push(text(i, i + 4));
    if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image";
  }
  if (text(0, head.length).includes("%PDF-")) return "pdf";
  return null;
}

/**
 * ¿El archivo es de la clase que se declaró? Una foto por una foto (un PNG que dice ser JPG pasa: es
 * una foto igual) y un PDF por un PDF.
 */
export function matchesDeclaredType(head: Buffer, contentType: string): boolean {
  const kind = fileKindOf(head);
  return kind !== null && kind === (contentType === "application/pdf" ? "pdf" : "image");
}
