-- =============================================================================
-- Ejecuciones del cron
-- =============================================================================
-- En Vercel no hay un proceso siempre encendido: el cron de GitHub llama a POST /api/cron/run
-- (recordatorios, reintentos de emails, limpieza). Cada ejecución guarda su resumen: sirve para
-- contar los emails enviados desde la anterior (también los que salen al momento de reservar)
-- y queda como historial. Se conservan 30 días.
create table cron_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  report jsonb not null
);

create index cron_runs_ran_at_idx on cron_runs (ran_at desc);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agendo).
alter table cron_runs enable row level security;
