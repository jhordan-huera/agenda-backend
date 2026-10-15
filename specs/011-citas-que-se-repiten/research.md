# Decisiones técnicas: Citas que se repiten

Cada decisión tiene tres partes: qué se eligió, por qué y qué otras opciones se descartaron. Los
números (R1…) se citan en el [plan](./plan.md).

## R1. La lista de fechas la calcula la API, con funciones compartidas

- **Decisión:** «Revisar fechas» llama a una ruta nueva de vista previa
  (`POST …/appointment-series/preview`, ver [contracts/api.md](./contracts/api.md)). No cambia nada:
  carga los datos de la agenda y devuelve cada fecha con su marca, su motivo y las horas libres de ese
  día. La clasificación es una función pura en un archivo compartido nuevo,
  `agenda-front/src/lib/appointment-series.ts` (copia en `agenda-backend/src/shared/lib/`):
  - `seriesDates(firstDate, frequency, count)`: las fechas (R2);
  - `classifySeriesDate(window, context)`: la marca de una fecha (R3), con lo que ya existe en
    `availability.ts` (`getWorkingRanges`, `isWithinWorkingHours`, `findOverlappingBlock`,
    `scopeToProfessional`);
  - `freeTimesOn(date, durationMinutes, context, step)`: las horas libres de un día (R3);
  - `applyPlanLimit(rows, remainingByMonth)`: las que pasan el cupo (R4).

  La misma función la usan la vista previa, la creación (R5) y el repositorio de prueba de la beta
  (R15). Así la lista y lo que se crea nunca discrepan.
- **Por qué en la API y no sólo en el navegador:**
  - el cupo del plan cuenta las citas de **todo el negocio** de cada mes, y el rol Profesional sólo
    recibe las de su agenda;
  - una serie mensual llega a casi 2 años: el formulario de hoy sólo carga las citas del día elegido
    (`useAppointments({ from: día, to: día })`) y cargar 2 años de agenda en el celular es pesado;
  - la API ya tiene todos los datos y la comprobación que vale (`assertNoConflict`).
- **Coste:** una petición más («Revisar fechas»), de sólo lectura: 5 consultas como mucho
  (profesional y servicio, horario, bloqueos del rango, citas ocupadas del rango, citas por mes para el
  cupo). Sin bloqueo del negocio.
- **`sync:shared` sólo actualiza archivos que ya existen** en `src/shared`: el archivo nuevo se copia
  una vez a mano a `agenda-backend/src/shared/lib/appointment-series.ts` y después se corre
  `npm run sync:shared`, que le pone la cabecera y las rutas de import.
- **Descartado:**
  - **Calcularla sólo en el front** con `getAvailableSlots`: no sabe el cupo de los meses que vienen
    ni, con el rol Profesional, el de todo el negocio.
  - **Crear con «a ver qué sale»** (sin lista previa): la decisión del dueño es ver la lista antes.

## R2. Las fechas de la serie

- **Cada semana:** la primera fecha y +7 días cada vez (`addDaysISO`).
- **Cada 2 semanas:** +14 días.
- **Cada mes:** el mismo día del mes que la primera fecha, contado siempre desde ella y no desde la
  anterior. Si ese mes no tiene ese día, el último del mes: 31 de enero → 28 (o 29) de febrero → 31 de
  marzo. Se calcula con `addMonthsISO` y `endOfMonthISO` de `lib/time.ts`.
- **Cuántas:** de 2 a 24, contando la primera (`SERIES_MIN = 2`, `SERIES_MAX = 24`). 8 por defecto,
  como el ejemplo del pedido.
- **Primera fecha:** desde hoy (en la zona del negocio). El email dice «Tus próximas citas» y una
  serie hacia atrás no tiene uso: una cita pasada se sigue registrando como hoy, suelta.
- **Estado:** sólo Pendiente o Confirmada. Con «Repetir», el selector de Estado del formulario ofrece
  sólo esos dos. Una serie «Completada» o «Cancelada» no tiene sentido.
