-- La pantalla «Base de datos» del super admin principal (spec 024): el historial del tamaño. El cron de
-- GitHub guarda una foto al día, después de las 06:00 de Ecuador, con lo que ocupa la base, lo que ocupan
-- los archivos de Supabase Storage y las 10 tablas que más ocupan (sólo su nombre y sus bytes). La
-- pantalla muestra los últimos 90 días y, con 7 días o más, cuándo se llenaría.
--
-- Sólo nombres de tablas y cifras: nunca datos de filas. El cron borra las fotos de más de 400 días.
create table database_stats (
  -- El día de la foto, en la hora de Ecuador: una por día.
  day         date primary key,
  size_bytes  bigint not null,
  -- null: sin Supabase Storage (en local los archivos van a una carpeta) o no se pudo medir.
  files_bytes bigint,
  -- [{ "schema": "public", "name": "notifications", "bytes": 123 }, …], de la que más ocupa a la que menos.
  tables      jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table database_stats enable row level security;
