# Plan de implementación: Recordatorios del comprobante de pago

**Rama**: `dev` · **Fecha**: 2026-11-09, cambiado el 2026-11-10 · **Spec**: [spec.md](./spec.md)

> **Cambio del 2026-11-10:** el comprobante se pide sólo antes de la cita. Se quitan el modo «Después de la cita»
> y el modo de cada agenda (la columna, la ruta, el selector en «Tu agenda», Profesionales y el Perfil). La migración
> 055 aún no estaba aplicada en producción, así que se edita en vez de añadir otra.

## Diseño

1. **La migración `055_recordatorio_comprobante.sql`.** Todo apagado o vacío por defecto: ningún negocio cambia.
   - **`businesses.payment_reminders`** (boolean, `false`): el interruptor.
   - **`businesses.payment_reminder_days`:** los días, con `check` en tres valores:
     - `before_three` (por defecto): los 3 días anteriores a la cita;
     - `after_booking`: los 3 días siguientes a la reserva;
     - `before_and_morning`: los 2 días anteriores y la mañana del mismo día.
   - **`appointments.payment_reminders_sent`** (smallint, `0`, de 0 a 3) **y `payment_reminded_on`** (date): cuántos
     recordatorios salieron y el último día, para el tope y para no repetir un día.

2. **El interruptor del super admin** (`admin-service.ts` y `platform-routes.ts`, como las citas en pareja):
   - **La ruta:** `PUT /admin/businesses/:id/payment-reminders`, con `{ enabled, days }`.
   - **Los días** se pueden cambiar con el interruptor encendido.
   - **La actividad:** cada cambio queda en la del negocio y en la de la plataforma, con el antes y el después.
   - **`Business`** suma `paymentReminders: { enabled, days }`. El panel sólo lo lee y la página pública no lo
     muestra.

3. **El paso diario** (`src/jobs/scheduled-tasks.ts` → `queuePaymentReminders(now)`, en el cron de GitHub; la regla,
   en `payment-reminder-rules.ts`, y el envío, en `runPaymentReminderJob` de `notifications.ts`):
   - **Qué negocios:** los activos con el interruptor, de las 9:00 a las 21:00 de su zona.
   - **Qué citas:** las que tienen precio y una agenda con cuentas, y además:
     - estado «Pendiente» o «Confirmada», y que todavía no han empezado;
     - sin `receipt_at` ni `paid_at`;
     - con `payment_reminders_sent < 3` y `payment_reminded_on` distinto de hoy;
     - sólo las del paciente principal, con email;
     - hoy, dentro de los días elegidos. Nunca el mismo día de la reserva.
   - **Agrupado por paciente:**
     - un email al día con todas sus citas, con `dedupe_key` `payment-reminder:<paciente>:<día>`;
     - a cada cita incluida se le suma un recordatorio y se le anota el día, en la misma transacción.
   - **El email:** tipo `payment_reminder`, del nivel «paciente» del cupo (`email-limits.ts`).
     - **Sin copia al profesional:** queda fuera de los tipos que generan copia.
     - **Si no cabe en el cupo,** espera, como los demás.
   - **El tiempo:** `now` como parámetro, para que las pruebas avancen los días sin esperar.
   - **El registro del cron** sólo lleva la cifra: «recordatorios de pago: N».

4. **El email** (plantilla compartida en el front, `templates.ts`, y `sync:shared`):
   - **Asunto:** «Recordatorio: envía el comprobante de tu cita en {negocio}».
   - **Contenido:**
     - cada cita, con su fecha, hora, servicio, profesional y monto (si el precio se muestra);
     - las cuentas;
     - el botón «Enviar el comprobante».
   - **Una nota amable:** «Si ya lo enviaste por WhatsApp, puedes ignorar este mensaje».
   - **Sin la palabra «deuda»** ni nada que suene a cobro.

5. **El aviso al subir el comprobante:**
   - **El email (`notifyReceiptReceived`):** en un negocio activado, le llega siempre al profesional de la agenda,
     tenga o no activados los avisos de sus citas.
   - **La campana:** ya avisa a la agenda; sigue igual.
   - **El celular:** en un negocio activado, el rol Profesional con agenda recibe también el aviso «receipt» de sus
     citas.
     > **Ojo:** esto amplía la spec 017, según la cual el profesional sólo recibe el resumen de su agenda. Va a la
     > constitución.

