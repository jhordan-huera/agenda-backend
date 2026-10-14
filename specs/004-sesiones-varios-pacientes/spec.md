# Especificación: Sesiones con varios pacientes (fase 1, desde el panel)

**Carpeta**: `specs/004-sesiones-varios-pacientes` (rama de trabajo: `dev`)

**Creada**: 2026-10-13

**Estado**: Publicada (2026-10-13)

**Repos**: agenda-backend (principal: datos, avisos y API), agenda-front (panel) y la beta.

## Pedido

Lo pide un profesional que atiende **sesiones de pareja**:

> «Hay veces que tengo sesiones con parejas y quiero que a los dos les llegue la notificación, pero
> solo hay cómo agregar a uno. ¿Hay alguna manera de hacerlo uniendo a dos pacientes o que se
> elimine eso de que se sobrepongan sesiones?»

**Decisión del dueño del producto (2026-10-13):** se descartaron dos caminos.
- **Que las citas se crucen.** Habría que mover y cancelar dos citas, los reportes contarían doble
  y existiría el riesgo de dar la misma hora a dos desconocidos.
- **Unir a los dos en un solo paciente.** Quedaría una cédula para dos personas y una historia
  clínica mezclada.

Se elige que **una cita pueda tener varios pacientes**. Esta fase es sólo desde el panel; la reserva
online queda para una fase 2.

**Condiciones del dueño del producto (2026-10-13):**
- Una cita tiene como **máximo 3 pacientes**: el principal y hasta 2 más.
- **Sólo lo tienen los negocios que el super admin habilite**, con un interruptor en la ficha del
  negocio. Viene apagado: los negocios no lo activan ellos mismos.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 0 - El super admin decide qué negocios lo tienen (Prioridad: P1)

Un negocio pide poder atender sesiones de pareja. El super admin lo habilita sólo para ese negocio.

**Prueba independiente**: activar el interruptor en la ficha de un negocio y comprobar que su panel
ofrece «Agregar otro paciente» y que el de otro negocio no.

**Escenarios de aceptación**:

1. **Dado** la ficha de un negocio en el panel del super admin, **cuando** el super admin activa
   «Citas con varios pacientes», **entonces** ese negocio puede agregar pacientes a sus citas. El
   cambio queda en el registro de auditoría.
2. **Dado** un negocio sin el interruptor activado (lo normal), **cuando** su equipo crea o edita
   una cita, **entonces** no aparece la opción de agregar otro paciente. Intentarlo por otro camino
   tampoco funciona.
3. **Dado** el propietario o cualquier miembro del negocio, **cuando** busca esta opción en la
   configuración de su negocio, **entonces** no la encuentra: sólo el super admin la cambia, desde
   su panel.
4. **Dado** un negocio que ya tiene citas con varios pacientes, **cuando** el super admin apaga el
   interruptor, **entonces** esas citas conservan a sus pacientes y sus avisos siguen saliendo a
   todos. Ya no se pueden agregar pacientes, pero sí quitarlos.

---

### Historia 1 - Agendar una sesión de pareja y que les llegue a los dos (Prioridad: P1)

En un negocio habilitado, la psicóloga crea en el panel una cita para Ana Torres y agrega a Carlos
Pérez como segundo paciente. Los dos reciben el email de la cita, cada uno en su correo.

**Prueba independiente**: crear desde el panel una cita con dos pacientes que tienen email.
Revisar en el registro de emails que salió un email a cada uno y una sola copia al profesional.

**Escenarios de aceptación**:

1. **Dado** el formulario de una cita nueva con Ana como paciente, **cuando** la profesional pulsa
   «Agregar otro paciente», elige a Carlos de su lista y guarda, **entonces** la cita queda con los
   dos pacientes.
2. **Dado** que Carlos todavía no es paciente, **cuando** la profesional lo crea desde el mismo
   formulario (como hoy se crea el paciente principal), **entonces** queda registrado con su
   cédula y agregado a la cita.
