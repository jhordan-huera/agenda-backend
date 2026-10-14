# Investigación y decisiones: Servicios en pareja o familia y su reserva online

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-13

Cada decisión dice qué se eligió, por qué y qué se descartó. Los nombres de archivos son del
backend salvo que digan «front» o «beta».

**Decisiones del dueño del producto que se toman como aprobadas.** Pidió seguir con el plan sin
objetar las recomendaciones de la spec:
1. en el panel, un aviso y no un bloqueo;
2. se puede compartir email o teléfono;
3. los datos de pago van sólo al paciente principal, también en las citas del panel.

## D1. Dónde se guardan las personas por sesión

- **Decisión:** una columna nueva `services.people_per_session` (entero de 1 a 3, por defecto 1).
  En el tipo `Service` se llama `peoplePerSession`.
- **Por qué:**
  - cubre pareja (2) y familia (3) con el mismo máximo que la fase 1;
  - los servicios que ya existen quedan en 1 sin tocarlos (RF-001).
- **Descartado:**
  - **Un sí/no «en pareja».** No permite familias de 3.
  - **Una tabla aparte.** Es un solo número por servicio.

## D2. Cuándo vale el dato (el interruptor del super admin)

- **Decisión:** el dato vale sólo si el negocio tiene `multiClientAppointments`. Un solo ayudante,
  `peopleFor(business, service)`, devuelve `service.peoplePerSession` con el interruptor y 1 sin
  él. Lo usan la reserva, el perfil público y los avisos. Además:
  - **Perfil público:** cada servicio sale con su valor efectivo, así que con el interruptor
    apagado la página ve 1.
  - **Guardar un servicio:** el campo es opcional y, si no llega, se conserva el que había. Así un
    front anterior (PWA en caché) o el botón de activar o desactivar no lo pisan.
  - **Sin interruptor:** el backend ignora el valor que llegue y conserva el guardado (RF-002).
- **Por qué:** al apagarlo no se pierde el dato y, al volver a encenderlo, cada servicio recupera
  sus personas (escenario 1.3 de la spec).
- **Descartado:** poner todos los servicios en 1 al apagar el interruptor, porque se pierde lo que
  eligió el negocio.

## D3. Cómo llegan las otras personas en la reserva

- **Decisión:** `PublicBookingInput` gana `extraPatients`, una lista opcional de 0 a 2 personas, cada
  una con `{ documentId, name, email, phone }`. Valida así:
  - **Con las mismas reglas que quien reserva:** cada campo usa los validadores de hoy, y en el
    backend `documentIdError` se aplica a cada cédula.
  - **Cédulas distintas:** un refine del esquema compartido rechaza una cédula repetida, también la
    de quien reserva.
  - **Número de personas:** el backend exige exactamente `peopleFor(...) - 1` personas.
    - Si llegan menos, 400 con un mensaje que pide recargar la página: así le pasa a un front
      anterior que no conoce el campo.
    - Si llegan de más o el negocio no está habilitado, 400.
- **Por qué:**
  - se mantiene la misma ruta `POST /public/businesses/:slug/bookings`;
  - quien reserva sigue siendo el paciente principal, con los mismos campos de hoy;
  - una reserva individual no cambia, porque `extraPatients` es `[]`.
- **Descartado:** una ruta nueva para las reservas en pareja. Duplicaría límites, CAPTCHA y
  reintentos.

## D4. Reconocer a cada persona por su cédula

- **Decisión:** se saca de `book()` una función `resolveBookingClient(db, business, person, opts)`
  con la regla de hoy, sin cambios:
  1. comprueba la cédula;
  2. busca la ficha por cédula;
  3. si la encuentra, exige `sameContact`;
  4. si no, busca una ficha antigua sin cédula con el mismo email y nombre;
  5. si tampoco, crea un paciente nuevo con los topes de pacientes nuevos y del plan.

  Se llama para quien reserva y después para cada otra persona, en la misma transacción.
- **Mensajes para las otras personas** (nombran a la persona como la escribió quien reserva y no
  muestran nada de su ficha):
  - datos que no coinciden: «No pudimos confirmar los datos de {nombre}. Revisa su email y su
    teléfono o escríbenos por WhatsApp.»;
  - límite por día: «{Nombre} ya tiene una cita ese día con {negocio}. Si necesitan otra,
    escríbanle al negocio o elijan otro día.»
- **Por qué:** es la petición del dueño del producto («tal cual como ha venido funcionando»). Si
  algo falla, la transacción deshace todo y no queda ningún paciente nuevo (CE-006).
- **Descartado:** reconocer a las otras personas sólo por la cédula, sin email ni teléfono. Con la
  cédula de cualquiera se reservaría a su nombre.

