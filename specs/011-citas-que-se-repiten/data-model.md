# Modelo de datos: Citas que se repiten

## Migración 038 (`db/migrations/038_appointment_series.sql`)

Es una sola migración, que el dueño aplica antes de publicar el backend. Va después de la 037 (spec
010) y antes de la 039 (spec 012).

```sql
-- Citas que se repiten (spec 011): una serie agrupa las citas que se agendaron juntas desde el panel
-- («cada semana, 8 sesiones»). Cada cita sigue siendo una cita normal; la serie sólo guarda cómo se
-- creó, para la ficha («Cita 3 de 8»), la actividad y los avisos.

-- 1. La serie.
create table appointment_series (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses (id) on delete cascade,
  frequency       text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- Las fechas de la lista (de 2 a 24) y las citas que se crearon (sin las quitadas ni las que chocaron).
  requested_count smallint not null check (requested_count between 2 and 24),
  created_count   smallint not null check (created_count between 1 and requested_count),
  created_by      uuid references users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index appointment_series_created_idx on appointment_series (created_at);
alter table appointment_series enable row level security;

-- 2. La cita: a qué serie pertenece y su número en ella (1, 2, 3…, sin huecos). Sin «on delete»: la
--    app nunca borra una serie sola; al borrar un negocio se borran antes sus citas.
alter table appointments
  add column series_id    uuid references appointment_series (id),
  add column series_index smallint check (series_index between 1 and 24),
  add constraint appointments_series_check check ((series_id is null) = (series_index is null));

create index appointments_series_idx on appointments (series_id, series_index) where series_id is not null;
```

- **Las citas de hoy quedan igual:** las dos columnas son `null`, sin valor por defecto.
- **Protección de filas** en la tabla nueva, como las demás: la API REST automática de Supabase no la
  puede leer.
- **El índice por `created_at`** es para el cron, que busca las series nuevas de cada pasada (R11).
- **`appointments_no_overlap`** (001) no cambia: sigue siendo la red de seguridad de cada cita.
- **Datos demo:** `src/db/seed.ts` añade `appointment_series` a `TABLES` (la lista que se vacía antes
  de cargar la demo).

## Entidades

### Serie de citas (`appointment_series`, tipo `AppointmentSeries`)

| Campo | Qué es |
|---|---|
| `id` | La serie. |
| `businessId` | El negocio. |
| `frequency` | `weekly` (cada semana), `biweekly` (cada 2 semanas) o `monthly` (cada mes, el mismo día; si no existe, el último). |
| `requestedCount` | Las fechas de la lista, de 2 a 24. |
| `createdCount` | Las citas que se crearon: es el «de 8» de la ficha. |
| `createdBy` | Quién la agendó (para ntfy). `null` si su usuario ya no existe. |
| `createdAt` | Cuándo. Es el mismo instante que el de sus citas, sus emails y su entrada de actividad. |

**Reglas:**
- **Sólo desde el panel.** La reserva online no crea series.
- **Nunca se edita.** Cambiar o cancelar se hace en cada cita. La única acción de grupo es «Cancelar
  ésta y las siguientes», que cambia las citas, no la serie.

### Cita (`appointments`, tipo `Appointment`)

- **Gana `series: AppointmentSeriesRef | null`:**

  ```ts
  interface AppointmentSeriesRef {
    id: string;
    /** Su número en la serie: 1, 2, 3… */
    index: number;
    /** Cuántas citas se crearon con la serie («Cita 3 de 8»). */
    total: number;
    frequency: AppointmentSeriesFrequency;
  }
  ```

  Sale en `appointmentColumns()` (`src/db/columns.ts`), con `total` y `frequency` leídos de
  `appointment_series` por su clave primaria. Las citas que se crean sueltas llevan `series: null`.
- **Cada cita de la serie tiene sus propios** recordatorio (`scheduled_at`), estado, precio, enlace de
  pago (`payment_token`), comprobante, llegada y, desde la spec 010, confirmación del paciente.

**Ciclo de vida:**

```text
«Repetir» + «Revisar fechas»  ──►  lista: libre · otra cita · bloqueo · no atiende · fuera de horario · cupo
        │                                (cambiar la hora, quitar o «Agendar igual»)
        ▼  «Crear N citas» (negocio bloqueado; se vuelve a comprobar cada fecha)
 appointment_series + N citas (series_index 1…N) · 1 email por paciente + 1 copia · 1 entrada de actividad
        │
        ├──► cada cita se cambia sola (fecha, hora, estado, pago): como una cita normal
        │
        └──► «Cancelar ésta y las siguientes»: las activas con series_index ≥ la de la ficha pasan a
             Canceladas · 1 email por paciente + 1 copia por profesional · 1 entrada de actividad
```

