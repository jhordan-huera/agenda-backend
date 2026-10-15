# Decisiones técnicas: El paciente confirma o cancela su cita desde el email

Cada decisión tiene tres partes: qué se eligió, por qué y qué otras opciones se descartaron. Los
números (R1…) se citan en el [plan](./plan.md).

## R1. El enlace: el mismo del pago para el principal, uno propio para cada otra persona

- **Decisión:**
  - **Paciente principal** (`appointments.client_id`): su enlace a «Tu cita» usa el mismo token del
    pago, `appointments.payment_token` (migración 025, 32 caracteres hex de `gen_random_uuid()`).
  - **Cada otra persona de la sesión** (`appointment_clients`): una columna nueva,
    `appointment_clients.access_token`, con el mismo formato y un índice único (migración 037).
  - **Página nueva:** `/cita/:token` en el front (`src/pages/appointment-page.tsx`). La página de
    pago `/pago/:token` (`src/pages/payment-page.tsx`) no cambia, salvo un enlace «Ver o cancelar mi
    cita» de vuelta a `/cita/:token`.
  - **De «Tu cita» al pago:** si la cita tiene un pago por transferencia pendiente y quien abre es
    el principal, la página lleva el botón «Pagar la cita», que abre `/pago/:token` con el mismo
    token.
  - **La API busca el token en las dos tablas:** primero en `appointments.payment_token` y después en
    `appointment_clients.access_token` (`findByLinkToken`, en el servicio nuevo
    `src/services/appointment-page-service.ts`). El formato se comprueba antes, como hace
    `findByToken` en `payment-service.ts` (`/^[0-9a-f]{32}$/`).
- **Por qué:**
  - la spec lo permite (RF-001: «Puede ser el mismo enlace del pago»), y el principal no recibe dos
    enlaces distintos para la misma cita;
  - la constitución dice que sólo el principal recibe los datos de pago. Con un token propio, las
    otras personas abren «Tu cita», pero su enlace no sirve en `/pago` (`findByToken` sólo busca en
    `payment_token`);
  - cada persona tiene que poder confirmar por separado (RF-010), así que necesita su propio enlace;
  - la página de pago ya funciona y está probada (`tests/payments.test.ts`). Separarla evita tocar la
    subida de comprobantes, y «Tu cita» queda corta en el celular.
- **Descartado:**
  - **Unir las dos páginas en `/pago`:** el nombre confunde («pago» para cancelar), y las otras
    personas no pueden abrir `/pago`.
  - **Un token nuevo en `appointments`:** el principal tendría dos enlaces privados para la misma
    cita, sin ganar nada.
  - **Un token calculado con una clave del servidor (HMAC):** cambiar la clave rompería todos los
    enlaces enviados, y la constitución pide no sumar secretos sin necesidad.
  - **Una tabla aparte de enlaces:** más código para lo mismo que dan las dos columnas.

## R2. Cuándo deja de valer un enlace

- **Decisión:** la API responde `404 not_found`, con el mismo mensaje que a un enlace que no existe,
  en estos casos:
  - el token no existe o no tiene el formato;
  - el negocio no está activo (suspendido);
  - **caducó:** pasaron más de 30 días desde la cita (`APPOINTMENT_PAGE_DAYS = 30`, en
    `src/lib/constants/business.ts`, compartido);
  - la persona ya no está en la cita: su fila de `appointment_clients` se borró
    (`saveExtraClients`) y con ella su token;
  - el principal cambió (ver abajo).
- **Cambiar el paciente principal desde el panel:** `saveAppointment` (en
  `business-data-service.ts`) le da a la cita un `payment_token` nuevo y borra
  `client_confirmed_at` cuando cambia `client_id`:

  ```sql
  payment_token = case when client_id is distinct from $2 then replace(gen_random_uuid()::text, '-', '') else payment_token end,
  client_confirmed_at = case when client_id is distinct from $2 then null else client_confirmed_at end,
  ```

  En el `set` de un `update`, `client_id` es el valor anterior. Así, quien deja de ser el paciente no
  puede cancelar la cita de otro con su enlace viejo.
