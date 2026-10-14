---

description: "Tareas del panel del super admin con tarjetas y colores propios"
---

# Tareas: Panel del super admin con tarjetas y colores propios

**Entrada**: `specs/007-panel-super-admin-tarjetas/` · **Pruebas**:
- backend: `tests/panel-colors.test.ts` (nueva);
- front y beta: build, lint y el recorrido con Playwright del quickstart.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta.

## Fase 1: Base

- [x] T001 Constitución 1.4.0, igual en `back/.specify/memory/constitution.md` y `front/.specify/memory/constitution.md` (D13):
  - en el principio III, la decisión del panel en tarjetas, con lista en Negocios y Usuarios, y los colores por cuenta de super admin, que no se aplican a los negocios ni a otros super admins (2026-10-14);
  - en el principio VII, «cada negocio, y cada super admin para su panel, personaliza los suyos».
- [x] T002 Crear `back/db/migrations/035_panel_colors.sql`:
  - `alter table users add column panel_colors jsonb`;
  - con la comprobación `panel_colors is null or (panel_colors ->> 'primary' ~ '^#[0-9a-f]{6}$' and panel_colors ->> 'highlight' ~ '^#[0-9a-f]{6}$')`.

  Aplicarla en la base local.
- [x] T003 [P] En `front/src/lib/validations/admin.ts`: `panelColorsSchema = z.object({ colors: brandColorsSchema })` y `PanelColorsInput`. Después, `npm run sync:shared` en back/.

## Fase 2: Componentes comunes (bloquean las historias 1 y 3)

- [x] T004 [P] `front/src/features/admin/stat-cards.tsx`: `StatCard` (icono, título, cifra y detalle opcional) y `StatGrid` (`grid-cols-2`, y 4 columnas desde `lg`).
- [x] T005 [P] `front/src/features/admin/filter-chips.tsx`: botones con su número, como grupo de radio accesible (`role="radiogroup"`, `aria-checked`, flechas del teclado), con desplazamiento lateral propio si no caben.
- [x] T006 [P] `front/src/features/admin/use-view-preference.ts` y `front/src/features/admin/view-toggle.tsx` (D7):
  - claves `agenda360.admin.vista.<pantalla>` con `"tarjetas" | "lista"`, por defecto tarjetas;
  - cada lectura y escritura en `try/catch`;
  - el botón, oculto por debajo de `md`.

## Fase 3: Historia 1 - Negocios en tarjetas (P1)

- [x] T007 [P] [US1] `front/src/features/admin/businesses-table.tsx`: la tabla de hoy de `admin-businesses-page.tsx`, movida sin cambios.
- [x] T008 [P] [US1] `front/src/features/admin/business-card.tsx`:
  - inicial, nombre (cortado con «…» y `title`), enlace, plan y estado;
  - propietario («Sin propietario» si no hay);
  - citas del mes y usuarios con una barra frente al límite, o sólo la cifra y «sin límite»;
  - alta y última actividad;
  - «Ver ficha» y «Página pública».
- [x] T009 [US1] `front/src/pages/admin/admin-businesses-page.tsx`:
  - las cifras (activos, suspendidos, nuevos este mes en Ecuador, cerca del límite con `nearLimit`);
  - los filtros de plan y de estado con su número, combinados con la búsqueda;
  - la cuadrícula de tarjetas o la lista;
  - sin resultados, un aviso con «Limpiar filtros».

## Fase 4: Historia 2 - Ficha con pestañas (P1)

- [x] T010 [P] [US2] `front/src/features/admin/business-hero.tsx`: la cabecera con el degradado de la marca, la inicial, el nombre, la categoría, el alta, el plan, el estado y las acciones (Gestionar negocio, Página pública, Suspender o Reactivar).
- [x] T011 [US2] `front/src/pages/admin/admin-business-detail-page.tsx` (D8):
  - la cabecera;
  - 4 `StatCard` del uso: citas del mes, pacientes, usuarios y agendas;
  - las pestañas `?pestana=resumen|equipo|ajustes|actividad` con `replace` y `forceMount`. Un valor desconocido abre Resumen.
  - Las tarjetas de hoy se reparten así:
    - **Resumen:** suscripción y uso, propietario e información;
    - **Equipo:** el equipo;
    - **Ajustes:** datos obligatorios, varios pacientes y eliminar negocio, al final;
    - **Actividad:** la actividad reciente.

## Fase 5: Historia 3 - El resto del panel (P1)

- [x] T012 [P] [US3] `front/src/features/admin/users-table.tsx` (la tabla de hoy de `admin-users-page.tsx`, movida) y `front/src/features/admin/user-card.tsx`: avatar, nombre, email, negocio y rol, alta, estado y el menú de acciones de hoy (sin menú para el super admin).
- [x] T013 [US3] `front/src/pages/admin/admin-users-page.tsx`:
  - las cifras: cuentas, propietarios, equipos y sin negocio;
  - los filtros de hoy como botones con su número (y Super admin);
  - las tarjetas o la lista.
- [x] T014 [P] [US3] `front/src/features/admin/category-card.tsx` y `front/src/pages/admin/admin-categories-page.tsx`:
  - las cifras: activas, con historia clínica y en uso;
  - la cuadrícula de tarjetas con editar y eliminar (desactivado si tiene negocios, como hoy).
