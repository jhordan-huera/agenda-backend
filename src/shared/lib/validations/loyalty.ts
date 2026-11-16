// Copia de agenda-front/src/lib/validations/loyalty.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { BENEFIT_KIND_KEYS, LOYALTY_MAX_VALID_DAYS, LOYALTY_MAX_VISITS, STAMP_ICON_KEYS } from "../constants/loyalty.ts";
import { optionalText, passwordField, patientPhoneField, personNameField, requiredText } from "./fields.ts";

/*
 * Tarjeta de fidelización (spec 052): el programa y los beneficios del negocio, la cuenta del paciente y el escaneo
 * del QR. La API comprueba además que el servicio de «Servicio gratis» sea del negocio y que no haya dos beneficios
 * activos con las mismas citas.
 */

export const loyaltyProgramSchema = z.object({
  enabled: z.boolean({ error: "Indica si la tarjeta está encendida" }),
  name: requiredText("El nombre del programa", 2, 60),
  description: optionalText(300).default(""),
  stampIcon: z.enum(STAMP_ICON_KEYS, { error: "Elige el sello" }),
  afterLast: z.enum(["keep", "restart"], { error: "Elige qué pasa al llegar al último beneficio" }),
});

export const loyaltyBenefitSchema = z
  .object({
    name: requiredText("El nombre del beneficio", 2, 80),
    description: optionalText(300).default(""),
    visitsRequired: z
      .number({ error: "Escribe cuántas citas hacen falta" })
      .int("Escribe un número entero de citas")
      .min(1, "Hace falta al menos 1 cita")
      .max(LOYALTY_MAX_VISITS, `Como máximo ${LOYALTY_MAX_VISITS} citas`),
    kind: z.enum(BENEFIT_KIND_KEYS, { error: "Elige el tipo de beneficio" }),
    value: z.number({ error: "Escribe el valor" }).nullable().default(null),
    serviceId: z.string().nullable().default(null),
    conditions: optionalText(300).default(""),
    validDays: z
      .number({ error: "Escribe en cuántos días vence" })
      .int("Escribe un número entero de días")
      .min(1, "Al menos 1 día")
      .max(LOYALTY_MAX_VALID_DAYS, `Como máximo ${LOYALTY_MAX_VALID_DAYS} días`)
      .nullable()
      .default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((benefit, ctx) => {
    if (benefit.kind === "percent" && (benefit.value === null || benefit.value <= 0 || benefit.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "El porcentaje va de 1 a 100" });
    }
    if (benefit.kind === "fixed" && (benefit.value === null || benefit.value <= 0 || benefit.value > 100000)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Escribe el valor del descuento" });
    }
    if (benefit.kind === "free_service" && !benefit.serviceId) {
      ctx.addIssue({ code: "custom", path: ["serviceId"], message: "Elige el servicio gratis" });
    }
  })
  .transform((benefit) => ({
    ...benefit,
    value: benefit.kind === "percent" || benefit.kind === "fixed" ? Math.round((benefit.value ?? 0) * 100) / 100 : null,
    serviceId: benefit.kind === "free_service" ? benefit.serviceId : null,
  }));

/** Canjear: en una cita (la de hoy del paciente) o sin cita. */
export const loyaltyRedeemSchema = z.object({ appointmentId: z.string().nullable().default(null) });

/* -- La cuenta del paciente -- */

const captchaToken = z.string().max(4096).optional();

export const patientSignupSchema = z.object({
  name: personNameField("Tu nombre"),
  phone: patientPhoneField,
  password: passwordField,
  captchaToken,
});

export const patientLoginSchema = z.object({
  phone: patientPhoneField,
  password: z.string({ error: "Escribe tu contraseña" }).min(1, "Escribe tu contraseña").max(200, "Escribe tu contraseña"),
  captchaToken,
});

export const patientPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual").max(200),
  newPassword: passwordField,
});

export const patientResetSchema = z.object({ password: passwordField });

/* -- «Escanear» en el panel -- */

const qrTokenField = z.string().regex(/^[0-9a-f]{32}$/, "Este QR no es de una tarjeta de paciente");

export const scanSchema = z.object({ token: qrTokenField });
export const scanLinkSchema = z.object({ token: qrTokenField, appointmentId: z.string().min(1), clientId: z.string().min(1) });
export const scanCompleteSchema = z.object({ token: qrTokenField, appointmentId: z.string().min(1) });
