# Especificación: Aviso al paciente en cada cambio de estado de su cita

**Carpeta**: `specs/008-avisos-cambio-estado` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Publicada (2026-10-14, PR backend #24 y front #22)

**Repos**: agenda-backend (principal: emails y la ruta del cambio de estado), agenda-front (panel,
plantillas y validaciones compartidas) y la beta. **Sin migración.**

## Pedido

El dueño del producto preguntó qué pasa si una cita pasa de «Confirmada» a «Pendiente». Hoy no se
avisa a nadie. Pidió que **el paciente se entere de cualquier cambio de estado**, tanto si la cita
avanza como si retrocede.

**Decisiones del dueño del producto (2026-10-14):**
1. **Los dos canales:** un email automático y el aviso por WhatsApp ya escrito que ofrece el panel
   («haz la opción 1 y 2»).
2. **Casilla «Avisar al paciente»:** marcada por defecto en el cambio de estado, para no avisar
   cuando sólo se corrige un error.
3. **Interruptor propio:** los emails de «Atendida» y «No asistió» van con el interruptor nuevo
   «Seguimiento» en Configuración → Notificaciones, encendido por defecto en todos los negocios.
4. **ntfy:** el dueño del producto también quiere enterarse de cada cambio de estado
   («igual notifícame por ntfy»). Con esto queda respondida la pregunta abierta de avisar por ntfy
   las cancelaciones y los cambios.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El paciente se entera de cada cambio de estado (Prioridad: P1)

Cada vez que su cita cambia de estado, el paciente recibe un email que le dice cómo quedó.

**Por qué esta prioridad**: es el pedido. Hoy el paciente puede creer que su cita está confirmada
cuando el negocio la volvió a dejar pendiente.

**Prueba independiente**: cambiar una cita por cada estado y comprobar el email que queda en cola
para el paciente y la copia al profesional.

**Escenarios de aceptación** (con los emails activados en Configuración):

| La cita pasa a… | Email al paciente |
|---|---|
| **Confirmada**, desde Pendiente, Atendida o No asistió | «Tu cita está confirmada» (el de hoy) |
| **Pendiente**, desde Confirmada, Atendida o No asistió | Nuevo: «Tu cita queda pendiente de confirmar», con la fecha y la hora |
| **Atendida** | Nuevo: «Gracias por tu visita», con el enlace para reservar de nuevo |
| **No asistió** | Nuevo: «Te esperábamos en tu cita», con el enlace para elegir otra hora |
| **Cancelada** | La cancelación (el de hoy) |
| De **Cancelada** a Pendiente o Confirmada | «Tu cita vuelve a estar agendada» (el de hoy) |

1. **Dado** una cita Confirmada, **cuando** se pasa a Pendiente, **entonces** el paciente recibe
   «Tu cita queda pendiente de confirmar» y el profesional, su copia.
2. **Dado** una cita de hoy, **cuando** se marca Atendida, **entonces** el paciente recibe «Gracias
   por tu visita» con el enlace de reservas del negocio.
3. **Dado** una cita de hoy, **cuando** se marca No asistió, **entonces** el paciente recibe la
   invitación a elegir otra hora.
4. **Dado** una cita Atendida por error, **cuando** se vuelve a Confirmada, **entonces** el paciente
   recibe «Tu cita está confirmada».
5. **Dado** una cita con 2 pacientes, **cuando** cambia de estado, **entonces** cada uno recibe su
   email con su nombre y la copia al profesional sale una sola vez.

---

### Historia 2 - No avisar al corregir un error (Prioridad: P1)

Quien cambia el estado puede decidir que el paciente no se entere, porque sólo está corrigiendo un
toque equivocado.

**Por qué esta prioridad**: los botones de estado cambian la cita con un solo toque. Sin esta casilla,
un error le llegaría al paciente al instante.

**Prueba independiente**: desmarcar la casilla, cambiar el estado y comprobar que no sale ningún
email ni se ofrece WhatsApp, y que la actividad lo dice.

**Escenarios de aceptación**:

1. **Dado** la ficha de una cita, **cuando** se abre, **entonces** en «Cambiar estado» está la casilla
   «Avisar al paciente», marcada.
2. **Dado** la casilla desmarcada, **cuando** se toca otro estado o «Cancelar cita», **entonces** el
   estado cambia, no sale ningún email al paciente ni copia al profesional, y no se ofrece WhatsApp.
3. **Dado** ese cambio, **entonces** la actividad dice que se hizo sin avisar al paciente.
4. **Dado** que se cierra y se vuelve a abrir la ficha, **entonces** la casilla vuelve a estar
   marcada. No se recuerda, para que nunca quede apagada por olvido.

---

### Historia 3 - El negocio decide sobre el seguimiento (Prioridad: P2)

Un negocio puede apagar los emails de «Atendida» y «No asistió» sin apagar los demás.

**Por qué esta prioridad**: no todos los negocios quieren escribir después de la cita, pero el resto
de avisos sí.

**Prueba independiente**: apagar «Seguimiento» y marcar una cita Atendida: no sale email. Con
«Confirmaciones» encendido, el paso a Pendiente sí avisa.

**Escenarios de aceptación**:

1. **Dado** Configuración → Notificaciones, **entonces** aparece «Seguimiento: Atendida y No
   asistió», encendido en todos los negocios, también en los que ya existen.
2. **Dado** «Seguimiento» apagado, **cuando** una cita pasa a Atendida o No asistió, **entonces** no
   sale email.
3. **Dado** «Confirmaciones» apagado, **cuando** una cita pasa a Pendiente o Confirmada, **entonces**
   no sale email, como hoy.

---

### Historia 4 - WhatsApp también en todos los cambios (Prioridad: P2)

El panel ofrece el aviso por WhatsApp ya escrito en cualquier cambio de estado.

**Por qué esta prioridad**: el email puede no leerse; muchos pacientes responden por WhatsApp.

**Prueba independiente**: pasar una cita de Confirmada a Pendiente y comprobar que se ofrece el
mensaje «queda pendiente de confirmar».

**Escenarios de aceptación**:

1. **Dado** una cita Confirmada, **cuando** pasa a Pendiente con la casilla marcada, **entonces** el
   panel ofrece WhatsApp con: «Hola Ana, tu cita de … el martes 20 de octubre a las 10:00 con …
   queda pendiente de confirmar; te escribiremos para confirmarla».
2. **Dado** los demás cambios, **entonces** se ofrece el mensaje de hoy de cada estado: confirmada,
   cancelada, vuelve a estar agendada, gracias por la visita, reagendar.
3. **Dado** el aviso de WhatsApp, **entonces** dice si al paciente le llega además el email, con las
   reglas nuevas.

---

### Historia 5 - El dueño del producto se entera por ntfy (Prioridad: P2)

Además del paciente, el dueño del producto recibe por ntfy un aviso de cada cambio de estado de
cualquier cita, como ya recibe los de las citas nuevas.

**Por qué esta prioridad**: lo pidió para estar al tanto de lo que pasa en cada negocio.

**Prueba independiente**: cambiar el estado de una cita y comprobar el aviso que arma la siguiente
pasada del cron.

**Escenarios de aceptación**:

1. **Dado** una cita que pasa de Confirmada a Cancelada, **cuando** corre el cron, **entonces** llega
   un aviso con:
   - el título «Agenda360: cita cancelada», sin el nombre del negocio;
   - el negocio, la fecha y la hora;
   - el paciente a medias;
   - «De Confirmada a Cancelada»;
   - quién lo hizo y con qué rol;
   - a quién salieron los emails, o «Sin avisar al paciente» si se desmarcó la casilla.
2. **Dado** un cambio de estado desde el formulario de la cita, **entonces** también avisa.
3. **Dado** más de 10 cambios en una pasada, **entonces** llegan 10 avisos y uno con «…y N cambios
   más».

---

### Casos límite

- **Paciente sin email:** no sale email; WhatsApp se ofrece igual si tiene teléfono.
- **Atendida o No asistió de una cita vieja** (más de 7 días): no sale email. Se trata de poner al
  día la agenda y el «gracias» llegaría tarde. WhatsApp se ofrece igual.
- **Cambio de estado y de fecha a la vez** (desde el formulario de la cita): sale un solo email. Se
  mantiene la prioridad de hoy: cancelación, después «vuelve a estar agendada», después el cambio de
  fecha y hora, y después el del estado.
- **Formulario de la cita:** no tiene la casilla. Un cambio de estado desde ahí avisa según la
  Configuración, como hoy.
- **Recordatorios:** no cambian. Una cita Pendiente o Confirmada sigue recibiendo su recordatorio.
- **Varias veces seguidas:** cada cambio con la casilla marcada manda su email. Para correcciones
  está la casilla.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Al pasar una cita a Pendiente desde Confirmada, Atendida o No asistió, el paciente DEBE
  recibir «Tu cita queda pendiente de confirmar», si «Confirmaciones» está encendido.
- **RF-002**: Al pasar una cita a Atendida, el paciente DEBE recibir «Gracias por tu visita» con el
  enlace de reservas del negocio, si «Seguimiento» está encendido y la cita fue en los últimos 7 días.
- **RF-003**: Al pasar una cita a No asistió, el paciente DEBE recibir la invitación a elegir otra
  hora con el enlace de reservas, con las mismas condiciones que RF-002.
- **RF-004**: Al pasar a Confirmada desde cualquier otro estado activo, DEBE seguir saliendo «Tu cita
  está confirmada». La cancelación y «vuelve a estar agendada» siguen como hoy.
- **RF-005**: Cada email nuevo DEBE salir con copia al profesional (principio III) y a cada paciente
  de la cita con su nombre.
- **RF-006**: La ficha de la cita DEBE tener la casilla «Avisar al paciente», marcada al abrirla. Se
  aplica a los botones de estado y a «Cancelar cita».
- **RF-007**: Con la casilla desmarcada NO DEBE salir ningún email por ese cambio, ni copia al
  profesional, ni ofrecerse WhatsApp. La actividad DEBE decir «sin avisar al paciente».
- **RF-008**: Configuración → Notificaciones DEBE tener «Seguimiento: Atendida y No asistió»,
  encendido por defecto, también en los negocios que ya existen.
- **RF-009**: Al pasar de Confirmada, Atendida o No asistió a Pendiente, el panel DEBE ofrecer
  WhatsApp con el mensaje «queda pendiente de confirmar». Los demás estados ofrecen sus mensajes de
  hoy.
- **RF-010**: El aviso de WhatsApp DEBE decir correctamente si además llega el email, con las reglas
  nuevas.
- **RF-011**: La bandeja de emails DEBE mostrar los tipos nuevos con su nombre: «Pendiente de
  confirmar», «Gracias por la visita» y «No asistió».
- **RF-012**: La beta DEBE comportarse igual con sus datos de prueba (no tiene ntfy).
- **RF-013**: El cron DEBE avisar por ntfy de cada cambio de estado de una cita: los botones de
  estado y el formulario. Debe ir con el paciente a medias, el estado de antes y el de después,
  quién lo hizo y los emails que salieron. El título no debe nombrar al negocio. Llegan hasta 10
  avisos por pasada y, del resto, la cifra.

### Entidades clave

- **Configuración de notificaciones del negocio**: gana «Seguimiento» (sí o no; sí si no está
  guardado).
- **Email al paciente**: tres tipos nuevos (pendiente de confirmar, gracias por la visita, no asistió).
- **Cambio de estado**: gana «avisar al paciente» (sí por defecto).

## Criterios de éxito *(obligatorio)*

- **CE-001**: En pruebas, cada cambio de la tabla de la historia 1 deja en cola el email que le toca
  al paciente y la copia al profesional; con la casilla desmarcada, ninguno.
- **CE-002**: Ningún cambio de estado con la casilla marcada y los interruptores encendidos queda sin
  aviso al paciente que tiene email.
- **CE-003**: Corregir un error con la casilla desmarcada no manda nada al paciente.
- **CE-004**: Las pruebas automáticas pasan y la ficha se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- Los textos de los emails nuevos siguen el estilo de los de hoy, con los colores y el nombre del
  negocio, y los datos de la cita.
- El límite de 7 días para «Atendida» y «No asistió» evita escribir a pacientes al poner al día citas
  viejas. Se puede cambiar si el dueño del producto prefiere otro número.
- ntfy avisa de los cambios de estado. Un cambio de sólo fecha u hora, sin cambio de estado, no
  avisa por ntfy en esta spec.
