// Copia de agenda-front/src/lib/validations/auth.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { emailField, passwordField, requiredText } from "./fields.ts";

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Ingresa tu contraseña"),
  remember: z.boolean(),
});

export const registerSchema = z
  .object({
    firstName: requiredText("El nombre"),
    lastName: requiredText("El apellido"),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });


/** Cambio de la propia contraseña: sólo el super admin (las de los usuarios las pone él). */
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

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
