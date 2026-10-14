-- Servicios en pareja o familia y su reserva online (spec 005, fase 2 de las citas con varios
-- pacientes): cada servicio dice para cuántas personas es, y la página de reservas pide los datos de
-- cada una y crea una sola cita con todas (la principal es quien reserva; las demás, en
-- appointment_clients).

-- Personas por sesión: 1 (individual), 2 (pareja) o 3 (familia). Sólo vale en los negocios con
-- multi_client_appointments (lo activa el super admin); sin él, el servicio es individual y el dato se
-- conserva para cuando se vuelva a activar. Los servicios que ya existen quedan en 1.
alter table services add column people_per_session smallint not null default 1
  check (people_per_session between 1 and 3);

-- «Sólo sus pacientes» y las reservas online (como la migración 028 con el paciente principal): una
-- persona que llega como otra paciente de una reserva online, y que ya existía, no le da acceso a su
-- ficha ni a su historia clínica al profesional hasta que la cita la confirme o la gestione alguien del
-- negocio que no sea él (lo hace la API: src/services/agenda-scope.ts). Si no, bastaría con reservarse
-- una sesión de pareja en la página con la cédula y el teléfono de cualquier paciente para abrir su
-- historia. La marca es de cada persona: la de la cita (appointments.client_access_pending) sólo mira
-- al principal.
alter table appointment_clients add column client_access_pending boolean not null default false;

comment on column appointment_clients.client_access_pending is
  'Otra paciente de una reserva online que ya existía y que aún no era del profesional: no le da acceso a su ficha ni a su historia hasta que la gestione el negocio.';

-- La pone la base al guardar a cada persona de una reserva online recién creada (misma transacción que
-- la cita, que crea src/services/public-booking-service.ts), con las mismas reglas que la 028:
--   · paciente creado por esta misma reserva: no tiene historia previa;
--   · paciente que ya era del profesional (lo registró él o tiene otra cita que ya cuenta): nada cambia.
-- En cualquier otro caso, queda pendiente. Lo que agrega el panel nunca es una reserva recién creada.
create function appointment_clients_booking_access() returns trigger
language plpgsql as $$
declare
  booking record;
begin
  select a.source, a.created_at, a.professional_id into booking
    from appointments a where a.id = new.appointment_id;
  if booking.source is distinct from 'booking_page' or booking.created_at <> transaction_timestamp() then
    return new;
  end if;
  new.client_access_pending := not exists (
      select 1 from clients c where c.id = new.client_id and c.created_at = transaction_timestamp()
    )
    and not exists (
      select 1 from clients c join professionals p on p.id = booking.professional_id
       where c.id = new.client_id and p.user_id is not null and c.created_by = p.user_id
    )
    and not exists (
      select 1 from appointments a
       where a.client_id = new.client_id and a.professional_id = booking.professional_id and not a.client_access_pending
    )
    and not exists (
      select 1 from appointment_clients ac join appointments a on a.id = ac.appointment_id
       where ac.client_id = new.client_id and a.professional_id = booking.professional_id
         and not ac.client_access_pending and not a.client_access_pending
    );
  return new;
end;
$$;

create trigger appointment_clients_booking_access before insert on appointment_clients
  for each row execute function appointment_clients_booking_access();

create index appointment_clients_access_pending_idx on appointment_clients (client_id) where client_access_pending;
