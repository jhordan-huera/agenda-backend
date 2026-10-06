// Copia de agenda-front/src/lib/validations/booking.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import {
  dateField,
  documentIdField,
  emailField,
  homeVisitSchema,
  optionalEmailField,
  optionalText,
  phoneField,
  requiredPhoneField,
  requiredText,
  timeField,
} from "./fields.ts";

/**
 * Reserva desde la página pública. El cliente se identifica con su cédula: si ya es cliente del
 * negocio, se usan sus datos guardados y nombre, email y teléfono pueden ir vacíos; si es nuevo,
 * la API los exige (ver newClientContactSchema).
 */
export const publicBookingSchema = z
  .object({
    serviceId: z.string().min(1, "Selecciona un servicio"),
    date: dateField,
    startTime: timeField,
    documentId: documentIdField,
    name: optionalText(120),
    email: optionalEmailField,
    phone: phoneField,
    notes: optionalText(500),
    /** null = cita en el local. A domicilio, la ubicación exacta marcada en el mapa es obligatoria. */
    homeVisit: homeVisitSchema.nullable().default(null),
    /** Con quién se atiende; null: el primer profesional libre a esa hora. */
    professionalId: z.string().nullable().default(null),
  })
  .refine((data) => !data.homeVisit || (data.homeVisit.lat !== null && data.homeVisit.lng !== null), {
    path: ["homeVisit", "lat"],
    message: "Marca tu ubicación en el mapa",
  });

/** Datos obligatorios de un cliente nuevo en la reserva online. */
export const newClientContactSchema = z.object({
  name: requiredText("Tu nombre"),
  email: emailField,
  phone: requiredPhoneField,
});

/** Búsqueda del cliente por cédula en la página pública. */
export const clientLookupSchema = z.object({ documentId: documentIdField });

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
