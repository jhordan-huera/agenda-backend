# Tareas: Recordatorios del comprobante de pago

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front, `beta/` = ~/Documentos/Proyectos/Betas/agenda-beta.

## Fase 1: Base y código compartido

- [X] T001 back/db/migrations/055_recordatorio_comprobante.sql: `businesses.payment_reminders` y `payment_reminder_days` (`before_three`, `after_booking`, `before_and_morning`), `professionals.payment_reminder_mode` (`before`, `after`), `appointments.payment_reminders_sent` (0–3) y `payment_reminded_on`
- [X] T002 [P] front/src/types: `Business.paymentReminders`, `Professional.paymentReminderMode` y sus tipos; front/src/lib: la regla «sin comprobante» compartida, la etiqueta de los días y los esquemas de las dos rutas
- [X] T003 [P] front/src/lib/email/templates.ts: `paymentReminder` (una o varias citas, cuentas, botón, nota amable)
- [X] T004 `npm run sync:shared` en back/ y `typecheck`

## Fase 2: Backend (Historias 1, 2 y 3)

- [X] T005 [H1] back/src/services/admin-service.ts y platform-routes.ts: `PUT /admin/businesses/:id/payment-reminders` (`enabled`, `defaultMode`, `days`), las agendas toman el modo por defecto al activarlo, la actividad del negocio y de la plataforma; `Business` lo devuelve
- [X] T006 [H3] back/src/services/professional-service.ts y business-routes.ts: `PATCH /businesses/:id/professionals/:pid/payment-reminder-mode`, los permisos del calendario (spec 027), 409 sin activar y la actividad
- [X] T007 [H2] back/src/jobs/scheduled-tasks.ts: `queuePaymentReminders(now)` (los modos, los días, el tope de 3, un email por paciente y día, sólo el principal con email) y la cifra en el registro del cron (scripts/cron.ts); back/src/services/email-limits.ts: `payment_reminder` en el nivel «paciente» y sin copia al profesional
- [X] T008 [H4] back/src/services/notifications.ts: en un negocio activado, el email del comprobante va siempre al profesional de la agenda; avisos en el celular: el rol Profesional recibe «receipt» de sus citas en un negocio activado
- [X] T009 [H1][H2][H3][H4] back/tests/payment-reminders.test.ts (lo que pide el plan) y los ajustes de las pruebas que cambien

## Fase 3: Front (Historias 1, 3 y 4)

- [X] T010 [H1] /admin, ficha del negocio: la tarjeta «Pedir el comprobante de pago» (interruptor, modo por defecto, días del modo «Antes» con un ejemplo)
- [X] T011 [H3] El modo de la agenda junto a «Tus citas en tu calendario»: «Tu agenda» (Pro), Profesionales (Business) y el Perfil del rol Profesional
- [X] T012 [H4] La cita (appointment-payment.tsx): la marca «Sin comprobante» y «Recordar el pago por WhatsApp» con el enlace; la marca en la agenda y el tablero y el filtro «Sin comprobante»
- [X] T013 Constitución 1.32.0 en los dos repos (la decisión, la excepción a la copia y el aviso del comprobante en el celular del rol Profesional)

## Fase 4: La beta

- [X] T014 Copia de seguridad y la misma interfaz (interruptor en su /admin, modo, marca y WhatsApp) con su repositorio de ejemplo, sin emails

## Fase 5: Comprobación

- [X] T015 back: `typecheck` y `npm test`; front: build, lint, `check:contrast` y `check:data-export`; beta: build y lint
- [X] T016 Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro, con capturas
- [ ] T017 La prueba real: un recordatorio al buzón de pruebas (LOCAL_TEST_INBOX) con la base de prueba y la cuenta de Gmail, como `dev:local`
