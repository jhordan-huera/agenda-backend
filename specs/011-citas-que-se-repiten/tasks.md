---

description: "Tareas de «Citas que se repiten»"
---

# Tareas: Citas que se repiten

**Entrada**: `specs/011-citas-que-se-repiten/` (plan aprobado el 2026-10-14, con las decisiones del dueño
del producto de ese día: «Agendar igual» sí y desmarcada al empezar, 8 citas por defecto y el WhatsApp
al cancelar la serie).

**Pruebas**:
- **Backend:**
  - suite nueva: `tests/appointment-series.test.ts`;
  - suites que se actualizan: `booking-alert`, `cron`, `email-templates`, `whatsapp-notice` y
    `delete-business`.
- **Front y beta:** build, lint y el recorrido con Playwright del quickstart, en escritorio y a 390 px.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta. Las decisiones R1–R16
están en `research.md`. La constitución ya está en la 1.7.0 con el texto de esta spec (se aplicó con la
010): no se toca.

## Fase 1: Base

- [x] T001 Código compartido en `front/` y después `npm run sync:shared` en `back/` (el archivo nuevo, la
  primera vez a mano a `src/shared/lib/`):
  - `src/types/index.ts`: `AppointmentSeriesFrequency`, `AppointmentSeriesRef` y `Appointment.series`,
    `SeriesDateStatus`, `SeriesDatePreview`, `AppointmentSeriesPreview`, `AppointmentSeriesCreated`, los
    tipos de email `appointment_series` y `appointment_series_cancelled` y el aviso `series_cancelled`;
  - `src/lib/appointment-series.ts` (nuevo): `seriesDates`, `classifySeriesDate`, `freeTimesOn` y
    `applyPlanLimit` (R1–R4);
  - `src/lib/validations/appointment.ts`: `seriesRepeatSchema`, `appointmentSeriesPreviewSchema`,
    `appointmentSeriesSchema`, `cancelFollowingSchema` y `series_cancelled`;
  - `src/lib/email/templates.ts`: `appointmentSeries`, `appointmentSeriesCancelled` y la serie en
    `professionalNewAppointment` (R7, R8, R10).
- [x] T002 `back/db/migrations/038_appointment_series.sql` (data-model) y `appointment_series` en las
  tablas de `back/src/db/seed.ts`.

## Fase 2: Historia 1 - Agendar una serie (P1)

- [x] T003 [US1] `back/src/db/columns.ts`: `series` en `appointmentColumns` (R6); `series: null` en las
  citas que se arman a mano (`business-data-service.ts`, `seed-data.ts`).
- [x] T004 [US1] `back/src/services/business-data-service.ts`: exportar los ayudantes de crear una cita
  que reusa la serie; `series_cancelled` en `WHATSAPP_NOTICE_LABELS`.
- [x] T005 [US1] `back/src/services/appointment-series-service.ts` (nuevo): `preview` (R1–R4) y `create`
  con el negocio bloqueado, cada fecha comprobada otra vez y `skipped` (R5), y la actividad (R12).
- [x] T006 [US1] `back/src/routes/business-routes.ts`: `POST …/appointment-series/preview`,
  `POST …/appointment-series` (201) y `POST …/appointments/:id/cancel-following`.

## Fase 3: Historia 2 - Un solo email al paciente (P1)

- [x] T007 [US2] `back/src/services/notifications.ts`: `notifySeriesCreated` (cada paciente con los
  enlaces a «Tu cita» de la spec 010, la copia sin enlaces y un solo aviso al profesional, R7 y R8) y
  `notifySeriesCancelled` (R10); `back/src/services/email-limits.ts`: los dos tipos en
  `THIRD_PARTY_EMAIL_TYPES`.
- [x] T008 [US2] ntfy y cron (R11): `findPanelAppointments` sin las citas de una serie,
  `findPanelSeries` y `findSeriesCancellations` con sus avisos (`back/src/services/booking-alerts.ts`);
  el informe y la línea del registro (`back/src/jobs/scheduled-tasks.ts`, `back/scripts/cron.ts`), con
  `EMAIL_GROUPS` y `COPIED_TYPES`.

## Fase 4: Historia 3 - Cambiar o cancelar la serie (P2)

- [x] T009 [US3] `appointmentSeriesService.cancelFollowing` (R10): las activas desde ésa por su número,
  sólo las de su agenda para el rol Profesional, un email por paciente, una copia por profesional, la
  casilla «Avisar al paciente» y una sola entrada de actividad.

## Fase 5: Pruebas del backend

- [x] T010 `back/tests/appointment-series.test.ts` (quickstart §1).
- [x] T011 Actualizar `booking-alert`, `cron`, `email-templates`, `whatsapp-notice` y `delete-business`.
- [x] T012 `npm run typecheck` y todas las suites con `env -u DATABASE_URL npm test`.

## Fase 6: Historias 1 y 3 en el front (P1 y P2)

- [x] T013 [US1] Datos: `previewSeries`, `createSeries` y `cancelFollowing` (`repository.ts`,
  `api-repository.ts`); `usePreviewAppointmentSeries`, `useCreateAppointmentSeries` y
  `useCancelFollowingAppointments`.
- [x] T014 [US1] «Repetir» en «Nueva cita» (`appointment-form-dialog.tsx`, `series-fields.tsx` nuevo) y
  la lista de fechas en el mismo diálogo (`series-review.tsx` nuevo), con «Otra hora», «Agendar igual»,
  «Quitar» y el cupo recalculado al momento (R13).
- [x] T015 [US3] La ficha: «Cita 3 de 8 · cada semana» y «Cancelar ésta y las siguientes», con la
  casilla «Avisar al paciente» y el WhatsApp ya escrito con las fechas (`whatsapp.ts`,
  `whatsapp-notice.tsx`); la bandeja de emails con los dos tipos nuevos.
- [x] T016 Front: `npm run build` y `npm run lint`.

## Fase 7: Beta, comprobación y cierre

- [x] T017 Beta (R15), con copia previa de su código (`beta-src-antes-011.tgz`):
  - tipos, `lib/appointment-series.ts`, validaciones y plantillas;
  - repositorio de prueba: `previewSeries`, `createSeries` y `cancelFollowing`, con el cupo de
    `mock/plan-limits.ts` y la serie guardada en cada cita;
  - los dos emails en la bandeja simulada;
  - el formulario, la lista y la ficha como en el front;
  - build y lint.
- [x] T018 Recorrido con Playwright del quickstart §2 (escritorio y 390 px) y el de la beta (§3).
- [ ] T019 Cierre: README del backend (y del front), `reporte.md`, estado de la spec y commits sin firma
  de IA.

## Dependencias

- T001–T002 primero. T001 va antes de cualquier tarea que use tipos, la lista o las plantillas.
- **Backend:** T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010–T012.
- **Front:** T013 → T014 → T015 → T016; sólo dependen de T001 y de las rutas de T006.
- **Beta (T017)** después de T014–T015.
- **T018 y T019**, al final.

## Paralelo

- **[P] reales:** T015 (la ficha, archivos propios) mientras se hace T014.
- **La beta (T017)** puede hacerse cuando el front esté terminado.

## Estrategia

1. **MVP:** historias 1 y 2 (P1): la lista, crear la serie y el email único.
2. **Después:** historia 3 (P2): la ficha y «Cancelar ésta y las siguientes».
3. **Al final:** beta, comprobación, README y reporte.
4. **Se publica** en el orden del plan: migración, backend y front.
