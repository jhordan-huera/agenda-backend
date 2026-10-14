# Contrato de la API: Sesiones con varios pacientes

Todas las rutas existentes conservan su forma. Sólo se agregan un campo a la cita, un campo al
negocio y una ruta del super admin.

## Cita

### Respuesta (todas las rutas que devuelven citas)

```jsonc
{
  "id": "…",
  "clientId": "…",            // paciente principal (como hoy)
  "extraClientIds": ["…"],    // NUEVO: 0 a 2 pacientes adicionales, en orden; [] si no hay
  "…": "resto de campos sin cambios"
}
```

### `POST /businesses/:businessId/appointments` y `PUT /businesses/:businessId/appointments/:appointmentId`

Cuerpo: el formulario de cita de hoy más `extraClientIds` (opcional, por defecto `[]`).

| Caso | Respuesta |
|---|---|
| Negocio sin habilitar y `extraClientIds` agrega a alguien que no estaba | 400 `validation`: «Este negocio no tiene habilitadas las citas con varios pacientes.» |
| Negocio sin habilitar y la lista sólo quita pacientes (o es igual) | 200, se guarda |
| Más de 2 adicionales | 400 `validation`: «Una cita puede tener como máximo 3 pacientes.» |
| Paciente repetido o igual al principal | 400 `validation`: «Ese paciente ya está en la cita.» |
| Un adicional nuevo inactivo | 400 `validation`: «{Nombre} está inactivo.» |
| Un adicional que no existe en el negocio, o fuera del alcance de un profesional con «sólo sus pacientes» | 404 «Cliente no encontrado.» (como hoy con el principal) |
| Choque de horario | 409 `conflict` (sin cambios: la hora se ocupa una vez) |

La API sigue aceptando un cuerpo sin `extraClientIds`, como el que envía un front anterior:
- al **crear**, la cita queda sin adicionales;
- al **editar**, los que había **se conservan**. Sólo un `extraClientIds` explícito los cambia.

### `GET /businesses/:businessId/appointments?clientId=X`

Devuelve las citas donde X es el principal **o** un adicional.

### `GET /businesses/:businessId/clients/activity`

- Una fila por paciente, con todas sus participaciones (principal o adicional).
- `totalSpent` suma sólo las citas donde es el principal.

## Negocio

- `GET /businesses/:id` y `GET /admin/businesses/:id` incluyen `multiClientAppointments: boolean`.
- `PATCH /businesses/:id` (propietario) **ignora** `multiClientAppointments`, como hoy ignora
  `clientRequiredFields`.
- `GET /public/businesses/:slug` **no** incluye el campo.

### `PUT /admin/businesses/:businessId/multi-client-appointments` (sólo super admin, con 2FA)

Cuerpo: `{ "enabled": true }`. Respuesta: el `Business` actualizado.

- Si cambia, deja la auditoría `platform.multi_client_appointments_changed`:
  - entidad `business`;
  - resumen «Activó / Desactivó las citas con varios pacientes en {negocio}»;
  - cambio antes → después («No» / «Sí»).
- Si el valor es el mismo, no deja registro.
- Si el cuerpo no es booleano: 400 `validation`.

## Emails

**Tipos:** no hay tipos nuevos. Por cada cambio de una cita activa, cada paciente con email recibe
`booking_created`, `appointment_confirmed`, `appointment_updated` o `appointment_cancelled`. El
recordatorio, `appointment_reminder`, también le llega a cada uno.

**Copia al profesional (`appointment_copy`):**
- sale una vez por cambio;
- asunto: `Copia · Ana Torres y Carlos Pérez: …`.

**Nombres de todos los pacientes:**
- `professional_new_appointment`: el asunto los nombra a todos;
- `professional_daily_agenda`: cada fila los nombra a todos.

## Auditoría de la cita

- Los resúmenes («Creó la cita de …») nombran a todos los pacientes.
- El diff de cambios agrega el campo «Otros pacientes», sólo con nombres.
