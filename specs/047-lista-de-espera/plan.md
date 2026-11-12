# Plan de implementación: Lista de espera

**Rama**: `dev` · **Fecha**: 2026-11-12 · **Spec**: [spec.md](./spec.md)

**Con migración** (la 056): la lista, las horas liberadas y los avisos nuevos de la campana. La aplica el dueño del
producto antes de publicar el backend. El interruptor no necesita columna: va en `bookingSettings`.

## Decisiones que salen del código (para aprobar con el plan)

1. **Sólo el propietario enciende la lista.** Configuración → Agenda, como el resto de esa pestaña, pide
   `business.manage`, que sólo tiene el propietario. La spec decía «el propietario y los administradores»; abrirlo a
   los administradores pediría un permiso y una ruta aparte.
2. **«Reservar esta hora» llega con el nombre, el email y el teléfono escritos, pero la reserva sigue pidiendo la
   cédula.** La lista no la pide y la reserva online la necesita (spec 038).
3. **La anticipación mínima es la del negocio** (`bookingSettings.minNoticeHours`): no existe una por agenda.
4. **El aviso de la hora libre se descarta si no salió en 3 horas** (por ejemplo, porque se acabó el cupo de Gmail).
   Es lo que pide la spec (RF-006); la constitución dice que los emails que no caben esperan en la cola, así que esta
   excepción también va en ella.
5. **La campana no guarda nombres:** dice «Nueva persona en la lista de espera» y «Se liberó el martes 10:00: 2
   personas en la lista de espera», sin quién. Así no queda el nombre de nadie 30 días en los avisos.

## Diseño

1. **La base de datos** (`db/migrations/056_lista_de_espera.sql`), con RLS en cada tabla:
   - **`waitlist_entries`:** una persona en espera.
     - `business_id`, `service_id` y `professional_id` (nulo = «Cualquiera»), todos con `on delete cascade`;
     - `client_id`, opcional y con `on delete cascade`: se llena cuando el equipo anota a un paciente que ya existe;
     - `name`, `email` (opcional desde el panel), `phone`;
     - `days` (los días de la semana), `day_parts` (`morning`, `afternoon` o `evening`) y `until` (la fecha hasta la
       que espera);
     - `source` (`booking_page` o `dashboard`) y `created_by`;
     - `token`: 32 caracteres al azar, como el de «Tu cita», para el enlace «Salir de la lista» y para «Reservar
       esta hora»;
     - `offers_on` y `offers_today`: el tope de 3 emails al día;
     - `closed_at` y `closed_reason` (`booked`, `left`, `removed`, `scheduled`, `expired` o `inactive`).
   - **`waitlist_freed_slots`:** cada hora que se libera (el negocio, el profesional, la fecha, la hora de inicio y la
     de fin, y `processed_at`).
   - **El disparador `appointments_freed_slot`**, después de cada UPDATE o DELETE de `appointments`:
     - anota la hora si la cita estaba Pendiente o Confirmada, no es de un día pasado y el negocio tiene la lista
       encendida;
     - y si la cita pasa a Cancelada, cambia de fecha, hora o profesional, o se borra (también al borrar un paciente,
       en cascada).

     Así no se escapa ningún camino: editar, mover, la serie, «Tu cita», `notify: false`. Hoy no hay un punto común
     en el código.
   - **Los avisos de la campana:** se vuelven a crear `panel_notices_kind_check` y `panel_notices_scope_check` con
     `waitlist_joined` y `waitlist_slot` (como en la 049).

2. **El interruptor** (`bookingSettings.waitlist`, `false` por defecto con `.default(false)` en
   `bookingSettingsSchema`):
   - va en Configuración → Agenda (`booking-settings-form.tsx`) con un `SwitchField` y su explicación;
   - el cambio queda en la actividad (`BOOKING_FIELDS` en `audit-changes.ts`);
   - la página pública ya recibe `bookingSettings`: con eso sabe si muestra el enlace. La CDN guarda el perfil hasta
     90 s, así que encenderla tarda eso en verse.

