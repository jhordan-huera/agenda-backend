-- =============================================================================
-- La fecha de cada evolución la elige quien la registra (spec 037)
-- =============================================================================
-- Hasta ahora la ponía la API (hoy) y nadie la podía cambiar (006). El dueño del producto decidió el
-- 2026-10-28 que se elige al registrar y se puede corregir después, siempre entre los 30 días
-- anteriores al día en que se registró y ese mismo día. El contenido, el autor y la fecha de
-- registro siguen sin poder modificarse, tampoco con SQL directo.

drop trigger clinical_notes_protect on clinical_notes;
create trigger clinical_notes_protect before update of
  business_id, client_id, template_version_id, data, author_name, created_at
  on clinical_notes for each row execute function protect_clinical_note();

-- El día de registro es el de created_at en la zona del negocio (como «hoy» en la API).
create function check_clinical_note_date() returns trigger
language plpgsql as $$
declare
  registered date;
begin
  select (new.created_at at time zone b.timezone)::date into registered from businesses b where b.id = new.business_id;
  if new.date > registered or new.date < registered - 30 then
    raise exception 'La fecha de la consulta debe estar entre los 30 días anteriores a su registro y ese mismo día.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinical_notes_check_date before insert or update of date
  on clinical_notes for each row execute function check_clinical_note_date();
