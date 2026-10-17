-- El aviso de la mañana y el aviso al super admin de los recordatorios enviados (spec 021): la campana
-- (panel_notices, migración 041) acepta dos tipos nuevos.
-- - morning_summary: del negocio, como evening_summary. Sin cita: el del negocio entero (para el
--   propietario) o el de una agenda (professional_id). Guarda { "date": …, "count": N } y el texto se
--   arma al leer.
-- - reminders_sent: de la plataforma, como los otros cuatro del super admin, con su título, su texto y su
--   enlace ya armados (sólo nombres de negocios y cifras, nunca pacientes).
--
-- Los dos check que nombran los tipos (el de la columna kind y el de la tabla que separa los del negocio
-- y los de la plataforma) se crearon sin nombre en la 041: se buscan en pg_constraint por lo que dicen, se
-- quitan y se vuelven a crear, ya con nombre. El tercero (los que hablan de una cita llevan la cita) no
-- cambia: los dos tipos nuevos no llevan cita.
do $$
declare
  found text;
begin
  for found in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'panel_notices'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%evening_summary%'
  loop
    execute format('alter table panel_notices drop constraint %I', found);
  end loop;
end
$$;

alter table panel_notices
  add constraint panel_notices_kind_check check (kind in (
    'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
    'new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent'));

-- Los ocho del negocio con negocio, los cinco de la plataforma sin él (y con su texto).
alter table panel_notices
  add constraint panel_notices_scope_check check (
    (kind in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary')
      and business_id is not null and title is null and body is null and url is null)
    or (kind in ('new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent')
      and business_id is null and title is not null and body is not null and url is not null)
  );
