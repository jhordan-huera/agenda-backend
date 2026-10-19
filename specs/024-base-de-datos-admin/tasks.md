---

description: "Tareas de «La pantalla Base de datos del super admin principal»"
---

# Tareas: La pantalla «Base de datos»

**Entrada**: `specs/024-base-de-datos-admin/`. El dueño del producto aprobó la spec y el plan el
2026-10-18 («procede»).

**Rutas:** `back/` = agenda-backend y `front/` = agenda-front. La beta no la lleva.

## Fase 1: Base

- [x] T001 Constitución 1.21.0 en los dos repos (principio III).
- [ ] T002 `back/db/migrations/047_database_stats.sql`: la tabla `database_stats`, con `day date
  primary key`, `size_bytes bigint not null`, `files_bytes bigint`, `tables jsonb not null default
  '[]'` y `created_at`. RLS como las demás. También en `TABLES` de `back/src/db/seed.ts` si hace falta.
- [ ] T003 Código compartido (`front/src`, luego `sync:shared`): los tipos `DatabaseStats`,
  `DatabaseTableStat`, `DatabaseQueryStat`, `DatabaseHistoryPoint` y `DatabaseProjection`.
  `back/src/config.ts`: `FILES_LIMIT_MB`, opcional, 1024 por defecto.

## Fase 2: Historias 1 y 3, el detalle y las seguridades (P1)

- [ ] T004 [US1] `back/src/services/database-stats-service.ts` (nuevo), según el plan:
  - una transacción de sólo lectura con `set local statement_timeout = '5s'`, sin `SET` de sesión;
  - las secciones `size`, `tables` (con `TABLE_INFO` en palabras y la regla de borrado de cada tabla de
    `public`), `work` (con `pg_stat_statements` en el esquema donde esté, por rol, las 10 primeras con
    `QUERY_LABELS` y el texto con las comillas tapadas y recortado) y `maintenance`;
  - cada sección en su `try`.

  Las reglas de borrado se toman del código: cron_runs a los 30 días, el contenido de los emails a
  los 30 días, la actividad a los 5 meses (las sesiones a 90 días y la historia clínica a 5 años), los
  avisos de la campana a los 30 días, los avisos al celular a los 7 días, los comprobantes a los 3
  meses y las fotos de la analítica a los 30 días. Revisa cada una en el código antes de escribirla.
- [ ] T005 [US3] `back/src/routes/platform-routes.ts`: `GET /admin/database`, con:
  - `requireSuperAdminTwoFactor`;
  - `platformOwner`: si no lo es, 403 «Sólo el super admin principal ve la base de datos.»;
  - `limitRequests({ name: "base-de-datos", windowMinutes: 15, max: 20 })`;
  - `Cache-Control: no-store`.

## Fase 3: Historia 2, el historial y la proyección (P1)

- [ ] T006 [US2] `back/`:
  - **en el cron** (`scheduled-tasks.ts` y `scripts/cron.ts`): la foto diaria después de las 06:00 de
    Ecuador, sin repetirla, y el borrado de las de más de 400 días. La línea del registro sólo lleva la
    cifra;
  - **en la ruta:** `history`, los últimos 90 días, y `projection`, con 7 días o más: la regresión
    lineal, los MB por mes y los meses hasta el 70 % y el 100 %.

## Fase 4: El front

- [ ] T007 `front/src/pages/admin/admin-database-page.tsx` (nueva), en `/admin/database`
  (`router.tsx`), con el repositorio y el hook:
  - las dos tarjetas: la base y los archivos;
  - el gráfico de 90 días y la frase de la proyección;
  - «Qué ocupa», con las barras por tabla y «Lo que trae Supabase» plegado;
  - «Qué la hace trabajar»;
  - «Mantenimiento»;
  - una frase de ayuda en cada sección, y «No disponible» o «No se pudo leer ahora» donde toque;
  - sin el principal, «No tienes acceso»;
  - los dos modos y 390 px.
- [ ] T008 `front/src/features/admin/health-section.tsx`: «Ver detalle» en la tarjeta «Base de datos»,
  sólo si `session.platformOwner`.

## Fase 5: Pruebas y cierre

- [ ] T009 `back/tests/database-stats.test.ts` (nueva), con lo de «Pruebas» del plan.
- [ ] T010 READMEs del backend y del front.
- [ ] T011 Comprobación:
  - `back/`: typecheck y todas las suites;
  - `front/`: build, lint y `check:contrast`;
  - el recorrido, en los dos modos, a 1440 y a 390 px.
- [ ] T012 Cierre: `reporte.md`, el estado y los commits sin firma de IA.
