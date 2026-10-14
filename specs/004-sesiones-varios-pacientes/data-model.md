# Modelo de datos: Sesiones con varios pacientes

**Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

## Migración `db/migrations/032_appointment_clients.sql`

### `businesses.multi_client_appointments` (nueva columna)

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `multi_client_appointments` | boolean, obligatorio | `false` | Sólo lo cambia el super admin. No sale en el perfil público ni lo cambia el PATCH del propietario. |

### `appointment_clients` (nueva tabla)

Cada fila es un paciente adicional de una cita. El principal sigue en `appointments.client_id`.

| Campo | Tipo | Notas |
|---|---|---|
| `appointment_id` | uuid, obligatorio | → `appointments(id)`, borrado en cascada |
| `client_id` | uuid, obligatorio | → `clients(id)`, borrado en cascada: borrar al paciente sólo quita el vínculo |
| `business_id` | uuid, obligatorio | → `businesses(id)`, borrado en cascada; igual al de la cita y al del paciente |
| `created_at` | timestamptz | `now()`; da el orden en que se muestran los pacientes |

- **Clave primaria:** `(appointment_id, client_id)`. Así el mismo paciente no se repite en una cita.
- **Índice:** `(client_id)`, para el historial de la ficha y el alcance de los profesionales.
- **Seguridad:** `enable row level security`, sin políticas, como el resto de las tablas.
- **Trigger antes de insertar o actualizar.** Es la red de seguridad; la API valida antes con
  mensajes claros. Rechaza:
  - más de 2 filas por cita;
  - un `client_id` igual a `appointments.client_id` de esa cita;
  - un `business_id` distinto al de la cita o al del paciente.

**Las citas existentes no cambian:** no tienen filas en la tabla nueva y siguen con su único
paciente.

## Tipos compartidos (front `src/types/index.ts` → `sync:shared`)

- **`Business.multiClientAppointments: boolean`** (comentario: «Lo activa el super admin para cada
  negocio»).
  - Se agrega a la lista que excluye `PublicBusiness`.
  - Se deja fuera de `UpdateBusinessInput`.
- **`Appointment.extraClientIds: string[]`.** Son los pacientes adicionales en orden; vacío si no
  hay.

## Validación (front `src/lib/validations/appointment.ts` → `sync:shared`)

- `extraClientIds: z.array(z.string().min(1)).max(2, "Una cita puede tener como máximo 3 pacientes.").optional()`. Si no viene, al crear la cita queda sin adicionales y al editarla se conservan los que había. Así un front anterior no los borra.
- Comprobaciones:
  - sin repetidos, con el mensaje «Ese paciente ya está en la cita.»;
  - el principal no puede estar en la lista.
- **Lo que no puede validar el esquema** lo comprueba el servicio: el interruptor del negocio, que
  los pacientes existan y estén activos, y el alcance.

## Ciclo de vida de un paciente en la cita

| Momento | Cita activa (pendiente o confirmada) | Cita atendida, no asistida o cancelada |
|---|---|---|
| Se agrega | Recibe el email del estado actual (solicitud o confirmación) | Sin email |
| Se quita | Recibe la cancelación, si el negocio tiene activos esos avisos | Sin email |
| La cita cambia de fecha u hora, se confirma, se reactiva o se cancela | Recibe el mismo email que el principal | No aplica |
| Llega la hora del recordatorio | Recibe su recordatorio una vez (clave propia) | No aplica |
| Se borra el paciente | Sale de la cita; la cita sigue | Igual |
| Se borra el principal | Se borra la cita con todos sus vínculos, como hoy | Igual |

Siempre sale **un email por dirección**, aunque dos pacientes compartan correo. La copia al
profesional sale una vez por cambio.

## Datos derivados

- **Historial** (`GET /appointments?clientId=X`): las citas donde X es el principal o un adicional.
- **Actividad** (`GET /clients/activity`):
  - una fila por paciente con todas sus participaciones;
  - `totalSpent` sólo con las citas donde es el principal.
- **Nombres de la cita:** `joinNames([principal, ...adicionales])`.