- **Todo lo demás es igual en cada cita:** el paciente (y los otros pacientes de la sesión), el
  servicio, la duración, el precio, el profesional, la modalidad (con la dirección de la visita) y las
  notas.
- **La hora:** la del formulario en todas, salvo las que se cambien en la lista (R3).
- **La API no acepta fechas sueltas:** al crear, cada fecha que llega tiene que estar entre las que
  da `seriesDates` con la primera fecha, la frecuencia y el número pedidos. Sólo se puede cambiar la
  hora o quitar fechas, como dice la spec.

## R3. Qué se marca en la lista y qué se puede hacer con cada marca

La marca de cada fecha, en este orden (la primera que aplique):

| Marca | Motivo que se muestra | ¿Se crea? | Qué se puede hacer |
|---|---|---|---|
| `busy` | «Ya hay una cita de 10:00 a 11:00» | No | Cambiar la hora o quitarla. |
| `blocked` | «Bloqueado: Vacaciones» (el motivo del bloqueo) | No, salvo «Agendar igual» | Cambiar la hora, quitarla o agendarla igual. |
| `day_off` | «Ese día no atiende» | No, salvo «Agendar igual» | Quitarla o agendarla igual (no hay horas libres). |
| `outside_hours` | «Fuera del horario de atención» | No, salvo «Agendar igual» | Cambiar la hora, quitarla o agendarla igual. |
| `plan_limit` | «Supera el cupo del plan (20 citas al mes)» | No | Quitarla (R4). |
| `free` | — | Sí | Quitarla. |

- **«Agendar igual» (cambio respecto a la spec, ver el plan):** la spec dice que las marcadas no se
  crean (RF-004) y también que «el panel no impide agendar fuera de horario donde hoy ya lo permite».
  Hoy una cita suelta en un bloqueo o fuera de horario sólo muestra un aviso: «Puedes guardarla
  igualmente» (`appointment-form-dialog.tsx`). Por eso esas tres marcas salen **desmarcadas** (no se
  crean, como pide RF-004) y cada una tiene la casilla «Agendar igual». Otra cita a la misma hora sí
  impide, como hoy (`assertNoConflict`, y la restricción `appointments_no_overlap` de la 001).
- **Horas libres** (`freeTimes`, para «Cambiar la hora»): las de ese día en que la cita entera cabe
  en el horario del profesional, sin otra cita ni bloqueo. Van en la cuadrícula del negocio
  (`getSlotStep` con `bookingSettings`, la misma que la página de reservas: por defecto, cada
  duración del servicio). No se aplican la antelación mínima ni la máxima de la reserva online: son
  reglas de la página pública, no del panel (`getMinNoticeHours` lo dice en `availability.ts`).
- **El motivo de `busy` no nombra al paciente** de la otra cita: sólo la franja. Al rol Profesional
  no se le muestra nada de otras agendas.
- **Lo que choca es lo de la agenda de ese profesional:** sus citas activas
  (`pending`, `confirmed`, `completed`), su horario y los bloqueos suyos o de todo el negocio
  (`scopeToProfessional`), como `assertNoConflict` y el formulario de hoy.

## R4. El cupo del plan en la lista

- **La vista previa devuelve, por mes, cuántas citas quedan** (`planRemaining`, `null` si el plan no
  tiene tope): el tope del plan menos las citas no canceladas de ese mes, como `assertAppointmentLimit`
  en `plan-limits.ts`.
- **La lista lo recalcula al momento** con `applyPlanLimit`: recorre en orden las fechas que se van a
  crear y, en cada mes, marca `plan_limit` las que pasan lo que queda. Si se quita una fecha o se
  agenda igual otra, las marcas se mueven sin volver a llamar a la API.
- **Privacidad:** el número que llega va topado en 24 (`min(quedan, 24)`). Con eso basta para la lista
  y el rol Profesional no se entera de cuántas citas tiene el negocio ese mes.
- **Al crear, la API vuelve a contar** dentro de la transacción (R5).

## R5. Crear la serie: una transacción, con el negocio bloqueado

