// Copia de agenda-front/src/lib/validations/admin.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { businessCategorySchema, slugSchema } from "./business.ts";
import { emailField, moneyField, optionalEmailField, optionalText, passwordField, phoneField, requiredText } from "./fields.ts";
import { teamInviteSchema } from "./team.ts";

export const planIdSchema = z.enum(["free", "pro", "business"], { error: "Selecciona un plan" });
export const businessStatusSchema = z.enum(["active", "suspended"]);

/** Alta de un negocio por el super admin: datos del negocio, propietario y plan. */
export const adminBusinessSchema = z.object({
  name: requiredText("El nombre del negocio"),
  category: businessCategorySchema,
  slug: slugSchema,
  timezone: z.string().min(1, "Selecciona una zona horaria"),
  phone: phoneField,
  email: optionalEmailField,
  address: optionalText(200),
  plan: planIdSchema,
  ownerFirstName: requiredText("El nombre"),
  ownerLastName: requiredText("El apellido"),
  ownerEmail: emailField,
  /** La pone el super admin y se envía al propietario por email (también si ya tenía cuenta). */
  ownerPassword: passwordField,
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
export type PlatformSettingsInput = z.infer<typeof platformSettingsSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
export type PlanRejectionInput = z.infer<typeof planRejectionSchema>;
export type BusinessCategoryInput = z.infer<typeof businessCategoryInputSchema>;
export type AdminMemberInput = z.infer<typeof adminMemberSchema>;
export type BusinessDeletionInput = z.infer<typeof businessDeletionSchema>;