6. **El front:**
   - **/admin, ficha del negocio:** la tarjeta «Pedir el comprobante de pago», con el interruptor y los días, con un
     ejemplo de fechas.
   - **La cita** (`appointment-payment.tsx`), sólo si todavía no ha empezado y está pendiente o confirmada:
     - la marca «Sin comprobante»;
     - el botón «Recordar el pago por WhatsApp», que abre `wa.me` con el mensaje y el enlace de pago.
   - **La agenda y el tablero:** la marca en cada cita y el filtro «Sin comprobante».
   - **Las citas que ya empezaron o están completadas** muestran el pago como siempre.
   - **La regla** de «sin comprobante» va en una función compartida (`lib/payment-reminders.ts`), para que la agenda,
     la cita y la beta digan lo mismo.

7. **La constitución 1.32.0,** igual en los dos repos:
   - en el principio III, la decisión nueva: sólo antes de la cita, con los días que elige el super admin;
   - la regla de la copia al profesional suma «salvo los recordatorios del comprobante de pago (spec 039)»;
   - lo del punto 5 sobre el celular del rol Profesional.

8. **La beta:**
   - el interruptor en su /admin, la marca «Sin comprobante» y el WhatsApp, con su repositorio de ejemplo;
   - ningún email;
   - antes, una copia de seguridad.

**Migración:** sí, la `055`. La aplica el dueño del producto con `npm run db:migrate` **antes** de publicar el
backend.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | El email va sólo al paciente, con sus propias citas. El registro del cron sólo lleva cifras. El WhatsApp lo abre el profesional desde su panel |
| III. Decisiones | Sí, con dos cambios | La excepción a la copia al profesional y el aviso del comprobante en el celular del rol Profesional. Son decisiones del 2026-11-09 y se actualiza la constitución |
| Auditoría | Sí | El interruptor y los días van a la actividad, con su prueba. Los recordatorios, al historial de emails |
| Costo de Vercel | Sí | Los envía el cron de GitHub. La API sólo guarda la configuración |
| VII. Diseño | Sí | La tarjeta en /admin y la marca con la gama de la marca y grises, a 390 px sin desbordes |

## Pruebas

- **`tests/payment-reminders.test.ts`:**
  - **El interruptor y los días:**
    - sólo el super admin los cambia: el propietario recibe 403 en la ruta de /admin;
    - quedan en la actividad.
  - **Las tres opciones de días,** avanzando `now` día a día:
    - salen en los días correctos;
    - uno por día;
    - nunca el día de la reserva ni desde que empieza la cita;
    - como mucho 3.
  - **Lo que no recibe recordatorio:** una cita completada, pasada o de hoy que ya empezó.
  - **Se detienen** al subir el comprobante, al marcar la cita como pagada, al cancelarla y con «No asistió».
  - **Un email por paciente y día** con varias citas; con una sesión en pareja, sólo el principal.
  - **Lo que no sale:**
    - ninguna copia al profesional;
    - nada para un paciente sin email, una cita gratis, una agenda sin cuentas o un negocio sin activar.
  - **Al subir el comprobante:**
    - el email llega al profesional, aunque tenga apagados los avisos de sus citas;
    - el aviso llega al celular del rol Profesional.
  - **El cupo:** el tipo `payment_reminder` es del nivel «paciente».
- **Backend:** `typecheck` y `npm test`.
- **Front y beta:** build, lint, `check:contrast` y `check:data-export`.
- **El recorrido,** en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro:
  - el super admin activa el negocio y elige los días;
  - la marca y el filtro «Sin comprobante» en una cita futura, y nada en una completada;
  - el WhatsApp con el enlace.
- **La prueba real:** con la base de prueba y la cuenta de Gmail, un recordatorio de verdad. Se comprueba que se lee
  bien en el celular y que el botón abre la página para subir el comprobante.

## Riesgos

- **El cupo de Gmail** lo comparten todos los negocios. El tope de 3 por cita y un email por paciente y día lo
  acotan. Lo que no cabe espera, y nunca quita sitio a los emails del equipo.
- **La hora:** el cron pasa cada 10 minutos. El primer paso después de las 9:00 de cada negocio envía los de ese
  día; si el cron se retrasa, salen más tarde, nunca dos veces.
- **Un recordatorio en cola por el cupo** puede salir después de que el paciente suba el comprobante. La nota del
  email cubre ese caso.