- **Ruta:** `POST /businesses/:id/appointment-series`. Llegan los datos de la cita, la frecuencia, el
  número pedido y la lista final de fechas: cada una con su hora y, si se aceptó, «Agendar igual».
- **En una sola transacción:**
  1. `authorize(…, "appointments.manage", { lock: true })`: bloquea la fila del negocio (`for no key
     update`). Las citas del panel, las reservas online (`lockBusiness`) y las otras series del
     negocio esperan su turno.
  2. Lo mismo que `appointmentService.create`, una vez para toda la serie: `buildAppointmentFields`,
     `assertClientInScope`, `resolveExtraClients`, `resolveAppointmentProfessional` y
     `assertOffersService`.
  3. Con el negocio ya bloqueado, carga la agenda del rango y el cupo por mes y vuelve a clasificar
     cada fecha con la función de R1. Lo que antes era libre y ahora choca (otra persona agendó a
     esa hora mientras se revisaba la lista) **no se crea** y vuelve en `skipped` con su motivo:
     «Se ocupó mientras revisabas la lista». Es RF-005.
  4. Crea la fila de `appointment_series` y cada cita con `series_id` y `series_index`, numeradas
     1, 2, 3… sin huecos, en orden de fecha, sólo las que se crean. Los otros pacientes, con
     `saveExtraClients`.
  5. Un solo email por paciente (R7), un solo aviso al profesional (R8) y una sola entrada de
     actividad (R12).
- **Exacto también con dos series a la vez:** el bloqueo del negocio pone una detrás de otra, y la
  segunda ve las citas de la primera. `appointments_no_overlap` sigue como red de seguridad: si
  alguna vez saltara, se deshace la serie entera (nunca queda una serie a medias) y el panel muestra
  el 409 de siempre para que se revise la lista de nuevo.
- **Si no se puede crear ninguna:** no se crea nada, ni la serie. Responde 409 (o 402 si todas
  pasan el cupo) y el panel vuelve a pedir la lista.
- **Mínimo 2 fechas en la lista para crear.** Con una sola, «Crear» queda desactivado con la pista
  «Para una sola cita, quita “Repetir”». Si al crear la API tuviera que saltar fechas y quedara una,
  se crea igual: la ficha no muestra «Cita 1 de 1» (R13).
- **Coste:** 5 consultas para cargar y comprobar, más un `insert` por cita y por cada otro paciente.
  Con 24 citas, unos milisegundos con el negocio bloqueado.
- **Descartado:**
  - **Llamar 8 veces a `POST /appointments`:** saldrían 8 emails, 8 avisos y 8 entradas de
    actividad, y una serie podría quedar a medias si falla la red.
  - **Un `savepoint` por cita** para saltar las que choquen en la base: con el bloqueo del negocio la
    comprobación previa ya es exacta, y el `savepoint` sólo añade viajes a la base.

## R6. Cómo se guarda: una tabla de series y dos columnas en la cita

- **Tabla `appointment_series`** (ver [data-model.md](./data-model.md)): el negocio, cada cuánto
  (`weekly`, `biweekly`, `monthly`), cuántas se pidieron, cuántas se crearon, quién la creó y cuándo.
- **En `appointments`:** `series_id` (a qué serie pertenece) y `series_index` (su número).
- **El tipo `Appointment` gana `series`:** `{ id, index, total, frequency }` o `null`. Sale en
  `appointmentColumns()` (`src/db/columns.ts`) con una subconsulta por clave primaria, como
  `extraClientIdsSql`. `total` es «cuántas se crearon»: la ficha dice «Cita 3 de 7».
- **Editar una cita de la serie no toca su serie:** `saveAppointment` no cambia esas columnas. Mover
  una cita en la agenda, cambiarle la hora o el estado cambia sólo esa (H3, escenario 3).
- **Borrados:**
  - borrar un paciente borra sus citas en cascada, como hoy; la serie queda sin citas, sin efecto;
  - borrar un negocio (`admin-service.ts`) borra antes las citas y después el negocio, que borra
    sus series en cascada. Por eso `series_id` no lleva `on delete`: la app nunca borra una serie
    sola.
