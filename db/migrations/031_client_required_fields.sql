-- Datos obligatorios del paciente, negocio por negocio: qué pide el panel al crear o editar un
-- cliente (el nombre lo es siempre y no se guarda aquí). Sólo lo cambia el super admin, desde la
-- ficha del negocio en /admin. La reserva online no cambia: pide siempre cédula, nombre, email y teléfono.
--
-- El valor por defecto es lo que el panel exigía hasta ahora (cédula y email; teléfono y dirección
-- opcionales): todos los negocios siguen exactamente igual hasta que el super admin lo cambie.
alter table businesses add column client_required_fields jsonb not null
  default '{"documentId": true, "email": true, "phone": false, "address": false}'
  constraint businesses_client_required_fields_check check (
    jsonb_typeof(client_required_fields) = 'object'
    and jsonb_typeof(client_required_fields -> 'documentId') = 'boolean'
    and jsonb_typeof(client_required_fields -> 'email') = 'boolean'
    and jsonb_typeof(client_required_fields -> 'phone') = 'boolean'
    and jsonb_typeof(client_required_fields -> 'address') = 'boolean'
  );
