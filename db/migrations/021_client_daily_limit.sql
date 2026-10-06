-- Citas por día que una misma persona (su cédula) puede reservar desde la página pública: 1 en los
-- negocios que ya existían (lo cambian en Configuración → Agenda; 0 = sin límite). Lo que un
-- negocio ya tuviera guardado se respeta.
update businesses
   set booking_settings = '{"maxClientBookingsPerDay": 1}'::jsonb || booking_settings;
