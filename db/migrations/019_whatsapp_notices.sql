-- Avisos por WhatsApp al cambiar una cita (enlace wa.me con el mensaje ya escrito): activados en
-- los negocios que ya existían. Lo que un negocio ya tuviera guardado se respeta.
update businesses
   set notification_settings = '{"whatsappOnStatusChange": true, "whatsappFollowUps": true}'::jsonb || notification_settings;
