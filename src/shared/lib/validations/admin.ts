// Copia de agenda-front/src/lib/validations/admin.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { businessCategorySchema, slugSchema } from "./business.ts";
import { emailField, moneyField, optionalEmailField, optionalText, passwordField, phoneField, requiredText } from "./fields.ts";
import { weeklyScheduleSchema } from "./schedule.ts";
import { teamInviteSchema } from "./team.ts";

export const planIdSchema = z.enum(["free", "pro", "business"], { error: "Selecciona un plan" });
export const businessStatusSchema = z.enum(["active", "suspended"]);

/** Servicio con el que empieza un negocio que crea el super admin (precio 0: no se muestra). */
export const initialServiceSchema = z.object({
  name: requiredText("El nombre del servicio"),
  durationMinutes: z.coerce
    .number<string | number>("Ingresa la duración")
    .int("Usa minutos enteros")
    .min(5, "Mínimo 5 minutos")
    .max(480, "Máximo 8 horas"),
  price: moneyField,
});

/**
 * Alta de un negocio por el super admin: datos, servicios, horario y plan. Sin propietario: su
 * cuenta se agrega después (businessOwnerSchema).
 */
export const adminBusinessSchema = z.object({
  name: requiredText("El nombre del negocio"),
  category: businessCategorySchema,
  slug: slugSchema,
  description: optionalText(400),
  timezone: z.string().min(1, "Selecciona una zona horaria"),
  phone: phoneField,
  email: optionalEmailField,
  address: optionalText(200),
  plan: planIdSchema,
  services: z.array(initialServiceSchema).min(1, "Agrega al menos un servicio").max(20, "Máximo 20 servicios"),
  schedules: weeklyScheduleSchema
    .max(7)
    .refine((days) => new Set(days.map((day) => day.dayOfWeek)).size === days.length, "Hay días repetidos en el horario")
    .refine((days) => days.some((day) => day.isActive), "Activa al menos un día de atención"),
});

/** Propietario de un negocio que aún no lo tiene, con la contraseña que elige el super admin. */
export const businessOwnerSchema = z.object({
  firstName: requiredText("El nombre"),
  lastName: requiredText("El apellido"),
  email: emailField,
  /** Se le envía por email (también si ya tenía una cuenta sin negocio). */
  password: passwordField,
});

/** Categoría de negocio (panel del super admin). */
export const businessCategoryInputSchema = z.object({
  name: requiredText("El nombre", 2, 60),
  icon: z.string().min(1, "Elige un ícono").max(40),
  isHealth: z.boolean(),
  suggestedServiceName: requiredText("El servicio sugerido", 2, 120),
  suggestedServiceDuration: z.coerce
    .number<string | number>("Ingresa la duración")
    .int("Usa minutos enteros")
    .min(5, "Mínimo 5 minutos")
    .max(480, "Máximo 8 horas"),
  suggestedServicePrice: moneyField,
  isActive: z.boolean(),
  sortOrder: z.coerce.number<string | number>().int().min(0).max(9999).default(0),
});

/** Rechazo de una solicitud de cambio de plan (el motivo se envía al propietario). */
export const planRejectionSchema = z.object({ reason: optionalText(300) });

/** Contraseña que el super admin pone a un usuario; se le envía por email. */
export const userPasswordSchema = z.object({ password: passwordField });

/** Miembro del equipo de un negocio, creado por el super admin con la contraseña que elige. */
export const adminMemberSchema = teamInviteSchema.extend({ password: passwordField });

/** Otro super admin para el equipo de soporte, con la contraseña que elige el principal. */
export const platformAdminSchema = adminMemberSchema.omit({ role: true });

/** Eliminar un negocio: hay que escribir su nombre para confirmar. */
export const businessDeletionSchema = z.object({ confirmName: z.string().trim().min(1, "Escribe el nombre del negocio") });

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
/** Lo escrito coincide con el nombre del negocio (sin distinguir mayúsculas ni espacios de más). */
export const isSameBusinessName = (typed: string, name: string) => normalizeName(typed) === normalizeName(name);

export const platformSettingsSchema = z.object({
  allowPublicSignup: z.boolean(),
  supportEmail: emailField,
  supportPhone: phoneField,
});

export type AdminBusinessInput = z.infer<typeof adminBusinessSchema>;
export type InitialServiceInput = z.infer<typeof initialServiceSchema>;
export type BusinessOwnerInput = z.infer<typeof businessOwnerSchema>;
export type PlatformSettingsInput = z.infer<typeof platformSettingsSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
export type PlanRejectionInput = z.infer<typeof planRejectionSchema>;
export type BusinessCategoryInput = z.infer<typeof businessCategoryInputSchema>;
export type AdminMemberInput = z.infer<typeof adminMemberSchema>;
export type PlatformAdminInput = z.infer<typeof platformAdminSchema>;
export type BusinessDeletionInput = z.infer<typeof businessDeletionSchema>;
