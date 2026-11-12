# Tareas: Encuesta después de la cita

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Con la migración 057. La beta no cambia.

## Fase 1: La base y el código compartido

- [X] T001 `back/db/migrations/057_encuesta_despues_de_la_cita.sql`: `surveys`, `clients.surveys_opted_out_at` y el aviso `survey_low` en la campana, con RLS
- [X] T002 `front/src/types`, `front/src/lib/validations/survey.ts` (nuevo; antes vacío en `back/src/shared`), `front/src/lib/constants` (los plazos, `notificationSettings.surveys`, `survey_low` en la campana), la plantilla `surveyRequest` y las cifras del informe mensual en `front/src/lib/email/templates.ts`. `npm run sync:shared`
- [X] T003 `back/src/db/seed.ts`, `back/src/services/database-stats-service.ts` y `back/tests/delete-business.test.mjs`; `EMAIL_PRIORITY`, `EMAIL_GROUPS` y `TYPE_LABELS`

## Fase 2: El envío y la respuesta (Historia 1, P1)

- [X] T004 [US1] `back/src/services/surveys.ts` (nuevo): `runSurveyJob` (desde las 10:00, de 1 a 3 días después, una cada 90 días por paciente, sin la marca, sin copia), la página pública (`get`, `answer`, `optOut`, con la actividad y el aviso de 1 o 2 estrellas); `queueSurveyRequests` en `back/src/jobs/scheduled-tasks.ts`, `reminders.ts` y `back/scripts/cron.ts`; el descarte a los 2 días en `back/src/services/mailer.ts`; las rutas públicas
- [X] T005 [US1] `front/src/pages/survey-page.tsx` (nueva) y la ruta `/encuesta/:token`, con `noindex`, la limpieza de los avisos de errores y el modo del aparato

## Fase 3: Las opiniones (Historias 2 y 4)

- [X] T006 [US2] `GET /businesses/:businessId/surveys` (`reports.view`, `agendaScope`); `front/src/features/reports/patient-feedback-card.tsx` (nueva) en Reportes y el bloque «Sus opiniones» en la ficha del paciente
- [X] T007 [US2] El aviso `survey_low` en la campana (`back/src/services/panel-notices.ts`, `front/src/lib/notices.ts`, el icono)
- [X] T008 [US4] El informe mensual: `back/src/services/monthly-report.ts` y su email

## Fase 4: El interruptor (Historia 3)

- [X] T009 [US3] `front/src/features/settings/notification-settings-form.tsx`: «Preguntar al paciente cómo le fue»; `back/src/services/audit-changes.ts` (`NOTIFICATION_FIELDS`)

## Fase 5: Cierre

- [X] T010 La descarga de datos: `encuestas.xlsx`
- [X] T011 `back/tests/surveys.test.ts` (nueva) y al día `email-quota`, `cron`, `delete-business` y lo que toque
- [X] T012 [P] `front/scripts/check-surveys.ts` y `check:surveys`
- [X] T013 Constitución 1.47.0 en los dos repos (principio III)
- [X] T014 Backend: `typecheck` y `npm test`. Front: build, lint sin avisos y todas las `check:*`
- [X] T015 Recorrido en el navegador (Chromium 1440 en claro y WebKit 390 en oscuro), con capturas en `specs/048-encuesta-despues-de-la-cita/capturas/`
- [X] T016 Reporte final y subir a `dev`: «Pruebas» en verde en los dos repos

## Dependencias

- T001 a T003 van primero; T004 antes que T005 a T008.
- T009 sólo necesita T002.
- T014 a T016, al final.