- **Unir a la ficha (spec 009, `confirmClaim`) no cambia el enlace:** es la misma persona.
  - El principal se mueve con `update appointments set client_id = …`, que no pasa por
    `saveAppointment`.
  - Las otras personas se borran y se vuelven a insertar en `appointment_clients`. `confirmClaim`
    tiene que conservar su `access_token` y su `confirmed_at` (`returning` de los dos y copiarlos en
    el `insert`). Si no, el enlace de los emails ya enviados dejaría de funcionar.
- **Por qué:**
  - la spec pide responder igual a un enlace que no existe que a uno caducado (RF-011);
  - 30 días dejan ver la cita pasada («Esta cita ya pasó») y limitan cuánto tiempo sirve un enlace
    reenviado;
  - los mismos 404 que ya usa la página de pago para un negocio suspendido.
- **Descartado:**
  - **Enlaces que no caducan, como el del pago:** un enlace filtrado mostraría la cita para siempre.
  - **Rotar el token con un trigger cuando cambia `client_id`:** rompería el enlace al unir a la
    ficha.

## R3. Lo que muestra la página y lo que no

- **Muestra** (RF-002):
  - el servicio, la fecha, la hora (con la zona en las virtuales, como `TimezoneNote`) y el
    profesional;
  - la modalidad:
    - **en el local:** con la dirección del negocio y «Cómo llegar» (`getDirectionsUrl`);
    - **virtual:** «Virtual (videollamada): el enlace te llega por email»;
    - **a domicilio:** «A domicilio», sin la dirección;
  - el estado para el paciente: «Confirmada por {negocio}» o «Pendiente: {negocio} aún debe
    confirmarla»;
  - el negocio (nombre, logo, colores) y su contacto: WhatsApp y teléfono.
- **No muestra:**
  - el nombre del paciente ni el de las otras personas de la sesión;
  - la dirección de la visita a domicilio y el enlace de la videollamada, que son datos del paciente
    o del profesional y siguen llegando por email;
  - el precio: lo muestra la página de pago;
  - nada de la historia clínica.
- **Cálculos del servidor:** la API calcula qué puede hacer quien abre el enlace y el front sólo lo
  muestra: `canConfirm`, `cancellation.status` y `payment` (ver
  [contracts/api.md](./contracts/api.md)). La API lo vuelve a comprobar al confirmar o cancelar.
- **Por qué:** un enlace reenviado o filtrado no debe enseñar nada del paciente (casos límite de la
  spec y principio II).
- **Descartado:** saludar por el nombre («Hola María L.»), como la página de pago. La spec dice que
  sólo se muestren la fecha, la hora, el servicio, el profesional y el negocio.

## R4. «Confirmo que voy»

- **Datos:**
  - `appointments.client_confirmed_at`: la confirmación del principal;
  - `appointment_clients.confirmed_at`: la de cada otra persona (migración 037).

  Las dos van vacías si no confirmó. El estado de la cita no cambia (decisión 1 de la spec).
- **Ruta:** `POST /api/public/appointments/:token/confirm`, en una transacción:
  1. busca la cita por el token y la bloquea (`for update`);
  2. comprueba que siga activa (`pending` o `confirmed`) y que aún no empiece, en la hora del
     negocio (`minutesUntilStart` de `reminder-rules.ts`). Si no, responde 409;
  3. guarda con
     `update … set confirmed_at = now() where … and confirmed_at is null returning confirmed_at`.
     Si no actualiza nada, ya estaba confirmada: responde `already: true`, sin otra actividad
     (escenario 1.4);
  4. la primera vez, registra `appointment.client_confirmed` (actor null, ver R6).
