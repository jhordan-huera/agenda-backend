// Copia de agenda-front/src/lib/validations/client-import.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { getTimezoneInfo } from "../constants/business.ts";
import { normalizeSearch, plural } from "../format.ts";
import { documentIdError, isValidEcuadorianCedula, normalizeDocumentId } from "../identity.ts";
import type { ClientImportResult, ClientImportRow, ClientRequiredFields } from "../../types/index.ts";
import { clientSchemaFor, missingRequiredFields } from "./client.ts";

/**
 * Importar pacientes desde un Excel o un CSV (spec 012). La revisión del panel y la API ejecutan este
 * mismo código: lo que se ve antes de importar es lo que hace la API (que no se fía y lo vuelve a
 * revisar todo). Cada fila pasa las reglas del formulario del paciente del negocio (clientSchemaFor y
 * documentIdError), salvo que se elija «Importar también los que tienen datos por completar»
 * (ampliación del 2026-10-15): entonces basta el nombre, lo que viene se valida igual y el paciente
 * queda «Por completar» (missingRequiredFields). Los motivos de error nunca repiten el valor de la celda.
 */

/** Filas por importación: con más, se pide partir el archivo. */
export const MAX_IMPORT_ROWS = 5000;
/**
 * Bytes del JSON que manda el panel (medidos con TextEncoder). La API acepta hasta 4 MB en esta ruta
 * y Vercel corta en 4,5 MB; con 5.000 filas normales son cerca de 1 MB.
 */
export const MAX_IMPORT_BYTES = 3_500_000;
/** Largo de cada dato en la petición: lo que pase de aquí rechaza la petición entera (400). */
const MAX_IMPORT_TEXT = 5000;

/** A qué dato del paciente va una columna del archivo. */
export type ImportTarget =
  | "name"
  | "firstNames"
  | "lastNames"
  | "documentId"
  | "email"
  | "phone"
  | "address"
  | "notes"
  /** «Título: valor» en una línea de las notas (p. ej. «Fecha de nacimiento: 12/03/1990»). */
  | "addToNotes"
  | "ignore";

/**
 * Los destinos de una columna, en el orden en que se ofrecen, con los títulos habituales que se
 * reconocen solos (ya pasados por normalizeHeader). Lo que no se reconoce queda en «No importar».
 */
export const IMPORT_COLUMNS: readonly { value: ImportTarget; label: string; headers: readonly string[] }[] = [
  {
    value: "name",
    label: "Nombre completo",
    headers: ["nombre", "nombre completo", "nombres y apellidos", "apellidos y nombres", "paciente", "cliente", "nombre del paciente"],
  },
  { value: "firstNames", label: "Nombres", headers: ["nombres"] },
  { value: "lastNames", label: "Apellidos", headers: ["apellidos", "apellido"] },
  {
    value: "documentId",
    label: "Cédula",
    headers: ["cedula", "ci", "c i", "cedula de identidad", "numero de cedula", "nro cedula", "identificacion", "documento", "dni"],
  },
  { value: "email", label: "Email", headers: ["email", "e mail", "correo", "correo electronico", "mail"] },
  { value: "phone", label: "Teléfono", headers: ["telefono", "celular", "movil", "whatsapp", "telf", "tel", "numero de telefono"] },
  { value: "address", label: "Dirección", headers: ["direccion", "domicilio"] },
  { value: "notes", label: "Notas", headers: ["notas", "nota", "observaciones", "comentarios"] },
  { value: "addToNotes", label: "Añadir a las notas", headers: [] },
  { value: "ignore", label: "No importar", headers: [] },
];

/** Los destinos que se pueden elegir en más de una columna. */
const REPEATABLE_TARGETS: ReadonlySet<ImportTarget> = new Set(["addToNotes", "ignore"]);

