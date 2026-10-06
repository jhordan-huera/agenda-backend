// Copia de agenda-front/src/lib/validations/appointment.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { dateField, homeVisitSchema, moneyField, optionalText, timeField } from "./fields.ts";

export const appointmentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

/** El profesional abrió WhatsApp con el aviso de un cambio de la cita (queda en la actividad). */
export const whatsAppNoticeSchema = z.enum(["confirmed", "cancelled", "rescheduled", "completed", "no_show"]);

export const appointmentSchema = z
  .object({
    clientId: z.string().min(1, "Selecciona un cliente"),
    serviceId: z.string().min(1, "Selecciona un servicio"),
    date: dateField,
    startTime: timeField,
    durationMinutes: z.coerce.number<string | number>().int().min(5, "Duración inválida"),
    price: moneyField,
    status: appointmentStatusSchema,
    notes: optionalText(1000),
    /** null = en el local. */
    homeVisit: homeVisitSchema.nullable().default(null),
    /** Agenda de la cita. Vacío: la de quien la crea o, si el negocio tiene una sola, esa. */
    professionalId: z.string().default(""),
  })
  .refine(
    (data) => {
      const [hours, minutes] = data.startTime.split(":").map(Number);
      return hours * 60 + minutes + data.durationMinutes <= 24 * 60;
    },
    { path: ["durationMinutes"], message: "La cita no puede terminar después de medianoche" },
  );

export type AppointmentInput = z.infer<typeof appointmentSchema>;
