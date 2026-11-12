// Copia de agenda-front/src/lib/validations/waitlist.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { dateField, emailField, optionalEmailField, personNameField, phoneField, requiredPhoneField } from "./fields.ts";

/*
 * Lista de espera (spec 047): lo que pide quien espera (los días, las partes del día y hasta cuándo) y sus datos.
 * La API comprueba además que la fecha esté entre mañana y los días hacia adelante del negocio, y que el servicio
 * y el profesional existan y estén activos.
 */

const daysField = z
  .array(z.number().int().min(0).max(6), { error: "Elige al menos un día" })
  .min(1, "Elige al menos un día")
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

const dayPartsField = z
  .array(z.enum(["morning", "afternoon", "evening"]), { error: "Elige mañana, tarde o noche" })
  .min(1, "Elige mañana, tarde o noche")
  .max(3)
  .transform((parts) => [...new Set(parts)]);

const preferences = {
  serviceId: z.string().min(1, "Selecciona un servicio"),
  /** null: «Cualquiera». */
  professionalId: z.string().nullable().default(null),
  days: daysField,
  dayParts: dayPartsField,
  until: dateField,
};

/** Anotarse desde la página de reservas: nombre, email y teléfono, como una reserva (sin la cédula). */
export const publicWaitlistSchema = z.object({
  ...preferences,
  name: personNameField("Tu nombre"),
  email: emailField,
  phone: requiredPhoneField,
});

/** Anotar desde el panel: un paciente que ya existe o datos nuevos; el email es opcional, pero hace falta un contacto. */
export const waitlistEntrySchema = z
  .object({
    ...preferences,
    clientId: z.string().nullable().default(null),
    name: personNameField("El nombre"),
    email: optionalEmailField.default(""),
    phone: phoneField.default(""),
  })
  .refine((data) => data.email !== "" || data.phone !== "", { path: ["phone"], message: "Escribe el email o el teléfono" });

/** Sacar a alguien de la lista desde el panel: «Quitar» o, al guardar su cita, «Agendar». */
export const waitlistCloseSchema = z.object({ reason: z.enum(["removed", "scheduled"]) });

export type PublicWaitlistInput = z.infer<typeof publicWaitlistSchema>;
export type WaitlistEntryInput = z.input<typeof waitlistEntrySchema>;