- **Sin aviso por ntfy ni email al negocio** (supuestos de la spec). Lo ve en la agenda (R10).
- **El botón del email:** el recordatorio lleva «Confirmo que voy», con `/cita/:token?confirmar=1`.
  - **Al abrirse,** la página manda la confirmación con `POST` desde JavaScript y después quita
    `?confirmar=1` de la dirección (`history.replaceState`). Así, recargar no la repite, aunque
    repetirla tampoco cambiaría nada.
  - **Un solo toque para el paciente:** pulsa en el email y ve «¡Gracias! Te esperamos el martes 20
    de octubre a las 10:00».
  - **La página también tiene el botón «Confirmo que voy»** mientras no haya confirmado. Así se puede
    confirmar desde cualquier email de la cita, no sólo desde el recordatorio.
- **Antivirus del correo que abren los enlaces solos:** casi todos sólo descargan la página, y eso no
  confirma nada:
  - la confirmación es un `POST` hecho con JavaScript;
  - la API exige la cabecera `X-Requested-With` (`requireAjaxHeader`, en `app.ts`), que un enlace o
    un formulario de otro sitio no pueden mandar.

  Sólo un antivirus que ejecute la página entera podría marcarla. Se acepta como riesgo: la
  consecuencia es una marca, no un cambio de estado.
- **Descartado:**
  - **Confirmar con un `GET` desde el email:** cualquier antivirus que revise el enlace confirmaría.
  - **Pedir un segundo toque en la página:** la spec pide que, al pulsar en el email, la cita ya
    quede marcada.

## R5. La confirmación se borra si cambia la cita

- **Decisión:** un trigger de la migración 037 en `appointments` borra la confirmación del principal y
  la de las otras personas cuando:
  - cambian la fecha, la hora de inicio o el profesional (RF-008);
  - la cita pasa a Cancelada, sea quien sea quien la cancela. Así, si el negocio la reactiva, el
    paciente puede volver a confirmar (caso límite de la spec 008).

  Va en dos partes:
  - **`before update of date, start_time, professional_id, status`:** pone
    `new.client_confirmed_at := null`;
  - **`after update` con las mismas columnas:** borra `appointment_clients.confirmed_at` de esa cita.
    Va después para no bloquear la fila de la cita mientras se actualiza, por el control de la 032.
- **Cambiar el paciente principal** borra su confirmación en `saveAppointment` (R2), no en el
  trigger: unir a la ficha la conserva.
- **No la borran:**
  - **Atendida y No asistió:** queda el dato «confirmó y no vino».
  - **Cambiar el servicio, la modalidad, el precio o las notas:** la spec sólo pide la fecha, la hora
    y el profesional.
- **El control de la 032** (`appointment_clients_check`) también corre al actualizar
  `confirmed_at`. Las filas que ya existen lo pasan, así que no hace falta cambiarlo.
- **Por qué un trigger:** la regla vale para cualquier camino que mueva una cita, también los de
  specs futuras (la 011 crea series), sin tener que acordarse en cada uno. La migración 032 ya hace lo
  mismo con `appointments_main_client_leaves_extras`.
- **Descartado:** borrarla sólo en `saveAppointment`, como `scheduled_at`. Funciona hoy, pero un
  camino nuevo podría olvidarlo, y quedaría una confirmación de otra hora.

## R6. Cancelar desde «Tu cita»

- **Cuándo se puede:** la regla vive en una función compartida,
  `canCancelOnline(bookingSettings, minutesUntilStart)`, en `src/lib/constants/business.ts`, junto a
  `isFollowUpDate`. La usan la API, los emails y la beta. Hacen falta las cuatro condiciones:
  - quien abre es el paciente principal (RF-010);
  - la cita sigue activa (`pending` o `confirmed`);
  - el negocio tiene «Permitir cancelaciones» (`bookingSettings.allowCancellations`);
  - falta más que `cancellationNoticeHours` para el inicio, en la hora del negocio. Es «más que»: con
    24 h, a las 24 h justas ya no.
