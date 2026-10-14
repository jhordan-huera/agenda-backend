# Plan de implementación: Aviso al paciente en cada cambio de estado de su cita

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md). Las
decisiones técnicas van en este plan (son pocas) y no hay modelo de datos nuevo.

## Resumen

- **Backend:**
  - los emails de cada cambio de estado salen de `clientMessageFor`, que gana tres casos;
  - el cambio de estado acepta `notify` (no avisar al corregir un error);
  - la configuración gana `followUps`.
- **Front:** la casilla en la ficha de la cita, el interruptor en Configuración, el mensaje de
  WhatsApp «queda pendiente de confirmar» y los nombres de los emails nuevos.
- **Beta:** lo mismo, con sus datos de prueba.
- **ntfy:** el cron avisa de cada cambio de estado, leyendo el registro de actividad (D9).
- **Migración:** no hace falta. El tipo de email es texto y la configuración es jsonb.

## Contexto técnico

**Lenguaje/versión**: TypeScript (Node ejecuta `.ts` en el backend; React 19 en el front).
**Dependencias**: las de siempre. **Ninguna nueva.**
**Almacenamiento**: sin cambios de esquema.
- `notifications.type` es texto y admite los tipos nuevos.
- `businesses.notification_settings` es jsonb; `followUps` se lee como `true` si no está guardado.

**Pruebas**:
- backend: `tests/status-notices.test.ts` (nueva), `npm test` y `npm run typecheck`;
- front y beta: `npm run build` y `npm run lint`;
- recorrido con Playwright de la ficha de la cita, en escritorio y a 390 px.

**Restricciones**:
- **Correos:** los emails de estado salen como los de hoy, al momento con `processEmailQueue`. Sin
  coste nuevo en Vercel.
- **Datos de pacientes:** sólo van a su dueño.

## Comprobación contra la constitución (1.4.0 → 1.5.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Emails, avisos y textos en español. |
| II. Privacidad | Sí | Cada paciente recibe sólo lo suyo. La actividad no guarda el contenido del email. |
| III. Decisiones | Sí | La copia al profesional se mantiene en los emails nuevos. Las decisiones de esta spec se anotan en la 1.5.0. |
| IV. Local | Sí | Pruebas y recorrido en local. |
| V. Compartido | Sí | Plantillas, tipos y validaciones se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | El mismo envío de hoy, sin servicios nuevos. |
| VII. Diseño | Sí | La casilla tiene su etiqueta y el interruptor, su descripción; también a 390 px. |

**Sin excepciones.**

## Decisiones

- **D1. Un solo lugar decide el email.** `clientMessageFor` (`src/services/notifications.ts`) añade
  tres casos, después de los de hoy, para no cambiar su prioridad:
  - → `pending` desde `confirmed`, `completed` o `no_show`: `appointment_pending` (con «Confirmaciones»);
  - → `completed`: `appointment_completed` (con «Seguimiento» y la cita de hace 7 días o menos);
  - → `no_show`: `appointment_no_show` (con las mismas condiciones).

  Lo demás (copia al profesional, un email por dirección, cada paciente con su nombre) ya lo hace
  `notifyAppointmentChange`.
- **D2. `notify` en la ruta.** `PATCH /businesses/:id/appointments/:id/status` acepta `{ status,
  notify }`, con `notify` `true` por defecto, así que las versiones anteriores del panel siguen
  igual. Con `false` no se llama a `notifyAppointmentChange` y la actividad añade «(sin avisar al
  paciente)».
- **D3. `followUps`.** En `notificationSettingsSchema`, `followUps: z.boolean().default(true)`, y en
  `DEFAULT_NOTIFICATION_SETTINGS`, `true`. El backend lo lee como `settings.followUps !== false` para
  los negocios guardados antes.
- **D4. Plantillas** en `lib/email/templates.ts`, compartidas:
  - `appointmentPending`: los datos de la cita y «te escribiremos para confirmarla»;
  - `appointmentCompleted`: el agradecimiento y el botón «Reservar de nuevo»;
  - `appointmentNoShow`: «Te esperábamos» y el botón «Elegir otra hora».

  Los dos últimos usan el enlace de reservas del negocio. `EmailType` gana los tres tipos.
