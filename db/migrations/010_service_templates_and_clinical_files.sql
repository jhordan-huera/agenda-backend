-- =============================================================================
-- Formato de historia clínica por servicio y archivos de la historia clínica
-- =============================================================================

-- Formato propuesto al registrar la evolución de una cita de este servicio (p. ej. "Primera
-- consulta" → evaluación inicial; "Seguimiento" → sesión). Si se borra el formato, queda el habitual.
alter table services
  add column clinical_template_id text references clinical_templates (id) on delete set null;

-- Archivos de la historia clínica (radiografías, exámenes, fotos, consentimientos escaneados).
-- El archivo vive en el almacenamiento (Supabase Storage); aquí, sus datos. El navegador lo sube
-- directamente con una URL firmada: primero se crea la fila "pending" y, cuando la API comprueba
-- que el archivo llegó, pasa a "ready". Como el resto de la historia, no se borra.
create table clinical_attachments (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses (id) on delete cascade,
  client_id        uuid not null references clients (id) on delete restrict,
  file_name        text not null,
  content_type     text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  description      text not null default '',
  storage_path     text not null unique,
  status           text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by_id   uuid references users (id) on delete set null,
  uploaded_by_name text not null,
  created_at       timestamptz not null default now()
);
create index clinical_attachments_client_idx on clinical_attachments (business_id, client_id, created_at desc);

create function protect_clinical_attachment() returns trigger
language plpgsql as $$
begin
  -- Sólo se permite pasar de "pending" a "ready" (con el tamaño real del archivo subido).
  if old.status = 'pending' and new.status = 'ready'
     and new.business_id = old.business_id and new.client_id = old.client_id
     and new.file_name = old.file_name and new.content_type = old.content_type
     and new.storage_path = old.storage_path and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'Los archivos de la historia clínica no se pueden modificar.' using errcode = '42501';
end;
$$;
create trigger clinical_attachments_protect before update of
  business_id, client_id, file_name, content_type, size_bytes, description, storage_path, status, uploaded_by_name, created_at
  on clinical_attachments for each row execute function protect_clinical_attachment();

alter table clinical_attachments enable row level security;
