// Copia de agenda-front/src/lib/validations/clinical.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import type { ClinicalField, ClinicalFieldValue, ClinicalListRow, ClinicalNoteData } from "../../types/index.ts";
import { optionalDigitsField, optionalText, requiredText, stripControlChars } from "./fields.ts";

const optionalDate = z.string().refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Fecha inválida");
const longText = optionalText(4000);

export const clinicalProfileSchema = z.object({
  documentId: optionalDigitsField,
  birthDate: optionalDate,
  sex: z.enum(["", "female", "male", "other"]),
  bloodType: optionalText(10),
  emergencyContact: optionalText(150),
  allergies: longText,
  conditions: longText,
  medications: longText,
  surgeries: longText,
  familyHistory: longText,
  /**
   * El paciente firmó el consentimiento informado. La fecha la pone la API (hoy) la primera vez
   * y después no se puede cambiar ni quitar.
   */
  consentSigned: z.boolean().default(false),
});

/**
 * Evolución. Su fecha la pone la API (hoy, en la zona horaria del negocio): no se puede elegir.
 * El contenido (`data`) depende de la plantilla: se valida con `clinicalNoteDataSchema`.
 */
export const clinicalNoteSchema = z.object({
  appointmentId: z.string().nullable(),
  templateVersionId: z.string({ error: "Elige el formato de la evolución" }).min(1, "Elige el formato de la evolución"),
  data: z.record(z.string(), z.unknown(), { error: "Contenido de la evolución inválido" }),
});

/* ---------------------------------------------- Contenido según la plantilla ---- */

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 5000;
const MAX_LIST_ROWS = 50;

type Parsed = { value?: ClinicalFieldValue; error?: string };

/** "38,5" → 38.5; "" o null → null; lo que no es número → NaN. */
export function parseClinicalNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return Number.NaN;
  const text = raw.trim().replace(",", ".");
  return text === "" ? null : Number(text);
}

function toText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? stripControlChars(raw).trim() : null;
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function parseListRow(field: Extract<ClinicalField, { type: "list" }>, raw: unknown): { row?: ClinicalListRow; error?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "fila inválida" };
  const source = raw as Record<string, unknown>;
  const row: ClinicalListRow = {};
  let filled = false;
  for (const column of field.columns) {
    if (column.type === "number") {
      const number = parseClinicalNumber(source[column.id]);
      if (Number.isNaN(number)) return { error: `«${column.label}» debe ser un número` };
      row[column.id] = number;
      filled ||= number !== null;
    } else {
      const text = toText(source[column.id]);
      if (text === null) return { error: `«${column.label}» no es válido` };
      if (text.length > MAX_TEXT) return { error: `«${column.label}» admite hasta ${MAX_TEXT} caracteres` };
      row[column.id] = text;
      filled ||= text !== "";
    }
  }
  return filled ? { row } : {};
}

/** Valida y normaliza el valor de un campo. Sin `value`: el campo quedó vacío. */
export function parseClinicalFieldValue(field: ClinicalField, raw: unknown): Parsed {
  const missing = `Completa «${field.label}»`;
  const empty = (): Parsed => (field.required ? { error: missing } : {});
  switch (field.type) {
    case "section":
    case "bmi":
      return {};
    case "text":
    case "textarea": {
      const text = toText(raw);
      if (text === null) return { error: `«${field.label}» no es válido` };
      const max = field.type === "text" ? MAX_TEXT : MAX_LONG_TEXT;
      if (text.length > max) return { error: `«${field.label}» admite hasta ${max} caracteres` };
      return text === "" ? empty() : { value: text };
    }
    case "number":
    case "scale": {
      const number = parseClinicalNumber(raw);
      if (number === null) return empty();
      if (Number.isNaN(number) || !Number.isFinite(number)) return { error: `«${field.label}» debe ser un número` };
      if (field.type === "scale" && !Number.isInteger(number)) return { error: `«${field.label}» debe ser un número entero` };
      if ((field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
        return { error: `«${field.label}» debe estar entre ${field.min ?? "−∞"} y ${field.max ?? "∞"}` };
      }
      return { value: number };
    }
    case "select": {
      const text = toText(raw);
      if (text === null) return { error: `«${field.label}» no es válido` };
      if (text === "") return empty();
      return field.options.includes(text) ? { value: text } : { error: `Opción no válida en «${field.label}»` };
    }
    case "multiselect": {
      if (raw === null || raw === undefined) return empty();
      if (!Array.isArray(raw) || raw.some((option) => typeof option !== "string")) return { error: `«${field.label}» no es válido` };
      const chosen = field.options.filter((option) => raw.includes(option));
      if (chosen.length !== new Set(raw).size) return { error: `Opción no válida en «${field.label}»` };
      return chosen.length === 0 ? empty() : { value: chosen };
    }
    case "boolean":
      if (raw === null || raw === undefined || raw === "") return empty();
      return typeof raw === "boolean" ? { value: raw } : { error: `«${field.label}» no es válido` };
    case "date": {
      const text = toText(raw);
      if (text === null) return { error: `«${field.label}» no es válido` };
      if (text === "") return empty();
      return isIsoDate(text) ? { value: text } : { error: `«${field.label}»: fecha inválida` };
    }
    case "list": {
      if (raw === null || raw === undefined) return empty();
      if (!Array.isArray(raw)) return { error: `«${field.label}» no es válido` };
      if (raw.length > MAX_LIST_ROWS) return { error: `«${field.label}» admite hasta ${MAX_LIST_ROWS} filas` };
      const rows: ClinicalListRow[] = [];
      for (const [index, item] of raw.entries()) {
        const { row, error } = parseListRow(field, item);
        if (error) return { error: `«${field.label}», fila ${index + 1}: ${error}` };
        if (row) rows.push(row);
      }
      return rows.length === 0 ? empty() : { value: rows };
    }
  }
}

/**
 * Esquema del contenido de una evolución para los campos de una plantilla: valida cada campo
 * (errores con la clave del campo), descarta lo vacío o desconocido y exige al menos un dato.
 */
export function clinicalNoteDataSchema(fields: ClinicalField[]) {
  return z
    .record(z.string(), z.unknown())
    .transform((data, ctx): ClinicalNoteData => {
      const result: ClinicalNoteData = {};
      let failed = false;
      for (const field of fields) {
        const { value, error } = parseClinicalFieldValue(field, data[field.id]);
        if (error) {
          failed = true;
          ctx.addIssue({ code: "custom", message: error, path: [field.id] });
        } else if (value !== undefined) {
          result[field.id] = value;
        }
      }
      if (!failed && Object.keys(result).length === 0) {
        ctx.addIssue({ code: "custom", message: "Completa al menos un dato de la evolución.", path: [] });
      }
      return result;
    });
}

/* ------------------------------------------------ Definición de una plantilla ---- */

const fieldId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Id de campo inválido (minúsculas, números y _)");
const label = requiredText("El nombre del campo", 1, 120);
const base = { id: fieldId, label, hint: optionalText(300).optional(), required: z.boolean().optional() };
const options = z.array(requiredText("La opción", 1, 80)).min(1, "Añade al menos una opción").max(30);

const clinicalFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("section") }),
  z.object({ ...base, type: z.enum(["text", "textarea"]), placeholder: optionalText(120).optional() }),
  z.object({
    ...base,
    type: z.literal("number"),
    unit: optionalText(20).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("scale"),
    min: z.number().int(),
    max: z.number().int(),
    minLabel: optionalText(40).optional(),
    maxLabel: optionalText(40).optional(),
  }),
  z.object({ ...base, type: z.enum(["select", "multiselect"]), options }),
  z.object({ ...base, type: z.literal("boolean") }),
  z.object({ ...base, type: z.literal("date") }),
  z.object({
    ...base,
    type: z.literal("list"),
    addLabel: optionalText(60).optional(),
    columns: z
      .array(z.object({ id: fieldId, label, type: z.enum(["text", "number"]), placeholder: optionalText(80).optional() }))
      .min(1, "Añade al menos una columna")
      .max(8),
  }),
  z.object({ ...base, type: z.literal("bmi"), weightField: fieldId, heightField: fieldId }),
]);

