-- El programa de referidos (spec 023), en businesses:
-- - referral_code: el código de cada negocio para recomendar Agenda360 (su enlace es <portada>/?ref=<código>).
--   6 caracteres, letras mayúsculas sin I ni O y números del 2 al 9 (no se confunden al dictarlos). No
--   cambia aunque cambie el enlace de reservas. Los negocios que ya existen reciben el suyo aquí; los
--   nuevos, al crearse (el default de la columna).
-- - referred_by: quién lo recomendó (lo anota el super admin). Uno solo por negocio y nunca él mismo.
--   Si se elimina el que recomendó, queda en null.
-- - referral_reward_applied_at: cuándo el dueño aplicó el descuento de esa recomendación ($1,50 en la
--   siguiente mensualidad de quien recomendó, una sola vez). Se gana cuando el negocio recomendado
--   sigue activo a los 30 días de crearse; la API lo calcula al leer y no se guarda.

-- Un código al azar que ningún negocio tiene todavía (32 caracteres posibles: 32^6, unos mil millones).
create or replace function new_referral_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      into code
      from generate_series(1, 6);
    exit when not exists (select 1 from businesses where referral_code = code);
  end loop;
  return code;
end;
$$;

alter table businesses
  add column referral_code text,
  add column referred_by uuid references businesses (id) on delete set null,
  add column referral_reward_applied_at timestamptz;

-- Uno por uno: cada código nuevo ya ve los anteriores, así que no se repiten.
do $$
declare
  found uuid;
begin
  for found in select id from businesses where referral_code is null order by created_at loop
    update businesses set referral_code = new_referral_code() where id = found;
  end loop;
end
$$;

alter table businesses
  alter column referral_code set default new_referral_code(),
  alter column referral_code set not null,
  add constraint businesses_referral_code_key unique (referral_code),
  add constraint businesses_referral_code_check check (referral_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  add constraint businesses_referred_by_check check (referred_by is null or referred_by <> id);

-- «Recomendó a» en la ficha, la tarjeta del propietario y los descuentos pendientes.
create index businesses_referred_by_idx on businesses (referred_by) where referred_by is not null;
