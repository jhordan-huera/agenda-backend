# Contratos: Citas que se repiten

Lo que cambia en la API, en los emails, en los avisos de ntfy y en el WhatsApp del panel. Lo que no
está aquí sigue igual. Todas las rutas son del panel: piden sesión y el permiso `appointments.manage`,
como las de las citas de hoy.

## Rutas nuevas

### `POST /api/businesses/:businessId/appointment-series/preview`

La lista de fechas, antes de crear (R1–R4). No cambia nada.

**Cuerpo:**

```json
{
  "appointment": {
    "clientId": "…",
    "extraClientIds": [],
    "serviceId": "…",
    "date": "2026-10-20",
    "startTime": "10:00",
    "durationMinutes": 60,
    "price": 30,
    "status": "confirmed",
    "notes": "",
    "homeVisit": null,
    "isVirtual": false,
    "professionalId": "…"
  },
  "repeat": { "frequency": "weekly", "count": 8 }
}
```

- `appointment` es el mismo cuerpo de `POST /appointments`, con el estado sólo `pending` o
  `confirmed` y la fecha desde hoy.
- `repeat.frequency`: `weekly`, `biweekly` o `monthly`. `repeat.count`: de 2 a 24, contando la
  primera.

**Respuesta 200** (`AppointmentSeriesPreview`):

```json
{
  "dates": [
    { "date": "2026-10-20", "startTime": "10:00", "endTime": "11:00", "status": "free", "reason": null, "freeTimes": [] },
    { "date": "2026-10-27", "startTime": "10:00", "endTime": "11:00", "status": "busy",
      "reason": "Ya hay una cita de 10:00 a 11:00", "freeTimes": ["08:00", "09:00", "11:00", "15:00"] },
    { "date": "2026-11-03", "startTime": "10:00", "endTime": "11:00", "status": "blocked",
      "reason": "Bloqueado: Congreso", "freeTimes": [] },
    { "date": "2026-11-10", "startTime": "10:00", "endTime": "11:00", "status": "plan_limit",
      "reason": "Supera el cupo del plan (20 citas al mes)", "freeTimes": [] }
  ],
  "planRemaining": { "2026-10": 9, "2026-11": 24 }
}
```

- **`status`:** `free`, `busy` (otra cita), `blocked` (bloqueo), `day_off` (ese día no atiende),
  `outside_hours` (fuera del horario) o `plan_limit` (supera el cupo). La tabla de qué se puede hacer
  con cada una está en [research.md](../research.md) (R3).
- **`freeTimes`:** las horas libres de ese día en la cuadrícula del negocio. Sólo en las marcadas
  `busy`, `blocked` y `outside_hours`.
- **`planRemaining`:** las citas que quedan en el cupo de cada mes de la serie, topadas en 24; `null`
  si el plan no tiene tope.

**Errores:**

| Código | Cuándo |
|---|---|
| 400 `validation` | Datos de la cita inválidos, frecuencia o número fuera de rango, estado que no es Pendiente ni Confirmada, o la primera fecha antes de hoy. |
| 403 `forbidden` | Rol Profesional en otra agenda: «Sólo puedes agendar citas en tu propia agenda». O sin permiso. |
| 404 `not_found` | El paciente, el servicio o el profesional no son del negocio o no están a su alcance. |

### `POST /api/businesses/:businessId/appointment-series`

Crea la serie con las fechas que quedaron en la lista (R5).

**Cuerpo:** lo mismo que la vista previa, más las fechas finales:

```json
{
  "appointment": { "…": "igual que en la vista previa" },
  "repeat": { "frequency": "weekly", "count": 8 },
  "dates": [
    { "date": "2026-10-20", "startTime": "10:00" },
    { "date": "2026-10-27", "startTime": "11:00" },
    { "date": "2026-11-03", "startTime": "10:00", "allowOutsideHours": true }
  ]
}
```

- **`dates`:** de 2 a 24, sin repetir. Cada fecha tiene que ser de las que da la serie (la primera
  fecha, la frecuencia y el número): sólo se puede cambiar la hora o quitar fechas.
