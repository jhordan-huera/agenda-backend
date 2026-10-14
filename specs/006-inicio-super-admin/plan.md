# Plan de implementación: Inicio del super admin con datos importantes

**Rama**: `dev` · **Fecha**: 2026-10-13 · **Spec**: [spec.md](./spec.md) (aprobada 2026-10-13)

**Documentos**: [research.md](./research.md) (D1–D8) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

**Aprobación:** el dueño del producto aprobó el boceto y el cálculo de cada dato («sí, procede») y
pidió seguir con SDD. Este plan baja eso a archivos.

## Resumen

El inicio del super admin pasa a tres bloques: crecimiento del mes, salud del sistema y negocios para
vender.
- **Backend:**
  - `/admin/stats` gana `growth` y `health`;
  - cada negocio de `/admin/businesses` gana `growth`;
  - la copia de seguridad se anota en una tabla nueva (migración 034).
- **Front:** la pantalla `/admin` se rehace con esos bloques. Salen la tabla de actividad, el gráfico
  de altas y el reparto por planes.
- **Beta:** la misma pantalla con sus datos de prueba.

## Contexto técnico

**Lenguaje/versión**: TypeScript (Node ejecuta `.ts` en el backend; React 19 en el front).
**Dependencias**: las de siempre. **Ninguna nueva.**
**Almacenamiento**: PostgreSQL. La migración 034 trae la tabla `backup_runs`.
**Pruebas**:
- backend: `npm test`, con `tests/admin-overview.test.ts` nueva y `tests/backup.test.ts` ampliada, y
  `npm run typecheck`;
- front: `npm run build` y `npm run lint`;
- recorrido con Playwright en local, también a 390 px.

**Rendimiento**: el inicio sigue con dos pedidos, `stats` y `businesses`. Las consultas nuevas son
recuentos con índices existentes, en paralelo.
**Restricciones**: sólo el super admin; sin datos de pacientes; Vercel Hobby (nada pesado: unos pocos
recuentos).

## Comprobación contra la constitución (1.3.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Interfaz, specs y commits en español. |
| II. Privacidad | Sí | Sólo cifras y nombres de negocios. El motivo de una copia fallida pasa por `scrub` (sin URL ni datos). Sólo el super admin. |
| III. Decisiones | Sí | Los negocios siguen sin ver planes ni precios (es una pantalla del super admin). No hay ingresos: los precios no se guardan. |
| IV. Local | Sí | Pruebas y recorridos en local. La migración la aplica el dueño del producto. |
| V. Compartido | Sí | `PlatformStats` y `AdminBusinessSummary` se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin servicios nuevos. Los datos de salud salen de tablas que ya llenan el cron y la copia. |
| VII. Diseño | Sí | Tarjetas, tokens y estilos del panel. Una columna en el celular. Colores de estado con texto (no sólo el color). |

**Sin excepciones.**

## Diseño

1. **Migración 034** (`db/migrations/034_backup_runs.sql`): la tabla `backup_runs`, su índice y RLS
   (data-model.md).
2. **Copia de seguridad** (`scripts/backup.ts`, D4):
   - `recordBackup(databaseUrl, { ok, sizeBytes, error })` con un `pg.Client` aparte (tiempo de espera
     de 5 s), que nunca lanza un error;
   - se llama al final si todo salió bien (con el tamaño del archivo cifrado), en el `catch` si falló
     (sin tamaño) o si se entregó con problemas;
   - se borran las filas de más de un año.
3. **Estadísticas** (`src/services/admin-service.ts`, D1, D2, D5):
   - una consulta de periodos (`growthPeriodsSql`) con la zona `DEFAULT_TIMEZONE`;
   - los recuentos de crecimiento;
   - la salud: emails de hoy, último cron, última copia y seguridad;
   - todo en paralelo con lo de hoy.
4. **Lista de negocios** (`summarizeBusinesses`, D6): `growth` del negocio, con los mismos periodos.
5. **Tipos compartidos** (front `src/types/index.ts`): `GrowthPair`, `PlatformStats.growth`,
   `PlatformStats.health` y `AdminBusinessSummary.growth`. Se copian con `npm run sync:shared`.
6. **Front:**
   - `src/features/admin/sales-lists.ts`: cerca del límite, los que más crecen, los que dejaron de
     usarlo, y el plan siguiente. Reemplaza a `attention.ts`;
   - `src/features/admin/growth-section.tsx`: las 4 cifras con su ▲▼ y el periodo de comparación;
   - `src/features/admin/health-section.tsx`: los 4 cuadros con estado verde, ámbar o rojo (con texto
     e ícono) y el resumen «Todo bien» o «N avisos»;
   - `src/features/admin/sales-section.tsx`: las 3 listas, con un enlace a la ficha de cada negocio;
   - `src/pages/admin/admin-overview-page.tsx`: saludo, fecha, la línea de planes, «Nuevo negocio»,
     las solicitudes pendientes y los 3 bloques;
   - se borran `attention.ts`, `attention-card.tsx`, `business-activity-list.tsx` y
     `signups-chart.tsx`.
7. **Beta** (D8): los mismos archivos de front, y en el repositorio de prueba (`admin-repository`)
   `growth` y `health` (salud «no disponible»), más el `growth` de cada negocio.

## Estructura

```text
specs/006-inicio-super-admin/   spec, plan, research, data-model, contracts/api.md, quickstart, tasks, reporte

agenda-backend
  db/migrations/034_backup_runs.sql        NUEVO
  scripts/backup.ts                        anota cada copia
  src/services/admin-service.ts            growth, health y growth por negocio
  src/shared/**                            sólo con npm run sync:shared
  tests/admin-overview.test.ts             NUEVO
  tests/backup.test.ts                     la copia queda anotada
  README.md                                el inicio del super admin y la tabla backup_runs

agenda-front
  src/types/index.ts                       tipos compartidos
  src/features/admin/sales-lists.ts        NUEVO (reemplaza attention.ts)
  src/features/admin/growth-section.tsx    NUEVO
  src/features/admin/health-section.tsx    NUEVO
  src/features/admin/sales-section.tsx     NUEVO
  src/pages/admin/admin-overview-page.tsx  la pantalla
  (borrados) attention.ts, attention-card.tsx, business-activity-list.tsx, signups-chart.tsx

agenda-beta: los mismos del front, más src/lib/data/mock/admin-repository.ts
```

## Publicación

1. **Migración 034 primero.** La aplica el dueño del producto:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` del backend.** Ya lleva el aviso de citas por ntfy, que está en `dev`.
3. **PR `dev` → `main` del front.**
4. **Después:**
   - la próxima copia del viernes queda anotada; hasta entonces el cuadro dice «Sin copias
     registradas todavía»;
   - se puede lanzar una copia a mano desde GitHub → Actions para verla antes.

## Riesgos

- **El cuadro de la copia** queda en ámbar hasta la primera copia anotada. Es esperado y se explica.
- **Si el front sale antes que el backend**, `growth` y `health` no llegan. El front muestra «Sin
  datos» en lugar de romperse.
