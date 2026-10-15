# Modelo de datos: El paciente confirma o cancela su cita desde el email

## Migración 037 (`db/migrations/037_patient_confirms_cancels.sql`)

Es una sola migración, que el dueño aplica antes de publicar (ver el plan). Las specs 011 y 012 usan
la 038 y la 039.

1. **«Confirmo que voy» del paciente principal.** Vacía: aún no confirmó. No cambia el estado de la
   cita.

   ```sql
   alter table appointments add column client_confirmed_at timestamptz;
   ```

2. **Cada otra persona de la sesión: su enlace a «Tu cita» y su confirmación** (R1, R4).

   ```sql
   alter table appointment_clients
     add column access_token text not null default replace(gen_random_uuid()::text, '-', ''),
     add column confirmed_at timestamptz;
   create unique index appointment_clients_access_token on appointment_clients (access_token);
   ```

   - **El valor por defecto se calcula fila a fila:** las personas que ya están en una cita reciben
     cada una su token, igual que hizo la 025 con `payment_token`.
   - **Al quitar a una persona de la cita,** su fila se borra y su enlace deja de valer.

3. **La confirmación es de una fecha, una hora y un profesional** (R5). Se borra si cambia alguno de
   los tres o si la cita se cancela.

   ```sql
   create function appointments_reset_client_confirmation() returns trigger
   language plpgsql as $$
   begin
     if new.date is distinct from old.date or new.start_time is distinct from old.start_time
        or new.professional_id is distinct from old.professional_id
        or (new.status = 'cancelled' and old.status <> 'cancelled') then
       new.client_confirmed_at := null;
     end if;
     return new;
   end;
   $$;

   create trigger appointments_reset_client_confirmation
     before update of date, start_time, professional_id, status on appointments
     for each row execute function appointments_reset_client_confirmation();

   create function appointments_reset_extra_confirmations() returns trigger
   language plpgsql as $$
   begin
     if new.date is distinct from old.date or new.start_time is distinct from old.start_time
        or new.professional_id is distinct from old.professional_id
        or (new.status = 'cancelled' and old.status <> 'cancelled') then
       update appointment_clients set confirmed_at = null
        where appointment_id = new.id and confirmed_at is not null;
     end if;
     return new;
   end;
   $$;

   create trigger appointments_reset_extra_confirmations
     after update of date, start_time, professional_id, status on appointments
     for each row execute function appointments_reset_extra_confirmations();
   ```

   - **Cambiar el paciente principal** borra su confirmación y le da un token nuevo en
     `saveAppointment`, no aquí (R2). Unir a la ficha (spec 009) no la borra.
   - **Atendida y No asistió** no la borran.

No hay más cambios de esquema. La protección de filas de `appointment_clients` ya está activa (032).

## Entidades

### Cita (`appointments`, tipo `Appointment`)

- **Columnas nuevas:** `client_confirmed_at` (migración 037).
- **El token del pago (`payment_token`)** también es el del enlace «Tu cita» del principal.
  - **Cambia** sólo si el panel cambia el paciente principal. Así el enlace del paciente anterior,
    también el de pago, deja de servir.
  - **No cambia** al unir a la ficha.
- **El tipo gana un campo**, que también ve el panel:

  ```ts
  /**
   * Quienes confirmaron que van desde su email (spec 010), el principal primero. Vacía: nadie.
   * Un backend anterior no la manda: el panel la trata como vacía.
   */
  clientConfirmations: { clientId: string; confirmedAt: ISODateTime }[];
  ```

  Sale de `appointmentColumns()`, con una subconsulta sobre `client_confirmed_at` y
  `appointment_clients.confirmed_at` (`clientConfirmationsSql`, en `src/db/columns.ts`).

**Ciclo de la confirmación:**

```text
cita activa (pendiente o confirmada), sin confirmar
        │  «Confirmo que voy» (email o página)
        ▼
 confirmada por el paciente (client_confirmed_at / confirmed_at = ahora) ── repetir: no cambia nada
        │
        ├─ cambia la fecha, la hora o el profesional ─► sin confirmar (el nuevo email lleva el enlace)
        ├─ se cancela (el negocio o el paciente)     ─► sin confirmar (si se reactiva, puede volver a confirmar)
        ├─ cambia el paciente principal (panel)      ─► sin confirmar y enlace nuevo para el principal
        └─ Atendida / No asistió                     ─► se conserva
```

