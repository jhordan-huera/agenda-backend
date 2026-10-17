-- Modo de pantalla de cada persona (spec 019): «Claro», «Oscuro» o «Automático» (sigue al modo del
-- celular o la computadora). Lo elige en Configuración → Perfil, se ve igual en cualquier equipo donde
-- entre y llega con la sesión. Sin update: el default deja en 'auto' las cuentas que ya existen.
alter table users
  add column theme_mode text not null default 'auto'
  constraint users_theme_mode_check check (theme_mode in ('light', 'dark', 'auto'));
