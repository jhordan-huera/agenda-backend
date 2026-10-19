---

description: "Tareas de «Tu día que se desliza»"
---

# Tareas: «Tu día» que se desliza

**Entrada**: `specs/026-tu-dia-deslizable/`. El dueño del producto aprobó la spec (con la beta) y el plan
el 2026-10-19 («si apruebo lo del tu día» y «apruebo el plan»).

**Rutas:** `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`. El backend
no se toca.

## Fase 1: Historias 1 a 4, la franja (P1)

- [x] T001 [US1] `front/src/features/dashboard/day-ribbon.tsx`, el ancho según las horas a la vista:
  - un `ResizeObserver` mide el ancho visible;
  - las horas a la vista son 3,5 si el ancho es menor de 640 px y 7 si no;
  - el ancho es `max(visible, horas del día × visible / horas a la vista)`;
  - se quita `sm:min-w-[34rem]`.
- [x] T002 [US1] En el mismo archivo, la hora y el nombre siempre en cada cita: sin `hidden
  sm:block`, la hora arriba y el nombre debajo con `truncate`, y `px-1.5 py-1`.
- [x] T003 [US2] [US3] En el mismo archivo, la barra de controles sobre la franja:
  - ‹ y «← N antes», «Ahora», «N cita(s) más tarde →» y ›;
  - el `onScroll` pasivo, limitado a un cuadro;
  - el desplazamiento suave, salvo con `prefers-reduced-motion`;
  - las flechas deshabilitadas en los extremos;
  - sin barra si el día cabe entero;
  - «Ahora» sólo dentro del día.
- [x] T004 [US2] En el mismo archivo:
  - dónde empieza: en «ahora», o en la primera cita o el horario antes del día, o en la última cita
    después del día;
  - sólo la primera vez;
  - al cambiar el ancho, conserva el minuto del borde izquierdo.
- [x] T005 [US4] En el mismo archivo, accesibilidad:
  - la región con `aria-label` «Tu día, de HH:mm a HH:mm»;
  - los botones con nombre;
  - lo que ya hacía, igual: el horario, los bloqueos, lo pasado, la línea de «ahora», el borde lila,
    los estados, varias agendas y el detalle al tocar.

## Fase 2: La beta

- [x] T006 Copiar `day-ribbon.tsx` a `beta/src/features/dashboard/` (hoy son idénticos) y correr
  `npm run build` en la beta.

## Fase 3: Comprobación

- [x] T007 `front/`: `npm run build`, `npm run lint` y `npm run check:contrast`.
- [x] T008 El recorrido del plan: Chromium a 1440 px y WebKit a 390 px, en claro y oscuro, con dos
  citas de hoy separadas y un día corto.
- [x] T009 `reporte.md` y el commit en `dev` del front.
