# Investigación y decisiones: Sesiones con varios pacientes

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-13

Cada decisión dice qué se eligió, por qué y qué se descartó. Los nombres de archivos son del
backend salvo que digan «front» o «beta».

## D1. Dónde se guardan los pacientes adicionales

- **Decisión:** una tabla nueva, `appointment_clients`, con una fila por cada paciente adicional:
  - campos: `appointment_id`, `client_id`, `business_id` y `created_at`;
  - clave primaria `(appointment_id, client_id)`;
  - ambas referencias con borrado en cascada.

  El paciente principal sigue en `appointments.client_id`.
- **Por qué:**
  - las citas que ya existen no cambian (RF-013);
  - borrar a un paciente adicional sólo quita su vínculo, sin borrar la cita;
  - la base de datos impide repetir a un paciente en la misma cita.
- **Descartado:**
  - **Una columna con la lista de IDs dentro de la cita.** No hay integridad: un paciente borrado
    quedaría en la lista.
  - **Mover a todos los pacientes a la tabla nueva y quitar `client_id`.** Obliga a cambiar todas
    las consultas existentes y la reserva online.

## D2. El interruptor del super admin

- **Decisión:** una columna booleana `businesses.multi_client_appointments`, apagada por defecto.
  - En el tipo `Business` se llama `multiClientAppointments`.
  - Se cambia con `PUT /admin/businesses/:id/multi-client-appointments` (`{ enabled }`), con
    auditoría `platform.multi_client_appointments_changed`.
  - Sigue el mismo camino que `client_required_fields` (migración 031, `setClientRequiredFields`):
    - el PATCH del propietario lo ignora;
    - no sale en el perfil público (`PublicBusiness`).
- **Por qué:** es el patrón que ya existe para lo que sólo decide el super admin (principio III).
- **Descartado:** guardarlo dentro de los ajustes del negocio. El propietario puede cambiar esos
  ajustes.

## D3. Cómo viajan en la API

- **Decisión:** `Appointment.extraClientIds: string[]`, siempre presente (vacío si no hay).
  - Se agrega al formulario completo (`appointmentSchema`): máximo 2, sin repetidos y sin el
    paciente principal.
  - `appointmentColumns()` incluye una subconsulta que devuelve la lista en todas las lecturas. Así
    los 18 lugares que leen citas la traen sin cambios.
  - Al crear o editar, la cita se vuelve a leer después de guardar los vínculos, en la misma
    transacción.
- **Por qué:**
  - un solo formulario y una sola petición, como hoy;
  - arrastrar una cita en la agenda reenvía el formulario completo (`appointmentToInput` en el
    front), así que el campo debe viajar siempre o se perderían los pacientes.
- **Descartado:** rutas aparte para agregar o quitar pacientes. Serían más peticiones y más estados
  a medias.

## D4. Reglas al guardar

- **Interruptor:**
  - Encendido: se pueden agregar pacientes, hasta 2 adicionales.
  - Apagado: sólo se aceptan listas que quitan pacientes respecto de la cita guardada. Cualquier
    paciente nuevo devuelve el error «Este negocio no tiene habilitadas las citas con varios
    pacientes.».
- **Cada paciente nuevo:**
  - debe ser del negocio y estar activo;
  - para el rol Profesional con «sólo sus pacientes», debe estar en su alcance
    (`assertClientInScope`, como hoy con el principal).
- **Red de seguridad:** un trigger en la base de datos impide más de 2 adicionales y que el
  principal se repita como adicional, igual que la migración 030 limita las cuentas bancarias.
- **Si el principal pasa a ser alguien que estaba como adicional,** sale de los adicionales.

## D5. Avisos a cada paciente

- **Decisión:** `loadAppointmentContext` carga la lista de destinatarios: el principal y los
  adicionales, en orden, con nombre y email. `notifyAppointmentChange` compara la cita anterior con
  la nueva:
  - **Pacientes que siguen:** reciben el mismo email que hoy recibe el principal (confirmación,
    cambio, reactivación o cancelación).
  - **Pacientes agregados a una cita activa:** reciben el email del estado actual: confirmación si
    está confirmada, solicitud si está pendiente. Es el mismo que recibiría una cita nueva.
  - **Pacientes quitados de una cita activa:** reciben la cancelación, si el negocio tiene activos
    esos avisos.
  - **Citas atendidas, no asistidas o canceladas:** no se envía nada, como hoy.
  - **Un email por dirección:** si dos pacientes comparten correo, sale uno solo.
  - **Saludo:** cada email lleva el nombre de su destinatario. La plantilla no cambia: sólo cambia
    `clientName` en los datos.
  - **Copia al profesional:** sale **una vez** por cambio, si a algún paciente le salió el email, y
    nombra a todos («Ana Torres y Carlos Pérez»). Lo mismo para el aviso de cita nueva y la agenda
    del día.
