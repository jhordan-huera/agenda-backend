-- Citas con varios pacientes (spec 004, p. ej. sesiones de pareja): además del paciente principal
-- (appointments.client_id, el de la reserva y el del pago), una cita puede tener hasta 2 pacientes más.
-- Cada uno recibe sus emails; la hora se ocupa una sola vez (appointments_no_overlap no cambia).
--
-- Sólo en los negocios que el super admin habilite (desde la ficha del negocio en /admin); el negocio
-- no lo cambia. Apagado por defecto: todos los negocios siguen exactamente igual.
alter table businesses add column multi_client_appointments boolean not null default false;

-- Un paciente adicional por fila. Borrar al paciente sólo lo quita de la cita (la cita sigue); borrar la
-- cita (o a su paciente principal, que la borra en cascada) quita a todos.
create table appointment_clients (
  appointment_id uuid not null references appointments (id) on delete cascade,
  client_id      uuid not null references clients (id) on delete cascade,
  business_id    uuid not null references businesses (id) on delete cascade,
  created_at     timestamptz not null default now(),  -- orden en que se muestran
  primary key (appointment_id, client_id)
);
create index appointment_clients_client_idx on appointment_clients (client_id);
alter table appointment_clients enable row level security;

-- Red de seguridad (la API valida antes, con mensajes claros): como mucho 2 adicionales, nunca el
-- paciente principal y todo del mismo negocio. Bloquea la cita para que dos cambios a la vez no pasen
-- del máximo.
create function appointment_clients_check() returns trigger
language plpgsql as $$
declare
  main_client uuid;
  appointment_business uuid;
begin
  select client_id, business_id into main_client, appointment_business
    from appointments where id = new.appointment_id for update;
  if new.client_id = main_client then
    raise exception 'El paciente principal no puede repetirse en la cita' using errcode = 'check_violation';
  end if;
  if new.business_id is distinct from appointment_business
     or not exists (select 1 from clients c where c.id = new.client_id and c.business_id = new.business_id) then
    raise exception 'El paciente y la cita deben ser del mismo negocio' using errcode = 'check_violation';
  end if;
  if (select count(*) from appointment_clients ac
       where ac.appointment_id = new.appointment_id and ac.client_id <> new.client_id) >= 2 then
    raise exception 'Una cita puede tener como máximo 3 pacientes' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger appointment_clients_check before insert or update on appointment_clients
  for each row execute function appointment_clients_check();

-- Si el paciente principal pasa a ser uno de los adicionales, deja de estar dos veces en la cita.
create function appointments_main_client_leaves_extras() returns trigger
language plpgsql as $$
begin
  delete from appointment_clients where appointment_id = new.id and client_id = new.client_id;
  return new;
end;
$$;

create trigger appointments_main_client_leaves_extras after update of client_id on appointments
  for each row when (new.client_id is distinct from old.client_id)
  execute function appointments_main_client_leaves_extras();
