# Especificación: «Tu día» que se desliza

**Carpeta**: `specs/026-tu-dia-deslizable` (rama de trabajo: `dev`) · **Creada**: 2026-10-19

**Estado**: Publicada (2026-10-19, PR front #38)

**Repos**:
- **agenda-front:** la franja «Tu día» del Inicio.
- **La beta:** tiene la misma franja (el archivo es idéntico), así que se copia. Ver la pregunta de los
  supuestos.
- **agenda-backend:** no se toca. No hay migración.

## Pedido

Una clienta psicóloga escribió el 2026-10-19. Le puso un 10 a la app («ha traído más seriedad a mi
consultorio») y dijo:

> si en el día tengo 2 pacientes, en el inicio sólo me deja ver a 1 de los dos… al primero agendado.
> Quisiera que la barra donde se ven las horas pueda moverse y yo ver las siguientes horas también, así
> como en otros calendarios.

El dueño del producto pidió la spec el mismo día.

**Cómo es hoy:**
- El Inicio tiene tres partes:
  - «Tu siguiente cita», sólo con la próxima;
  - la franja «Tu día», con todas las citas;
  - «Lo que queda de hoy», con las demás, más abajo.
- **En el celular,** la franja mete todo el día (por ejemplo de 08:00 a 20:00) en el ancho de la
  pantalla, sin moverse. Cada cita queda como una rayita de color, sin la hora ni el nombre.
- **En el computador** lleva la hora y el nombre, pero en las citas cortas quedan muy cortados.

Por eso sólo se lee bien la primera cita, la de la tarjeta de arriba.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver cada cita del día con su hora y su nombre (Prioridad: P1)

La psicóloga abre el Inicio entre paciente y paciente y quiere ver de un vistazo quién viene y a qué
hora.

**Prueba independiente**: un día con dos citas de 45 minutos separadas por unas horas, abierto en el
celular y en el computador.

**Escenarios de aceptación**:

1. **Dado** el Inicio en el celular, **entonces** la franja muestra unas 3 a 4 horas a la vez, y cada
   cita de 30 minutos o más lleva su hora de inicio y el nombre del paciente. Si no cabe entero, el
   nombre sale cortado, sin tapar la hora.
2. **Dado** el Inicio en el computador, **entonces** la franja muestra unas 6 a 8 horas a la vez, con
   la hora y el nombre de cada cita.
3. **Dado** una cita con varios pacientes, **entonces** lleva sus nombres, como hoy.
4. **Dado** cualquier cita de la franja, **cuando** se toca, **entonces** se abre su detalle, como
   hoy.

### Historia 2 - Moverse por las horas, como en otros calendarios (Prioridad: P1)

**Prueba independiente**: deslizar la franja con el dedo, con el trackpad o con la rueda del ratón, y
usar las flechas y «Ahora».

**Escenarios de aceptación**:

1. **Dado** la franja, **cuando** se desliza de lado con el dedo, con el trackpad o con la rueda (con
   Mayúsculas), **entonces** se ven las horas siguientes o las anteriores. La página no se mueve de
   lado.
2. **Dado** las flechas ‹ y ›, **cuando** se tocan, **entonces** la franja avanza o retrocede
   aproximadamente lo que se ve. En un extremo del día, la flecha de ese lado queda deshabilitada.
3. **Dado** el botón «Ahora», **cuando** se toca, **entonces** la franja vuelve a la hora actual. Sólo
   se ofrece si la hora actual está dentro del día que se muestra.
4. **Dado** que se abre el Inicio, **entonces** la franja empieza:
   - en la hora actual, durante el día;
   - antes de que empiece el día, en la primera cita, o en el inicio del horario si no hay citas;
   - después de que termina, en la última cita.

   Después no se mueve sola mientras la persona la desliza.

### Historia 3 - Saber que hay más citas fuera de lo que se ve (Prioridad: P1)

Es lo que le pasó a la clienta: no sabía que había otra cita.

**Escenarios de aceptación**:

1. **Dado** citas fuera de lo que se ve, **entonces** el borde de ese lado lo dice: «1 cita más tarde
   →» o «← 2 antes».
2. **Dado** ese aviso, **cuando** se toca, **entonces** la franja se mueve hasta la cita más cercana de
   ese lado.
3. **Dado** que todas las citas están a la vista, **entonces** no sale ningún aviso.
4. **Dado** el encabezado de «Tu día», **entonces** sigue diciendo cuántas citas hay hoy y cuántas
   están por confirmar.

### Historia 4 - Todo lo que ya hace la franja, igual (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** la franja, **entonces** sigue mostrando:
   - el horario de atención y lo que está fuera de horario;
   - los bloqueos rayados, con su motivo;
   - lo ya pasado, atenuado, y la línea de «ahora» con su hora;
   - el borde lila de la siguiente cita;
   - los colores de cada estado;
   - con varias agendas, las citas de todas y sólo los bloqueos de todo el negocio.
2. **Dado** las horas escritas bajo la franja, **entonces** salen cada hora sin pisarse, porque ahora
   hay espacio.

### Casos límite

- **Un día sin horario y sin citas:** el mensaje de hoy, «Hoy no atiendes según tu horario».
- **Un día corto que cabe entero:** no hay flechas, ni avisos, ni nada que deslizar. Se ve como una
  franja fija.
- **Citas muy cortas, de 15 minutos:** llevan la hora y, si no cabe, el nombre se omite. El detalle
  sigue al tocarla y con el lector de pantalla.
- **Al girar el celular o cambiar el tamaño de la ventana,** lo que se ve se ajusta sin saltar a otra
  hora.
- **La hora avanza** sin que la franja se mueva sola. «Ahora» lleva de vuelta.
- **Con teclado:** las flechas ‹ › y «Ahora» son botones con nombre, y las citas se recorren con
  Tab.
- **Con lector de pantalla:** cada cita se anuncia con su hora, sus pacientes y su estado, como hoy.
  Los avisos de los bordes, con su texto.
- **En claro y oscuro, a 390 px,** sin desplazamiento horizontal de la página.

## Requisitos *(obligatorio)*

- **RF-001**: La franja DEBE mostrar una parte del día, unas 3 a 4 horas en el celular y 6 a 8 en el
  computador, y no el día entero comprimido.
- **RF-002**: Cada cita de 30 minutos o más DEBE mostrar su hora de inicio y el nombre de sus
  pacientes, en el celular y en el computador.
- **RF-003**: La franja DEBE deslizarse de lado con el dedo, con el trackpad y con la rueda, sin mover
  la página.
- **RF-004**: DEBE tener flechas ‹ › y el botón «Ahora», como botones accesibles.
- **RF-005**: Al abrir, DEBE empezar en la hora actual. Antes del día, en la primera cita o en el
  horario; después del día, en la última cita.
- **RF-006**: Cuando haya citas fuera de la vista, los bordes DEBEN decir cuántas hay y llevar hasta
  ellas al tocarlos.
- **RF-007**: DEBE mantener todo lo que hace hoy (Historia 4) y seguir abriendo el detalle al tocar una
  cita.
- **RF-008**: No DEBE gastar de más: nada que se repita cada segundo ni pedidos nuevos a la API.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Con dos citas en el día, en el celular, la persona encuentra las dos con su hora y su
  nombre en menos de 5 segundos: a la vista, o tocando el aviso del borde.
- **CE-002**: En el celular, ninguna cita de 30 minutos o más queda sin su hora y su nombre.
- **CE-003**: La página no se desplaza de lado a 390 px, en claro ni en oscuro.
- **CE-004**: El build, el lint y la revisión de contraste pasan, y el recorrido en el celular y en el
  computador lo comprueba.

## Supuestos

- **Sólo cambia la franja «Tu día» del Inicio.** «Tu siguiente cita», «Lo que queda de hoy» y el
  Calendario siguen igual.
- **No hace falta nada nuevo del backend:** la franja usa las mismas citas, horarios y bloqueos que ya
  carga el Inicio.
- **Google Calendar** queda fuera; se conversa aparte.
- **La beta** tiene el mismo archivo de la franja, así que se le copia el cambio, con sus datos de
  prueba. El dueño del producto lo aprobó junto con la spec (2026-10-19).