3. **Anotarse desde la página de reservas** (`back/src/services/waitlist-service.ts`, nuevo):
   - **La ruta:** `POST /public/businesses/:slug/waitlist`, con el CAPTCHA (`requireCaptcha`) y su propio límite de
     peticiones (`limitRequests`, «lista de espera», 10 cada 15 min).
   - **La validación** (`front/src/lib/validations/waitlist.ts`, nuevo y compartido): el servicio, el profesional o
     «Cualquiera», al menos un día y una parte del día, la fecha (de mañana a `maxAdvanceDays`, 30 días por
     defecto), y nombre, email y teléfono.
   - **Con la lista apagada** o un negocio suspendido, responde lo mismo que un negocio que no existe.
   - **El mismo email,** para el mismo servicio y profesional, actualiza lo que pidió. Una persona tiene como mucho 5
     esperas abiertas por negocio.
   - **La actividad:** `waitlist.joined`, con `actor: null` y «Reserva online».
   - **El email «Te anotamos en la lista de espera»** (`waitlist_joined`) trae lo que pidió y el botón «Salir de la
     lista». Cuenta en el tope contra el abuso de los emails públicos (`publicEmailHold`).
   - **El aviso de la campana** `waitlist_joined`, sin el nombre.
   - **En el front** (`front/src/features/booking/waitlist-form.tsx`, nuevo):
     - en el paso de la fecha y la hora sale «¿No encuentras una hora que te sirva? Anótate en la lista de espera»;
     - abre el formulario: los días, las partes del día (Mañana, Tarde y Noche, las mismas de `time-slots.tsx`, que
       pasan a una constante compartida), la fecha, el profesional si el negocio deja elegirlo, y los datos (llenos
       con los guardados en el navegador, como la reserva);
     - al terminar: «Listo, te avisaremos por email si se libera una hora que te sirva».

4. **El enlace de la persona** (`/lista-de-espera/:token`, página nueva):
   - **`GET /public/waitlist/:token`:** lo que pidió y sus datos (sólo para esa persona, como «Tu cita»).
   - **`POST /public/waitlist/:token/leave`:** sale de la lista, con su entrada en la actividad («Paciente (desde
     su email)»).
   - **Con la espera cerrada:** el enlace dice «Ya no estás en la lista de espera».
   - **La privacidad:**
     - `Cache-Control: private, no-store`;
     - `noindex` en `vercel.json`;
     - la ruta limpia en los avisos a Sentry (`error-report-rules.ts`).

5. **El aviso cuando se libera una hora** (`queueWaitlistOffers(now)` en `back/src/jobs/scheduled-tasks.ts`, antes
   de `processEmailQueue`, con su cifra en el registro del cron). Va negocio por negocio con la lista encendida, con
   `forEachBusiness`:
   - **Cierra las esperas** vencidas (`expired`) y las de un servicio o un profesional desactivados (`inactive`).
   - **Por cada hora liberada sin procesar,** busca las esperas abiertas que encajan:
     - su servicio, y su profesional o «Cualquiera» (si el profesional ofrece ese servicio);
     - el día de la semana y la fecha hasta la que espera.
   - **Calcula las horas que se pueden reservar dentro de ese hueco** con `getAvailableSlots`, igual que la página de
     reservas: con el horario, los bloqueos, las otras citas, la anticipación mínima y los días hacia adelante.
     Después se queda con las de la parte del día que pidió.
   - **El email «Se liberó una hora»** (`waitlist_offer`) sale a cada persona con email que tenga al menos una hora:
     - todas las horas que le sirven de esa pasada (como mucho 3), cada una con «Reservar esta hora»;
     - como mucho 3 emails al día por persona (`offers_on` y `offers_today`);
     - sin copia al profesional;
     - se descarta si no salió en 3 horas (decisión 4: una regla en `deliver`, como la de los recordatorios, con su
       motivo en `DISCARD_REASONS`).
   - **El aviso de la campana** `waitlist_slot`, si alguien espera esa hora: cuántas personas, también las que no
     tienen email o cuando ya no se puede reservar online. Es para el profesional de esa agenda y para el resto del
     equipo que ve las reservas.
   - **Al final,** marca la hora como procesada. Borra las horas procesadas de hace más de 2 días y las esperas
     cerradas hace más de 30 (RF-012).
   - **En local,** `startReminderJob` también la corre, para probarla sin el cron de GitHub.

