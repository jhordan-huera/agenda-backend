# Plan de implementación: Recordatorios del comprobante de pago

**Rama**: `dev` · **Fecha**: 2026-11-09 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La migración `055_recordatorio_comprobante.sql`.** Todo apagado o vacío por defecto: ningún negocio cambia.
   - **`businesses.payment_reminders`** (boolean, `false`): el interruptor.
   - **`businesses.payment_reminder_days`:** los días del modo «Antes», con `check` en tres valores:
     - `before_three` (por defecto): los 3 días anteriores;
     - `after_booking`: los 3 días siguientes a la reserva;
     - `before_and_morning`: los 2 días anteriores y la mañana del mismo día.
   - **`professionals.payment_reminder_mode`:** `before` o `after`, con `check`. Por defecto `before`.
   - **`appointments.payment_reminders_sent`** (smallint, `0`, de 0 a 3) **y `payment_reminded_on`** (date): cuántos
     recordatorios salieron y el último día, para el tope y para no repetir un día.

2. **El interruptor del super admin** (`admin-service.ts` y `platform-routes.ts`, como las citas en pareja):
   - **La ruta:** `PUT /admin/businesses/:id/payment-reminders`, con `{ enabled, defaultMode, days }`.
   - **Al activarlo:** todas las agendas del negocio toman el modo por defecto.
   - **Los días** se pueden cambiar con el interruptor encendido.
   - **La actividad:** cada cambio queda en la del negocio y en la de la plataforma, con el antes y el después.
   - **`Business`** suma `paymentReminders: { enabled, days }`. El panel sólo lo lee.

3. **El modo de cada agenda** (`professional-service.ts` y `business-routes.ts`, como el calendario de la spec 027):
   - **La ruta:** `PATCH /businesses/:id/professionals/:pid/payment-reminder-mode`, con `{ mode }`.
   - **Quién puede:** el profesional, en su agenda; quien gestiona los profesionales, en cualquiera; recepción, no.
   - **Con el negocio sin activar,** la ruta responde 409.
   - **La actividad:** «Cambió los recordatorios del comprobante de la agenda de X: antes → después».
   - **`Professional`** suma `paymentReminderMode`.

4. **El paso diario** (`src/jobs/scheduled-tasks.ts` → `queuePaymentReminders(now)`, en el cron de GitHub):
   - **Qué negocios:** los activos con el interruptor, a partir de las 9:00 de su zona.
   - **Qué citas:** las que tienen precio y una agenda con cuentas, y además:
     - sin `receipt_at` ni `paid_at`;
     - con `payment_reminders_sent < 3`;
     - con `payment_reminded_on` distinto de hoy;
     - sólo las del paciente principal, con email.
   - **Por modo:**
     - **`before`:** estado «Pendiente» o «Confirmada», y hoy dentro de los días elegidos. Nunca el mismo día de la
       reserva ni después del inicio de la cita.
     - **`after`:** «Completada», o «Confirmada» sin cerrar, con la fecha ya pasada.
   - **Agrupado por paciente:**
     - un email al día con todas sus citas, con `dedupe_key` `payment-reminder:<paciente>:<día>`;
     - a cada cita se le suma un recordatorio y se le anota el día, en la misma transacción.
   - **El email:** tipo `payment_reminder`, del nivel «paciente» del cupo (`email-limits.ts`).
     - **Sin copia al profesional:** queda fuera de los tipos que generan copia.
     - **Si no cabe en el cupo,** espera, como los demás.
   - **El tiempo:** `now` como parámetro, para que las pruebas avancen los días sin esperar.
   - **El registro del cron** sólo lleva la cifra: «recordatorios de pago: N».

5. **El email** (plantilla compartida en el front, `templates.ts`, y `sync:shared`):
   - **Asunto:** «Recordatorio: envía el comprobante de tu cita en {negocio}».
   - **Contenido:**
     - cada cita, con su fecha, hora, servicio, profesional y monto (si el precio se muestra);
     - las cuentas;
     - el botón «Enviar el comprobante».
   - **Una nota amable:** «Si ya lo enviaste por WhatsApp, puedes ignorar este mensaje».
   - **Sin la palabra «deuda»** ni nada que suene a cobro.

