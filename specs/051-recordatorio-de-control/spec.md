# Especificación: Recordatorio de control

**Carpeta**: `specs/051-recordatorio-de-control` (rama de trabajo: `dev`) · **Creada**: 2026-11-15

**Estado**: Aprobada el 2026-11-15 («apruebo», con las decisiones recomendadas). Sólo en `dev`, para probarla esta semana: no se abre el
PR a `main` hasta que él lo pida.

**Repos**:
- **agenda-backend:** el «Volver en» del servicio, los controles, el envío diario, el email, la página para no recibir
  más y lo que ve el panel.
- **agenda-front:** el campo del servicio, la hoja «Controles» en la Agenda, la ficha del paciente, el interruptor, la
  página de reservas con el servicio ya elegido y la página para no recibir más.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-15, después de preguntar qué le falta al sistema y de ver la recomendación (empezar
por el recordatorio de control y después los paquetes de sesiones):

> hagamos esto por favor solo en dev dejemos para probar esta semana

**Lo que ya existe:**
- **Reportes tiene «Pacientes que no volvieron»,** con el WhatsApp, pero el equipo tiene que acordarse de mirarlo.
- **El cron ya envía emails a una hora del negocio:** los recordatorios, el resumen de la noche, el informe mensual y
  la encuesta (spec 048).
- **La Agenda tiene la hoja «Lista de espera»** (spec 047), con el WhatsApp ya escrito y «Agendar».
- **La página de reservas** ya abre con una hora elegida desde el email de la lista de espera.

**Para qué sirve:** que el paciente vuelva cuando le toca (la limpieza cada 6 meses, el seguimiento en psicología, el
control en fisioterapia) sin que el consultorio tenga que acordarse. Recupera pacientes que el consultorio ya tiene.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El consultorio ve a quién le toca volver (Prioridad: P1)

**Por qué esta prioridad:** sirve desde el primer día, aunque el email automático esté apagado: el equipo ve a quién
llamar y le escribe por WhatsApp.

**Prueba independiente:** el servicio «Limpieza dental» vuelve en 6 meses. Una paciente tuvo su limpieza Atendida
hace 6 meses y una semana y no tiene ninguna cita por delante: sale en «Controles» como vencida, y con «Agendar» se abre
su cita nueva.

1. **Dado** un servicio con «Volver en», **entonces** cada paciente con una cita Atendida de ese servicio tiene un
   **control**: la fecha de esa cita más el tiempo del servicio. Cuenta la última cita Atendida de ese servicio.
2. **Dado** la Agenda, **entonces** junto a «Lista de espera» está **«Controles»**, una hoja con dos grupos:
   - **Vencidos:** los que ya pasaron su fecha, del más antiguo al más reciente;
   - **Próximos 30 días:** los que vencen pronto.

   Cada fila muestra el paciente, el servicio, el profesional, la fecha del control («hace 2 semanas», «en 5 días») y,
   si se le escribió, cuándo.
3. **Dado** un control, **entonces** tiene tres acciones:
   - **«WhatsApp»,** con el mensaje ya escrito y el enlace a la página de reservas. Se envía a mano, como lo demás;
   - **«Agendar»,** que abre la cita nueva con el paciente, el servicio y el profesional ya elegidos;
   - **«Quitar»,** que lo saca de la lista esta vez y no se le escribe. Queda en la actividad.
4. **Dado** un paciente con una cita por delante en el negocio (Pendiente o Confirmada, de cualquier servicio),
   **entonces** su control no sale en la lista: ya va a venir.
5. **Dado** la ficha de un paciente, **entonces** se ve su próximo control: **«Próximo control: Limpieza dental, 12 de
   mayo»**, o **«Control vencido hace 2 semanas»**.
6. **Dado** el rol Profesional, **entonces** ve sólo los controles de su agenda. El propietario, los administradores y
   Recepción ven todos.

### Historia 2 - Al paciente le llega el aviso (Prioridad: P1)

**Por qué esta prioridad:** es lo que hace que el paciente vuelva sin que nadie tenga que acordarse.

**Prueba independiente:** con el interruptor encendido, el día que vence el control, a las 10:00, a la paciente le
llega «Te toca tu control». Toca «Reservar mi control» y la página de reservas abre con «Limpieza dental» elegida.