- **Descartado:**
  - **Guardar sólo un identificador de grupo en la cita, sin tabla:** no habría dónde guardar cada
    cuánto, cuántas eran ni quién la creó, que usan la ficha, la actividad y ntfy.
  - **Una regla de repetición (estilo calendario) que genere las citas al vuelo:** cada cita tiene
    que ser una cita normal desde el primer día (recordatorios, pago, estados, reportes, cupo). Es
    mucho más complejo y la spec deja fuera editar la serie entera.

## R7. Un solo email al paciente con todas las fechas

- **Tipo nuevo `appointment_series`** y plantilla compartida `emailTemplates.appointmentSeries`
  (`src/lib/email/templates.ts`):
  - **Asunto:** «Tus próximas 8 citas en {negocio}».
  - **Texto:** «Tus 8 citas de {servicio} con {profesional} están confirmadas.» o, si son
    pendientes, «…quedaron agendadas y pendientes de confirmar. Te avisaremos cuando estén
    confirmadas.»
  - **Las fechas:** un bloque de detalles con una fila por cita: «Cita 1 · Martes 20 de octubre,
    10:00–11:00», con la zona en las virtuales (`zoneSuffix`).
  - **Una vez:** el servicio, el profesional, el precio de cada cita (si se muestra), el lugar (en el
    local con «Cómo llegar», virtual con el enlace, o a domicilio con la dirección) y la política de
    cancelación.
  - **Pago por transferencia:** las cuentas una sola vez y «Transfiere {monto} por cada cita y sube
    el comprobante desde el enlace de cada fecha». Cada fila de fecha enlaza a la página privada de
    esa cita: la de la spec 010 («Tu cita», que lleva también al pago) o, si la 010 aún no estuviera,
    la de pago (`paymentUrl(token)`) cuando hay algo que pagar.
- **Quién lo recibe:** `notifySeriesCreated` en `src/services/notifications.ts`, que reusa
  `loadAppointmentContext` y `buildEmailData` con la primera cita creada:
  - **cada paciente de la sesión** (spec 004/005), con su nombre; un solo email por dirección, como
    `notifyAppointmentChange`. Los datos de pago, sólo al principal;
  - **la copia al profesional** (`appointment_copy`), una sola vez, con los nombres de todos, la nota
    «Copia para ti…» y «Ver en la agenda» (`asProfessionalCopy`). En la copia las filas de fecha no
    llevan enlace: son del paciente (RF-006 de la spec 010).
- **Sólo si «Confirmaciones» está encendido** (`notificationSettings.confirmations`), como el email de
  una cita nueva (`clientMessageFor`). Si está apagado, no sale ni el email ni su copia.
- **`appointment_id` del email:** el de la primera cita creada. Así la bandeja (Actividad → Emails) y
  ntfy (R11) lo encuentran, y no hace falta columna nueva en `notifications`.
- **Tope diario de emails (spec 009):** `appointment_series` entra en `THIRD_PARTY_EMAIL_TYPES`
  (`email-limits.ts`). Cuenta como **un** email por paciente, no ocho. No es «del público»: la cita es
  del panel. Si el tope lo frena, no sale la copia, como hoy.
- **No se llama a `notifyAppointmentChange` por cada cita.** Ése es el cambio que evita los 8 emails.
- **Descartado:** un email por cita «agrupado» al enviarlo (en `mailer.ts`): complica la cola y los
  reintentos, y el historial mostraría emails que nunca salieron.

## R8. El aviso al profesional, una vez por serie

- **Hoy** (`notifyProfessional`): el profesional recibe «Tienes una nueva cita» si tiene los avisos
  activados, si no la agendó él y si a ese email no le llegó ya la copia.
- **Con la serie:** las mismas reglas, un solo email `professional_new_appointment`. La plantilla
  `professionalNewAppointment` gana un campo opcional `series` (las fechas): el asunto pasa a ser
  «Nueva serie: {paciente} · 8 citas desde el {fecha}» y lleva la lista.
