// Copia de agenda-front/src/lib/validations/client.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { optionalDocumentIdField, optionalEmailField, optionalText, phoneField, requiredText } from "./fields.ts";

export const clientSchema = z.object({
  name: requiredText("El nombre"),
  /** Cédula o documento: único por negocio (identifica al cliente en las reservas online). */
  documentId: optionalDocumentIdField,
  email: optionalEmailField,
  phone: phoneField,
  address: optionalText(200),
  notes: optionalText(2000),
  isActive: z.boolean(),
});

export type ClientInput = z.infer<typeof clientSchema>;
