# Tareas: Lista de espera

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Con la migración 056. La beta no cambia.

## Fase 1: La base y el código compartido

- [X] T001 `back/db/migrations/056_lista_de_espera.sql`: `waitlist_entries`, `waitlist_freed_slots`, el disparador `appointments_freed_slot` y los avisos `waitlist_joined` y `waitlist_slot` en la campana, con RLS
- [X] T002 `front/src/types`, `front/src/lib/validations/waitlist.ts` (nuevo; antes vacío en `back/src/shared`), `front/src/lib/constants` (las partes del día, los topes, `bookingSettings.waitlist`), los `EmailType`, `PushKind`/`NoticeKind` y `AuditEntityType` nuevos. `npm run sync:shared`
- [X] T003 `back/src/db/seed.ts` (`TABLES`), `back/src/services/database-stats-service.ts` (`TABLE_INFO`) y `back/tests/delete-business.test.mjs` (`leftovers`)

## Fase 2: Anotarse (Historia 1, P1)

- [X] T004 [US1] `back/src/services/waitlist-service.ts` (nuevo): anotarse desde la página pública (CAPTCHA, límite, tope de 5, actualizar el mismo email), el enlace (`GET` y `leave`), la actividad, el email `waitlist_joined` (también en `publicEmailHold`) y el aviso `waitlist_joined`; rutas en `back/src/routes/platform-routes.ts`
- [X] T005 [US1] `front/src/features/booking/waitlist-form.tsx` (nuevo) en el paso de la fecha y la hora, y la página `/lista-de-espera/:token`, con `noindex` en `front/vercel.json` y su regla en `front/src/lib/error-report-rules.ts`

## Fase 3: Avisar cuando se libera una hora (Historia 2, P1)

- [X] T006 [US2] `back/src/jobs/scheduled-tasks.ts`: `queueWaitlistOffers(now)` (cerrar vencidas e inactivas, buscar quién espera cada hora, `getAvailableSlots`, el email `waitlist_offer` con el tope de 3 al día, el aviso `waitlist_slot`, los borrados) antes de `processEmailQueue`; el descarte a las 3 horas en `back/src/services/mailer.ts`; la cifra en `back/scripts/cron.ts`; también en `back/src/jobs/reminders.ts`
- [X] T007 [US2] «Reservar esta hora»: la página de reservas lee `servicio`, `profesional`, `fecha`, `hora` y `espera` (`front/src/pages/booking-page.tsx`, `front/src/features/booking/booking-flow.tsx`); `back/src/services/public-booking-service.ts` cierra las esperas con ese email al reservar

## Fase 4: La lista en el panel y el interruptor (Historias 3 y 4, P2)

- [X] T008 [US3] Rutas `/businesses/:businessId/waitlist` (`GET`, `POST`, `POST …/:entryId/close`) con `agendaScope` y la actividad; `front/src/features/waitlist/` (el panel, «Anotar», WhatsApp, «Agendar» y «Quitar») y el botón «Lista de espera (N)» en `front/src/pages/dashboard/calendar-page.tsx`; los avisos abren el panel con `?espera=1`
- [X] T009 [US4] `front/src/features/settings/booking-settings-form.tsx`: el interruptor «Lista de espera»; `back/src/services/audit-changes.ts` (`BOOKING_FIELDS`)

## Fase 5: Cierre

- [X] T010 La descarga de datos: `lista-de-espera.xlsx` (`back/src/services/data-export-service.ts`, su ruta, `front/src/features/data-export/`)
- [X] T011 `back/tests/waitlist.test.ts` (nueva) y al día `email-quota.test.ts`, `database-stats.test.ts` y `delete-business.test.mjs`
- [X] T012 [P] `front/scripts/check-waitlist.ts` y `check:waitlist`
- [X] T013 Constitución 1.46.0 en los dos repos (principio III)
- [X] T014 Backend: `typecheck` y `npm test`. Front: build, lint y todas las `check:*`
- [X] T015 Recorrido en el navegador (Chromium 1440 en claro y WebKit 390 en oscuro), con capturas en `specs/047-lista-de-espera/capturas/`
- [X] T016 Reporte final y subir a `dev`: «Pruebas» en verde en los dos repos

## Dependencias

- T001 a T003 van primero.
- T004 antes que T005 y T006; T006 antes que T007.
- T008 y T009 sólo necesitan T002.
- T014 a T016, al final.
