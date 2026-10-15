// Copia de agenda-front/src/lib/validations/client.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import type { Client, ClientRequiredField, ClientRequiredFields } from "../../types/index.ts";
import {
  optionalDocumentIdField,
  optionalEmailField,
  optionalText,
  phoneField,
  requiredPhoneField,
  requiredText,
} from "./fields.ts";

/** Qué datos del paciente son obligatorios en un negocio (sólo lo cambia el super admin). */
export const clientRequiredFieldsSchema = z.object(
  {
    documentId: z.boolean(),
    email: z.boolean(),
    phone: z.boolean(),
    address: z.boolean(),
  },
  { error: "Indica qué datos del paciente son obligatorios" },
);

/**
 * Ficha del paciente desde el panel, con los datos obligatorios del negocio
 * (Business.clientRequiredFields). El nombre lo es siempre. Lo que se escribe tiene que ser válido
 * aunque sea opcional: la cédula sólo con números (en Ecuador, además, con su dígito verificador: ver
 * documentIdError), el email y el teléfono con su formato. La reserva online tiene su propio esquema
 * (publicBookingSchema): pide siempre cédula, nombre, email y teléfono.
 */
export function clientSchemaFor(required: ClientRequiredFields) {
  return z.object({
    name: requiredText("El nombre"),
    /** Cédula o documento: único por negocio (identifica al cliente en las reservas online). */
    documentId: required.documentId
      ? optionalDocumentIdField.refine((value) => value !== "", "La cédula es obligatoria")
      : optionalDocumentIdField,
    email: required.email
      ? optionalEmailField.refine((value) => value !== "", "El email es obligatorio")
      : optionalEmailField,
    phone: required.phone ? requiredPhoneField : phoneField,
    address: required.address
      ? optionalText(200).refine((value) => value !== "", "La dirección es obligatoria")
      : optionalText(200),
    notes: optionalText(2000),
    isActive: z.boolean(),
  });
}

export type ClientInput = z.infer<ReturnType<typeof clientSchemaFor>>;

/** Los datos que pueden ser obligatorios, en el orden del formulario (el nombre lo es siempre). */
const REQUIRED_FIELD_ORDER: readonly ClientRequiredField[] = ["documentId", "email", "phone", "address"];

/**
 * «Por completar» (spec 012): los datos obligatorios del negocio que le faltan hoy a un paciente, en el
 * orden del formulario. Vacío: está completo. No se guarda en ningún lado: sigue a los datos obligatorios
 * si el super admin los cambia, desaparece sola al completar la ficha y vale también para los pacientes
 * que ya estaban incompletos de antes (un importado, uno de antes de que un dato fuera obligatorio).
 */
export function missingRequiredFields(
  client: Pick<Client, ClientRequiredField>,
  required: ClientRequiredFields,
): ClientRequiredField[] {
  return REQUIRED_FIELD_ORDER.filter((field) => required[field] && client[field].trim() === "");
}
export type ClientRequiredFieldsInput = z.infer<typeof clientRequiredFieldsSchema>;

/**
 * «Es el mismo paciente»: unir un paciente «Por verificar» a la ficha cuya cédula escribió al reservar
 * (spec 009). Con `updateEmail` / `updatePhone`, la ficha se queda con el email o el teléfono nuevos.
 */
export const confirmClaimSchema = z.object({
  updateEmail: z.boolean().default(false),
  updatePhone: z.boolean().default(false),
});

export type ConfirmClaimInput = z.infer<typeof confirmClaimSchema>;
