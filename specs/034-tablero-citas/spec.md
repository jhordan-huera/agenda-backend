# Especificación: El tablero de las citas

**Carpeta**: `specs/034-tablero-citas` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Implementada (2026-10-22)

**Repos**:
- **agenda-front:** la vista «Tablero» de la Agenda.
- **agenda-backend:** nada. Usa lo que ya existe para cambiar el estado y el pago. Sin migración.
- **La beta:** la lleva, con sus datos de ejemplo (valor por defecto; confirmar al aprobar).

## Pedido

El dueño del producto, el 2026-10-22, al ver en la portada de la spec 032 la ilustración «Cada cita, de la
reserva al cobro»: «esta pantalla me gustaría verla en el sistema, porque en el landing la muestras pero
dentro del sistema no hay».

**Sus decisiones (2026-10-22):**
1. **Dónde:** una vista más en la Agenda: Día · Semana · Mes · **Tablero**, con el mismo filtro de
   profesional y la misma navegación de fechas.
2. **Qué citas:** por defecto las de la semana, con un selector Hoy / Semana / Mes y las flechas.
3. **Cómo se mueven:**
   - **en el computador,** se arrastra la tarjeta a otra columna, con una confirmación;
   - **en el celular y con el teclado,** cada tarjeta tiene un menú «Mover a…»;
   - **tocar la tarjeta** abre la cita, como en el resto de la Agenda.
4. **Las canceladas y las de «No asistió»:** una quinta columna, plegada al principio.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver en qué va cada cita (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** Agenda → Tablero, **entonces** se ven cuatro columnas, cada una con su cifra:

   | Columna | Qué citas lleva |
   |---|---|
   | **Por confirmar** | las pendientes |
   | **Confirmadas** | las confirmadas que aún no se atienden |
   | **Atendidas** | las completadas sin pagar |
   | **Pagadas** | las completadas y pagadas |

   Además está la columna plegada **«No asistió / Canceladas»**.
2. **Dado** cada tarjeta, **entonces** muestra:
   - la fecha y la hora;
   - el paciente o los pacientes (dentro del panel, con su nombre completo, como la Agenda);
   - el servicio;
   - el profesional, si hay varias agendas;
   - unas marcas, sólo cuando aplican: «Reserva online», «Confirmó que va», «Recordatorio enviado»,
     «Comprobante recibido» y «Pagada» (si se pagó antes de atenderla).
3. **Dado** el selector Hoy / Semana / Mes y las flechas, **entonces** el tablero muestra las citas de ese
   periodo, con el filtro de profesional de la Agenda.
4. **Dado** un profesional con el alcance «sólo sus pacientes», **entonces** ve lo mismo que en su Agenda.

### Historia 2 - Mover una cita de columna (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una cita, **cuando** se lleva de una columna a otra, **entonces** se pide confirmación y se hace
   con las mismas reglas, avisos y actividad que desde la cita:

   | De | A | Qué hace |
   |---|---|---|
   | Por confirmar | Confirmadas | Confirma la cita |
   | Confirmadas | Atendidas | La marca completada, con la casilla «Avisar al paciente» como hoy |
   | Confirmadas o Atendidas | Pagadas | La marca completada, si no lo estaba, y pagada |
   | Pagadas | Atendidas | Quita el pago |
2. **Dado** un movimiento que la app no permite, **entonces** la tarjeta vuelve a su sitio y un mensaje dice
   por qué. Nada vuelve a «Por confirmar», y una completada no vuelve a «Confirmadas» (para eso está
   «Corregir estado» del propietario).
3. **Dado** alguien sin permiso para cambiar el estado o el pago, **entonces** no puede arrastrar ni ve esas
   opciones del menú.
4. **Dado** el menú «Mover a…» de la tarjeta, **entonces** hace lo mismo que arrastrar, también con el
   teclado.
5. **Dado** la columna «No asistió / Canceladas», **entonces** sólo se consulta: cancelar o marcar «No
   asistió» se hace desde la cita, como hoy.

### Casos límite

- **Muchas citas en el mes:** cada columna se desplaza por dentro, con su cifra arriba.
- **A 390 px:** las columnas se deslizan de lado dentro de su caja, nunca la página, y no se arrastra.
- **Si falla un cambio** (sin red o con el estado ya cambiado por otra persona), la tarjeta vuelve a su
  columna y se ve el error.
- **Claro y oscuro,** con contraste 4,5:1 y foco visible.

## Requisitos *(obligatorio)*

- **RF-001**: La Agenda DEBE tener la vista «Tablero» con las cinco columnas, el selector Hoy / Semana / Mes, las flechas y el filtro de profesional.
- **RF-002**: Las tarjetas DEBEN mostrar los datos y las marcas de la Historia 1.
- **RF-003**: Mover una tarjeta DEBE usar las mismas acciones de la cita (estado, pago, «Avisar al paciente», actividad), con confirmación y con las reglas vigentes.
- **RF-004**: Se DEBE poder mover con el menú «Mover a…», también con el teclado y en el celular.
- **RF-005**: Los permisos y el alcance del profesional DEBEN ser los de la Agenda.
- **RF-006**: La beta DEBE llevar el tablero con sus datos de ejemplo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Build, lint y `check:contrast` pasan, y el recorrido mueve citas en todas las direcciones permitidas y rechaza las prohibidas.
- **CE-002**: Funciona en el computador y en el celular (390 px), en claro y oscuro, sin desplazamiento horizontal de la página.

## Supuestos

- **No hay cambios en el backend:** los cambios de estado y de pago ya existen, con su actividad y sus emails.
- **La vista que se eligió** (Día, Semana, Mes o Tablero) se recuerda como las demás de la Agenda.
