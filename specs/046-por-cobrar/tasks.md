# Tareas: Lo que debe cada paciente

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Sin migración. La beta no cambia.

## Fase 1: La regla compartida

- [X] T001 `front/src/lib/constants/business.ts`: `PENDING_PAYMENTS_SINCE` (la fecha en que se publica). `front/src/lib/pending-payments.ts` (nuevo): `isPendingPayment` (Completada, precio > 0, sin `paidAt`, fecha desde `PENDING_PAYMENTS_SINCE`). `front/src/types/index.ts`: `pendingAmount` y `pendingCount` en `ClientActivity`, y `PendingPaymentsSummary`. Copiar al backend con `npm run sync:shared`

## Fase 2: La API (Historias 1 y 2, P1)

- [X] T002 [US2] `back/src/services/business-data-service.ts` (`activity`): `pendingAmount` y `pendingCount`, sólo del paciente principal y con la constante como parámetro
- [X] T003 [US2] `back/src/services/pending-payments.ts` (nuevo; el plan decía `payment-service.ts`): `summary` (el total, los pacientes y las sesiones, con `agendaScope`) y `back/src/routes/business-routes.ts`: `GET /:businessId/pending-payments/summary`
- [X] T004 [US1] `back/src/services/pending-payments.ts`: `pay` (de 1 a 100 ids; sólo las del paciente como principal, Completadas, sin pagar y en su agenda; `appointments.manage` con bloqueo; una entrada `appointment.paid` por cita) y la ruta `POST /:businessId/clients/:clientId/pending-payments/pay`
- [X] T005 [US1] `back/tests/pending-payments.test.ts` (nueva): qué cuenta y qué no, la cita en pareja, el resumen y el total de Inicio iguales, marcar todas, los rechazos y el rol Profesional, con fechas fijas respecto de `PENDING_PAYMENTS_SINCE`

## Fase 3: El panel (Historias 1, 2 y 3)

- [X] T006 [P] `front/src/lib/data/repository.ts` y `api-repository.ts`: `pendingPaymentsSummary` y `payPending`. `front/src/hooks/queries/use-appointments.ts`: `usePendingPaymentsSummary` (un minuto de caché) y `usePayPendingPayments`, que recarga las citas, el resumen por paciente y el total
- [X] T007 [P] [US3] `front/src/lib/whatsapp.ts`: `buildPendingPaymentsMessage` (las sesiones, el total, las cuentas sin repetir; sin «deuda»)
- [X] T008 [US1] `front/src/features/payments/pending-payments-card.tsx` (nueva) en `front/src/pages/dashboard/client-detail-page.tsx`: el total, las sesiones con «Comprobante por revisar» y «Marcar como pagada», «Marcar todas como pagadas» con confirmación y «Recordar el pago por WhatsApp»
- [X] T009 [US2] `front/src/pages/dashboard/clients-page.tsx`, `front/src/features/clients/clients-table.tsx` y `client-cards.tsx`: el filtro «Con pagos pendientes» (también desde `location.state`), del que más debe al que menos, y «Por cobrar $X» en cada uno
- [X] T010 [US2] `front/src/features/dashboard/pending-payments-tile.tsx` (nueva) en `front/src/pages/dashboard/dashboard-page.tsx`: «Por cobrar», el total y los pacientes, con el enlace a la lista filtrada; no sale en 0, cargando ni con error

## Fase 4: Reportes (Historia 4, P3)

- [X] T011 [US4] `front/src/features/reports` (`report-stats.ts`, `top-clients-cards.tsx`, `report-print-document.tsx`) y `front/src/pages/dashboard/reports-page.tsx`: «Ingresos de citas atendidas» e «Ingresos» en lugar de «Cobrado», y «Por cobrar» (`pendingRevenue`) con su comparación, también al imprimir

## Fase 5: Cierre

- [X] T012 [P] `front/scripts/check-pending-payments.ts` y `check:pending-payments` en `front/package.json`: la regla, la suma de Reportes y el mensaje de WhatsApp
- [X] T013 Constitución 1.45.0 en los dos repos (principio III)
- [X] T014 Backend: `typecheck` y `npm test`. Front: build, lint y todas las `check:*`
- [X] T015 Recorrido en el navegador (Chromium 1440 en claro y WebKit 390 en oscuro), con capturas en `specs/046-por-cobrar/capturas/`
- [X] T016 Reporte final y subir a `dev`: «Pruebas» en verde en los dos repos

## Dependencias

- T001 va primero: todo usa la regla y los tipos.
- T002 a T004 antes que T005. T006 y T007 se pueden hacer a la vez, y antes que T008 a T010.
- T011 sólo necesita T001.
- T014 a T016, al final.
