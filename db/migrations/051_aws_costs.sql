-- Los costos de AWS en /admin (spec 031, decisiones del dueño del producto del 2026-10-22): lo que cuesta el
-- backend en AWS en el mes, el desglose por servicio y los créditos, para verlo sin entrar a AWS. El cron de
-- GitHub los pide a AWS una vez al día, después de las 06:00 de Ecuador (Cost Explorer cobra $0,01 por
-- consulta), y la pantalla «Costos» sólo lee lo guardado. Sólo cifras y nombres de servicios de AWS: nunca
-- datos de la cuenta ni de los negocios.

-- Una fila por mes de facturación de AWS, con el último dato del mes: cada actualización diaria la reemplaza.
-- No se borra (es una fila al mes). La pantalla no muestra los meses anteriores, por decisión del dueño del
-- producto; quedan guardados por si se añade un historial más adelante.
create table aws_costs (
  -- El día 1 del mes, en UTC: AWS corta el mes a medianoche UTC (las 19:00 de Ecuador).
  month             date primary key
    constraint aws_costs_month_check check (extract(day from month) = 1),
  -- Lo gastado en el mes hasta el momento, en USD, antes de los créditos (el costo de uso, con los impuestos).
  usage_usd         numeric(12, 4) not null,
  -- Lo que cubren los créditos de AWS de lo gastado, en positivo.
  credits_usd       numeric(12, 4) not null default 0,
  -- [{ "name": "AWS Lambda", "amount": 0.0123 }, …], lo gastado por servicio de mayor a menor (sin los
  -- créditos ni los reembolsos).
  services          jsonb not null default '[]',
  -- Cuándo se obtuvo de AWS.
  fetched_at        timestamptz not null,
  -- El plan de la cuenta (GetAccountPlanState del Free Tier API): FREE o PAID, su estado (NOT_STARTED,
  -- ACTIVE o EXPIRED), los créditos que quedan en USD y cuándo vence. Todos null si AWS no los da (sin el
  -- permiso o si falla): los costos se guardan igual. Sin checks: los valores los pone AWS y la API los filtra.
  plan_type         text,
  plan_status       text,
  remaining_credits numeric(12, 4),
  plan_expires_at   timestamptz
);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table aws_costs enable row level security;

-- Lo privado del aviso y de la actualización diaria, en la fila única de la plataforma. Nunca va en la
-- lectura pública de /public/platform-settings (getPlatformSettings): sólo lo leen el super admin y el cron.
-- - aws_cost_alert: el monto del aviso en USD (null: sin aviso). Lo pone el super admin en /admin → Costos.
-- - aws_cost_alerted_month y aws_cost_alerted_amount: para qué mes y con qué monto ya se avisó (un aviso por
--   mes y por monto: cambiar el monto o empezar un mes lo vuelve a dejar disponible).
-- - aws_costs_attempted_at, aws_costs_attempts y aws_costs_error: el último intento de consultar a AWS,
--   cuántos van ese día en Ecuador (hasta 3, cada 3 horas, si fallan) y el motivo en palabras sencillas si
--   falló (null: salió bien). Nunca el mensaje de AWS tal cual: puede llevar el número de la cuenta.
alter table platform_settings
  add column aws_cost_alert numeric(10, 2)
    constraint platform_settings_aws_cost_alert_check check (aws_cost_alert between 0.01 and 100000),
  add column aws_cost_alerted_month date,
  add column aws_cost_alerted_amount numeric(10, 2),
  add column aws_costs_attempted_at timestamptz,
  add column aws_costs_attempts smallint not null default 0
    constraint platform_settings_aws_costs_attempts_check check (aws_costs_attempts >= 0),
  add column aws_costs_error text;
