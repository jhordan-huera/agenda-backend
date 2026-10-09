// Copia de agenda-front/src/lib/validations/fields.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { normalizeDocumentId } from "../identity.ts";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Saneamiento: elimina caracteres de control invisibles que no aportan nada a un texto. */
export const stripControlChars = (value: string) =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export const requiredText = (label: string, min = 2, max = 120) =>
  z
    .string()
    .transform(stripControlChars)
    .pipe(
      z
        .string()
        .trim()
        .min(1, `${label} es obligatorio`)
        .min(min, `${label} es demasiado corto`)
        .max(max, `${label} es demasiado largo`),
    );

export const optionalText = (max: number) =>
  z.string().transform(stripControlChars).pipe(z.string().trim().max(max, `Máximo ${max} caracteres`));

export const moneyField = z.coerce
  .number<string | number>("Ingresa un precio")
  .min(0, "El precio no puede ser negativo")
  .max(100_000, "Precio demasiado alto");

/**
 * Precio que hay que indicar: vacío no cuenta como $0 (z.coerce convierte "" en 0). Los números
 * (lo que llega a la API) pasan igual que con moneyField.
 */
export const requiredMoneyField = z
  .custom<string | number>(
    (value) => typeof value === "number" || (typeof value === "string" && value.trim() !== ""),
    "Escribe el precio",
  )
  .pipe(moneyField);

export const emailField = z.string().trim().toLowerCase().pipe(z.email("Ingresa un email válido"));

export const optionalEmailField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value === "" || z.email().safeParse(value).success, "Ingresa un email válido");

export const phoneField = z
  .string()
  .trim()
  .refine((value) => value === "" || /^[+\d][\d\s()-]{6,19}$/.test(value), "Ingresa un teléfono válido");

export const timeField = z.string().regex(TIME_REGEX, "Hora inválida");

/** Cédula: sólo números (sin letras ni guiones). */
const ONLY_DIGITS_MESSAGE = "Escribe sólo números, sin letras ni guiones";
const DOCUMENT_ID_REGEX = /^\d{5,20}$/;

/** Cédula (normalizada: sin espacios, puntos ni guiones). */
export const documentIdField = z
  .string({ error: "Ingresa tu número de cédula" })
  .transform(normalizeDocumentId)
  .pipe(
    z
      .string()
      .min(1, "Ingresa tu número de cédula")
      .regex(/^\d*$/, ONLY_DIGITS_MESSAGE)
      .regex(DOCUMENT_ID_REGEX, "Ingresa un número de cédula válido"),
  );

/** Igual que documentIdField, pero puede quedar vacío (clientes antiguos sin cédula). */
export const optionalDocumentIdField = z
  .string()
  .default("")
  .transform(normalizeDocumentId)
  .refine((value) => /^\d*$/.test(value), ONLY_DIGITS_MESSAGE)
  .refine((value) => value === "" || DOCUMENT_ID_REGEX.test(value), "Ingresa un número de cédula válido");

/** Cédula opcional sin mínimo de largo (antecedentes de la historia clínica). */
export const optionalDigitsField = z.string().trim().max(20, "Máximo 20 dígitos").regex(/^\d*$/, ONLY_DIGITS_MESSAGE);

/** Teléfono obligatorio (reservas online). */
export const requiredPhoneField = z
  .string()
  .trim()
  .min(1, "El teléfono es obligatorio")
  .regex(/^[+\d][\d\s()-]{6,19}$/, "Ingresa un teléfono válido");

/** Mínimo de caracteres de una contraseña nueva (al cambiarla o al definirla con el enlace). */
export const NEW_PASSWORD_MIN_LENGTH = 10;

/**
 * Contraseña nueva de una cuenta: al registrarse, al cambiarla desde el perfil o al definirla con el
 * enlace (bcrypt sólo usa los primeros 72 bytes).
 */
export const newPasswordField = z
  .string({ error: "Escribe una contraseña" })
  .min(NEW_PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${NEW_PASSWORD_MIN_LENGTH} caracteres`)
  .max(72, "La contraseña es demasiado larga");

/** Dirección de una cita a domicilio (las coordenadas vienen del mapa). */
export const homeVisitSchema = z.object({
  address: requiredText("La dirección", 5, 200),
  reference: optionalText(200),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});
export const dateField = z.string().regex(DATE_REGEX, "Selecciona una fecha");
