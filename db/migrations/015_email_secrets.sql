-- =============================================================================
-- Contraseñas fuera del registro de emails
-- =============================================================================
-- Los emails con datos de acceso (alta de negocio, alta en el equipo y contraseña cambiada por
-- el soporte) se guardan con la contraseña oculta ("••••••••"): el negocio y el super admin
-- ven el registro de emails, pero nunca la contraseña. Ésta queda en `secret` sólo hasta que
-- el email se envía (o se descarta) y entonces se borra.
alter table notifications add column secret text;

-- Emails ya guardados: se oculta la contraseña en el texto y en el HTML.
update notifications
   set body = regexp_replace(body, '^Contraseña: .*$', 'Contraseña: ••••••••', 'gn'),
       html = regexp_replace(html, '(>Contraseña</td>\s*<td[^>]*>)[^<]*(</td>)', '\1••••••••\2', 'g')
 where type in ('business_created', 'team_invite', 'password_reset');