- [x] T015 [P] [US3] Agrupar por día, apagado por defecto: `groupByDay` en `front/src/features/activity/audit-feed.tsx` y en `front/src/features/settings/email-outbox.tsx` (D11). Una tarjeta por día, con «Hoy», «Ayer» o la fecha, en hora de Ecuador.
- [x] T016 [US3] `front/src/pages/admin/admin-activity-page.tsx`:
  - las cifras de `useAdminStats().health`: enviados hoy, fallidos hoy, intentos fallidos en 24 h y cuentas en alerta;
  - la auditoría y los emails con `groupByDay`.
- [x] T017 [P] [US3] `front/src/pages/admin/admin-plans-page.tsx`: el plan con más negocios lleva la insignia «Más usado».
- [x] T018 [US3] `front/src/pages/admin/admin-settings-page.tsx`: dos columnas desde `lg` y un icono en el título de cada tarjeta. `front/src/pages/admin/admin-overview-page.tsx`: el mismo estilo, sin cambiar sus bloques.

## Fase 6: Historia 4 - Colores del panel (P2)

- [x] T019 [US4] Backend (D2, D3):
  - `back/src/services/auth-service.ts`: `Session.panelColors`. `resolveSession` lee `panel_colors` sólo si `platformRole === "super_admin"` y devuelve `null` para el resto;
  - `back/src/services/admin-service.ts`: `updatePanelColors(ctx, input)`, con `authorizeSuperAdmin` y `panelColorsSchema`, que guarda en `ctx.user.id` y devuelve `{ colors }`;
  - `back/src/routes/platform-routes.ts`: `PUT /admin/panel-colors`.
- [x] T020 [US4] `back/tests/panel-colors.test.ts`:
  - guardar y leer en la sesión, también al entrar de nuevo;
  - `null` vuelve a `null`;
  - un color inválido responde 400 sin cambios;
  - otro super admin no cambia;
  - un propietario recibe 403 y su sesión trae `panelColors: null`;
  - la comprobación de la columna rechaza un valor mal formado.
- [x] T021 [US4] Front, datos:
  - `front/src/lib/auth/types.ts`: `Session.panelColors`;
  - `front/src/lib/data/repository.ts` y `api-repository.ts`: `admin.updatePanelColors`;
  - `front/src/hooks/queries/use-admin.ts`: `useUpdatePanelColors`, que llama a `refresh()` de la sesión al guardar.
- [x] T022 [US4] `front/src/features/branding/brand-colors-picker.tsx` (D6): las paletas listas y los dos colores, sacados de `front/src/features/settings/brand-colors-settings.tsx`, que pasa a usarlo y se ve igual (captura antes y después).
- [x] T023 [US4] `front/src/features/admin/panel-colors-card.tsx`, con su vista previa del panel, dentro de `admin-settings-page.tsx`. `front/src/components/layout/admin-layout.tsx`: `BrandThemeProvider` con `session.panelColors`.
- [x] T024 [US4] Gráficos con la paleta (D5): `front/src/features/admin/admin-chart-colors.ts`, `growth-chart.tsx`, `emails-chart.tsx` y `business-growth-chart.tsx` con `useChartColors()`. Se quedan fijos el gris del mes pasado y el rojo de los fallidos.

## Fase 7: Beta, comprobación y cierre

- [x] T025 Beta (D12):
  - comparar y copiar los archivos del front, respetando sus diferencias (sin verificación en dos pasos, cron ni copias);
  - en `beta/src/lib/data/mock/store.ts`, la colección `panelColors`, vacía si los datos guardados no la traen;
  - en `admin-repository.ts`, `updatePanelColors`;
  - en `beta/src/lib/auth/mock-auth-service.ts`, `panelColors` en la sesión;
  - en Actividad, «No disponible en la beta» en la fila de cifras;
  - build y lint.
- [x] T026 Comprobar:
  - back: `npm run typecheck` y `npm test`;
  - front: `npm run build` y `npm run lint`;
  - el recorrido de Playwright del quickstart (§2), con cada acción de CE-001, a 390 px y en escritorio, y las capturas del panel del negocio antes y después;
  - la beta en el 3199.
- [x] T027 `back/README.md`: la ruta `PUT /admin/panel-colors` y la columna `users.panel_colors`. Commits sin firma de IA en los dos repos. Después, `/speckit-reporte`.

## Dependencias

- T001–T003 primero. T002 y T003 bloquean T019.
- La fase 2 bloquea las fases 3 y 5.
- T007 y T008 → T009. T010 → T011. T012 → T013. T015 → T016.
- La fase 6 sigue este orden: T019 → T020; T021 → T022 → T023; T024 es independiente.
- La beta va al final (T025), antes de la comprobación (T026).

## Trabajo en paralelo

- Fase 2: T004, T005 y T006 a la vez.
- Historias 1 y 2: T007, T008 y T010 a la vez.
- Historia 3: T012, T014, T015 y T017 a la vez.
- Historia 4: el backend (T019 y T020) en paralelo con el front de las historias 1 a 3.

## Estrategia

1. **Lo mínimo útil:** base, componentes, historia 1 (Negocios) e historia 2 (ficha). Son las dos
   pantallas que más se usan.
2. **Después:** la historia 3 (resto del panel) y la historia 4 (colores).
3. **Al final:** beta, comprobación completa y reporte.
