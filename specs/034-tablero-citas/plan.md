# Plan de implementación: El tablero de las citas

**Rama**: `dev` · **Fecha**: 2026-10-22 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La vista:**
   - `front/src/features/calendar/calendar-utils.ts`: `CalendarView` suma `"board"` («Tablero»).
   - La página de la Agenda pasa el rango y el filtro de profesional, como a las otras vistas.
   - El selector Hoy / Semana / Mes va dentro del tablero y cambia sólo el rango que usa.
2. **`front/src/features/calendar/board-view.tsx`** (nuevo):
   - **Las columnas:** salen de una función pura, `boardColumnOf(appointment)`, en
     `board-columns.ts` con su prueba en `scripts/`, que aplica las reglas de la Historia 1.
   - **Las tarjetas:** con la fecha, la hora, los pacientes, el servicio, el profesional y las marcas;
     tocarlas abre la hoja de la cita que ya existe.
   - **Arrastrar:** con el arrastre nativo del navegador (sin dependencias nuevas), sólo en pantallas con
     puntero fino. La columna destino se resalta.
   - **El menú «Mover a…»:** el `DropdownMenu` de siempre, para el teclado y el celular. Sólo muestra los
     movimientos permitidos.
   - **La confirmación:** el diálogo dice qué va a pasar. Al pasar a Atendidas o Pagadas lleva la casilla
     «Avisar al paciente», con el mismo valor por defecto de hoy.
3. **Las acciones:** se reutilizan las mutaciones que ya existen:
   - el estado, `PATCH …/appointments/:id/status`;
   - el pago, `PUT …/payment`.

   «A Pagadas» desde Confirmadas hace las dos, una tras otra. La caché se invalida como en la hoja de la
   cita y, si algo falla, la tarjeta vuelve y sale el error.
4. **Los permisos:** los de `usePermissions` y el alcance del profesional, como la Agenda.
5. **El diseño:**
   - los tokens de la marca, que tras la spec 033 serán tomate;
   - el verde, sólo en «Confirmó que va»;
   - cada columna se desplaza por dentro;
   - a 390 px, las columnas se deslizan de lado dentro de su caja.
6. **La beta:** la misma vista, sobre su repositorio de datos de ejemplo. Antes, una copia de `src`.

**Migración:** ninguna. **Backend:** nada.

**Orden:** se empieza cuando termine la spec 033 (la marca en tomate), que toca los mismos tokens.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Dentro del panel, el paciente con su nombre, como la Agenda. Nada de la historia clínica |
| III. Decisiones | Sí | Completada queda fija; nada vuelve a Pendiente; las citas del panel nacen Confirmadas; el pago se puede quitar |
| Auditoría | Sí | Cada cambio pasa por los mismos endpoints, que ya van a la actividad |
| VII. Diseño | Sí | Tokens, 390 px sin desplazamiento horizontal, foco, teclado y movimiento reducido |

## Pruebas

- **`board-columns`:** cada estado y pago cae en su columna, y los movimientos permitidos y prohibidos.
- **Front:** build, lint y `check:contrast`.
- **El recorrido,** en Chromium a 1440 px y WebKit a 390 px, claro y oscuro, como propietario, recepción y
  profesional:
  - confirmar arrastrando;
  - Atendidas con y sin «Avisar al paciente»;
  - Pagadas;
  - quitar el pago;
  - un movimiento prohibido;
  - el menú con el teclado;
  - Hoy, Semana y Mes, y el filtro de profesional.
- **La beta:** build y recorrido corto.
