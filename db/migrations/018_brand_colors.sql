-- Colores de marca de cada negocio: el principal y el de resaltado ("#rrggbb"). De ellos sale la
-- paleta de su panel y de su página de reservas. null: los colores de Agenda360.
alter table businesses
  add column brand_colors jsonb
  constraint businesses_brand_colors_check check (
    brand_colors is null
    or (brand_colors ->> 'primary' ~ '^#[0-9a-f]{6}$' and brand_colors ->> 'highlight' ~ '^#[0-9a-f]{6}$')
  );