- **`allowOutsideHours`:** «Agendar igual» en un bloqueo, un día que no atiende o fuera del horario.
  Sin él, esas fechas no se crean.

**Respuesta 201** (`AppointmentSeriesCreated`):

```json
{
  "series": { "id": "…", "total": 7, "frequency": "weekly" },
  "created": [ { "id": "…", "date": "2026-10-20", "series": { "id": "…", "index": 1, "total": 7, "frequency": "weekly" }, "…": "…" } ],
  "skipped": [ { "date": "2026-11-17", "startTime": "10:00", "reason": "Se ocupó mientras revisabas la lista" } ]
}
```

- **`created`:** las citas creadas, en orden, cada una con su `series`.
- **`skipped`:** las fechas que llegaron y no se crearon, con su motivo: se ocupó, se bloqueó o pasó
  el cupo mientras se revisaba la lista. Las que se quitaron en la lista no llegan y no salen aquí.

**Errores:** los de la vista previa y además:

| Código | Cuándo |
|---|---|
| 400 `validation` | Una fecha que no es de la serie, repetida, o menos de 2. |
| 409 `conflict` | No se pudo crear ninguna: «No se creó ninguna cita: todas las fechas chocan. Revisa la lista.» |
| 402 `plan_limit` | No se pudo crear ninguna y todas pasaban el cupo: «Has alcanzado el límite de citas de tu plan.» |

### `POST /api/businesses/:businessId/appointments/:appointmentId/cancel-following`

«Cancelar ésta y las siguientes» (R10).

**Cuerpo:**

```json
{ "notify": true }
```

- `notify` es la casilla «Avisar al paciente» de la ficha (spec 008): `true` si no llega.

**Respuesta 200:**

```json
{ "cancelled": [ { "id": "…", "status": "cancelled", "series": { "index": 3, "total": 8, "…": "…" }, "…": "…" } ] }
```

- Las citas que pasaron a Canceladas, en orden: la de la ficha y las siguientes de la serie que
  estaban Pendientes o Confirmadas.

**Errores:**

| Código | Cuándo |
|---|---|
| 404 `not_found` | La cita no es del negocio o, para el rol Profesional, no es de su agenda. |
| 409 `conflict` | «Esta cita no es de una serie.» o «No quedan citas activas de la serie desde ésta.» |

## Rutas que cambian

### `GET /api/businesses/:businessId/appointments` y `GET …/appointments/:appointmentId`

- Cada cita gana `series`: `{ id, index, total, frequency }` o `null`. Lo mismo en todas las
  respuestas que devuelven una `Appointment` (crear, editar, cambiar el estado, la llegada, el pago).

### `PUT /api/businesses/:businessId/appointments/:appointmentId` y `PATCH …/status`

- Sin cambios: en una cita de la serie cambian sólo esa cita.

### `POST /api/businesses/:businessId/appointments/:appointmentId/whatsapp-notice`

- `kind` acepta también `series_cancelled`.

### `POST /api/businesses/:businessId/appointments`

- Sin cambios. Las citas sueltas siguen saliendo con `series: null`.

### Reserva online (`/api/public/…`)

- Sin cambios: no crea series.

## Emails

### `appointment_series` (nuevo, al paciente)

Plantilla `appointmentSeries`, compartida.

| Campo | Contenido |
|---|---|
| Asunto | «Tus próximas 8 citas en {negocio}» |
| Texto | Confirmada: «Tus 8 citas de {servicio} con {profesional} están confirmadas.» Pendiente: «…quedaron agendadas y pendientes de confirmar. Te avisaremos cuando estén confirmadas.» |
| Tus citas | Una fila por cita: «Cita 1 · Martes 20 de octubre, 10:00–11:00» (con la zona en las virtuales). Cada fila enlaza a «Tu cita» de la spec 010 (o al pago, si la 010 no está y hay algo que pagar). |
| Una vez | Servicio, profesional, precio de cada cita (si se muestra), lugar (local con «Cómo llegar», virtual con el enlace, o a domicilio con la dirección) y la política de cancelación. |
| Pago | Si la agenda cobra por transferencia: las cuentas y «Transfiere {monto} por cada cita y sube el comprobante desde el enlace de cada fecha». Sólo al paciente principal. |