/** Campos de una plantilla: ids únicos y referencias válidas (el IMC usa dos campos numéricos). */
export const clinicalTemplateFieldsSchema = z
  .array(clinicalFieldSchema)
  .min(1, "La plantilla necesita al menos un campo")
  .max(80, "Máximo 80 campos")
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (ids.has(field.id)) ctx.addIssue({ code: "custom", message: `Id repetido: ${field.id}`, path: [index, "id"] });
      ids.add(field.id);
      if (field.type === "scale" && field.min >= field.max) {
        ctx.addIssue({ code: "custom", message: `«${field.label}»: el mínimo debe ser menor que el máximo`, path: [index] });
      }
      if (field.type === "list" && new Set(field.columns.map((column) => column.id)).size !== field.columns.length) {
        ctx.addIssue({ code: "custom", message: `«${field.label}»: columnas repetidas`, path: [index, "columns"] });
      }
      if (field.type === "select" || field.type === "multiselect") {
        if (new Set(field.options).size !== field.options.length) {
          ctx.addIssue({ code: "custom", message: `«${field.label}»: opciones repetidas`, path: [index, "options"] });
        }
      }
    }
    for (const [index, field] of fields.entries()) {
      if (field.type !== "bmi") continue;
      for (const ref of [field.weightField, field.heightField]) {
        if (!fields.some((other) => other.id === ref && other.type === "number")) {
          ctx.addIssue({ code: "custom", message: `«${field.label}»: ${ref} no es un campo numérico`, path: [index] });
        }
      }
    }
  });

export const clinicalAddendumSchema = z.object({
  text: requiredText("La aclaración", 2, 2000),
});

export type ClinicalProfileInput = z.infer<typeof clinicalProfileSchema>;
export type ClinicalNoteInput = z.infer<typeof clinicalNoteSchema>;
export type ClinicalAddendumInput = z.infer<typeof clinicalAddendumSchema>;

/** Formato propio de un negocio (planes de pago): nombre, descripción y campos. */
export const clinicalTemplateInputSchema = z.object({
  name: requiredText("El nombre del formato", 2, 80),
  description: optionalText(300),
  fields: clinicalTemplateFieldsSchema,
});

/** Archivo que se va a subir a la historia clínica. */
export const CLINICAL_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
export const CLINICAL_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

export const clinicalAttachmentInputSchema = z.object({
  fileName: requiredText("El nombre del archivo", 1, 200),
  contentType: z.enum(CLINICAL_ATTACHMENT_TYPES, { error: "Sube una imagen (JPG, PNG, WebP, HEIC) o un PDF" }),
  sizeBytes: z
    .number()
    .int()
    .min(1, "El archivo está vacío")
    .max(CLINICAL_ATTACHMENT_MAX_BYTES, "El archivo supera los 15 MB"),
  description: optionalText(200),
});

export type ClinicalTemplateInput = z.infer<typeof clinicalTemplateInputSchema>;
export type ClinicalAttachmentInput = z.infer<typeof clinicalAttachmentInputSchema>;