- **Por qué:** con la copia casi nunca sale (suele ser el mismo email), pero cuando el paciente no
  tiene email o «Confirmaciones» está apagado, ocho avisos al profesional serían el mismo spam.

## R9. Cada cita sigue siendo una cita normal

- **Recordatorios:** `runReminderJob` no cambia. Cada cita tiene su `scheduled_at` (la hora de
  creación, por defecto en la 027) y su recordatorio sale el día que toca, con su copia. Como hoy, si
  la primera cita empieza dentro de las horas del recordatorio y el negocio envía confirmaciones, ese
  recordatorio no sale: el paciente acaba de recibir el email de la serie.
- **Estados y avisos de la spec 008:** confirmar, cancelar o marcar «Atendida» una cita de la serie
  pasa por `updateStatus` como cualquier otra, con su email, su copia, la casilla «Avisar al
  paciente», el WhatsApp y su aviso de ntfy.
- **Pago:** cada cita tiene su `payment_token` (por defecto en la 025), su comprobante y su «pagada».
- **Cupo, reportes, Inicio, ficha del paciente:** cuentan cada cita, como hoy.
- **Spec 010 («Confirmo que voy», cancelar desde el email):** vale para cada cita de la serie por
  separado.

## R10. «Cancelar ésta y las siguientes»

- **Ruta:** `POST /businesses/:id/appointments/:appointmentId/cancel-following` con `{ notify }`
  (`appointmentSeriesService.cancelFollowing`).
- **Qué cancela:** las citas de la misma serie con `series_index` igual o mayor que la de la ficha y
  estado Pendiente o Confirmada. Las atendidas, las de «No asistió» y las ya canceladas no se tocan.
  Va por el número («Cita 3 de 8» y las siguientes), no por la fecha: así no importa que alguna se
  haya movido de día.
- **Rol Profesional:** sólo las de su agenda (`assertAppointmentInScope`). Si alguna de las
  siguientes se pasó a otro profesional, no la cancela.
- **En una transacción, con el negocio bloqueado:** cada una pasa a Cancelada con `saveAppointment`,
  como `updateStatus`. Si ya no queda ninguna activa, responde 409 «No quedan citas activas de la
  serie desde ésta».
- **Un solo email** (`notifySeriesCancelled`), tipo nuevo `appointment_series_cancelled`, plantilla
  `appointmentSeriesCancelled`:
  - **Asunto:** «Se cancelaron 6 citas en {negocio}». La lista de fechas canceladas y «Reservar una
    nueva cita», como `appointmentCancelled`;
  - **a cada paciente con las fechas en que está** (se agrupan por dirección de email) y **una copia
    por profesional** con las de su agenda;
  - **sólo si «Cancelaciones» está encendido** (`notificationSettings.cancellations`), como una
    cancelación suelta;
  - **con `notify: false`** (casilla «Avisar al paciente» desmarcada, spec 008) no sale ningún email
    ni copia, y la actividad termina en «(sin avisar al paciente)» (`WITHOUT_NOTICE`).
- **WhatsApp ya escrito (spec 008):** si se avisa, el panel ofrece el WhatsApp con todas las fechas:
  «Hola Ana, tus citas de Terapia con {negocio} del martes 20 de octubre, martes 27 de octubre… quedaron
  canceladas. Si quieres agendar otras, puedes hacerlo aquí: {enlace}». Es un tipo nuevo de aviso,
  `series_cancelled`, en `whatsAppNoticeSchema`, `buildAppointmentNotice` (`src/lib/whatsapp.ts`) y
  `WHATSAPP_NOTICE_LABELS`.
- **Descartado:** cancelar por la fecha («desde el 20 de octubre»): una cita movida a antes quedaría
  fuera sin que se note.

## R11. ntfy: un aviso por serie

- **`findPanelAppointments`** (`booking-alerts.ts`) deja fuera las citas con `series_id`: hoy daría un
  aviso por cita.
