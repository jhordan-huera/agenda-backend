# Plan de implementación: El paciente confirma o cancela su cita desde el email

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R15) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

**Cómo funciona para el paciente:**
- cada email de una cita activa trae un enlace a su página **«Tu cita»**: ve la fecha, la hora, el
  servicio, el profesional, el lugar y el contacto del negocio, sin iniciar sesión;
- en el recordatorio, un toque en **«Confirmo que voy»** abre la página con «¡Gracias! Te esperamos…»
  y la cita queda marcada. El estado no cambia: confirmarla sigue siendo del negocio;
- si el negocio permite cancelaciones y aún hay tiempo, **«Cancelar mi cita»** la cancela con los
  avisos de siempre y ofrece «Elegir otra hora». Si no, la página da el WhatsApp o el teléfono del
  negocio.

**Backend** (lo principal):
- **El enlace (R1, R2):**
  - el del paciente principal es el mismo del pago, que ya existe;
  - cada otra persona de una sesión tiene el suyo;
  - responde igual si no existe, si caducó (30 días después de la cita) o si el negocio está
    suspendido.
- **Tres rutas públicas nuevas (R3, R4, R6):** ver la cita, confirmar y cancelar, con su límite de
  peticiones (R9).
- **Cancelar usa el mismo cambio de estado que el panel (R6):**
  - el email de cancelación con copia al profesional;
  - la actividad: «Cancelada por el paciente desde su email»;
  - el aviso por ntfy dice lo mismo (R8).
- **La confirmación se borra sola** si cambian la fecha, la hora o el profesional, o si la cita se
  cancela (R5).
- **Emails (R7):**
  - el enlace en los emails de cita activa, y «Confirmo que voy» en el recordatorio;
  - la copia al profesional nunca los lleva.

**Front:**
- la página «Tu cita» (`/cita/…`) y un enlace a ella desde la página de pago (R12);
- la marca «Confirmó el paciente» en la agenda (bloque, lista del celular y ficha) y en el Inicio
  (R10);
- los textos de Configuración → Agenda y un aviso si el recordatorio sale cuando ya no se puede
  cancelar (R11);
- tipos, plantillas y la regla de cancelación compartidos.

**Beta:** lo mismo con sus datos de prueba, y la bandeja de emails simulada con los enlaces que se
pueden abrir (R13).

**Migración 037:**
- la confirmación de cada persona;
- el enlace propio de cada otra persona de la sesión;
- el borrado automático de la confirmación.

**Constitución 1.7.0**, una sola vez para las specs 010, 011 y 012. El texto que añade esta spec está
abajo.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Node ejecuta `.ts` en el backend; el front usa React 19.

**Dependencias**: ninguna nueva. Sin servicios externos nuevos: WhatsApp es un enlace `wa.me` ya
escrito, como hoy.

**Almacenamiento**: la migración 037 (ver [data-model.md](./data-model.md)).
- Usa `payment_token` (025) y `appointment_clients` (032).
- Los límites de peticiones usan `rate_limits` (029).

**Variables nuevas**: ninguna.

**Pruebas**: la suite nueva y las que se actualizan de [quickstart.md](./quickstart.md), con
`npm test` y `npm run typecheck`. En el front y la beta, `npm run build` y `npm run lint`, más el
recorrido con Playwright a 390 px.

**Restricciones**:
- **CPU de Vercel:** cada confirmación o cancelación es una consulta corta, y el aviso por ntfy lo
  manda el cron.
- **Gmail:** no hay emails nuevos. La cancelación ya existía, y la confirmación no manda nada.

## Comprobación contra la constitución (1.6.0 → 1.7.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | La página, los emails, los avisos y la documentación, en español. |
| II. Privacidad | Sí | «Tu cita» no muestra el nombre, el contacto ni la cédula del paciente, ni a las otras personas de la sesión, ni datos clínicos (R3). El enlace no se puede adivinar (128 bits al azar) y caduca. La analítica ya cambia el token por «[token]» y quita `?confirmar=1`. ntfy lleva al paciente a medias y el título sin el negocio. |
| III. Decisiones | Sí | Se mantienen las decisiones vigentes. Ver la lista que sigue a la tabla. |
| IV. Local | Sí | Todo se comprueba en local ([quickstart.md](./quickstart.md)). |
| V. Compartido | Sí | Tipos (`PublicAppointment`, `Appointment.clientConfirmations`), plantillas (`appointmentPage`, el bloque `link`) y la regla `canCancelOnline` se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin servicios ni dependencias nuevas. ntfy, por el cron. La CSP no cambia. |
| VII. Diseño | Sí | La marca usa los tokens del tema, como «Llegó», con texto y no sólo un icono. La página usa los colores de cada negocio y se revisa a 390 px. |
| Restricciones | Sí | La migración 037 la aplica el dueño antes de publicar, como paso aparte. |

