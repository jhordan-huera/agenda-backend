// Copia de agenda-front/src/lib/validations/loyalty.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { BENEFIT_KIND_KEYS, LOYALTY_MAX_VALID_DAYS, LOYALTY_MAX_VISITS, STAMP_ICON_KEYS } from "../constants/loyalty.ts";
import { optionalText, patientPhoneField, personNameField, requiredText } from "./fields.ts";

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

/** Las contraseñas más usadas, que se adivinan primero: no se aceptan para la cuenta del paciente. */
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344",
  "password", "password1", "contraseña", "contrasena", "qwertyui", "qwerty123", "abcd1234", "asdfghjk",
  "iloveyou", "teamo123", "ecuador1", "agenda360", "abcd", "qwerty", "hola", "clave", "pass", "1q2w",
]);

/** Los PIN que se prueban primero: con 4 números hay sólo 10.000 y éstos caen en los primeros intentos. */
const COMMON_PINS = new Set(["2580", "0852", "1470", "7410", "3690", "0963", "1357", "2468", "1004", "6969", "5683", "1379", "1397"]);

/**
 * Una contraseña o un PIN demasiado fácil de adivinar: los más usados, un mismo número repetido (0000), una escalera
 * (1234, 9876, 0123), un par repetido (1212, 1122) o un año (1990, 2024).
 */
export function isEasyPassword(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(text) || COMMON_PINS.has(text)) return true;
  if (!/^\d+$/.test(text)) return false;
  if (/^(\d)\1+$/.test(text) || /^(\d\d)\1+$/.test(text) || /^(\d)\1(\d)\2$/.test(text)) return true;
  if (/^(19[3-9]\d|20[0-4]\d)$/.test(text)) return true;
  const steps = [...text].slice(1).map((digit, index) => (Number(digit) - Number(text[index]) + 10) % 10);
  return steps.every((step) => step === 1) || steps.every((step) => step === 9);
}

/**
 * La contraseña de la cuenta del paciente: desde 4 caracteres, así sirve un PIN de 4 números (pedido del dueño). Lo
 * que la protege es el bloqueo creciente al entrar (patient-accounts.ts en la API) y que no se aceptan las fáciles.
 */
export const PATIENT_PASSWORD_MIN = 4;
const patientPasswordField = z
  .string({ error: "Escribe una contraseña o un PIN" })
  .min(PATIENT_PASSWORD_MIN, `Mínimo ${PATIENT_PASSWORD_MIN} caracteres: puede ser un PIN de 4 números`)
  .max(72, "La contraseña es demasiado larga")
  .superRefine((value, ctx) => {
    if (!isEasyPassword(value)) return;
    const pin = /^\d+$/.test(value.trim());
    ctx.addIssue({ code: "custom", message: pin ? "Ese PIN es muy fácil de adivinar: elige otro" : "Esa contraseña es muy fácil de adivinar: elige otra" });
  });

export const patientSignupSchema = z.object({
  // Hasta 80 caracteres, como la cuenta en la base (059).
  name: personNameField("Tu nombre").refine((value) => value.length <= 80, "Tu nombre: máximo 80 caracteres"),
  phone: patientPhoneField,
  password: patientPasswordField,
  captchaToken,
});

export const patientLoginSchema = z.object({
  phone: patientPhoneField,
  password: z.string({ error: "Escribe tu contraseña" }).min(1, "Escribe tu contraseña").max(200, "Escribe tu contraseña"),
  captchaToken,
});

export const patientPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual").max(200),
  newPassword: patientPasswordField,
});

export const patientResetSchema = z.object({ password: patientPasswordField });

/** Eliminar la cuenta pide la contraseña: con una sesión olvidada abierta, nadie la borra de un toque. */
export const patientDeleteSchema = z.object({ password: z.string().min(1, "Escribe tu contraseña").max(200) });

/* -- «Escanear» en el panel -- */

const qrTokenField = z.string().regex(/^[0-9a-f]{32}$/, "Este QR no es de una tarjeta de paciente");

export const scanSchema = z.object({ token: qrTokenField });
/**
 * Unir la cuenta a una ficha: con su cita de hoy (`appointmentId`) o, sin cita, a una ficha con el mismo teléfono
 * que la cuenta (la API lo comprueba).
 */
export const scanLinkSchema = z.object({
  token: qrTokenField,
  appointmentId: z.string().min(1).nullable().default(null),
  clientId: z.string().min(1),
});
/** «Paciente nuevo»: crear su ficha con el teléfono de la cuenta (lo pone la API) y unirla. */
export const scanNewClientSchema = z.object({ token: qrTokenField, client: z.record(z.string(), z.unknown()) });
export const scanCompleteSchema = z.object({ token: qrTokenField, appointmentId: z.string().min(1) });
