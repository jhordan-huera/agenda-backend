# Plan de implementación: Citas que se repiten

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R16) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

**Cómo se usa:** en «Nueva cita» se enciende «Repetir», se elige cada cuánto (cada semana, cada 2
semanas o cada mes) y cuántas citas (de 2 a 24). «Revisar fechas» muestra la lista: cada fecha con su
día y su hora, y las que chocan marcadas con el motivo. En la lista se cambia la hora o se quita cada
una, y «Crear 7 citas» crea las demás.

**Backend** (lo principal):
- **La lista la calcula la API** con una función compartida con el front y la beta (R1): así lo que
  se ve y lo que se crea nunca discrepan. Sabe el cupo del plan de cada mes (R4).
- **Qué se marca (R3):** otra cita del profesional, un bloqueo, un día que no atiende, una hora fuera
  de su horario o el cupo del plan. Las de un bloqueo o fuera del horario se pueden «Agendar igual»,
  como hoy una cita suelta (ver «Cambios respecto a la spec»).
- **Crear la serie (R5):** todo junto y con el negocio bloqueado, como las citas de hoy. Se vuelve a
  comprobar cada fecha: si alguien agendó esa hora mientras se revisaba la lista, esa fecha no se
  crea y se avisa cuál. Nunca queda una cita solapada.
- **Un solo email al paciente** con todas las fechas, con copia al profesional (R7). Ya no sale un
  email por cita. Un solo aviso al profesional (R8).
- **Cada cita sigue siendo una cita normal (R9):** su recordatorio el día que toca, sus estados, los
  avisos de la spec 008 y su pago. Se cambia sola.
- **«Cancelar ésta y las siguientes» (R10):** un solo email con las fechas canceladas, con la casilla
  «Avisar al paciente».
- **ntfy y actividad (R11, R12):** un aviso y una entrada por serie, y lo mismo al cancelarla.

**Front:**
- «Repetir» en «Nueva cita» y la lista de fechas en el mismo diálogo (R13);
- la ficha de la cita con «Cita 3 de 8» y «Cancelar ésta y las siguientes»;
- el WhatsApp ya escrito con las fechas canceladas;
- las plantillas de los emails, los tipos y las validaciones compartidas.

**Beta:** lo mismo con su repositorio de prueba y su bandeja de emails simulada (R15).

**Migración 038:** la tabla `appointment_series` y, en cada cita, a qué serie pertenece y su número
(ver [data-model.md](./data-model.md)).

**Constitución:** el texto de esta función para el principio III, abajo. Se aplica en la 1.7.0, una
sola vez junto con las specs 010 y 012.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Node ejecuta `.ts` en el backend; el front y la beta usan React 19.

**Dependencias**: ninguna nueva. Las fechas se calculan con `lib/time.ts` y la disponibilidad con
`lib/availability.ts`, que ya existen.

**Almacenamiento**: la migración 038. Los emails usan la cola de hoy (`notifications`), sin columnas
nuevas.

**Variables nuevas**: ninguna.

**Pruebas**: la suite nueva y las que se actualizan de [quickstart.md](./quickstart.md), con `npm test`
y `npm run typecheck`. En el front y la beta, `npm run build` y `npm run lint`, más el recorrido con
Playwright en escritorio y a 390 px.

**Restricciones**:
- **CPU de Vercel:** dos peticiones por serie (revisar y crear), y crear 24 citas es una sola
  transacción de unos milisegundos. Los avisos por ntfy los manda el cron, como hoy.
- **Gmail:** una serie de 8 gasta 1 email por paciente más la copia, en vez de 16. Los dos tipos
  nuevos cuentan en el tope diario de la spec 009.

## Comprobación contra la constitución (1.6.0 → 1.7.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | La lista, los motivos, los emails, los avisos, la actividad y la documentación, en español. |
| II. Privacidad | Sí | El motivo «Ya hay una cita» no nombra al otro paciente. Al rol Profesional no se le muestra nada de otras agendas, y el cupo le llega topado (R4, R14). ntfy lleva al paciente a medias y el título sin el negocio. Nada nuevo en los logs. |
| III. Decisiones | Sí | Copia al profesional de cada email al paciente (R7, R10). Sesiones de hasta 3 pacientes: la serie repite a todos y cada uno recibe su email (spec 004/005). Cambios de estado de la spec 008: cada cita los sigue teniendo, y cancelar la serie respeta la casilla «Avisar al paciente», ofrece el WhatsApp y avisa por ntfy. ntfy a medias y sin el negocio en el título. Tope diario de emails de la spec 009: los tipos nuevos cuentan. |
| IV. Local | Sí | Todo se comprueba en local con la demo, en puertos propios. |
| V. Compartido | Sí | La función de la lista (`lib/appointment-series.ts`), los tipos, las validaciones y las dos plantillas nuevas se editan en el front y se copian con `sync:shared`. El archivo nuevo se copia a mano la primera vez, porque `sync:shared` sólo actualiza los que ya existen (R1). |
| VI. Barato | Sí | Sin servicios ni dependencias nuevas. Menos emails que hoy. ntfy, por el cron. |
| VII. Diseño | Sí | La lista usa los tokens del tema, marcas con texto (no sólo color), cada control con su etiqueta y una columna a 390 px. |
| Restricciones | Sí | La migración 038 la aplica el dueño antes del backend, como paso aparte. |

