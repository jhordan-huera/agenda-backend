-- La auditoría se guarda 5 meses (antes, 1 año). Los inicios y cierres de sesión siguen 90 días y
-- los accesos y cambios en la historia clínica, 5 años (quién vio o modificó datos de salud). La
-- limpieza la ejecuta el cron; las citas, los pacientes y los pagos no se tocan.
create or replace function purge_audit_logs() returns integer
language plpgsql as $$
declare
  deleted integer;
begin
  perform set_config('agenda.audit_cleanup', 'on', true);
  delete from audit_logs
   where created_at < now() - case entity_type
                                when 'session' then interval '90 days'
                                when 'clinical_record' then interval '5 years'
                                else interval '5 months'
                              end;
  get diagnostics deleted = row_count;
  perform set_config('agenda.audit_cleanup', 'off', true);
  return deleted;
end;
$$;
