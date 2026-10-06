-- Varias agendas (plan Business) y control del equipo:
--   · cada profesional con su ficha, su horario, sus bloqueos y los servicios que atiende;
--   · rol "professional" (sólo su agenda); "staff" pasa a mostrarse como Recepción;
--   · qué pacientes ve un profesional, agendas contratadas, llegada del paciente y avisos al profesional.
-- Los negocios existentes siguen igual: su único profesional se queda con el horario de siempre.

-- Ficha del profesional. El email queda vacío: a los profesionales que ya existían no se les
-- empieza a escribir sin que el negocio lo decida.
alter table professionals
  add column color                   text not null default '#4a6cb0' check (color ~ '^#[0-9a-f]{6}$'),
  add column email                   text not null default '',
  add column all_services            boolean not null default true,
  add column notify_new_appointments boolean not null default true,
  add column daily_agenda            boolean not null default true,
  add column is_active               boolean not null default true,
  add column sort_order              integer not null default 0,
  add column created_at              timestamptz not null default now();
-- Un miembro del equipo usa como mucho una agenda.
create unique index professionals_one_per_user on professionals (business_id, user_id) where user_id is not null;

-- Servicios que atiende un profesional cuando no atiende todos (all_services = false).
create table professional_services (
  professional_id uuid not null references professionals (id) on delete cascade,
  service_id      uuid not null references services (id) on delete cascade,
  primary key (professional_id, service_id)
);
create index professional_services_service_idx on professional_services (service_id);
alter table professional_services enable row level security;

-- Horario por profesional (antes, uno por negocio): el de cada negocio pasa a su profesional.
alter table schedules add column professional_id uuid references professionals (id) on delete cascade;
update schedules s
   set professional_id = (select p.id from professionals p where p.business_id = s.business_id order by p.display_name limit 1);
delete from schedules where professional_id is null;
alter table schedules alter column professional_id set not null;
alter table schedules drop constraint schedules_business_id_day_of_week_key;
alter table schedules add constraint schedules_professional_day_key unique (professional_id, day_of_week);

-- Bloqueos de todo el negocio (null: feriados, cierres) o de un profesional (vacaciones, congreso).
alter table blocked_times add column professional_id uuid references professionals (id) on delete cascade;
create index blocked_times_professional_idx on blocked_times (professional_id) where professional_id is not null;

-- Rol "professional": sólo su agenda, sus pacientes y sus reportes.
alter table business_users drop constraint business_users_role_check;
alter table business_users add constraint business_users_role_check
  check (role in ('owner', 'admin', 'staff', 'professional'));

-- Qué pacientes ve quien tiene el rol Profesional: todos o sólo los suyos.
alter table businesses add column professional_scope text not null default 'all'
  check (professional_scope in ('all', 'own'));

-- Quién registró a cada cliente ("sólo los suyos" incluye los que registró él).
alter table clients add column created_by uuid references users (id) on delete set null;

-- Agendas contratadas en Business: las fija el super admin (null: las del plan).
alter table subscriptions add column max_professionals integer check (max_professionals is null or max_professionals >= 1);

-- Llegada del paciente (recepción la marca al verlo en la sala de espera).
alter table appointments add column arrived_at timestamptz;
create index appointments_professional_date_idx on appointments (professional_id, date);

-- Los pacientes eligen con quién atenderse en la página de reservas.
update businesses set booking_settings = '{"chooseProfessional": true}'::jsonb || booking_settings;

-- Emails que se envían una sola vez (la agenda del día de cada profesional): clave única.
alter table notifications add column dedupe_key text;
create unique index notifications_dedupe_key on notifications (dedupe_key) where dedupe_key is not null;