**Sin excepciones.**

**Texto que esta spec añade al principio III** (en la 1.7.0, con las de las specs 010 y 012):

> - Una cita del panel se puede repetir cada semana, cada 2 semanas o cada mes (el mismo día del mes;
>   si no existe, el último), de 2 a 24 citas. Antes de crearlas se ve la lista de fechas: las que
>   chocan con otra cita o pasan el cupo del plan no se crean a esa hora; las de un bloqueo, un día sin
>   atención o fuera del horario quedan marcadas y se pueden agendar igual. A cada una se le cambia la
>   hora o se quita. El paciente recibe un solo email con todas las fechas (con copia al profesional) y
>   ntfy avisa una vez por serie. Cada cita sigue siendo una cita normal y se cambia sola; desde su
>   ficha se cancelan ella y las siguientes con un solo email, con la casilla «Avisar al paciente». La
>   reserva online no crea series (2026-10-14).

Si el dueño no aprueba el cambio 1 de abajo, la frase de las marcadas pasa a ser: «las que chocan con
otra cita, un bloqueo, un día sin atención o el cupo del plan no se crean a esa hora».

## Cambios respecto a la spec

Hay que aprobarlos con el plan:

1. **Bloqueos, días sin atención y fuera del horario: «Agendar igual» (R3).** La spec dice dos cosas
   que chocan: que las marcadas no se crean (RF-004) y que «el panel no impide agendar fuera de
   horario donde hoy ya lo permite». Hoy una cita suelta en un bloqueo o fuera de horario se puede
   guardar igual.
   - **Propuesta:** esas fechas salen marcadas y desmarcadas (no se crean, como pide RF-004), y cada
     una tiene «Agendar igual».
   - **No cambia:** otra cita a la misma hora y el cupo del plan sí impiden, como hoy.
2. **«Cita 3 de 7» cuenta las que se crearon (R6).** Si de 8 se quitó una, la ficha dice «de 7» y los
   números van seguidos, sin huecos. La serie guarda también cuántas se pidieron, para la actividad y
   ntfy.
3. **Una serie es de citas por venir (R2):** la primera fecha desde hoy y el estado sólo Pendiente o
   Confirmada. Para crear hacen falta al menos 2 fechas en la lista; con una, se quita «Repetir».
4. **El aviso al profesional («Tienes una nueva cita») también es uno por serie (R8).** La spec sólo
   lo pide para el paciente y ntfy, pero ocho avisos al profesional serían el mismo spam.
5. **Cancelar la serie (R10, R11, R12):** además del email único, una sola entrada de actividad, un
   solo aviso de ntfy («serie de citas cancelada») y el WhatsApp ya escrito con todas las fechas, por
   la decisión de la spec 008.
6. **El email de la serie (R7):** los datos de pago por transferencia van una sola vez. Cada fecha
   enlaza a su página «Tu cita» de la spec 010 (o a su pago, si la 010 aún no estuviera).
7. **«Otra hora» ofrece las horas libres en la cuadrícula del negocio (R3):** la misma de la página
   de reservas (Configuración → Reservas), no cada 5 minutos. Para una hora que no esté en la lista,
   se crea la serie y después se mueve esa cita.
8. **Si al crear no se puede crear ninguna,** no se crea nada (ni la serie) y se vuelve a la lista
   (R5).

## Estructura

