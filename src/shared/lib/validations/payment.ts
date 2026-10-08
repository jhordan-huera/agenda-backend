// Copia de agenda-front/src/lib/validations/payment.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { optionalDigitsField, requiredText } from "./fields.ts";

/** Cuenta a la que le transfieren los pacientes de una agenda. */
export const bankAccountSchema = z.object({
  bank: requiredText("El banco", 2, 60),
  accountType: z.enum(["savings", "checking"], { error: "Elige el tipo de cuenta" }),
  // Se guarda sólo con los dígitos: "2200 1234-56" → "2200123456".
  number: z
    .string()
    .transform((value) => value.replace(/[\s.-]/g, ""))
    .pipe(z.string().min(1, "El número de cuenta es obligatorio").regex(/^\d{4,24}$/, "Escribe el número de cuenta (sólo números)")),
  holder: requiredText("El titular", 2, 80),
  holderId: optionalDigitsField,
});

export type BankAccountInput = z.infer<typeof bankAccountSchema>;

/** Comprobante de pago que sube el paciente (foto de la transferencia o PDF del banco). */
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Un comprobante por cita: enviado, ya no se sube otro (si el paciente se equivocó de archivo, se lo
 * manda al negocio por WhatsApp). Intentos de subida por cita, contando los que no terminaron.
 */
export const RECEIPT_UPLOAD_ATTEMPTS = 5;
/** Meses después de la cita en que se borran sus comprobantes (así el almacenamiento no se llena). */
export const RECEIPT_RETENTION_MONTHS = 3;

export const receiptInputSchema = z.object({
  fileName: requiredText("El nombre del archivo", 1, 200),
  contentType: z.enum(RECEIPT_TYPES, { error: "Sube una foto (JPG, PNG, WebP, HEIC) o un PDF" }),
  sizeBytes: z.number().int().min(1, "El archivo está vacío").max(RECEIPT_MAX_BYTES, "El archivo supera los 10 MB"),
});

export type ReceiptInput = z.infer<typeof receiptInputSchema>;
