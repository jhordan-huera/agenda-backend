---

description: "Tareas del inicio del super admin con datos importantes"
---

# Tareas: Inicio del super admin con datos importantes

**Entrada**: `specs/006-inicio-super-admin/` · **Pruebas**:
- backend: `tests/admin-overview.test.ts` (nueva) y `tests/backup.test.ts` (ampliada);
- front: build, lint y recorrido con Playwright.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta.

## Fase 1: Base

- [x] T001 Crear `back/db/migrations/034_backup_runs.sql`:
  - la tabla `backup_runs (id bigint identidad, ran_at timestamptz not null default now(), ok boolean not null, size_bytes bigint, error text not null default '')`;
  - el índice `(ran_at desc)` y RLS.

  Aplicarla en la base local.
- [x] T002 [P] En `front/src/types/index.ts`:
  - `GrowthPair`;
  - `PlatformStats.growth` y `PlatformStats.health`, como en data-model.md;
  - `AdminBusinessSummary.growth`.

  Después, `npm run sync:shared` en back/.

## Fase 2: Historia 2 - Copia de seguridad anotada (P1, la parte del backend)

- [x] T003 [US2] En `back/scripts/backup.ts`:
  - `recordBackup()` con un `pg.Client` aparte (`connectionTimeoutMillis` 5000), que nunca lanza un error;
  - una fila buena al terminar, con el tamaño del archivo cifrado;
  - una fallida en el `catch`, con el motivo de `scrub`, también cuando se entregó con problemas;
  - borrar las filas de más de un año.
- [x] T004 [US2] En `back/tests/backup.test.ts`: la copia buena deja una fila `ok`, con su tamaño, y una que falla deja una `ok = false` con el motivo limpio.

## Fase 3: Historias 1, 2 y 3 - Datos del backend (P1)

- [x] T005 [US1] En `back/src/services/admin-service.ts`:
  - `growthPeriodsSql` (D1);
  - en `getStats`, `growth` con citas sin canceladas, reservas online, pacientes y negocios nuevos (D2).
- [x] T006 [US2] En `getStats`, `health` (D5):
  - emails de hoy (enviados, fallidos sin los descartados, en cola);
  - último cron y sus errores;
  - última copia;
  - intentos fallidos en 24 h y cuentas en alerta.
- [x] T007 [US3] En `summarizeBusinesses`, `growth` de cada negocio, con los mismos periodos.
- [x] T008 Crear `back/tests/admin-overview.test.ts` con los casos de quickstart.md §1.

## Fase 4: Historias 1 a 4 - Pantalla (front)

- [x] T009 [P] [US3] `front/src/features/admin/sales-lists.ts`: `nearLimit`, `topGrowing`, `idle` y `nextPlan`. Borrar `attention.ts`.
- [x] T010 [P] [US1] `front/src/features/admin/growth-section.tsx`:
  - 4 cifras;
  - la diferencia en %, «nuevo» o «igual», con ▲ o ▼ y su texto;
  - el periodo de comparación.
- [x] T011 [P] [US2] `front/src/features/admin/health-section.tsx`:
  - 4 cuadros con estado (bien, aviso o problema), con ícono y texto;
  - los umbrales de la spec;
  - el resumen «Todo bien» o «N avisos».
- [x] T012 [P] [US3] `front/src/features/admin/sales-section.tsx`: 3 listas con un enlace a cada ficha y un texto cuando están vacías.
- [x] T013 [US4] `front/src/pages/admin/admin-overview-page.tsx`:
  - saludo, fecha y la línea de negocios activos por plan;
  - «Nuevo negocio»;
  - las solicitudes pendientes;
  - los 3 bloques.

  Borrar `attention-card.tsx`, `business-activity-list.tsx` y `signups-chart.tsx`.

## Fase 5: Cierre

- [x] T014 Pasar `npm run typecheck` y `npm test` en back/, y `npm run build` y `npm run lint` en front/
- [x] T015 Recorrido con Playwright (quickstart.md §2), en escritorio y a 390 px
- [x] T016 Beta: los mismos archivos del front y `src/lib/data/mock/admin-repository.ts` (`growth`, `health` no disponible y `growth` por negocio). Build, lint y abrir `/admin`.
- [x] T017 [P] `back/README.md`: el inicio del super admin y la tabla `backup_runs`
- [x] T018 Commits sin firma de IA. Después, `/speckit-reporte`.

## Fase 6: Historia 5 - Gráficos (ampliación del 2026-10-14)

- [x] T019 [US5] Backend: `growth.daily` y `health.emailsByDay` en `back/src/services/admin-service.ts`, y sus pruebas en `admin-overview.test.ts`:
  - la suma diaria de este mes es igual a la cifra del mes;
  - son 14 días y hoy es el último.
- [x] T020 [P] [US5] Tipos compartidos (`DailyCounts`, `daily`, `emailsByDay`) en el front y `npm run sync:shared`
- [x] T021 [P] [US5] `front/src/features/admin/growth-chart.tsx`: líneas acumuladas (este mes y el mes pasado) con selector de cifra y «Ver como tabla»
- [x] T022 [P] [US5] `front/src/features/admin/emails-chart.tsx`: barras de enviados y fallidos de 14 días, con «Ver como tabla»
- [x] T023 [P] [US5] `front/src/features/admin/business-growth-chart.tsx`: barras horizontales de hasta 8 negocios, con el nombre encima y las cifras escritas al lado (en vez de «Ver como tabla»: se leen enteras en el celular)
- [x] T024 [US5] Integrarlos en los tres bloques. Beta: `daily` desde sus datos (sin emails). Build, lint, recorrido a 390 px, commits y reporte.

## Dependencias

- T001 y T002 bloquean todo.
- T003 → T004.
- T005, T006 y T007 → T008.
- La fase 4 necesita T002.
- La beta va al final.
