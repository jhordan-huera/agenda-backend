-- Recordatorios y reintentos de emails:
--   · zonas horarias que no existen → la de Ecuador (rompían el cron de todos los negocios);
--   · cuándo se fijó la fecha y hora de cada cita (al crearla, reprogramarla o reactivarla);
--   · un recordatorio por cada fecha y hora de la cita (antes, uno por cita para siempre);
--   · reintentos con espera creciente (antes, los 5 intentos se gastaban en minutos).

-- Una zona inválida hacía fallar los recordatorios, la agenda y el panel de plataforma. Ahora la API
-- las rechaza; las que ya estaban guardadas pasan a la zona por defecto.
update businesses
   set timezone = 'America/Guayaquil'
 where lower(timezone) not in (select lower(name) from pg_timezone_names);

-- Cuándo se fijó la fecha y hora actual de la cita (al crearla, al moverla o al reactivarla). Si ya
-- estaba dentro de las horas del recordatorio, no se envía: el paciente acaba de recibir la
-- confirmación o el aviso del cambio. Para las citas existentes, su fecha de creación.
alter table appointments add column scheduled_at timestamptz not null default now();
update appointments set scheduled_at = created_at;

-- Un recordatorio por cada fecha y hora de la cita: la clave (dedupe_key, ya única) lleva la cita, su
-- fecha y hora y cuándo se fijaron (ver reminderKeySql en src/services/reminder-rules.ts). Así, al
-- reprogramar o reactivar una cita, puede salir otro para la fecha nueva.
drop index notifications_one_reminder;
update notifications n
   set dedupe_key = 'reminder:' || a.id || ':' || to_char(a.date, 'YYYY-MM-DD') || 'T' || to_char(a.start_time, 'HH24:MI')
                    || ':' || floor(extract(epoch from a.scheduled_at) * 1000)::bigint
  from appointments a
 where n.type = 'appointment_reminder' and n.appointment_id = a.id and n.dedupe_key is null;

-- Próximo intento de envío: tras cada fallo, la espera crece (5 min, 10, 20… hasta unas 10 horas en
-- total). Mientras un proceso envía un email, también sirve de reserva: nadie más lo toma.
alter table notifications add column next_attempt_at timestamptz not null default now();
drop index notifications_queued_idx;
create index notifications_queued_idx on notifications (next_attempt_at) where status = 'queued';