**A quién va:** a cada paciente de la sesión, uno por dirección. La copia (`appointment_copy`) va una
vez al profesional, con «Copia · {pacientes}: …», la nota y «Ver en la agenda», y sin los enlaces de
cada fecha.

**Sólo si** «Confirmaciones» está encendido en el negocio.

### `appointment_series_cancelled` (nuevo, al paciente)

Plantilla `appointmentSeriesCancelled`, compartida.

| Campo | Contenido |
|---|---|
| Asunto | «Se cancelaron 6 citas en {negocio}» |
| Aviso | «Se cancelaron tus citas de {servicio} en {negocio}:» y la lista de fechas y horas. |
| Cierre | «Si quieres, puedes reservar una nueva cita:» con el botón «Reservar una nueva cita». |

**A quién va:** a cada paciente con las fechas en que está, uno por dirección, y una copia por
profesional con las de su agenda.

**Sólo si** «Avisar al paciente» está marcada y «Cancelaciones» está encendido.

### `professional_new_appointment` (al profesional)

- Con una serie, uno solo, con las reglas de hoy (avisos activados, no la agendó él, no le llegó ya
  la copia).
- **Asunto:** «Nueva serie: {paciente} · 8 citas desde el martes 20 de octubre».
- **Lleva** la lista de fechas, además de los datos de la cita y «Ver mi agenda».

### Lo que no cambia

- **Recordatorios:** uno por cita, el día que toca, con su copia.
- **Cambios de estado, de fecha o de hora de una cita de la serie:** sus emails de siempre (spec 008).

## Avisos por ntfy (cron)

- **Citas del panel:** las de una serie ya no tienen un aviso cada una.
- **Nuevo: serie creada.**
  - **Título:** «Agenda360: nueva serie de citas».
  - **Mensaje, una línea por dato:**
    - `{negocio} · serie de 8 citas desde el panel`;
    - `Cada semana · mar 20 oct 10:00 → mar 8 dic 10:00`;
    - `Paciente: Juan P. · ju***@gmail.com · ***5555` (uno por paciente);
    - `{servicio} · 60 min · $30` (de cada cita);
    - `Con {profesional} · en el local`;
    - `Confirmada` o `Pendiente de confirmar`;
    - `1 fecha no se creó`, si se pidieron más de las que se crearon;
    - `Agendada desde el panel por Ana T. (Recepción)`;
    - los emails («Al paciente», «Copia al profesional», «Aviso al profesional») con su estado.
  - **Prioridad:** 3. **Tope:** 10 por pasada, más la cifra del resto.
- **Nuevo: serie cancelada.**
  - **Título:** «Agenda360: serie de citas cancelada».
  - **Mensaje:**
    - `{negocio} · 6 citas canceladas desde mar 20 oct 10:00`;
    - el paciente a medias y el servicio;
    - `Cancelada desde el panel por Ana T. (Recepción)`;
    - los emails, o «Sin avisar al paciente (se desmarcó la casilla)».
  - **Prioridad:** 3. **Tope:** 10 por pasada.
- **Registro del cron:** suma «series del panel: N · series canceladas: N».
- **Resumen de emails enviados:** los grupos «Serie de citas» y «Serie de citas cancelada», con su
  copia en la misma línea.

## WhatsApp del panel

- **Al cancelar ésta y las siguientes,** con «Avisar al paciente» marcada, el panel ofrece el mensaje
  ya escrito (tipo `series_cancelled`):

  ```
  Hola Ana, tus citas de Terapia individual con Mente Abierta del martes 20 de octubre, martes 27 de octubre y martes 3 de noviembre quedaron canceladas. Si quieres agendar otras, puedes hacerlo aquí: {enlace de reservas}
  ```

- **Al crear la serie,** como al crear una cita suelta, no se ofrece WhatsApp.

## Configuración

Ninguna nueva.
