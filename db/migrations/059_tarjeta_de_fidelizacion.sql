-- Tarjeta de fidelización (spec 052). Cada negocio arma su programa y sus beneficios; cada cita Atendida suma un sello
-- a cada paciente de la cita y, al llegar a un beneficio, se desbloquea su recompensa. El paciente puede tener una
-- cuenta (teléfono y contraseña, aparte de las del equipo) con un QR que el profesional escanea en la cita. Todo empieza
-- vacío y apagado: ningún negocio cambia. Todas las tablas nuevas, con RLS y sin políticas: sólo las usa la API.

-- 1. Las redes del negocio ('' = no la tiene): salen en la página de reservas y en la tarjeta del paciente.
alter table businesses
  add column facebook_url text not null default '',
  add column instagram_url text not null default '',
  add column tiktok_url text not null default '';

-- 2. La cuenta del paciente: global (no de un negocio), con el teléfono en un solo formato (+593…). Se une a la ficha
-- de cada negocio sólo cuando alguien del equipo escanea su QR en persona (loyalty_cards.patient_account_id).
create table patient_accounts (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 80),
  phone                text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  password_hash        text not null,
  -- El QR: /q/:token. El paciente puede pedir otro y el anterior deja de servir.
  qr_token             text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- El último cambio de contraseña con un enlace del consultorio: el aviso al entrar.
  reset_by_business_id uuid references businesses (id) on delete set null,
  reset_at             timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table patient_accounts enable row level security;

