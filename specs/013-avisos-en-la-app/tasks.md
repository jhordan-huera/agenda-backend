---

description: "Tareas de «Avisos en el celular desde la app instalada»"
---

# Tareas: Avisos en el celular desde la app instalada

**Entrada**: `specs/013-avisos-en-la-app/` (plan aprobado el 2026-10-14, con las decisiones del dueño
del producto de ese día y sus «Cambios respecto a la spec»).

**Pruebas**:
- **Backend:**
  - suites nuevas: `tests/web-push.test.ts` (sin red) y `tests/push-notices.test.ts` (API de pruebas y
    un servicio de avisos falso);
  - suites que se actualizan: `cron`, `hardening` y `delete-business`.
- **Front:** build, lint y el recorrido con Playwright del quickstart (§2), con la versión compilada, en
  escritorio y a 390 px.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front. La beta queda fuera (no tiene servidor).
Las decisiones R1–R20 están en `research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.8.0 (MENOR), igual en `back/` y `front/` (`.specify/memory/constitution.md`):
  - **Principio II:** el punto de ntfy incluye los avisos en el celular;
  - **Principio III:** el punto nuevo de los avisos en el celular;
  - **Restricciones:** las claves VAPID y los servicios de avisos permitidos.
- [x] T002 Código compartido en `front/` y después `npm run sync:shared` en `back/` (los dos archivos
  nuevos, creados vacíos antes en `back/src/shared/`):
  - `src/types/index.ts`: `PushKind`, `PushConfig` y `PushDevice`;
  - `src/lib/constants/push.ts` (nuevo): tipos por rol, etiquetas, 30 min, las 20 h, 7 días y 10
    aparatos;
  - `src/lib/validations/push.ts` (nuevo): `pushDeviceSchema`, `pushKindsSchema` y
    `pushEndpointSchema`.
- [x] T003 `back/db/migrations/040_push_notifications.sql` (data-model): `push_subscriptions` y
  `push_messages`, con la protección de filas.

## Fase 2: El envío (R1, R2, R4, R6)

- [x] T004 `back/src/services/web-push.ts` (nuevo, sin librería): `encryptPushPayload` (RFC 8291 y
  8188), `vapidHeader` (RFC 8292, JWT en memoria por origen), `sendWebPush`, `isAllowedPushEndpoint`,
  `isValidPushKeys` y `generateVapidKeys`.
- [x] T005 `back/src/config.ts`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`;
  `config.webPush` (null sin claves válidas, con el aviso en el registro y sin valores);
  `config.pushAllowsLocalEndpoints` (sólo con la base local).
- [x] T006 `back/src/services/push-delivery.ts` (nuevo): `queuePush` con punto de guardado,
  `processPushQueue` (reserva, envío de 5 en 5, reintentos, caducidad y bajas),
  `schedulePushDelivery`, `flushPushDelivery`, `disableImmediatePushDelivery` y la limpieza.
- [x] T007 `back/scripts/push-keys.ts` y `npm run push:keys`; `scripts/dev-local.ts` (claves de
  desarrollo en `.local-db/vapid.json`); `scripts/test.ts` (claves de las pruebas).

## Fase 3: Historias 1 y 4 - Activar los avisos (P1 y P2)

- [x] T008 [US1] `back/src/services/push-device-service.ts` (nuevo, R3, R5): la configuración, guardar
  el aparato (dirección única, otra persona, `previousEndpoint`, hasta 10), los tipos, desactivar, el
  aviso de prueba y la pausa al cerrar sesión.
- [x] T009 [US1] `back/src/routes/push-routes.ts` (nuevo): `/api/push` con `avisos-aparato` (30) y
  `aviso-prueba` (5) en 15 min; `src/http/errors.ts`: `push_failed` (502); `src/app.ts`: monta
  `/api/push`, `"push"` en `/api/health` y `flushPushDelivery` en Lambda.
- [x] T010 [US1] `back/src/services/auth-service.ts`: `signOut` pausa los aparatos de esa sesión (R3).

## Fase 4: Historias 2 y 4 - Qué avisa al momento (P1 y P2)

- [x] T011 [US2] `back/src/services/push-notices.ts` (nuevo, R7): los textos con el paciente a medias,
  «Hoy/Mañana/Mar 20 oct», «· con …» con varias agendas y «· Por verificar»; `notifyOnlineBooking`,
  `notifyReceipt`, `notifyPatientCancel`, `notifyNewAppointment`, `notifyNewSeries` (el enganche de
  la spec 011), `notifyNewBusiness` y `notifyPlanRequest`.
- [x] T012 [US2] Enganches: `public-booking-service.ts` (`book`), `payment-service.ts`
  (`completeUpload`), `business-data-service.ts` (`appointmentService.create` y
  `cancelFromPatientLink`) y `account-service.ts` (`businessService.create` y
  `subscriptionService.requestPlanChange`) (R8–R11, R14).

