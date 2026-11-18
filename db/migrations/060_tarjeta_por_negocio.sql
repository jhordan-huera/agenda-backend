-- Tarjeta de fidelización (spec 052): sólo en los negocios que habilite el super admin (pedido del dueño, 2026-11-18).
-- Apagada en todos al empezar; el propietario sólo la configura y la enciende si está habilitada. Al quitarla, la API
-- también apaga el programa: deja de sumar sellos y sus pacientes dejan de ver la tarjeta (los datos se guardan).
alter table businesses add column loyalty_allowed boolean not null default false;

-- Los negocios que ya tienen la tarjeta encendida la conservan (sólo en bases de prueba: la 059 todavía no está en
-- producción, así que allí no cambia ninguno).
update businesses set loyalty_allowed = true
 where id in (select business_id from loyalty_programs where enabled_at is not null);