- **Ruta:** `POST /api/public/appointments/:token/cancel`, en una transacción:
  1. busca y bloquea la cita (`for update`) y vuelve a comprobar la regla. Fuera de plazo responde 409
     con el mensaje de la página, por si se abrió antes del plazo;
  2. si ya estaba cancelada, responde `already: true` sin repetir nada (doble toque);
  3. llama a una función nueva, exportada de `business-data-service.ts`:
     `cancelFromPatientLink(db, before)`. Usa el mismo camino que `updateStatus`:
     - `saveAppointment(db, { ...before, status: "cancelled" }, false)`;
     - `notifyAppointmentChange(db, before, after, "patient_link", null)`: el email de cancelación
       de siempre a cada persona, con copia al profesional (spec 008);
     - `logAudit` con:
       - la acción `appointment.client_cancelled`;
       - `actor: null` y `actorName: "Paciente (desde su email)"`;
       - el resumen «Cancelada por el paciente desde su email: María López (20/10/2026 10:00)»;
       - `changes` con «Estado: Confirmada → Cancelada», hecho con `diffChanges` de
         `appointmentForAudit` y `APPOINTMENT_FIELDS`, como los demás cambios de estado. El aviso de
         ntfy (R8) se basa en eso.
- **La hora queda libre:** las horas ocupadas sólo cuentan citas `pending`, `confirmed` y `completed`
  (`public-booking-service.ts`). La página pública la guarda la CDN unos 30 s, más 60 s mientras se
  renueva, así que la hora libre puede tardar hasta un minuto y medio en verse.
- **Las otras personas:** no ven el botón y reciben `cancellation.status = "not_main"`. La página dice
  «Para no asistir, escríbele a {negocio}».
- **Origen nuevo `"patient_link"`** en `notifyAppointmentChange`: así no se aplica el tope de emails a
  pacientes nuevos, que es sólo para `"booking_page"` (`newPatientEmailHold`).
- **Sin `releaseClientAccess`:** el acceso del rol Profesional a la ficha sólo lo libera el equipo del
  negocio, nunca el paciente.
- **Por qué:** se reutiliza el cambio de estado que ya existe. Así la cancelación del paciente avisa,
  registra y libera la hora exactamente como una del panel.
- **Descartado:** un `update` aparte en el servicio público. Habría que repetir los emails, la
  auditoría y el formato que lee ntfy, y podrían separarse con el tiempo.

## R7. Los emails

- **Dato nuevo en la plantilla:** `AppointmentEmailData.appointmentPage`, en
  `src/lib/email/templates.ts`, compartido:

  ```ts
  appointmentPage?: { url: string; canCancel: boolean; confirmed: boolean } | null;
  ```

  Es de cada persona: `notifyAppointmentChange` lo pone en `write` junto a `clientName`, igual que hoy
  quita el pago a las otras personas.
- **El enlace de cada persona:** `loadAppointmentContext` (en `notifications.ts`) añade a cada
  `Recipient` dos datos:
  - su token: `payment_token` el principal, `access_token` las demás;
  - si ya confirmó.

  Los emails se arman después de guardar a las personas (`saveExtraClients`), como hoy, así que cada
  persona nueva ya tiene su token.
- **Qué emails lo llevan:** los de una cita activa (RF-006):
  - la solicitud de reserva (`bookingCreated`);
  - la confirmación (`appointmentConfirmed`);
  - el cambio de fecha (`appointmentUpdated`);
  - la cita restablecida (`appointmentRestored`);
  - la cita que vuelve a quedar pendiente (`appointmentPending`);
  - el recordatorio (`appointmentReminder`).

  No lo llevan:
  - la cancelación (ya ofrece «Reservar una nueva cita»);
  - «Gracias por tu visita»;
  - «Te esperábamos».
