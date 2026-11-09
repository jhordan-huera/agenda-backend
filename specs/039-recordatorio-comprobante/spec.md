# Especificación: Recordatorios del comprobante de pago

**Carpeta**: `specs/039-recordatorio-comprobante` (rama de trabajo: `dev`) · **Creada**: 2026-11-09

**Estado**: Aprobada (2026-11-09, con el plan: «si aprobado»)

**Repos**:
- **agenda-backend:** el interruptor y el modo, el envío diario de los recordatorios, el email y los avisos del
  comprobante.
- **agenda-front:** el interruptor en /admin, el modo en la agenda del profesional y, en la cita, la marca «Sin
  comprobante» y el WhatsApp.
- **La beta:** el interruptor, el modo, la marca «Sin comprobante» y el WhatsApp, sin los emails.

## Pedido

El dueño del producto, el 2026-11-09: «el enlace para que los clientes suban el comprobante y se les recuerde
subir este comprobante; esto debe ser activado sólo por negocios que lo necesiten».

**Lo que ya existe:**
- **El enlace privado de pago de cada cita.** Muestra las cuentas de la agenda y deja subir la foto o el PDF
  del comprobante, sin iniciar sesión.
- **Dónde sale el enlace:**
  - en los emails de reserva, confirmación, cita reactivada y citas que se repiten;
  - en la pantalla final de la reserva online;
  - en el WhatsApp del panel;
  - en la ficha de la cita.
- **Cuándo sale:** en toda agenda con cuentas bancarias y en las citas con precio.
- **Al subir el comprobante:**
  - le llega un email al negocio, y también al profesional si recibe los avisos de sus citas;
  - sale un aviso en la campana;
  - el negocio marca la cita como pagada.

**Lo que falta:** recordárselo al paciente, el interruptor por negocio y verlo en el panel.

**Decisiones del dueño del producto (2026-11-09):**
1. **El interruptor:**
   - se llama «Pedir el comprobante de pago», va por negocio y empieza apagado;
   - **sólo lo activa el super admin,** desde la ficha del negocio en /admin;
   - el negocio no lo cambia.
2. **Los recordatorios:**
   - son **diarios** y van **por email** al paciente, con el enlace para subir el comprobante;
   - salen mientras la cita no tenga comprobante ni esté marcada como pagada, y no esté cancelada ni en «No
     asistió».
3. **Cada agenda elige el modo:**
   - **«Antes de la cita»:** para quien cobra por adelantado.
   - **«Después de la cita»:** para quien cobra después de atender.
   - El super admin pone el modo por defecto al activar el negocio, y el profesional lo cambia en su agenda.
4. **Como mucho 3 recordatorios por cita.** Después se detienen solos.
5. **El profesional también puede recordárselo por WhatsApp** desde la cita. El mensaje ya va escrito y lleva el
   enlace para subir el comprobante.
6. **Los recordatorios del pago no llevan copia al profesional.** Es una excepción a la regla de la constitución
   según la cual cada email al paciente sobre su cita sale con copia. Al profesional sólo se le avisa, por
   email y en la app, **cuando el paciente sube el comprobante**, para que lo verifique.
7. **En los negocios sin el interruptor,** el enlace sigue saliendo como hoy, sin recordatorios.

**Respuestas a las preguntas de la spec (2026-11-09):**
1. **La beta lo lleva,** sin los emails: el interruptor, el modo, la marca «Sin comprobante» y el WhatsApp.
2. **Los días del modo «Antes de la cita» los elige el super admin** en cada negocio, entre tres opciones:
   - **los 3 días anteriores a la cita** (por defecto);
   - **los 3 días siguientes a la reserva**;
   - **los 2 días anteriores y la mañana del mismo día**.
3. **En el modo «Después de la cita»** se recuerdan las citas «Completadas» y las «Confirmadas» que siguen sin
   cerrar después de su fecha.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El super admin activa el negocio (Prioridad: P1)

1. **Dado** la ficha de un negocio en /admin, **cuando** el super admin activa «Pedir el comprobante de pago»,
   **entonces**:
   - elige el modo por defecto, «Antes de la cita» o «Después de la cita»;
   - elige qué días salen en el modo «Antes de la cita»: los 3 días anteriores a la cita, los 3 días
     siguientes a la reserva, o los 2 días anteriores y la mañana del mismo día;
   - todas las agendas del negocio quedan con el modo por defecto;
   - el cambio queda en la actividad.
   Después puede cambiar los días del modo «Antes» cuando quiera, con su entrada en la actividad.
