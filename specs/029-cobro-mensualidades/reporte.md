# Reporte final: El cobro de las mensualidades por transferencia

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-20

**Repos**: los dos y la beta (con datos de ejemplo) · **Migración**: Sí: `049_monthly_billing.sql`

## Resumen

**El super admin:**
- pone en /admin la **mensualidad** de cada negocio, con su día de pago y su primer cobro;
- pone sus **cuentas para recibir las transferencias** en la configuración de /admin. Nunca salen en la
  información pública de la web.

**El cobro de cada mes:**
- se crea solo en el día de pago, con el **descuento de referidos ya restado**;
- tres días antes, al propietario le llega un recordatorio por email.

**La pantalla de pago del propietario** sale al entrar al panel, el día de pago, con el valor, las
cuentas (para copiarlas) y «Subir comprobante»:
- durante **5 días de gracia** tiene «Más tarde»;
- **pasados los 5 días, no se cierra** hasta subir el comprobante. Su equipo y su página de reservas
  siguen funcionando;
- al subirlo, el cobro pasa a **«En revisión»**, el propietario usa el sistema con normalidad, y al
  super admin le llega un aviso en la campana, por push y por ntfy.

**En /admin → Cobros** el super admin filtra por estado y, en cada cobro:
- ve el comprobante;
- lo marca **«Pagado»**, lo **rechaza con un motivo** (el propietario lo ve al entrar y le llega por
  email), lo marca **pagado sin comprobante** o lo **anula**.

El Inicio de /admin muestra cuántos hay por revisar y cuántos atrasados. El propietario ve su mensualidad
y su historial en Configuración → Negocio.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La mensualidad y el día de pago | Cumple | `billing`: sólo el super admin, a la actividad. Con 0, en el plan gratis, suspendido o sin propietario, no hay cobros |
| RF-002 – El cobro de cada mes | Cumple | `billing`: el día de pago, una sola vez; el 31 cae el 30 en noviembre; con recomendaciones, el descuento sin reusarlo |
| RF-003 – La pantalla, la gracia y el bloqueo | Cumple | `billing` (los días de gracia y `blocked`). Recorrido: con «Más tarde» el día de pago; sin él pasados 5 días, también al ir a otra página; la recepción y el modo soporte no la ven |
| RF-004 – El comprobante, «En revisión» | Cumple | Recorrido: subir un PDF lo deja «En revisión» y se entra al panel |
| RF-005 – Revisar, aprobar y rechazar | Cumple | Recorrido: rechazar con motivo (el propietario lo ve al volver), subir otra vez y «Pagado» en dos toques. `billing`: pagado sin comprobante y anular, cada uno con su email |
| RF-006 – Los avisos | Cumple | `billing`, `cron` y `panel-notices`: el recordatorio tres días antes y una vez; la campana, el push y ntfy al llegar un comprobante. Recorrido: el Inicio de /admin avisa |
| RF-007 – El propietario ve sólo lo suyo | Cumple | `billing`: el administrador, la recepción y el profesional reciben 403; `/public/platform-settings` no trae las cuentas |
| RF-008 – Actividad y privacidad | Cumple | `billing`: cada cambio a la actividad; los comprobantes privados y borrados a los 12 meses |
| CE-001 a CE-004 | Cumple | Recorrido: 18 ✓ en cada una de las cuatro combinaciones (Chromium a 1440 px y WebKit a 390 px, claro y oscuro) |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test` con 67 de 67 suites.
  `billing` tiene 158 ✓.
- **Front:** build, lint y `check:contrast` sin errores.

## Cambios respecto al plan

- **Migración 049:**
  - con `void_reason` (el motivo de anular) y `paid_note` (la nota del pagado sin comprobante),
    aparte del motivo del rechazo;
  - un check que obliga al día de pago y al primer cobro cuando hay mensualidad;
  - la campana con el tipo `billing_receipt`.
- **Un cuarto email, `billing_voided`,** para avisar también al anular.
- **El cobro sólo se crea dentro de su gracia.** Si el negocio estaba suspendido o sin propietario en
  su día de pago, ese mes no se cobra después.
- **Si el descuento de referidos cubre toda la mensualidad,** el cobro nace pagado.
- **Las recomendaciones de un cobro abierto** no se pueden marcar a mano. Sin mensualidad se siguen
  marcando a mano, y la constitución lo dice.
- **El modo soporte** ve la mensualidad y el comprobante, pero no lo sube: lo marcas pagado desde
  Cobros.
- **La subida del propietario** aparece en la pestaña «Super admin» de la actividad de /admin.
- **El recorrido** encontró el límite de inicios de sesión de la API (muchos seguidos desde la misma
  máquina), que funciona como debe.

## Pendientes y riesgos

- **Si el cron se detiene más de 5 días y el propietario no entra,** ese mes no se crea.
- **La factura del SRI y el cobro con tarjeta** quedan fuera, como decidió el dueño del producto.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 405e075 | Spec 029: el cobro de las mensualidades por transferencia (spec, plan, tareas, constitución 1.24.0 y 1.25.0, migración 049, backend y pruebas) |
| agenda-front | ce52ba5 | Spec 029: la pantalla de pago del propietario, su mensualidad, y Cobros y las cuentas en /admin (y constitución 1.24.0 y 1.25.0) |

## Cómo publicarlo

1. **La migración 049, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.** Van junto con la spec 028.
3. **Después, en /admin:**
   - en **Configuración**, tus cuentas para recibir las mensualidades;
   - en la ficha de cada negocio que paga, su **mensualidad**, el día de pago y el primer cobro;
   - el día de pago de cada uno, revisa **Cobros**.

## Texto para el PR

Spec 029: el cobro de las mensualidades por transferencia.
- **La mensualidad:** el super admin pone la de cada negocio, con su día de pago, y sus cuentas.
- **La pantalla de pago:** el día de pago, el propietario ve el valor y las cuentas al entrar, y sube
  el comprobante («En revisión»). Tiene 5 días de gracia y después la pantalla no se cierra. Su equipo
  y su página de reservas siguen funcionando.
- **Cobros en /admin:** aprobar, rechazar con motivo, pagado sin comprobante y anular, con sus emails
  y avisos.
- **Los referidos** se descuentan solos.
- **Constitución 1.25.0.**

**Migración:** `049_monthly_billing.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/029-cobro-mensualidades/reporte.md
