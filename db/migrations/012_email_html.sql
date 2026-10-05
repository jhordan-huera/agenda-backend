-- =============================================================================
-- Emails con diseño (HTML)
-- =============================================================================
-- Cada email guarda también su versión HTML (cabecera, tarjeta, botones y recuadros de datos).
-- Se envían las dos: los clientes de correo muestran el HTML y usan el texto si no pueden.
-- Los emails anteriores no tienen HTML (null) y se envían sólo como texto.
alter table notifications add column html text;
