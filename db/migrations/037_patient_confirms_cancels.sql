-- El paciente confirma o cancela su cita desde el email (spec 010): la página «Tu cita» (/cita/:token).
-- El paciente principal entra con el mismo enlace del pago (appointments.payment_token, migración 025);
-- cada otra persona de una sesión, con el suyo. «Confirmo que voy» es una marca aparte: no cambia el
-- estado de la cita (confirmarla sigue siendo decisión del negocio).

-- 1. «Confirmo que voy» del paciente principal. Vacía: aún no confirmó.
alter table appointments add column client_confirmed_at timestamptz;

-- 2. Cada otra persona de la sesión: su enlace a «Tu cita» y su confirmación. El valor por defecto se
--    calcula fila a fila: las personas que ya están en una cita reciben cada una su enlace, como hizo
--    la 025 con payment_token. Al quitar a una persona de la cita, su fila se borra y su enlace deja
--    de valer. Este enlace no abre /pago: los datos de pago son sólo del principal.
alter table appointment_clients
  add column access_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column confirmed_at timestamptz;
create unique index appointment_clients_access_token on appointment_clients (access_token);

-- 3. La confirmación es de una fecha, una hora y un profesional: se borra si cambia alguno de los tres
--    o si la cita se cancela (sea quien sea quien la cancela; si el negocio la reactiva, el paciente
--    puede volver a confirmar). Atendida y No asistió la conservan («confirmó y no vino»). Cambiar el
--    paciente principal la borra en la API (saveAppointment), no aquí: unir a la ficha (spec 009) es
--    la misma persona y la conserva.
create function appointments_reset_client_confirmation() returns trigger
language plpgsql as $$
begin
  if new.date is distinct from old.date or new.start_time is distinct from old.start_time
     or new.professional_id is distinct from old.professional_id
     or (new.status = 'cancelled' and old.status <> 'cancelled') then
    new.client_confirmed_at := null;
  end if;
  return new;
end;
$$;

create trigger appointments_reset_client_confirmation
  before update of date, start_time, professional_id, status on appointments
  for each row execute function appointments_reset_client_confirmation();

-- Las de las otras personas, después de guardar la cita: así no se bloquea su fila mientras se
-- actualiza (el control de la 032 la bloquea al cambiar appointment_clients).
create function appointments_reset_extra_confirmations() returns trigger
language plpgsql as $$
begin
  if new.date is distinct from old.date or new.start_time is distinct from old.start_time
     or new.professional_id is distinct from old.professional_id
     or (new.status = 'cancelled' and old.status <> 'cancelled') then
    update appointment_clients set confirmed_at = null
     where appointment_id = new.id and confirmed_at is not null;
  end if;
  return new;
end;
$$;

create trigger appointments_reset_extra_confirmations
  after update of date, start_time, professional_id, status on appointments
  for each row execute function appointments_reset_extra_confirmations();
