-- Lista de espera (spec 047). Cada negocio la enciende en Configuración → Agenda (bookingSettings.waitlist,
-- en el JSON de siempre: no hace falta columna). Todo empieza vacío y apagado: ningún negocio cambia.

-- 1. Las personas en espera. Las anota el paciente desde la página de reservas o el equipo desde el panel.
-- professional_id vacío: «Cualquiera». client_id: el paciente que eligió el equipo al anotarlo (se borra con él).
create table waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  service_id      uuid not null references services (id) on delete cascade,
  professional_id uuid references professionals (id) on delete cascade,
  client_id       uuid references clients (id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 120),
  email           text,
  phone           text not null default '',
  -- Los días de la semana que le sirven (0 = domingo) y las partes del día (mañana, tarde, noche).
  days            smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  day_parts       text[] not null check (cardinality(day_parts) between 1 and 3 and day_parts <@ array['morning', 'afternoon', 'evening']),
  -- Hasta qué fecha espera: después sale sola de la lista.
  until           date not null,
  source          text not null check (source in ('booking_page', 'dashboard')),
  created_by      uuid references users (id) on delete set null,
  -- El enlace personal de los emails («Salir de la lista» y «Reservar esta hora»), como el de «Tu cita».
  token           text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- El tope de 3 emails de horas libres al día.
  offers_on       date,
  offers_today    smallint not null default 0 check (offers_today between 0 and 3),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz,
  closed_reason   text check (closed_reason in ('booked', 'left', 'removed', 'scheduled', 'expired', 'inactive')),
  check ((closed_at is null) = (closed_reason is null)),
  -- Con algo para avisarle: el email o, desde el panel, al menos el teléfono.
  check (email is not null or phone <> '')
);
-- La lista abierta de cada negocio (el panel y el cron) y el borrado de las cerradas a los 30 días.
create index waitlist_entries_open_idx on waitlist_entries (business_id) where closed_at is null;
create index waitlist_entries_closed_idx on waitlist_entries (closed_at) where closed_at is not null;
-- El mismo email para el mismo servicio y profesional no se repite: se actualiza.
create unique index waitlist_entries_open_email_idx on waitlist_entries (
  business_id, service_id, coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email)
) where closed_at is null and email is not null;
-- Al borrar un servicio, una agenda o un paciente, la cascada busca sus esperas.
create index waitlist_entries_service_idx on waitlist_entries (service_id);
create index waitlist_entries_professional_idx on waitlist_entries (professional_id) where professional_id is not null;
create index waitlist_entries_client_idx on waitlist_entries (client_id) where client_id is not null;
alter table waitlist_entries enable row level security;

-- 2. Las horas que se liberan: las anota el disparador de abajo y el cron las ofrece a quien espera.
create table waitlist_freed_slots (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  professional_id uuid not null references professionals (id) on delete cascade,
  date            date not null,
  start_time      time not null,
  end_time        time not null,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create index waitlist_freed_slots_pending_idx on waitlist_freed_slots (business_id) where processed_at is null;
create index waitlist_freed_slots_processed_idx on waitlist_freed_slots (processed_at) where processed_at is not null;
create index waitlist_freed_slots_professional_idx on waitlist_freed_slots (professional_id);
alter table waitlist_freed_slots enable row level security;

-- 3. Se libera una hora cuando una cita Pendiente o Confirmada se cancela, cambia de fecha, de hora o de
-- agenda, o se borra (también al borrar al paciente, en cascada). Así no se escapa ningún camino del código
-- (editar, mover, la serie, «Tu cita», sin avisar…). Sólo en los negocios activos con la lista encendida y
-- para hoy o después (un día de margen por las zonas horarias: el cron vuelve a mirar la hora del negocio).
create function waitlist_record_freed_slot() returns trigger
language plpgsql as $$
begin
  if old.status not in ('pending', 'confirmed') or old.date < current_date - 1 then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status <> 'cancelled' and new.date = old.date and new.start_time = old.start_time
     and new.end_time = old.end_time and new.professional_id = old.professional_id then
    return null;
  end if;
  if not exists (
    select 1 from businesses b
     where b.id = old.business_id and b.status = 'active'
       and coalesce((b.booking_settings ->> 'waitlist')::boolean, false)
  ) then
    return null;
  end if;
  insert into waitlist_freed_slots (business_id, professional_id, date, start_time, end_time)
  values (old.business_id, old.professional_id, old.date, old.start_time, old.end_time);
  return null;
end;
$$;

create trigger appointments_freed_slot
  after update or delete on appointments
  for each row execute function waitlist_record_freed_slot();

-- 4. La campana acepta dos avisos del negocio: alguien se anotó (waitlist_joined) y se liberó una hora con
-- gente esperando (waitlist_slot). No llevan cita ni nombres: el texto sale de data (la fecha, la hora y la
-- cifra) al leer. Los dos check que nombran los tipos se quitan y se vuelven a crear (como en la 049).
alter table panel_notices
  drop constraint panel_notices_kind_check,
  drop constraint panel_notices_scope_check;

alter table panel_notices
  add constraint panel_notices_kind_check check (kind in (
    'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
    'waitlist_joined', 'waitlist_slot',
    'new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt'));

-- Los diez del negocio con negocio, los seis de la plataforma sin él (y con su texto).
alter table panel_notices
  add constraint panel_notices_scope_check check (
    (kind in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
              'waitlist_joined', 'waitlist_slot')
      and business_id is not null and title is null and body is null and url is null)
    or (kind in ('new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt')
      and business_id is null and title is not null and body is not null and url is not null)
  );
