# Especificación: El paciente confirma o cancela su cita desde el email

**Carpeta**: `specs/010-paciente-confirma-cancela` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Implementada (2026-10-14)

**Repos**: agenda-backend (principal: la página de la cita por enlace, la ruta pública y los emails),
agenda-front (la página «Tu cita», la marca en la agenda, la configuración) y la beta.

## Pedido

El dueño del producto eligió, entre las ideas de mejora del 2026-10-14, que el paciente pueda
**confirmar que va o cancelar su cita desde el email**, para bajar las inasistencias.

**Decisiones del dueño del producto (2026-10-14):**
1. **«Confirmo que voy» es una marca aparte.** No cambia el estado de la cita: confirmarla sigue
   siendo decisión del negocio. En la agenda se ve «El paciente confirmó».
2. **Hasta cuándo se cancela lo decide cada negocio,** con el ajuste que ya existe en Configuración →
   Reservas: «Permitir cancelaciones» y «Antelación para cancelar» (24 h por defecto). Hasta hoy sólo
   se mostraba como texto de la política.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El paciente confirma que va (Prioridad: P1)

En el recordatorio, el paciente pulsa «Confirmo que voy» y el negocio lo ve en la agenda.

**Por qué esta prioridad**: es lo que más baja las inasistencias, y el negocio sabe a quién llamar.

**Prueba independiente**: pulsar el enlace del recordatorio y ver la marca en la ficha de la cita.

**Escenarios de aceptación**:

1. **Dado** el recordatorio de una cita, **entonces** lleva el botón «Confirmo que voy» y el enlace
   «Ver o cancelar mi cita».
2. **Dado** que el paciente pulsa «Confirmo que voy», **entonces** se abre la página «Tu cita» con
   «¡Gracias! Te esperamos el martes 20 de octubre a las 10:00» y la cita queda marcada.
3. **Dado** la agenda del negocio, **entonces** esa cita lleva la marca «Confirmó el paciente» en el
   bloque, en la lista del celular y en la ficha. Su estado no cambia.
4. **Dado** que lo pulsa otra vez, **entonces** la página dice que ya estaba confirmada, sin repetir
   nada.

---

### Historia 2 - El paciente cancela dentro del plazo (Prioridad: P1)

Si el negocio permite cancelaciones y aún falta más que la antelación que fijó, el paciente cancela
desde la página «Tu cita».

**Por qué esta prioridad**: libera la hora para otro paciente, en vez de una inasistencia.

**Prueba independiente**: cancelar una cita con tiempo y otra fuera de plazo.

**Escenarios de aceptación**:

1. **Dado** la página «Tu cita» con tiempo suficiente, **entonces** tiene «Cancelar mi cita» con la
   política del negocio. Pide confirmarlo («¿Seguro que quieres cancelar…?»).
2. **Dado** que cancela, **entonces**:
   - la cita pasa a Cancelada y la hora queda libre en la página de reservas;
   - el paciente recibe la cancelación de siempre (con copia al profesional);
   - la actividad y el aviso por ntfy dicen «cancelada por el paciente desde su email»;
   - la página ofrece «Elegir otra hora», que lleva a la página de reservas del negocio.
3. **Dado** que falta menos que la antelación del negocio, **entonces** no se puede cancelar desde la
   página: dice «Para cancelar con menos de 24 h, escríbele a {negocio}», con su WhatsApp o teléfono.
4. **Dado** un negocio con «Permitir cancelaciones» apagado, **entonces** no hay botón de cancelar,
   sólo el contacto del negocio.

---

### Historia 3 - El enlace está en los emails de la cita (Prioridad: P1)

Cada email al paciente sobre una cita activa lleva el enlace a «Tu cita».

**Escenarios de aceptación**:

1. **Dado** la solicitud de reserva, la confirmación, el cambio de fecha y el recordatorio,
   **entonces** llevan «Ver o cancelar mi cita» (y el recordatorio, además, «Confirmo que voy»).
2. **Dado** la copia al profesional de esos emails, **entonces** no lleva esos botones: son del
   paciente.
3. **Dado** una cita con datos de pago, **entonces** la página «Tu cita» también lleva al pago.

---

### Historia 4 - El negocio lo controla (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** Configuración → Reservas, **entonces** «Permitir cancelaciones» y «Antelación para
   cancelar» dicen que ahora también valen para cancelar desde el email.
2. **Dado** la ficha de la cita, **entonces** se ve cuándo confirmó el paciente.
3. **Dado** la lista de citas del día (Inicio), **entonces** se distingue quién confirmó y quién no,
   para llamar a los que no.

