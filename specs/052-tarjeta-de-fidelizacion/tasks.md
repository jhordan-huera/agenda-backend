# Tareas: Tarjeta de fidelización

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) (aprobado el 2026-11-16, diseño B «Tarjeta clara») ·
Rutas: back/ = agenda-backend, front/ = agenda-front

## Base

- [X] T001 back/db/migrations/059_tarjeta_de_fidelizacion.sql:
  - las redes en businesses;
  - las tablas `loyalty_programs`, `loyalty_benefits`, `loyalty_cards`, `loyalty_stamps`, `loyalty_rewards`,
    `patient_accounts`, `patient_sessions` y `patient_password_links`;
  - sus índices y RLS.
- [X] T002 [P] front/src/types/index.ts: los tipos de la tarjeta, de la cuenta del paciente, del escaneo y de las redes.
- [X] T003 [P] front/src/lib/validations/ (`loyalty.ts`, `patient.ts`, `normalizePhone` en `fields.ts`),
  front/src/lib/constants/loyalty.ts y front/src/lib/permissions.ts (`loyalty.manage` y `loyalty.redeem`).
- [X] T004 [P] front/src/lib/email/templates.ts: `loyaltyReward` y la línea de progreso en `appointmentCompleted`.
  Después, `npm run sync:shared` desde back/.

## Historia 1 - El consultorio arma su programa (P1)

- [X] T005 [US1] back/src/services/loyalty.ts: el programa (GET y PUT) y los beneficios (crear, editar, activar,
  borrar o archivar), con la actividad. Las rutas van en back/src/routes/business-routes.ts.
- [X] T006 [US1] front/src/pages/dashboard/loyalty-page.tsx y front/src/features/loyalty/: «Programa» y «Beneficios»,
  con sus consultas; «Fidelización» en nav-items.ts y en el router.

## Historia 2 - Las citas atendidas suman sellos (P1)

- [X] T007 [US2] back/src/services/loyalty.ts: `onAppointmentStatus` (sumar, anular), `unlock` (recompensas, código,
  vencimiento, nivel) y la tarjeta de la ficha.
- [X] T008 [US2] back/src/services/business-data-service.ts: llamar a `onAppointmentStatus` desde `saveStatusChange`,
  la edición y la creación de citas; al unir dos fichas, mover las tarjetas, los sellos y las recompensas.
- [X] T009 [US2] back/tests/loyalty.test.ts: las pruebas 1 a 9 y 12 a 15, la corrección, el grupo, el «desde que se
  enciende» y el paciente desactivado.

## Historia 3 - La cuenta del paciente (P1)

- [X] T010 [US3] back/src/services/patient-accounts.ts y back/src/routes/patient-routes.ts: crear la cuenta, entrar,
  salir, `me`, `cards`, QR nuevo, contraseña, eliminar y el enlace de contraseña; la cookie aparte, el CAPTCHA y el
  límite de intentos; montarlo en app.ts.
- [X] T011 [US3] front/src/pages/patient/: entrar, crear, «Mi tarjeta» (diseño B), «Tus premios», el QR, los ajustes y
  `/mi-tarjeta/clave/:token`, con los colores de cada negocio; el router, vercel.json y los avisos de errores.

## Historia 4 - «Escanear» (P1)

- [X] T012 [US4] back/src/services/loyalty-scan.ts: escanear, unir y marcar como atendida; las rutas.
- [X] T013 [US4] front/src/features/loyalty/scan-dialog.tsx: la cámara (`BarcodeDetector` o `barcode-detector`
  3.2.3), la unión y «Marcar como atendida»; el botón en la Agenda y en Inicio; `/dashboard/escanear` y `/q/:token`.
- [X] T014 [US4] back/tests/patient-accounts.test.ts: la cuenta, la sesión aparte, el aislamiento, la unión, el
  marcado, el QR nuevo y la prueba 16.

## Historia 5 - El canje (P2)

- [X] T015 [US5] back/src/services/loyalty.ts: canjear (una sola vez, con la cita y el precio) y buscar por código;
  las pruebas 10 y 11.
- [X] T016 [US5] front: el bloque de la ficha, con «Canjear», y «Tiene 1 premio disponible» en la cita.

## Historia 6 - Avisos y contraseña (P2)

- [X] T017 [US6] back: el email `loyalty_reward` con su copia, la línea del email de seguimiento, `EMAIL_PRIORITY`, las
  etiquetas del cron y el enlace de contraseña desde la ficha, con sus pruebas.
- [X] T018 [US6] front: «Enlace para cambiar la contraseña» en la ficha y el aviso en la cuenta del paciente.

## Historia 7 - Las cifras (P3)

- [X] T019 [US7] back: `summary`, `members` y `rewards` con filtros; front: «Pacientes», «Recompensas» y las cifras.

## Historia 8 - Las redes (P3)

- [X] T020 [US8] back: las redes en `businessService.update`, la página de reservas y `BUSINESS_FIELDS`; front:
  Configuración → Negocio, la página de reservas y la tarjeta.

## Cierre

- [X] T021 [P] front: los textos de «sin cuenta» (landing-constants.ts, auth-showcase.tsx y login-page.tsx) y
  /privacidad.
- [X] T022 [P] front/scripts/check-loyalty.ts y `check:loyalty` en package.json.
- [X] T023 back: `TABLE_INFO`, las `TABLES` del seed, los `leftovers` de delete-business.test.mjs, borrar las sesiones
  vencidas y `security-scope`.
- [X] T024 .specify/memory/constitution.md de los dos repos: 1.50.0.
- [X] T025 back: `typecheck` y `npm test`; front: build, lint y todas las `check:*`; el recorrido con Playwright.
- [X] T026 back/specs/052-tarjeta-de-fidelizacion/reporte.md.

## Cambios después de probar (2026-11-16)

- [X] T027 back/src/services/loyalty-scan.ts: las fichas con el mismo teléfono al escanear, unir sin cita por teléfono,
  `newClient` («Paciente nuevo») y la cita de hoy atendida sola al escanear o al unir; la ruta `/scan/new-client`.
- [X] T028 back/src/services/loyalty.ts: `account` en el bloque de la ficha.
- [X] T029 back/src/services/patient-accounts.ts: el bloqueo creciente; front/src/lib/validations/loyalty.ts: el PIN de
  4 y `isEasyPassword`.
- [X] T030 front: el panel de Escanear, «Paciente nuevo» con `ClientFormDialog` (`custom`), el aviso de la ficha, los
  textos del PIN, `dev:https` y el aviso de página segura.
- [X] T031 back/tests/patient-accounts.test.ts y front/scripts/check-loyalty.ts: las pruebas de todo lo anterior.
- [X] T032 back: `GET /api/patient/invite/:slug` con su prueba; front: `PatientInviteDialog` (Fidelización y Escanear),
  `src/lib/qr-sheet.ts`, «Mi tarjeta» con `?consultorio=` y su comprobación en check-loyalty.ts.