6. **«Reservar esta hora»:** el enlace es `/book/:slug?servicio=…&profesional=…&fecha=…&hora=…&espera=<token>`.
   - **La página de reservas** (`booking-page.tsx` y `booking-flow.tsx`) lee esos parámetros: elige el servicio, el
     profesional, la fecha y la hora, y abre directamente el paso de los datos.
   - **Con `espera`,** trae el nombre, el email y el teléfono de la persona (decisión 2).
   - **Si la hora ya no está libre,** dice «Esa hora ya se tomó» y muestra las otras horas de ese día. La persona
     sigue en la lista.
   - **La reserva** es una reserva online normal: nace Pendiente y respeta el cupo, el tope por persona y día y el
     CAPTCHA.
   - **Al reservar** en ese negocio (desde el email o no), las esperas abiertas con ese email se cierran (`booked`)
     en la misma transacción de la reserva.

7. **La lista en el panel** (`front/src/features/waitlist/waitlist-sheet.tsx`, nuevo):
   - **En la Agenda,** junto a «Por cerrar», el botón «Lista de espera (N)» abre el panel: a la derecha en el
     computador y desde abajo en el celular, como el del día del calendario de /admin. Se filtra por profesional.
   - **Cada persona:**
     - nombre, contacto, servicio, profesional o «Cualquiera», días, partes del día, hasta cuándo y desde cuándo
       espera;
     - **«WhatsApp»,** con un mensaje ya escrito para ofrecerle una hora;
     - **«Agendar»,** que abre la cita nueva con el servicio y el profesional. Si ya es paciente (el mismo email o
       teléfono, o su `client_id`), lo trae elegido; si no, abre primero «Nuevo cliente» con sus datos. Al guardar la
       cita, la espera se cierra (`scheduled`);
     - **«Quitar».**
   - **«Anotar»:** el mismo formulario, con un paciente existente o datos nuevos. El email es opcional.
   - **Las rutas** (`/businesses/:businessId/waitlist`):
     - `GET`;
     - `POST`;
     - `POST …/:entryId/close`, con el motivo `removed` o `scheduled`.

     Piden `appointments.manage`; el rol Profesional ve y maneja sólo las de su agenda (`agendaScope`). Cada cambio
     queda en la actividad (`waitlist.added`, `waitlist.removed`, `waitlist.scheduled`).
   - **Los avisos** de la campana abren el panel con `?espera=1`, como `?por-cerrar`.

8. **Lo que se toca por los tipos nuevos:**
   - **Los emails:** `EmailType`, sus plantillas en `front/src/lib/email/templates.ts`, `EMAIL_PRIORITY` (nivel
     paciente), `EMAIL_GROUPS` del cron, `TYPE_LABELS` del historial y la tabla de `email-quota.test.ts`.
   - **La campana:** `PushKind` y `NoticeKind`, `NOTICE_AUDIENCE` (como `booking`), `BUILDERS`, `ICONS` y una rama en
     `toPanelNotice` que lee `data` (la fecha, la hora y la cifra; nunca nombres). No mandan push ni ntfy.
   - **La actividad:** el tipo `waitlist` en `AuditEntityType`, `AUDIT_ENTITY_TYPES` y `AUDIT_TYPE_LABELS`.
   - **Las tablas:** `TABLE_INFO` de «Base de datos» de /admin, `TABLES` del seed y `leftovers` de
     `delete-business.test.mjs`.
   - **`npm run sync:shared`:** `validations/waitlist.ts` se crea antes vacío en el backend, porque el script sólo
     copia los archivos que ya existen.

9. **La descarga de datos** (spec 028): `lista-de-espera.xlsx`, con las esperas abiertas y las cerradas que todavía
   se guardan. Lleva su método paginado, su ruta, su cifra, su hoja, su paso y su línea en el LEEME. El rol
   Profesional descarga las de su agenda.

10. **La constitución, 1.46.0, en los dos repos** (principio III):
    - la decisión;
    - la excepción a la copia al profesional;
    - el descarte a las 3 horas;
    - que sólo el propietario la enciende;
    - que la campana no guarda nombres.

