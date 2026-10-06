-- El super admin crea el negocio sin su propietario: la cuenta se agrega después
-- (POST /admin/businesses/:id/owner). Mientras tanto owner_id queda en null.
alter table businesses alter column owner_id drop not null;