- **Cómo se ve:**
  - **Tipo de bloque nuevo:** `{ kind: "link"; label; url }`, en `src/lib/email/layout.ts`. Es un
    enlace subrayado del color de la marca, debajo de los datos de la cita, y en texto queda
    «Etiqueta: URL».
    - No es un botón: así no ocupa el «Si el botón no funciona, copia este enlace» del final, que
      sigue siendo el del pago o el de «Confirmo que voy».
  - **Recordatorio:**
    - el botón «Confirmo que voy» (`url` + `?confirmar=1`) y debajo el enlace;
    - si esa persona ya confirmó, en lugar del botón: «Ya nos confirmaste que vienes. ¡Gracias!».
  - **El texto del enlace:**
    - «Ver o cancelar mi cita» si esa persona podrá cancelar cuando salga el email, según
      `canCancelOnline`;
    - si no, «Ver mi cita»: otras personas de la sesión, negocio sin cancelaciones o ya fuera de plazo.
      Es un cambio respecto a la spec (ver el plan).
- **La copia al profesional nunca lo lleva** (RF-006):
  - la copia se arma con los datos comunes (`copy.data`), sin los de cada persona;
  - además, las plantillas no ponen el bloque si `professionalCopy` tiene valor. Son dos barreras.

  Lo mismo para los avisos al negocio (`bookingReceived`, `paymentReceiptReceived`) y al profesional.
- **Copia de la cancelación hecha por el paciente:** `professionalCopy` gana `byPatient?: boolean`, y
  la nota de arriba dice «Copia para ti del email que recibió María López. La canceló el paciente
  desde su email.».
- **Recordatorio (`runReminderJob`):** calcula `canCancel` con los minutos que faltan cuando se pone
  en cola (ya los calcula para la ventana). Con los ajustes de fábrica (recordatorio a las 24 h,
  antelación de 24 h), el recordatorio sale cuando ya no se puede cancelar. Por eso lleva «Ver mi
  cita». Es una pregunta para el dueño (ver el plan).
- **Topes de emails:** sin cambios. La cancelación ya es un email a terceros
  (`THIRD_PARTY_EMAIL_TYPES`), y la confirmación no manda nada. Un enlace sólo puede cancelar una vez,
  así que no sirve para mandar emails en cadena.
- **Descartado:** un botón también para «Ver o cancelar mi cita». Dos botones seguidos compiten con
  «Enviar el comprobante» y con «Confirmo que voy».

## R8. Aviso de ntfy de la cancelación

- **Decisión:**
  - **Lectura:** `findStatusChanges`, en `booking-alerts.ts`, lee además `l.action`, y
    `StatusChange` gana `byPatient: boolean`, que vale `true` con
    `action = 'appointment.client_cancelled'`.
  - **El aviso** (`statusChangeNotice`) cambia dos cosas:
    - el título es «Agenda360: cita cancelada por el paciente», sin el negocio, como todos;
    - la línea de quién dice «Cancelada por el paciente desde su email», en lugar de «Cambiado desde
      el panel…».

  El resto es como en la spec 008:
  - el paciente a medias;
  - los emails que salieron: «Al paciente» y «Copia al profesional»;
  - el negocio en el mensaje.
- **La confirmación no avisa por ntfy:** su registro no tiene «Estado» en `changes`, así que
  `findStatusChanges` no la ve.
- **Por qué:** RF-009, y lo hace el cron como hoy (principio VI).

## R9. Límites de peticiones y caché

- **Limitadores nuevos** en `platform-routes.ts`, con `limitRequests` de `src/http/handlers.ts`
  (por IP, IPv6 agrupada por /64, en PostgreSQL):

  | Nombre | Rutas | Tope |
  |---|---|---|
  | `mi-cita` | `GET /public/appointments/:token` | 60 en 15 min |
  | `mi-cita-acciones` | `POST …/confirm` y `POST …/cancel` | 20 en 15 min |

- **Sin CAPTCHA:** el token, de 128 bits al azar, es la autorización, como en el pago. Adivinar uno no
  es posible, y el límite frena el intento.
- **Respuestas:** `Cache-Control: private, no-store` en el `GET`, como el pago. `/public` ya va antes
  de la sesión (spec 009), así que nunca lleva cookie.
- **Analítica:** sin cambios. `page-analytics.tsx` ya cambia cualquier token de 16 caracteres hex o
  más por `[token]` y quita los parámetros (`?confirmar=1`). Llega «/cita/[token]».