- **Topes:** cada email a un paciente cuenta para el tope diario a terceros, como hoy. El tope de
  pacientes nuevos de la página de reservas no aplica: esta fase es sólo del panel.

## D6. Recordatorios

- **Decisión:** el recordatorio del paciente principal conserva la clave de hoy. Así los que ya
  están en cola siguen valiendo. El de cada paciente adicional usa esa misma clave seguida de
  `:<client_id>`.
  - La búsqueda de candidatas considera a cada paciente.
  - El envío acepta las dos formas al comprobar que el recordatorio sigue vigente
    (`mailer.ts:180`: igual a la clave o que empiece por la clave y `:`).
- **Por qué:** la clave es única en la base de datos (`notifications_dedupe_key`). Con una sola
  clave por cita, el segundo recordatorio se descartaría.

## D7. Alcance de los profesionales

- **Decisión:** `ownClientCondition` también cuenta las citas en las que el paciente es adicional
  en la agenda del profesional. `pendingClientCondition` no cambia: sólo la reserva online deja
  citas «pendientes de acceso», y esa no tiene adicionales.
- La historia clínica permite vincular una evolución a una cita en la que el paciente es
  adicional (`clinical-service.ts:298`).

## D8. Historial, actividad y reportes

- **Historial:** `GET /appointments?clientId=` devuelve también las citas en las que ese paciente
  es adicional. Así la ficha, la historia clínica y la impresión muestran la sesión.
- **Actividad** (`GET /clients/activity`):
  - cuenta cada participación para total, atendidas, faltas, primera y última visita;
  - el **precio se atribuye sólo al paciente principal**, para no inflar «lo que te ha pagado».
- **Reportes (front y beta, archivos idénticos):**
  - citas, estados, ocupación, ingresos, canales y mapa de calor siguen por cita;
  - «los que más vienen», «los que más faltan» y «nuevos o recurrentes» recorren todos los
    pacientes de la cita;
  - el dinero de «los que más vienen» queda sólo en el principal;
  - «no volvieron» sale de la actividad, que ya los incluye.
- **Borrar un paciente:**
  - si era el principal, se borran sus citas (como hoy);
  - si era adicional, sólo se quita el vínculo;
  - el aviso de cuántas citas se borran cuenta sólo aquellas donde es el principal.

## D9. Nombres en pantalla y en los avisos

- **Decisión:** una función compartida `joinNames(nombres)` en `src/lib/format.ts` del front, que
  se copia al backend.
  - «Ana Torres» → «Ana Torres».
  - Dos nombres → «Ana Torres y Carlos Pérez».
  - Tres nombres → «Ana Torres, Carlos Pérez y Luis Gómez».
- En los bloques chicos del calendario se muestra «Ana Torres y 2 más» cuando no caben.
- Auditoría: `describeAppointment` y el diff de la cita incluyen «Otros pacientes», sólo con los
  nombres (RF-016).

## D10. WhatsApp

- **Decisión:** el aviso guarda la lista de pacientes con teléfono válido. Muestra un mensaje y un
  botón «Abrir WhatsApp» por cada uno, saludándolo por su nombre. Usa `buildAppointmentNotice` sin
  cambios, una vez por paciente.
- Los botones de WhatsApp del detalle de la cita y de «Tu siguiente cita» se repiten por paciente.
  El cobro por transferencia sigue siendo del principal.

## D11. La beta

- **Decisión:** se aplica lo mismo sobre su base en el navegador:
  - `migrateData` completa `extraClientIds ??= []` y `multiClientAppointments ??= false`;
  - el repositorio de prueba aplica las mismas reglas (interruptor, máximo, alcance, borrado);
  - la bandeja de emails simulada registra un email por paciente;
  - el interruptor va en la ficha del negocio del super admin.
- Los archivos de calendario y reportes son idénticos a los del front y se copian. El formulario,
  el detalle y la ficha del super admin tienen pequeñas diferencias, así que se editan a mano.

## D12. Orden de publicación

1. El dueño del producto aplica la **migración 032** en Supabase.
2. Se publica el backend.
3. Se publica el front.

Mientras el front nuevo convive con un backend viejo, trata la lista como vacía si no viene
(`appointment.extraClientIds ?? []`) y no muestra la opción, porque el negocio no trae el
interruptor.
