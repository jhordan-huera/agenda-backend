-- Seguridad de la página pública de reservas, los límites de intentos y las imágenes:
--   · límites de intentos compartidos por todas las instancias de la API (Vercel, Lambda);
--   · los clientes que crea la página de reservas (topes por día y tope de clientes del plan);
--   · las reservas online recientes de cada negocio (tope por día);
--   · las subidas de imágenes: se borran a las 24 h si nadie las usa, con una cuota diaria.

-- Límites de intentos (login, registro, reservas…): antes se contaban en la memoria de cada
-- instancia y cada una llevaba su propia cuenta. `key` = "<limitador>:<IP o subred>"; la cuenta
-- vuelve a empezar al pasar `reset_at`. El cron borra las filas caducadas (también la API, de vez en cuando).
create table rate_limits (
  key      text primary key,
  hits     integer not null check (hits >= 0),
  reset_at timestamptz not null
);
create index rate_limits_reset_idx on rate_limits (reset_at);

-- Quién creó el cliente: el negocio (panel) o la página de reservas. Los creados por la página
-- tienen un tope por día, y si nunca tuvieron una cita sin cancelar no cuentan para el tope de
-- clientes del plan (una ráfaga de reservas falsas no agota el cupo del negocio para siempre).
alter table clients add column source text not null default 'dashboard'
  check (source in ('dashboard', 'booking_page'));
-- Los que ya existían: la reserva crea el cliente y su cita en la misma transacción (misma hora).
update clients c
   set source = 'booking_page'
 where exists (
   select 1 from appointments a
    where a.client_id = c.id and a.source = 'booking_page'
      and a.created_at >= c.created_at and a.created_at < c.created_at + interval '1 minute');
create index clients_online_created_idx on clients (business_id, created_at) where source = 'booking_page';

-- Reservas online de las últimas 24 h de un negocio (tope por día).
create index appointments_online_created_idx on appointments (business_id, created_at) where source = 'booking_page';

-- Subidas de logos y fotos: cada URL firmada que se entrega queda aquí. A las 24 h el cron borra el
-- archivo si nadie lo usa (el bucket es público: no debe servir de alojamiento gratis) y la fila.
-- También sirve para la cuota de subidas por usuario y día.
create table image_uploads (
  object_path text primary key,
  user_id     uuid references users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index image_uploads_user_idx on image_uploads (user_id, created_at);
create index image_uploads_created_idx on image_uploads (created_at);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table rate_limits enable row level security;
alter table image_uploads enable row level security;
