-- Recordatorios del comprobante de pago (spec 039): antes de su cita, el paciente recibe un email al día para
-- subir el comprobante de la transferencia, como mucho 3 por cita. Todo apagado o vacío: ningún negocio cambia
-- hasta que el super admin lo activa.
--
-- - businesses.payment_reminders: el interruptor «Pedir el comprobante de pago». Sólo lo cambia el super
--   admin, desde la ficha del negocio en /admin (queda en la actividad); el negocio no lo cambia.
-- - businesses.payment_reminder_days: qué días salen, siempre antes de la cita; los elige el super admin: los
--   3 días anteriores a la cita (before_three), los 3 días siguientes a la reserva (after_booking) o los 2 días
--   anteriores y la mañana del mismo día (before_and_morning).
-- - appointments.payment_reminders_sent y payment_reminded_on: cuántos recordatorios salieron de la cita y el
--   último día (en la fecha del negocio). Para el tope de 3 y para no repetir un día. Siguen contando si la
--   cita cambia de fecha.
alter table businesses add column payment_reminders boolean not null default false;
alter table businesses add column payment_reminder_days text not null default 'before_three'
  check (payment_reminder_days in ('before_three', 'after_booking', 'before_and_morning'));

alter table appointments add column payment_reminders_sent smallint not null default 0
  check (payment_reminders_sent between 0 and 3);
alter table appointments add column payment_reminded_on date;
