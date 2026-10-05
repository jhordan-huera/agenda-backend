-- =============================================================================
-- Teléfono de soporte
-- =============================================================================
-- Se muestra junto al email de soporte (con enlace a WhatsApp): registro cerrado, negocio
-- suspendido, recuperar el acceso y emails de la plataforma. Vacío: sólo el email.
alter table platform_settings add column support_phone text not null default '';
