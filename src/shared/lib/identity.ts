// Copia de agenda-front/src/lib/identity.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
/**
 * Documento de los clientes: la cédula, el pasaporte o el documento de cualquier país, de 5 a 20 letras
 * y números (spec 038, 2026-10-29; antes, en Ecuador, sólo una cédula ecuatoriana válida). Identifica al
 * cliente dentro de un negocio: la página pública de reservas la busca para no crear clientes duplicados.
 */

/**
 * Forma normalizada: en mayúsculas y sin espacios, puntos ni guiones ("V-12.345.678" → "V12345678").
 * Otros signos se conservan para que la validación los rechace en vez de quitarlos sin avisar.
 */
export function normalizeDocumentId(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, "");
}

/** Lo que se puede escribir en un campo de documento: letras y números, en mayúsculas. */
export const documentIdChars = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Largo máximo del documento (el mismo que admite la base). */
export const DOCUMENT_ID_MAX_LENGTH = 20;

/**
 * Cédula ecuatoriana: 10 dígitos, provincia 01–24 (o 30), tercer dígito de 0 a 6 y dígito verificador
 * (módulo 10). El 6 también es de personas: en Guayas hay cédulas que empiezan por 096. Ya no se exige
 * (spec 038): sólo sirve para devolver al importar el 0 que Excel le quita a una cédula.
 */
export function isValidEcuadorianCedula(id: string): boolean {
  if (!/^\d{10}$/.test(id)) return false;
  const province = Number(id.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30) || Number(id[2]) > 6) return false;
  const sum = [...id.slice(0, 9)].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(id[9]);
}
