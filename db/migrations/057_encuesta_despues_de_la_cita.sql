-- Encuesta después de la cita (spec 048). Cada negocio la enciende en Configuración → Notificaciones
-- (notificationSettings.surveys, en el JSON de siempre: no hace falta columna). Todo empieza vacío y apagado.

-- 1. Una encuesta por cita: la recibe el paciente principal al día siguiente de una cita Atendida. Se borra con
-- el paciente, con la cita y con el negocio. Las opiniones son privadas: nunca salen del panel.
create table surveys (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  appointment_id  uuid not null unique references appointments (id) on delete cascade,
  client_id       uuid not null references clients (id) on delete cascade,
  professional_id uuid not null references professionals (id) on delete cascade,
  -- El enlace del email (/encuesta/:token), como el de «Tu cita».
  token           text not null unique default replace(gen_random_uuid()::text, '-', ''),
  sent_at         timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  rating          smallint check (rating between 1 and 5),
  comment         text not null default '' check (char_length(comment) <= 1000),
  answered_at     timestamptz,
  check ((rating is null) = (answered_at is null))
);
-- Las opiniones de Reportes (por negocio y fecha de respuesta), las del paciente y la regla de los 90 días.
create index surveys_business_answered_idx on surveys (business_id, answered_at desc) where answered_at is not null;
create index surveys_client_idx on surveys (client_id, sent_at desc);
create index surveys_professional_idx on surveys (professional_id);
alter table surveys enable row level security;

-- 2. «No quiero recibir estas encuestas»: el paciente deja de recibirlas en ese negocio (vacío = las recibe).
alter table clients add column surveys_opted_out_at timestamptz;

-- 3. La campana acepta survey_low: una respuesta de 1 o 2 estrellas, de una cita (el texto sale de la cita y de
-- data.rating al leer; nunca el comentario). Los dos check se quitan y se vuelven a crear (como en la 056).
alter table panel_notices
  drop constraint panel_notices_kind_check,
  drop constraint panel_notices_scope_check;

alter table panel_notices
  add constraint panel_notices_kind_check check (kind in (
    'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
    'waitlist_joined', 'waitlist_slot', 'survey_low',
    'new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt'));

-- Los once del negocio con negocio, los seis de la plataforma sin él (y con su texto).
alter table panel_notices
  add constraint panel_notices_scope_check check (
    (kind in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
              'waitlist_joined', 'waitlist_slot', 'survey_low')
      and business_id is not null and title is null and body is null and url is null)
    or (kind in ('new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt')
      and business_id is null and title is not null and body is not null and url is not null)
  );
