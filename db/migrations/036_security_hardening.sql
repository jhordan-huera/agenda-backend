-- Endurecimiento de seguridad (spec 009).

-- 1. La tabla de control de las migraciones, con la protección de filas que ya tienen las demás: la
--    API REST automática de Supabase (clave anónima) no la puede leer ni cambiar. migrate.ts ya la
--    crea así en las bases nuevas; ésta es para las que existían antes del 2026-10-09.
alter table if exists schema_migrations enable row level security;

-- 2. Reserva «Por verificar»: si la cédula de una reserva online es de un paciente y no coinciden ni
--    su email ni su teléfono, la reserva crea un paciente aparte (sin cédula, con los datos que se
--    escribieron) que apunta a esa ficha. Nada llega a la ficha real hasta que el negocio lo une a
--    ella. Si se borra la ficha, el paciente aparte queda como uno normal sin cédula.
alter table clients
  add column claimed_client_id uuid references clients(id) on delete set null,
  add constraint clients_claim_check
    check (claimed_client_id is null or (document_id = '' and claimed_client_id <> id));

create index clients_claimed_idx on clients (claimed_client_id) where claimed_client_id is not null;