```text
specs/011-citas-que-se-repiten/   spec, plan, research, data-model, contracts/api.md, quickstart (tasks y reporte, después)

agenda-backend
  .specify/memory/constitution.md                1.7.0 (con las specs 010 y 012)
  db/migrations/038_appointment_series.sql       NUEVO (data-model)
  src/db/columns.ts                              appointmentColumns con `series`
  src/db/seed.ts                                 appointment_series en TABLES
  src/services/appointment-series-service.ts     NUEVO: preview, create, cancelFollowing (R1–R5, R10, R12)
  src/services/business-data-service.ts          exporta los ayudantes de crear una cita que reusa la serie
                                                 (findOwned, buildAppointmentFields, resolveAppointmentProfessional,
                                                 assertOffersService, saveAppointment, homeVisitJson); `series: null`
                                                 en la cita nueva; WHATSAPP_NOTICE_LABELS con series_cancelled
  src/services/notifications.ts                  notifySeriesCreated, notifySeriesCancelled, aviso al profesional de la serie (R7, R8, R10)
  src/services/email-limits.ts                   THIRD_PARTY_EMAIL_TYPES con los dos tipos nuevos
  src/services/booking-alerts.ts                 findPanelAppointments sin series; findPanelSeries, findSeriesCancellations
                                                 y sus avisos (R11)
  src/jobs/scheduled-tasks.ts, scripts/cron.ts   avisos de series en el informe; EMAIL_GROUPS, COPIED_TYPES y la línea del registro
  src/routes/business-routes.ts                  las tres rutas nuevas (contracts)
  src/shared/lib/appointment-series.ts           NUEVO: copia del front (la primera vez a mano, después con sync:shared)
  src/shared/**                                  sólo con npm run sync:shared
  README.md                                      «Citas que se repiten»
  tests/appointment-series.test.ts               NUEVO
  tests/booking-alert.test.ts, cron.test.mjs, email-templates.test.mjs,
  tests/whatsapp-notice.test.mjs, delete-business.test.mjs                 actualizados

agenda-front
  .specify/memory/constitution.md                1.7.0 (con las specs 010 y 012)
  src/lib/appointment-series.ts                  NUEVO: fechas, marcas, horas libres y cupo (compartido)
  src/types/index.ts                             Appointment.series, tipos de la serie, EmailType, WhatsAppNoticeKind
  src/lib/validations/appointment.ts             seriesRepeatSchema, appointmentSeriesPreviewSchema,
                                                 appointmentSeriesSchema, cancelFollowingSchema, series_cancelled
  src/lib/email/templates.ts                     appointmentSeries, appointmentSeriesCancelled; serie en professionalNewAppointment
  src/lib/data/repository.ts, api-repository.ts  previewSeries, createSeries, cancelFollowing
  src/hooks/queries/use-appointments.ts          usePreviewAppointmentSeries, useCreateAppointmentSeries,
                                                 useCancelFollowingAppointments
  src/features/appointments/appointment-form-dialog.tsx   «Repetir», «Revisar fechas» y el paso de la lista
  src/features/appointments/series-fields.tsx    NUEVO: cada cuánto y cuántas
  src/features/appointments/series-review.tsx    NUEVO: la lista de fechas
  src/features/appointments/appointment-details-sheet.tsx  «Cita 3 de 8» y «Cancelar ésta y las siguientes»
  src/features/appointments/whatsapp-notice.tsx, src/lib/whatsapp.ts   el aviso con las fechas canceladas
  src/features/settings/email-outbox.tsx         nombres de los dos tipos nuevos

agenda-beta: los archivos compartidos y los componentes del front; previewSeries, createSeries y cancelFollowing
  en mock/business-data-repository.ts; la serie en mock/store.ts; los dos emails en mock/notifications.ts
```

## Publicación

**El orden importa:** la migración va antes del código que la usa, y el backend antes que el front
(el front nuevo llama a rutas nuevas).

1. **Comprobar que la spec 010 ya está publicada,** o que se publica junta con ésta. Su migración 037
   va antes que la 038.
2. **Migración 038,** como paso aparte, antes del PR del backend. Si se publican juntas, el mismo paso
   aplica también la 037 de la spec 010 (y la 039 de la 012, si va con ellas):

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

3. **PR `dev` → `main` del backend.** Al publicarse, abrir:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

4. **PR `dev` → `main` del front.**
5. **Constitución 1.7.0** en los dos repos, con el texto de las specs 010, 011 y 012.
6. **Beta:** no se publica por este flujo; se comprueba en local (`npm run build`).

No hay variables nuevas en Vercel, Lambda ni GitHub.

## Riesgos

- **Cancelar la serie es en bloque y no se deshace en bloque.** Para recuperar una cita hay que
  reactivarla sola, y cada una manda su email «restablecida». Por eso pide confirmar y dice desde qué
  fecha.
- **El plan Free (20 citas al mes) se llena rápido** con series: la lista lo muestra antes de crear.
- **Una serie mensual llega a casi 2 años.** Si después cambia el horario del profesional o se pone
  un bloqueo, las citas ya creadas no se mueven solas, como hoy con las citas sueltas.
- **«Agendar igual»** permite crear citas en un bloqueo o fuera del horario, como hoy una cita suelta.
  Si el dueño prefiere que nunca se creen, es quitar esa casilla (ver la pregunta 1).
- **Archivos compartidos con la spec 010** (`columns.ts`, los tipos, las plantillas y
  `notifications.ts`): conviene implementar ésta con la 010 ya cerrada, para no pisarse (R16).
- **«Confirmaciones» apagado:** el paciente no recibe el email de la serie y sólo se entera por cada
  recordatorio, como hoy con las citas sueltas.

## Decisiones del dueño del producto (2026-10-14)

El dueño aprobó el plan con estas respuestas, que mandan sobre lo que digan las preguntas de abajo:
1. **«Agendar igual»:** sí, para las fechas en un bloqueo, un día sin atención o fuera del horario;
   desmarcada al empezar (cambio 1).
2. **Citas por defecto:** 8.
3. **Al cancelar la serie** se ofrece también el WhatsApp ya escrito con las fechas (cambio 5).

## Preguntas para el dueño

1. **¿Las fechas en un bloqueo, un día sin atención o fuera del horario se pueden «Agendar igual»?**
   Propuesta: sí, desmarcadas por defecto (cambio 1). Si no, se quedan siempre fuera.
2. **¿Cuántas citas por defecto?** Propuesta: 8, como el ejemplo del pedido.
3. **¿Al cancelar la serie se ofrece también el WhatsApp con las fechas?** Propuesta: sí, por la
   decisión de la spec 008 (cambio 5).
