# Especificación: Servicios en pareja o familia y su reserva online (sesiones con varios pacientes, fase 2)

**Carpeta**: `specs/005-servicios-en-pareja` (rama de trabajo: `dev`)

**Creada**: 2026-10-13

**Estado**: Publicada (2026-10-13)

**Repos**: agenda-backend (principal: datos, reserva pública y avisos), agenda-front (servicios, página
de reservas y formulario de cita) y la beta.

## Pedido

La fase 1 (spec 004, ya publicada) permite poner hasta 3 pacientes en una cita, pero sólo desde el
panel. Hay negocios que van a ofrecer servicios como **terapia de pareja** o **terapia familiar**, en
los que siempre van dos o tres personas. Hoy la página de reservas sólo pide los datos de una.

**Decisiones del dueño del producto (2026-10-13):**
- Cada servicio dice para cuántas personas es.
- La página de reservas pide los datos de cada persona.
- Cada persona se reconoce por su número de cédula, **tal como ha venido funcionando**:
  - si ya es paciente del negocio, se usa su ficha;
  - si no existe, se registra como paciente nuevo;
  - si una existe y la otra no, la que no existe se registra como nueva.
- Sigue valiendo lo de la fase 1: máximo 3 pacientes por cita y sólo en los negocios que el super
  admin habilite con su interruptor.

## Decisiones por aprobar

El dueño del producto tiene que confirmar estas tres recomendaciones antes del plan:

1. **En el panel, un aviso y no un bloqueo.** Si a una cita de un servicio en pareja le falta el
   segundo paciente, el panel lo avisa, pero deja guardar. Sirve, por ejemplo, si uno de los dos no
   vino o todavía no está registrado. En la página de reservas sí son obligatorios.
2. **Email o teléfono compartidos.** Las personas de una misma reserva pueden poner el mismo email o
   el mismo teléfono. A un email compartido le llega un solo email por aviso, como en la fase 1.
3. **Datos de pago sólo para el paciente principal.** Los datos de pago por transferencia (cuentas y
   enlace para subir el comprobante) van sólo en los emails del paciente principal. Esto vale también
   para las citas con varios pacientes que se crean desde el panel: hoy, en la fase 1, los reciben
   todos los pacientes.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El negocio marca un servicio como «en pareja» (Prioridad: P1)

Un consultorio habilitado por el super admin crea el servicio «Terapia de pareja» y lo marca para 2
personas.

**Prueba independiente**: en un negocio habilitado, editar un servicio y elegir 2 personas. En uno sin
habilitar, comprobar que el campo no aparece.

**Escenarios de aceptación**:

1. **Dado** un negocio habilitado, **cuando** crea o edita un servicio, **entonces** ve el campo
   «Personas por sesión» con tres opciones: 1 (individual), 2 (pareja) y 3 (familia). Por defecto
   es 1.
2. **Dado** un negocio sin habilitar, **cuando** crea o edita un servicio, **entonces** no ve el campo
   y todos sus servicios son individuales.
3. **Dado** un negocio con servicios en pareja, **cuando** el super admin apaga el interruptor,
   **entonces** esos servicios funcionan como individuales en la página y en el panel. Si lo vuelve
   a encender, recuperan las personas que tenían.

---

### Historia 2 - Reservar una sesión de pareja por la página (Prioridad: P1)

Ana entra a la página de reservas del consultorio, elige «Terapia de pareja», un día y una hora. En
«Tus datos» pone los suyos y los de Carlos, su pareja. Los dos reciben su email.

**Prueba independiente**: reservar por la página un servicio de 2 personas con una persona que ya es
paciente y otra nueva. Comprobar que queda una sola cita pendiente con los dos pacientes, que no se
duplicó a la que ya existía, que a la nueva se la registró y que cada uno recibió su email.

**Escenarios de aceptación**:

1. **Dado** la página de reservas, **cuando** se muestra un servicio de 2 o 3 personas, **entonces**
   dice para cuántas personas es («Para 2 personas»).
