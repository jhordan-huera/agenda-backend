-- Los precios automáticos de las mensualidades (spec 029, ampliación del 2026-10-20). La 049 ya está
-- publicada: lo nuevo va aquí. La mensualidad de cada negocio sale sola de su plan y sus agendas, con un
-- precio especial opcional, y el día de pago y el primer cobro los pone la API desde el día en que empezó su
-- plan (ensureBillingSchedule, en el cron, en la lectura del propietario y en la ficha de /admin).

-- Los precios de los planes, en USD: los cambia el super admin en /admin → Planes y valen desde el siguiente
-- cobro de cada negocio. Business: business_price con business_included_agendas agendas, y
-- business_extra_agenda_price por cada agenda más (las «Agendas contratadas»; sin tope, las activas). Free no
-- tiene precio: no hay cobros. Nunca van en la lectura pública de /public/platform-settings ni en lo que ve un
-- negocio: el propietario sólo ve su mensualidad.
alter table platform_settings
  add column pro_price numeric(10, 2) not null default 14.99
    constraint platform_settings_pro_price_check check (pro_price between 0 and 10000),
  add column business_price numeric(10, 2) not null default 29.99
    constraint platform_settings_business_price_check check (business_price between 0 and 10000),
  add column business_included_agendas smallint not null default 3
    constraint platform_settings_business_included_agendas_check check (business_included_agendas between 1 and 200),
  add column business_extra_agenda_price numeric(10, 2) not null default 8
    constraint platform_settings_business_extra_agenda_price_check check (business_extra_agenda_price between 0 and 10000);

-- subscriptions.monthly_fee pasa a ser el precio especial del negocio: null (lo normal) es el de su plan, 0
-- es cortesía (sin cobros) y otro monto es ése. Sin valor por defecto: un negocio nuevo toma el de su plan.
-- El check de la 049 pedía el día de pago y el primer cobro con mensualidad; ahora los pone la API, así que
-- sólo se pide que vayan juntos (los dos o ninguno). El de monthly_fee >= 0 se queda.
alter table subscriptions
  drop constraint subscriptions_billing_check,
  alter column monthly_fee drop not null,
  alter column monthly_fee drop default;

-- Los 0 que dejó la 049 (su valor por defecto) pasan a null: toman el precio de su plan. Pierden también el
-- día de pago y el primer cobro que pudieran tener (de una mensualidad que se quitó): la API los vuelve a
-- poner desde el día en que empezó su plan, con el primer cobro en su próximo día de pago, nunca en uno ya
-- pasado. Los que ya tenían una mensualidad de más de 0 la conservan como precio especial, con su día.
update subscriptions set monthly_fee = null, billing_day = null, billing_start = null where monthly_fee = 0;

alter table subscriptions
  add constraint subscriptions_billing_check check ((billing_day is null) = (billing_start is null));
