-- Importar pacientes desde un Excel o un CSV (spec 012): los pacientes que crea una importación quedan
-- con origen 'import', como quedan con 'booking_page' los de la página de reservas. No hay tablas
-- nuevas: la importación queda en la actividad (client.imported) y en el origen de cada paciente.
-- Las filas de hoy no cambian (todas son 'dashboard' o 'booking_page'). El nombre del check lo puso
-- PostgreSQL al crear la columna en la migración 029 (<tabla>_<columna>_check).
alter table clients
  drop constraint clients_source_check,
  add constraint clients_source_check check (source in ('dashboard', 'booking_page', 'import'));
