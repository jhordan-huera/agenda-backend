// Copia de agenda-front/src/lib/validations/booking.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { dateField, documentIdField, emailField, homeVisitSchema, optionalText, requiredPhoneField, requiredText, timeField } from "./fields.ts";

/**
 * Reserva desde la página pública. El paciente escribe siempre su cédula, nombre, email y teléfono:
 * la página no dice si la cédula ya es de un cliente del negocio. Si lo es, la API sólo une la
 * reserva a esa ficha cuando coinciden el email o el teléfono guardados.
 */
export const publicBookingSchema = z
  .object({
    serviceId: z.string().min(1, "Selecciona un servicio"),
    date: dateField,
    startTime: timeField,
    documentId: documentIdField,
    name: requiredText("Tu nombre"),
    email: emailField,
    phone: requiredPhoneField,
    notes: optionalText(500),
    /** null = cita en el local (o virtual). A domicilio, la ubicación exacta marcada en el mapa es obligatoria. */
    homeVisit: homeVisitSchema.nullable().default(null),
    /** Por videollamada. */
    isVirtual: z.boolean().default(false),
    /** Con quién se atiende; null: el primer profesional libre a esa hora. */
    professionalId: z.string().nullable().default(null),
  })
  .refine((data) => !data.homeVisit || (data.homeVisit.lat !== null && data.homeVisit.lng !== null), {
    path: ["homeVisit", "lat"],
    message: "Marca tu ubicación en el mapa",
  })
  .refine((data) => !(data.isVirtual && data.homeVisit), { path: ["isVirtual"], message: "Una cita virtual no es a domicilio" });

/**
 * Búsqueda por cédula de las versiones anteriores de la página pública. La API la sigue aceptando
 * (una página abierta o guardada sin conexión aún la usa), pero ya no dice si la cédula es de un cliente.
 */
export const clientLookupSchema = z.object({ documentId: documentIdField });

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
