# Plan de implementación: Las citas, como invitaciones de calendario

**Rama**: `dev` · **Fecha**: 2026-10-19 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La migración 048, `048_calendar_invites.sql`:**
   - **`professionals.calendar_invites boolean not null default false`:** el interruptor de cada
     agenda.
   - **`calendar_invites`:** lo que ya se le envió a cada profesional por cada cita.
     - Columnas: `appointment_id` (FK con `on delete cascade`), `professional_id` (FK con `on delete
       cascade`), `email`, `sequence int`, `fingerprint text`, `cancelled boolean` y `updated_at`.
     - Clave primaria: `(appointment_id, professional_id)`.
     - RLS como las demás tablas.
   - **`notifications.calendar text`:** el contenido iCalendar de la invitación, como `secret`
     guarda las contraseñas hasta enviarse.
   - **`TABLE_INFO`** de `database-stats-service.ts` suma la tabla nueva, con su regla de borrado: se
     borra sola con la cita o la agenda.

2. **El evento** (`src/services/calendar-invites.ts`, nuevo, y su prueba):
   - `buildInviteIcs({ method, uid, sequence, start, end, summary, location, description, url,
     status, organizer, attendee })` arma un iCalendar RFC 5545:
     - `METHOD:REQUEST` o `CANCEL`;
     - `UID:<id de la cita>@agenda360`;
     - `SEQUENCE`, `DTSTAMP` y `DTSTART`/`DTEND` en UTC (`Z`), así no hace falta `VTIMEZONE`;
     - `STATUS`: `TENTATIVE` si está por confirmar, `CONFIRMED` o `CANCELLED`;
     - el `ORGANIZER` es el Gmail de la plataforma (`config.gmailUser`), y el `ATTENDEE`, el
       profesional, con `RSVP=FALSE`;
     - el texto escapado (`\`, `;`, `,` y saltos de línea) y las líneas dobladas a 75 bytes.
   - **El contenido del evento:**
     - **título:** el paciente a medias con `shortName` de `masking.ts` («Juan P. y Ana T. · Terapia
       de pareja»), con «Por confirmar · » delante si está pendiente;
     - **lugar:** la dirección del negocio, «En línea» con su enlace o «A domicilio»;
     - **descripción:** «Ver en Agenda360: <enlace a la cita>» y «Si la cita cambia o se cancela, este
       evento se actualiza solo»;
     - **`URL`:** el mismo enlace, `agendaUrlOf()` de `notifications.ts`.
   - **La huella** (`fingerprint`) resume lo que se ve en el calendario: fecha, horas, título,
     lugar y estado. Si no cambió, no se envía nada.

3. **La sincronización,** `syncCalendarInvites(db, appointmentIds)`, en el mismo archivo y en la misma
   transacción del cambio. Para cada cita:
   - **lo que debería haber:** si la agenda tiene el interruptor y un email, la cita está «Por
     confirmar» o «Confirmada», y empieza entre ahora y dentro de 14 días, la invitación con su huella;
   - **lo enviado** a cada profesional (`calendar_invites`) se compara con eso:
     - **si no hay nada enviado,** `REQUEST` con `SEQUENCE 0`;
     - **si la huella cambió,** `REQUEST` con la secuencia más 1;
     - **si está cancelada,** o ya no es de esa agenda, y lo enviado no está cancelado, `CANCEL` con la
       secuencia más 1;
     - **las completadas y las «No asistió»** no se tocan;
   - **cada envío** es un email `calendar_invite` en la cola (`queueEmail` con `calendar`), al email
     de avisos de la agenda: `nullif(p.email, '')` o el de su usuario, el mismo de la copia.
     - Asunto: «Cita: Juan P. · Terapia individual · mar 20 oct, 15:00», «Cambió: …» o «Cancelada: …».
     - Cuerpo: un HTML corto con los datos y el botón «Ver en Agenda360».

4. **Dónde se llama** (todo lo que crea o cambia una cita):
   - `business-data-service.ts`: crear, editar, cambiar el estado (con o sin aviso al paciente) y
     reactivar;
   - `public-booking-service.ts`: la reserva por la página;
   - `appointment-series-service.ts`: la serie, sólo con las citas dentro de la ventana;
   - la cancelación del paciente desde «Tu cita».

   Se revisan con `grep` todos los `insert into appointments` y `update appointments`. Los que sólo
   tocan el pago, el comprobante o «Confirmo que voy» no cambian el evento y no llaman a la
   sincronización.

5. **La ventana, en el cron** (`scheduled-tasks.ts`): una vez por pasada se sincronizan las citas de
   las agendas con el interruptor que empiezan en los próximos 14 días. Es una consulta pequeña, y la
   huella evita repetir envíos. El registro sólo lleva la cifra: «invitaciones de calendario: 3».

6. **El interruptor:**
   - **validación compartida** (`front/src/lib/validations`): `calendarInvites` en el formulario de la
     agenda y en «Tu agenda»;
   - **API:**
     - el cambio de la agenda (Profesionales: propietario o administrador) y el de «Tu agenda» (el
       profesional, la suya) aceptan `calendarInvites`;
     - si pasa a `true`, sincroniza enseguida las citas de esa agenda;
     - va a la actividad: «Activó las invitaciones de calendario de la agenda de …» o «Desactivó…»;
   - **front:**
     - un `SwitchField` en `professional-form-dialog.tsx` (debajo de «Email para sus avisos») y en
       `own-agenda-card.tsx`;
     - lleva la explicación de la spec y a qué email llegan;
     - deshabilitado y explicado si la agenda no tiene email.

7. **El envío** (`mailer.ts` y `gmail-transport.ts`): si el email trae `calendar`, el compositor de
   nodemailer recibe `icalEvent: { method, content }`. Eso arma la parte `text/calendar; method=…`
   que Gmail y Apple reconocen como invitación. Los topes (`email-limits.ts`): `calendar_invite`
   cuenta como `business`.

8. **Constitución 1.23.0** (MENOR), en las decisiones vigentes: «Las citas pueden llegar al profesional
   como invitaciones de calendario por email (spec 027), si activa el interruptor de su agenda: el
   paciente a medias, sólo las de los próximos 14 días, y se actualizan o cancelan con el mismo
   evento. La suscripción para iPhone/iPad y la conexión con Google siguen paradas (2026-10-19).»

**Migración:** 048. **Variables:** ninguna nueva (usa `GMAIL_USER`).

## Pruebas

**Backend:**
- **`tests/calendar-invites.test.ts`** (nueva, contra la base desechable):
  - **El interruptor:**
    - el propietario lo cambia en cualquier agenda, el profesional en la suya, y la recepción no;
    - va a la actividad;
    - al activarlo salen las invitaciones de las citas de los próximos 14 días, y no las de más
      lejos.
  - **El ciclo de una cita:**
    - crear da `REQUEST` con `SEQUENCE:0`;
    - moverla da `REQUEST` con `SEQUENCE:1` y el mismo `UID`;
    - cambiar sólo el pago no envía nada;
    - cancelarla da `CANCEL` con `SEQUENCE:2`;
    - reactivarla da `REQUEST` con `SEQUENCE:3`.
  - **Pendiente y confirmada:** una reserva de la página sale `TENTATIVE`, con «Por confirmar» en el
    título, y al confirmarla sale `CONFIRMED`.
  - **Otra agenda:** al profesional anterior le llega `CANCEL` y al nuevo `REQUEST`.
  - **Lo que no envía nada:** las completadas, las «No asistió» y una agenda con el interruptor
    apagado.
  - **La ventana:**
    - una serie de 24 semanales sólo envía las de los 14 días;
    - una cita a 20 días no envía nada; al llevarla con sql a 10 días, el cron la envía una vez, y en
      la siguiente pasada no la repite.
  - **Privacidad:** en el iCalendar y en el email no aparecen la cédula, el email, el teléfono ni las
    notas del paciente, ni datos clínicos. Sí aparecen el nombre a medias y el enlace.
  - **Los topes:** cuenta en los emails del negocio.
- **Envío:** en la prueba del transporte de Gmail, que el mensaje lleva `text/calendar; method=REQUEST`
  y el adjunto.
- **Las que cambian:** `database-stats` (la tabla nueva en `TABLE_INFO`) y la del cron (la cifra en
  el registro).
- **La suite completa** y `npm run typecheck`.

**Front:** build, lint y `check:contrast`. El recorrido del interruptor en Profesionales y en «Tu agenda»,
en los dos modos y a 390 px.

**Comprobación real, antes de publicar y con el dueño:**
- con `dev:local` y Gmail, los emails van a la cuenta de la plataforma;
- se activa el interruptor de una agenda y se crea, mueve y cancela una cita;
- en Gmail o Google Calendar y en un iPhone, se comprueba que el evento se añade, se mueve sin
  duplicarse y se quita.

## Publicación

1. **La migración 048,** como paso aparte, antes del backend.
2. **El backend y después el front.**
3. **Después:** activar el interruptor de una agenda de prueba y mirar el calendario.
