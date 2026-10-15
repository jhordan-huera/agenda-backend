# Especificación: Citas que se repiten

**Carpeta**: `specs/011-citas-que-se-repiten` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Implementada (2026-10-14)

**Repos**: agenda-backend (principal: crear la serie, los emails y ntfy), agenda-front (el formulario
de la cita y la ficha) y la beta.

## Pedido

El dueño del producto eligió, entre las ideas de mejora del 2026-10-14, poder **agendar de una vez
varias citas que se repiten** («cada semana, 8 sesiones»). Psicólogos y fisioterapeutas lo usan mucho
y hoy toca crearlas una por una.

**Decisión del dueño del producto (2026-10-14):** antes de crear la serie se ve la **lista de fechas**,
con las que chocan con otra cita o un bloqueo marcadas. Se crean las demás, y en la lista se puede
cambiar la hora de las que chocan o quitarlas.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Agendar una serie (Prioridad: P1)

Desde «Nueva cita» del panel, quien agenda marca «Repetir», elige cada cuánto y cuántas veces, revisa
la lista y crea todas.

**Por qué esta prioridad**: es el pedido; ahorra muchos clics en cada paciente de terapia.

**Prueba independiente**: crear una serie semanal de 8 citas con una fecha ocupada y comprobar que se
crean 7, más la que se movió de hora.

**Escenarios de aceptación**:

1. **Dado** el formulario de una cita nueva, **entonces** tiene «Repetir» con:
   - **cada cuánto:** cada semana, cada 2 semanas o cada mes (el mismo día del mes; si no existe, el
     último);
   - **cuántas citas:** de 2 a 24, contando la primera.
2. **Dado** esos datos, **entonces** se ve la lista de fechas con su día y su hora. Las que chocan con
   otra cita del profesional, con un bloqueo o con un día que no atiende se marcan con el motivo.
3. **Dado** una fecha marcada, **entonces** en la lista se le puede cambiar la hora (las horas libres
   de ese día) o quitarla.
4. **Dado** «Crear N citas», **entonces** se crean las que no chocan, todas con el mismo paciente (o
   pacientes), servicio, profesional, modalidad y notas.
5. **Dado** la serie creada, **entonces** un aviso dice «Se crearon 7 citas» y, si se quitó alguna,
   cuáles no.

---

### Historia 2 - Un solo email al paciente (Prioridad: P1)

En vez de un email por cada cita, el paciente recibe uno con todas las fechas.

**Por qué esta prioridad**: ocho emails seguidos parecen spam y gastan el tope diario de Gmail.

**Escenarios de aceptación**:

1. **Dado** una serie nueva, **entonces** el paciente recibe un email «Tus próximas 8 citas en
   {negocio}» con la lista de fechas y horas, con copia al profesional (principio III).
2. **Dado** cada cita de la serie, **entonces** su recordatorio sale como siempre, el día que toca.
3. **Dado** «Confirmaciones» apagado en el negocio, **entonces** no sale el email de la serie.

---

### Historia 3 - Cambiar o cancelar la serie (Prioridad: P2)

Cada cita de la serie se puede cambiar sola. Además, desde la ficha de una cita de la serie se pueden
cancelar ella y las siguientes.

**Escenarios de aceptación**:

1. **Dado** la ficha de una cita de la serie, **entonces** dice «Cita 3 de 8» y tiene «Cancelar ésta
   y las siguientes».
2. **Dado** esa acción, **entonces** pide confirmar y cancela las citas activas desde ésa en adelante.
   El paciente recibe un solo email con las fechas canceladas (con la casilla «Avisar al paciente» de
   la spec 008).
3. **Dado** que se cambia la fecha o la hora de una cita de la serie, **entonces** sólo cambia ésa.

---

### Casos límite

- **Cupo del plan** (Free: 20 citas al mes): las citas de la serie que pasen del cupo se marcan en la
  lista con «supera el cupo del plan» y no se crean.
- **Día que el profesional no atiende o fuera de su horario:** se marca en la lista; se puede cambiar
  la hora o quitarla. El panel no impide agendar fuera de horario donde hoy ya lo permite.
- **Sesión con varias personas:** la serie repite a todas las personas.
- **A domicilio o virtual:** cada cita de la serie usa la misma modalidad y dirección.
- **Rol Profesional:** puede crear series en su propia agenda, como hoy con las citas sueltas.
- **ntfy:** la serie avisa con un solo aviso («serie de 8 citas desde el panel»), no uno por cita.
- **Reserva online:** las series sólo se crean desde el panel.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: El formulario de cita nueva DEBE ofrecer «Repetir»: cada semana, cada 2 semanas o cada
  mes, de 2 a 24 citas.
- **RF-002**: Antes de crear, DEBE mostrarse la lista de fechas, marcando las que chocan (otra cita,
  bloqueo, día sin atención o cupo del plan) con su motivo.
- **RF-003**: En la lista se DEBE poder cambiar la hora de una fecha o quitarla.
- **RF-004**: Crear la serie DEBE crear sólo las citas sin choque, todas con los mismos datos, y
  decir cuántas se crearon y cuáles no.
- **RF-005**: Si dos personas agendan a la vez la misma hora, ninguna cita de la serie DEBE quedar
  solapada. La que choque al crear se informa como no creada.
- **RF-006**: El paciente DEBE recibir un solo email con todas las fechas de la serie, con copia al
  profesional, si «Confirmaciones» está encendido.
- **RF-007**: Cada cita de la serie DEBE comportarse como una cita normal (recordatorio, estados,
  avisos de la spec 008, pago).
- **RF-008**: La ficha de una cita de la serie DEBE decir su número («3 de 8») y ofrecer «Cancelar
  ésta y las siguientes», con un solo email al paciente.
- **RF-009**: ntfy DEBE avisar una vez por serie, no por cada cita.
- **RF-010**: La actividad DEBE registrar la serie como una entrada («Agendó una serie de 8 citas»).
- **RF-011**: La beta DEBE tener lo mismo con sus datos de prueba.

### Entidades clave

- **Serie de citas**: agrupa las citas creadas juntas. Guarda cada cuánto se repiten y cuántas eran.
- **Cita**: gana a qué serie pertenece y su número en ella.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Agendar 8 sesiones semanales lleva menos de un minuto (hoy, 8 veces el formulario).
- **CE-002**: Ninguna cita de una serie queda solapada con otra del mismo profesional (comprobado en
  pruebas, también con dos series a la vez).
- **CE-003**: El paciente recibe un email por serie, no uno por cita.
- **CE-004**: Las pruebas pasan y el formulario se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- **24 citas como máximo** por serie: unos 6 meses semanales. Se puede crear otra serie después.
- **«Cada mes»** es el mismo día del mes (el 15 de cada mes), no «el tercer martes».
- **Editar la serie entera** (cambiar la hora de todas) queda fuera: se cancela desde una y se crea
  otra.
