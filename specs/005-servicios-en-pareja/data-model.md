# Modelo de datos: Servicios en pareja o familia y su reserva online

**Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

## Migración `db/migrations/033_people_per_session.sql`

### `services.people_per_session` (nueva columna)

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `people_per_session` | smallint, obligatorio, `check (people_per_session between 1 and 3)` | `1` | Personas por sesión. Sólo vale si el negocio tiene `multi_client_appointments`. Si no, el servicio es individual, pero el dato se conserva (D2). |

Los servicios que ya existen quedan en 1.

### `appointment_clients.client_access_pending` (nueva columna)

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `client_access_pending` | boolean, obligatorio | `false` | Esta persona llegó por una reserva online y aún no da acceso a su ficha a un profesional con «sólo sus pacientes» (D7). |

**Trigger `appointment_clients_booking_access`** (`before insert`, una vez por fila). Pone
`client_access_pending = true` cuando se cumplen todas estas condiciones:

1. la cita es de `source = 'booking_page'` y se creó en esta misma transacción
   (`appointments.created_at = transaction_timestamp()`);
2. el paciente **no** se creó en esta transacción;
3. el paciente **no** lo registró el usuario del profesional de la cita;
4. el paciente **no** tiene con ese profesional otra cita que ya dé acceso, sea como principal o
   como otro paciente, sin marca pendiente.

Son las mismas reglas que el trigger de la migración 028 aplica al paciente principal. Las filas
que agrega el panel nunca cumplen la condición 1, así que quedan en `false` como hoy.

**Índice:** `(client_id) where client_access_pending`, para las consultas de alcance.

## Tipos compartidos (se editan en agenda-front y se copian con `npm run sync:shared`)

### `Service` (`src/types/index.ts`)

```ts
peoplePerSession: number; // NUEVO: 1, 2 o 3
```

`PublicService` lo hereda. El perfil público manda el valor efectivo: 1 si el negocio no tiene el
interruptor.

### `serviceSchema` (`src/lib/validations/service.ts`)

```ts
peoplePerSession: z.number().int().min(1).max(3).optional() // NUEVO: si no llega, se conserva el guardado
```

### `publicBookingSchema` (`src/lib/validations/booking.ts`)

```ts
extraPatients: z.array(bookingPersonSchema).max(2).default([]) // NUEVO
// bookingPersonSchema = { documentId, name, email, phone }, con los mismos validadores de hoy
// refine: ninguna cédula repetida, tampoco la de quien reserva
```

### `AppointmentEmailData` (`src/lib/email/templates.ts`)

```ts
bookedBy?: string; // NUEVO: quién reservó, en el email de solicitud de las otras personas (D8)
```

## Reglas y ciclo de vida

- **Personas efectivas de un servicio:** `peopleFor(business, service)` devuelve
  `business.multiClientAppointments ? service.peoplePerSession : 1`.
- **Una reserva por la página de un servicio de N personas:**
  1. reconoce o crea al paciente principal y a cada una de las otras N − 1 personas (D4);
  2. crea una cita `pending` con el principal;
  3. guarda a las otras personas en `appointment_clients`, y el trigger marca el acceso pendiente
     de cada una;
  4. pone en cola los emails.

  Todo pasa en una sola transacción.
- **Acceso de un profesional con «sólo sus pacientes»:**
  - la persona no le da acceso mientras su fila tenga `client_access_pending`;
  - lo da cuando la cita la confirma o la gestiona alguien del negocio que no es ese profesional
    (`releaseClientAccess`).
- **Interruptor apagado:** los servicios funcionan como individuales. Las citas que ya tienen
  varias personas las conservan, como en la fase 1.

## Lo que no cambia

- `appointments`: ni columnas ni triggers nuevos. `client_access_pending` sigue siendo la marca del
  paciente principal.
- `clients`: cada persona es un paciente normal, con su cédula, su ficha y su historia.
- Los triggers de la migración 032: máximo 3 pacientes, sin repetir al principal y del mismo
  negocio.
