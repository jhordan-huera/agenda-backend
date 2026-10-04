-- =============================================================================
-- Agendo · Esquema inicial
-- -----------------------------------------------------------------------------
-- Refleja los tipos de src/shared/types/index.ts (camelCase en TS → snake_case aquí).
-- Multi-tenant: toda tabla de negocio lleva business_id. La API comprueba en cada
-- operación que la sesión pertenece al negocio y que su rol tiene permiso.
-- Los límites de cada plan los aplica la API (src/services/plan-limits.ts) dentro de
-- una transacción que bloquea la fila del negocio, así que no pueden saltarse.
-- =============================================================================

create extension if not exists btree_gist;

-- ------------------------------------------------------------- Usuarios -----
create table users (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  email         text not null unique check (email = lower(email)),
  phone         text not null default '',
  avatar_url    text,
  -- 'super_admin' = operador de la plataforma; null = usuario normal.
  platform_role text check (platform_role in ('super_admin')),
  -- false: el super admin desactivó la cuenta (o la quitaron de su equipo).
  is_active     boolean not null default true,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Sesiones de inicio de sesión. La cookie guarda un token aleatorio; aquí sólo su hash.
create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table password_reset_tokens (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Configuración global (una sola fila).
create table platform_settings (
  id                  boolean primary key default true check (id),
  allow_public_signup boolean not null default true,
  support_email       text not null default 'soporte@agendo.app'
);
insert into platform_settings default values;

-- ------------------------------------------------------------- Negocios -----
create table businesses (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references users (id) on delete restrict,
  status                text not null default 'active' check (status in ('active', 'suspended')),
  name                  text not null,
  slug                  text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description           text not null default '',
  category              text not null default 'other' check (category in (
    'psychology', 'speech_therapy', 'dentistry', 'nutrition', 'physiotherapy',
    'training', 'education', 'beauty', 'professional_services', 'other'
  )),
  timezone              text not null default 'America/Guayaquil',
  currency              text not null default 'USD',
  logo_url              text,
  phone                 text not null default '',
  email                 text not null default '',
  address               text not null default '',
  booking_settings      jsonb not null,
  notification_settings jsonb not null,
  created_at            timestamptz not null default now()
);

-- Usuarios de cada negocio y su rol: base del multi-tenant y de los permisos.
create table business_users (
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create unique index business_users_one_owner on business_users (business_id) where role = 'owner';
-- En esta versión cada usuario pertenece a un único negocio.
create unique index business_users_one_business on business_users (user_id);

create table professionals (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses (id) on delete cascade,
  user_id      uuid references users (id) on delete set null,
  display_name text not null,
  title        text not null default '',
  avatar_url   text
);
create index professionals_business_idx on professionals (business_id);

create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null unique references businesses (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status                 text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end     timestamptz,
  -- Al integrar pagos:
  stripe_customer_id     text,
  stripe_subscription_id text
);

-- ---------------------------------------------------- Clientes / servicios --
create table clients (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name        text not null,
  email       text not null default '',
  phone       text not null default '',
  address     text not null default '',
  notes       text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index clients_business_idx on clients (business_id);
create unique index clients_business_email_key on clients (business_id, email) where email <> '';

create table services (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses (id) on delete cascade,
  name             text not null,
  description      text not null default '',
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  price            numeric(10, 2) not null default 0 check (price >= 0),
  -- Cómo ve el cliente el precio: fijo ("$25" / "Gratis"), "Desde $25" u oculto ("Precio a consultar").
  price_display    text not null default 'fixed' check (price_display in ('fixed', 'from', 'hidden')),
  -- Dónde se presta: en el local, a domicilio o en ambos (el cliente elige al reservar).
  location         text not null default 'business' check (location in ('business', 'home', 'both')),
  home_visit_fee   numeric(10, 2) not null default 0 check (home_visit_fee >= 0),  -- recargo a domicilio
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create index services_business_idx on services (business_id);

-- ----------------------------------------------------------------- Citas ----
create table appointments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  client_id       uuid not null references clients (id) on delete cascade,
  service_id      uuid not null references services (id) on delete restrict,
  professional_id uuid not null references professionals (id) on delete restrict,
  date            date not null,           -- fecha en la zona horaria del negocio
  start_time      time not null,
  end_time        time not null,           -- puede ser 24:00 (termina a medianoche)
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes           text not null default '',
  price           numeric(10, 2) not null check (price >= 0),  -- precio congelado al crear la cita
  -- null = en el local. A domicilio: {"address", "reference", "lat", "lng"} (punto marcado en el mapa).
  home_visit      jsonb,
  source          text not null default 'dashboard' check (source in ('dashboard', 'booking_page')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (start_time < end_time),
  time_range tsrange generated always as (tsrange(date + start_time, date + end_time)) stored,
  -- Red de seguridad: un profesional nunca tiene dos citas activas solapadas.
  constraint appointments_no_overlap exclude using gist (
    business_id with =, professional_id with =, time_range with &&
  ) where (status in ('pending', 'confirmed', 'completed'))
);
create index appointments_business_date_idx on appointments (business_id, date);
create index appointments_client_idx on appointments (client_id);
create index appointments_service_idx on appointments (service_id);

-- ------------------------------------------------------ Horarios / bloqueos -
-- Horario de cada día de la semana; `intervals` = [{"start":"08:00","end":"13:00"}, …].
create table schedules (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = domingo
  is_active   boolean not null default false,
  intervals   jsonb not null default '[]',
  unique (business_id, day_of_week)
);

create table blocked_times (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  reason      text not null,
  start_date  date not null,
  end_date    date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check (all_day or (start_time is not null and end_time is not null and start_time < end_time))
);
create index blocked_times_business_dates_idx on blocked_times (business_id, start_date, end_date);

-- -------------------------------------------------- Emails y auditoría ------
-- Bandeja de salida: todos los emails que genera el sistema. Se guardan "queued" en la
-- misma transacción que el cambio que los provoca y src/services/mailer.ts los envía.
create table notifications (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references businesses (id) on delete cascade,  -- null: emails de cuenta
  type           text not null,
  to_email       text not null,
  subject        text not null,
  body           text not null,
  appointment_id uuid references appointments (id) on delete set null,
  status         text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts       integer not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index notifications_queued_idx on notifications (created_at) where status = 'queued';
create index notifications_business_created_idx on notifications (business_id, created_at desc);
create index notifications_created_idx on notifications (created_at desc);
-- Evita recordatorios duplicados para la misma cita.
create unique index notifications_one_reminder on notifications (appointment_id) where type = 'appointment_reminder';

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references businesses (id) on delete cascade,  -- null: acción de plataforma
  actor_id    uuid references users (id) on delete set null,       -- null: reserva online
  actor_name  text not null,
  action      text not null,          -- p. ej. 'appointment.cancelled'
  entity_type text not null,
  entity_id   uuid,
  summary     text not null default '',
  created_at  timestamptz not null default now()
);
create index audit_logs_business_created_idx on audit_logs (business_id, created_at desc);
create index audit_logs_created_idx on audit_logs (created_at desc);

-- ------------------------------------------------------------ Seguridad -----
-- La API (src/) se conecta como dueña de las tablas y no se ve afectada. RLS sin
-- políticas bloquea cualquier otro acceso, p. ej. la API REST automática de Supabase
-- (PostgREST) con la clave anónima: los datos sólo se leen a través de esta API.
alter table users                 enable row level security;
alter table sessions              enable row level security;
alter table password_reset_tokens enable row level security;
alter table platform_settings     enable row level security;
alter table businesses            enable row level security;
alter table business_users        enable row level security;
alter table professionals         enable row level security;
alter table subscriptions         enable row level security;
alter table clients               enable row level security;
alter table services              enable row level security;
alter table appointments          enable row level security;
alter table schedules             enable row level security;
alter table blocked_times         enable row level security;
alter table notifications         enable row level security;
alter table audit_logs            enable row level security;
