---

description: "Tareas de «El cobro de las mensualidades por transferencia»"
---

# Tareas: El cobro de las mensualidades por transferencia

**Entrada**: `specs/029-cobro-mensualidades/`. El dueño del producto aprobó la spec («procede con los dos
planes») y el plan el 2026-10-20 («si procede», confirmando que pasada la gracia la pantalla con el valor
y las cuentas no se quita hasta subir el comprobante).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` =
`~/Documentos/Proyectos/Betas/agenda-beta`. Se implementa después de la spec 028, porque comparten
archivos.

## Fase 1: Base

- [x] T001 Constitución 1.25.0, igual en los dos repos: la excepción de la mensualidad del propietario y
  la línea del cobro por transferencia.
- [x] T002 `back/db/migrations/049_monthly_billing.sql`, según el plan (la migración ya está escrita; falta lo del seed y `TABLE_INFO`):
  - en `subscriptions`: `monthly_fee`, `billing_day` y `billing_start`;
  - `platform_settings.bank_accounts`, con su check;
  - las tablas `billing_charges` y `billing_receipts`, con RLS.

  Además, `TABLES` del seed y `TABLE_INFO` de `database-stats-service.ts`.
- [x] T003 Código compartido (`front/src`, luego `sync:shared`):
  - los tipos `BillingCharge`, `BillingStatus` y `AdminBillingCharge`;
  - la mensualidad en `AdminBusinessDetail`;
  - los esquemas de la mensualidad, el rechazo y las cuentas;
  - los tipos de email `billing_*`;
  - el tipo de aviso `billing_receipt` (campana y push);
  - las plantillas `billingReminder`, `billingPaid` y `billingRejected`.

## Fase 2: Historias 1 a 3, la API (P1)

- [x] T004 [US1] [US2] `back/src/services/billing-service.ts`: `ensureCharges` (día de pago, meses
  cortos, descuento de referidos sin reusar), los recordatorios, el estado del propietario (gracia y
  bloqueo), el comprobante (pedir y completar), y aprobar, rechazar, pagado sin comprobante, anular y el
  enlace del comprobante. Cada cambio va a la actividad (`platform.billing_*`, `businessId null`).
- [x] T005 [US1] [US3] Las rutas del propietario (`billing.manage`) y del super admin, con `no-store`.
  `getStats`, con `billing`. Las cuentas de la plataforma, fuera de la lectura pública.
- [x] T006 [US2] [US3] Los avisos: la campana y el push del super admin al llegar un comprobante, los
  emails y, en el cron, los cobros, los recordatorios, la purga a 12 meses, la cifra en el registro y el
  ntfy.

## Fase 3: Historias 1 a 3, la pantalla (P1)

- [x] T007 [US2] Front del propietario:
  - `billing-screen.tsx`: el valor, las cuentas con copiar, subir el comprobante, «Más tarde» sólo en la
    gracia, «Cerrar sesión» y el motivo si se rechazó;
  - en `DashboardShell`: sólo el propietario, nunca en modo soporte, y antes del cierre de mes;
  - `monthly-fee-card.tsx` en Configuración → Negocio.
- [x] T008 [US1] [US3] Front del super admin:
  - la mensualidad en la ficha del negocio;
  - `/admin/billing` («Cobros», en el menú), con filtros y acciones;
  - la tarjeta del Inicio;
  - las cuentas en `/admin/settings`;
  - el icono y el texto del aviso en la campana;
  - las etiquetas de los emails y de la actividad.

## Fase 4: Comprobación

- [x] T009 `back/tests/billing.test.ts` (nueva, según el plan) y las que cambian. `npm run typecheck` y
  la suite completa.
- [x] T010 `front/`: build, lint y `check:contrast`. El recorrido del plan: la gracia, el bloqueo, subir
  el comprobante, aprobar y rechazar, y quién no ve la pantalla. (Hechos build, lint y contraste; el
  recorrido en el navegador queda para el dueño del producto.)

## Fase 5: La beta

- [x] T011 `beta/`: la tarjeta de la mensualidad, la pantalla de pago y «Cobros» en su /admin, con datos
  de ejemplo. Antes, una copia de `src`. Después, `npm run build`.

## Fase 6: Cierre

- [x] T012 `reporte.md` y los commits en `dev` de cada repo.

## Fase 7: Ampliación, los precios automáticos (2026-10-20)

Según la sección «Ampliación» del plan. La beta no se toca en esta fase.

- [x] T013 `back/db/migrations/050_plan_prices.sql`: los cuatro precios en `platform_settings` (14,99,
  29,99, 3 y 8, con sus checks); `subscriptions.monthly_fee` pasa a ser el precio especial (null, sin
  default; los 0 a null, sin su día de pago); el check de la 049 pasa a «el día de pago y el primer cobro,
  los dos o ninguno». Probada también sobre una base con la 049 aplicada y mensualidades.
- [x] T014 Código compartido (`front/src`, luego `sync:shared`): `PlanPrices`, `planMonthlyPrice`,
  `effectiveMonthlyFee` y `describePlanPrice` en `plans.ts`; `customFee` en `businessBillingSchema`;
  `planPricesSchema`; `AdminBusinessBilling` con `planPrice`, `customFee` y `agendas`.
- [x] T015 `back/`: `ensureBillingSchedule` (el cron antes de los cobros, la lectura del propietario y la
  ficha, con su actividad como «Agenda360»); el monto del cobro con `effectiveMonthlyFee`; el precio
  especial en `setBusinessBilling`; `GET` y `PUT /admin/plan-prices`, con su actividad; al pasar de Free a
  un plan de pago, el día de pago vuelve a null (`applyPlanChange`). Constitución 1.26.0 en los dos repos.
- [x] T016 `front/`: la ficha («Mensualidad: $45,99 (Business con 5 agendas)», «Poner precio especial» y
  «Quitar», el día de pago y el primer cobro automáticos) y /admin → Planes («Precios de las
  mensualidades», con el ejemplo calculado).
- [x] T017 `back/tests/billing.test.ts` con lo del plan; `npm run typecheck` y la suite completa. En el
  front, build, lint y `check:contrast`, y el recorrido en Chromium a 1440 px y WebKit a 390 px, claro y
  oscuro.
