-- =============================================================================
-- Cédula de los clientes y fechas de la historia clínica protegidas
-- =============================================================================

-- ------------------------------------------------------- Cédula del cliente --
-- Identifica al cliente dentro del negocio: la página pública de reservas la busca para no
-- crear duplicados. Sustituye al email como dato único (varias personas pueden compartir email,
-- p. ej. una madre que reserva para sus hijos).
alter table clients add column document_id text not null default ''
  check (document_id = '' or document_id ~ '^[A-Z0-9]{5,20}$');
create unique index clients_business_document_key on clients (business_id, document_id) where document_id <> '';
drop index clients_business_email_key;

-- ---------------------------------------- Fechas de la historia clínica -------
-- La fecha del consentimiento informado y la de cada evolución las pone la API (el día
-- actual) y nadie puede cambiarlas después, tampoco con SQL directo.
create function protect_clinical_consent_date() returns trigger
language plpgsql as $$
begin
  if old.consent_date is not null and new.consent_date is distinct from old.consent_date then
    raise exception 'La fecha del consentimiento informado no se puede modificar.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinical_profiles_protect_consent before update of consent_date on clinical_profiles
  for each row execute function protect_clinical_consent_date();

create function protect_clinical_note() returns trigger
language plpgsql as $$
begin
  raise exception 'Las evoluciones de la historia clínica no se pueden modificar: añade una aclaración.' using errcode = '42501';
end;
$$;
-- Sólo el contenido: las claves externas (cita o autor borrados) pueden pasar a null.
create trigger clinical_notes_protect before update of
  business_id, client_id, date, reason, findings, diagnosis, treatment, indications, next_control, author_name, created_at
  on clinical_notes for each row execute function protect_clinical_note();
create trigger clinical_note_addenda_protect before update of note_id, business_id, text, author_name, created_at
  on clinical_note_addenda for each row execute function protect_clinical_note();
