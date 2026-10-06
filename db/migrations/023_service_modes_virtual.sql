-- Modalidades de los servicios (en el local, a domicilio y/o virtual), citas por videollamada con el
-- enlace del profesional y precio "Gratis".

-- Dónde se atiende cada servicio: una o varias modalidades. `location` queda sólo para la versión
-- anterior de la API mientras se publica la nueva (no se usa más; se puede borrar después).
alter table services add column modes text[] not null default '{business}'
  check (cardinality(modes) between 1 and 3 and modes <@ array['business', 'home', 'virtual']);
update services
   set modes = case location when 'home' then '{home}' when 'both' then '{business,home}' else '{business}' end::text[];

-- Precio "Gratis": desde ahora, precio 0 visible se muestra como "Gratis". Los servicios que ya
-- tenían precio 0 seguían sin mostrar precio: se quedan así.
update services set show_price = false where price = 0;

-- Cita por videollamada (nunca a domicilio a la vez).
alter table appointments add column is_virtual boolean not null default false;
alter table appointments add constraint appointments_virtual_not_home check (not (is_virtual and home_visit is not null));

-- Sala de videollamada de cada profesional (Meet, Zoom…): llega al paciente en la confirmación y los emails.
alter table professionals add column meeting_url text not null default ''
  check (meeting_url = '' or meeting_url ~ '^https://\S+$');
