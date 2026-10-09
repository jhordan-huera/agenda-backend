-- Seguridad de cuentas, roles y sesiones:
--   · historias clínicas: una reserva online no da acceso al paciente a un profesional con «sólo sus pacientes»;
--   · enlaces de un solo uso para que cada usuario defina su contraseña (ya no se envían contraseñas);
--   · sesiones con caducidad por inactividad.

-- -------------------------------------------- Reservas online y «sólo sus pacientes» ----
-- Un profesional con «sólo sus pacientes» ve a los clientes que registró él o que tienen citas en su
-- agenda. Antes bastaba con reservarse una cita desde la página pública con la cédula de cualquier
-- paciente del negocio para ver su ficha y su historia clínica. Ahora esa cita no da acceso
-- (client_access_pending) hasta que la confirme o la gestione alguien que no sea el profesional
-- (propietario, administrador o recepción): lo hace la API (src/services/agenda-scope.ts).
-- Las citas que ya existían no cambian.
alter table appointments add column client_access_pending boolean not null default false;

comment on column appointments.client_access_pending is
  'Reserva online de un cliente que ya existía y que aún no era del profesional: no le da acceso a su ficha ni a su historia hasta que la gestione el negocio.';

-- La marca la pone la base al guardar cada reserva online (la crea src/services/public-booking-service.ts):
--   · cliente creado por esta misma reserva (misma transacción, misma hora): no tiene historia previa;
--   · cliente que ya era del profesional (lo registró él o tiene otra cita que ya cuenta): nada cambia.
-- En cualquier otro caso, la cita queda pendiente.
create function appointments_booking_client_access() returns trigger
language plpgsql as $$
begin
  new.client_access_pending := not exists (
      select 1 from clients c where c.id = new.client_id and c.created_at = transaction_timestamp()
    )
    and not exists (
      select 1 from clients c join professionals p on p.id = new.professional_id
       where c.id = new.client_id and p.user_id is not null and c.created_by = p.user_id
    )
    and not exists (
      select 1 from appointments a
       where a.client_id = new.client_id and a.professional_id = new.professional_id and not a.client_access_pending
    );
  return new;
end;
$$;

create trigger appointments_booking_client_access before insert on appointments
  for each row when (new.source = 'booking_page') execute function appointments_booking_client_access();

create index appointments_client_access_pending_idx on appointments (professional_id, client_id) where client_access_pending;

-- --------------------------------------------- Enlaces para definir la contraseña ----
-- El super admin ya no elige ni ve contraseñas: al crear una cuenta (o cuando alguien la olvida)
-- se envía un enlace de un solo uso para que la persona la defina. Aquí sólo el hash SHA-256 del
-- token (32 bytes aleatorios); caduca a los 60 minutos y queda marcado al usarse.
create table password_setup_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index password_setup_tokens_user_idx on password_setup_tokens (user_id);

-- Como el resto: la API REST de Supabase (clave anónima) no puede leerla.
alter table password_setup_tokens enable row level security;

-- ----------------------------------------------------------------- Sesiones ----
-- Caducidad por inactividad: sin «Recordarme», 12 horas sin uso (y como mucho 24 desde que se
-- inició); con «Recordarme», 14 días que se renuevan con el uso. `last_seen_at`: último uso
-- (la API lo actualiza como mucho cada pocos minutos).
alter table sessions
  add column remember     boolean not null default false,
  add column last_seen_at timestamptz not null default now();

-- Sesiones abiertas antes de esta migración: siguen valiendo, con los límites nuevos. Las de
-- «Recordarme» duraban 30 días (las otras, 24 horas).
update sessions set remember = expires_at - created_at > interval '25 hours';
update sessions
   set expires_at = least(expires_at, now() + case when remember then interval '14 days' else interval '12 hours' end);
