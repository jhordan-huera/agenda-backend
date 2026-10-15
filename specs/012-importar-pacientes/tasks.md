---

description: "Tareas de «Importar pacientes desde Excel o CSV»"
---

# Tareas: Importar pacientes desde Excel o CSV

**Entrada**: `specs/012-importar-pacientes/` (plan aprobado el 2026-10-14, con la decisión del dueño del
producto de ese día: los importados no cuentan como «pacientes nuevos del mes»).

**Pruebas**:
- **Backend:**
  - suite nueva: `tests/client-import.test.ts`;
  - suites que se actualizan: `booking-alert` y `cron`.
- **Front:** build, lint y el recorrido con Playwright del quickstart, en escritorio y a 390 px.
- **Beta:** queda para después (ver Fase 6).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta. Las decisiones R1–R12
están en `research.md`.

## Fase 1: Base

- [x] T001 Código compartido en `front/` y después `npm run sync:shared` en `back/` (el archivo nuevo se
  crea antes vacío en `back/src/shared/lib/validations/client-import.ts`):
  - `src/lib/validations/client-import.ts` (nuevo, R5): `MAX_IMPORT_ROWS`, `MAX_IMPORT_BYTES`,
    `IMPORT_COLUMNS`, `normalizeHeader`, `guessColumns`, `findHeaderRow`, `rowFromCells`,
    `prepareImportRow`, `classifyImportRows`, `importSummary` y `clientImportSchema`;
  - `src/lib/permissions.ts`: el permiso `clients.import` (propietario y administradores, R1);
  - `src/types/index.ts`: `ClientSource`, `Client.source`, `ClientImportRow` y `ClientImportResult`.
- [x] T002 `back/db/migrations/039_client_import.sql` (data-model): el origen `'import'`.

## Fase 2: Historias 1 y 2 en la API (P1)

- [x] T003 [US2] `back/src/db/columns.ts`: `Client.source` en `clientColumns`.
- [x] T004 [US1] `back/src/services/plan-limits.ts`: `remainingClientSlots`.
- [x] T005 [US1] `back/src/services/client-import-service.ts` (nuevo, R6 y R7): todo en una
  transacción con el negocio bloqueado, la misma clasificación que la revisión, una sola sentencia de
  alta con `on conflict … do nothing`, sin emails y una entrada `client.imported` si se creó alguno.
- [x] T006 [US1] `back/src/app.ts` (la ruta no pasa por el lector JSON de 2 MB) y
  `back/src/routes/business-routes.ts`: `POST …/clients/import` con la sesión primero, el límite
  `importar-pacientes` (20 cada 15 min) y el JSON de 4 MB.
- [x] T007 [US2] `back/src/services/booking-alerts.ts`: `findClientImports`, `clientImportNotice` y
  `MAX_IMPORT_NOTICES` (R8); `back/src/jobs/scheduled-tasks.ts` y `back/scripts/cron.ts`: el aviso de
  cada importación, «…y N importaciones más» y «importaciones: N» en la línea del registro.
- [x] T008 [US2] `back/src/services/admin-service.ts`: los importados no cuentan como pacientes nuevos
  del mes en el Inicio del super admin (decisión del dueño, R10).

## Fase 3: Pruebas del backend

- [x] T009 `back/tests/client-import.test.ts` (quickstart §1).
- [x] T010 Actualizar `booking-alert` (el aviso de una importación y «…y N importaciones más») y `cron`
  («importaciones: N»).
- [x] T011 `npm run typecheck` y todas las suites con `env -u DATABASE_URL npm test`.

## Fase 4: Historias 1 y 2 en el front (P1)

- [x] T012 [US1] `read-excel-file` 9.3.12 con la versión fija y `npm audit` (R3).
- [x] T013 [US1] `front/public/plantilla-pacientes.xlsx` (R9), hecha con un guion de Python del
  scratchpad, sólo con la biblioteca estándar.
- [x] T014 [US1] `front/src/lib/csv.ts` (`decodeCsv`, `parseCsv` y `toCsv`, R4); `export-audit.ts` usa
  `toCsv`.
- [x] T015 [US1] Datos: `clients.importMany` (`repository.ts`, `api-repository.ts`) y
  `useImportClients` (`use-clients.ts`).
- [x] T016 [US1] `front/src/features/clients/import/`: `read-spreadsheet.ts` (Excel con import
  dinámico o CSV) y los pasos archivo, columnas, revisión y resultado (R2).
- [x] T017 [US1] `front/src/pages/dashboard/client-import-page.tsx`, la ruta
  `/dashboard/clients/importar` y el botón «Importar pacientes» en Clientes (también en el estado vacío).
- [x] T018 [US2] `front/src/features/dashboard/dashboard-metrics.ts`: los importados no cuentan como
  nuevos del mes en el Inicio del negocio (decisión del dueño, R10).
- [x] T019 Front: `npm run build` y `npm run lint`.

## Fase 5: Comprobación

- [x] T020 Archivos de prueba inventados (quickstart §0) y el lector de CSV con un guion de Node.
- [x] T021 Recorrido con Playwright del quickstart §2 (escritorio y 390 px) y la versión de producción
  con las cabeceras de `vercel.json` (§3).

## Fase 6: Beta y cierre

- [ ] T022 Beta (R12, RF-011): **queda para después**, por decisión del dueño del producto al encargar
  esta implementación (2026-10-14). Lo que hay que copiar está en R12 y en «Pendientes» del reporte.
- [x] T023 Cierre: README del backend (y del front), `reporte.md`, estado de la spec y commits sin
  firma de IA.

## Dependencias

- T001 y T002 primero. T001 va antes de cualquier tarea que use los tipos o las reglas.
- **Backend:** T003 → T004 → T005 → T006 → T007 → T008 → T009–T011.
- **Front:** T012 → T016; T013, T014 y T015 sólo dependen de T001; T017 después de T016; T018 sólo de
  T001.
- **T020 y T021**, al final, con la API y el front en local.

## Paralelo

- **[P] reales:** T013, T014 y T018 (archivos propios) mientras se hace el backend.

## Estrategia

1. **MVP:** historias 1 y 2 (P1): importar sin sorpresas para los pacientes ni para la ficha.
2. **Al final:** comprobación, README y reporte. La beta, en una tarea aparte.
3. **Se publica** en el orden del plan: migración, backend y front.
