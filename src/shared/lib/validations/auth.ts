// Copia de agenda-front/src/lib/validations/auth.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { emailField, passwordField, personNameField } from "./fields.ts";

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Ingresa tu contraseña"),
  remember: z.boolean(),
  /** Sólo después de varios intentos desde una conexión nueva (la API responde «captcha_required»). */
  captchaToken: z.string().max(4096).optional(),
});

export const registerSchema = z
  .object({
    firstName: personNameField("El nombre"),
    lastName: personNameField("El apellido"),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

/**
 * «¿Olvidaste tu contraseña?» (spec 054): el email de la cuenta. La API responde lo mismo exista o no (no revela quién
 * está registrado) y, si existe, le envía una contraseña temporal.
 */
export const forgotPasswordSchema = z.object({
  email: emailField,
  captchaToken: z.string().max(4096).optional(),
});

/**
 * «Crea tu contraseña nueva» (spec 054): después de entrar con una contraseña temporal (la del email o la que puso el
 * soporte). No pide la actual: la API comprueba que la sesión se abrió con una temporal y que la nueva es distinta.
 */
export const newPasswordSchema = z
  .object({
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

/** Cambio de la propia contraseña, con la actual: cualquier cuenta del equipo y el super admin (spec 054). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresa tu contraseña actual"),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "La nueva contraseña debe ser distinta de la actual",
  });

/** Código de la app de autenticación (6 dígitos) o un código de recuperación ("ABCDE-FGHJK"). */
const twoFactorCode = z.string().trim().min(1, "Escribe el código").max(20, "Ese código no es válido");

/** Segundo paso del inicio de sesión (con la verificación en dos pasos activada). */
export const twoFactorLoginSchema = z.object({
  challenge: z.string().min(1).max(200),
  code: twoFactorCode,
});

/** Activar la verificación: el primer código que muestra la app tras escanear el QR. */
export const twoFactorEnableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3}\s?\d{3}$/, "Escribe los 6 dígitos que muestra la app"),
});

/** Confirmar con un código (p. ej. para generar códigos de recuperación nuevos). */
export const twoFactorConfirmSchema = z.object({ code: twoFactorCode });

/** Desactivarla: contraseña y código, para que no baste con una sesión abierta. */
export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, "Ingresa tu contraseña"),
  code: twoFactorCode,
});

/** Para cambiar el email de la cuenta hace falta la contraseña actual. */
export const currentPasswordSchema = z.object({
  currentPassword: z.string({ error: "Escribe tu contraseña actual" }).min(1, "Escribe tu contraseña actual").max(200),
});

/** Modo de pantalla de la propia cuenta (spec 019). */
export const themeModeSchema = z.object({
  mode: z.enum(["light", "dark", "auto"], { error: "Elige Claro, Oscuro o Automático" }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
export type ThemeModeInput = z.infer<typeof themeModeSchema>;