2. **Dado** que Ana eligió un servicio de 2 personas, **cuando** llega al paso de los datos,
   **entonces** se le piden los suyos (cédula, nombre, email y teléfono) y los de la otra persona,
   con los mismos campos. Todos son obligatorios.
3. **Dado** que Ana ya es paciente del consultorio y Carlos no, **cuando** se envía la reserva,
   **entonces**:
   - a Ana se la reconoce por su cédula, con la regla de hoy, y no se modifica su ficha;
   - Carlos queda registrado como paciente nuevo, marcado como creado desde la página;
   - se crea una sola cita pendiente con Ana como paciente principal y Carlos como segundo paciente.
4. **Dado** que los dos ya son pacientes del consultorio, **cuando** se envía la reserva,
   **entonces** se reconoce a cada uno por su cédula y no se crea ningún paciente nuevo.
5. **Dado** que ninguno es paciente, **cuando** se envía la reserva, **entonces** se registra a los
   dos como pacientes nuevos.
6. **Dado** la reserva creada, **cuando** salen los emails, **entonces**:
   - Ana recibe el email de solicitud recibida;
   - Carlos recibe el suyo, que le dice que Ana reservó la sesión para los dos;
   - ninguno ve el email ni el teléfono del otro;
   - el negocio recibe su aviso de nueva reserva y el profesional una sola copia, con los dos
     nombres.
7. **Dado** que el profesional confirma la cita, **cuando** se guarda, **entonces** los dos reciben
   la confirmación y la copia al profesional sale una sola vez, como en la fase 1.
8. **Dado** la pantalla de reserva recibida, **cuando** se muestra, **entonces** nombra a todas las
   personas de la sesión.

---

### Historia 3 - La página protege los datos de cada persona (Prioridad: P1)

Quien reserva escribe datos de otra persona. La página no debe dejar averiguar ni usar los datos
de nadie.

**Prueba independiente**: intentar reservar con la cédula de un paciente que existe pero con otro
email y otro teléfono. Comprobar que la reserva se rechaza y que la página no muestra ningún dato de
ese paciente.

**Escenarios de aceptación**:

1. **Dado** que la cédula de la otra persona ya existe en el negocio, **cuando** ni su email ni su
   teléfono coinciden con los de su ficha, **entonces** la reserva se rechaza con un mensaje que
   pide revisar los datos de esa persona, igual que hoy pasa con quien reserva. No se muestra nada
   de su ficha.
2. **Dado** cualquier cédula, **cuando** se escribe en la página, **entonces** la página no completa
   ni sugiere ningún dato de esa persona.
3. **Dado** que se escribe la misma cédula para las dos personas, **cuando** se intenta reservar,
   **entonces** la página lo impide y pide una cédula distinta para cada una.
4. **Dado** «Recordar mis datos», **cuando** quien reserva lo marca, **entonces** sólo se guardan
   sus datos en ese navegador, no los de la otra persona.

---

### Historia 4 - Los límites de la página siguen funcionando (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** el límite de citas por persona al día del negocio, **cuando** alguna de las personas ya
   lo alcanzó ese día, **entonces** la reserva se rechaza con el mensaje de hoy, que dice a qué
   persona le pasa.
2. **Dado** los topes diarios de la página, **cuando** se cuenta la reserva, **entonces** la sesión
   cuenta como una sola reserva para el tope de reservas del día y para el del plan. Cada persona
   nueva cuenta para el tope de pacientes nuevos del día y para el de pacientes del plan.
3. **Dado** que alguno de esos topes se alcanzó, **cuando** se intenta reservar, **entonces** se
   rechaza toda la reserva con el mensaje de hoy, sin crear ningún paciente ni la cita.
4. **Dado** una reserva enviada dos veces seguidas (doble clic o mala conexión), **cuando** llega la
   segunda dentro de los 30 minutos, **entonces** devuelve la misma confirmación y no crea otra cita
   ni otros pacientes.
5. **Dado** el aviso por ntfy de cada reserva por la página, **cuando** sale, **entonces** nombra a
   todas las personas, con sus datos a medias como hoy.

---