3. **Dado** que la cita se crea confirmada y el negocio tiene activos los emails de confirmación,
   **cuando** se guarda, **entonces** Ana y Carlos reciben cada uno el email de confirmación con su
   propio saludo («Hola Ana:», «Hola Carlos:»). Ninguno ve el correo ni el teléfono del otro.
4. **Dado** el mismo caso, **cuando** sale la copia al profesional, **entonces** sale una sola vez
   y nombra a los dos pacientes.

---

### Historia 2 - Cualquier cambio de la cita les llega a todos (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una cita de pareja pendiente, **cuando** se confirma, se cambia de día u hora, se
   reactiva o se cancela, **entonces** cada paciente de la cita recibe el email correspondiente,
   igual que hoy recibe el paciente principal.
2. **Dado** una cita de pareja próxima, **cuando** llega la hora del recordatorio, **entonces** cada
   paciente con email recibe su recordatorio, una sola vez.
3. **Dado** una cita de pareja, **cuando** se arrastra a otra hora en la agenda, **entonces** se
   mueve la sesión entera, con todos sus pacientes, y todos reciben el aviso de cambio.
4. **Dado** que se quita a un paciente de una cita activa, **cuando** se guarda, **entonces** esa
   persona recibe el aviso de cancelación (si el negocio lo tiene activo) y los demás no reciben
   nada.
5. **Dado** que se agrega un paciente a una cita ya confirmada, **cuando** se guarda, **entonces**
   sólo la persona nueva recibe el email de confirmación.

---

### Historia 3 - Ver la sesión como una sola cita (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una cita de pareja, **cuando** se mira la agenda (día, semana, mes y lista) o el inicio
   del panel, **entonces** aparece un solo bloque con los nombres («Ana Torres y Carlos Pérez»;
   con tres, «Ana Torres y 2 más» si no caben).
2. **Dado** que esa hora ya tiene la sesión de pareja, **cuando** alguien intenta agendar otra cita
   a la misma hora en la misma agenda, **entonces** el sistema lo impide como hoy. La hora tampoco
   aparece libre en la página de reservas.
3. **Dado** el detalle de la cita, **cuando** se abre, **entonces** muestra a todos los pacientes,
   cada uno con acceso a su ficha (si el usuario puede verla).

---

### Historia 4 - Avisar por WhatsApp a cada uno (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** que se confirma una cita de pareja, **cuando** aparece el aviso «Avísale por WhatsApp»,
   **entonces** ofrece un botón por cada paciente con teléfono, cada uno con un mensaje que lo
   saluda por su nombre.
2. **Dado** un paciente sin teléfono, **cuando** se muestra el aviso, **entonces** su botón no
   aparece, como hoy pasa con el paciente principal.

---

### Historia 5 - Ficha, historia clínica y reportes de cada paciente (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** una sesión de pareja, **cuando** se abre la ficha de Carlos, **entonces** la sesión
   aparece en su historial de citas, igual que en la de Ana.
2. **Dado** la historia clínica, **cuando** la profesional escribe una evolución, **entonces** la
   escribe en la historia de cada paciente por separado. Nada se mezcla entre Ana y Carlos.
3. **Dado** los reportes del periodo, **cuando** se cuentan las citas, la ocupación y los ingresos,
   **entonces** la sesión cuenta una vez, con su precio una sola vez.
4. **Dado** los reportes de pacientes («los que más vienen», «los que más faltan», «pacientes
   nuevos o recurrentes» y «no volvieron»), **cuando** se calculan, **entonces** la sesión cuenta
   para cada paciente de la cita.

---

### Historia 6 - Un profesional que sólo ve a sus pacientes (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** un negocio donde cada profesional ve «sólo sus pacientes», **cuando** recepción agenda
   una sesión de pareja en la agenda de la psicóloga, **entonces** ella ve a los dos pacientes, con
   sus fichas e historias, como hoy ve al paciente principal.
