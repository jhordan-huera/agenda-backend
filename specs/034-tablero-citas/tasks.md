---

description: "Tareas de «El tablero de las citas»"
---

# Tareas: El tablero de las citas

**Entrada**: `specs/034-tablero-citas/`. El dueño del producto aprobó la spec y el plan el 2026-10-22.

**Rutas:** `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

## Fase 1: Ver el tablero (US1, P1)

- [ ] T001 `front/src/features/calendar/board-columns.ts`: `boardColumnOf` y los movimientos permitidos, con su prueba en `front/scripts/`.
- [ ] T002 `front/src/features/calendar/calendar-utils.ts` y la página de la Agenda: la vista `board` («Tablero»), que se recuerda como las demás.
- [ ] T003 `front/src/features/calendar/board-view.tsx`:
  - las cinco columnas, con la plegada;
  - las tarjetas con sus marcas;
  - el selector Hoy / Semana / Mes con sus flechas y el filtro de profesional;
  - tocar abre la cita.

## Fase 2: Mover (US2, P1)

- [ ] T004 Arrastrar, sólo con puntero fino, y el menú «Mover a…» con la confirmación y «Avisar al paciente», usando las mutaciones de estado y de pago que ya existen. Los permisos, el alcance y la vuelta atrás si falla.

## Fase 3: Comprobación y cierre

- [ ] T005 `front/`: build, lint, `check:contrast` y la prueba de `board-columns`. El recorrido del plan, con capturas.
- [ ] T006 `beta/`: la misma vista (antes, una copia de `src`), con `npm run build`.
- [ ] T007 `reporte.md` y los commits en `dev`.
