# Especificación: Las citas, como invitaciones de calendario

**Carpeta**: `specs/027-invitaciones-calendario` (rama de trabajo: `dev`) · **Creada**: 2026-10-19

**Estado**: Publicada (2026-10-19, PR backend #52 y front #38)

**Repos**:
- **agenda-backend:** las invitaciones (crearlas, actualizarlas y cancelarlas), el email y el cron.
- **agenda-front:** el interruptor de cada agenda y su explicación.
- **La beta:** no, porque no envía emails reales.

## Pedido

El 2026-10-19 una clienta psicóloga pidió tener su agenda en el calendario del celular y del iPad
(«desde mi widget»). Con el dueño del producto se repasaron las opciones:
- la suscripción para iPhone/iPad, que quedó parada;
- la conexión directa con Google, que necesita la verificación de Google y un dominio propio, y
  también quedó parada;
- un botón por cita.

Lo difícil del botón era qué pasa cuando la cita cambia. El dueño eligió la recomendación de Claude:
«me gusta lo que me recomiendas, impleméntalo».

**Lo que se hace:**
1. **Invitaciones por email:** cada cita le llega al profesional como una invitación de calendario,
   igual que las de una reunión.
2. **Se mantienen al día solas:** si la cita cambia, llega la invitación actualizada y Google o Apple
   corrigen el evento. Si se cancela, lo quitan.
3. **Dentro del evento,** un enlace «Ver en Agenda360».

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Activar las invitaciones de una agenda (Prioridad: P1)

**Prueba independiente**: activar el interruptor y ver que llegan las invitaciones de las próximas
citas.

**Escenarios de aceptación**:

1. **Dado** la configuración de una agenda, **entonces** hay un interruptor «Recibir mis citas en mi
   calendario (Google, iPhone, Outlook)», apagado al principio. Lo explica en una frase: llega una
   invitación por cada cita, se actualiza sola si cambia y se quita si se cancela. Dice también a qué
   email llegan.
2. **Dado** quién puede cambiarlo, **entonces**:
   - el profesional, el de su agenda;
   - el propietario y el administrador, el de cualquier agenda del negocio;
   - con una sola agenda, el propietario, desde su perfil.
3. **Dado** que se activa, **entonces** llegan enseguida las invitaciones de las citas de esa agenda de
   los próximos 14 días.
4. **Dado** que se desactiva, **entonces** dejan de llegar. Los eventos que ya están en el calendario
   no se borran: lo dice la explicación.
5. **Dado** cualquiera de los dos cambios, **entonces** queda en la actividad del negocio, con quién lo
   hizo.

### Historia 2 - Cada cita, en el calendario del profesional (Prioridad: P1)

**Prueba independiente**: crear, mover y cancelar una cita, y mirar las invitaciones que salen.

**Escenarios de aceptación**:

1. **Dado** una cita nueva en los próximos 14 días, desde el panel o desde la página de reservas,
   **entonces** al profesional le llega un email «Cita: Juan P. · Terapia individual · mar 20 oct,
   15:00» con la invitación.
2. **Dado** la invitación, **cuando** la acepta o la añade, **entonces** el evento queda en su
   calendario con:
   - el título «Juan P. · Terapia individual», o «Juan P. y Ana T. · Terapia de pareja» si son
     varios;
   - la hora de inicio y fin, en la zona horaria del negocio;
   - el lugar: la dirección del negocio, «En línea» con el enlace de la videollamada, o «A domicilio»
     sin la dirección del paciente;
   - en la descripción, «Ver en Agenda360» con el enlace a la cita y «Si la cita cambia o se cancela,
     este evento se actualiza solo».
3. **Dado** una reserva por confirmar, **entonces** el evento sale como «provisional», con «Por
   confirmar» al comienzo del título. Al confirmarla, llega la actualización.
4. **Dado** que la cita se mueve (fecha u hora), cambia de servicio o se reactiva, **entonces** llega
   «Cambió: …» y el calendario actualiza el mismo evento, sin duplicarlo.
5. **Dado** que se cancela, **entonces** llega «Cancelada: …» y el calendario la quita o la marca
   cancelada.
6. **Dado** que la cita pasa a otra agenda, **entonces** al profesional anterior le llega la
   cancelación y al nuevo, la invitación, si tiene el interruptor activado.
7. **Dado** que una cita se completa o se marca «No asistió», **entonces** no sale nada: ya pasó.

### Historia 3 - Sin llenar el correo (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una cita a más de 14 días, **entonces** no sale nada todavía. Su invitación sale sola
   cuando falten 14 días.
2. **Dado** una serie de citas, por ejemplo 24 semanales, **entonces** sólo salen las de los próximos
   14 días, y las demás llegan cuando les toque.
3. **Dado** una cita a más de 14 días que cambia, **entonces** no sale nada hasta que le toque, y llega
   ya con los datos nuevos.
4. **Dado** las invitaciones, **entonces** cuentan como emails del negocio para los topes de envío que
   ya existen.

### Casos límite

- **Una agenda sin email** (sin usuario ni email de avisos) no tiene el interruptor.
- **Si el email del profesional cambia,** las siguientes invitaciones van al nuevo. Las de antes quedan
  en el calendario anterior.
- **Gmail añade la invitación solo** si así lo tiene configurado la persona. Si no, la primera vez se
  toca «Añadir al calendario». Los cambios siguientes se aplican solos. La explicación del interruptor
  lo dice.
- **Si falla un envío,** se reintenta como cualquier email. Si llega después una versión más nueva, la
  vieja no la pisa: el calendario se queda con la de número mayor.
- **Una cita de hoy que ya empezó** se trata como cualquier otra: si cambia, se avisa.
- **El paciente nunca recibe estas invitaciones,** sólo el profesional.

## Requisitos *(obligatorio)*

- **RF-001**: Cada agenda con email DEBE tener el interruptor, apagado al principio. Lo cambian el
  profesional (la suya) y el propietario o el administrador (cualquiera), y va a la actividad.
- **RF-002**: Con el interruptor activado, cada cita de esa agenda en los próximos 14 días DEBE generar
  una invitación de calendario al email del profesional, el mismo de la copia que ya recibe.
- **RF-003**: Los cambios de fecha, hora, servicio, agenda, confirmación y reactivación DEBEN enviar la
  versión nueva del mismo evento. La cancelación DEBE enviar su cancelación.
- **RF-004**: El evento DEBE llevar al paciente a medias («Juan P.»), el servicio, la hora, el lugar
  (sin la dirección del paciente) y el enlace «Ver en Agenda360». Nunca su contacto, su cédula, notas
  ni nada de la historia clínica.
- **RF-005**: Las citas a más de 14 días DEBEN recibir su invitación cuando entren en esa ventana, una
  vez al día, por el cron.
- **RF-006**: Al activar el interruptor, DEBEN salir las invitaciones de las citas de los próximos 14
  días.
- **RF-007**: Las completadas y las «No asistió» NO DEBEN generar nada.
- **RF-008**: Las invitaciones DEBEN contar en los topes de emails del negocio, y el registro público
  del cron sólo DEBE llevar cifras.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Al mover una cita, el evento del calendario del profesional cambia de hora sin duplicarse,
  en Google Calendar y en el calendario del iPhone/iPad.
- **CE-002**: Al cancelarla, el evento desaparece o queda marcado como cancelado.
- **CE-003**: Una serie de 24 citas semanales no genera más de 2 o 3 invitaciones el día que se crea.
- **CE-004**: Ningún evento lleva el contacto, la cédula ni datos clínicos del paciente. Lo comprueban
  las pruebas.
- **CE-005**: Las pruebas pasan y el interruptor se ve bien en los dos modos y a 390 px.

## Supuestos

- **Las invitaciones salen del mismo Gmail de la plataforma.** El organizador del evento es esa
  cuenta, y el invitado, el profesional.
- **La ventana es de 14 días.** Si hiciera falta, se cambia en un solo lugar.
- **El paciente va a medias,** como pide la constitución fuera del panel: los calendarios y sus
  widgets se ven en la pantalla de bloqueo.
- **Que Google y Apple actualicen el evento** es el comportamiento normal de las invitaciones con el
  mismo identificador y un número de versión mayor. Se comprueba con una cuenta de Gmail y un iPhone
  de verdad antes de publicar.
- **Activar o desactivar** va a la actividad; enviar las invitaciones es automático y no va.
- **La beta** no lo lleva, porque no envía emails.