- **CSP y service worker:** sin cambios. No hay servicios nuevos: WhatsApp es un enlace `wa.me`, no
  una petición. El service worker deja `/api` fuera y `vercel.json` ya manda `/cita/…` a la app.

## R10. La marca en el panel

- **Dato:** `Appointment.clientConfirmations: { clientId: string; confirmedAt: ISODateTime }[]` (tipo
  compartido). Lista a quienes confirmaron, el principal primero.
  - Sale de `appointmentColumns()` con una subconsulta nueva en `src/db/columns.ts`
    (`clientConfirmationsSql`), al lado de `extraClientIdsSql`.
  - La fecha va en ISO, como las demás.
- **Cómo se ve:** con el texto, no sólo con un icono (principio VII), y con los tokens del tema
  (`bg-highlight/60 text-ink`, como «Llegó»):
  - **Una persona:** «Confirmó el paciente».
  - **Varias:** «Confirmaron todos» o «Confirmó 1 de 2».
  - **Bloque de día y semana** (`time-grid-view.tsx`): un icono `UserCheck`, y «, confirmó el
    paciente» en el `aria-label`, como hoy «, por verificar».
  - **Lista del celular** (`agenda-list-view.tsx`): la marca junto a `StatusBadge` y `ReceiptBadge`.
  - **Inicio:**
    - en «Lo que queda de hoy» (`today-list.tsx`), la marca «Confirmó» junto a «Llegó». Así se ve a
      quién llamar;
    - en la tarjeta «Tu siguiente cita» (`next-up.tsx`), también.
  - **Ficha** (`appointment-details-sheet.tsx`):
    - arriba, junto a «Llegó a las…»: «Confirmó el paciente · 14 oct, 18:20», con `formatClockTime` en
      la zona del negocio;
    - con varias personas, bajo cada una: «Confirmó que va el 14 oct a las 18:20» o «Aún no confirma».
- **Componente nuevo:** `src/features/appointments/client-confirmed-badge.tsx` (como
  `receipt-badge.tsx`), con su función en `appointment-utils.ts`.
- **Con un backend anterior:** el panel trata `clientConfirmations` como una lista vacía si falta
  (`?? []`). Así el front se puede publicar antes que el backend (R14).
- **Actividad:** el filtro «Reservas online» de `activity-log.tsx` (actor null) pasa a llamarse
  «Pacientes (página y emails)», porque ahora también incluye lo que hacen desde su email.

## R11. Configuración → Agenda

- **Pestaña:** el formulario es `booking-settings-form.tsx`, en la pestaña «Agenda». La spec dice
  «Reservas».
- **Textos nuevos:**
  - **«Permitir cancelaciones»:** «Tus pacientes pueden cancelar desde el enlace de sus emails («Tu
    cita») hasta la antelación que fijes. Tu política se muestra al reservar y en los emails.».
  - **«Antelación mínima para cancelar»:** «Con menos tiempo, la página de su cita le pide que te
    escriba por WhatsApp o te llame.».
  - **Aviso,** si están encendidos los recordatorios y la antelación es igual o mayor que las horas del
    recordatorio: «Tu recordatorio sale 24 h antes: con esta antelación ya no se podrá cancelar
    desde el recordatorio, sólo desde los emails anteriores. Puedes bajarla o enviar el recordatorio
    antes en Notificaciones.». El formulario ya recibe `business`, con `notificationSettings`.
- **Por qué:** escenario 4.1. El aviso explica lo que pasa con los valores de fábrica sin cambiarlos
  (principio III: los valores por defecto son una decisión del dueño).

## R12. La página «Tu cita» (front)

- **Archivos:**
  - **Ruta:** `/cita/:token`, en `src/app/router.tsx`, junto a `/pago/:token`, con `lazyPage`.
  - **Página:** `src/pages/appointment-page.tsx`, con el mismo esqueleto que `payment-page.tsx`:
    `BrandThemeProvider` con los colores del negocio, `PageTitle`, el logo y `max-w-xl`.
  - **Partes:** en `src/features/patient-appointment/`: la tarjeta de la cita, la confirmación y la
    cancelación, con `ConfirmDialog`.
