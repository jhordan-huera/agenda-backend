-- Formato de historia clínica de todo el negocio: el que se propone en cada evolución nueva
-- (salvo en las citas de un servicio con formato propio). null: el recomendado para la
-- especialidad del negocio. Si se desactiva el formato elegido, la API lo vuelve a null.
alter table businesses
  add column clinical_default_template_id text references clinical_templates (id) on delete set null;