### Persona de la sesión (`appointment_clients`)

- **`access_token`:** su enlace a «Tu cita». No abre `/pago`: los datos de pago son sólo del
  principal.
- **`confirmed_at`:** su «Confirmo que voy».
- **Unir a la ficha (`confirmClaim`)** borra y vuelve a insertar la fila: conserva los dos valores.

### Página «Tu cita» (sin tabla)

- **Se abre por el enlace privado** de cada persona: `/cita/<token>`.
- **Responde 404,** con el mismo mensaje que a un enlace que no existe, si:
  - el token no existe;
  - el negocio no está activo;
  - pasaron más de 30 días desde la cita (`APPOINTMENT_PAGE_DAYS`);
  - la persona ya no está en la cita.
- **Tipos nuevos,** compartidos (`src/types/index.ts`). Ver los campos en
  [contracts/api.md](./contracts/api.md):
  - `PublicAppointment`;
  - `PublicAppointmentResult` (`{ appointment, already }`).

### Configuración del negocio (`bookingSettings`, sin cambios de forma)

- **`allowCancellations` y `cancellationNoticeHours`** pasan a decidir si se puede cancelar desde
  «Tu cita». Hasta hoy sólo se mostraban como texto de la política.
- **Regla compartida** (`src/lib/constants/business.ts`):

  ```ts
  /** El paciente principal puede cancelar desde «Tu cita»: el negocio lo permite y falta más que su antelación. */
  export const canCancelOnline = (
    settings: Pick<BookingSettings, "allowCancellations" | "cancellationNoticeHours">,
    minutesUntilStart: number,
  ) => settings.allowCancellations && minutesUntilStart > settings.cancellationNoticeHours * 60;

  /** Días después de la cita en que su enlace «Tu cita» deja de abrirse. */
  export const APPOINTMENT_PAGE_DAYS = 30;
  ```

### Email (`notifications`, sin cambios de forma)

- **Sin tipos nuevos.** La cancelación del paciente usa `appointment_cancelled` y `appointment_copy`.
- **`AppointmentEmailData`** (plantillas compartidas) gana dos datos:

  ```ts
  /**
   * Página «Tu cita» de quien recibe el email (spec 010): su enlace, si podrá cancelar desde ahí
   * cuando salga el email y si ya confirmó que va. Nunca en la copia al profesional.
   */
  appointmentPage?: { url: string; canCancel: boolean; confirmed: boolean } | null;
  ```

  `professionalCopy` gana `byPatient?: boolean`: la nota de la copia dice que la canceló el paciente.
- **`EmailBlock`** (`layout.ts`) gana `{ kind: "link"; label: string; url: string }`.

### Registro de actividad (`audit_logs`)

**Acciones nuevas:**

| Acción | Autor | Resumen | `changes` |
|---|---|---|---|
| `appointment.client_confirmed` | `actor_id` null, `actor_name` «Paciente (desde su email)» | «Confirmó que va, desde su email: María López (20/10/2026 10:00)». Sólo esa persona, no las demás de la sesión. | — |
| `appointment.client_cancelled` | ídem | «Cancelada por el paciente desde su email: María López y Carlos Pérez (20/10/2026 10:00)» | «Estado: Confirmada → Cancelada», como los demás cambios de estado: así lo encuentra el aviso de ntfy |

- **La confirmación se registra sólo la primera vez.** Repetirla no registra nada.

### Límites de peticiones (`rate_limits`, migración 029)

| Nombre | Rutas | Tope por conexión |
|---|---|---|
| `mi-cita` | `GET /public/appointments/:token` | 60 en 15 min |
| `mi-cita-acciones` | `POST /public/appointments/:token/confirm` y `…/cancel` | 20 en 15 min |

## Configuración nueva

Ninguna: sin variables nuevas ni servicios externos.
