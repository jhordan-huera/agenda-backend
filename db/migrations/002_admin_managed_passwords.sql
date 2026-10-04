-- Las contraseñas las pone el super admin (alta de negocios y miembros, cambios a petición
-- del usuario): ya no hay recuperación por enlace, así que sobra la tabla de enlaces.
drop table if exists password_reset_tokens;