- **D5. WhatsApp.** Un aviso nuevo, `unconfirmed`, para pasar a Pendiente desde un estado que no sea
  Cancelada:
  - `noticeForStatus` lo devuelve;
  - `buildAppointmentNotice` lleva su texto;
  - `whatsAppNoticeSchema` lo acepta y la actividad lo nombra «que su cita quedó pendiente de
    confirmar»;
  - `pending` sigue siendo el de una cita cancelada que vuelve.

  `sendsEmail()` del aviso refleja D1 y la casilla.
- **D6. La casilla.** En `appointment-details-sheet.tsx`, un `Checkbox` «Avisar al paciente por
  email y WhatsApp», marcado al abrir. `useUpdateAppointmentStatus` recibe `notify`; con `false`
  tampoco ofrece WhatsApp. «Cancelar cita» de la misma ficha también la usa.
- **D7. Bandeja de emails.** `TYPE_LABELS` gana «Pendiente de confirmar», «Gracias por la visita» y
  «No asistió».
- **D9. ntfy.** `findStatusChanges` en `src/services/booking-alerts.ts` busca en `audit_logs` las
  entradas de cita cuyo `changes` trae «Estado» (`changes @> '[{"label":"Estado"}]'`) en (desde,
  hasta]. Así entran los botones de estado (`appointment.<estado>`) y el formulario
  (`appointment.updated` o `rescheduled`).
  - **Cada aviso lleva:**
    - el estado de antes y el de después, sacados de ese cambio;
    - quién lo hizo, con su rol (como `byWhom`);
    - el paciente a medias (`maskedPatient`);
    - los emails de esa cita creados en el mismo instante, que es la misma transacción;
    - «sin avisar al paciente» si el resumen termina así.
  - **Pasada del cron:** `statusChangeNotice` arma el texto. `scripts/cron.ts` y
    `src/jobs/scheduled-tasks.ts` lo suman a `buildBookingNotices` con su tope de 10 y la cifra del
    resto.
- **D8. Constitución 1.5.0** (los dos repos), principio III: todo cambio de estado se avisa al
  paciente por email y WhatsApp, con la casilla para no avisar al corregir; «Seguimiento» encendido
  por defecto y sólo para citas de los últimos 7 días (2026-10-14).

## Estructura

```text
specs/008-avisos-cambio-estado/   spec, plan, contracts/api.md, quickstart, tasks, reporte

agenda-backend
  .specify/memory/constitution.md                 1.5.0
  src/services/notifications.ts                   clientMessageFor (D1)
  src/services/business-data-service.ts           updateStatus con notify (D2); etiqueta de WhatsApp (D5)
  src/routes/business-routes.ts                   pasa notify
  src/services/booking-alerts.ts                  findStatusChanges y statusChangeNotice (D9)
  src/jobs/scheduled-tasks.ts, scripts/cron.ts    los avisos de cambios de estado por ntfy
  src/shared/**                                   sólo con npm run sync:shared
  tests/status-notices.test.ts                    NUEVO

agenda-front
  .specify/memory/constitution.md                 1.5.0
  src/lib/email/templates.ts                      3 plantillas (D4)
  src/types/index.ts                              EmailType, WhatsAppNoticeKind, NotificationSettings
  src/lib/validations/business.ts, appointment.ts followUps, unconfirmed
  src/lib/constants/business.ts                   DEFAULT_NOTIFICATION_SETTINGS
  src/lib/whatsapp.ts                             unconfirmed (D5)
  src/features/appointments/whatsapp-notice.tsx   sendsEmail y motivo
  src/features/appointments/appointment-details-sheet.tsx   casilla (D6)
  src/hooks/queries/use-appointments.ts, src/lib/data/*     notify
  src/features/settings/notification-settings-form.tsx      «Seguimiento»
  src/features/settings/email-outbox.tsx          nombres de los tipos (D7)

agenda-beta: los mismos del front, más su repositorio de prueba (cambio de estado con notify y los
             emails de la cola simulada)
```

## Publicación

Sin migración. Primero el PR `dev` → `main` del backend y después el del front. Si el front sale
antes, la casilla desmarcada no tendría efecto hasta publicar el backend: por eso va primero el
backend.

## Riesgos

- **Más emails:** cada cambio de estado escribe al paciente. La casilla y los interruptores lo
  controlan.
- **Límite de envío de Gmail:** los emails nuevos son pocos (uno por cambio). El tope diario de envíos
  a terceros de hoy los cuenta igual.
