---

description: "Tareas de «Centro de avisos en el panel»"
---

# Tareas: Centro de avisos en el panel

**Entrada**: `specs/014-centro-de-avisos/`. El plan lo aprobó el dueño del producto el 2026-10-15
(«procede por favor»), con sus seis decisiones y los seis «Cambios respecto a la spec».

**Pruebas:**
- **Backend:**
  - suite nueva: `tests/panel-notices.test.ts` (quickstart §1);
  - suites que se actualizan: `push-notices` (los textos del celular no cambian) y `cron` (la línea
    del registro).
- **Front:** build, lint y el recorrido con Playwright del quickstart (§2), con la versión compilada,
  en escritorio y a 390 px.
- **Beta:** build, lint y el recorrido del quickstart (§3).

**Rutas:**
- `back/` = agenda-backend;
- `front/` = agenda-front;
- `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

Las decisiones R1–R14 están en `research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.10.0 (MENOR), igual en `back/` y `front/` (`.specify/memory/constitution.md`):
  - **Principio II:** el nombre completo, sólo en la campana del panel;
  - **Principio III:** quién recibe qué en la campana, el modo soporte y que leer no va a la
    actividad.
- [ ] T002 Código compartido en `front/` y después `npm run sync:shared` en `back/`. Los archivos nuevos
  se crean vacíos antes en `back/src/shared/`.
  - **`src/types/index.ts`:**
    - `NoticeKind = Exclude<PushKind, "test">`;
    - `PanelNotice` (`id`, `kind`, `title`, `body`, `url`, `createdAt`, `read`);
    - `PanelNoticePage` (`notices`, `unread`, `nextCursor`).
  - **`src/lib/constants/notices.ts`** (nuevo):
    - `BUSINESS_NOTICE_KINDS` (7) y `PLATFORM_NOTICE_KINDS` (4);
    - `NOTICE_AUDIENCE`, la tabla de R2 por tipo: qué ve el propietario, Recepción y los
      administradores, y quien tiene la agenda;
    - `NOTICE_DAYS = 30`, `NOTICE_LIST_SIZE = 20`, `NOTICE_PAGE_MAX = 50`;
    - `NOTICE_REFRESH_MS = 180_000`;
    - `BETA_MAX_NOTICES = 200`.
  - **`src/lib/notices.ts`** (nuevo): `describeNotice(kind, data, { name, now })`, con los títulos y
    textos de `contracts/api.md`.
    - Se mueven de `back/src/services/push-notices.ts` los constructores (`describeWhen`, `dayLabel`,
      «con {profesional}», «Por verificar», serie, resumen).
    - `name` es la función que da el nombre de cada paciente: `shortName` en el celular, el nombre tal
      cual en la campana.
  - **`src/lib/validations/notices.ts`** (nuevo): `noticeListQuerySchema`:
    - `limit`: de 1 a 50, 20 por defecto;
    - `unread`: `"1"` opcional;
    - `cursor`: `<ISO>|<uuid>` opcional.
- [ ] T003 `back/db/migrations/041_panel_notices.sql`, según data-model:
  - **`panel_notices`:**
    - `business_id` nulo (= plataforma) `references businesses on delete cascade`;
    - `kind` con `check` de los 11 tipos, y otro `check`: los 7 del negocio con `business_id`, los 4 de
      la plataforma sin él;
    - `appointment_id` `on delete cascade`, obligatorio en `booking`, `receipt`, `patient_confirm`,
      `patient_cancel`, `new_appointment` y `unclosed`;
    - `client_id` y `professional_id` `on delete cascade`;
    - `actor_user_id` `on delete set null`;
    - `data jsonb not null default '{}'`;
    - `title`, `body` y `url` (con `check (url like '/%')`), sólo en los de la plataforma;
    - `dedupe_key text unique`;
    - `created_at not null default now()`;
    - los tres índices de data-model.
  - **`panel_notice_reads`:** clave `(user_id, notice_id)`, las dos en cascada.
  - **`panel_notice_state`:** `user_id` como clave, `read_all_at not null`.
  - **RLS** activado en las tres.
- [ ] T004 [P] `back/src/db/seed.ts`: `panel_notice_reads`, `panel_notice_state` y `panel_notices` al
  principio de `TABLES`.

## Fase 2: El motor (R1–R3, R7, R9)

- [ ] T005 `back/src/services/panel-notices.ts` (nuevo):
  - **Crear:** `addAppointmentNotice(db, { kind, businessId, appointmentId, clientId?, professionalId?,
    actorUserId?, data?, dedupeKey? })` y `addPlatformNotice(db, { kind, title, body, url, dedupeKey? })`.
    - Van en un punto de guardado propio (`aviso_panel`, o el pool para el cron).
    - Si fallan, el registro dice el tipo y el código, sin datos (RF-011).
  - **La consulta de R2** (`visibleNoticesSql`): el rol de hoy, el propietario, la agenda de hoy de la
    cita, quien lo provocó, desde que entró al equipo y los 30 días.
  - **Leer y marcar:** `countUnread`, `listNotices` (el cursor; arma los textos con `describeNotice` y el
    nombre completo), `markRead` (404 si no lo puede ver) y `markAllRead`.
  - **Borrado:** `cleanupPanelNotices` (más de 30 días).
