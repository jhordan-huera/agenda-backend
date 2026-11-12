# Especificación: Encuesta después de la cita

**Carpeta**: `specs/048-encuesta-despues-de-la-cita` (rama de trabajo: `dev`) · **Creada**: 2026-11-12

**Estado**: Implementada (2026-11-12). Aprobada el 2026-11-12, «apruebo con las recomendaciones»

**Repos**:
- **agenda-backend:** las encuestas, su envío diario, el email, la respuesta, la campana, Reportes y el informe
  mensual.
- **agenda-front:** la página de la encuesta, Reportes, la ficha del paciente y el interruptor en Configuración.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-12, después de ver las mejoras que Claude propuso dentro de la app:

> me gust la 1, 2, 5 hagamos esos 3 cambios

Esta es la 5. La 1 (lo que debe cada paciente) es la spec 046 y la 2 (la lista de espera), la 047.

**Lo que ya existe:**
- **No hay encuestas ni opiniones de pacientes.** El negocio no sabe cómo le fue al paciente salvo que se lo diga.
- **El cron de GitHub ya envía emails a una hora del negocio:** los recordatorios, el resumen de las 8 de la noche y el
  informe mensual (spec 040).
- **Los enlaces privados del paciente** («Tu cita», el pago) funcionan sin iniciar sesión y caducan.
- **Reportes** se ve por periodo y por profesional.

**Para qué sirve:** que el profesional sepa cómo les va a sus pacientes y pueda llamar a quien tuvo una mala
experiencia antes de perderlo. Son opiniones reales y privadas: no se publican en ningún lado.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El paciente dice cómo le fue (Prioridad: P1)

**Por qué esta prioridad:** sin respuestas no hay nada que ver.

**Prueba independiente:** en un negocio con la encuesta encendida, se marca una cita como Atendida. Al día siguiente a
las 10:00 el paciente recibe el email, toca 4 estrellas, escribe un comentario y lo envía.

1. **Dado** una cita Atendida de un negocio con la encuesta encendida (respuesta 2), **entonces** al día siguiente,
   desde las 10:00 de la hora del negocio, el paciente principal recibe el email **«¿Cómo te fue en tu cita con
   [profesional]?»**, si:
   - tiene email;
   - no pidió dejar de recibirlas;
   - le toca según la frecuencia (respuesta 1).
2. **Dado** el email, **entonces** trae 5 estrellas como botones. Al tocar una se abre la página de la encuesta con
   esa estrella ya elegida.
3. **Dado** la página, **entonces**:
   - muestra el negocio, el profesional, el servicio y la fecha de la cita;
   - deja cambiar la estrella y escribir un comentario opcional, de hasta 1000 caracteres;
   - dice que la respuesta la lee el negocio, con el nombre del paciente (respuesta 3), y que no se publica.
4. **Dado** que la envía, **entonces** ve «Gracias por contarnos». Si vuelve a abrir el enlace, ve «Ya respondiste
   esta encuesta».
5. **Dado** que pasaron 14 días desde el email, **entonces** el enlace ya no abre la encuesta.
6. **Dado** el enlace **«No quiero recibir estas encuestas»** del email o de la página, **entonces** el paciente
   deja de recibirlas en ese negocio, sin iniciar sesión. Queda en la actividad.

### Historia 2 - El negocio ve las opiniones (Prioridad: P1)

**Por qué esta prioridad:** es para lo que sirven las respuestas.

**Prueba independiente:** con tres respuestas (5, 4 y 2 estrellas), Reportes muestra el promedio 3,7, las tres
respuestas y sus comentarios. La de 2 estrellas avisó en la campana.

1. **Dado** Reportes, **entonces** sale **«Opiniones de los pacientes»** para el periodo y el profesional elegidos:
   - el promedio de estrellas y cuántas respuestas hubo;
   - cuántas de cada estrella;
   - los últimos comentarios, con el paciente (respuesta 3), el profesional y la fecha de la cita.

   Si no hubo respuestas, lo dice.
2. **Dado** la ficha de un paciente que respondió, **entonces** se ven sus respuestas.
3. **Dado** una respuesta de 1 o 2 estrellas, **entonces** la campana avisa al momento al propietario y al profesional
   de la agenda: «[Paciente] calificó su cita con 2 estrellas», con el enlace a la respuesta.
4. **Dado** el rol Profesional, **entonces** ve sólo las opiniones de su agenda.
5. **Dado** Recepción, **entonces** no ve las opiniones, como hoy no ve Reportes.

### Historia 3 - El negocio la enciende (Prioridad: P2)

**Prueba independiente:** con la encuesta apagada no sale ningún email; al encenderla, sale tras la siguiente cita
Atendida.

1. **Dado** Configuración → Notificaciones, **entonces** el propietario enciende o apaga **«Preguntar al paciente
   cómo le fue»** (respuesta 2). Empieza apagada y el cambio queda en la actividad.
2. **Dado** que se apaga, **entonces** no sale ninguna encuesta más. Las respuestas que ya llegaron se siguen viendo,
   y los enlaces ya enviados se pueden responder hasta que caduquen.

### Historia 4 - El informe mensual suma las opiniones (Prioridad: P3)

1. **Dado** el informe mensual del propietario (spec 040), **cuando** ese mes hubo respuestas, **entonces** suma el
   promedio de estrellas y cuántas respuestas hubo, con la comparación con el mes anterior. Sin comentarios ni
   nombres.

