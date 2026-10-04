// Copia de agenda-front/src/lib/validations/service.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { moneyField, optionalText, requiredText } from "./fields.ts";

export const serviceSchema = z.object({
  name: requiredText("El nombre"),
  description: optionalText(500),
  durationMinutes: z.coerce
    .number<string | number>("Ingresa la duración")
    .int("Usa minutos enteros")
    .min(5, "Mínimo 5 minutos")
    .max(480, "Máximo 8 horas"),
  price: moneyField,
  showPrice: z.boolean().default(true),
  location: z.enum(["business", "home", "both"]).default("business"),
  homeVisitFee: moneyField.default(0),
  isActive: z.boolean(),
});

export type ServiceInput = z.infer<typeof serviceSchema>;