## Fase 5: Historias 3 y 4 - Lo que sale del cron (P1 y P2)

- [x] T013 [US3] `push-notices.ts`: `queueUnclosedNotices` (ventana del cron con tope de 3 h, clave
  por cita) y `queueEveningSummaries` (las 20:00 de cada zona, una vez por día) (R12, R13).
- [x] T014 [US4] `push-notices.ts`: los cambios de seguridad de cuentas de super admin y los intentos
  fallidos; `account-alerts.ts`: `AccountChange.id` (R14).
- [x] T015 `back/src/jobs/scheduled-tasks.ts`: `runPushJobs` después de los avisos de ntfy, con el
  bloque `push` del informe; `scripts/cron.ts`: la línea del registro, `disableImmediatePushDelivery`
  y el aviso de ntfy «los avisos en la app no salen»; `.github/workflows/cron.yml`: `VAPID_*` (R15).
- [x] T016 `back/src/db/seed.ts`: `push_messages` y `push_subscriptions` en `TABLES`.

## Fase 6: Pruebas del backend

- [x] T017 `back/tests/web-push.test.ts`: el ejemplo de la RFC 8291 byte a byte, de punta a punta, el
  JWT VAPID, `generateVapidKeys`, las direcciones permitidas y las claves del aparato.
- [x] T018 `back/tests/push-notices.test.ts` y el servicio de avisos falso en
  `tests/helpers/harness.ts` (quickstart §1).
- [x] T019 Actualizar `cron`, `hardening` y `delete-business`.
- [x] T020 `npm run typecheck` y todas las suites con `env -u DATABASE_URL npm test`.

## Fase 7: El front (historias 1 a 4)

- [x] T021 [US1] Datos: `push.*` en `repository.ts` y `api-repository.ts` (el 404 como «no
  disponible»), `src/hooks/queries/use-push.ts`, sus claves y el código `push_failed`.
- [x] T022 [US2] `src/sw.ts`: `push`, `notificationclick` y `pushsubscriptionchange` (R16);
  `public/icon-badge-96.png`; `src/features/push/notification-navigation.ts`, cargado en `main.tsx`.
- [x] T023 [US1] `src/features/push/`: `push-support.ts`, `use-push-device.ts` (activar, desactivar,
  tipos, prueba y la sincronización silenciosa), `push-prompt.tsx` (la franja) y
  `push-settings-card.tsx` (la tarjeta); `install-prompt.ts` e `install-app.tsx` exportan lo que
  reutilizan y cambia el texto de `InstallAppCard` (R17).
- [x] T024 [US1] Layouts (`dashboard-layout.tsx`, `admin-layout.tsx`): la franja, la sincronización y
  `/login?next=`; `login-form.tsx`, `redirect-if-authenticated.tsx` y `src/lib/auth/next-path.ts`
  (`safeNextPath`) (R18).
- [x] T025 [US1] La tarjeta en Configuración → Notificaciones (propietario, fuera del modo soporte) y
  en Configuración de /admin; `admin-activity-page.tsx` con `?ver=seguridad`.
- [x] T026 `src/pages/privacy-page.tsx` (R19) y `npm run build` y `npm run lint`.

## Fase 8: Comprobación y cierre

- [x] T027 Recorrido con Playwright del quickstart §2 (versión compilada, escritorio y 390 px), con el
  servicio de avisos real de Google si Chrome lo permite.
- [x] T028 Cierre: README del backend y del front, `reporte.md`, estado de la spec y commits sin
  firma de IA.

## Dependencias

- T001–T003 primero. T002 va antes de cualquier tarea que use los tipos o las constantes.
- **Backend:** T004 → T005 → T006 → T007 → T008–T010 → T011 → T012 → T013–T016 → T017–T020.
- **Front:** T021 → T022 → T023 → T024 → T025 → T026; sólo dependen de T002 y del contrato.
- **T027 y T028**, al final.

## Paralelo

- **[P] reales:** el front (T021–T026) mientras se escriben las pruebas del backend (T017–T019).

## Estrategia

1. **MVP:** historias 1 y 2 (P1): activar y recibir las reservas, los comprobantes y las cancelaciones.
2. **Después:** historia 3 (P1): las citas por cerrar y el resumen de las 8 desde el cron.
3. **Al final:** historia 4 (P2): los avisos del super admin; comprobación, README y reporte.
4. **Se publica** en el orden del plan: claves, migración 040, backend y front.

## Enganche para la spec 011

- Las series de la 011 avisan una sola vez: `notifyNewSeries(db, created, actor.userId)` de
  `src/services/push-notices.ts`, al final de la transacción de `appointment-series-service.ts`, con
  las citas creadas. La 013 deja la función y su prueba; la llamada la pone quien fusione la 011.
