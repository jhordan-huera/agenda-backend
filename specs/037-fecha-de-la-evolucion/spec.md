# Especificación: Elegir y corregir la fecha de una evolución

**Carpeta**: `specs/037-fecha-de-la-evolucion` (rama de trabajo: `dev`) · **Creada**: 2026-10-28

**Estado**: Implementada (2026-10-28)

**Repos**:
- **agenda-backend:** la fecha al registrar, la ruta para corregirla, la actividad y la migración 053.
- **agenda-front:** la fecha en «Nueva evolución», «Cambiar fecha» en cada evolución y las dos fechas en la ficha, la impresión y la descarga.
- **La beta:** lo mismo, con sus datos de ejemplo.

## Pedido

Una clienta psicóloga, el 2026-10-27: «ayer ingresé una evolución pero no me permitió cambiar la fecha; la
registra con la fecha en que la ingreso».

El dueño del producto, el 2026-10-28, eligió:
1. **Cuándo:** la fecha se elige al registrar la evolución **y también se puede corregir después**. Cada
   cambio queda en la actividad.
2. **Hasta cuándo:** **hasta 30 días atrás**, nunca una fecha futura.

Hoy la constitución dice «las fechas de consentimiento y de las evoluciones clínicas las pone el sistema».
Cambia sólo para la fecha de la evolución. La del consentimiento sigue como está.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Registrar una evolución de otro día (Prioridad: P1)

1. **Dado** «Nueva evolución», **entonces** el campo «Fecha de la consulta»:
   - trae hoy;
   - deja elegir hasta 30 días atrás;
   - no deja una fecha futura.
2. **Dado** que se elige una cita en «Cita», **entonces** la fecha pasa a la de esa cita, si está dentro de
   los 30 días.
3. **Dado** una fecha fuera de esos límites, **entonces** no se guarda y se dice por qué.

### Historia 2 - Corregir la fecha de una evolución ya guardada (Prioridad: P1)

1. **Dado** una evolución, **cuando** se toca «Cambiar fecha», se elige otra y se confirma, **entonces**:
   - la evolución queda con la fecha nueva y se reordena en la historia;
   - la actividad dice quién la cambió, de qué fecha a cuál y cuándo.
2. **Dado** la fecha nueva, **entonces** debe estar entre los 30 días anteriores al día en que se
   registró la evolución y ese mismo día. Así una evolución vieja no se puede llevar a cualquier fecha.
3. **Dado** el contenido de la evolución, **entonces** sigue sin poder modificarse: para corregirlo,
   la aclaración de siempre.
4. **Dado** quién puede cambiar la fecha, **entonces** son los mismos que pueden añadirle una
   aclaración: quien tiene acceso de escritura a esa historia clínica.

### Historia 3 - Ver las dos fechas (Prioridad: P1)

1. **Dado** una evolución en la ficha, en la impresión o en la descarga de los datos, **entonces** se ve:
   - la **fecha de la consulta**;
   - aparte, **cuándo se registró**, con su hora, que pone el sistema y nunca cambia.

### Casos límite

- **La zona horaria:** «hoy» y los 30 días son los del negocio.
- **Una evolución de una cita de varios pacientes:** cada evolución tiene su fecha, como hoy.
- **El modo soporte:** sigue sin ver ni cambiar la historia clínica.
- **Las evoluciones de antes del cambio** se pueden corregir con la misma regla.

## Requisitos *(obligatorio)*

- **RF-001**: «Nueva evolución» DEBE dejar elegir la fecha de la consulta: hoy por defecto, hasta 30 días atrás y nunca futura. Elegir una cita propone su fecha.
- **RF-002**: Una evolución guardada DEBE poder cambiar de fecha, dentro de los 30 días anteriores a su registro y sin pasar de ese día. Pueden hacerlo los mismos que añaden aclaraciones.
- **RF-003**: Cada cambio de fecha DEBE quedar en la actividad de la historia clínica, con la fecha anterior y la nueva, y guardarse 5 años como el resto de esa actividad.
- **RF-004**: El contenido de la evolución y su fecha de registro NO DEBEN poder modificarse, tampoco con SQL directo. La fecha de la consulta, sólo dentro de la regla de RF-002, y eso también lo comprueba la base.
- **RF-005**: La ficha, la impresión y la descarga DEBEN mostrar la fecha de la consulta y cuándo se registró.
- **RF-006**: La constitución DEBE recoger la regla nueva.
- **RF-007**: La beta DEBE llevar lo mismo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - registrar con una fecha pasada, con la de hoy, con una futura y con una de hace más de 30 días;
  - cambiar la fecha dentro y fuera de la regla;
  - la actividad;
  - quién puede y quién no;
  - que la base rechace por SQL un cambio del contenido y una fecha fuera de la regla.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y `check:contrast` en el front y la beta, sin errores.
- **CE-003**: El recorrido funciona en el computador y en el celular: registrar con otra fecha, cambiarla y ver las dos fechas.

## Supuestos

- **La fecha de registro es la que ya se guarda** (`created_at`). No hace falta otra columna.
- **La migración 053** sólo cambia las protecciones de la tabla: no toca datos.
