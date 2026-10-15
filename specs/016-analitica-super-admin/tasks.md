---

description: "Tareas de «Analítica del super admin»"
---

# Tareas: Analítica del super admin

**Entrada**: `specs/016-analitica-super-admin/`. El dueño del producto aprobó el plan el 2026-10-15
(«si procede»), con la fórmula de salud y los criterios de venta propuestos.

**Pruebas:**
- **Backend:** suite nueva `tests/analytics.test.ts` (quickstart §1).
- **Front:** build, lint y el recorrido del quickstart §2.
- **Beta:** no lleva la analítica.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front. Las decisiones R1–R9 están en
`research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.13.0 en `back/` y `front/`: la analítica es sólo del super admin, con
  cifras por negocio y preparada una vez al día con el cron.
- [x] T002 `back/db/migrations/043_analytics_snapshots.sql`:
  - la tabla `analytics_snapshots`, según data-model, con `period_days in (30, 90)`;
  - una clave única `(period_days, day)`;
  - RLS.

  Además, la tabla en `TABLES` de `back/src/db/seed.ts`.
- [x] T003 `front/src/types/index.ts`: `AnalyticsSnapshot`, `BusinessAnalytics`, `CategoryAnalytics`,
  `PlatformTotals` y `FeatureKey` (data-model). Después, `npm run sync:shared` en `back/`.

## Fase 2: Los cálculos (R1–R7)

- [x] T004 `back/src/services/analytics-service.ts` (nuevo):
  - **`buildSnapshot(days)`:**
    - las cifras de cada negocio (R2), con «nuevo» y «pocos datos»;
    - los tipos, con sus medianas, «muy distinto» y la demanda por día y hora (R3);
    - la salud: los pesos de R4 en un solo objeto de constantes, con sus motivos en palabras;
    - «Listos para subir de plan» (R5);
    - las funciones y su adopción (R6);
    - el valor generado y el antes y el después (R7).

    Las cuentas van en SQL agregado, con pocas consultas en total y no una por negocio. Usa
    `countsForPlanSql` y los topes de `plans.ts`.
  - **`saveSnapshot`,** **`latestSnapshot(days)`** y **`cleanupSnapshots`** (más de 30 días).
- [x] T005 `back/src/jobs/scheduled-tasks.ts` y `scripts/cron.ts`:
  - después de las 06:00 de Ecuador, si no hay foto de hoy, preparar las de 30 y de 90 días y
    limpiar;
  - la línea del registro: «analítica: preparada (N negocios)», sólo con cifras;
  - si falla, el cron sigue con lo demás.
- [x] T006 `back/scripts/analytics-refresh.ts` y `npm run analytics:refresh`.

## Fase 3: La API

- [x] T007 `back/src/routes/platform-routes.ts`: `GET /admin/analytics?days=30|90`, con el contrato:
  - lee la última foto;
  - `snapshot: null` si no hay;
  - 400 si `days` no es válido;
  - la verificación en dos pasos, como el resto de /admin.

  En `back/src/services/admin-service.ts`, la ficha del negocio suma `analytics`: su parte de la foto
  de 30 días y las medianas de su tipo.

## Fase 4: El front

- [x] T008 `front/`:
  - el repositorio y el hook del pedido de la foto;
  - «Analítica» en el menú de /admin (`nav-items.ts`) y la ruta `/admin/analytics` (`router.tsx`).
- [x] T009 [US1] `front/src/pages/admin/admin-analytics-page.tsx` y `front/src/features/admin/analytics/`:
  - las cuatro pestañas;
  - el selector de 30 o 90 días y «Datos de hoy a las 06:00»;
  - sin foto, «Las cifras se preparan cada mañana».

  **Pestaña Comparar:**
  - la tabla con las columnas de R2, ordenable;
  - filtros por tipo, plan y estado (por defecto, los activos) y búsqueda;
  - CSV con lo que se ve;
  - «pocos datos» donde toque y «tipo N %» al lado de cada tasa;
  - el enlace a la ficha;
  - a 390 px, la tabla se desplaza dentro de su recuadro con la primera columna fija.
- [x] T010 [US2] Pestaña «Por tipo de negocio»: cada tipo con sus medianas, el ticket, las citas por
  agenda, y sus 3 días y 3 horas de más demanda (con la librería de gráficos que ya está, si hace
  falta). Y en `admin-business-detail-page.tsx`, la tarjeta «Frente a su tipo», con su salud.
- [x] T011 [US3] Pestaña «Salud y ventas»:
  - los tres grupos;
  - la lista «En riesgo», con los motivos y el contacto del propietario (enlaces de teléfono, WhatsApp
    y email);
  - «Listos para subir de plan», con su motivo.
- [x] T012 [US4] Pestaña «Uso y valor»:
  - la adopción de cada función;
  - las funciones de cada negocio;
  - el valor del periodo, el antes y el después;
  - los totales de la plataforma, con «Copiar» para ventas.

## Fase 5: Pruebas, documentación y cierre

- [x] T013 `back/tests/analytics.test.ts` (nueva): el quickstart §1, con negocios de cifras conocidas
  y la revisión de privacidad de la foto entera.
- [x] T014 [P] READMEs del backend y del front: la analítica, la foto diaria y `npm run
  analytics:refresh`.
- [x] T015 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: `npm run build` y `npm run lint`;
  - el recorrido del quickstart §2 (escritorio y 390 px; API en el 4180, preview en el 5199,
    PostgreSQL en el 54400, detenidos por PID).
- [x] T016 Cierre: `reporte.md`, el estado de la spec y los commits sin firma de IA.

## Dependencias

- T002 y T003 → T004 → T005, T006 y T007.
- T007 → T008 → T009 → T010, T011 y T012.
- T013 después de T004 y T007.
