-- Colores del panel de plataforma de cada super admin (spec 007): los elige en Configuración y se ven
-- en cualquier equipo donde entre. null: los colores de Agenda360. Mismo formato que brand_colors (018).
alter table users
  add column panel_colors jsonb
  constraint users_panel_colors_check check (
    panel_colors is null
    or (panel_colors ->> 'primary' ~ '^#[0-9a-f]{6}$' and panel_colors ->> 'highlight' ~ '^#[0-9a-f]{6}$')
  );
