# Especificación: Las citas completadas quedan fijas

**Carpeta**: `specs/020-citas-completadas-fijas` (rama de trabajo: `dev`) · **Creada**: 2026-10-16

**Estado**: Implementada (2026-10-17)

**Repos**:
- **agenda-backend:** la regla, que se cumple en la API.
- **agenda-front:** la ficha, la corrección y el formulario.
- **La beta:** sí, por defecto.

## Pedido

El dueño del producto, el 2026-10-16: «quiero que las citas que ya están completadas ya no se vuelvan
a cambiar el estado; si ya pasó el estado a confirmada, no se cambien». Hoy cualquier estado puede
pasar a cualquier otro. Una cita completada se puede volver a abrir o editar, y eso cambia los
reportes, la analítica y el historial del paciente.

**Decisiones del dueño del producto (2026-10-16):**
1. **Sólo «Completada» queda fija.** «No asistió» y «Cancelada» se pueden seguir cambiando.
2. **Una cita «Confirmada» sólo avanza:** a Completada, No asistió o Cancelada. Nunca vuelve a
   Pendiente.
3. **Si alguien se equivoca, la corrige el propietario,** con un motivo obligatorio que queda en la
   actividad. Los demás roles (administradores, Recepción y Profesional) no pueden.
4. **De una cita completada sólo se pueden cambiar el pago y las notas.** No se pueden cambiar la
   fecha, la hora, el servicio, el precio, el profesional ni los pacientes.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Una cita completada no cambia (Prioridad: P1)

**Prueba independiente:** completar una cita y comprobar que ni el panel ni la API dejan cambiar su
estado ni sus datos, salvo el pago y las notas.

**Escenarios de aceptación**:

1. **Dado** una cita «Completada», **entonces** su ficha no ofrece los botones para cambiar el estado
   y dice «Completada: ya no se puede cambiar».
2. **Dado** el formulario «Editar» de una cita completada, **entonces** sólo se pueden cambiar las
   notas, y el resto se ve sin poder tocarlo.
3. **Dado** una cita completada, **entonces** se puede marcar como pagada, ver o subir su comprobante
   y escribir en la historia clínica.
4. **Dado** que alguien intenta cambiarla por otra vía (otra pestaña abierta o la API), **entonces**
   la API lo rechaza con un mensaje claro y no cambia nada.

### Historia 2 - Una cita confirmada sólo avanza (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** una cita «Confirmada», **entonces** se puede pasar a Completada, No asistió o Cancelada,
   pero el botón «Pendiente» no se puede usar. Su ayuda dice «Una cita confirmada no vuelve a
   Pendiente».
2. **Dado** el formulario «Editar» de una cita confirmada, **entonces** su lista de estados no ofrece
   «Pendiente».

### Historia 3 - El propietario corrige un error (Prioridad: P1)

**Prueba independiente:** como propietario, corregir una cita completada a «No asistió» con un motivo,
y comprobar la actividad. Con otro rol, comprobar que no se puede.

**Escenarios de aceptación**:

1. **Dado** el propietario (o el super admin en modo soporte) ante una cita completada, **entonces**
   ve «Corregir estado».
2. **Dado** «Corregir estado», **entonces**:
   - elige el estado correcto: Confirmada, No asistió o Cancelada;
   - escribe el motivo, que es obligatorio (de 10 a 300 caracteres);
   - decide si avisa al paciente, con la casilla apagada por defecto.
3. **Dado** la corrección, **entonces** la actividad dice «Corrigió el estado de la cita de … de
   Completada a No asistió. Motivo: …».
4. **Dado** un administrador, Recepción o el rol Profesional, **entonces** no ve «Corregir estado» y
   la API le responde que sólo el propietario puede corregirlo.

### Casos límite

- **«Marcar todas como completadas»** (spec 018) sigue igual: sólo cierra las que están abiertas.
- **El paciente** sólo puede cancelar desde su enlace las citas Pendientes o Confirmadas, como hoy.
- **«Cancelar ésta y las siguientes»** sólo toca las Pendientes y Confirmadas, como hoy.
- **Una cita con varios pacientes** se fija entera.
- **Después de corregirla,** la cita deja de estar completada y sigue las reglas de su nuevo estado.
- **Ninguna cita vuelve a «Pendiente»** una vez que salió de ese estado.

## Requisitos *(obligatorio)*

- **RF-001**: Una cita «Completada» NO DEBE cambiar de estado, salvo por la corrección del
  propietario (RF-004).
- **RF-002**: De una cita «Completada», el panel y la API sólo DEBEN dejar cambiar el pago, los
  comprobantes y las notas.
- **RF-003**: Ninguna cita DEBE volver a «Pendiente» una vez que salió de ese estado. Una
  «Confirmada» sólo pasa a Completada, No asistió o Cancelada.
- **RF-004**: Sólo el propietario (y el super admin en modo soporte) DEBE poder corregir una
  «Completada» a Confirmada, No asistió o Cancelada, con un motivo obligatorio (de 10 a 300
  caracteres). Queda en la actividad.
- **RF-005**: La API DEBE hacer cumplir estas reglas aunque el panel no se haya actualizado, con un
  mensaje claro.
- **RF-006**: «No asistió» y «Cancelada» se DEBEN poder seguir cambiando, salvo volver a «Pendiente».
- **RF-007**: La beta DEBE tener las mismas reglas.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Ningún intento de cambiar una cita completada, desde la ficha, el formulario o la API,
  la cambia, salvo la corrección del propietario con motivo. Se comprueba con pruebas automáticas.
- **CE-002**: Cada corrección deja en la actividad su motivo, el estado anterior y el nuevo.
- **CE-003**: Las pruebas pasan y la ficha funciona a 390 px, en los dos modos.

## Supuestos

- **La corrección no avisa al paciente por defecto,** porque es un arreglo interno. La casilla «Avisar
  al paciente» está, pero apagada.
- **«Nunca vuelve a Pendiente»** se aplica a todos los estados, no sólo a «Confirmada». Una
  «Cancelada» que se reactiva pasa a «Confirmada».
- **La constitución sube a 1.17.0,** con una línea en el principio III.