- **Nuevo `findPanelSeries` + `panelSeriesNotice`:** las series creadas en la ventana (desde, hasta]
  de cada pasada, por `appointment_series.created_at`.
  - **Título:** «Agenda360: nueva serie de citas», sin el negocio (principio II, spec 009).
  - **Mensaje:**
    - `{negocio} · serie de 8 citas desde el panel`;
    - `Cada semana · mar 20 oct 10:00 → mar 8 dic 10:00`;
    - cada paciente a medias (`maskedPatient`: «Juan P. · ju***@gmail.com · ***5555»);
    - servicio, duración y precio de cada cita; profesional y lugar; estado;
    - si se pidieron más de las que se crearon: «1 fecha no se creó»;
    - `Agendada desde el panel por Ana T. (Recepción)` (de `appointment_series.created_by`);
    - los emails: el de la serie, la copia y el aviso al profesional, con su estado. Son los de la
      primera cita creados en la misma transacción (`n.created_at = s.created_at`).
  - Como mucho 10 por pasada (`MAX_SERIES_NOTICES`), más la cifra del resto.
- **Nuevo `findSeriesCancellations` + `seriesCancelledNotice`:** el dueño recibe por ntfy cada cambio
  de estado (spec 008). Para «ésta y las siguientes» es un solo aviso, de la entrada de actividad
  `appointment.series_cancelled`:
  - **Título:** «Agenda360: serie de citas cancelada».
  - **Mensaje:** `{negocio} · 6 citas canceladas desde mar 20 oct 10:00`, el paciente a medias, el
    servicio, `Cancelada desde el panel por …` y los emails, o «Sin avisar al paciente (se desmarcó
    la casilla)».
- **`findStatusChanges` no cambia.** La entrada de la serie tiene como `entity_id` el id de la serie,
  que no es una cita, así que no sale repetida.
- **El cron** (`scheduled-tasks.ts` y `scripts/cron.ts`): el informe gana `panelSeries`,
  `seriesNotices`, `seriesCancellations` y `seriesCancelNotices`. La línea del registro suma «series
  del panel: N · series canceladas: N».

## R12. La actividad: una entrada por serie

- **Al crear:** `appointment.series_created`, tipo de entidad `appointment` (así sale con el filtro
  «Citas»), `entity_id` = el id de la serie.
  - **Resumen:** «Agendó una serie de 8 citas de María López, cada semana desde el 20/10/2026 10:00».
    Si se crearon menos de las pedidas: «…(1 no se creó)».
  - **Cambios:** una fila «Fechas» con las fechas y horas creadas, para verlas sin abrir cada cita.
- **Al cancelar:** `appointment.series_cancelled`, también con el id de la serie:
  - «Canceló 6 citas de la serie de María López desde el 20/10/2026 10:00», más «(sin avisar al
    paciente)» si se desmarcó la casilla;
  - una fila «Citas canceladas» con las fechas.
- **No se escribe una `appointment.created` por cada cita.** Es lo que pide RF-010.

## R13. Front: el formulario, la lista y la ficha

- **«Repetir»** (`appointment-form-dialog.tsx`), sólo en «Nueva cita», no al editar. Un interruptor
  (`Switch`, que ya existe en `components/ui`) bajo la fecha y la hora. Al encenderlo
  (`series-fields.tsx`, nuevo):
  - «Cada cuánto»: Cada semana / Cada 2 semanas / Cada mes;
  - «Cuántas citas», de 2 a 24, con la pista «Contando la primera»;
  - el Estado sólo ofrece Pendiente y Confirmada;
  - el botón pasa a ser «Revisar fechas»; el choque de la primera fecha ya no bloquea, porque lo
    marca la lista.
- **La lista** (`series-review.tsx`, nuevo) reemplaza al formulario en el mismo diálogo, sin abrir
  otro encima:
  - arriba, «8 fechas · cada semana · 10:00–11:00»;
  - una fila por fecha: el día y la hora, y la marca con su texto (no sólo color) y los tokens del
    tema;
  - en las marcadas, «Otra hora» (un `Select` con las horas libres, con la etiqueta «Otra hora para
    el martes 27 de octubre»), «Agendar igual» (R3) y «Quitar»; en las libres, sólo «Quitar»;
  - abajo, «Volver» (al formulario, con todo como estaba) y «Crear 7 citas», con el número al día.
