# Tareas: Detalle de las tarjetas de «Crecimiento del mes»

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Sin migración. La beta no cambia.

## Fase 1: El desglose (backend)

- [X] T001 front/src/types/index.ts: `AdminGrowthDetail` (los dos periodos y las cuatro listas, sólo cifras por negocio) y `npm run sync:shared`
- [X] T002 back/src/services/admin-service.ts: `getGrowthDetail(ctx)` con `growthPeriodsSql` y las mismas condiciones que `platformGrowth` (citas sin canceladas, online, pacientes sin importados y por origen, negocios nuevos con plan y estado); back/src/routes/platform-routes.ts: `GET /admin/growth`
- [X] T003 back/tests/admin-overview.test.ts: «Detalle de las tarjetas (spec 042)»: el desglose de un negocio contado a mano, la suma igual a la tarjeta en los dos periodos, los orígenes, el importado que no cuenta, el suspendido con su estado, sin negocios en 0, sin datos de pacientes y sólo el super admin

## Fase 2: Las tarjetas y el panel (front)

- [X] T004 front/src/lib/data/repository.ts y api-repository.ts: `getGrowthDetail`; front/src/hooks/queries/use-admin.ts: `useAdminGrowthDetail(enabled)` con `queryKeys.admin.growthDetail` (5 minutos de caché)
- [X] T005 front/src/features/admin/growth-detail-sheet.tsx: el panel (a la derecha en el computador, desde abajo en el celular), con el encabezado, las filas por negocio que abren su ficha, los orígenes de los pacientes, los negocios nuevos, los estados de carga, error y vacío, y el pie de privacidad
- [X] T006 front/src/features/admin/growth-section.tsx: cada tarjeta, un botón que abre su panel (con el teclado, el foco vuelve a la tarjeta al cerrar); si el detalle y las tarjetas no cuadran, se vuelve a pedir lo más viejo

## Fase 3: Constitución y comprobación

- [X] T007 Constitución 1.40.0 en los dos repos (el detalle de las tarjetas, sólo con cifras por negocio) y los README (la ruta y el panel)
- [X] T008 Backend: `typecheck` y `npm test`. Front: build, lint y `check:contrast`
- [X] T009 Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro, con el ratón y el teclado, con capturas en `capturas/`
