-- =============================================================================
-- Auditoría completa
-- =============================================================================
-- - changes: qué cambió en cada edición, [{label, before, after}] (before/after null: valor que no
--   se muestra, p. ej. notas). null si la acción no es una edición.
-- - ip y user_agent: sólo en los eventos de sesión (inicio, intento fallido, cierre). Sólo los ve
--   el super admin; el negocio no ve los eventos de sesión.
-- - Los registros no se pueden modificar ni borrar. Sólo la limpieza automática (purge_audit_logs,
--   la llama el cron) y el borrado de un negocio (sus registros caen en cascada).
alter table audit_logs
  add column changes    jsonb,
  add column ip         text,
  add column user_agent text;

create index audit_logs_entity_created_idx on audit_logs (entity_type, created_at desc);
create index audit_logs_actor_created_idx on audit_logs (actor_id, created_at desc);

create function protect_audit_log() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Borrado de un negocio: sus registros caen en cascada cuando el negocio ya no existe.
    if old.business_id is not null and not exists (select 1 from businesses where id = old.business_id) then
      return old;
    end if;
    if current_setting('agenda.audit_cleanup', true) = 'on' then
      return old;
    end if;
  end if;
  raise exception 'La auditoría no se puede modificar ni borrar.' using errcode = '42501';
end;
$$;
-- Sólo el contenido: el autor puede pasar a null si se elimina su cuenta.
create trigger audit_logs_protect_update before update of
  business_id, actor_name, action, entity_type, entity_id, summary, created_at, changes, ip, user_agent
  on audit_logs for each row execute function protect_audit_log();
create trigger audit_logs_protect_delete before delete
  on audit_logs for each row execute function protect_audit_log();

-- Limpieza automática: sesiones 90 días, historia clínica 5 años, el resto 1 año.
create function purge_audit_logs() returns integer
language plpgsql as $$
declare
  deleted integer;
begin
  perform set_config('agenda.audit_cleanup', 'on', true);
  delete from audit_logs
   where created_at < now() - case entity_type
                                when 'session' then interval '90 days'
                                when 'clinical_record' then interval '5 years'
                                else interval '1 year'
                              end;
  get diagnostics deleted = row_count;
  perform set_config('agenda.audit_cleanup', 'off', true);
  return deleted;
end;
$$;
