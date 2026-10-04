-- =============================================================================
-- Categorías de negocio en la base de datos (antes estaban fijas en el código).
-- Las gestiona el super admin desde el panel /admin → Categorías.
-- =============================================================================
create table business_categories (
  -- Identificador estable que guarda cada negocio (p. ej. 'psychology').
  id                          text primary key check (id ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name                        text not null,
  icon                        text not null default 'shapes',
  -- Negocios de salud: la historia clínica viene activada al crear el negocio.
  is_health                   boolean not null default false,
  -- Primer servicio sugerido al crear un negocio de esta categoría.
  suggested_service_name      text not null,
  suggested_service_duration  integer not null check (suggested_service_duration between 5 and 480),
  suggested_service_price     numeric(10, 2) not null default 0 check (suggested_service_price >= 0),
  -- Las inactivas no se ofrecen a negocios nuevos; los que ya la tienen la conservan.
  is_active                   boolean not null default true,
  sort_order                  integer not null default 0,
  created_at                  timestamptz not null default now()
);
create unique index business_categories_name_key on business_categories (lower(name));

insert into business_categories
  (id, name, icon, is_health, suggested_service_name, suggested_service_duration, suggested_service_price, sort_order)
values
  ('psychology',            'Psicología',              'brain',          true,  'Sesión de terapia',          50, 30, 10),
  ('speech_therapy',        'Fonoaudiología',          'message-circle', true,  'Evaluación fonoaudiológica', 45, 25, 20),
  ('dentistry',             'Odontología',             'smile',          true,  'Consulta odontológica',      30, 20, 30),
  ('nutrition',             'Nutrición',               'apple',          true,  'Consulta nutricional',       45, 25, 40),
  ('physiotherapy',         'Fisioterapia',            'activity',       true,  'Sesión de fisioterapia',     60, 30, 50),
  ('training',              'Entrenamiento',           'dumbbell',       false, 'Entrenamiento personal',     60, 15, 60),
  ('education',             'Educación',               'graduation-cap', false, 'Clase particular',           60, 15, 70),
  ('beauty',                'Belleza',                 'sparkles',       false, 'Corte de cabello',           45, 12, 80),
  ('professional_services', 'Servicios profesionales', 'briefcase',      false, 'Consulta inicial',           60, 25, 90),
  ('other',                 'Otro',                    'shapes',         false, 'Consulta',                   60, 25, 1000);

-- La categoría de cada negocio debe existir en la tabla (sustituye a la lista fija).
alter table businesses drop constraint businesses_category_check;
alter table businesses alter column category drop default;
alter table businesses
  add constraint businesses_category_fkey foreign key (category) references business_categories (id) on update cascade;

alter table business_categories enable row level security;