2. **Dado** otro profesional del mismo negocio, **cuando** mira sus pacientes, **entonces** no ve a
   Ana ni a Carlos si no tienen citas en su agenda.

---

### Casos límite

- **Negocio sin habilitar:** el panel no ofrece la opción y el sistema rechaza cualquier intento de
  agregar pacientes a una cita.
- **Interruptor apagado con citas que ya tienen varios pacientes:** esas citas siguen como están, con
  avisos a todos. Sólo se pueden quitar pacientes, no agregar.
- **Cuarto paciente:** al llegar a 3 pacientes, la opción «Agregar otro paciente» desaparece y el
  sistema rechaza un cuarto.
- **Paciente sin email:** no recibe emails, como hoy. Los demás pacientes sí.
- **Mismo email en dos pacientes** (p. ej. un correo compartido por la pareja): sale un solo email
  por aviso a esa dirección, para no duplicar.
- **Paciente inactivo:** no se puede agregar a citas nuevas. Si ya estaba en una cita pasada, sigue
  apareciendo en ella.
- **Paciente repetido:** no se puede agregar a la misma persona dos veces ni como acompañante del
  paciente principal.
- **Cambiar al paciente principal** de una cita con varios: se puede, como hoy, y los demás se
  mantienen.
- **Cita completada o cancelada:** se pueden agregar o quitar pacientes para dejar registro, sin
  enviar emails.
- **Asistencia:** el estado de la cita (pendiente, confirmada, atendida, no asistió, cancelada) y
  la llegada son de la sesión entera, no de cada paciente.
- **Paciente eliminado:** si se borra un paciente que acompañaba una cita, deja de aparecer en ella
  y la cita sigue con los demás.
- **Topes de emails:** cada email a un paciente cuenta para el tope diario de emails a terceros,
  como hoy.
- **Pago por transferencia:** el precio y el enlace de pago son de la cita, uno solo para la sesión.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-000**: Cada negocio DEBE tener un interruptor «Citas con varios pacientes».
  - Viene apagado.
  - Sólo el super admin lo cambia, desde la ficha del negocio en su panel. El propietario y el
    equipo no lo ven en su configuración.
  - Cada cambio queda en el registro de auditoría.
- **RF-001**: En un negocio habilitado, una cita DEBE poder tener, además del paciente principal,
  otros pacientes del mismo negocio, hasta **3 en total**.
- **RF-001b**: En un negocio sin habilitar, el sistema DEBE rechazar agregar pacientes a una cita,
  también si se intenta sin pasar por el panel. Si el interruptor se apaga, las citas que ya tienen
  varios pacientes los conservan y siguen avisando a todos; sólo se pueden quitar pacientes.
- **RF-002**: Desde el formulario de cita del panel de un negocio habilitado DEBE poder agregarse y
  quitarse pacientes, eligiéndolos de la lista o creándolos ahí mismo con los datos obligatorios
  del negocio.
- **RF-003**: Cada email al paciente sobre la cita DEBE salir a cada paciente con email, por
  separado y con su propio saludo. Son los de solicitud, confirmación, cambio, reactivación,
  cancelación y recordatorio.
  - Ningún email muestra los datos de contacto de otro paciente.
  - Si dos pacientes comparten correo, sale uno solo.
- **RF-004**: La copia al profesional DEBE salir una sola vez por aviso y nombrar a todos los
  pacientes de la cita. Lo mismo vale para el aviso de cita nueva y para la agenda del día.
- **RF-005**: Agregar un paciente a una cita activa DEBE enviarle sólo a él el email
  correspondiente al estado de la cita. Quitarlo DEBE enviarle el aviso de cancelación, si el
  negocio lo tiene activo.
- **RF-006**: El recordatorio DEBE salir una sola vez a cada paciente de la cita.
- **RF-007**: La protección contra citas que se cruzan en la misma agenda DEBE mantenerse sin
  cambios. Una cita con varios pacientes ocupa su hora una sola vez, también en la página de
  reservas.