### Historia 5 - En el panel, el servicio en pareja abre los espacios solo (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** el formulario de cita en un negocio habilitado, **cuando** se elige un servicio de 2
   personas, **entonces** se abre solo el espacio del «Paciente 2». Con uno de 3 personas, se abren
   dos.
2. **Dado** que faltan pacientes para las personas del servicio, **cuando** se va a guardar,
   **entonces** el formulario lo avisa y deja guardar (decisión por aprobar n.º 1).
3. **Dado** un servicio individual, **cuando** se agenda, **entonces** el formulario funciona como en
   la fase 1: no abre espacios, pero se pueden agregar pacientes.

---

### Casos límite

- **Negocio sin habilitar:**
  - no ve el campo en el servicio;
  - la página pide los datos de una sola persona en todos sus servicios;
  - el sistema rechaza una reserva con varias personas aunque se intente sin pasar por la página.
- **Más personas que las del servicio:** la página nunca acepta más personas que las que dice el
  servicio. El panel, como en la fase 1, permite hasta 3 en cualquier servicio.
- **Paciente principal:** es siempre quien reserva, la primera persona del formulario.
- **Ficha antigua sin cédula:** a cada persona se le aplica la regla de hoy. Si coinciden el email y
  el nombre, a esa ficha se le añade la cédula en lugar de crear otra.
- **Pacientes inactivos:** a cada persona se le aplica lo que hoy pasa con quien reserva.
- **Dirección de la visita a domicilio:** queda sólo en la ficha de quien reserva, si aún no tenía
  una, como hoy.
- **Una persona sin email:** no se puede, porque en la página el email es obligatorio para todos.
- **Topes de emails:** el email a cada persona nueva cuenta para los topes diarios de emails, como
  hoy.
- **Cancelar o cambiar desde la página:** no cambia. La sesión entera se gestiona desde el negocio,
  como hoy.
- **Disponibilidad:** la sesión ocupa su hora una sola vez, como en la fase 1.
- **Precio:** el precio que muestra la página es el de la sesión, no por persona.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Cada servicio DEBE tener el dato «Personas por sesión»: 1, 2 o 3. Por defecto es 1, y
  todos los servicios que ya existen quedan en 1.
- **RF-002**: Sólo los negocios con el interruptor «Citas con varios pacientes» activado DEBEN ver y
  poder cambiar ese dato. En los demás, todos los servicios DEBEN funcionar como individuales, y el
  sistema DEBE rechazar una reserva con varias personas aunque se intente sin pasar por la página.
  Si el interruptor se apaga, se conserva el dato del servicio, pero no se usa hasta que se vuelva a
  encender.
- **RF-003**: La página de reservas DEBE mostrar en cada servicio de 2 o 3 personas para cuántas es.
  Al reservarlo, DEBE pedir cédula, nombre, email y teléfono de cada persona, todos obligatorios.
- **RF-004**: La reserva DEBE reconocer a cada persona por su cédula con la regla de hoy:
  - si existe y coinciden su email o su teléfono, se usa su ficha sin cambiar sus datos;
  - si existe y no coinciden, se rechaza la reserva con un mensaje que nombra a esa persona como la
    escribió quien reserva, sin mostrar nada de su ficha;
  - si no existe, se registra como paciente nuevo, creado desde la página.
- **RF-005**: La página NO DEBE aceptar la misma cédula para dos personas de la reserva.
- **RF-006**: La reserva DEBE crear una sola cita pendiente:
  - quien reserva es el paciente principal y las demás personas son los otros pacientes;
  - la cita ocupa la hora una sola vez;
  - todo se crea junto o no se crea nada: si algo falla, no queda ningún paciente nuevo ni la cita.
- **RF-007**: Los emails de la reserva DEBEN salir así:
  - cada persona recibe el suyo, con su propio saludo y sin los datos de contacto de las demás;
  - el de los otros pacientes dice quién reservó la sesión;
  - el negocio recibe un aviso de nueva reserva y el profesional una sola copia, con todos los
    nombres;
  - después, cada cambio de la cita avisa a todos, como en la fase 1.