- **Datos:**
  - **Repositorio:** `getAppointment`, `confirmAppointment` y `cancelAppointment` en `publicBooking`
    (`src/lib/data/repository.ts` y `api-repository.ts`). Las rutas `/public/*` ya van sin cookie
    (`credentials: "omit"`).
  - **Hooks:** `usePublicAppointment`, `useConfirmAppointment` y `useCancelAppointment`, en
    `use-public-booking.ts`, con su clave en `query-keys.ts`.
- **Estados y textos:** los de [contracts/api.md](./contracts/api.md#página-tu-cita-del-front).
- **WhatsApp:** una función nueva en `src/lib/whatsapp.ts`, `getCantAttendWhatsAppUrl(business,
  appointment)`, con un mensaje ya escrito: «Hola, no podré ir a mi cita de {servicio} el {día} a
  las {hora}.». Es un enlace `wa.me`: nada de WhatsApp por API.
- **Accesibilidad y celular:**
  - el resultado de confirmar o cancelar se anuncia en `role="status"`, y el foco va al mensaje;
  - los botones ocupan todo el ancho en el celular, y la página se revisa a 390 px sin
    desplazamiento horizontal (CE-004);
  - se respeta `prefers-reduced-motion`.
- **Página de pago:** gana el enlace «Ver o cancelar mi cita» a `/cita/:token`.

## R13. Beta

- **Qué cambia:** lo mismo con sus datos de prueba (RF-012):
  - los tipos, las plantillas, `layout.ts` y `canCancelOnline`, copiados a mano (la beta no usa
    `sync:shared`);
  - la página `/cita/:token` y la marca en la agenda, el Inicio y la ficha.
- **Datos:**
  - **Personas de la sesión:** `StoredAppointment` (en `src/lib/data/mock/helpers.ts`) gana los
    tokens y las confirmaciones de las otras personas (`extraClientTokens`, `extraClientConfirmedAt`),
    como hoy `extraClientAccessPending`. `migrateData` (en `store.ts`) los rellena en las bases
    guardadas.
  - **Repositorio de prueba:** en `public-booking-repository.ts`, `getAppointment`, `confirmAppointment`
    y `cancelAppointment`. La cancelación pasa por el mismo cambio de estado que
    `business-data-repository.ts` (`updateStatus`).
  - **Borrar la confirmación:** en `business-data-repository.ts`, al reprogramar, al cambiar de
    profesional o de principal y al cancelar.
  - **Emails:** `notifications.ts` pone el enlace de cada persona y deja la copia sin él.
- **Bandeja de emails simulada** (`email-outbox.tsx`): hoy muestra el texto sin enlaces. Los enlaces
  de la propia beta (`/cita/…` y `/pago/…`) pasan a poder abrirse, para probar «Tu cita» desde el
  email.
- **Datos demo** (`seed.ts`): unas citas de mañana ya confirmadas por el paciente y otras sin
  confirmar.

## R14. Orden de publicación

1. **Migración 037:** sólo añade columnas con valor por defecto y el trigger. El backend de hoy no las
   usa y sigue igual.
2. **Front:**
   - el panel tolera que la API aún no mande `clientConfirmations`;
   - la página «Tu cita» existe, pero todavía ningún email lleva su enlace.
3. **Backend:** desde ese momento, los emails y el cron (que corre con `main`) llevan el enlace, y la
   página ya existe.

- **Por qué:** con este orden ningún email lleva a una página que todavía no existe. Al revés, los
  emails de los minutos entre una publicación y otra llevarían a una página que no existe.

## R15. Constitución 1.7.0

Sube una sola vez para las specs 010, 011 y 012 (MENOR: se amplían principios). Esta spec añade un
punto al principio III y dos palabras al II. El texto exacto está en el plan.
