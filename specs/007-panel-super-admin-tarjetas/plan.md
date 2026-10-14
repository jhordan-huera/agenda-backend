# Plan de implementación: Panel del super admin con tarjetas y colores propios

**Rama**: `dev` · **Fecha**: 2026-10-14 · **Spec**: [spec.md](./spec.md) (aprobada 2026-10-14)

**Documentos**: [research.md](./research.md) (D1–D13) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

Las 8 pantallas del super admin pasan a tarjetas, con el mismo encabezado y una fila de cifras.
- **Negocios y Usuarios:** tarjetas, con botón para pasar a lista.
- **Ficha del negocio:** cabecera, 4 cifras y pestañas.
- **Colores:** cada super admin elige los de su panel, que se guardan en su cuenta.

Qué toca cada parte:
- **Backend:** una columna nueva (migración 035), una ruta para guardar los colores y la sesión que
  los devuelve.
- **Front:** las pantallas, unos pocos componentes comunes del panel de plataforma y el selector de
  colores compartido con los negocios.
- **Beta:** lo mismo, con sus datos de prueba.

## Contexto técnico

**Lenguaje/versión**: TypeScript (Node ejecuta `.ts` en el backend; React 19 en el front).
**Dependencias**: las de siempre (Radix Tabs, Recharts y lucide ya están). **Ninguna nueva.**
**Almacenamiento**: PostgreSQL. La migración 035 añade `users.panel_colors`. En el navegador sólo se
guarda la vista elegida (tarjetas o lista).
**Pruebas**:
- backend: `tests/panel-colors.test.ts` (nueva), `npm test` y `npm run typecheck`;
- front y beta: `npm run build` y `npm run lint`;
- recorrido con Playwright en local, en escritorio y a 390 px (quickstart).

**Rendimiento**: no hay pedidos nuevos en Negocios, Usuarios, Categorías ni la ficha. Actividad usa
`/admin/stats`, el mismo pedido del inicio y en la misma caché. La sesión hace una consulta pequeña
más sólo para cuentas de super admin.
**Restricciones**:
- el panel de los negocios no cambia;
- ningún dato de pacientes nuevo;
- Vercel Hobby: nada pesado.

## Comprobación contra la constitución (1.3.0 → 1.4.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Interfaz, specs y commits en español. Los valores de la dirección y del navegador también («pestana», «tarjetas»). |
| II. Privacidad | Sí | Los mismos datos de hoy. Los colores no son datos personales. Nadie puede cambiar los colores de otra cuenta (D3). |
| III. Decisiones | Sí | Las tres decisiones del dueño del producto se anotan en la 1.4.0 (D13). Siguen igual: sólo el super admin agrega miembros y cambia planes y categorías, y los negocios no ven planes ni precios. |
| IV. Local | Sí | Pruebas y recorrido en local. La migración la aplica el dueño del producto. |
| V. Compartido | Sí | `panelColorsSchema` se edita en el front y se copia con `sync:shared`. `Session` se mantiene a mano en los dos lados, como hoy. |
| VI. Barato | Sí | Sin servicios nuevos ni pedidos pesados. |
| VII. Diseño | Sí | Tarjetas blancas sobre el lienzo, el degradado de la marca en la cabecera de la ficha, colores desde los tokens (también los gráficos, D5), `grid-cols-1` en el celular y accesible (filtros como grupo de radio, pestañas con teclado, contraste de la paleta). |

**Sin excepciones.**

## Diseño

1. **Constitución 1.4.0** en los dos repos (D13).
2. **Migración 035** (`db/migrations/035_panel_colors.sql`): `users.panel_colors` con su
   comprobación (data-model.md).
3. **Backend:**
   - `src/services/auth-service.ts`: `Session.panelColors`. `resolveSession` lo lee sólo para super
     admin (D2);
   - `src/services/admin-service.ts`: `updatePanelColors(ctx, input)`, que guarda en
     `ctx.user.id` (D3);
   - `src/routes/platform-routes.ts`: `PUT /admin/panel-colors`;
   - `tests/panel-colors.test.ts` (quickstart §1);
   - README: la ruta y la columna.
4. **Compartido** (front `src/lib/validations/admin.ts`): `panelColorsSchema`. Se copia con `npm run
   sync:shared`.
5. **Colores en el front** (D4–D6):
   - `src/lib/auth/types.ts`: `Session.panelColors`;
   - `src/lib/data/repository.ts` y `api-repository.ts`: `admin.updatePanelColors`;
   - `src/hooks/queries/use-admin.ts`: `useUpdatePanelColors`, que refresca la sesión al guardar;
   - `src/components/layout/admin-layout.tsx`: `BrandThemeProvider` con `session.panelColors`;
   - `src/features/branding/brand-colors-picker.tsx` (nuevo): las paletas y los dos colores, sacados de
     `brand-colors-settings.tsx`, que pasa a usarlo y se ve igual;
   - `src/features/admin/panel-colors-card.tsx` (nuevo): la tarjeta con su vista previa;
   - `src/features/admin/admin-chart-colors.ts`, `growth-chart.tsx`, `emails-chart.tsx` y
     `business-growth-chart.tsx`: toman los colores de la paleta.
