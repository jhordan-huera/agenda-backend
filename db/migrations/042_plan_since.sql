-- Desde cuándo está cada negocio en su plan (spec 015): la ficha del super admin dice «En Pro desde
-- el 3 oct» en lugar de una fecha de renovación que no existe (aún no hay cobro).
--
-- Los de hoy: un plan de pago guarda current_period_end = el último cambio de plan + 30 días
-- (periodEndFor en src/services/subscriptions.ts), así que restarle 30 días da justo la hora de ese
-- cambio. Free no tiene current_period_end: se usa el alta del negocio. Desde aquí la API pone now()
-- al crear el negocio y en cada cambio de plan. current_period_end se queda para el cobro (otra spec).

alter table subscriptions add column plan_since timestamptz;

update subscriptions s
   set plan_since = coalesce(s.current_period_end - interval '30 days', b.created_at)
  from businesses b
 where b.id = s.business_id;

-- Una suscripción nueva sin fecha (p. ej. los datos demo) empieza ahora.
alter table subscriptions
  alter column plan_since set default now(),
  alter column plan_since set not null;

-- Spec 015: el cupo de Gmail cuenta en cada lote los emails enviados en las últimas 24 h.
create index notifications_sent_at_idx on notifications (sent_at) where status = 'sent';
