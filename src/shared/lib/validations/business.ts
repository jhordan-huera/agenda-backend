// Copia de agenda-front/src/lib/validations/business.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY } from "../constants/business.ts";
import { emailField, optionalEmailField, optionalText, phoneField, requiredText } from "./fields.ts";
import { imageUrlField } from "./images.ts";

/** Categoría del negocio: la API comprueba que exista en la base de datos y esté activa. */
export const businessCategorySchema = z
  .string({ error: "Selecciona el tipo de negocio" })
  .trim()
  .min(1, "Selecciona el tipo de negocio")
  .max(60, "Categoría inválida");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Mínimo 3 caracteres")
  .max(40, "Máximo 40 caracteres")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa sólo minúsculas, números y guiones");

export const profileSchema = z.object({
  firstName: requiredText("El nombre"),
  lastName: requiredText("El apellido"),
  email: emailField,
  phone: phoneField,
  avatarUrl: imageUrlField,
});

export const businessProfileSchema = z.object({
  name: requiredText("El nombre del negocio"),
  description: optionalText(400),
  category: businessCategorySchema,
  slug: slugSchema,
  timezone: z.string().min(1, "Selecciona una zona horaria"),
  phone: phoneField,
  email: optionalEmailField,
  address: optionalText(200),
  /** Punto del local en el mapa: los dos o ninguno (null). */
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  logoUrl: imageUrlField,
});

export const bookingSettingsSchema = z.object({
  alignSlotsToDuration: z.boolean(),
  slotIntervalMinutes: z.coerce.number<string | number>().int().min(5).max(240),
  minNoticeHours: z.coerce
    .number<string | number>("Ingresa un número")
    .int("Usa horas enteras")
    .min(0, "No puede ser negativo")
    .max(720, "Máximo 720 horas (30 días)"),
  maxAdvanceDays: z.coerce
    .number<string | number>("Ingresa un número")
    .int("Usa días enteros")
    .min(1, "Mínimo 1 día")
    .max(365, "Máximo 365 días"),
  allowCancellations: z.boolean(),
  cancellationNoticeHours: z.coerce
    .number<string | number>("Ingresa un número")
    .int("Usa horas enteras")
    .min(0, "No puede ser negativo")
    .max(168, "Máximo 168 horas"),
  cancellationPolicy: optionalText(500),
  // Con valor por defecto: los negocios guardados antes no lo traen.
  maxClientBookingsPerDay: z.coerce
    .number<string | number>()
    .int()
    .min(0, "No puede ser negativo")
    .max(10, "Máximo 10 citas por día")
    .default(DEFAULT_MAX_CLIENT_BOOKINGS_PER_DAY),
  chooseProfessional: z.boolean().default(true),
});

/** Qué pacientes ve quien tiene el rol Profesional. */
export const professionalScopeSchema = z.enum(["all", "own"], { error: "Elige qué pacientes ve cada profesional" });

const hexColorField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Escribe el color como #RRGGBB");

/** Colores de marca; null vuelve a los de Agenda360. */
export const brandColorsSchema = z.object({ primary: hexColorField, highlight: hexColorField }).nullable();

export const notificationSettingsSchema = z.object({
  confirmations: z.boolean(),
  reminders: z.boolean(),
  cancellations: z.boolean(),
  reminderHoursBefore: z.number().int().min(1).max(72),
  // Con valor por defecto: los negocios guardados antes de los avisos por WhatsApp no los traen.
  whatsappOnStatusChange: z.boolean().default(true),
  whatsappFollowUps: z.boolean().default(true),
});

/** Datos del negocio pedidos en el onboarding (pasos 1–3). */
export const onboardingSchema = z.object({
  name: requiredText("El nombre del negocio"),
  category: businessCategorySchema,
  timezone: z.string().min(1, "Selecciona una zona horaria"),
  phone: phoneField,
  email: optionalEmailField,
  address: optionalText(200),
  description: optionalText(400),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
export type BookingSettingsInput = z.infer<typeof bookingSettingsSchema>;
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
