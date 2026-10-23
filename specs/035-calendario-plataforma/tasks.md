---

description: "Tareas de «El calendario de la plataforma, sólo con cifras»"
---

# Tareas: El calendario de la plataforma, sólo con cifras

**Entrada**: `specs/035-calendario-plataforma/`. El dueño del producto aprobó la spec y el plan el 2026-10-22 («si por favor»).

**Rutas:** `back/` = agenda-backend y `front/` = agenda-front. La beta no lo lleva.

## Fase 1: Lo compartido

- [x] T001 `front/src/types` (`AdminCalendar`, `AdminCalendarDay`) y `front/src/lib/validations/admin.ts` (la consulta: `from`/`to` de 42 días como mucho, `date`, `hour` 0–23, `category` y `businessId`); `npm run sync:shared` en `back/`.

## Fase 2: Las cifras (US1, US2 y US3, P1)

- [x] T002 `back/src/services/admin-calendar-service.ts`: el mes y la semana (`days`, `hours`) y el panel de un día o una hora, sólo con agregados y sólo los negocios activos.
- [x] T003 `back/src/routes/platform-routes.ts`: `GET /api/admin/calendar` y `GET /api/admin/calendar/day`.
- [x] T004 `back/tests/admin-calendar.test.ts`: las cifras, «sin cerrar», los filtros, el suspendido, los límites, los permisos y que no salga nada del paciente ni del servicio.

## Fase 3: La página

- [x] T005 `front/src/lib/data` y `front/src/hooks/queries/use-admin.ts`: las dos llamadas y sus consultas.
- [x] T006 `front/src/features/admin/calendar/`: el mes, la semana, el panel del día y la intensidad (`calendar-intensity.ts`, con `scripts/check-admin-calendar.ts`).
- [x] T007 `front/src/pages/admin/admin-calendar-page.tsx`, la ruta y «Calendario» en el menú.

## Fase 4: Comprobación y cierre

- [x] T008 La constitución 1.29.0 en los dos repos (principio II).
- [x] T009 `front/`: build, lint, `check:contrast` y `check:admin-calendar`. `back/`: `typecheck` y `npm test`. El recorrido del plan, con capturas.
- [x] T010 `reporte.md` y los commits en `dev`.