- **RF-008**: Los datos de pago por transferencia DEBEN ir sólo en los emails del paciente principal,
  tanto en las citas de la página como en las del panel (decisión por aprobar n.º 3).
- **RF-009**: Los límites de la página DEBEN aplicarse así:
  - el de citas por persona al día, a cada persona;
  - el tope de reservas del día y el del plan cuentan la sesión una vez;
  - el tope de pacientes nuevos del día y el de pacientes del plan cuentan a cada persona nueva;
  - si alguno se alcanza, se rechaza toda la reserva con el mensaje de hoy.
- **RF-010**: El reintento de una misma reserva dentro de 30 minutos (mismas personas, servicio,
  fecha y hora) DEBE devolver la misma confirmación sin crear nada nuevo.
- **RF-011**: El aviso por ntfy de cada reserva por la página DEBE nombrar a todas las personas, con
  sus datos a medias.
- **RF-012**: «Recordar mis datos» DEBE guardar sólo los datos de quien reserva.
- **RF-013**: La pantalla de reserva recibida DEBE nombrar a todas las personas de la sesión.
- **RF-014**: En el formulario de cita del panel, al elegir un servicio de 2 o 3 personas DEBEN
  abrirse solos los espacios de los otros pacientes. Si faltan pacientes, DEBE mostrarse un aviso que
  no impide guardar (decisión por aprobar n.º 1).
- **RF-015**: Las personas de una misma reserva DEBEN poder compartir email o teléfono. A un email
  compartido sale un solo email por aviso (decisión por aprobar n.º 2).
- **RF-016**: Los servicios individuales y los negocios sin habilitar DEBEN funcionar exactamente
  como hoy, en la página y en el panel.
- **RF-017**: La beta DEBE ofrecer lo mismo: el campo en el servicio, la página de reservas que pide
  los datos de cada persona y los espacios que se abren solos en el panel. La beta no envía emails
  reales.

### Entidades clave

- **Servicio**: gana el dato «Personas por sesión» (1, 2 o 3).
- **Cita**: sin cambios respecto a la fase 1. Tiene un paciente principal y hasta 2 pacientes más.
- **Paciente**: sin cambios. Cada persona de la reserva es un paciente del negocio con su propia
  cédula, ficha e historia clínica.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Reservar por la página una sesión de pareja toma menos de 3 minutos. Los datos de la
  segunda persona agregan a lo sumo un minuto a una reserva individual.
- **CE-002**: En pruebas, el 100 % de las reservas en pareja crean exactamente una cita con todas las
  personas. Las que ya eran pacientes se reconocen sin duplicarse y las nuevas se registran una sola
  vez.
- **CE-003**: En pruebas, el 100 % de las personas de la reserva reciben su email, y el profesional
  recibe una sola copia por aviso.
- **CE-004**: La página no muestra ni completa ningún dato guardado de ninguna persona: 0 campos
  llenados con datos del negocio, en ningún caso.
- **CE-005**: En un negocio sin habilitar, el 0 % de las reservas con varias personas tiene éxito y la
  página se ve igual que antes.
- **CE-006**: Una reserva rechazada por un límite o por datos que no coinciden no deja ningún
  paciente nuevo ni ninguna cita.
- **CE-007**: Las pruebas automáticas del backend y del front pasan. La página de reservas y el panel
  se usan sin desplazamiento horizontal a 390 px de ancho.

## Supuestos

- Quien reserva es una de las personas de la sesión y es el paciente principal. Reservar para otras
  personas sin asistir no forma parte de esta función.
- Los datos que pide la página son los de hoy (cédula, nombre, email y teléfono) para cada persona.
  Los datos obligatorios que el negocio configura para el panel no cambian la página, como hoy.
- El precio es por sesión. Cobrar por persona está fuera de alcance.
- Que la otra persona confirme o rechace la cita está fuera de alcance.
- Al aprobar esta spec se actualiza el principio III de la constitución, en los dos repos:
  - se añade la decisión de los servicios en pareja con reserva online;
  - se corrige la línea de la copia al profesional, que desde el 2026-10-13 también incluye los
    recordatorios.
