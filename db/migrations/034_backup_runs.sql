-- Copias de seguridad registradas (spec 006): el inicio del super admin muestra la última (cuándo,
-- su tamaño y si salió bien). Las anota scripts/backup.ts (el workflow semanal de GitHub) al terminar,
-- buenas o fallidas; las de más de un año se borran. El motivo de un fallo va sin URL ni datos.
create table backup_runs (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  ok         boolean not null,
  size_bytes bigint,                    -- archivo cifrado; null si la copia no llegó a hacerse
  error      text not null default ''   -- motivo, si falló o se entregó con problemas
);
create index backup_runs_ran_at_idx on backup_runs (ran_at desc);
alter table backup_runs enable row level security;
