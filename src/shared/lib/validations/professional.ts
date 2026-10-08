// Copia de agenda-front/src/lib/validations/professional.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { optionalEmailField, optionalText, requiredText } from "./fields.ts";
import { imageUrlField } from "./images.ts";
import { bankAccountSchema } from "./payment.ts";

/** Ficha de un profesional (su agenda). La crean el propietario y los administradores. */
export const professionalSchema = z
  .object({
    displayName: requiredText("El nombre", 2, 80),
    title: optionalText(80),
    /** Foto: la URL en el almacenamiento de imágenes. */
    avatarUrl: imageUrlField.default(null),
    color: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^#[0-9a-f]{6}$/, "Elige un color"),
    /** A dónde se le avisa de sus citas; vacío: sin avisos. */
    email: optionalEmailField,
    /** Su sala de videollamada para las citas virtuales (Meet, Zoom…); vacío: sin enlace. */
    meetingUrl: z
      .string()
      .trim()
      .max(300, "El enlace es demasiado largo")
      .refine((value) => value === "" || /^https:\/\/\S+$/.test(value), "Pega el enlace completo (empieza con https://)")
      .default(""),
    /** Cuenta para el pago por transferencia; null: no cobra por transferencia. */
    bankAccount: bankAccountSchema.nullable().default(null),
    /** Miembro del equipo que usa esta agenda (null: no entra al sistema). */
    userId: z.string().nullable().default(null),
    allServices: z.boolean(),
    serviceIds: z.array(z.string()).max(200).default([]),
    notifyNewAppointments: z.boolean(),
    dailyAgenda: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((data) => data.allServices || data.serviceIds.length > 0, {
    path: ["serviceIds"],
    message: "Elige al menos un servicio o marca «Todos los servicios»",
  });

export type ProfessionalInput = z.infer<typeof professionalSchema>;
