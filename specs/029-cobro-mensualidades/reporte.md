# Reporte final: El cobro de las mensualidades por transferencia

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-21, PR backend #53 y front #39) · **Fecha**: 2026-10-21

**Repos**: los dos y la beta (con datos de ejemplo) · **Migraciones**: Sí: `049_monthly_billing.sql` (ya
aplicada en producción) y `050_plan_prices.sql`

## Resumen

**Los precios, automáticos:**
- se guardan en **/admin → Planes:** Pro **$14,99**, y Business **$29,99 con 3 agendas** y **$8 por cada
  agenda más**;
- la mensualidad de cada negocio sale sola de su plan y sus «agendas contratadas», salvo un **precio
  especial** que se pone en su ficha (0 = cortesía);
- **el día de pago** es el día en que empezó su plan, y **el primer cobro**, un mes después. Los negocios
  que ya existen toman los suyos solos: su próximo día de pago, con el aviso antes;
- **los referidos** restan $1,50 por cada recomendación ganada, una sola vez, en el siguiente cobro.

**El cobro de cada mes:**
- se crea solo en su día de pago;
- tres días antes, al propietario le llega el email de aviso.

**La pantalla de pago del propietario** sale **desde el día de pago, y es obligatoria**:
- muestra el valor, tus cuentas para transferir (con copiar) y «Subir comprobante»;
- no se cierra hasta subirlo: no hay «Más tarde», sólo «Cerrar sesión». Su equipo y su página de
  reservas siguen funcionando;
- al subirlo, el cobro queda **«En revisión»** y entra al panel. Al super admin le llega el aviso en la
  campana, por push y por ntfy.

**En /admin → Cobros,** el super admin:
- filtra por «En revisión», «Por pagar» (menos de 5 días), «Atrasados» (5 o más), «Pagados», «Rechazados»
  y «Anulados»;
- abre el comprobante;
- lo marca **«Pagado»**, lo **rechaza con un motivo** (la pantalla vuelve con el motivo y le llega por
  email), lo marca **pagado sin comprobante** o lo **anula**.

