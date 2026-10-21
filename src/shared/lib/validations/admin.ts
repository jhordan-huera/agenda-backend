// Copia de agenda-front/src/lib/validations/admin.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { addMonthsISO, dayOfMonthISO } from "../time.ts";
import { brandColorsSchema, businessCategorySchema, slugSchema, timezoneField } from "./business.ts";
import { dateField, emailField, moneyField, optionalEmailField, optionalText, passwordField, phoneField, requiredText } from "./fields.ts";
import { bankAccountsSchema } from "./payment.ts";
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
  timezone: timezoneField,
  phone: phoneField,
  email: optionalEmailField,
  address: optionalText(200),
  plan: planIdSchema,
  services: z.array(initialServiceSchema).min(1, "Agrega al menos un servicio").max(20, "Máximo 20 servicios"),
  schedules: weeklyScheduleSchema
    .max(7)
    .refine((days) => new Set(days.map((day) => day.dayOfWeek)).size === days.length, "Hay días repetidos en el horario")
    .refine((days) => days.some((day) => day.isActive), "Activa al menos un día de atención"),
  /** «Recomendado por» (spec 023): el negocio que lo recomendó, o null. Queda en la actividad. */
  referredBy: z.string().nullable().default(null),
});

/** «Recomendado por» en la ficha del negocio (spec 023): otro negocio, o null para quitarlo. */
export const referredBySchema = z.object({ referredBy: z.string().nullable() });

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
export type ReferredByInput = z.infer<typeof referredBySchema>;

/** Colores del panel de plataforma del super admin (spec 007); null vuelve a los de Agenda360. */
export const panelColorsSchema = z.object({ colors: brandColorsSchema });
export type PanelColorsInput = z.infer<typeof panelColorsSchema>;

/* ------------------------------------- El cobro de las mensualidades (spec 029) -- */

/** Una fecha que existe ("2026-02-31" no). */
const realDate = dateField.refine((value) => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "Selecciona una fecha");

/**
 * La mensualidad de un negocio, que fija el super admin: el monto en USD (0: sin cobros, como en el plan
 * gratis o un negocio de cortesía), el día del mes en que paga y la fecha del primer cobro, que cae en ese
 * día (o en el último de un mes que no lo tiene). Con mensualidad, el día y el primer cobro son
 * obligatorios. Que el primer cobro no sea anterior a hoy lo comprueba la API, con la zona del negocio.
 */
export const businessBillingSchema = z
  .object({
    monthlyFee: z.coerce
      .number<string | number>("Ingresa la mensualidad")
      .min(0, "La mensualidad no puede ser negativa")
      .max(10_000, "Mensualidad demasiado alta")
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Usa como mucho dos decimales"),
    billingDay: z.number({ error: "Elige el día de pago" }).int("Elige el día de pago").min(1, "Elige un día del 1 al 31").max(31, "Elige un día del 1 al 31").nullable(),
    billingStart: realDate.nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.monthlyFee === 0) return;
    // Sin los dos, la API los pone sola desde el día en que empezó su plan (ver proposedBilling).
    if (data.billingDay === null && data.billingStart === null) return;
    if (data.billingDay === null) ctx.addIssue({ code: "custom", path: ["billingDay"], message: "Elige el día de pago" });
    if (data.billingStart === null) {
      ctx.addIssue({ code: "custom", path: ["billingStart"], message: "Elige la fecha del primer cobro" });
    } else if (data.billingDay !== null && dayOfMonthISO(data.billingStart, data.billingDay) !== data.billingStart) {
      ctx.addIssue({ code: "custom", path: ["billingStart"], message: `El primer cobro tiene que caer en su día de pago (el ${data.billingDay})` });
    }
  });

/**
 * La mensualidad, automática (spec 029, pedido del dueño del producto el 2026-10-20): el día de pago es el
 * día del mes en que empezó su plan (`planStart`, en la zona del negocio), y el primer cobro, al cumplirse
 * el mes (creado el 8 de septiembre, el 8 de octubre). Si ese día ya pasó, el siguiente día de pago desde
 * hoy. En los meses cortos, el último día.
 */
export function proposedBilling(planStart: string, today: string): { billingDay: number; billingStart: string } {
  const billingDay = Number(planStart.slice(8, 10));
  let billingStart = dayOfMonthISO(addMonthsISO(planStart, 1), billingDay);
  while (billingStart < today) billingStart = dayOfMonthISO(addMonthsISO(billingStart, 1), billingDay);
  return { billingDay, billingStart };
}

/** El motivo de rechazar un comprobante o de anular un cobro: le llega al propietario por email. */
export const billingReasonSchema = z.object({ reason: requiredText("El motivo", 3, 300) });

/** «Pagado sin comprobante»: cómo llegó el pago (p. ej. «Efectivo»), sólo para el super admin. */
export const billingPaidSchema = z.object({ note: optionalText(300).default("") });

/** Las cuentas de Agenda360 para recibir las mensualidades: hasta 3, como las de las agendas. */
export const platformBankAccountsSchema = z.object({ bankAccounts: bankAccountsSchema });

/** El filtro de /admin → Cobros (ver AdminBillingFilter): por defecto, los comprobantes por revisar. */
export const adminBillingFilterSchema = z
  .enum(["in_review", "due", "overdue", "paid", "rejected", "void"], { error: "Filtro de cobros no válido" })
  .default("in_review");

export type BusinessBillingInput = z.infer<typeof businessBillingSchema>;
export type BillingReasonInput = z.infer<typeof billingReasonSchema>;
export type BillingPaidInput = z.input<typeof billingPaidSchema>;
export type PlatformBankAccountsInput = z.infer<typeof platformBankAccountsSchema>;
