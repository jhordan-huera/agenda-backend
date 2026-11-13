# Especificación: Lista de espera

**Carpeta**: `specs/047-lista-de-espera` (rama de trabajo: `dev`) · **Creada**: 2026-11-12

**Estado**: Publicada (2026-11-12, PR backend #76 y front #61). Aprobada el 2026-11-12, «apruebo con las recomendaciones»

**Repos**:
- **agenda-backend:** la lista, el aviso cuando se libera una hora, los emails, la campana y el interruptor.
- **agenda-front:** la página de reservas, la lista en el panel y el interruptor en Configuración.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-12, después de ver las mejoras que Claude propuso dentro de la app:

> me gust la 1, 2, 5 hagamos esos 3 cambios

Esta es la 2. La 1 (lo que debe cada paciente) es la spec 046 y la 5 (la encuesta después de la cita), la 048.

**Lo que ya existe:**
- **La página de reservas** va por pasos: el servicio, el profesional (si el negocio deja elegirlo), la fecha y la
  hora, los datos y la confirmación. Respeta la anticipación mínima de cada agenda, los días hacia adelante y el tope
  de reservas por persona y día, y tiene CAPTCHA.
- **Las cancelaciones:** el paciente cancela desde «Tu cita» si el negocio lo permite, y el equipo cancela o cambia
  la hora desde el panel.
- **Lo automático** lo hace el cron de GitHub cada 10 minutos, y los emails al paciente respetan el cupo diario de
  Gmail.

**Lo que falta:**
- **Cuando ninguna hora le sirve al paciente, se va** y el negocio no se entera.
- **La hora que se libera al cancelar queda vacía:** nadie avisa a quien la habría querido.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El paciente se anota en la lista de espera (Prioridad: P1)

**Por qué esta prioridad:** sin gente en la lista no hay a quién avisar.

**Prueba independiente:** en un negocio con la lista encendida, un paciente se anota desde la página de reservas,
recibe el email «Te anotamos» y aparece en la lista del panel.

1. **Dado** la página de reservas de un negocio con la lista encendida (respuesta 3), **cuando** el paciente está en
   el paso de la fecha y la hora, **entonces** ve «¿No encuentras una hora que te sirva? Anótate en la lista de
   espera».
2. **Dado** ese enlace, **entonces** el paciente elige:
   - los días de la semana que le sirven;
   - la parte del día: mañana (antes de las 12:00), tarde (de 12:00 a 18:00) o noche (desde las 18:00), una o
     varias;
   - hasta qué fecha espera: 30 días por defecto y como mucho los días hacia adelante del negocio;
   - el profesional, si el negocio deja elegirlo, o «Cualquiera».

   Escribe su nombre, su email y su teléfono, y pasa el CAPTCHA. El servicio es el que ya eligió.
3. **Dado** que se anota, **entonces**:
   - ve «Listo, te avisaremos por email si se libera una hora que te sirva»;
   - recibe el email «Te anotamos en la lista de espera», con lo que pidió y el enlace para salir de la lista;
   - la campana del panel avisa al negocio.
4. **Dado** que ya estaba anotado con el mismo email para el mismo servicio y profesional, **entonces** se
   actualiza lo que pidió; no se repite.
5. **Dado** el enlace «Salir de la lista» del email, **cuando** lo toca, **entonces** sale de la lista al momento,
   sin iniciar sesión.

### Historia 2 - Se libera una hora y se avisa a quien espera (Prioridad: P1)

**Por qué esta prioridad:** es lo que llena la agenda. Una hora cancelada vuelve a tener paciente.

**Prueba independiente:** con un paciente anotado para los martes por la mañana, se cancela una cita de un martes a
las 10:00. En menos de 15 minutos le llega el email con esa hora, y al tocar «Reservar esta hora» reserva.

1. **Dado** que se cancela una cita o se cambia de hora, **entonces** la hora que queda libre se ofrece a quien
   espera si:
   - todavía se puede reservar online: más allá de la anticipación mínima y dentro de los días hacia adelante;
   - el servicio que espera la persona cabe en ese hueco;
   - el día, la parte del día y la fecha encajan con lo que pidió;
   - es de su profesional, o pidió «Cualquiera».
2. **Dado** esa hora, **entonces** en menos de 15 minutos les llega un email «Se liberó una hora» a todos los que la
   esperan (respuesta 1). El email trae la hora, el servicio, el profesional y el botón **«Reservar esta hora»**.
3. **Dado** el botón, **cuando** lo toca, **entonces** se abre la página de reservas con esa hora ya elegida y sus
   datos ya escritos. Reserva como cualquier reserva online: la cita nace Pendiente.
4. **Dado** que otro reservó primero, **entonces** la página dice «Esa hora ya se tomó» y le muestra las otras horas
   libres. La persona sigue en la lista.
5. **Dado** que se liberan varias horas para la misma persona a la vez, **entonces** van en el mismo email, y nunca
   le llegan más de 3 emails al día.
6. **Dado** que la persona reserva una cita en ese negocio (desde el email o no), **entonces** sale de la lista.
7. **Dado** que pasa la fecha hasta la que esperaba, **entonces** sale de la lista sin aviso.
8. **Dado** un día sin cupo de Gmail, **entonces** el aviso de la hora libre no se envía después: una hora vieja ya no
   sirve. La campana del panel sí avisa al negocio.

### Historia 3 - El negocio ve y maneja la lista (Prioridad: P2)

**Por qué esta prioridad:** hay horas que se liberan con poco tiempo y gente que llama por teléfono. Ahí el equipo
llama él.

**Prueba independiente:** en el panel se ve la lista de espera de la agenda, se anota a alguien por teléfono, se le
escribe por WhatsApp y se agenda; al agendarla sale de la lista.

1. **Dado** la Agenda del panel, **entonces** el botón **«Lista de espera»** dice cuántas personas esperan y abre la
   lista: nombre, contacto, servicio, profesional, lo que pidió y desde cuándo espera. Se filtra por profesional.
2. **Dado** una persona de la lista, **entonces** el equipo puede:
   - **escribirle por WhatsApp,** con un mensaje ya escrito para ofrecerle una hora;
   - **«Agendar»:** abre la cita nueva con sus datos. Al guardarla, sale de la lista;
   - **«Quitar»:** sale de la lista.
3. **Dado** que alguien llama por teléfono, **cuando** el equipo toca **«Anotar»** (respuesta 2), **entonces** llena
   lo mismo que la página de reservas. El email es opcional: sin email no le llegan emails y el equipo le avisa por
   WhatsApp.
4. **Dado** que se libera una hora con gente esperando, **entonces** la campana avisa: «Se liberó el martes 10:00:
   2 personas en la lista de espera», con el enlace a la lista. Así el equipo puede llamar a quien no tiene email o
   cuando la hora ya no se puede reservar online.
5. **Dado** el rol Profesional, **entonces** ve y maneja sólo la lista de su agenda.

### Historia 4 - El negocio la enciende (Prioridad: P2)

**Prueba independiente:** con la lista apagada, la página de reservas no muestra el enlace; al encenderla, aparece.

1. **Dado** Configuración → Agenda, **entonces** el propietario y los administradores encienden o apagan **«Lista de
   espera»** (respuesta 3). Empieza apagada y el cambio queda en la actividad.
2. **Dado** que se apaga, **entonces** el enlace desaparece de la página de reservas y no sale ningún email más. La
   lista se sigue viendo en el panel.

### Casos límite

- **Una hora que se libera con menos tiempo que la anticipación mínima:** no se envía email, porque no se podría
  reservar online. La campana sí avisa al negocio.
- **Una serie cancelada** (varias citas a la vez): cada persona recibe un solo email con las horas que le sirven.
- **Un servicio para 2 o 3 personas:** la reserva desde el email pide los datos de cada una, como siempre.
- **El cupo de citas del plan:** la reserva desde el email lo respeta como cualquier otra.
- **El tope de reservas por persona y día:** se respeta igual.
- **Negocio suspendido:** no se anota nadie y no sale ningún email.
- **Un profesional desactivado o un servicio borrado:** sus personas salen de la lista.
- **Abuso:** el CAPTCHA y el mismo límite de peticiones que la reserva online.
- **Privacidad:** la página pública no muestra quién más espera ni cuántos.

## Requisitos *(obligatorio)*

- **RF-001**: Cada negocio DEBE tener el interruptor «Lista de espera» en Configuración → Agenda, apagado al principio (respuesta 3). Encenderlo o apagarlo DEBE quedar en la actividad.
- **RF-002**: Con el interruptor encendido, la página de reservas DEBE ofrecer anotarse en el paso de la fecha y la hora, con los días, la parte del día, la fecha hasta la que espera, el profesional o «Cualquiera», nombre, email y teléfono, y el CAPTCHA.
- **RF-003**: Al anotarse, la persona DEBE recibir el email «Te anotamos», con el enlace para salir de la lista sin iniciar sesión. El mismo email para el mismo servicio y profesional DEBE actualizar lo que pidió, no repetirlo.
- **RF-004**: Cuando una cita se cancela o cambia de hora, la hora libre DEBE ofrecerse por email, en menos de 15 minutos, a todas las personas de la lista con las que encaja (respuesta 1), si todavía se puede reservar online y el servicio cabe.
- **RF-005**: El email DEBE llevar «Reservar esta hora», que abre la página de reservas con la hora elegida y los datos escritos. Si la hora ya se tomó, la página DEBE decirlo y mostrar las otras horas libres.
- **RF-006**: Una persona NO DEBE recibir más de 3 emails de horas libres al día. Varias horas a la vez DEBEN ir en el mismo email. Sin cupo de Gmail, el aviso no se envía después.
- **RF-007**: La persona DEBE salir de la lista al reservar en ese negocio, al pasar su fecha, con el enlace del email o cuando el equipo la quita o la agenda.
- **RF-008**: El panel DEBE mostrar la lista de espera de cada agenda, con WhatsApp ya escrito, «Agendar», «Quitar» y «Anotar» (respuesta 2). El rol Profesional, sólo la de su agenda.
- **RF-009**: La campana DEBE avisar cuando alguien se anota y cuando se libera una hora con gente esperando, a quienes hoy reciben las reservas online de esa agenda.
- **RF-010**: Anotarse, salir, agendar desde la lista, quitar y anotar desde el panel DEBEN quedar en la actividad. Los envíos automáticos, no.
- **RF-011**: Los emails de la lista de espera NO DEBEN llevar copia al profesional: no son de una cita. La cita que se reserva después sigue las reglas de siempre.
- **RF-012**: Las personas de la lista DEBEN entrar en la descarga de datos del negocio y borrarse solas 30 días después de salir de la lista.
- **RF-013**: Con el interruptor apagado, todo DEBE seguir como hoy.
- **RF-014**: La constitución DEBE recoger la decisión y la excepción a la copia al profesional (1.46.0, en los dos repos).

### Entidades

- **Persona en espera:** el negocio, el servicio, el profesional o «Cualquiera», los días, la parte del día, la
  fecha hasta la que espera, nombre, email y teléfono, desde cuándo espera, quién la anotó (ella o el equipo),
  cuántos emails recibió hoy y cuándo salió de la lista y por qué.
- **El interruptor «Lista de espera»:** uno por negocio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - anotarse con el interruptor encendido, y nada con él apagado;
  - qué hora se ofrece y a quién: días, parte del día, fecha, profesional, que quepa el servicio y la anticipación
    mínima;
  - todos a la vez, el tope de 3 emails al día y varias horas en un email;
  - que la hora ya tomada no se reserva dos veces;
  - salir de la lista al reservar, al pasar la fecha, con el enlace y desde el panel;
  - el rol Profesional, sólo su agenda;
  - la actividad, sin copia al profesional, la descarga de datos y el borrado a los 30 días.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y todas las `check:*` en el front, sin errores
  (también en GitHub, en «Comprobar»).
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px, sin desplazamiento horizontal): anotarse
  en la página de reservas, el email, reservar desde el email, «Esa hora ya se tomó» y la lista del panel.
- **CE-004**: Una prueba real: al cancelar una cita en local, el email de la hora libre llega en menos de 15 minutos,
  se lee bien en el celular y el botón lleva a la reserva con la hora elegida.

## Supuestos

- **El aviso lo envía el cron de GitHub,** que corre cada 10 minutos. No gasta CPU de Vercel.
- **Sólo las cancelaciones y los cambios de hora** liberan horas para la lista. Un horario nuevo o un bloqueo que se
  quita no avisan a nadie.
- **Sin ntfy ni avisos en el celular** para la lista: sólo la campana.
- **Hay una migración** para la lista y el interruptor.

## Respuestas del dueño del producto (2026-11-12)

«apruebo con las recomendaciones»:
1. **Cómo se avisa:** a todos los que esperan esa hora a la vez; la toma el primero que reserva.
2. **Quién anota:** el paciente desde la página de reservas y el equipo desde el panel.
3. **Quién la enciende:** cada negocio, en Configuración → Agenda. Empieza apagada.