1. **Dado** un negocio con el interruptor **«Recordar a los pacientes cuando les toca volver»** encendido,
   **entonces** desde las 10:00 de la hora del negocio del día que vence el control, el paciente recibe el email
   **«Te toca tu control de [servicio]»**, si:
   - tiene email y no pidió dejar de recibirlos;
   - no tiene una cita por delante en el negocio;
   - el control no se quitó.
2. **Dado** el email, **entonces** trae:
   - el saludo con su nombre de pila;
   - el servicio, con quién fue y hace cuánto («Hace 6 meses fue tu Limpieza dental con la Dra. Cruz»);
   - el botón **«Reservar mi control»,** que abre la página de reservas con el servicio ya elegido, y el profesional si
     sigue atendiendo ese servicio y el negocio deja elegirlo;
   - el enlace **«No quiero recibir estos recordatorios».**
3. **Dado** un control, **entonces** se le escribe **una sola vez**. Si el día que vence tiene una cita por delante,
   no se le escribe; si la cancela, se le escribe después, hasta 30 días después del vencimiento.
4. **Dado** «No quiero recibir estos recordatorios», **entonces** el paciente deja de recibirlos en ese negocio, sin
   iniciar sesión, y la página se lo confirma. Queda en la actividad. Sus controles siguen saliendo en el panel.
5. **Dado** que el paciente reserva (por la página o porque lo agenda el equipo), **entonces** su control sale de la
   lista y no se le escribe.

### Historia 3 - El negocio lo configura (Prioridad: P2)

**Prueba independiente:** con «Volver en: No» no hay controles; al ponerle 6 meses al servicio salen los de sus
pacientes. Con el interruptor apagado no sale ningún email.

1. **Dado** el formulario de un servicio, **entonces** tiene **«Volver en»**: No (por defecto), 1 semana, 2 semanas,
   1 mes, 2 meses, 3 meses, 6 meses o 1 año. El cambio queda en la actividad, como el resto del servicio.
2. **Dado** Configuración → Notificaciones, **entonces** el propietario enciende o apaga el interruptor. Empieza
   apagado y el cambio queda en la actividad.
3. **Dado** que se enciende, o que se le pone «Volver en» a un servicio, **entonces** no se le escribe a nadie por
   controles que ya habían vencido: esos salen en la lista para el WhatsApp, pero el email sólo sale por los que
   vencen desde ese día.
4. **Dado** que se pone «Volver en: No» o se desactiva el servicio, **entonces** sus controles salen de la lista y
   ya no se escribe por ellos.

### Casos límite

- **Dos controles el mismo día para el mismo paciente** (dos servicios): un solo email, con los dos.
- **Cita en pareja o en familia:** el control es sólo del paciente principal, como la encuesta.
- **La cita Atendida no se corrige** (spec 020): el control no cambia por eso.
- **Paciente sin email:** su control sale en la lista, para el WhatsApp, pero no recibe email.
- **Paciente desactivado o borrado:** no tiene controles. Al borrarlo, se borran con él.
- **El profesional ya no atiende ese servicio o está inactivo:** el control sigue, y el botón del email abre la
  reserva sólo con el servicio.
- **Negocio suspendido:** no sale ningún email.
- **Sin cupo de Gmail:** el email espera en la cola y sale después, como los demás emails al paciente.
- **Privacidad:**
  - el email dice sólo el servicio, el profesional y la fecha: nada de la historia clínica;
  - ntfy, la campana y el celular no reciben nada de los controles;
  - los registros del cron llevan sólo las cifras.

## Requisitos *(obligatorio)*

