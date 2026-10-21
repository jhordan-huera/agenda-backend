---

description: "Tareas de «Una portada más profesional»"
---

# Tareas: Una portada más profesional

**Entrada**: `specs/030-portada-profesional/`. El dueño del producto aprobó la dirección, la spec y la
beta el 2026-10-21.

**Rutas:** `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

## Fase 1: La portada (P1)

- [x] T001 [US1] `front/src/features/landing/` y `front/src/pages/landing-page.tsx`: las ocho secciones
  del plan, con la dirección aprobada. Se reutiliza lo que sirva y se quita lo que quede sin uso.
- [x] T002 [US1] El tema claro y oscuro, el movimiento reducido y el foco.

## Fase 2: Comprobación

- [x] T003 `front/`: build, lint y `check:contrast`. El recorrido del plan, con capturas.
- [x] T004 La revisión de diseño (interface-design: design-review) y la lista de UI UX Pro Max. Se
  corrige lo que salga.

## Fase 2b: El acceso (ampliación)

- [x] T007 [US2] `front/src/pages/auth/` y su layout: el estilo de la portada, sin cambiar lo que hace.
  Build, lint, `check:contrast` y el recorrido del login, el registro y la verificación en dos pasos,
  con capturas.

## Fase 3: La beta y el cierre

- [x] T005 `beta/`: la misma portada y el mismo acceso (antes, una copia de `src`), y `npm run build`.
- [ ] T006 `reporte.md` y el commit en `dev` del front.
