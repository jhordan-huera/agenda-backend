# Tareas: Informe mensual para el negocio

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front.

## Fase 1: Código compartido

- [X] T001 [P] front/src/types y front/src/lib: `NotificationSettings.monthlyReport`, `notificationSettingsSchema` con `.default(true)`, `DEFAULT_NOTIFICATION_SETTINGS`, el tipo de email `monthly_report` y los datos del informe (`MonthlyReportData`)
- [X] T002 [P] front/src/lib/email/templates.ts: `monthlyReport` (asunto con el mes, saludo, las cifras que no están en 0, la comparación, el botón a Reportes, la línea de referidos y la nota para apagarlo)
- [X] T003 `npm run sync:shared` en back/ y `typecheck`

## Fase 2: Backend (Historias 1 y 2)

- [X] T004 [H1] back/src/services/monthly-report.ts: las cifras del mes calendario anterior en la hora del negocio (como la analítica) y `runMonthlyReportJob` (días 1 a 7 desde las 8:00, una vez por negocio y mes con su clave, sin citas no sale, el email al propietario)
- [X] T005 [H1] back/src/jobs/scheduled-tasks.ts: `queueMonthlyReports(now)` (activos, con propietario y encendido) y la cifra en el registro del cron (scripts/cron.ts); back/src/services/email-limits.ts: `monthly_report` en el nivel «negocio»
- [X] T006 [H2] back/src/services/account-service.ts: `monthlyReport` sólo lo cambia el propietario (los demás y el modo soporte se ignoran); back/src/services/audit-changes.ts: «Informe mensual» en `NOTIFICATION_FIELDS`
- [X] T007 [H1][H2] back/tests/monthly-report.test.ts (lo que pide el plan) y los ajustes de las pruebas que cambien

## Fase 3: Front (Historia 2)

- [X] T008 [H2] front/src/features/settings/notification-settings-form.tsx: el interruptor «Informe mensual», sólo para el propietario; front/src/features/settings/email-outbox.tsx: «Informe mensual» en el historial
- [X] T009 Constitución 1.36.0 en los dos repos

## Fase 4: Comprobación

- [X] T010 back: `typecheck` y `npm test`; front: build, lint, `check:contrast` y `check:data-export`
- [X] T011 El interruptor en pantalla a 1440 px en claro y a 390 px en oscuro (propietario sí, administrador no), con capturas
- [X] T012 La prueba real: un informe al buzón de pruebas (LOCAL_TEST_INBOX) con la base de prueba y la cuenta de Gmail