2. **Dado** el panel del negocio, **entonces** el propietario y su equipo no pueden activar ni desactivar el
   interruptor. Tampoco el super admin en modo soporte: lo hace desde /admin.
3. **Dado** que el super admin lo desactiva, **entonces**:
   - no sale ningún recordatorio más;
   - el enlace del comprobante sigue saliendo como hoy.

### Historia 2 - El paciente recibe el recordatorio y sube el comprobante (Prioridad: P1)

1. **Dado** una cita con precio, de una agenda con cuentas bancarias, de un negocio activado, sin comprobante y
   de un paciente con email, **entonces** el paciente recibe un recordatorio al día, a las 9:00 de la hora del
   negocio. El recordatorio lleva:
   - la cita;
   - el monto, si el precio se muestra;
   - las cuentas;
   - el botón «Enviar el comprobante».

   El texto es amable: un recordatorio, nunca una «deuda». Dice que, si ya lo envió por WhatsApp, puede ignorarlo.
2. **Dado** el modo «Antes de la cita», **entonces** los recordatorios salen los días que eligió el super admin
   para ese negocio:
   - **los 3 días anteriores a la cita:** con la cita el viernes, el martes, el miércoles y el jueves;
   - **los 3 días siguientes a la reserva:** con una reserva del lunes, el martes, el miércoles y el jueves;
   - **los 2 días anteriores y la mañana del mismo día:** el miércoles, el jueves y el viernes a las 9:00, sólo
     si la cita es más tarde.

   Nunca salen después de que empieza la cita, ni antes del día siguiente a la reserva. Si se reservó más cerca,
   salen menos.
3. **Dado** el modo «Después de la cita», **entonces**:
   - los recordatorios salen desde el día siguiente a la cita, uno por día;
   - se recuerdan las citas «Completadas» y las «Confirmadas» que siguen sin cerrar;
   - las «Por confirmar» no se recuerdan.
4. **Dado** que ya salieron 3 recordatorios de esa cita, **entonces** no sale ninguno más.
5. **Dado** que el paciente sube el comprobante, o el negocio marca la cita como pagada, la cancela o la marca
   «No asistió», **entonces** al día siguiente ya no sale ningún recordatorio de esa cita.
6. **Dado** un paciente con varias citas sin comprobante en el mismo negocio, **entonces** recibe **un solo
   email al día** con todas ellas, cada una con su botón. Por ejemplo, con citas que se repiten.
7. **Dado** los recordatorios, **entonces** no llevan copia al profesional y quedan en el historial de emails
   del negocio, no en la actividad.

### Historia 3 - El profesional elige el modo de su agenda (Prioridad: P2)

1. **Dado** un negocio activado, **entonces** se puede cambiar el modo de una agenda entre «Antes de la cita» y
   «Después de la cita»:
   - en el plan Pro, en «Tu agenda»;
   - en el plan Business, el propietario en Profesionales;
   - el rol Profesional, en su Perfil, como el interruptor del calendario de la spec 027.

   El cambio queda en la actividad y vale desde el día siguiente.
2. **Dado** un negocio sin activar, **entonces** el modo no se ve en ningún sitio.

### Historia 4 - El profesional ve lo pendiente y lo recuerda por WhatsApp (Prioridad: P2)

1. **Dado** una cita de un negocio activado, con precio y sin comprobante ni pago, **entonces** lleva la marca
   **«Sin comprobante»** en la agenda, el tablero y su ficha. La agenda tiene un filtro para ver sólo esas citas.
2. **Dado** esa cita, **cuando** el profesional toca **«Recordar el pago por WhatsApp»**, **entonces** se abre
   WhatsApp con el paciente y con un mensaje amable ya escrito, que lleva el enlace para subir el comprobante.
   Ese WhatsApp no cuenta en el tope de 3 recordatorios.
