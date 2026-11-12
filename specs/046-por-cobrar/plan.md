# Plan de implementación: Lo que debe cada paciente

**Rama**: `dev` · **Fecha**: 2026-11-12 · **Spec**: [spec.md](./spec.md)

**Sin migración.** Lo que debe cada paciente se calcula con las citas que ya existen (estado, precio, `paid_at`, fecha
y paciente principal). El backend suma dos rutas y dos cifras al resumen por paciente; el front, la tarjeta de la
ficha, el filtro de la lista, la tarjeta de Inicio, el WhatsApp y los nombres de Reportes.

## Diseño

1. **La regla, en el código compartido** (se edita en el front y se copia con `npm run sync:shared`):
   - `PENDING_PAYMENTS_SINCE` en `front/src/lib/constants/business.ts`: la fecha desde la que cuentan las sesiones
     (respuesta 1). Se fija **el día en que se fusiona el PR a `main`**; si cambia, se ajusta en el último commit
     antes del PR.
   - `isPendingPayment(appointment)` en `front/src/lib/pending-payments.ts` (nuevo): Completada, precio mayor que 0,
     sin `paidAt` y con fecha desde `PENDING_PAYMENTS_SINCE`. La usan la ficha y Reportes. La API usa la misma
     condición en SQL, con la constante como parámetro.
   - El tipo `ClientActivity` suma `pendingAmount` y `pendingCount`. Hay un tipo nuevo, `PendingPaymentsSummary`
     (`{ amount, clients, sessions }`).

2. **La API** (`back/src/services/…`, `back/src/routes/business-routes.ts`):
   - **El resumen por paciente** (`businessDataService.activity`, `GET /:businessId/clients/activity`): suma
     `pendingAmount` y `pendingCount`, sólo para el paciente principal (`a.main`), como hoy `totalSpent`. Es un
     `filter` más en la misma consulta agrupada. El rol Profesional ya está limitado a su agenda con `agendaScope`.
   - **El total de Inicio** (`GET /:businessId/pending-payments/summary`, nuevo, en `paymentService`): una sola
     consulta agrupada que devuelve el total, cuántos pacientes y cuántas sesiones. Mismo `authorize` y
     `agendaScope` que el resumen por paciente (respuesta 2). Leer no va a la actividad.
   - **Marcar varias como pagadas** (`POST /:businessId/clients/:clientId/pending-payments/pay`, nuevo,
     `paymentService.payPending`):
     - recibe `{ appointmentIds }`, de 1 a 100 ids: las sesiones que el usuario vio y confirmó. Así no se marca una
       que apareció mientras tanto;
     - en una transacción, con `appointments.manage` y el bloqueo de siempre (`authorize(…, { lock: true })`);
     - sólo marca las que son de ese paciente como principal, están Completadas, sin pagar y dentro de su agenda
       (`agendaScope`). Las que ya estaban pagadas se saltan sin error;
     - una entrada en la actividad por cita, `appointment.paid`, con el mismo resumen que `setPaid` (RF-003);
     - devuelve cuántas marcó.

3. **La ficha del paciente** (`front/src/pages/dashboard/client-detail-page.tsx`):
   - **La tarjeta «Por cobrar»** (`front/src/features/payments/pending-payments-card.tsx`, nueva), arriba de la
     columna principal, sólo si debe algo. Usa las citas del paciente que la ficha ya carga, con `isPendingPayment` y
     el paciente como principal.
   - **Arriba:** el total grande y «3 sesiones».
   - **Cada sesión:** la fecha, el servicio, el profesional (con varias agendas) y el precio, de la más antigua a la
     más reciente. Si tiene comprobante, la marca «Comprobante por revisar». Tocar la fila abre la cita (ahí está el
     comprobante); el botón «Marcar como pagada» usa la ruta de siempre.
   - **Abajo:**
     - «Marcar todas como pagadas» abre la confirmación: «¿Marcar 3 sesiones como pagadas? Total: $75»;
     - «Recordar el pago por WhatsApp», si el paciente tiene teléfono.

4. **La lista de pacientes** (`clients-page.tsx`, `clients-table.tsx`, `client-cards.tsx`):
   - **El filtro «Con pagos pendientes»** (`pending`): ordena del que más debe al que menos.
   - **El monto «Por cobrar $75»** en la fila o la tarjeta de quien debe. Sale de `pendingAmount`, del resumen que
     la lista ya pide.
   - **El filtro inicial** se puede pedir con `location.state` (`{ filter: "pending" }`), como ya se hace con
     «Por completar».

5. **Inicio** (`dashboard-page.tsx`): la tarjeta **«Por cobrar»** (`front/src/features/dashboard/pending-payments-tile.tsx`,
   nueva), en la columna derecha, debajo de las reservas por confirmar:
   - el total y «de 4 pacientes»;
   - es un enlace a la lista con el filtro;
   - no sale si el total es 0, mientras carga ni si falla. El resto de Inicio no cambia.

   Usa `usePendingPaymentsSummary()`, con un minuto de caché.

