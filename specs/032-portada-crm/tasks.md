---

description: "Tareas de «La portada al estilo de una plataforma de ventas»"
---

# Tareas: La portada al estilo de una plataforma de ventas

**Entrada**: `specs/032-portada-crm/`. El dueño del producto aprobó la spec y el plan el 2026-10-22.

**Rutas:** `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

## Fase 1: La portada (US1, P1)

- [x] T001 `front/src/index.css`: `--cta` y `--cta-foreground` (#c2410c con blanco), y el estado al pasar el ratón. `front/scripts/check-contrast.ts`: el par del botón.
- [x] T002 `front/src/features/landing/`: las doce partes de la Historia 1, reutilizando lo de la spec 030 y quitando lo que quede sin uso:
  - la semana del panel, compartida con el acceso;
  - `facts-band`, `appointment-flow-section`, `automation-section`, `integrations-section` y `testimonial-section` (con `TESTIMONIAL = null`).
- [x] T003 `front/src/pages/landing-page.tsx`: el orden nuevo y los enlaces de la barra.

## Fase 2: Comprobación

- [x] T004 `front/`: build, lint y `check:contrast`. El recorrido del plan, con capturas.

## Fase 3: La beta y el cierre

- [x] T005 `beta/`: la misma portada (antes, una copia de `src`), y `npm run build`.
- [x] T006 `reporte.md` y los commits en `dev`, después de que el dueño apruebe las capturas.