6. **Componentes comunes** (D10): `stat-cards.tsx`, `filter-chips.tsx`, `view-toggle.tsx`,
   `use-view-preference.ts`, `business-card.tsx`, `user-card.tsx`, `category-card.tsx`,
   `business-hero.tsx`, `businesses-table.tsx` y `users-table.tsx` (estas dos, la tabla de hoy movida).
7. **Pantallas** (`src/pages/admin/`):
   - `admin-businesses-page.tsx`: cifras, filtros con número, tarjetas o lista;
   - `admin-users-page.tsx`: lo mismo para cuentas;
   - `admin-business-detail-page.tsx`: cabecera, cifras y pestañas en la dirección (D8). Las tarjetas
     de hoy se reparten en las pestañas, sin cambiar lo que hacen;
   - `admin-categories-page.tsx`: cifras y tarjetas;
   - `admin-activity-page.tsx`: cifras (D9) y la auditoría y los emails agrupados por día (D11);
   - `admin-plans-page.tsx`: el plan con más negocios, marcado;
   - `admin-settings-page.tsx`: dos columnas, iconos en los títulos y «Colores del panel»;
   - `admin-overview-page.tsx`: mismo estilo, sin cambiar sus bloques.
8. **Compartidos con el panel del negocio** (D11): `AuditFeed` y `EmailOutboxCard` ganan `groupByDay`,
   apagado por defecto.
9. **Beta** (D12): los mismos archivos del front, respetando sus diferencias, más `store.ts`,
   `admin-repository.ts` y `mock-auth-service.ts` para los colores.

## Estructura

```text
specs/007-panel-super-admin-tarjetas/   spec, plan, research, data-model, contracts/api.md, quickstart, tasks, reporte

agenda-backend
  .specify/memory/constitution.md          1.4.0
  db/migrations/035_panel_colors.sql       NUEVO
  src/services/auth-service.ts             Session.panelColors
  src/services/admin-service.ts            updatePanelColors
  src/routes/platform-routes.ts            PUT /admin/panel-colors
  src/shared/**                            sólo con npm run sync:shared
  tests/panel-colors.test.ts               NUEVO
  README.md                                la ruta y la columna

agenda-front
  .specify/memory/constitution.md          1.4.0
  src/lib/validations/admin.ts             panelColorsSchema
  src/lib/auth/types.ts                    Session.panelColors
  src/lib/data/repository.ts, api-repository.ts
  src/hooks/queries/use-admin.ts           useUpdatePanelColors
  src/components/layout/admin-layout.tsx   colores del panel
  src/features/branding/brand-colors-picker.tsx    NUEVO
  src/features/settings/brand-colors-settings.tsx  usa el selector (se ve igual)
  src/features/activity/audit-feed.tsx     groupByDay
  src/features/settings/email-outbox.tsx   groupByDay
  src/features/admin/                      stat-cards, filter-chips, view-toggle, use-view-preference,
                                           business-card, user-card, category-card, business-hero,
                                           businesses-table, users-table, panel-colors-card (NUEVOS);
                                           gráficos con la paleta
  src/pages/admin/*.tsx                    las 8 pantallas

agenda-beta: los mismos del front, más src/lib/data/mock/{store,admin-repository}.ts y
             src/lib/auth/mock-auth-service.ts
```

## Publicación

1. **Migración 035 primero.** La aplica el dueño del producto:
   ```
   npm run db:migrate
   ```
   Si todavía no se aplicó la 034 (spec 006), el mismo comando aplica las dos en orden.
2. **PR `dev` → `main` del backend.**
3. **PR `dev` → `main` del front.**
4. **Después:** entrar al panel, elegir colores y comprobar «Gestionar negocio».

## Riesgos

- **Si el front sale antes que el backend,** la sesión no trae `panelColors` y el panel usa los de
  Agenda360, sin romperse. Guardar los colores fallaría con un aviso hasta publicar el backend.
- **Si la migración no está aplicada,** la sesión del super admin fallaría al leer la columna. Por eso
  la migración va primero, como siempre.
- **Cambios en componentes compartidos** (`AuditFeed`, `EmailOutboxCard`, selector de colores): el
  panel del negocio debe quedar igual. Se comprueba con capturas antes y después (quickstart §2.8).
- **La beta tiene diferencias** en varias pantallas del panel (sin verificación en dos pasos, sin cron
  ni copias). Se copia archivo por archivo, comparando antes.