/** El título de una columna para compararlo: en minúsculas, sin tildes, sin signos y con los espacios juntos. */
export function normalizeHeader(text: string): string {
  return normalizeSearch(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * El destino sugerido de cada columna por su título, o "ignore". Cada dato sale de una sola columna:
 * si dos lo sugieren, se queda la primera. «Nombre» junto a «Apellido(s)» es la parte de los nombres.
 */
export function guessColumns(headers: readonly string[]): ImportTarget[] {
  const used = new Set<ImportTarget>();
  const guessed = headers.map((header): ImportTarget => {
    const key = normalizeHeader(header);
    const target = IMPORT_COLUMNS.find((column) => column.headers.includes(key))?.value ?? "ignore";
    if (target === "ignore" || used.has(target)) return "ignore";
    used.add(target);
    return target;
  });
  const name = guessed.indexOf("name");
  if (name >= 0 && used.has("lastNames") && !used.has("firstNames") && normalizeHeader(headers[name]) === "nombre") {
    guessed[name] = "firstNames";
  }
  return guessed;
}

/**
 * Elegir un destino en una columna: si es de los que salen de una sola columna y ya lo tenía otra,
 * ésa pasa a «No importar».
 */
export function assignColumn(columns: readonly ImportTarget[], index: number, target: ImportTarget): ImportTarget[] {
  return columns.map((current, i) => {
    if (i === index) return target;
    return current === target && !REPEATABLE_TARGETS.has(target) ? "ignore" : current;
  });
}

/** ¿Hay de dónde sacar el nombre? (completo, o nombres y apellidos): hace falta para seguir. */
export const hasNameColumn = (columns: readonly ImportTarget[]) => columns.includes("name") || columns.includes("firstNames");

/**
 * La fila de títulos: la primera de las 10 primeras con al menos dos títulos reconocidos (así se salta
 * un título como «Lista de pacientes 2025»); si ninguna, la primera con datos. -1: la hoja está vacía.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  for (let index = 0; index < Math.min(rows.length, 10); index++) {
    if (guessColumns(rows[index]).filter((target) => target !== "ignore").length >= 2) return index;
  }
  return rows.findIndex((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * Una fila de la importación desde las celdas de la hoja y el destino de cada columna. «Nombres» y
 * «Apellidos» se unen con un espacio (si hay una columna de nombre completo con datos, manda esa) y cada
 * columna «Añadir a las notas» entra como «Título: valor», en su línea, detrás de la columna Notas.
 */
export function rowFromCells(
  cells: readonly string[],
  headers: readonly string[],
  columns: readonly ImportTarget[],
  row: number,
): ClientImportRow {
  const cell = (index: number) => (cells[index] ?? "").trim();
  const value = (target: ImportTarget) => {
    const index = columns.indexOf(target);
    return index >= 0 ? cell(index) : "";
  };
  const extra = columns.flatMap((target, index) => {
    if (target !== "addToNotes" || !cell(index)) return [];
    const title = (headers[index] ?? "").replace(/\s+/g, " ").trim() || `Columna ${index + 1}`;
    return [`${title}: ${cell(index)}`];
  });
  return {
    row,
    name: value("name") || [value("firstNames"), value("lastNames")].filter(Boolean).join(" "),
    documentId: value("documentId"),
    email: value("email"),
    phone: value("phone"),
    address: value("address"),
    notes: [value("notes"), ...extra].filter(Boolean).join("\n"),
  };
}

/** Todos los datos asignados en blanco: la fila se ignora y no cuenta. */
export const isEmptyImportRow = (row: ClientImportRow) =>
  [row.name, row.documentId, row.email, row.phone, row.address, row.notes].every((value) => value.trim() === "");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
/** Varios teléfonos en una celda: «0991234567 / 042345678», con coma, punto y coma, barra vertical o « y ». */
const PHONE_SEPARATORS = /\s*(?:[/,;|]|\sy\s)\s*/i;
/** Varios emails en una celda: con espacio, coma, punto y coma o barra. */
const EMAIL_SEPARATORS = /[\s,;/]+/;

/**
 * La limpieza de una fila. Se puede aplicar dos veces sin cambiar nada.
 * - Todo recortado y con los espacios seguidos juntos (en las notas, sólo al principio y al final).
 * - La cédula, como en el formulario: sin espacios, puntos ni guiones (las letras quedan, para que la
 *   validación las rechace). En Ecuador, a una de 9 dígitos se le vuelve a poner el 0 que quitó Excel,
 *   sólo si así es una cédula válida.
 * - Con varios teléfonos o emails en la celda, el primero va a su dato y los demás, a las notas.
 * - El punto del teléfono («099.123.4567») pasa a espacio: el formulario no lo admite.
 */
export function prepareImportRow(row: ClientImportRow, timezone: string): ClientImportRow {
  let documentId = normalizeDocumentId(collapse(row.documentId));
  if (getTimezoneInfo(timezone).countryCode === "ec" && /^\d{9}$/.test(documentId) && isValidEcuadorianCedula(`0${documentId}`)) {
    documentId = `0${documentId}`;
  }
  const [phone = "", ...otherPhones] = collapse(row.phone)
    .split(PHONE_SEPARATORS)
    .map((part) => collapse(part.replace(/\./g, " ")))
    .filter(Boolean);
  const [email = "", ...otherEmails] = collapse(row.email).split(EMAIL_SEPARATORS).filter(Boolean);
  return {
    row: row.row,
    name: collapse(row.name),
    documentId,
    email,
    phone,
    address: collapse(row.address),
    notes: [
      row.notes.trim(),
      otherPhones.length > 0 ? `Otros teléfonos: ${otherPhones.join(", ")}` : "",
      otherEmails.length > 0 ? `Otros emails: ${otherEmails.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** El dato de cada campo, para los motivos que no lo nombran («Máximo 200 caracteres»). */
const FIELD_NAMES: Record<string, { label: string; word: string }> = {
  name: { label: "Nombre", word: "nombre" },
  documentId: { label: "Cédula", word: "cedula" },
  email: { label: "Email", word: "email" },
  phone: { label: "Teléfono", word: "telefono" },
  address: { label: "Dirección", word: "direccion" },
  notes: { label: "Notas", word: "notas" },
};

/** El motivo de un error: el mensaje del formulario y, si no nombra el dato, el dato delante. */
function reasonOf(issue: { path: readonly PropertyKey[]; message: string } | undefined): string {
  if (!issue) return "Datos inválidos.";
  const field = FIELD_NAMES[String(issue.path[0])];
  if (!field || normalizeSearch(issue.message).includes(field.word)) return issue.message;
  return `${field.label}: ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
}

/** Un paciente del negocio, para saber si una fila «ya existía». */
export interface ImportExistingClient {
  id: string;
  documentId: string;
  name: string;
  email: string;
  phone: string;
}

export interface ImportClassification extends ClientImportResult {
  /**
   * Las filas que se crean, en el orden del archivo (`created` es cuántas son), con los datos ya
   * limpios y validados, como los guarda el formulario.
   */
  newClients: ClientImportRow[];
}

/** Con «Importar también los que tienen datos por completar», sólo el nombre es obligatorio. */
const NOTHING_REQUIRED: ClientRequiredFields = { documentId: false, email: false, phone: false, address: false };

/**
 * «El mismo paciente» sin la cédula: el nombre (en minúsculas, sin tildes y con los espacios juntos),
 * el email (en minúsculas) y los dígitos del teléfono. Vacío con vacío también coincide.
 */
const personKey = (person: { name: string; email: string; phone: string }) =>
  [normalizeSearch(collapse(person.name)), person.email.trim().toLowerCase(), person.phone.replace(/\D/g, "")].join("|");

/**
 * La clasificación de las filas, en el orden del archivo. Cada fila acaba en una sola categoría:
 * 1. vacía: se ignora y no cuenta;
 * 2. con error: no pasa las reglas del formulario del paciente del negocio;
 * 3. ya existía: su cédula es de un paciente del negocio o, como ese paciente no tiene cédula, coinciden
 *    el nombre, el email y el teléfono (una fila sin cédula, donde es opcional, coincide así con los que
 *    no la tienen). No se cambia nada;
 * 4. repetida: es la misma persona que una fila válida anterior del archivo (la misma regla);
 * 5. tope del plan: ya no queda cupo (`remaining`; null: sin tope);
 * 6. se crea.
 * Con `allowIncomplete` (la casilla «Importar también los que tienen datos por completar»), la fila se
 * valida sin los datos obligatorios del negocio (basta el nombre): lo que trae se valida igual, así que
 * una cédula, un email o un teléfono mal escritos siguen con error. Si se crea y le falta algún dato
 * obligatorio, además queda en `incomplete` con lo que le falta. Sin la opción, todo es como antes de la
 * ampliación: esas filas son errores, con el mismo motivo («La cédula es obligatoria»).
 * `existing` basta con que traiga los pacientes con alguna de las cédulas de las filas y los que no
 * tienen cédula (así lo lee la API); el panel le pasa la lista entera.
 */
export function classifyImportRows(
  rows: readonly ClientImportRow[],
  options: {
    required: ClientRequiredFields;
    timezone: string;
    existing: readonly ImportExistingClient[];
    remaining: number | null;
    allowIncomplete?: boolean;
  },
): ImportClassification {
  const allowIncomplete = options.allowIncomplete ?? false;
  const schema = clientSchemaFor(allowIncomplete ? NOTHING_REQUIRED : options.required);
  const byDocument = new Map<string, string>();
  const withoutDocument = new Map<string, string>();
  for (const client of options.existing) {
    if (client.documentId) byDocument.set(client.documentId, client.id);
    else if (!withoutDocument.has(personKey(client))) withoutDocument.set(personKey(client), client.id);
  }
  const seenDocument = new Map<string, number>();
  const seenWithoutDocument = new Map<string, number>();
  const result: ImportClassification = {
    created: 0,
    newClients: [],
    existing: [],
    repeated: [],
    errors: [],
    overLimit: [],
    incomplete: [],
  };
  for (const raw of rows) {
    const row = prepareImportRow(raw, options.timezone);
    if (isEmptyImportRow(row)) continue;
    const parsed = schema.safeParse({ ...row, isActive: true });
    if (!parsed.success) {
      result.errors.push({ row: row.row, reason: reasonOf(parsed.error.issues[0]) });
      continue;
    }
    const data = parsed.data;
    const documentError = data.documentId ? documentIdError(data.documentId, options.timezone) : null;
    if (documentError) {
      result.errors.push({ row: row.row, reason: documentError });
      continue;
    }
    const key = personKey(data);
    const clientId = (data.documentId ? byDocument.get(data.documentId) : undefined) ?? withoutDocument.get(key);
    if (clientId) {
      result.existing.push({ row: row.row, clientId });
      continue;
    }
    const firstRow = (data.documentId ? seenDocument.get(data.documentId) : undefined) ?? seenWithoutDocument.get(key);
    if (firstRow !== undefined) {
      result.repeated.push({ row: row.row, firstRow });
      continue;
    }
    if (data.documentId) seenDocument.set(data.documentId, row.row);
    else seenWithoutDocument.set(key, row.row);
    if (options.remaining !== null && result.created >= options.remaining) {
      result.overLimit.push(row.row);
      continue;
    }
    result.created++;
    result.newClients.push({
      row: row.row,
      name: data.name,
      documentId: data.documentId,
      email: data.email,
      phone: data.phone,
      address: data.address,
      notes: data.notes,
    });
    const missing = allowIncomplete ? missingRequiredFields(data, options.required) : [];
    if (missing.length > 0) result.incomplete.push({ row: row.row, missing });
  }
  return result;
}

/**
 * El resumen de la actividad (y del aviso de ntfy), sólo con cifras: «Importó 200 pacientes (3 ya
 * existían, 5 con errores, 12 por completar)». Las partes que pasan de cero, en este orden: ya
 * existían, con errores, repetidas en el archivo, por completar (ya cuentan entre los importados) y por
 * el tope del plan.
 */
export function importSummary(result: ClientImportResult): string {
  const parts = [
    result.existing.length > 0 && `${result.existing.length} ${result.existing.length === 1 ? "ya existía" : "ya existían"}`,
    result.errors.length > 0 && `${plural(result.errors.length, "con error", "con errores")}`,
    result.repeated.length > 0 && `${plural(result.repeated.length, "repetida", "repetidas")} en el archivo`,
    result.incomplete.length > 0 && `${result.incomplete.length} por completar`,
    result.overLimit.length > 0 && `${result.overLimit.length} por el tope del plan`,
  ].filter(Boolean);
  return `Importó ${plural(result.created, "paciente", "pacientes")}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

const importText = z
  .string({ error: "Cada dato de una fila debe ser un texto." })
  .max(MAX_IMPORT_TEXT, `Cada dato de una fila puede tener hasta ${MAX_IMPORT_TEXT} caracteres.`)
  .default("");

/** Una fila en la petición: el número de fila de la hoja (la primera es la de los títulos) y sus datos. */
const clientImportRowSchema = z.object(
  {
    row: z
      .number({ error: "Falta el número de fila." })
      .int("El número de fila no es válido.")
      .min(2, "El número de fila no es válido.")
      .max(1_048_576, "El número de fila no es válido."),
    name: importText,
    documentId: importText,
    email: importText,
    phone: importText,
    address: importText,
    notes: importText,
  },
  { error: "Cada fila debe traer su número y sus datos." },
);

/**
 * El cuerpo de POST …/clients/import: todas las filas no vacías, también las que tienen errores, y la
 * casilla «Importar también los que tienen datos por completar» (`includeIncomplete`). Si no viene,
 * vale false: una petición de antes de la ampliación hace lo mismo que entonces.
 */
export const clientImportSchema = z.object(
  {
    rows: z
      .array(clientImportRowSchema, { error: "Faltan las filas de la importación." })
      .min(1, "El archivo no tiene filas con datos.")
      .max(MAX_IMPORT_ROWS, "Como mucho 5.000 filas por importación: parte el archivo en dos.")
      .refine((rows) => new Set(rows.map((row) => row.row)).size === rows.length, "Hay números de fila repetidos."),
    includeIncomplete: z
      .boolean({ error: "Indica si se importan también los que tienen datos por completar." })
      .default(false),
  },
  { error: "Faltan las filas de la importación." },
);

export type ClientImportInput = z.infer<typeof clientImportSchema>;
