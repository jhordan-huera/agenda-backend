---

description: "Tareas de «El paciente confirma o cancela su cita desde el email»"
---

# Tareas: El paciente confirma o cancela su cita desde el email

**Entrada**: `specs/010-paciente-confirma-cancela/` (plan aprobado el 2026-10-14, con las decisiones del
dueño del producto de ese día).

**Pruebas**:
- **Backend:**
  - suite nueva: `tests/appointment-page.test.ts`;
  - suites que se actualizan: `email-templates`, `status-notices`, `booking-alert`, `reminders`,
    `multi-client-appointments`, `couple-booking`, `booking-verify` y `payments`.
- **Front y beta:** build, lint y el recorrido con Playwright del quickstart, en escritorio y a 390 px.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta. Las decisiones R1–R15
están en `research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.7.0 (MENOR), igual en `back/` y `front/` (`.specify/memory/constitution.md`):
  - **Principio II:** «Las páginas públicas (reservas, pago y «Tu cita»)…».
  - **Principio III:** los puntos nuevos de las specs 010, 011 («Agendar igual» aprobado) y 012.
- [x] T002 Código compartido en `front/` y después `npm run sync:shared` en `back/`:
  - `src/types/index.ts`: `Appointment.clientConfirmations`, `PublicAppointment`,
    `PublicAppointmentResult` y el tipo de email `patient_cancelled` (aviso al negocio, decisión 2);
  - `src/lib/constants/business.ts`: `canCancelOnline` y `APPOINTMENT_PAGE_DAYS`;
  - `src/lib/email/layout.ts`: el bloque `link`;
  - `src/lib/email/templates.ts`: `appointmentPage` en los seis emails de cita activa, «Confirmo que
    voy» en el recordatorio, `professionalCopy.byPatient` y la plantilla `patientCancelled`.
- [x] T003 `back/db/migrations/037_patient_confirms_cancels.sql` (data-model):
  - `appointments.client_confirmed_at`;
  - `appointment_clients.access_token` (único) y `confirmed_at`;
  - los dos triggers que borran la confirmación.

## Fase 2: Historias 1 y 2 - Confirmar y cancelar desde «Tu cita» (P1)

- [x] T004 [US1] `back/src/db/columns.ts`: `clientConfirmationsSql` en `appointmentColumns` (R10).
- [x] T005 [US1] `back/src/services/appointment-page-service.ts` (nuevo, R1–R4, R6):
  - `findByLinkToken`: `payment_token` o `access_token`, el formato, el negocio activo y los 30 días;
  - la página (`PublicAppointment`, sin datos del paciente), confirmar y cancelar con la cita
    bloqueada y `canCancelOnline`.
- [x] T006 [US2] `back/src/services/business-data-service.ts`:
  - `saveAppointment`: token nuevo y sin confirmación al cambiar el paciente principal (R2);
  - `cancelFromPatientLink(db, before)` (R6);
  - `confirmClaim` conserva `access_token` y `confirmed_at`;
  - `clientConfirmations: []` en el borrador de `create`.
- [x] T007 [US1] `back/src/routes/platform-routes.ts`: `GET /public/appointments/:token`,
  `POST …/confirm` y `POST …/cancel`, con `mi-cita` (60) y `mi-cita-acciones` (20) en 15 min y
  `Cache-Control: private, no-store` (R9).

## Fase 3: Historia 3 - El enlace en los emails (P1)

- [x] T008 [US3] `back/src/services/notifications.ts` (R7):
  - `appointmentPageUrl`; el token y la confirmación de cada `Recipient`;
  - el enlace de cada persona en `notifyAppointmentChange` y `runReminderJob`, con `canCancel`;
  - origen `"patient_link"`: copia con `byPatient` y el aviso al negocio (`patient_cancelled`) si su
    email es distinto del del profesional (decisión 2).
- [x] T009 [US3] `back/src/services/booking-alerts.ts`: `findStatusChanges` lee la acción y
  `statusChangeNotice` dice «por el paciente» (R8); `back/scripts/cron.ts`: el grupo del tipo nuevo.
- [x] T010 [US3] `back/src/db/seed-data.ts` y `seed.ts`: citas demo de mañana confirmadas por el
  paciente.

## Fase 4: Pruebas del backend

- [x] T011 `back/tests/appointment-page.test.ts` (quickstart §1).
- [x] T012 Actualizar `email-templates`, `status-notices`, `booking-alert`, `reminders`,
  `multi-client-appointments`, `couple-booking`, `booking-verify` y `payments`.
- [x] T013 `npm run typecheck` y todas las suites con `env -u DATABASE_URL npm test`.

## Fase 5: Historias 1, 2 y 4 en el front (P1 y P2)

- [x] T014 [US1] Datos: `publicBooking.getAppointment`, `confirmAppointment` y `cancelAppointment`
  (`repository.ts`, `api-repository.ts`); `usePublicAppointment`, `useConfirmAppointment` y
  `useCancelAppointment` con su clave; `getCantAttendWhatsAppUrl` en `src/lib/whatsapp.ts`.
- [x] T015 [US1] La página «Tu cita» (R12): ruta `/cita/:token`, `src/pages/appointment-page.tsx` y
  `src/features/patient-appointment/` (tarjeta, confirmar con `?confirmar=1`, cancelar con
  `ConfirmDialog`, contacto del negocio); enlace desde `payment-page.tsx`.
- [x] T016 [US4] La marca «Confirmó el paciente» (R10): `client-confirmed-badge.tsx`, el resumen en
  `appointment-utils.ts`, el bloque y la lista de la agenda, la ficha (con la hora y por persona) y el
  Inicio («Lo que queda de hoy» y «Tu siguiente cita»).
- [x] T017 [US4] Configuración → Agenda: los textos y el aviso del recordatorio (R11); actividad:
  «Pacientes (página y emails)»; bandeja de emails: la etiqueta del tipo nuevo.
- [x] T018 Front: `npm run build` y `npm run lint`.

## Fase 6: Beta, comprobación y cierre

- [ ] T019 Beta (R13), con copia previa de su código:
  - tipos, plantillas y `canCancelOnline` a mano; `StoredAppointment` y `migrateData` con los tokens
    y las confirmaciones de las otras personas;
  - repositorio de prueba: `getAppointment`, `confirmAppointment` y `cancelAppointment`; borrar la
    confirmación al mover, cambiar de profesional o de principal y al cancelar;
  - emails con el enlace de cada persona; la bandeja simulada con los enlaces que se abren;
  - `/cita/:token`, la marca en la agenda, el Inicio y la ficha; citas demo confirmadas;
  - build y lint.
- [ ] T020 Recorrido con Playwright del quickstart §2 (escritorio y 390 px) y el de la beta (§3).
- [ ] T021 Cierre: README del backend (y del front), `reporte.md`, estado de la spec y commits sin
  firma de IA.

## Dependencias

- T001–T003 primero. T002 va antes de cualquier tarea que use tipos o plantillas.
- **Backend:** T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011–T013.
- **Front:** T014 → T015; T016 y T017 sólo dependen de T002.
- **Beta (T019)** después de T015–T017.
- **T020 y T021**, al final.

## Paralelo

- **[P] reales:** T016 y T017 (archivos propios) mientras se hacen T014–T015.
- **La beta (T019)** puede hacerla un agente aparte cuando el front esté terminado.

## Estrategia

1. **MVP:** historias 1, 2 y 3 (P1): la página, confirmar, cancelar y el enlace en los emails.
2. **Después:** historia 4 (P2): la marca en el panel y Configuración.
3. **Al final:** beta, comprobación, README y reporte.
4. **Se publica** en el orden del plan: migración, front y backend.
