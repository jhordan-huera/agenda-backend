# Plan de implementación: «Tu día» que se desliza

**Rama**: `dev` · **Fecha**: 2026-10-19 · **Spec**: [spec.md](./spec.md)

## Cómo es hoy

`src/features/dashboard/day-ribbon.tsx` (`DayRibbon`) dibuja el día entero, de `bounds.start` a
`bounds.end` (`dayBounds()` en `day-plan.ts`: el horario y las citas, redondeado a la hora):
- **En el celular,** la franja ocupa el ancho del contenedor, sin desplazarse. La hora y el nombre
  van con `hidden sm:block`, así que no se ven.
- **Desde `sm`,** tiene `min-w-[34rem]` y sólo se desliza si no cabe. La primera vez, se centra en
  «ahora».
- **Las horas de abajo** las elige `hoursThatFit()`, según el ancho real, para que no se pisen.

## Diseño

Sólo cambia `day-ribbon.tsx` y, en la beta, la copia del mismo archivo.

1. **El ancho, según las horas a la vista:**
   - un `ResizeObserver` mide el ancho visible de la franja, `viewport`;
   - las horas a la vista son **3,5 en el celular** (`viewport < 640`) y **7 en el computador**;
   - el ancho de la franja es `max(viewport, horas del día × viewport / horas a la vista)`. Un día
     corto cabe entero, sin desplazamiento, como pide el caso límite;
   - se quita `sm:min-w-[34rem]`;
   - `hoursThatFit()` ya usa el ancho real, así que con más espacio salen todas las horas.
2. **La hora y el nombre siempre:**
   - en el botón de cada cita se quita `hidden sm:block`;
   - la hora (`font-bold tabular-nums`) va arriba y no se corta;
   - el nombre va debajo, con `truncate`;
   - el relleno es `px-1.5 py-1`;
   - en una cita tan corta que no cabe ni la hora, ésta se recorta (`overflow-hidden`), y el
     `aria-label` sigue diciendo todo.
3. **Qué se ve y los avisos:**
   - un `onScroll` (pasivo, una vez por `requestAnimationFrame`) guarda el minuto de cada borde
     visible;
   - de ahí salen las citas que quedan **antes** (terminan antes del borde izquierdo) y **después**
     (empiezan después del derecho);
   - una barra pequeña sobre la franja lleva:
     - a la izquierda: ‹ y «← 2 antes»;
     - al centro: «Ahora»;
     - a la derecha: «1 cita más tarde →» y ›;
   - **‹ y ›** desplazan un 80 % de lo visible (`scrollBy`, con `behavior: "smooth"` salvo con
     `prefers-reduced-motion`). En los extremos quedan deshabilitadas;
   - **los avisos** llevan a la cita más cercana de ese lado, dejándola al 15 % del borde;
   - **«Ahora»** sale sólo si la hora actual está dentro del día, y centra la línea de «ahora»;
   - **si el día cabe entero,** no sale la barra.
4. **Dónde empieza** (sólo la primera vez, como hoy, con la referencia `centered`):
   - durante el día, centrada en «ahora»;
   - antes del día, en la primera cita, o en el inicio del horario si no hay citas;
   - después del día, en la última cita.
5. **Al cambiar el ancho** (girar el celular o la ventana): antes de recalcular se guarda el minuto del
   borde izquierdo, y después se vuelve a él, para que no salte de hora.
6. **Accesibilidad:**
   - la franja es `role="region"` con `aria-label` «Tu día, de 08:00 a 20:00»;
   - las flechas llevan `aria-label` («Horas anteriores» y «Horas siguientes»);
   - «Ahora» lleva «Volver a la hora actual»;
   - los avisos son botones con su texto;
   - al recorrer las citas con Tab, el navegador desplaza la franja hasta cada una;
   - el anillo de foco se queda como hoy.
7. **CPU:**
   - nada con intervalos;
   - el `onScroll` se limita a un cuadro;
   - la hora actual ya llega de `useBusinessNow` una vez por minuto;
   - no hay pedidos nuevos a la API.

**Migración:** ninguna. **Backend:** nada.

## Pruebas

**Front:**
- `npm run build`, `npm run lint` y `npm run check:contrast`.
- **El recorrido**, con la base, la API y el front de prueba de la spec 025, en Chromium a 1440 px y
  WebKit a 390 px, en claro y oscuro. Antes se crean dos citas de hoy separadas, en la Clínica
  Dental, con sql.
  - **Al abrir:**
    - se ve la hora actual;
    - la cita visible lleva su hora y su nombre;
    - el aviso del borde cuenta la otra cita, y al tocarlo la franja llega a ella, con su nombre;
  - **los controles:**
    - ‹ y › mueven la franja y se deshabilitan en los extremos;
    - «Ahora» vuelve;
  - **la página** no se desplaza de lado, y tocar una cita abre su detalle;
  - **un día corto** (un horario de 2 horas puesto con sql) no lleva barra ni desplazamiento;
  - **las capturas** de cada caso.

**Beta:** se copia `day-ribbon.tsx` (hoy es idéntico) y `npm run build`.

## Publicación

Sólo el front y, aparte, la beta. Sin migración ni backend.