**Decisiones vigentes del principio III que se mantienen:**
- la copia al profesional de cada email al paciente, también la de la cancelación, sin los botones del
  paciente;
- «Por verificar» (spec 009): el enlace va al correo escrito al reservar y sobrevive a «unir a la
  ficha»;
- todo cambio de estado se avisa (spec 008): la cancelación del paciente manda el email, la copia y el
  aviso por ntfy. La casilla «Avisar al paciente» es del panel y no aplica;
- sólo el principal recibe los datos de pago;
- nada de WhatsApp por API.

**Sin excepciones.**

**Constitución 1.7.0 (MENOR), en los dos repos.** Es la misma subida para las specs 010, 011 y 012.
Esta spec añade:

- **Principio II:** «Las páginas públicas (reservas, pago y «Tu cita») no exponen datos internos del
  negocio ni de otros pacientes.». Hoy dice «(reservas, pago)».
- **Principio III,** un punto nuevo:

  > - El paciente confirma o cancela su cita desde «Tu cita», el enlace privado que traen los emails
  >   de una cita activa, sin iniciar sesión. El del paciente principal es el mismo del pago, y cada
  >   otra persona de una sesión tiene el suyo. «Confirmo que voy» es una marca aparte: no cambia el
  >   estado (confirmar la cita sigue siendo decisión del negocio), no avisa por ntfy y se borra si
  >   cambian la fecha, la hora o el profesional, o si la cita se cancela. Cancelar desde ahí sólo lo
  >   puede el paciente principal, si el negocio tiene «Permitir cancelaciones» y falta más que su
  >   antelación; si no, la página da el WhatsApp o el teléfono del negocio. La cancelación avisa
  >   como todo cambio de estado, y la copia al profesional no lleva los botones del paciente
  >   (2026-10-14).

## Cambios respecto a la spec

Hay que aprobarlos con el plan:

1. **El texto del enlace depende de si esa persona puede cancelar (R7).**
   - **«Ver o cancelar mi cita»:** si podrá cancelar cuando salga el email.
   - **«Ver mi cita»:** para las otras personas de la sesión, si el negocio no permite cancelaciones
     o si ya está fuera de plazo.
   - **Por qué:** así el email no promete algo que la página no deja hacer.
   - **Ojo:** con los valores de fábrica, el recordatorio dirá «Ver mi cita». Ver la pregunta 1.
2. **«Confirmo que voy» también está en la página,** no sólo en el recordatorio (R4). Así se puede
   confirmar desde cualquier email de la cita.
3. **«Caducado» (RF-011) queda definido (R2):** el enlace deja de abrirse 30 días después de la cita.
   Tampoco se abre si a esa persona la quitan de la cita o si cambia el paciente principal. Responde
   igual que un enlace que no existe.
4. **Cambiar el paciente principal desde el panel le da un enlace nuevo a la cita (R2).** El del
   paciente anterior, también el de pago, deja de funcionar. Así quien ya no es el paciente no puede
   cancelar la cita de otro. Unir a la ficha (spec 009) no lo cambia.
5. **La copia al profesional de la cancelación dice «La canceló el paciente desde su email» (R7).** Así
   sabe que no fue alguien del negocio.
6. **Seis emails llevan el enlace:** los cuatro de la spec, más «Tu cita ha sido restablecida» y «Tu
   cita queda pendiente de confirmar». También son de una cita activa (RF-006).
7. **El ajuste está en Configuración → Agenda (R11),** que es como se llama la pestaña; la spec dice
   «Reservas». Además, avisa si el recordatorio sale cuando ya no se puede cancelar.
8. **Textos:**
   - el filtro de la actividad «Reservas online» pasa a «Pacientes (página y emails)»;
   - el aviso de ntfy se titula «Agenda360: cita cancelada por el paciente».