### Casos límite

- **Cita en pareja o en familia:** sólo se le pregunta al paciente principal.
- **Una cita que se marca como Atendida tarde:** si ya pasaron más de 3 días desde la cita, no sale encuesta.
- **Sin cupo de Gmail:** la encuesta sale al día siguiente. Si para entonces pasaron más de 3 días desde la cita, ya
  no sale.
- **Una cita Atendida corregida por el propietario:** no cambia la encuesta que ya salió.
- **Varias citas Atendidas el mismo día con el mismo paciente:** un solo email, por la primera.
- **Paciente borrado:** sus respuestas se borran con él.
- **Negocio suspendido:** no sale ninguna encuesta.
- **Privacidad:**
  - las opiniones nunca salen en la página de reservas, la portada ni en ningún lugar público;
  - la campana, la actividad y los avisos no llevan el comentario;
  - ntfy y el celular no reciben nada de las encuestas.

## Requisitos *(obligatorio)*

- **RF-001**: Cada negocio DEBE tener el interruptor «Preguntar al paciente cómo le fue» en Configuración → Notificaciones, apagado al principio, que cambia el propietario (respuesta 2). El cambio DEBE quedar en la actividad.
- **RF-002**: Con el interruptor encendido, el paciente principal de una cita Atendida, con email y sin haber pedido dejar de recibirlas, DEBE recibir el email de la encuesta al día siguiente, desde las 10:00 de la hora del negocio, según la frecuencia (respuesta 1). NO DEBE salir si pasaron más de 3 días desde la cita.
- **RF-003**: El email DEBE traer las 5 estrellas como botones y el enlace «No quiero recibir estas encuestas». NO DEBE llevar copia al profesional.
- **RF-004**: La página de la encuesta DEBE abrirse sin iniciar sesión, con la estrella elegida, el comentario opcional de hasta 1000 caracteres y el aviso de quién la lee y de que no se publica. Una sola respuesta por encuesta, y el enlace DEBE caducar a los 14 días.
- **RF-005**: Reportes DEBE mostrar «Opiniones de los pacientes» por periodo y profesional: el promedio, cuántas hubo, cuántas de cada estrella y los últimos comentarios. La ficha del paciente DEBE mostrar sus respuestas.
- **RF-006**: Las opiniones las DEBEN ver sólo quienes hoy ven Reportes: el propietario, los administradores y el rol Profesional (sólo su agenda). La API DEBE aplicar la misma regla.
- **RF-007**: Una respuesta de 1 o 2 estrellas DEBE avisar en la campana al propietario y al profesional de la agenda, sin el comentario.
- **RF-008**: Responder la encuesta y dejar de recibirlas DEBEN quedar en la actividad, sin el comentario. Los envíos automáticos, no.
- **RF-009**: El informe mensual DEBE sumar el promedio y cuántas respuestas hubo, si hubo.
- **RF-010**: Las respuestas DEBEN entrar en la descarga de datos del negocio y borrarse con el paciente. Las opiniones NUNCA DEBEN salir en un lugar público.
- **RF-011**: Con el interruptor apagado, todo DEBE seguir como hoy.
- **RF-012**: La constitución DEBE recoger la decisión y la excepción a la copia al profesional (1.47.0, en los dos repos).

### Entidades

- **Encuesta:** una por cita: el paciente, el profesional, cuándo se envió, cuándo caduca y, si respondió, las
  estrellas, el comentario y cuándo.
- **«No quiero recibir estas encuestas»:** una marca en el paciente, por negocio.
- **El interruptor «Preguntar al paciente cómo le fue»:** uno por negocio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - quién recibe la encuesta: la cita Atendida, el paciente principal con email, la frecuencia, el tope de 3 días y
    «No quiero recibir estas encuestas»;
  - que no sale con el interruptor apagado ni en un negocio suspendido;
  - responder una sola vez y la caducidad a los 14 días;
  - el promedio y los conteos de Reportes, por periodo y profesional;
  - quién ve las opiniones y que la API rechaza al resto;
  - el aviso de 1 o 2 estrellas, sin el comentario;
  - sin copia al profesional, la actividad, el informe mensual, la descarga de datos y el borrado con el paciente.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y todas las `check:*` en el front, sin errores
  (también en GitHub, en «Comprobar»).
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px, sin desplazamiento horizontal): el email,
  la página con la estrella elegida, «Gracias», «Ya respondiste», Reportes y la ficha del paciente.
- **CE-004**: El paciente responde en menos de 30 segundos desde el email: una estrella y, si quiere, un comentario.
- **CE-005**: Una prueba real: el email llega, se lee bien en el celular y la estrella tocada abre la página con esa
  estrella.

## Supuestos

- **El envío lo hace el cron de GitHub,** como los otros emails a una hora del negocio. No gasta CPU de Vercel.
- **El remitente es el de siempre,** con el nombre del negocio.
- **No se publican opiniones ni se piden reseñas en Google** u otros sitios.
- **Hay una migración** para las encuestas, el interruptor y la marca de no recibirlas.

## Respuestas del dueño del producto (2026-11-12)

«apruebo con las recomendaciones»:
1. **Frecuencia:** después de la primera cita Atendida en el negocio y luego como mucho una vez cada 3 meses.
2. **Quién la enciende:** cada negocio, en Configuración → Notificaciones. Empieza apagada.
3. **Quién respondió:** el negocio lo ve, con el nombre, y la página se lo dice al paciente.