- **RF-001**: Cada servicio DEBE tener «Volver en» con las opciones No, 1 semana, 2 semanas, 1 mes, 2 meses, 3 meses, 6 meses y 1 año, «No» por defecto. El cambio DEBE quedar en la actividad.
- **RF-002**: Cada paciente activo con una cita Atendida de un servicio con «Volver en» DEBE tener un control con la fecha de su última cita Atendida de ese servicio más ese tiempo. Sólo el paciente principal de la cita.
- **RF-003**: La Agenda DEBE tener la hoja «Controles» con los vencidos y los de los próximos 30 días, sin los pacientes que tienen una cita por delante (Pendiente o Confirmada) ni los controles quitados, con el WhatsApp ya escrito, «Agendar» y «Quitar».
- **RF-004**: «Quitar» DEBE sacar el control de la lista y del envío, y quedar en la actividad. Un control nuevo (de una cita Atendida posterior) vuelve a salir.
- **RF-005**: El rol Profesional DEBE ver sólo los controles de su agenda. La API DEBE aplicar la misma regla.
- **RF-006**: La ficha del paciente DEBE mostrar su próximo control o cuánto hace que venció.
- **RF-007**: Cada negocio DEBE tener el interruptor «Recordar a los pacientes cuando les toca volver» en Configuración → Notificaciones, apagado al principio, que cambia el propietario. El cambio DEBE quedar en la actividad.
- **RF-008**: Con el interruptor encendido, el paciente DEBE recibir el email desde las 10:00 de la hora del negocio, desde el día que vence el control y hasta 30 días después, una sola vez, si tiene email, no pidió dejar de recibirlos, no tiene una cita por delante y el control no se quitó. Dos controles del mismo día DEBEN ir en un solo email.
- **RF-009**: NO DEBE salir ningún email por un control que ya había vencido antes de encender el interruptor o de ponerle «Volver en» al servicio.
- **RF-010**: El email DEBE traer el servicio, con quién y hace cuánto fue, «Reservar mi control» con el servicio (y el profesional, si sigue disponible) ya elegido en la página de reservas, y «No quiero recibir estos recordatorios». NO DEBE llevar copia al profesional.
- **RF-011**: «No quiero recibir estos recordatorios» DEBE funcionar sin iniciar sesión, por negocio, y quedar en la actividad. Los envíos automáticos NO DEBEN ir a la actividad.
- **RF-012**: Con el interruptor apagado y sin «Volver en» en ningún servicio, todo DEBE seguir como hoy.
- **RF-013**: La constitución DEBE recoger la decisión y la excepción a la copia al profesional (en los dos repos).

### Entidades

- **«Volver en»:** el tiempo después del cual le toca volver al paciente, por servicio.
- **Control:** del paciente y un servicio, con su profesional, la cita de la que sale, la fecha en que vence, si se le
  escribió y cuándo, y si se quitó.
- **«No quiero recibir estos recordatorios»:** una marca en el paciente, por negocio.
- **El interruptor:** uno por negocio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - la fecha del control, la última cita Atendida y el paciente principal;
  - que no sale quien tiene una cita por delante, el control quitado, el paciente desactivado ni el servicio sin
    «Volver en»;
  - el email: el interruptor, las 10:00, una sola vez, los 30 días, nada por lo ya vencido al encenderlo, dos controles
    en un email, sin copia al profesional y la marca para no recibirlos;
  - quién ve los controles y que la API rechaza al resto;
  - la actividad y el borrado con el paciente.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y todas las `check:*` en el front, sin errores.
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px, sin desplazamiento horizontal): el campo
  del servicio, la hoja «Controles», «Agendar», la ficha, el interruptor, la página de reservas con el servicio elegido
  y la página para no recibir más.
- **CE-004**: Desde la Agenda, el equipo sabe a quién le toca volver y le escribe por WhatsApp en menos de 30
  segundos por paciente.
- **CE-005**: Una prueba en local: el email llega a una dirección de prueba, se lee bien en el celular y el botón abre
  la reserva con el servicio elegido.

## Supuestos

- **Se prueba en local** (`dev:local`, con la base local). Con la base de producción se escribiría a pacientes reales:
  no se prueba así.
- **El envío lo hace el cron,** como la encuesta. Como sólo está en `dev`, en producción no sale nada hasta publicarla.
- **El remitente es el de siempre,** con el nombre del negocio, y el email va en el nivel «paciente» del cupo de Gmail.
- **«Volver en» cuenta en días** (1 mes = 30 días, 1 año = 365).
- **Hay una migración** (la 058) para «Volver en», los controles, el interruptor y la marca para no recibirlos. La
  aplica el dueño del producto.

## Fuera de alcance

- **El WhatsApp automático** (descartado): el WhatsApp sigue siendo a mano.
- **El informe mensual, la descarga de datos, la campana y los avisos al celular.**
- **Los controles de las otras personas de una sesión en pareja.**
- **Los paquetes de sesiones** (vendrán después) y la **factura del SRI.**
- **La beta.**

## Decisiones para aprobar

Lo recomendado, que se aplica si el dueño aprueba la spec así:
1. **«Volver en» va en cada servicio,** con una lista fija de tiempos.
2. **Cualquier cita por delante cuenta como agendado,** aunque sea de otro servicio.
3. **El email sale una sola vez por control,** desde el día que vence y hasta 30 días después, y nunca por lo que ya
   había vencido al encenderlo.
4. **La lista del panel funciona aunque el email esté apagado.**
5. **Sin copia al profesional,** como la encuesta y la lista de espera.