---

### Casos límite

- **Cita pasada, cancelada o completada:** la página lo dice («Esta cita ya pasó» / «fue cancelada»),
  sin botones.
- **El negocio cambia la fecha o la hora:** la confirmación del paciente se borra (confirmó otra hora)
  y el email del cambio lleva otra vez el enlace.
- **Sesión con varias personas:** cada una recibe su enlace y puede confirmar que va; cancelar la
  sesión entera sólo lo puede el paciente principal (quien la reservó o el primero de la cita). Las
  demás ven «Para no asistir, escríbele a {negocio}».
- **Cita «Por verificar» (spec 009):** el enlace va al correo escrito al reservar, como todos sus
  emails, y funciona igual.
- **Enlace reenviado o filtrado:** sólo muestra la fecha, la hora, el servicio, el profesional y el
  negocio; nada de la historia clínica ni datos de contacto. No permite cambiar nada más que
  confirmar o cancelar.
- **Negocio suspendido:** la página dice que no está disponible.
- **El paciente cancela y el negocio la vuelve a activar:** como hoy (spec 008, «vuelve a estar
  agendada»), y el paciente puede volver a confirmar.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Cada cita DEBE tener un enlace privado e imposible de adivinar a una página «Tu cita»,
  sin iniciar sesión. Puede ser el mismo enlace del pago, que ya existe.
- **RF-002**: La página DEBE mostrar la fecha, la hora, el servicio, el profesional, la modalidad, el
  negocio y su contacto. NO DEBE mostrar datos clínicos ni de otros pacientes.
- **RF-003**: «Confirmo que voy» DEBE dejar la cita marcada con la fecha y la hora de la confirmación,
  sin cambiar su estado. Hacerlo otra vez no cambia nada.
- **RF-004**: «Cancelar mi cita» DEBE estar sólo si el negocio permite cancelaciones y falta más que
  su antelación. Al cancelar, la cita pasa a Cancelada con los avisos de siempre (spec 008).
- **RF-005**: Fuera de plazo o sin cancelaciones, la página DEBE mostrar el contacto del negocio para
  avisarle.
- **RF-006**: Los emails al paciente sobre una cita activa DEBEN llevar «Ver o cancelar mi cita»; el
  recordatorio, además, «Confirmo que voy». La copia al profesional NO DEBE llevarlos.
- **RF-007**: La agenda (bloque, lista del celular y ficha) y la lista del día del Inicio DEBEN
  mostrar «Confirmó el paciente».
- **RF-008**: Cambiar la fecha, la hora o el profesional de una cita DEBE borrar la confirmación del
  paciente, y la actividad DEBE decirlo («Confirmó que va: Juan Pérez → Nadie», 2026-10-15).
- **RF-009**: La actividad DEBE registrar la confirmación y la cancelación como hechas «por el
  paciente desde su email», y el aviso de ntfy del cambio de estado (spec 008) DEBE decirlo.
- **RF-010**: Con varias personas en la cita, cada una DEBE poder confirmar; cancelar, sólo el
  paciente principal.
- **RF-011**: La página DEBE tener límite de peticiones por conexión y responder igual a un enlace
  que no existe que a uno caducado.
- **RF-012**: La beta DEBE tener lo mismo con sus datos de prueba: la página «Tu cita» desde la
  bandeja de emails simulada y la marca en la agenda.

### Entidades clave

- **Cita**: gana «confirmada por el paciente» (cuándo; vacío si no).
- **Página «Tu cita»**: pública, por el enlace privado de la cita.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Un paciente confirma o cancela en menos de 30 segundos desde el email, en el celular.
- **CE-002**: Ninguna cancelación desde el email se hace fuera del plazo del negocio (comprobado en
  pruebas).
- **CE-003**: El negocio ve en la agenda, sin abrir cada cita, quién confirmó.
- **CE-004**: Las pruebas pasan y la página se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- **Reprogramar** en esta versión es «cancelar y elegir otra hora» en la página de reservas. Cambiar
  la hora sin cancelar queda para más adelante.
- **El negocio no recibe un email aparte** por cada confirmación: la ve en la agenda. Por la
  cancelación ya recibe la copia del email y el aviso de ntfy.
- **La confirmación del paciente no avisa por ntfy:** serían demasiados avisos. La cancelación sí,
  como todo cambio de estado. Al celular del propietario sí le llega «El paciente confirmó» (spec 013,
  pedido por el dueño el 2026-10-15), y se puede apagar en Configuración.
