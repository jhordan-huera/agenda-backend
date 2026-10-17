// Copia de agenda-front/src/lib/validations/appointment.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { SERIES_MAX, SERIES_MIN } from "../appointment-series.ts";
import { CLOSE_ALL_MAX, CORRECTABLE_FROM_COMPLETED } from "../constants/appointment-status.ts";
import { dateField, homeVisitSchema, optionalText, requiredMoneyField, stripControlChars, timeField } from "./fields.ts";

export const appointmentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

/** El profesional abrió WhatsApp con el aviso de un cambio de la cita (queda en la actividad). */
export const whatsAppNoticeSchema = z.enum([
  "confirmed",
  "cancelled",
  "rescheduled",
  "completed",
  "no_show",
  "pending",
  "unconfirmed",
  "series_cancelled",
]);

export const appointmentSchema = z
  .object({
    clientId: z.string().min(1, "Selecciona un cliente"),
    /**
     * Otros pacientes de la sesión (hasta 2). Sin el campo: al crear, ninguno; al editar, se conservan los
     * que tenía (un front anterior no los borra).
     */
    extraClientIds: z.array(z.string().min(1)).max(2, "Una cita puede tener como máximo 3 pacientes.").optional(),
    serviceId: z.string().min(1, "Selecciona un servicio"),
    date: dateField,
    startTime: timeField,
    durationMinutes: z.coerce.number<string | number>().int().min(5, "Duración inválida"),
    /** Vacío no es $0: hay que escribirlo (una cita gratis lleva 0). */
    price: requiredMoneyField,
    status: appointmentStatusSchema,
    notes: optionalText(1000),
    /** null = en el local (o virtual). */
    homeVisit: homeVisitSchema.nullable().default(null),
    /** Por videollamada. */
    isVirtual: z.boolean().default(false),
    /** Agenda de la cita. Vacío: la de quien la crea o, si el negocio tiene una sola, esa. */
    professionalId: z.string().default(""),
  })
  .refine(
    (data) => {
      const [hours, minutes] = data.startTime.split(":").map(Number);
      return hours * 60 + minutes + data.durationMinutes <= 24 * 60;
    },
    { path: ["durationMinutes"], message: "La cita no puede terminar después de medianoche" },
  )
  .refine((data) => !(data.isVirtual && data.homeVisit), { path: ["isVirtual"], message: "Una cita virtual no es a domicilio" })
  .refine(
    (data) => {
      const extra = data.extraClientIds ?? [];
      return new Set(extra).size === extra.length && !extra.includes(data.clientId);
    },
    { path: ["extraClientIds"], message: "Ese paciente ya está en la cita." },
  );

export type AppointmentInput = z.infer<typeof appointmentSchema>;

/* ------------------------------------------------- Citas que se repiten (spec 011) -- */

export const seriesFrequencySchema = z.enum(["weekly", "biweekly", "monthly"], { error: "Elige cada cuánto se repite" });

const SERIES_COUNT_MESSAGE = `Elige de ${SERIES_MIN} a ${SERIES_MAX} citas, contando la primera`;

/** «Repetir»: cada cuánto y cuántas citas, de 2 a 24 contando la primera. */
export const seriesRepeatSchema = z.object({
  frequency: seriesFrequencySchema,
  count: z.coerce
    .number<string | number>({ error: SERIES_COUNT_MESSAGE })
    .int(SERIES_COUNT_MESSAGE)
    .min(SERIES_MIN, SERIES_COUNT_MESSAGE)
    .max(SERIES_MAX, SERIES_COUNT_MESSAGE),
});

/**
 * La cita de una serie: la misma de una cita nueva, con el estado sólo Pendiente o Confirmada (una serie
 * es de citas por venir). Que la primera fecha sea desde hoy lo comprueba la API con la zona del negocio.
 */
const seriesAppointmentSchema = appointmentSchema.refine((data) => data.status === "pending" || data.status === "confirmed", {
  path: ["status"],
  message: "Una serie sólo puede quedar pendiente o confirmada.",
});

/** «Revisar fechas»: la lista de fechas de la serie, antes de crearla. */
export const appointmentSeriesPreviewSchema = z.object({
  appointment: seriesAppointmentSchema,
  repeat: seriesRepeatSchema,
});

