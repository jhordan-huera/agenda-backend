// Copia de agenda-front/src/lib/validations/team.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { emailField, requiredText } from "./fields.ts";

export const teamRoleSchema = z.enum(["admin", "staff", "professional"], { error: "Selecciona un rol" });

export const teamInviteSchema = z.object({
  firstName: requiredText("El nombre"),
  lastName: requiredText("El apellido"),
  email: emailField,
  role: teamRoleSchema,
});

export type TeamInviteInput = z.infer<typeof teamInviteSchema>;