- **Al crear:** el aviso «Se crearon 7 citas» y, si alguna no, cuáles: las quitadas y las que la API
  saltó (`skipped`), con su motivo. Se recarga la agenda y la actividad, como al guardar una cita.
- **Hooks y repositorio:** `usePreviewAppointmentSeries`, `useCreateAppointmentSeries` y
  `useCancelFollowingAppointments` en `use-appointments.ts`; `previewSeries`, `createSeries` y
  `cancelFollowing` en `repository.ts` y `api-repository.ts`.
- **La ficha** (`appointment-details-sheet.tsx`):
  - una fila «Cita 3 de 8 · cada semana» (icono `Repeat`) si `series.total >= 2`;
  - el botón «Cancelar ésta y las siguientes», junto a «Cancelar cita», en las citas activas de una
    serie que no son la última. Pide confirmar: «¿Cancelar esta cita y las siguientes de la serie?
    Se cancelarán las que sigan activas desde el martes 20 de octubre (cita 3 de 8 en adelante).»
    Respeta la casilla «Avisar al paciente» de la ficha;
  - al terminar, «Se cancelaron 6 citas» y, si se avisó, el WhatsApp con las fechas (R10).
- **A 390 px:** la lista va en una columna, con los controles de cada fila debajo de la fecha, sin
  desplazamiento horizontal.
- **Bandeja de emails** (`email-outbox.tsx`): los dos tipos nuevos con su nombre: «Serie de citas» y
  «Serie cancelada».

## R14. Rol Profesional y privacidad

- **El rol Profesional crea series sólo en su agenda:** `resolveAppointmentProfessional` le fija la
  suya y rechaza otra. Con «sólo sus pacientes», `assertClientInScope` vale para el principal y para
  cada otro paciente, como al crear una cita.
- **La lista no le muestra nada de otras agendas:** el motivo de `busy` sólo dice la franja y el cupo
  llega topado en 24 (R4).
- **ntfy:** los pacientes a medias y el título sin el negocio, como los avisos de hoy.
- **Logs:** nada nuevo se imprime con datos de pacientes.

## R15. Beta

- **Lo mismo con sus datos de prueba (RF-011):**
  - los archivos compartidos (tipos, `lib/appointment-series.ts`, validaciones y plantillas) copiados
    del front;
  - el formulario, la lista y la ficha, igual que en el front;
  - el repositorio de prueba: `previewSeries`, `createSeries` y `cancelFollowing` en
    `mock/business-data-repository.ts`, con las mismas funciones compartidas y el cupo de
    `mock/plan-limits.ts`;
  - los emails simulados (`mock/notifications.ts`): el de la serie y el de la cancelación en la
    bandeja.
- **Guarda la serie en cada cita** (`series` en `StoredAppointment`, `mock/store.ts`), sin tabla
  aparte: en la beta no hay concurrencia ni ntfy.
- **No lleva copia al profesional:** la beta hoy no la simula.

## R16. Orden con las specs 010 y 012

- **Se implementa después de la 010 y antes de la 012**, en `dev`, como dice la numeración de las
  migraciones (037, 038, 039).
- **Archivos que tocan también la 010:** `src/db/columns.ts` (`appointmentColumns`),
  `src/types/index.ts` (`Appointment`, `EmailType`), `templates.ts` y `notifications.ts`. Por eso
  conviene empezar ésta con la 010 ya cerrada.
- **El enlace de cada fecha del email (R7)** usa la página «Tu cita» de la 010. Si por algún motivo la
  011 fuera antes, las fechas enlazan al pago y la 010 añade su enlace después.
- **`npm run db:migrate`** aplica las migraciones pendientes en orden: si las tres specs se publican
  juntas, un solo paso aplica 037, 038 y 039.
