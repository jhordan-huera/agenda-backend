---

description: "Tareas del aviso al paciente en cada cambio de estado de su cita"
---

# Tareas: Aviso al paciente en cada cambio de estado de su cita

**Entrada**: `specs/008-avisos-cambio-estado/` · **Pruebas**:
- backend: `tests/status-notices.test.ts` (nueva) y `tests/booking-alert.test.ts` (ampliada);
- front y beta: build, lint y el recorrido con Playwright del quickstart.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta.

## Fase 1: Base

- [x] T001 Constitución 1.5.0, igual en `back/` y en `front/` (`.specify/memory/constitution.md`). En el principio III, la decisión de avisar al paciente en cada cambio de estado de su cita, con:
  - el email y el WhatsApp;
  - la casilla «Avisar al paciente»;
  - «Seguimiento» encendido y sólo para citas de los últimos 7 días;
  - el aviso por ntfy al dueño del producto.
- [x] T002 Compartido en `front/`:
  - `src/types/index.ts`: `EmailType` gana `appointment_pending`, `appointment_completed` y `appointment_no_show`; `WhatsAppNoticeKind`, `unconfirmed`; `NotificationSettings`, `followUps`;
  - `src/lib/validations/business.ts`: `followUps: z.boolean().default(true)`;
  - `src/lib/validations/appointment.ts`: `unconfirmed` en `whatsAppNoticeSchema`;
  - `src/lib/constants/business.ts`: `followUps: true`;
  - `src/lib/email/templates.ts`: `appointmentPending`, `appointmentCompleted` y `appointmentNoShow`.

  Después, `npm run sync:shared` en back/.

## Fase 2: Historias 1 y 2 - Emails y la casilla (P1)

- [x] T003 [US1] `back/src/services/notifications.ts`: los tres casos nuevos de `clientMessageFor`, después de los de hoy (plan D1). «Seguimiento» se lee como `settings.followUps !== false`, y el límite es de 7 días desde la fecha de la cita, en la zona del negocio.
- [x] T004 [US2] `back/src/services/business-data-service.ts` y `back/src/routes/business-routes.ts`:
  - `updateStatus(…, status, notify)`, con `notify` sí o no y sí por defecto;
  - con `false` no se llama a `notifyAppointmentChange`, y el resumen de la actividad termina en « (sin avisar al paciente)»;
  - `WHATSAPP_NOTICE_LABELS.unconfirmed`.
- [x] T005 [US1] `back/tests/status-notices.test.ts`: lo que pide el quickstart §1.

## Fase 3: Historias 2, 3 y 4 - Panel (P1–P2)

- [x] T006 [P] [US2] `front/src/lib/data/repository.ts`, `api-repository.ts` y `front/src/hooks/queries/use-appointments.ts`: `notify` en el cambio de estado. Con `false`, no se ofrece WhatsApp.
- [x] T007 [US2] `front/src/features/appointments/appointment-details-sheet.tsx`: la casilla «Avisar al paciente por email y WhatsApp», marcada al abrir, para los botones de estado y «Cancelar cita».
- [x] T008 [P] [US4] `front/src/lib/whatsapp.ts`: `noticeForStatus` devuelve `unconfirmed` al pasar a Pendiente desde un estado que no sea Cancelada, con su texto. `front/src/features/appointments/whatsapp-notice.tsx`: `sendsEmail()` con las reglas nuevas y el motivo de `unconfirmed`.
- [x] T009 [P] [US3] `front/src/features/settings/notification-settings-form.tsx`: el interruptor «Seguimiento: Atendida y No asistió».
- [x] T010 [P] [US1] `front/src/features/settings/email-outbox.tsx`: los nombres de los tres tipos nuevos.

## Fase 4: Historia 5 - ntfy (P2)

- [x] T011 [US5] `back/src/services/booking-alerts.ts`: `findStatusChanges` y `statusChangeNotice` (plan D9). `EMAIL_ROLES` con los tipos nuevos.
- [x] T012 [US5] `back/src/jobs/scheduled-tasks.ts` y `back/scripts/cron.ts`: los avisos de cambios de estado, con el tope de 10 y la cifra del resto, y la línea en el registro del cron.
- [x] T013 [US5] `back/tests/booking-alert.test.ts`: lo que pide el quickstart §1 para ntfy.

## Fase 5: Beta, comprobación y cierre

- [x] T014 Beta: los mismos archivos del front, respetando sus diferencias, y su repositorio de prueba (el cambio de estado con `notify` y los emails nuevos en la cola simulada). Build y lint.
- [x] T015 Comprobar:
  - back: `npm run typecheck` y `npm test`;
  - front: `npm run build` y `npm run lint`;
  - el recorrido de Playwright del quickstart §2 y la beta en el 3199.
- [x] T016 README del backend (la ruta con `notify`, los emails nuevos y ntfy). Commits sin firma de IA. Después, `/speckit-reporte`.

## Dependencias

- T001 y T002 primero.
- T003 → T004 → T005.
- T006 → T007.
- T011 → T012 → T013.
- La beta, al final.
