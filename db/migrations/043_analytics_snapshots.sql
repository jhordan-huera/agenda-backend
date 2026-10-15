-- Analítica del super admin (spec 016): la «foto» diaria con las cifras de cada negocio y de cada tipo
-- de negocio. La prepara el cron de GitHub cada mañana, después de las 06:00 de Ecuador (una para 30
-- días y otra para 90), y la página /admin/analytics sólo la lee: nada se calcula en Vercel.
--
-- Sólo cifras por negocio y por tipo. Los únicos datos personales son el nombre, el teléfono y el email
-- de cada propietario, que el super admin ya ve en la ficha del negocio. Nunca datos de pacientes.
-- El cron borra las fotos de más de 30 días.
create table analytics_snapshots (
  id          uuid primary key default gen_random_uuid(),
  period_days integer not null check (period_days in (30, 90)),
  computed_at timestamptz not null default now(),
  -- El día de la foto, en la hora de Ecuador: una por periodo y día.
  day         date not null,
  -- AnalyticsSnapshot (src/shared/types/index.ts).
  data        jsonb not null,
  unique (period_days, day)
);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table analytics_snapshots enable row level security;