## D5. Guardar la cita con las otras personas

- **Decisión:**
  1. se inserta la cita como hoy, con quien reserva como principal;
  2. se llama a `saveExtraClients(db, appointment, ids, [])`, que ya existe y no depende del usuario
     ni del alcance;
  3. después se llama a `notifyAppointmentChange`, porque los destinatarios salen de
     `extraClientIds`.

  Los triggers de la migración 032 siguen impidiendo más de 3 pacientes, repetir al principal o
  mezclar negocios.
- **Por qué:** se reutiliza lo de la fase 1 sin otro camino para guardar.
- **Descartado:** `resolveExtraClients`. Necesita el alcance de un usuario del panel y rechaza a
  los pacientes inactivos. En la página, a cada persona se le aplica lo de hoy con quien reserva
  (caso límite de la spec).

## D6. Límite de citas por persona al día

- **Decisión:**
  - `assertClientDailyLimit` cuenta las citas del día en las que la persona es principal **o** una
    de las otras pacientes (`appointment_clients`);
  - se aplica a cada persona;
  - con quien reserva, el mensaje es el de hoy («Ya tienes una cita…»); con las demás, el de D4.
- **Por qué:** si no, quien ya tiene una sesión de pareja ese día podría reservar otra individual,
  y el límite dejaría de ser «por persona».
- **Descartado:** contar sólo como principal. Deja ese hueco.

## D7. Privacidad: el acceso de un profesional con «sólo sus pacientes» (NO NEGOCIABLE)

- **El riesgo:**
  - Hoy (migración 028), una reserva online de un paciente que ya existía no le da al profesional
    acceso a su ficha ni a su historia hasta que la gestione el negocio (`client_access_pending`).
  - Esa marca es de la cita y sólo mira al paciente principal.
  - En una reserva en pareja, si quien reserva es nuevo, la cita no queda pendiente. Entonces un
    profesional podría reservarse una sesión con su propia identidad y poner como segunda persona a
    un paciente que ya existe, con su cédula y su teléfono. Vería su historia clínica.
- **Decisión:**
  - **Migración 033:** agrega `appointment_clients.client_access_pending` (por defecto `false`) y un
    trigger que la calcula al insertar una fila de una reserva online recién creada (la cita es de
    `source = 'booking_page'` y se creó en esta misma transacción). Usa las mismas tres reglas de
    la 028, aplicadas a esa persona:
    - no se creó en esta transacción;
    - no la registró el profesional;
    - no tiene ya con él una cita que dé acceso.
  - **`ownClientCondition`:** la parte de los otros pacientes exige también
    `not ownextra.client_access_pending`.
  - **`pendingClientCondition`:** también cuenta a los otros pacientes pendientes. El profesional
    ve su nombre en la cita, pero no su ficha, como hoy con el principal.
  - **`releaseClientAccess`:** también libera a los otros pacientes de la cita, con las mismas
    condiciones de hoy.
  - **Pruebas:** lo comprueba una prueba que reproduce el ataque.
- **Por qué:** principio II. Es el mismo agujero que cerró la 028, ahora por la segunda persona.
- **Descartado:** marcar toda la cita como pendiente si alguna persona lo está. Le quitaría el
  acceso a quien sí era su paciente.

## D8. El email de las otras personas dice quién reservó

- **Decisión:** `AppointmentEmailData` (plantillas compartidas, se editan en el front) gana
  `bookedBy?: string`. Sólo lo lleva el email de solicitud recibida (`bookingCreated`) de una
  reserva desde la página, a cada persona que no es la principal. Con él:
  - el texto dice «{bookedBy} reservó para ti una cita en {negocio}»;
  - lo demás es igual: detalles, política y la nota de que está pendiente.
- **Por qué:** RF-007. Sigue el patrón de `professionalCopy`, un dato opcional que cambia el texto.
- **Descartado:** una plantilla nueva. Duplicaría los bloques de la cita.

## D9. Datos de pago sólo para el paciente principal

- **Decisión:** en `notifyAppointmentChange`, el email a cada persona que no es la principal sale
  con `payment: null`.
  - Vale para las citas de la página y para las del panel (decisión 3).
  - La copia al profesional usa los datos del principal y sigue mostrando el pago.
  - Los recordatorios no llevan bloque de pago.
- **Por qué:** el precio es por sesión y lo paga una persona. Si no, los dos podrían transferir.
- **Descartado:** dejarlo como en la fase 1, donde todos lo reciben.

## D10. Tope de emails a pacientes nuevos por negocio

