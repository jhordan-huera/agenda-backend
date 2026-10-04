-- =============================================================================
-- Ubicación exacta del negocio en el mapa
-- =============================================================================
-- El propietario marca su local en un mapa (Configuración → Negocio). La página de reservas,
-- la confirmación y los emails muestran ese punto y el enlace "Cómo llegar" lleva a la puerta,
-- en vez de buscar la dirección escrita. Sin punto marcado se sigue usando la dirección.
alter table businesses
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint businesses_location_pair check ((lat is null) = (lng is null));