3. **Dado** que el paciente sube el comprobante, **entonces**:
   - el profesional de la agenda recibe el email «Recibiste un comprobante de pago», aunque no tenga activados
     los avisos de sus citas;
   - recibe el aviso en la app: en la campana y, si los tiene activados, en el celular;
   - el negocio lo sigue recibiendo como hoy.

### Casos límite

- **Paciente sin email:** no recibe recordatorios. El profesional puede usar el WhatsApp.
- **Cita en pareja o en familia:** sólo se le recuerda al paciente principal, que es quien recibe los datos de
  pago.
- **Agenda sin cuentas bancarias o cita gratis:** nada.
- **Una cita que cambia de fecha:** cuenta la fecha nueva, y los recordatorios ya enviados siguen contando para
  el tope de 3.
- **El cupo diario de Gmail:** los recordatorios son emails al paciente y respetan sus reservas del cupo. Si un
  día no caben, esperan al día siguiente.
- **El modo soporte:** el super admin, como propietario, puede cambiar el modo de una agenda. El interruptor sólo
  se cambia desde /admin.

## Requisitos *(obligatorio)*

- **RF-001**: Cada negocio DEBE tener el interruptor «Pedir el comprobante de pago», apagado al principio, que sólo el super admin cambia desde /admin. Al activarlo, el super admin elige el modo por defecto y los días del modo «Antes de la cita», y los días los puede cambiar después.
- **RF-002**: Cada agenda de un negocio activado DEBE tener un modo, «Antes de la cita» o «Después de la cita». Lo cambian las mismas personas que el interruptor del calendario de la spec 027.
- **RF-003**: El paciente principal de una cita con precio, de una agenda con cuentas, sin comprobante ni pago, que no esté cancelada ni en «No asistió», DEBE recibir un recordatorio por email al día, a las 9:00 de la hora del negocio, según el modo, y como mucho 3 por cita.
- **RF-004**: Un paciente DEBE recibir como mucho un email de recordatorio de pago al día por negocio, con todas sus citas pendientes de comprobante.
- **RF-005**: Los recordatorios NO DEBEN llevar copia al profesional. Al subirse el comprobante, el profesional de la agenda DEBE recibir el email y el aviso en la app, además del negocio, como hoy.
- **RF-006**: En un negocio activado, la cita sin comprobante DEBE verse con la marca «Sin comprobante», con un filtro en la agenda y con el botón «Recordar el pago por WhatsApp», que lleva el enlace.
- **RF-007**: Activar o desactivar el interruptor y cambiar el modo DEBEN quedar en la actividad. Cada recordatorio enviado DEBE quedar en el historial de emails.
- **RF-008**: Los negocios sin el interruptor DEBEN seguir exactamente como hoy.
- **RF-009**: La constitución DEBE recoger la decisión y la excepción a la copia al profesional.
- **RF-010**: La beta DEBE llevar el interruptor, el modo, la marca «Sin comprobante» y el WhatsApp, sin los emails.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - el interruptor: sólo el super admin, con la actividad;
  - el modo por agenda;
  - un recordatorio por día;
  - el tope de 3;
  - que se detienen al subir el comprobante, al marcar la cita como pagada, al cancelarla o con «No asistió»;
  - un email por paciente y día con varias citas;
  - sin copia al profesional;
  - el aviso al profesional al subir el comprobante;
  - los negocios sin activar, sin cambios.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint, `check:contrast` y `check:data-export` en el front, sin errores.
- **CE-003**: El recorrido funciona en el computador y en el celular:
  - el super admin activa el negocio;
  - el profesional cambia el modo;
  - la cita con «Sin comprobante» y su filtro;
  - el WhatsApp con el enlace.
- **CE-004**: Una prueba real con el buzón de pruebas: el email del recordatorio llega, se lee bien en el celular y el botón abre la página para subir el comprobante.

## Supuestos

- **El envío lo hace el cron de GitHub,** una vez al día por negocio después de las 9:00 de su hora. No gasta CPU
  de Vercel.
- **El enlace es el mismo de siempre:** la página de pago de la cita no cambia.
- **Los avisos por ntfy y en el celular** siguen sus reglas actuales. El recordatorio de pago no avisa a nadie
  por ntfy.
- **Hay una migración** para el interruptor, el modo y la cuenta de los recordatorios enviados. Los negocios
  siguen sin ver planes ni precios.