- **Decisión:** `newPatientEmailHold` cuenta los emails de solicitud y confirmación de las citas
  con **algún** paciente nuevo de la página, sea el principal o una de las otras personas.
- **Por qué:** hoy sólo cuenta cuando el principal es nuevo. Con pareja, un robot podría reservar con
  un paciente existente y mandar emails a direcciones ajenas como «la otra persona».
- **Descartado:** contar sólo los emails cuya dirección es la de un paciente nuevo. Es más estrecho
  que el tope de hoy: la prueba `public-abuse` lo detectó.

## D11. El reintento reconoce la misma reserva

- **Decisión:**
  - `findRepeatedBooking` compara además las cédulas de las otras personas: la misma lista sin
    importar el orden, y vacía en una reserva individual;
  - si es la misma reserva, devuelve la confirmación de hoy (`repeated`);
  - si las personas son otras, no es un reintento y sigue el camino normal: la hora está ocupada y
    responde «Esa hora acaba de ocuparse».
- **Por qué:** RF-010, sin crear otra cita ni otros pacientes.

## D12. Aviso por ntfy

- **Decisión:**
  - en `booking-alerts.ts`, `OnlineBooking.client` pasa a `clients`, una lista con el principal
    primero;
  - cada persona sale en una línea propia, con «Paciente nuevo» o «Ya era paciente» y sus datos a
    medias (`masking.ts`);
  - la consulta junta `appointment_clients`.
- **Por qué:** RF-011 y principio II.

## D13. La página de reservas (front)

- **Decisión:**
  - **Tarjeta del servicio y resumen lateral:** muestran «Para 2 personas» o «Para 3 personas».
  - **«Tus datos»:** si el servicio es para 2 o 3, agrega un bloque «Datos de la otra persona» (con
    3, «Persona 2» y «Persona 3») con cédula, nombre, email y teléfono.
    - Lugar, dirección y notas son de la sesión y se piden una vez.
    - La validación es la misma, persona por persona, con `documentIdError` en cada cédula y
      cédulas distintas.
  - **Confirmación:** muestra los datos de cada persona.
  - **Pantalla final:** nombra a todas, con los nombres que ya tiene la página. La respuesta de la
    API no cambia.
  - **«Recordar mis datos»:** no cambia y sólo guarda a quien reserva.
- **Por qué:** RF-003, RF-012 y RF-013, con los mismos componentes (`FormField`, `validate`).

## D14. Panel (front)

- **Decisión:**
  - **Formulario de servicios:** «Personas por sesión» con tres botones (1, 2, 3), como
    «Modalidad». Sólo aparece si `business.multiClientAppointments` está activo. Si no, el campo
    no se envía y el backend conserva el valor (D2).
  - **Formulario de cita:** al elegir un servicio de 2 o 3 personas, si el negocio puede agregar,
    completa los espacios vacíos hasta `personas - 1`. Si faltan pacientes, muestra el aviso ámbar
    que ya usa el formulario, sin bloquear: «Este servicio es para 2 personas: falta un paciente.
    Puedes guardar igual.»
- **Por qué:** RF-014 y la decisión 1.

## D15. La beta

- **Decisión:** los mismos cambios sobre su repositorio de prueba:
  - **`src/lib/data/mock/`:**
    - `store.ts` (`peoplePerSession ??= 1` en `migrateData`);
    - `public-booking-repository.ts` (otras personas, límites, acceso pendiente por persona);
    - `business-data-repository.ts` (guardar el servicio sin pisar el campo);
    - `helpers.ts` (acceso de «sólo sus pacientes»);
    - `notifications.ts` (pago sólo al principal y `bookedBy`).
  - **Pantallas:** las de la página y el panel.
  - **Cuidados que encontró la revisión:**
    - `toggleActive` en `services-page.tsx` vuelve a enviar todos los campos;
    - `update` del servicio hace `Object.assign` con los valores por defecto.
  - **Respaldo:** antes de empezar, como en la fase 1.
- **Por qué:** RF-017. La beta no envía emails reales ni tiene ntfy.

## D16. Constitución 1.3.0

- **Decisión:** en los dos repos, el principio III cambia en dos puntos:
  - **Copia al profesional:** la línea queda así: «Cada email al paciente sobre su cita, también
    los recordatorios, sale con copia al profesional» (decisión del 2026-10-13).
  - **Línea nueva:** «Los servicios pueden ser para 2 o 3 personas, sólo con el interruptor del
    super admin. La página de reservas pide los datos de cada una y reconoce a cada persona por su
    cédula como a quien reserva; las que no existen se registran como nuevas. Los datos de pago van
    sólo al paciente principal (2026-10-13).»

  Es MENOR porque amplía decisiones.