- [ ] T006 `back/src/services/push-notices.ts`: los textos del celular salen de `describeNotice` con
  `shortName`. Los textos tienen que ser idénticos a los de hoy (`push-notices` lo comprueba).

## Fase 3: Historia 1 - La campana con lo nuevo (P1)

- [ ] T007 [US1] `back/src/services/push-notices.ts`: cada función añade su aviso del panel con
  `addAppointmentNotice`, haya o no aparatos, antes de mirar los del celular:
  - `notifyOnlineBooking` → `booking`;
  - `notifyReceipt` → `receipt`;
  - `notifyPatientConfirmed` → `patient_confirm`, con `clientId`;
  - `notifyPatientCancel` → `patient_cancel`;
  - `notifyNewAppointment` → `new_appointment`, con `actorUserId`, en cualquier agenda con usuario;
  - `notifyNewSeries` → uno solo, con `data.count` y la primera cita.
- [ ] T008 [US1] `back/src/routes/business-routes.ts`: las rutas de `contracts/api.md`:
  - `GET /:businessId/notices/unread`;
  - `GET /:businessId/notices`;
  - `POST /:businessId/notices/:noticeId/read`;
  - `POST /:businessId/notices/read-all`.

  Usan `authorize` sin permiso. En modo soporte, 403 «La campana es del equipo del negocio.».
- [ ] T009 [US1] `front/src/lib/data/repository.ts` y `api-repository.ts`: `notices` (los cuatro
  métodos, del negocio y de /admin). Además:
  - `front/src/hooks/queries/query-keys.ts`;
  - `front/src/hooks/queries/use-notices.ts` (nuevo):
    - `useUnreadNotices`, con `refetchInterval` de `NOTICE_REFRESH_MS` sólo con la pestaña visible y al
      volver a la pestaña;
    - `useNoticeList`, `useMarkNoticeRead` y `useMarkAllNoticesRead`;
    - escucha `agenda360:aviso` del service worker;
    - con un 404 no reintenta y la campana se oculta (R10).
- [ ] T010 [US1] `front/src/features/notices/` (nuevo):
  - `notice-bell.tsx`: el botón, el número («9+»), la etiqueta «Avisos, N sin leer» y el `Popover`;
  - `notice-list.tsx`: los últimos 20, «Marcar todo como leído», «Ver todos» y «No tienes avisos»;
  - `notice-item.tsx`: título, texto, hace cuánto y el no leído resaltado. Al tocarlo, marca leído y
    navega.

  Dónde va:
  - `front/src/components/layout/app-shell.tsx`: la campana en la barra del celular (prop nueva);
  - `front/src/components/layout/sidebar-content.tsx`: junto al logo;
  - `front/src/components/layout/dashboard-layout.tsx`: sin campana en modo soporte.
- [ ] T011 [P] [US1] `front/src/sw.ts`: en `push`, después de `showNotification`, manda
  `{ type: "agenda360:aviso" }` a las ventanas abiertas (R11).

## Fase 4: Historia 2 - Cada uno ve lo suyo (P1)

- [ ] T012 [US2] `back/src/services/push-notices.ts`:
  - `queueUnclosedNotices` y `queueEveningSummaries` recorren todos los negocios activos (R5):
    - el aviso del panel sale siempre; el del celular, sólo con aparatos;
    - el resumen sale una vez para el negocio y una vez por cada agenda con usuario que no sea el
      propietario (sus propias citas);
    - con las claves `unclosed:<cita>:<fin>`, `resumen:<negocio>:<fecha>` y `resumen:<agenda>:<fecha>`.
  - `back/src/jobs/scheduled-tasks.ts`: `cleanupPanelNotices` y la cifra en el informe.
  - `back/scripts/cron.ts`: «avisos del panel: N» en la línea del registro.

## Fase 5: Historia 3 - La página «Avisos» (P2)

- [ ] T013 [US3] `front/src/pages/dashboard/notices-page.tsx` (nuevo):
  - agrupados por día («Hoy», «Ayer», «Mar 13 oct»);
  - «Sólo los no leídos», «Marcar todo como leído» y «Cargar más».

  En `front/src/app/router.tsx`, la ruta `/dashboard/notices`.

## Fase 6: Historia 4 - El super admin tiene la suya (P2)

- [ ] T014 [US4] `back/src/services/push-notices.ts`: `addPlatformNotice` en:
  - `notifyNewBusiness` y `notifyPlanRequest`;
  - `queueAccountSecurityNotices`, con la clave `cuenta:<registro>`;
  - `queueLoginAttackNotice`, con la clave `intentos:<cuenta>:<hora>`.

  Siempre, haya o no aparatos.
