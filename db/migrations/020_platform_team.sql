-- Equipo de la plataforma: varios super admins para dar soporte. El principal (platform_owner) es
-- el único que agrega, desactiva o cambia la contraseña de los demás, y a él nadie lo puede tocar.
alter table users
  add column platform_owner boolean not null default false
  -- "is not distinct from": con platform_role null, "= 'super_admin'" daría null y el check pasaría.
  constraint users_platform_owner_check check (not platform_owner or platform_role is not distinct from 'super_admin');

-- El super admin que ya existía es el principal.
update users set platform_owner = true where platform_role = 'super_admin';