6. **El aviso al subir el comprobante:**
   - **El email (`notifyReceiptReceived`):** en un negocio activado, le llega siempre al profesional de la agenda,
     tenga o no activados los avisos de sus citas.
   - **La campana:** ya avisa a la agenda; sigue igual.
   - **El celular:** en un negocio activado, el rol Profesional con agenda recibe también el aviso «receipt» de sus
     citas.
     > **Ojo:** esto amplía la spec 017, según la cual el profesional sólo recibe el resumen de su agenda. Va a la
     > constitución.

7. **El front:**
   - **/admin, ficha del negocio:** la tarjeta «Pedir el comprobante de pago», con:
     - el interruptor;
     - el modo por defecto;
     - los días del modo «Antes», con un ejemplo de fechas.
   - **El modo de la agenda,** junto a «Tus citas en tu calendario» y sólo si el negocio está activado:
     - en «Tu agenda» (plan Pro);
     - en Profesionales (plan Business);
     - en el Perfil del rol Profesional.
   - **La cita** (`appointment-payment.tsx`):
     - la marca «Sin comprobante»;
     - el botón «Recordar el pago por WhatsApp», que abre `wa.me` con el mensaje y el enlace de pago.
   - **La agenda y el tablero:** la marca en cada cita y el filtro «Sin comprobante».
   - **La regla** de «sin comprobante» va en una función compartida, para que la agenda, la cita y la beta digan
     lo mismo.

8. **La constitución 1.32.0,** igual en los dos repos:
   - en el principio III, la decisión nueva;
   - la regla de la copia al profesional suma «salvo los recordatorios del comprobante de pago (spec 039)»;
   - lo del punto 6 sobre el celular del rol Profesional.

9. **La beta:**
   - el interruptor en su /admin, el modo, la marca «Sin comprobante» y el WhatsApp, con su repositorio de ejemplo;
   - ningún email;
   - antes, una copia de seguridad.

**Migración:** sí, la `055`. La aplica el dueño del producto con `npm run db:migrate` **antes** de publicar el
backend.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | El email va sólo al paciente, con sus propias citas. El registro del cron sólo lleva cifras. El WhatsApp lo abre el profesional desde su panel |
| III. Decisiones | Sí, con dos cambios | La excepción a la copia al profesional y el aviso del comprobante en el celular del rol Profesional. Son decisiones del 2026-11-09 y se actualiza la constitución |
| Auditoría | Sí | El interruptor, los días y el modo van a la actividad, con su prueba. Los recordatorios, al historial de emails |
| Costo de Vercel | Sí | Los envía el cron de GitHub. La API sólo guarda la configuración |
| VII. Diseño | Sí | La tarjeta en /admin, el selector del modo y la marca con la gama de la marca y grises, a 390 px sin desbordes |

## Pruebas

- **`tests/payment-reminders.test.ts`** (nueva):
  - **El interruptor:**
    - sólo el super admin lo cambia: el propietario y el modo soporte reciben 403;
    - al activarlo, las agendas toman el modo por defecto;
    - queda en la actividad.
  - **El modo:**
    - el profesional cambia la suya y no la de otro;
    - recepción, 403;
    - con el negocio sin activar, 409;
    - queda en la actividad.
  - **Modo «Antes»,** con cada una de las tres opciones de días y avanzando `now` día a día:
    - salen en los días correctos;
    - uno por día;
    - nunca el día de la reserva ni después de empezar la cita;
    - como mucho 3.
  - **Modo «Después»:**
    - la «Completada» y la «Confirmada» sin cerrar, sí;
    - la «Por confirmar», no;
    - desde el día siguiente a la cita.
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
  - el profesional cambia el modo;
  - la marca y el filtro «Sin comprobante»;
  - el WhatsApp con el enlace.
- **La prueba real:** con la base de prueba y la cuenta de Gmail, como `dev:local`, un recordatorio al buzón de
  pruebas. Se comprueba que se lee bien en el celular y que el botón abre la página para subir el comprobante.

## Riesgos

- **El cupo de Gmail** lo comparten todos los negocios. El tope de 3 por cita y un email por paciente y día lo
  acotan. Lo que no cabe espera, y nunca quita sitio a los emails del equipo.
- **La hora:** el cron pasa cada 10 minutos. El primer paso después de las 9:00 de cada negocio envía los de ese
  día; si el cron se retrasa, salen más tarde, nunca dos veces.
