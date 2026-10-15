// Copia de agenda-front/src/lib/validations/push.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { MUTABLE_PUSH_KINDS } from "../constants/push.ts";

/**
 * Avisos en el celular (spec 013): lo que manda el navegador al activarlos. La API comprueba además
 * que la dirección sea de un servicio de avisos conocido y que las claves sirvan (src/services/web-push.ts).
 */

const isWebUrl = (value: string) => {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** La dirección del aparato en el servicio de avisos de su navegador. */
export const pushEndpointSchema = z
  .string({ error: "Falta la dirección del aparato" })
  .trim()
  .min(1, "Falta la dirección del aparato")
  .max(2048, "La dirección del aparato es demasiado larga")
  .refine(isWebUrl, "La dirección del aparato no es válida");

/** Una clave en base64url, como la entrega el navegador (`PushSubscription.toJSON()`). */
const base64UrlKey = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .regex(/^[A-Za-z0-9_-]{16,120}={0,2}$/, message);

/** PUT /api/push/device: activar o actualizar el aparato. */
export const pushDeviceSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object(
    {
      p256dh: base64UrlKey("La clave del aparato no es válida"),
      auth: base64UrlKey("El secreto del aparato no es válido"),
    },
    { error: "Faltan las claves del aparato" },
  ),
  /** La dirección anterior, si el servicio de avisos la renovó: el aparato conserva sus tipos. */
  previousEndpoint: pushEndpointSchema.optional(),
});

export type PushDeviceInput = z.infer<typeof pushDeviceSchema>;

/** PATCH /api/push/device: los tipos apagados en este aparato (nunca el aviso de prueba). */
export const pushKindsSchema = z.object({
  endpoint: pushEndpointSchema,
  mutedKinds: z
    .array(z.enum(MUTABLE_PUSH_KINDS, { error: "Ese tipo de aviso no existe" }), { error: "Indica los tipos de aviso" })
    .max(MUTABLE_PUSH_KINDS.length, "Demasiados tipos de aviso"),
});

export type PushKindsInput = z.infer<typeof pushKindsSchema>;

/** POST /api/push/device/off y /test: el aparato del que se habla. */
export const pushEndpointBodySchema = z.object({ endpoint: pushEndpointSchema });