- **RF-008**: La agenda (día, semana, mes, lista), el inicio del panel y el detalle de la cita DEBEN
  mostrar a todos los pacientes de la cita.
- **RF-009**: El aviso de WhatsApp del panel DEBE ofrecer un botón por cada paciente con teléfono,
  con un mensaje que lo saluda por su nombre.
- **RF-010**: La ficha de cada paciente DEBE mostrar en su historial las citas en las que participa.
  La historia clínica sigue siendo individual.
- **RF-011**: En los reportes, la cita DEBE contar una vez para citas, estados, ocupación, ingresos,
  canales y mapa de calor. En los reportes por paciente («los que más vienen», «los que más
  faltan», «nuevos o recurrentes», «no volvieron») DEBE contar para cada paciente de la cita. El
  PDF del reporte sigue las mismas reglas.
- **RF-012**: Con el alcance «sólo sus pacientes», un profesional DEBE ver a todos los pacientes de
  las citas de su agenda (ficha e historia), igual que hoy ve al paciente principal.
- **RF-013**: Las citas que ya existen DEBEN seguir funcionando igual, con su único paciente.
- **RF-014**: La reserva online NO cambia en esta fase.
- **RF-015**: La beta DEBE ofrecer lo mismo: el interruptor en la ficha del negocio del super admin y,
  en el panel, agregar pacientes a la cita y verlos en la agenda, el detalle, la ficha, WhatsApp y
  los reportes. La beta no envía emails reales.
- **RF-016**: Cada alta, baja o cambio de pacientes de una cita DEBE quedar en el registro de
  actividad del negocio, sin datos de contacto.

### Entidades clave

- **Negocio**: tiene el permiso «Citas con varios pacientes» (sí/no), que sólo cambia el super
  admin.
- **Cita**: tiene un paciente principal y puede tener hasta 2 pacientes más. Su fecha, hora, servicio,
  profesional, precio, estado, llegada y pago son de la sesión entera.
- **Paciente de la cita**: la relación entre una cita y cada paciente adicional. Un paciente puede
  estar en muchas citas, y en cada una sólo una vez.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Agregar a un segundo paciente que ya existe a una cita toma menos de 30 segundos y a
  lo sumo 3 acciones desde el formulario.
- **CE-002**: En pruebas, el 100 % de los pacientes con email de una cita reciben cada aviso
  (confirmación, cambio, cancelación y recordatorio). Cada uno lo recibe exactamente una vez y con
  una sola copia al profesional.
- **CE-003**: En pruebas, el 0 % de las citas con varios pacientes cuenta doble en citas, ocupación
  o ingresos. El 100 % cuenta para cada paciente en los reportes por paciente.
- **CE-004**: Ningún intento de agendar otra cita a la misma hora en la misma agenda tiene éxito,
  ni desde el panel ni desde la página de reservas.
- **CE-005**: Después de la migración, todas las citas existentes conservan su paciente y se ven
  igual que antes.
- **CE-006**: Las pruebas automáticas del backend y del front pasan. El panel se usa sin
  desplazamiento horizontal a 390 px de ancho.
- **CE-007**: En un negocio sin habilitar, el 0 % de los intentos de agregar un segundo paciente
  tiene éxito, ni desde el panel ni por otro camino. En uno habilitado, ningún intento de agregar un
  cuarto paciente tiene éxito.

## Supuestos

- Los pacientes adicionales se tratan como el principal: cumplen los datos obligatorios del negocio
  y siguen la regla de la cédula única.
- El estado y la asistencia son de la sesión, no de cada paciente. Si en el futuro se necesita
  marcar que uno no vino, sería otra función.
- El precio de la cita es el de la sesión. No se reparte entre los pacientes.
- Fase 2, fuera de esta spec: un servicio «en pareja» cuya página de reservas pida los datos de la
  segunda persona.