## Decisiones del dueño del producto (2026-10-14)

El dueño aprobó el plan con estas respuestas, que mandan sobre lo que digan las preguntas de abajo:
1. **Valores de fábrica:** se quedan como están (recordatorio 24 h antes y antelación de 24 h), y
   Configuración avisa al negocio de que con esos valores el recordatorio llega fuera de plazo.
2. **Cancelación del paciente:** además de la copia al profesional y del aviso por ntfy, **también
   sale un email al negocio** (Recepción), si su email es distinto del del profesional.
3. **El enlace de «Tu cita»** deja de funcionar 30 días después de la cita.

## Preguntas para el dueño del producto

1. **El recordatorio y la antelación para cancelar.**
   - **El problema:** con los valores de fábrica, el recordatorio sale 24 h antes y la antelación es de
     24 h. Cuando llega el recordatorio ya no se puede cancelar desde la página. El paciente podrá
     confirmar, pero para cancelar la página le pedirá escribir al negocio. Sí podrá cancelar desde
     los emails anteriores (la reserva o la confirmación).
   - **Lo que propone este plan:** dejar los valores como están y mostrar el aviso en Configuración →
     Agenda.
   - **La otra opción:** cambiar un valor de fábrica para los negocios nuevos, por ejemplo una
     antelación de 12 h. Sería una decisión tuya.
2. **El email del negocio.** Como dice la spec, la cancelación le llega:
   - al profesional, con la copia;
   - a ti, por ntfy.

   El email del negocio (recepción) no recibe nada aparte, y en un negocio con varias agendas
   recepción sólo lo ve en la agenda. ¿Está bien así?
3. **¿30 días después de la cita te parece bien** para que el enlace deje de abrirse?

## Estructura

```text
specs/010-paciente-confirma-cancela/   spec, plan, research, data-model, contracts/api.md, quickstart, tasks, reporte

agenda-backend
  .specify/memory/constitution.md                 1.7.0 (una vez, con 011 y 012)
  db/migrations/037_patient_confirms_cancels.sql  NUEVO (data-model)
  src/db/columns.ts                               clientConfirmationsSql en appointmentColumns (R10)
  src/services/appointment-page-service.ts        NUEVO: findByLinkToken, ver, confirmar y cancelar (R1–R4, R6)
  src/routes/platform-routes.ts                   GET /public/appointments/:token, POST …/confirm y …/cancel; mi-cita y mi-cita-acciones (R9)
  src/services/business-data-service.ts           saveAppointment: token nuevo y sin confirmación al cambiar el principal (R2);
                                                  cancelFromPatientLink (R6); confirmClaim conserva access_token y confirmed_at;
                                                  clientConfirmations: [] en el borrador de create
  src/services/notifications.ts                   appointmentPageUrl; token y confirmación de cada Recipient; origen "patient_link";
                                                  el enlace por persona en notifyAppointmentChange y runReminderJob; byPatient en la copia (R7)
  src/services/booking-alerts.ts                  findStatusChanges lee la acción; statusChangeNotice «por el paciente» (R8)
  src/db/seed-data.ts, src/db/seed.ts             citas demo confirmadas por el paciente
  src/shared/**                                   sólo con npm run sync:shared
  README.md                                       «Tu cita» y sus rutas
  tests/appointment-page.test.ts                  NUEVA
  tests/email-templates.test.mjs, status-notices.test.ts, booking-alert.test.ts, reminders.test.ts,
  tests/multi-client-appointments.test.ts, couple-booking.test.ts, booking-verify.test.ts, payments.test.ts   actualizadas

agenda-front
  .specify/memory/constitution.md                 1.7.0 (una vez, con 011 y 012)
  src/types/index.ts                              PublicAppointment, PublicAppointmentResult, Appointment.clientConfirmations
  src/lib/email/layout.ts                         bloque «link»
  src/lib/email/templates.ts                      appointmentPage en los seis emails; «Confirmo que voy»; byPatient en la copia
  src/lib/constants/business.ts                   canCancelOnline, APPOINTMENT_PAGE_DAYS
  src/app/router.tsx                              /cita/:token
  src/pages/appointment-page.tsx                  NUEVO: «Tu cita» (R12)
  src/features/patient-appointment/               NUEVO: tarjeta de la cita, confirmar y cancelar
  src/lib/data/repository.ts, api-repository.ts   getAppointment, confirmAppointment, cancelAppointment
  src/hooks/queries/use-public-booking.ts, query-keys.ts   usePublicAppointment, useConfirmAppointment, useCancelAppointment
  src/lib/whatsapp.ts                             getCantAttendWhatsAppUrl
  src/pages/payment-page.tsx                      enlace «Ver o cancelar mi cita»
  src/features/appointments/client-confirmed-badge.tsx   NUEVO: la marca (R10)
  src/features/appointments/appointment-utils.ts  resumen de quién confirmó
  src/features/appointments/appointment-details-sheet.tsx   la marca con la hora y por persona
  src/features/calendar/time-grid-view.tsx, agenda-list-view.tsx   la marca en el bloque y en la lista
  src/features/dashboard/today-list.tsx, next-up.tsx                la marca en el Inicio
  src/features/settings/booking-settings-form.tsx  textos y aviso del recordatorio (R11)
  src/features/settings/activity-log.tsx           «Pacientes (página y emails)»
  README.md                                        «Tu cita» y la marca

agenda-beta: tipos, plantillas, layout y canCancelOnline (copia a mano); /cita/:token y sus partes; repositorio de prueba
  (getAppointment, confirmAppointment, cancelAppointment); StoredAppointment y migrateData con los tokens y las
  confirmaciones de las otras personas; borrar la confirmación al mover o cancelar; emails con el enlace por persona;
  la marca en la agenda, el Inicio y la ficha; enlaces que se abren en la bandeja simulada; citas demo confirmadas
```

