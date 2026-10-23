-- La spec 031 (los costos de AWS en /admin) queda descartada: el dueño del producto decidió el 2026-10-22 no
-- tenerla, para no gastar los créditos de AWS en las consultas de Cost Explorer ($0,01 cada una). La 051 ya
-- estaba aplicada en producción y no se edita: aquí se quita lo que creó. Nada más la usaba.
drop table if exists aws_costs;

alter table platform_settings
  drop column if exists aws_cost_alert,
  drop column if exists aws_cost_alerted_month,
  drop column if exists aws_cost_alerted_amount,
  drop column if exists aws_costs_attempted_at,
  drop column if exists aws_costs_attempts,
  drop column if exists aws_costs_error;