-- Sus sesiones, como las del equipo (sessions) pero aparte: una sesión de paciente nunca entra al panel.
create table patient_sessions (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references patient_accounts (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index patient_sessions_account_idx on patient_sessions (account_id);
alter table patient_sessions enable row level security;

-- El enlace para cambiar la contraseña que genera el consultorio: con hash, de un solo uso y por 24 horas.
create table patient_password_links (
  token_hash  text primary key,
  account_id  uuid not null references patient_accounts (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  created_by  uuid references users (id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index patient_password_links_account_idx on patient_password_links (account_id);
create index patient_password_links_business_idx on patient_password_links (business_id);
alter table patient_password_links enable row level security;

-- 3. El programa: uno por negocio. `enabled_at` vacío = apagado; si no, desde cuándo suman las citas Atendidas.
create table loyalty_programs (
  business_id uuid primary key references businesses (id) on delete cascade,
  enabled_at  timestamptz,
  name        text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  stamp_icon  text not null default 'star' check (stamp_icon in
                ('tooth', 'brain', 'heart', 'leaf', 'scissors', 'sparkles', 'hand', 'droplet', 'smile', 'star', 'paw',
                 'stethoscope', 'dumbbell')),
  -- Al ganar el último beneficio: seguir sumando (keep) o empezar una tarjeta nueva y subir de nivel (restart).
  after_last  text not null default 'keep' check (after_last in ('keep', 'restart')),
  updated_at  timestamptz not null default now()
);
alter table loyalty_programs enable row level security;

-- 4. Los beneficios. Uno ya ganado no se borra: se archiva (sus recompensas lo referencian).
create table loyalty_benefits (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  description     text not null default '' check (char_length(description) <= 300),
  visits_required smallint not null check (visits_required between 1 and 100),
  kind            text not null check (kind in ('percent', 'fixed', 'free_appointment', 'free_service', 'custom')),
  value           numeric(10, 2),
  service_id      uuid references services (id) on delete set null,
  conditions      text not null default '' check (char_length(conditions) <= 300),
  valid_days      smallint check (valid_days between 1 and 730),
  is_active       boolean not null default true,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (
    (kind = 'percent' and value > 0 and value <= 100)
    or (kind = 'fixed' and value > 0)
    or (kind not in ('percent', 'fixed') and value is null)
  )
);
-- Dos beneficios activos con las mismas citas, no.
create unique index loyalty_benefits_visits_key on loyalty_benefits (business_id, visits_required)
  where archived_at is null and is_active;
create index loyalty_benefits_business_idx on loyalty_benefits (business_id);
create index loyalty_benefits_service_idx on loyalty_benefits (service_id);
alter table loyalty_benefits enable row level security;

-- 5. La tarjeta del paciente en el negocio: el número de tarjeta (1 Clásica, 2 Plata, 3+ Oro) y su cuenta, si la unió.
create table loyalty_cards (
  client_id          uuid primary key references clients (id) on delete cascade,
  business_id        uuid not null references businesses (id) on delete cascade,
  card_number        smallint not null default 1 check (card_number >= 1),
  patient_account_id uuid references patient_accounts (id) on delete set null,
  linked_at          timestamptz,
  linked_by          uuid references users (id) on delete set null,
  created_at         timestamptz not null default now()
);
-- Una cuenta, como máximo una ficha por negocio.
create unique index loyalty_cards_account_key on loyalty_cards (business_id, patient_account_id)
  where patient_account_id is not null;
create index loyalty_cards_business_idx on loyalty_cards (business_id);
create index loyalty_cards_account_idx on loyalty_cards (patient_account_id);
alter table loyalty_cards enable row level security;

-- 6. Los sellos: una cita Atendida contada para un paciente. Una cita nunca da dos sellos al mismo paciente (la clave).
-- Si el propietario corrige la cita, el sello se anula (voided_at) y queda la constancia.
create table loyalty_stamps (
  appointment_id uuid not null references appointments (id) on delete cascade,
  client_id      uuid not null references clients (id) on delete cascade,
  business_id    uuid not null references businesses (id) on delete cascade,
  card_number    smallint not null check (card_number >= 1),
  counted_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references users (id) on delete set null,
  primary key (appointment_id, client_id)
);
create index loyalty_stamps_client_idx on loyalty_stamps (client_id, card_number);
create index loyalty_stamps_business_idx on loyalty_stamps (business_id);
alter table loyalty_stamps enable row level security;

-- 7. Las recompensas: un beneficio ganado en una tarjeta, con la copia del beneficio tal como era ese día.
-- «Vencida» se calcula con expires_at; «Bloqueada» no es una recompensa.
create table loyalty_rewards (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references businesses (id) on delete cascade,
  client_id               uuid not null references clients (id) on delete cascade,
  -- Sin «on delete»: un beneficio con recompensas no se borra (se archiva). Al borrar el negocio o el paciente, sus
  -- recompensas se van con él.
  benefit_id              uuid not null references loyalty_benefits (id),
  card_number             smallint not null check (card_number >= 1),
  name                    text not null,
  description             text not null default '',
  kind                    text not null check (kind in ('percent', 'fixed', 'free_appointment', 'free_service', 'custom')),
  value                   numeric(10, 2),
  service_id              uuid references services (id) on delete set null,
  service_name            text not null default '',
  conditions              text not null default '',
  visits_required         smallint not null,
  code                    text not null check (code ~ '^[2-9A-HJ-NP-Z]{6}$'),
  unlocked_at             timestamptz not null default now(),
  expires_at              timestamptz,
  status                  text not null default 'available' check (status in ('available', 'redeemed', 'voided')),
  redeemed_at             timestamptz,
  redeemed_by             uuid references users (id) on delete set null,
  redeemed_appointment_id uuid references appointments (id) on delete set null,
  voided_at               timestamptz,
  voided_reason           text,
  unique (business_id, code),
  -- Cada beneficio se gana una sola vez por tarjeta.
  unique (client_id, benefit_id, card_number)
);
create index loyalty_rewards_business_idx on loyalty_rewards (business_id, unlocked_at desc);
create index loyalty_rewards_benefit_idx on loyalty_rewards (benefit_id);
create index loyalty_rewards_appointment_idx on loyalty_rewards (redeemed_appointment_id);
alter table loyalty_rewards enable row level security;
