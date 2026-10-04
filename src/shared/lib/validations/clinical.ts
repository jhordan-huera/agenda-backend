// Copia de agenda-front/src/lib/validations/clinical.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { optionalDigitsField, optionalText, requiredText } from "./fields.ts";

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

/** Evolución. Su fecha la pone la API (hoy, en la zona horaria del negocio): no se puede elegir. */
export const clinicalNoteSchema = z.object({
  appointmentId: z.string().nullable(),
  reason: requiredText("El motivo de consulta", 2, 1000),
  findings: longText,
  diagnosis: optionalText(1000),
  treatment: longText,
  indications: longText,
  nextControl: optionalText(200),
});

export const clinicalAddendumSchema = z.object({
  text: requiredText("La aclaración", 2, 2000),
});

export type ClinicalProfileInput = z.infer<typeof clinicalProfileSchema>;
export type ClinicalNoteInput = z.infer<typeof clinicalNoteSchema>;
export type ClinicalAddendumInput = z.infer<typeof clinicalAddendumSchema>;
