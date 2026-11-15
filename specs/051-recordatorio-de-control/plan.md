# Plan de implementación: Recordatorio de control

**Rama**: `dev` · **Fecha**: 2026-11-15 · **Spec**: [spec.md](./spec.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

**Con migración** (la 058). La aplica el dueño del producto: para probar, en su base local; en producción, sólo al
publicar. Se queda en `dev` hasta que él lo pida.

## Decisiones que salen del código

1. **El control no se guarda: se calcula.** Sale de la última cita Atendida del paciente en cada servicio con «Volver
   en» (su fecha + los días). Sólo se guarda lo que pasa con él: si se le escribió o si se quitó, por la cita de la que
   sale. Así no hay que mantener nada al cambiar una cita, un servicio o un paciente.
2. **«Desde cuándo» para no escribir de golpe:** el negocio guarda cuándo encendió el interruptor y el servicio cuándo
   le pusieron o cambiaron «Volver en». El email sólo sale por controles que vencen desde la más reciente de las dos
   fechas (RF-009).
3. **El enlace para no recibir más** es el de la fila guardada al escribirle (un token por control, como la encuesta).
   El email abre una página que pide confirmar con un botón: así un programa que revisa los enlaces del email no da de
   baja al paciente.
4. **Permisos:** los de la lista de espera (`appointments.manage`, con `agendaScope` para el rol Profesional).

## Diseño

1. **La migración** (`back/db/migrations/058_recordatorio_de_control.sql`):
   - `services.return_after_days` (7, 14, 30, 60, 90, 180 o 365; vacío = No) y `services.return_after_since`;
   - `businesses.control_reminders_since`, cuando se encendió el interruptor;
   - `clients.control_reminders_opted_out_at`;
   - **`control_reminders`:** una fila por cita Atendida de la que salió un control al que se le escribió o que se quitó:
     `business_id`, `appointment_id` (única), `client_id` y `service_id`, todos con `on delete cascade`; `token`;
     `emailed_at`; `removed_at` y `removed_by`. Con RLS.

2. **Lo compartido** (en front/, `npm run sync:shared` desde back/):
   - **los tipos:**
     - `Service.returnAfterDays`;
     - `NotificationSettings.controlReminders`;
     - `ControlReminder` y `PublicControlReminder`;
     - el `EmailType` `control_reminder`;
   - **las validaciones:** `returnAfterDays` en `serviceSchema` (opcional: un panel anterior conserva el guardado) y
     `controlReminders` en `notificationSettingsSchema` (`false` por defecto);
   - **las constantes:**
     - `RETURN_AFTER_OPTIONS` y `describeReturnAfter`;
     - `CONTROL_SEND_HOUR` (10);
     - `CONTROL_EMAIL_DAYS_LATE` (30);
     - `CONTROL_LIST_DAYS_AHEAD` (30);
   - **el email:** `emailTemplates.controlReminder`, con uno o varios servicios, «Reservar mi control» por cada uno y
     «No quiero recibir estos recordatorios».

3. **La API** (`back/src/services/control-reminders.ts`, nuevo):
   - **`list(ctx, businessId, { clientId })`:** sin `clientId`, los vencidos y los de los próximos 30 días; con
     `clientId`, los de ese paciente (la ficha). Sin los pacientes con una cita por delante (Pendiente o Confirmada,
     como principal o como otra persona de la cita), sin los quitados ni los pacientes desactivados.
     `GET /businesses/:id/control-reminders`.
   - **`remove(ctx, businessId, appointmentId)`:** lo quita, con su entrada en la actividad.
     `POST /businesses/:id/control-reminders/:appointmentId/remove`.
   - **`runControlReminderJob(db, businessId, at)`:** con el interruptor encendido, desde las 10:00 de la hora del
     negocio. Busca los controles vencidos de hoy hasta 30 días atrás y desde el «desde cuándo», sin email todavía, de
     pacientes con email y sin la marca. Por paciente:
     - guarda las filas;
     - pone en cola un solo email `control_reminder` (nivel paciente, sin copia al profesional, sin descarte).

     `queueControlReminders(now)` en `scheduled-tasks.ts`, en el cron de GitHub y en el local (`jobs/reminders.ts`),
     antes del envío.
   - **El enlace público:**
     - `GET /public/control-reminders/:token` (el negocio y si ya pidió no recibirlos);
     - `POST /public/control-reminders/:token/opt-out` (la marca, con la actividad).

     Con un límite de peticiones y `no-store`, como la encuesta.
   - **Lo que se toca:**
     - `serviceService` guarda «Volver en» y su fecha;
     - `businessService.update` guarda la fecha del interruptor al encenderlo;
     - la actividad (`SERVICE_FIELDS` y `NOTIFICATION_FIELDS`);
     - `EMAIL_PRIORITY` y las etiquetas de `scripts/cron.ts`;
     - `TABLE_INFO`, `TABLES` del seed y `leftovers` de `delete-business.test.mjs`.

4. **El front:**
   - **el servicio:** «Volver en» (un `Select`) en `service-form-dialog.tsx`;
   - **Configuración → Notificaciones:** `ControlReminderSettingsForm`, junto a la encuesta;
   - **la Agenda:** el botón «Controles (N)», si algún servicio tiene «Volver en», y `ControlRemindersSheet`
     (`front/src/features/control-reminders/`) como la hoja de la lista de espera, con:
     - «WhatsApp» (`buildControlWhatsAppMessage`);
     - «Agendar» (la cita nueva con el paciente, el servicio y el profesional);
     - «Quitar», con su confirmación;
   - **la ficha del paciente:** «Próximo control» o «Control vencido hace…»;
   - **la página de reservas:** `?servicio=…&profesional=…` elige el servicio (y el profesional, si lo atiende);
   - **la página nueva `/recordatorio/:token`:** confirmar «No quiero recibir estos recordatorios», con `noindex` en
     `vercel.json` y la ruta limpia en los avisos de errores;
   - **las etiquetas:** del email (`EMAIL_TYPE_LABELS`) y de la actividad;
   - **`check:control-reminders`**, con las funciones puras.

5. **La constitución, 1.49.0, en los dos repos** (principio III):
   - la decisión;
   - la excepción a la copia al profesional;
   - que no se escribe por lo que ya había vencido.

**No se hace:**
- el WhatsApp automático;
- la campana y el celular;
- el informe mensual y la descarga de datos;
- las otras personas de una cita en pareja;
- la beta.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| I. Español | Sí | Textos, emails y documentación en español |
| II. Privacidad | Sí | El email no lleva nada de la historia; logs con cifras; sin ntfy ni push |
| III. Decisiones del dueño | Sí | Sin WhatsApp automático, sin la beta; la excepción a la copia va en la constitución |
| Auditar todo | Sí | «Volver en», el interruptor, «Quitar» y la baja del paciente; el envío automático, no |
| Pruebas en local | Sí | `tests/control-reminders.test.ts` con base temporal y `check:control-reminders` |
| Costo de Vercel | Sí | El envío lo hace el cron |
| Diseño | Sí | La hoja copia la de la lista de espera: una gama, claro y oscuro, 390 px |

## Pruebas

- **`back/tests/control-reminders.test.ts`:** todo lo de CE-001, moviendo el momento del cron como la encuesta.
- **`front/scripts/check-control-reminders.ts`:**
  - el texto de la fecha («vence en 5 días», «venció hace 2 semanas»);
  - el mensaje de WhatsApp;
  - la lectura de `?servicio&profesional`.
- **El recorrido local con Playwright:** el servicio, la hoja, «Agendar», la ficha, el interruptor, la reserva con el
  servicio elegido y la página de la baja, en el computador y en el celular.
