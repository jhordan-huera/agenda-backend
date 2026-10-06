// Copia de agenda-front/src/lib/validations/schedule.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { timeToMinutes } from "../time.ts";
import { dateField, requiredText, timeField } from "./fields.ts";

const timeRangeSchema = z
  .object({ start: timeField, end: timeField })
  .refine((range) => range.start < range.end, {
    message: "La hora final debe ser posterior a la inicial",
  });

export const scheduleDaySchema = z
  .object({
    dayOfWeek: z.literal([0, 1, 2, 3, 4, 5, 6]),
    isActive: z.boolean(),
    intervals: z.array(timeRangeSchema),
  })
  .refine((day) => !day.isActive || day.intervals.length > 0, {
    path: ["intervals"],
    message: "Agrega al menos un intervalo",
  })
  .refine(
    (day) => {
      const sorted = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start));
      return sorted.every(
        (range, i) => i === 0 || timeToMinutes(range.start) >= timeToMinutes(sorted[i - 1].end),
      );
    },
    { path: ["intervals"], message: "Los intervalos no pueden solaparse" },
  );

export const weeklyScheduleSchema = z.array(scheduleDaySchema);

export const blockedTimeSchema = z
  .object({
    /** null: todo el negocio; si no, sólo la agenda de ese profesional. */
    professionalId: z.string().nullable().default(null),
    reason: requiredText("El motivo"),
    allDay: z.boolean(),
    startDate: dateField,
    endDate: dateField,
    startTime: z.string(),
    endTime: z.string(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    path: ["endDate"],
    message: "La fecha final debe ser igual o posterior a la inicial",
  })
  .refine((data) => data.allDay || timeField.safeParse(data.startTime).success, {
    path: ["startTime"],
    message: "Indica la hora inicial",
  })
  .refine((data) => data.allDay || timeField.safeParse(data.endTime).success, {
    path: ["endTime"],
    message: "Indica la hora final",
  })
  .refine((data) => data.allDay || data.startTime < data.endTime, {
    path: ["endTime"],
    message: "La hora final debe ser posterior a la inicial",
  });

export type ScheduleDayInput = z.infer<typeof scheduleDaySchema>;
export type BlockedTimeInput = z.infer<typeof blockedTimeSchema>;
