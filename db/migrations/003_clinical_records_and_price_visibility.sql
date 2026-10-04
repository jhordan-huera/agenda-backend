-- =============================================================================
-- Historia clínica y precio visible por servicio
-- =============================================================================

-- --------------------------------------------------- Precio visible (sí/no) -
-- Sustituye a price_display (fijo / desde / oculto): un servicio muestra su precio o no.
-- Con precio 0 los clientes tampoco ven ningún precio.
alter table services add column show_price boolean not null default true;
update services set show_price = (price_display <> 'hidden');
alter table services drop column price_display;

-- ------------------------------------------------------- Historia clínica ---
-- Datos de salud (datos sensibles). Sólo los ven el propietario y los miembros que él
-- autoriza; la plataforma (super admin) no tiene acceso. Las evoluciones no se editan ni
-- se borran: se añaden aclaraciones. Un paciente con historia no se puede eliminar.

-- Activada por defecto en negocios de salud.
alter table businesses add column clinical_records_enabled boolean not null default false;
update businesses set clinical_records_enabled = true
 where category in ('psychology', 'speech_therapy', 'dentistry', 'nutrition', 'physiotherapy');

-- El propietario siempre tiene acceso; al resto se lo da él.
alter table business_users add column clinical_access boolean not null default false;
update business_users set clinical_access = true where role = 'owner';

-- Antecedentes: uno por paciente.
create table clinical_profiles (
  business_id       uuid not null references businesses (id) on delete cascade,
  client_id         uuid primary key references clients (id) on delete restrict,
  document_id       text not null default '',
  birth_date        date,
  sex               text not null default '' check (sex in ('', 'female', 'male', 'other')),
  blood_type        text not null default '',
  emergency_contact text not null default '',
  allergies         text not null default '',
  conditions        text not null default '',
  medications       text not null default '',
  surgeries         text not null default '',
  family_history    text not null default '',
  consent_date      date,
  updated_at        timestamptz not null default now(),
  updated_by_name   text not null
);
create index clinical_profiles_business_idx on clinical_profiles (business_id);

-- Evoluciones (una por consulta).
create table clinical_notes (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses (id) on delete cascade,
  client_id      uuid not null references clients (id) on delete restrict,
  appointment_id uuid references appointments (id) on delete set null,
  date           date not null,
  reason         text not null,
  findings       text not null default '',
  diagnosis      text not null default '',
  treatment      text not null default '',
  indications    text not null default '',
  next_control   text not null default '',
  author_id      uuid references users (id) on delete set null,
  author_name    text not null,
  created_at     timestamptz not null default now()
);
create index clinical_notes_client_idx on clinical_notes (business_id, client_id, date desc);

-- Aclaraciones posteriores a una evolución.
create table clinical_note_addenda (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references clinical_notes (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  text        text not null,
  author_id   uuid references users (id) on delete set null,
  author_name text not null,
  created_at  timestamptz not null default now()
);
create index clinical_note_addenda_note_idx on clinical_note_addenda (note_id, created_at);

alter table clinical_profiles     enable row level security;
alter table clinical_notes        enable row level security;
alter table clinical_note_addenda enable row level security;
