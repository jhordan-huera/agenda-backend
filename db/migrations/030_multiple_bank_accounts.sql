-- Varias cuentas bancarias por agenda: hasta 3. Al reservar, el paciente las ve todas y transfiere a
-- cualquiera; la primera es la principal (la que ve primero). Cada cuenta, como en la migración 025:
-- {"bank", "accountType": "savings" | "checking", "number", "holder", "holderId"}.
-- Lista vacía: la agenda no cobra por transferencia.
alter table professionals add column bank_accounts jsonb not null default '[]'
  constraint professionals_bank_accounts_check check (
    case when jsonb_typeof(bank_accounts) = 'array'
         then jsonb_array_length(bank_accounts) <= 3
              and not jsonb_path_exists(bank_accounts, '$[*] ? (@.type() != "object")')
         else false
    end
  );

-- Las agendas que ya cobraban por transferencia: su cuenta pasa a ser la primera (y única).
update professionals set bank_accounts = jsonb_build_array(bank_account) where bank_account is not null;

-- `bank_account` NO se borra todavía: la API sigue escribiendo ahí la primera cuenta (o null). Así, el
-- código anterior funciona si esta migración se aplica antes de publicar el nuevo o si hay que volver
-- atrás. Ese código sólo conoce `bank_account`: lo que cambie ahí (sin tocar `bank_accounts`) se pasa
-- a la lista, reemplazando la primera cuenta y conservando las demás (null: sin cobro por transferencia).
-- Cuando ya no haga falta volver atrás, se borran el trigger, la función y la columna.
create function professionals_sync_bank_accounts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.bank_account is not null and new.bank_accounts = '[]'::jsonb then
      new.bank_accounts := jsonb_build_array(new.bank_account);
    end if;
  elsif new.bank_account is distinct from old.bank_account and new.bank_accounts is not distinct from old.bank_accounts then
    new.bank_accounts := case when new.bank_account is null then '[]'::jsonb
                              else jsonb_build_array(new.bank_account) || (old.bank_accounts - 0) end;
  end if;
  return new;
end;
$$;

create trigger professionals_sync_bank_accounts before insert or update of bank_account on professionals
  for each row execute function professionals_sync_bank_accounts();