## Publicación

**El orden importa (R14):** así ningún email lleva a una página que todavía no existe.

1. **Constitución 1.7.0,** al aprobar este plan, en los dos repos. Es la misma subida para las specs
   010, 011 y 012.
2. **Migración 037,** como paso aparte, antes de publicar el código:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

   El backend publicado sigue igual con ella: sólo añade columnas y el borrado automático.
3. **PR `dev` → `main` del front.**
   - El panel funciona con el backend de antes: la marca simplemente no aparece.
   - La página «Tu cita» ya existe, pero aún ningún email lleva su enlace.
4. **PR `dev` → `main` del backend.** Desde ese momento, los emails y los recordatorios del cron llevan
   el enlace. Al publicarse, abrir esta dirección y ver `"ok":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   No hace falta probar en producción: todo se comprueba antes en local.
5. **Beta:** se actualiza en su carpeta, sin git y sin este flujo.

No hay variables nuevas en Vercel ni en GitHub.

## Riesgos

- **Un enlace reenviado o filtrado** permite confirmar o cancelar esa cita. La spec lo acepta. Para
  limitarlo:
  - muestra pocos datos y nada del paciente;
  - caduca 30 días después de la cita;
  - cancelar pide confirmarlo y sólo se puede dentro del plazo del negocio.
- **Algunos antivirus del correo abren los enlaces** para revisarlos. Casi ninguno puede confirmar,
  porque confirmar exige ejecutar la página y una cabecera especial (R4). Si alguno lo hiciera, sólo
  quedaría la marca «Confirmó el paciente»: la cita no cambia de estado, y cancelar nunca ocurre sin
  pulsar «Sí, cancelar mi cita».
- **El equipo del negocio ve los enlaces en «Emails enviados».** Pasa lo mismo hoy con el del pago. Si
  alguien del equipo lo usara, quedaría registrado como hecho por el paciente. En el panel real los
  enlaces de esa lista no se pueden pulsar: son texto.
- **Con los valores de fábrica, el recordatorio no permite cancelar** (pregunta 1). El aviso de
  Configuración lo explica.
- **La hora liberada puede tardar hasta un minuto y medio** en verse en la página de reservas: la CDN
  guarda la página unos segundos. La reserva siempre vuelve a comprobar la hora.
- **Si se publicara el backend antes que el front,** los emails de esos minutos llevarían a una página
  que aún no existe. Funcionarían después, al publicar el front. El orden de arriba lo evita.
- **Spec 011 (citas que se repiten):** cada cita de una serie tendrá su enlace. Cómo los muestra el
  email único de la serie lo decide su plan.
