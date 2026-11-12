// Copia de agenda-front/src/lib/validations/survey.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { optionalText } from "./fields.ts";

/** La respuesta a la encuesta después de la cita (spec 048): de 1 a 5 estrellas y un comentario opcional. */
export const surveyAnswerSchema = z.object({
  rating: z.coerce
    .number<string | number>({ error: "Elige de 1 a 5 estrellas" })
    .int("Elige de 1 a 5 estrellas")
    .min(1, "Elige de 1 a 5 estrellas")
    .max(5, "Elige de 1 a 5 estrellas"),
  comment: optionalText(1000).default(""),
});

export type SurveyAnswerInput = z.infer<typeof surveyAnswerSchema>;
