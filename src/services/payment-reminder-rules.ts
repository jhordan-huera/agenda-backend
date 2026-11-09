import { PAYMENT_REMINDER_HOUR, PAYMENT_REMINDERS_PER_APPOINTMENT } from "../shared/lib/constants/business.ts";
import { daysBetween, timeToMinutes, type ZonedNow } from "../shared/lib/time.ts";
import type { AppointmentStatus, ISODate, PaymentReminderDays, PaymentReminderMode, TimeString } from "../shared/types/index.ts";
import { QUIET_FROM_MINUTES } from "./reminder-rules.ts";

/**
 * Qué días sale el recordatorio del comprobante de pago de una cita (spec 039). Todo en la fecha y la hora
 * del negocio. Lo usa el paso diario (runPaymentReminderJob, en notifications.ts) y lo prueban las pruebas
 * sin base de datos.
 */

/**
 * La hora en que sale: desde las 9:00 y antes de las horas de silencio de los recordatorios (21:00). El cron
 * pasa cada 10 minutos: el primer paso después de las 9:00 envía los de ese día; si se retrasa, salen más
 * tarde, nunca dos veces (payment_reminded_on y la clave del email).
 */
export const isPaymentReminderTime = (now: ZonedNow) => now.minutes >= PAYMENT_REMINDER_HOUR * 60 && now.minutes < QUIET_FROM_MINUTES;

/**
 * En el modo «Después de la cita», sólo las citas de los últimos 7 días (como el seguimiento de Atendida y No
 * asistió, FOLLOW_UP_DAYS). Así, al activar un negocio, no salen recordatorios de citas de hace meses que nunca
 * se marcaron como pagadas: los 3 recordatorios caben de sobra, uno al día desde el día siguiente a la cita.
 */
export const PAYMENT_REMINDER_AFTER_DAYS = 7;

/** Lo que mira la regla de una cita (con la agenda y el negocio). */
export interface PaymentReminderCandidate {
  mode: PaymentReminderMode;
  days: PaymentReminderDays;
  status: AppointmentStatus;
  date: ISODate;
  startTime: TimeString;
  /** El día en que se reservó o agendó (fecha del negocio de created_at). */
  bookedOn: ISODate;
  sent: number;
  /** El último día en que salió uno (null: ninguno). */
  remindedOn: ISODate | null;
}

/**
 * ¿Le toca hoy? Además de precio, cuentas, sin comprobante ni pago y un paciente principal con email (eso lo
 * filtra la consulta):
 * - como mucho 3 por cita y uno por día; nunca el mismo día de la reserva;
 * - **«Antes de la cita»** (Pendiente o Confirmada), nunca desde que empieza la cita:
 *   - `before_three`: los 3 días anteriores a la cita;
 *   - `after_booking`: los 3 días siguientes a la reserva;
 *   - `before_and_morning`: los 2 días anteriores y el mismo día, si la cita es más tarde;
 * - **«Después de la cita»**: la Completada y la Confirmada que sigue sin cerrar, desde el día siguiente a la
 *   cita, uno por día, hasta PAYMENT_REMINDER_AFTER_DAYS días después.
 */
export function isPaymentReminderDue(appointment: PaymentReminderCandidate, now: ZonedNow): boolean {
  const today = now.date;
  if (appointment.sent >= PAYMENT_REMINDERS_PER_APPOINTMENT) return false;
  if (appointment.remindedOn === today) return false;
  if (daysBetween(appointment.bookedOn, today) < 1) return false;
  const daysToAppointment = daysBetween(today, appointment.date);
  if (appointment.mode === "after") {
    return (
      (appointment.status === "completed" || appointment.status === "confirmed") &&
      daysToAppointment < 0 &&
      daysToAppointment >= -PAYMENT_REMINDER_AFTER_DAYS
    );
  }
  if (appointment.status !== "pending" && appointment.status !== "confirmed") return false;
  // Nunca después de que empiece la cita.
  if (daysToAppointment < 0 || (daysToAppointment === 0 && timeToMinutes(appointment.startTime) <= now.minutes)) return false;
  switch (appointment.days) {
    case "before_three":
      return daysToAppointment >= 1 && daysToAppointment <= 3;
    case "after_booking":
      return daysBetween(appointment.bookedOn, today) <= 3;
    case "before_and_morning":
      return daysToAppointment <= 2;
  }
}
