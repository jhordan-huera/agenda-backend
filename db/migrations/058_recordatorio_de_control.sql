-- Recordatorio de control (spec 051). Cada servicio puede tener «Volver en» y cada negocio enciende el email en
-- Configuración → Notificaciones (notificationSettings.controlReminders, en el JSON de siempre). Todo empieza vacío y
-- apagado: ningún negocio cambia.

-- 1. «Volver en»: los días después de una cita Atendida en que le toca volver al paciente (vacío = No). La fecha es
-- desde cuándo vale ese tiempo: el email nunca sale por controles que ya habían vencido antes.
alter table services
  add column return_after_days smallint check (return_after_days in (7, 14, 30, 60, 90, 180, 365)),
  add column return_after_since timestamptz;

-- 2. Cuándo se encendió el email (vacío = apagado o nunca encendido): tampoco sale por lo que ya había vencido.
alter table businesses add column control_reminders_since timestamptz;

-- 3. «No quiero recibir estos recordatorios»: el paciente deja de recibirlos en ese negocio (vacío = los recibe).
alter table clients add column control_reminders_opted_out_at timestamptz;

-- 4. El control no se guarda: sale de la última cita Atendida del paciente en el servicio. Aquí queda sólo lo que pasó
-- con él, por la cita de la que sale: si se le escribió (con el enlace para no recibir más) o si el equipo lo quitó.
-- Se borra con el paciente, la cita, el servicio y el negocio.
create table control_reminders (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses (id) on delete cascade,
  appointment_id uuid not null unique references appointments (id) on delete cascade,
  client_id      uuid not null references clients (id) on delete cascade,
  service_id     uuid not null references services (id) on delete cascade,
  -- El enlace del email (/recordatorio/:token), como el de la encuesta.
  token          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  emailed_at     timestamptz,
  removed_at     timestamptz,
  removed_by     uuid references users (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (emailed_at is not null or removed_at is not null)
);
create index control_reminders_business_idx on control_reminders (business_id);
create index control_reminders_client_idx on control_reminders (client_id);
create index control_reminders_service_idx on control_reminders (service_id);
alter table control_reminders enable row level security;