El Inicio de /admin cuenta los que hay por revisar y los atrasados. El propietario ve su mensualidad y
su historial en Configuración → Negocio, nunca los precios de los planes.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La mensualidad y el día de pago | Cumple | `billing`: sólo el super admin, a la actividad. En Free, sin propietario o suspendido, no hay cobros |
| RF-002 – El cobro de cada mes | Cumple | `billing`: el día de pago, una vez; el 31 cae el 30 en noviembre; con recomendaciones, el descuento sin reusarlo |
| RF-003 – La pantalla obligatoria | Cumple | `billing`: `blocked` desde el día de pago, también rechazado. Recorrido: sin «Más tarde», no se quita al ir a otra página; la recepción y el modo soporte no la ven |
| RF-004 – El comprobante, «En revisión» | Cumple | Recorrido: subir un PDF lo deja «En revisión» y se entra al panel |
| RF-005 – Revisar, aprobar y rechazar | Cumple | Recorrido: rechazar con motivo (el propietario lo ve), subir otra vez y «Pagado» en dos toques. `billing`: pagado sin comprobante y anular, con sus emails |
| RF-006 – Los avisos | Cumple | `billing`, `cron` y `panel-notices`: el recordatorio una vez; la campana, el push y ntfy; el Inicio de /admin |
| RF-007 – El propietario ve sólo lo suyo | Cumple | `billing`: 403 para los demás roles; `/public/platform-settings` no trae ni las cuentas ni los precios |
| RF-008 – Actividad y privacidad | Cumple | `billing`: cada cambio a la actividad, también el día de pago automático (autor «Agenda360»). Los comprobantes son privados y se borran a los 12 meses |
| RF-009 – Los precios de los planes | Cumple | `billing`: sólo el super admin los cambia (a la actividad) y valen desde el siguiente cobro. Recorrido: /admin → Planes con su ejemplo |
| RF-010 – La mensualidad automática | Cumple | `billing`: Pro $14,99; Business con 3, 4 y 5 agendas: $29,99, $37,99 y $45,99; sin tope, las activas; precio especial y quitarlo; el día de pago desde `plan_since`, también al volver de Free |
| CE-001 a CE-004 | Cumple | Recorridos en Chromium a 1440 px y WebKit a 390 px, claro y oscuro: la pantalla, Cobros, la ficha y Planes |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test` con 67 de 67 suites
  (3.130 ✓). `billing` tiene 228 ✓.
- **La migración 050** se probó sobre una base con la 049 aplicada y mensualidades cargadas:
  - los 0 pasan a null y el 9,99 queda como precio especial;
  - los cobros no cambian;
  - el cron pone los días de pago automáticos una sola vez.
- **Front:** build, lint y `check:contrast` sin errores.
- **Beta:** build y lint sin errores, y un recorrido de la pantalla y de Cobros.

## Cambios respecto al plan

- **Sin «Más tarde» ni días de gracia** (decisión del dueño del producto, 2026-10-20). La pantalla es
  obligatoria desde el día de pago. Los 5 días quedan para «Atrasados» en /admin y para la ventana en que
  se crea el cobro.
- **Los precios automáticos** (ampliación del 2026-10-20): la migración 050, /admin → Planes, el precio
  especial y el día de pago automático. Constitución 1.26.0.
- **El primer cobro automático cae como pronto a 3 días de hoy,** para que el email de aviso llegue
  siempre antes. A un negocio nuevo no le cambia nada, porque su primer cobro es al mes.
- **En la migración 049:** `void_reason` y `paid_note` aparte del motivo del rechazo, y la campana con el
  tipo `billing_receipt`.
- **Un cuarto email, `billing_voided`,** para avisar también al anular.
- **Si el descuento de referidos cubre toda la mensualidad,** el cobro nace pagado.
- **El modo soporte** ve la mensualidad pero no sube el comprobante: se marca pagado desde Cobros.
- **Si un negocio estaba suspendido o sin propietario en su día de pago,** ese mes no se cobra después.

## Pendientes y riesgos

- **Si el cron se detiene más de 5 días y el propietario no entra,** ese mes no se crea.
- **La factura del SRI y el cobro con tarjeta** quedan fuera, como decidió el dueño del producto.
- **Una mensualidad mayor que 0 puesta a mano antes de la 050** queda como precio especial. Para que
  pase al precio del plan, usar «Quitar» en su ficha.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 405e075 | Spec 029: el cobro de las mensualidades por transferencia (…, migración 049, backend y pruebas) |
| agenda-backend | 6ec725b | Spec 029: la mensualidad toma sola el día de pago y el primer cobro del día en que empezó el plan |
| agenda-backend | 9a0478c | Spec 029: sin «Más tarde» ni días de gracia: desde el día de pago la pantalla es obligatoria |
| agenda-backend | 74f40cf | Spec 029: los precios automáticos (…), migración 050 y constitución 1.26.0 |
| agenda-front | ce52ba5 | Spec 029: la pantalla de pago del propietario, su mensualidad, y Cobros y las cuentas en /admin |
| agenda-front | bd7782a | Spec 029: en la ficha, el día de pago y el primer cobro salen solos del día en que empezó el plan |
| agenda-front | c15766a | Spec 029: la pantalla de pago es obligatoria desde el día de pago, sin «Más tarde» |
| agenda-front | 24c7f37 | Spec 029: los precios en /admin → Planes y la mensualidad automática en la ficha, con precio especial |

## Cómo publicarlo

1. **La migración 050, como paso aparte,** antes del PR del backend. La 049 ya está aplicada:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend (#53) y después el del front (#39).** Llevan también la spec 028.
3. **Después, en /admin:**
   - en **Configuración**, tus cuentas para recibir las mensualidades;
   - en **Planes**, revisar los precios;
   - en la ficha de cada negocio que acordó otro precio, su **precio especial**, antes de su día de pago.

     Los demás toman solos el de su plan y su día de pago. Su primer cobro es el próximo, con el aviso
     tres días antes.

## Texto para el PR

Spec 029: el cobro de las mensualidades por transferencia, con precios automáticos.
- **Los precios:** Pro $14,99, y Business $29,99 con 3 agendas y $8 por cada una más, editables en /admin
  → Planes. Cada negocio paga el de su plan, salvo un precio especial, con el día de pago desde que
  empezó su plan. Los referidos restan $1,50.
- **La pantalla de pago:** obligatoria desde el día de pago, con el comprobante «En revisión». Su equipo
  y su página de reservas siguen funcionando.
- **Cobros en /admin:** aprobar, rechazar con motivo, pagado sin comprobante y anular, con emails,
  campana, push y ntfy.
- **Constitución 1.26.0.**

**Migraciones:** `049_monthly_billing.sql` (ya aplicada) y `050_plan_prices.sql`, aplicada antes del
backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/029-cobro-mensualidades/reporte.md
