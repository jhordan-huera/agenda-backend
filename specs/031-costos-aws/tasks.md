---

description: "Tareas de «Los costos de AWS en /admin»"
---

# Tareas: Los costos de AWS en /admin

**Entrada**: `specs/031-costos-aws/`. El dueño del producto aprobó la spec y el plan el 2026-10-22.

**Rutas:** `back/` = agenda-backend y `front/` = agenda-front. La beta no lo lleva.

## Fase 1: La base

- [x] T001 `back/db/migrations/051_aws_costs.sql`: la tabla `aws_costs` (RLS) y las columnas privadas de `platform_settings` del plan. `back/src/services/database-stats-service.ts`: `aws_costs` en `TABLE_INFO`.
- [x] T002 [P] Lo compartido, en `front/src/types/index.ts`, `front/src/lib/validations/admin.ts` y `front/src/lib/email/templates.ts`:
  - `AwsCosts` y `AwsCostAlertInput`;
  - el `EmailType` `aws_cost_alert`;
  - `awsCostAlertSchema`;
  - la plantilla `awsCostAlert`.

  Después, `npm run sync:shared` en `back/`, y el tipo en `EMAIL_PRIORITY`, `EMAIL_GROUPS` y `TYPE_LABELS`.
- [x] T003 [P] `back/src/services/aws-signature.ts`: la firma Signature V4 con `node:crypto`.

## Fase 2: Ver los costos (US1, P1)

- [x] T004 [US1] `back/src/services/aws-costs.ts`:
  - `GetCostAndUsage` y su lectura;
  - la previsión;
  - `refreshAwsCosts()`, que corre una vez al día desde las 06:00, reintenta a las 3 h hasta 3 veces, queda «sin credenciales» sin las `AWS_*` y guarda los errores en palabras sencillas.
- [x] T005 [US1] El cron:
  - `back/src/jobs/scheduled-tasks.ts`: la llamada con su `catch` y `awsCosts` en el informe;
  - `back/scripts/cron.ts`: la línea sin montos.
- [x] T006 [US1] La API:
  - `back/src/routes/platform-routes.ts`: `GET /admin/aws-costs` (con `no-store`);
  - el servicio con `authorizeSuperAdmin`.
- [x] T007 [US1] El front:
  - los datos: `repository.ts`, `api-repository.ts`, `use-admin.ts` y `query-keys.ts`;
  - la página `front/src/pages/admin/admin-costs-page.tsx`, con la ruta y el menú;
  - la tarjeta `front/src/features/admin/aws-costs-card.tsx`, en el Inicio.

## Fase 3: El aviso (US2, P2)

- [x] T008 [US2] `PUT /admin/aws-costs/alert`, que audita `platform.aws_cost_alert_changed` sólo si cambia. El campo del monto, en la página.
- [x] T009 [US2] El aviso:
  - en `refreshAwsCosts()`, el email al principal con `dedupeKey`, y la marca de mes y monto;
  - `buildCostNotice` en `back/scripts/cron.ts`, con el título fijo.

## Fase 4: Los créditos (US3, P2)

- [x] T010 [US3] `GetAccountPlanState` en `aws-costs.ts`: si falla, los costos se guardan igual. La sección «Tu plan de AWS» en la página y los créditos en la tarjeta.

## Fase 5: GitHub, pruebas y cierre

- [x] T011 `back/.github/workflows/cron.yml`: `id-token: write` y el paso de `configure-aws-credentials` (mismo SHA, secreto `AWS_COSTS_ROLE_ARN`, `us-east-1`, sólo si el secreto existe, `continue-on-error`).
- [x] T012 `back/tests/aws-costs.test.ts`, con el AWS falso local, y los ajustes de `email-quota`, `cron` y `database-stats`. `npm run typecheck` y `env -u DATABASE_URL npm test`.
- [x] T013 `front/`: build, lint y `check:contrast`. El recorrido del plan, con capturas.
- [x] T014 La constitución 1.27.0 en los dos repos. El README del backend: la sección de los costos y los pasos de AWS.
- [x] T015 `reporte.md` y los commits en `dev`.