**No se hace:**
- ntfy ni avisos en el celular;
- avisar por un horario nuevo o un bloqueo quitado (sólo cancelaciones, cambios de hora y borrados);
- la beta.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | La página pública no dice quién ni cuántos esperan. Los avisos no llevan nombres. El enlace es personal, `no-store` y `noindex`. Los registros del cron sólo llevan cifras |
| III. Copia al profesional | Excepción | Los emails de la lista no son de una cita (RF-011). Va en la constitución |
| III. La cola no descarta | Excepción | El aviso de la hora libre se descarta a las 3 horas (RF-006). Va en la constitución |
| III. Actividad | Sí | Anotarse, salir, quitar, anotar y agendar van a la actividad; los envíos del cron, no |
| III. Reservas online | Sí | «Reservar esta hora» es una reserva normal: CAPTCHA, cupo, tope por persona y día, y nace Pendiente |
| IV. Pruebas sin depender del día | Sí | La tarea recibe `now`; las pruebas usan fechas relativas a ese `now` |
| V. Código compartido | Sí | La validación, los tipos, las plantillas y las partes del día se editan en el front |
| VI. Costo de Vercel | Sí | El aviso lo calcula el cron de GitHub. La API sólo anota la hora liberada, con el disparador de la base |
| VII. Diseño | Sí | El panel y los formularios de siempre, la gama de la marca, contraste AA y 390 px sin desbordes |

## Pruebas

- **`tests/waitlist.test.ts`** (nueva, la suite 75):
  - **Anotarse:** con la lista encendida; nada con ella apagada; el mismo email actualiza; el tope de 5 esperas; la
    validación; la actividad; el email «Te anotamos» y el aviso sin nombre.
  - **«Salir de la lista»** con el token, y el enlace de una espera cerrada.
  - **El disparador:** anota la hora al cancelar desde el panel, al cancelar desde «Tu cita», con la serie, al
    cambiar la hora, con `notify: false` y al borrar al paciente. No la anota con la lista apagada ni para un día
    pasado.
  - **`queueWaitlistOffers(now)`:**
    - el día, la parte del día, la fecha, el profesional o «Cualquiera», que quepa el servicio y la anticipación
      mínima (sin email, pero con aviso);
    - todos a la vez, varias horas en un email y el tope de 3 al día;
    - sin `appointment_copy`;
    - el descarte a las 3 horas;
    - cerrar las vencidas y las inactivas, y los borrados a los 2 y a los 30 días.
  - **Reservar desde el enlace** cierra la espera; la hora ya tomada responde `conflict`.
  - **El panel:** listar, anotar, quitar y agendar; el rol Profesional, sólo su agenda; otro negocio, 403.
  - **La descarga de datos** las incluye.
- **Las que se ponen al día:** `email-quota.test.ts`, `database-stats.test.ts` y `delete-business.test.mjs`.
- **Backend:** `typecheck` y `npm test`.
- **Front:**
  - build, lint y todas las `check:*`;
  - la nueva `check:waitlist`: leer los parámetros de «Reservar esta hora», las partes del día y el mensaje de
    WhatsApp;
  - `check:data-export`, con la hoja nueva en el LEEME.
- **Recorrido en el navegador** (Chromium a 1440 en claro y WebKit a 390 en oscuro), con capturas:
  - anotarse en la página de reservas;
  - el enlace «Salir de la lista»;
  - cancelar una cita y correr la tarea;
  - el email en el historial;
  - «Reservar esta hora» con la hora elegida y «Esa hora ya se tomó»;
  - la lista del panel: anotar, WhatsApp, agendar y quitar;
  - el interruptor;
  - sin desbordes ni errores en la consola.
- **Una prueba real** (CE-004): en local, con la cuenta de Gmail de pruebas, el email de la hora libre llega y se lee
  bien en el celular.

## Riesgos

- **El cron de GitHub puede atrasarse** en las horas de más carga: el «menos de 15 minutos» depende de él. Corre cada
  10 minutos, y cron-job.org ya lo dispara de respaldo.
- **El disparador corre en cada cambio de una cita.** Sólo inserta si el negocio tiene la lista encendida y la cita
  era futura y estaba activa: es una consulta por clave primaria, sin costo apreciable.
- **Avisar a todos a la vez** (respuesta 1) hace que alguien llegue tarde. La página se lo dice y le muestra las
  otras horas.
- **Es la función más grande desde el cobro de mensualidades.** Si en la implementación aparece algo que cambie lo
  aprobado, se pregunta antes.
