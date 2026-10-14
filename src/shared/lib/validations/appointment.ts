// Copia de agenda-front/src/lib/validations/appointment.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { dateField, homeVisitSchema, optionalText, requiredMoneyField, timeField } from "./fields.ts";

export const appointmentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

/** El profesional abrió WhatsApp con el aviso de un cambio de la cita (queda en la actividad). */
export const whatsAppNoticeSchema = z.enum(["confirmed", "cancelled", "rescheduled", "completed", "no_show", "pending"]);

export const appointmentSchema = z
  .object({
    clientId: z.string().min(1, "Selecciona un cliente"),
    /**
     * Otros pacientes de la sesión (hasta 2). Sin el campo: al crear, ninguno; al editar, se conservan los
     * que tenía (un front anterior no los borra).
     */
    extraClientIds: z.array(z.string().min(1)).max(2, "Una cita puede tener como máximo 3 pacientes.").optional(),
    serviceId: z.string().min(1, "Selecciona un servicio"),
    date: dateField,
    startTime: timeField,
    durationMinutes: z.coerce.number<string | number>().int().min(5, "Duración inválida"),
    /** Vacío no es $0: hay que escribirlo (una cita gratis lleva 0). */
    price: requiredMoneyField,
    status: appointmentStatusSchema,
    notes: optionalText(1000),
    /** null = en el local (o virtual). */
    homeVisit: homeVisitSchema.nullable().default(null),
    /** Por videollamada. */
    isVirtual: z.boolean().default(false),
    /** Agenda de la cita. Vacío: la de quien la crea o, si el negocio tiene una sola, esa. */
    professionalId: z.string().default(""),
  })
  .refine(
    (data) => {
      const [hours, minutes] = data.startTime.split(":").map(Number);
      return hours * 60 + minutes + data.durationMinutes <= 24 * 60;
    },
    { path: ["durationMinutes"], message: "La cita no puede terminar después de medianoche" },
  )
  .refine((data) => !(data.isVirtual && data.homeVisit), { path: ["isVirtual"], message: "Una cita virtual no es a domicilio" })
  .refine(
    (data) => {
      const extra = data.extraClientIds ?? [];
      return new Set(extra).size === extra.length && !extra.includes(data.clientId);
    },
    { path: ["extraClientIds"], message: "Ese paciente ya está en la cita." },
  );

export type AppointmentInput = z.infer<typeof appointmentSchema>;