- [ ] T015 [US4] `back/src/routes/platform-routes.ts`: `/admin/notices` (las cuatro rutas, con la
  verificación en dos pasos). En el front:
  - `front/src/components/layout/admin-sidebar.tsx` y `admin-layout.tsx`: la campana;
  - `front/src/pages/admin/admin-notices-page.tsx` (nuevo);
  - `front/src/app/router.tsx`: la ruta `/admin/notices`.

## Fase 7: Pruebas del backend

- [ ] T016 `back/tests/panel-notices.test.ts` (nuevo): los nueve puntos del quickstart §1.
  - Los cuatro roles en la Clínica Dental Sonrisa, más un administrador creado por la prueba y una
    agenda sin usuario, comparados con `NOTICE_AUDIENCE`.
  - El cron con la hora simulada.
  - Leído y «Marcar todo»; los textos con el nombre completo y sin datos de contacto.
  - Casos límite:
    - el modo soporte;
    - quien entra nuevo, quien sale y el cambio de rol;
    - la cita movida, el paciente borrado, los 30 días y el negocio suspendido.
  - RF-011, con la tabla renombrada.
  - /admin y sin actividad.
- [ ] T017 [P] `back/tests/push-notices.test.ts` (sigue igual: los textos del celular no cambian) y
  `back/tests/cron.test.mjs` (la expresión regular de la línea del registro, con «avisos del panel»).

## Fase 8: Comprobación del back y el front

- [ ] T018 `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`. `front/`: `npm run build` y
  `npm run lint`.
- [ ] T019 Recorrido con Playwright del quickstart §2: la versión compilada, en escritorio y a 390 px,
  con la API en el 4180 y el preview en el 5199. Se detienen por PID.
- [ ] T020 [P] READMEs del backend y del front: la campana.

## Fase 9: La beta (después del back y el front)

- [ ] T021 Copia previa: `beta-src-antes-014.tgz` en el scratchpad.
- [ ] T022 `beta/src`: copia de los archivos compartidos del front:
  - `types/index.ts` (sólo lo nuevo);
  - `lib/constants/notices.ts` y `lib/notices.ts`.
- [ ] T023 `beta/src/lib/data/mock/`:
  - **`store.ts`:**
    - `panelNotices`, `panelNoticeReads` y `panelNoticeState` en `MockDatabase`;
    - `??= []` en `migrateData`;
    - `panelNotices` en `BUSINESS_COLLECTIONS`;
    - en `purgeExpired`, los 30 días y como mucho `BETA_MAX_NOTICES`.
  - **`seed.ts`:** las colecciones vacías y los avisos de ejemplo de la clínica (de hoy y de ayer).
    Van con una clave nueva de `demoUpgrades`, para que los reciban también las bases ya guardadas.
    **No se sube `MOCK_DB_VERSION`.**
- [ ] T024 `beta/src/lib/data/mock/notices-repository.ts` (nuevo): los cuatro métodos, con
  `NOTICE_AUDIENCE` y `describeNotice` (nombre completo). Se conecta en `lib/data/index.ts` y
  `repository.ts`.

  Cada suceso suma su aviso:
  - `public-booking-repository.ts`: `book`, `confirmAppointment`, `cancelAppointment` y
    `completeReceiptUpload`;
  - `business-data-repository.ts`: `create` y `createSeries`.
- [ ] T025 `beta/src`: la campana, la lista y la página «Avisos» (copiadas de `front/src/features/notices`
  y las páginas), adaptadas a su layout:
  - `sidebar-content.tsx` y `admin-sidebar.tsx`;
  - `app-shell.tsx`, en la barra del celular;
  - el router.

  `refetchInterval` de 3 minutos, más el refresco al volver a la pestaña.
- [ ] T026 Beta: `npm run build` y `npm run lint`, y el recorrido del quickstart §3 en el puerto 3199
  (se detiene por PID).

## Fase 10: Cierre

- [ ] T027 `reporte.md` (plantilla `.specify/templates/reporte-template.md`), el estado de la spec y
  los commits en `back/` y `front/`, sin firma de herramientas de IA.

## Dependencias

- **Fase 1 → Fase 2 → Historias 1 y 2:** T002 (compartido) y T003 (migración) van antes que todo, y
  T005 antes que las rutas y los ganchos.
- **Historia 1 antes que la 3:** la página usa los hooks de T009 y los componentes de T010.
- **Historia 4** necesita T005 y T009.
- **Pruebas (T016)** después de T007, T008, T012 y T014.
- **La beta (Fase 9)** después de T002, T010, T013 y T015, porque copia del front.

## Paralelo

- T004 con T005.
- T011 (service worker) con T009 y T010.
- T013 (página) con T012 (cron).
- T017 con T016.
- T020 (READMEs) con T019.

## Estrategia

1. **Primero lo mínimo útil:** las Fases 1 a 3. El propietario ve la campana con las reservas,
   confirmaciones y cancelaciones.
2. **Después:**
   - el equipo (historia 2, con el cron);
   - la página (historia 3);
   - /admin (historia 4).
3. **Al final:** las pruebas, la comprobación, la beta y el reporte.
