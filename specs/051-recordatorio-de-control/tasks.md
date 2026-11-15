# Tareas: Recordatorio de control

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

## Base

- [X] T001 back/db/migrations/058_recordatorio_de_control.sql: `return_after_days` y `return_after_since` en services,
  `control_reminders_since` en businesses, `control_reminders_opted_out_at` en clients y la tabla `control_reminders`
- [X] T002 [P] front/src/types/index.ts, front/src/lib/validations/{service,business}.ts y
  front/src/lib/constants/business.ts: los tipos, `returnAfterDays`, `controlReminders` y las constantes
- [X] T003 [P] front/src/lib/email/templates.ts: `controlReminder`; `npm run sync:shared` desde back/

## Historia 1 - El consultorio ve a quién le toca volver (P1)

- [X] T004 [US1] back/src/services/business-data-service.ts: «Volver en» y su fecha al crear y actualizar el servicio;
  `SERVICE_FIELDS`
- [X] T005 [US1] back/src/services/control-reminders.ts: `list` y `remove`; rutas en back/src/routes/business-routes.ts
- [X] T006 [P] [US1] front/src/features/services/service-form-dialog.tsx: «Volver en»
- [X] T007 [US1] front/src/features/control-reminders/: la hoja, sus consultas y el WhatsApp; el botón en
  front/src/pages/dashboard/calendar-page.tsx
- [X] T008 [P] [US1] front/src/pages/dashboard/client-detail-page.tsx: «Próximo control»

## Historia 2 - Al paciente le llega el aviso (P1)

- [X] T009 [US2] back/src/services/control-reminders.ts: `runControlReminderJob`; `queueControlReminders` en
  scheduled-tasks.ts y jobs/reminders.ts; `EMAIL_PRIORITY` y scripts/cron.ts
- [X] T010 [US2] back: el enlace público (GET y opt-out) en back/src/routes/platform-routes.ts
- [X] T011 [P] [US2] front/src/pages/control-reminder-page.tsx (`/recordatorio/:token`), el router, vercel.json y los
  avisos de errores
- [X] T012 [P] [US2] front/src/features/booking: `?servicio&profesional` en la página de reservas

## Historia 3 - El negocio lo configura (P2)

- [X] T013 [US3] back/src/services/account-service.ts: la fecha del interruptor; `NOTIFICATION_FIELDS`
- [X] T014 [P] [US3] front/src/features/settings/notification-settings-form.tsx y settings-page.tsx: el interruptor

## Pruebas y cierre

- [X] T015 back/tests/control-reminders.test.ts; `TABLE_INFO`, seed y delete-business.test.mjs; email-quota.test.ts
- [X] T016 [P] front/scripts/check-control-reminders.ts y `check:control-reminders` en package.json; las etiquetas del
  email y de la actividad
- [X] T017 .specify/memory/constitution.md de los dos repos: 1.49.0
- [X] T018 back: `npm run typecheck` y `npm test`; front: build, lint y todas las `check:*`; recorrido local con Playwright
- [X] T019 back/specs/051-recordatorio-de-control/reporte.md
