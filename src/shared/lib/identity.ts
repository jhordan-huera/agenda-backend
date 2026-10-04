// Copia de agenda-front/src/lib/identity.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { getTimezoneInfo } from "./constants/business.ts";

/**
 * Cédula de los clientes: sólo números. Identifica al cliente dentro de un negocio: la página
 * pública de reservas la busca para no crear clientes duplicados.
 */

/**
 * Forma normalizada: sin espacios, puntos ni guiones ("1712-345678" → "1712345678"). Las letras
 * se conservan para que la validación las rechace en vez de quitarlas sin avisar.
 */
export function normalizeDocumentId(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, "");
}

/** Lo que se puede escribir en un campo de cédula: sólo dígitos. */
export const onlyDigits = (value: string) => value.replace(/\D/g, "");

/** Largo máximo del campo de cédula según el país del negocio (Ecuador: 10 dígitos). */
export function documentIdMaxLength(timezone: string): number {
  return getTimezoneInfo(timezone).countryCode === "ec" ? 10 : 20;
}

/** Cédula ecuatoriana: 10 dígitos, provincia 01–24 (o 30), tercer dígito < 6 y dígito verificador (módulo 10). */
export function isValidEcuadorianCedula(id: string): boolean {
  if (!/^\d{10}$/.test(id)) return false;
  const province = Number(id.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30) || Number(id[2]) >= 6) return false;
  const sum = [...id.slice(0, 9)].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(id[9]);
}

/**
 * Error de la cédula para un negocio, o null si es válida. En negocios de Ecuador debe tener
 * 10 dígitos y ser una cédula válida (evita duplicados por un dígito mal escrito); en otros
 * países basta con el formato (sólo números, ver documentIdField).
 */
export function documentIdError(documentId: string, timezone: string): string | null {
  if (getTimezoneInfo(timezone).countryCode !== "ec") return null;
  if (!/^\d{10}$/.test(documentId)) return "La cédula debe tener 10 dígitos.";
  return isValidEcuadorianCedula(documentId) ? null : "La cédula no es válida. Revisa el número.";
}
