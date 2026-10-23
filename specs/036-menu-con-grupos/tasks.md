---

description: "Tareas de «El menú con grupos y que se encoge»"
---

# Tareas: El menú con grupos y que se encoge

**Entrada**: `specs/036-menu-con-grupos/`. El dueño del producto aprobó la spec y el plan el 2026-10-22 («si aprobado»).

**Rutas:** `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

## Fase 1: Los grupos (US1, P1)

- [x] T001 `front/src/components/layout/nav-items.ts` (`ADMIN_NAV_GROUPS`) y `sidebar-nav.tsx` con grupos y su título.

## Fase 2: Encoger (US2, P1)

- [x] T002 `front/src/components/layout/sidebar-collapse.tsx`: el contexto, lo guardado en el equipo y la ayuda con el nombre de cada icono.
- [x] T003 `front/src/components/layout/app-shell.tsx`: el ancho del menú y del contenido, con la transición; el cajón del celular, siempre completo.
- [x] T004 `admin-sidebar.tsx`, `sidebar-content.tsx`, `user-menu.tsx` e `install-app.tsx`: la versión de iconos y el botón «Ocultar menú» / «Mostrar menú».

## Fase 3: Comprobación y cierre

- [x] T005 `front/`: build, lint y `check:contrast`. El recorrido del plan, con capturas.
- [x] T006 `beta/`: lo mismo (antes, una copia de `src`), con `npm run build`.
- [x] T007 `reporte.md` y los commits en `dev`.
