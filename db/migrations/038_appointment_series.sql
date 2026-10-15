-- Citas que se repiten (spec 011): una serie agrupa las citas que se agendaron juntas desde el panel
-- («cada semana, 8 sesiones»). Cada cita sigue siendo una cita normal; la serie sólo guarda cómo se
-- creó, para la ficha («Cita 3 de 8»), la actividad y los avisos.

-- 1. La serie.
create table appointment_series (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  frequency       text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- Las fechas de la lista (de 2 a 24) y las citas que se crearon (sin las quitadas ni las que chocaron).
  requested_count smallint not null check (requested_count between 2 and 24),
  created_count   smallint not null check (created_count between 1 and requested_count),
  created_by      uuid references users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index appointment_series_created_idx on appointment_series (created_at);
alter table appointment_series enable row level security;

-- 2. La cita: a qué serie pertenece y su número en ella (1, 2, 3…, sin huecos). Sin «on delete»: la
--    app nunca borra una serie sola; al borrar un negocio se borran antes sus citas.
alter table appointments
  add column series_id    uuid references appointment_series (id),
  add column series_index smallint check (series_index between 1 and 24),
  add constraint appointments_series_check check ((series_id is null) = (series_index is null));

create index appointments_series_idx on appointments (series_id, series_index) where series_id is not null;