/** Una fecha de la lista final: su hora (la de la cita o la que se eligió) y si se agenda igual. */
export const seriesDateSchema = z.object({
  date: dateField,
  startTime: timeField,
  /** «Agendar igual» en un bloqueo, un día que no atiende o fuera del horario. */
  allowOutsideHours: z.boolean().default(false),
});

/** «Crear N citas»: lo de la vista previa y las fechas que quedaron en la lista (de 2 a 24, sin repetir). */
export const appointmentSeriesSchema = appointmentSeriesPreviewSchema.extend({
  dates: z
    .array(seriesDateSchema)
    .min(SERIES_MIN, "Para una sola cita, quita «Repetir».")
    .max(SERIES_MAX, `Una serie tiene como máximo ${SERIES_MAX} citas.`)
    .refine((dates) => new Set(dates.map((item) => item.date)).size === dates.length, "Hay una fecha repetida en la lista."),
});

/** «Cancelar ésta y las siguientes»: `notify` es la casilla «Avisar al paciente» de la ficha (spec 008). */
export const cancelFollowingSchema = z.object({
  notify: z.boolean({ error: "Indica si se avisa al paciente" }).default(true),
});

export type SeriesRepeatInput = z.infer<typeof seriesRepeatSchema>;
export type AppointmentSeriesPreviewInput = z.infer<typeof appointmentSeriesPreviewSchema>;
export type AppointmentSeriesInput = z.infer<typeof appointmentSeriesSchema>;

/* ------------------------------------------------- Citas por cerrar (spec 018) -- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El `nextCursor` de la tanda anterior: la fecha, la hora de inicio y el id de la última cita. */
export const TO_CLOSE_CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}\|([01]\d|2[0-3]):[0-5]\d\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los parámetros de la lista «Por cerrar» (GET …/appointments/to-close). */
export const toCloseQuerySchema = z.object({
  cursor: z.string().regex(TO_CLOSE_CURSOR_PATTERN, "La página de citas por cerrar no es válida").optional(),
});

/**
 * «Marcar todas como completadas»: las citas que se ven en la lista. La API sólo cierra las de quien llama
 * que siguen por cerrar. `notify` es la casilla «Avisar a los pacientes», apagada por defecto: es un cierre
 * administrativo de citas que ya pasaron (decisión del dueño del producto, 2026-10-15).
 */
export const closeAllSchema = z.object({
  status: z.literal("completed", { error: "Todas juntas sólo se pueden marcar como completadas" }),
  notify: z.boolean({ error: "Indica si se avisa a los pacientes" }).default(false),
  ids: z
    .array(z.string().regex(UUID_PATTERN, "Hay una cita que no es válida"), { error: "Indica qué citas se cierran" })
    .min(1, "No hay citas por cerrar")
    .max(CLOSE_ALL_MAX, `Se pueden cerrar como mucho ${CLOSE_ALL_MAX} citas a la vez`)
    .refine((ids) => new Set(ids).size === ids.length, "Hay una cita repetida en la lista."),
});

export type CloseAllInput = z.infer<typeof closeAllSchema>;

/* ------------------------------------------ Las citas completadas quedan fijas (spec 020) -- */

/** El motivo de «Corregir estado»: de 10 a 300 caracteres. */
export const CORRECTION_REASON_MIN = 10;
export const CORRECTION_REASON_MAX = 300;

/**
 * «Corregir estado» de una cita completada, sólo del propietario (y del super admin en modo soporte): el
 * estado correcto, el motivo, que queda en la actividad, y `notify`, la casilla «Avisar al paciente», apagada
 * por defecto: es un arreglo interno (decisión del dueño del producto, 2026-10-16).
 */
export const appointmentCorrectionSchema = z.object({
  status: z.enum(CORRECTABLE_FROM_COMPLETED, { error: "Elige el estado correcto: Confirmada, No asistió o Cancelada" }),
  reason: z
    .string({ error: "Escribe el motivo de la corrección" })
    .transform(stripControlChars)
    .pipe(
      z
        .string()
        .trim()
        .min(1, "Escribe el motivo de la corrección")
        .min(CORRECTION_REASON_MIN, `El motivo debe tener al menos ${CORRECTION_REASON_MIN} caracteres`)
        .max(CORRECTION_REASON_MAX, `El motivo puede tener hasta ${CORRECTION_REASON_MAX} caracteres`),
    ),
  notify: z.boolean({ error: "Indica si se avisa al paciente" }).default(false),
});

export type AppointmentCorrectionInput = z.infer<typeof appointmentCorrectionSchema>;