6. **El WhatsApp** (`buildPendingPaymentsMessage` en `front/src/lib/whatsapp.ts`):
   - el mensaje, amable, como el de la spec 039: «Hola Ana, te escribimos de [negocio] para recordarte el pago de tus
     sesiones:», la lista (día y servicio) y «Total: $75»;
   - si las agendas de esas sesiones tienen cuentas, las cuentas sin repetir (`describeBankAccounts`);
   - cierra con «Si ya lo pagaste, no te preocupes. ¡Gracias!»;
   - nunca «deuda» ni «debes».

7. **Reportes** (respuesta 3, `front/src/features/reports` y `front/src/pages/dashboard/reports-page.tsx`):
   - **Los nombres:**
     - «Cobrado en citas completadas» pasa a «Ingresos de citas atendidas»;
     - «Cobrado», en la tabla por profesional y en la de pacientes, pasa a «Ingresos»;
     - la descripción de «Los que más vienen» dice «los ingresos de las atendidas».
   - **«Por cobrar»:** `summarize` suma `pendingRevenue` (las citas del periodo con `isPendingPayment`), que sale al
     lado de los ingresos, con su comparación.
   - **La versión para imprimir** (`report-print-document.tsx`) usa los mismos nombres y suma la fila «Por cobrar».
   - **Se deja igual:** «Cobrado» de la analítica de /admin, que sí cuenta sólo lo pagado, y el informe mensual por
     email.

8. **Los datos del front:**
   - `pendingPaymentsSummary` y `payPending` en `repository.ts` y `api-repository.ts`;
   - `usePendingPaymentsSummary` y `usePayPendingPayments` en `use-appointments.ts`;
   - al marcar una o todas como pagadas, se recargan las citas, el resumen por paciente y el total de Inicio.

9. **La constitución, 1.45.0, en los dos repos** (principio III): qué es «por cobrar» y desde cuándo cuenta; quién
   lo ve; que no se envía nada solo (sólo el WhatsApp a mano), y los nombres de Reportes.

**No se hace:**
- pagos parciales ni saldos a favor;
- emails o avisos automáticos de cobro;
- cambios en la exportación de datos (no hay datos nuevos);
- la beta.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | No hay datos nuevos. El WhatsApp lo abre el profesional desde su panel y nada sale en registros ni avisos |
| III. Cita Completada fija salvo el pago | Sí | Sólo se cambia `paid_at`, igual que «Marcar como pagada» |
| III. Todo lo que cambia datos va a la actividad | Sí | Una entrada `appointment.paid` por cita, también al marcar todas. Leer, no |
| III. Permisos | Sí | Marcar exige `appointments.manage`. El rol Profesional sólo ve y marca lo de su agenda (`agendaScope`) |
| V. Código compartido | Sí | La constante, la regla y los tipos se editan en el front y se copian con `sync:shared` |
| VI. Costo de Vercel | Sí | Dos `filter` más en una consulta que ya existe y una consulta agrupada al abrir Inicio, con un minuto de caché |
| VII. Diseño | Sí | Las tarjetas y las marcas de siempre, la gama de la marca, contraste AA y 390 px sin desbordes |

## Pruebas

- **`tests/pending-payments.test.ts`** (nueva, la suite 74), con un negocio de prueba y citas puestas con fechas
  fijas respecto de `PENDING_PAYMENTS_SINCE`, para no depender del día:
  - **Qué cuenta:** una Completada sin pagar, sí. No cuentan una pagada, una gratis, una cancelada, una «No asistió»,
    una Confirmada futura, una pagada por adelantado y atendida, ni una anterior a la fecha de inicio.
  - **Cita en pareja:** cuenta sólo para el principal.
  - **El resumen por paciente** y **el total de Inicio** dan las mismas cifras.
  - **Marcar todas:** se pagan sólo las pedidas que siguen sin pagar, una entrada en la actividad por cita, y el
    total queda en 0.
  - **Rechazos:** una cita de otro paciente o de otra agenda no se marca. Sin `appointments.manage`, 403.
  - **El rol Profesional:** ve y marca sólo lo de su agenda.
- **Backend:** `typecheck` y `npm test`.
- **Front:**
  - build y lint;
  - todas las `check:*`, más la nueva `check:pending-payments` (`front/scripts/check-pending-payments.ts`). Revisa
    la regla, la suma de Reportes y que el mensaje de WhatsApp no diga «deuda» y no repita cuentas.
- **Recorrido en el navegador,** con la base de prueba y capturas para el reporte:
  - en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro;
  - la tarjeta de la ficha: marcar una y marcar todas;
  - el filtro de la lista y la tarjeta de Inicio;
  - el WhatsApp con las sesiones y el total;
  - Reportes y su versión para imprimir;
  - sin desbordes ni errores en la consola.

## Riesgos

- **La fecha de inicio va en el código.** Si el PR a `main` se fusiona otro día, se ajusta antes de publicar. Una
  fecha adelantada sólo deja fuera sesiones de ese tramo; una atrasada mete sesiones viejas que quizá ya se cobraron.
- **Los negocios que nunca marcan los pagos** verán crecer «Por cobrar» desde la publicación. Es lo esperado:
  «Marcar todas como pagadas» lo limpia por paciente.
- **El cambio de nombres en Reportes** puede sorprender a quien ya lo conocía. Se aprobó en la respuesta 3.