### Fecha de la lista (respuesta de la vista previa, tipo `SeriesDatePreview`)

No se guarda: es lo que devuelve `POST …/appointment-series/preview`.

| Campo | Qué es |
|---|---|
| `date`, `startTime`, `endTime` | La fecha y la franja. |
| `status` | `free`, `busy`, `blocked`, `day_off`, `outside_hours` o `plan_limit` (R3). |
| `reason` | El texto que se muestra («Ya hay una cita de 10:00 a 11:00», «Bloqueado: Vacaciones»…). `null` si está libre. |
| `freeTimes` | Las horas libres de ese día para «Otra hora». Vacía en las libres, en `day_off` y en `plan_limit`. |

Con la lista llega `planRemaining`: cuántas citas quedan en el cupo de cada mes (`"2026-11": 12`),
topado en 24, o `null` si el plan no tiene tope (R4).

### Email (`notifications`)

**Tipos nuevos, a pacientes:** los dos cuentan como emails a terceros (`THIRD_PARTY_EMAIL_TYPES`, tope
diario de la spec 009).

| Tipo | Cuándo | `appointment_id` |
|---|---|---|
| `appointment_series` | Al crear la serie, con «Confirmaciones» encendido. Uno por dirección de paciente. | La primera cita creada. |
| `appointment_series_cancelled` | «Cancelar ésta y las siguientes», con «Avisar al paciente» marcado y «Cancelaciones» encendido. Uno por dirección. | La cita desde la que se canceló. |

**Copia al profesional:** el tipo de siempre, `appointment_copy`. Va una vez por serie al crear y una
por profesional al cancelar.

**Aviso al profesional:** el tipo de siempre, `professional_new_appointment`, una vez por serie (R8).

**Sin columna nueva:** el email se une a su serie por la cita y por el instante (`created_at`), como
los avisos de ntfy de hoy.

### Registro de actividad (`audit_logs`)

**Acciones nuevas** (tipo de entidad `appointment`, `entity_id` = el id de la serie):

| Acción | Cuándo | Resumen | Cambios |
|---|---|---|---|
| `appointment.series_created` | Se crea la serie. | «Agendó una serie de 8 citas de María López, cada semana desde el 20/10/2026 10:00» (+ «(1 no se creó)»). | «Fechas»: las fechas y horas creadas. |
| `appointment.series_cancelled` | «Cancelar ésta y las siguientes». | «Canceló 6 citas de la serie de María López desde el 20/10/2026 10:00» (+ «(sin avisar al paciente)»). | «Citas canceladas»: las fechas. |

- **No hay una `appointment.created` por cada cita de la serie** (RF-010).
- **Se guardan 5 meses**, como el resto de la actividad que no es de sesión ni de historia clínica
  (`purge_audit_logs`, migración 026).
- **El aviso de WhatsApp de la cancelación** queda como `appointment.whatsapp_notice`, el de siempre,
  con el resumen «Abrió WhatsApp para avisar la cancelación de las citas de la serie a …».

### Tipos compartidos (`agenda-front/src/types/index.ts`, copia con `sync:shared`)

- `AppointmentSeriesFrequency = "weekly" | "biweekly" | "monthly"`.
- `AppointmentSeriesRef` y `Appointment.series` (arriba).
- `SeriesDateStatus`, `SeriesDatePreview`, `AppointmentSeriesPreview` (`{ dates, planRemaining }`).
- `AppointmentSeriesCreated`: `{ series: { id, total, frequency }; created: Appointment[]; skipped: { date, startTime, reason }[] }`.
- `EmailType` gana `appointment_series` y `appointment_series_cancelled`.
- `WhatsAppNoticeKind` gana `series_cancelled`.

### Validaciones compartidas (`src/lib/validations/appointment.ts`)

- `seriesRepeatSchema`: `{ frequency, count }`, con `count` entero de 2 a 24.
- `appointmentSeriesPreviewSchema`: `{ appointment: appointmentSchema, repeat: seriesRepeatSchema }`,
  con el estado sólo Pendiente o Confirmada y la primera fecha desde hoy (la API lo comprueba con la
  zona del negocio).
- `appointmentSeriesSchema`: lo anterior más `dates`: de 2 a 24 `{ date, startTime, allowOutsideHours }`,
  sin fechas repetidas.
- `cancelFollowingSchema`: `{ notify: boolean }`, que vale `true` si no llega.
- `whatsAppNoticeSchema` gana `series_cancelled`.

## Configuración nueva

Ninguna. No hay variables nuevas en Vercel, Lambda ni GitHub.
