# Etapa 5 — Vista general (EGM)

Revisión del Elephant-Goldfish Model sobre [spec.md](../spec.md), archivo completo, con la guía `zoom-out-standard`.
Dos revisores nuevos, sin la conversación: el arquitecto escéptico (`egm-zoom-out`) y el catalizador (`egm-inventive-catalyst`).
Lectura de base: plan.md, la constitución, `src/services/control-reminders.ts` y la migración 058. Fecha: 2026-11-16.

Ninguno encontró un bloqueante.

## Arquitecto escéptico (`egm-zoom-out`): 2 Major, 7 Nit

Lo que está bien: el control se calcula y no se guarda, y se reutiliza lo de la encuesta y la lista de espera (el token y su página de confirmación, el cron, el nivel «paciente» del cupo de Gmail y la hoja de la Agenda).

1. **Major — «Vencidos» sin límite y del más antiguo al más reciente** (Historia 1.2, RF-003).
   - Un vencido sólo sale si reserva, si lo desactivan o si alguien pulsa «Quitar». Cada «Quitar» deja una entrada en la actividad.
   - Al poner «Volver en» a un servicio con historial, todo ese historial entra de golpe en la lista y en la cifra del botón. RF-009 resuelve ese mismo problema sólo para el email.
   - El orden contradice «Pacientes que no volvieron», que pone primero a los más fáciles de recuperar.
   - En el código, `findControls` sólo tiene tope hacia adelante; la hoja no pagina, y la Agenda descarga la lista completa para mostrar la cifra.
   - Propone acotar «Vencidos» y ordenarlos del más reciente al más antiguo.
2. **Major — «Sólo en dev» no aísla la función** (Estado, Supuestos, RF-013).
   - Cualquier PR de `dev` a `main` se la lleva.
   - `serviceColumns()` ya lee `return_after_days`: sin la migración 058, en producción fallaría toda lectura de servicios.
   - La spec debería decir: (a) se publica apagada con la próxima publicación, aplicando antes la 058, o (b) se saca de `dev`.
3. **Nit** — «La cita Atendida no se corrige (spec 020)» es falso: el propietario la corrige y el control se recalcula.
4. **Nit** — El código agrupa en un email todos los controles pendientes del paciente en esa pasada, no sólo «los del mismo día». La constitución coincide con el código.
5. **Nit** — La exclusión de quien tiene una cita por delante también se aplica en la ficha. Así, Recepción no ve el próximo control justo cuando podría sumarlo a esa visita.
6. **Nit** — Hay incoherencias en «desde cuándo» se escribe:
   - La Decisión 3 sólo habla de «al encenderlo»; RF-009 añade la fecha del servicio.
   - El código reinicia esa fecha también al cambiar el plazo.
   - El interruptor se guarda en dos lugares.
7. **Nit** — Faltan cosas en la spec:
   - que la cifra del botón de la Agenda es parte del requisito;
   - por qué se hace una hoja nueva en lugar de ampliar el reporte;
   - que las dos listas tienen reglas distintas.
8. **Nit** — Hay duplicación:
   - `readServiceLink` al lado de `readWaitlistOffer`;
   - el enlace de reservar armado dos veces (`controlBookUrl` en el backend y `controlBookingUrl` en el front).
9. **Nit** — La spec baja a detalles de proceso (número de migración, `dev:local`, comandos de prueba, constitución como RF), y «Decisiones para aprobar» conserva ese título ya aprobadas.

## Catalizador (`egm-inventive-catalyst`): 3 Major, 3 Nit

Lo que no es un falso compromiso:
- calcular el control;
- la ventana de 30 días que se pone al día sola;
- la página de baja que pide confirmar con un botón.

1. **Major — «Vencidos» crece sin límite y pone primero a los menos recuperables.** Es el mismo hallazgo que el 1 del arquitecto, y además la cifra del botón sólo sube.
2. **Major — Un email que puede esperar compite con los urgentes en un solo cupo de Gmail.**
   - `control_reminder` va en el nivel «paciente», con las confirmaciones, cancelaciones y recordatorios de cita.
   - Los controles y las encuestas se ponen en cola a la vez a las 10:00. Un día de cupo lleno, los emails de las citas esperan detrás. Un recordatorio que espera demasiado se descarta.
   - Propone un nivel aparte o que vayan después dentro del nivel, o como mínimo un tope diario.
3. **Major — No se revisa de nuevo antes de enviar.**
   - Si el email espera en la cola, sale igual aunque entretanto el paciente haya reservado, alguien haya pulsado «Quitar», se haya apagado el interruptor o el paciente haya pedido no recibir más.
   - El mailer sí revisa los otros emails que pueden esperar: el recordatorio de cita, la oferta de la lista de espera, la encuesta y la invitación de calendario.
   - Propone revisar antes de enviar y descartar con un motivo, o al menos un tiempo máximo en la cola.
4. **Nit** — No escribir por lo que ya estaba vencido al encenderlo es una decisión del dueño, pero la spec no dice por qué.
5. **Nit** — Se marca `emailed_at` antes de saber si el email entró en la cola.
   - La clave del email es por paciente y día, así que un segundo control del mismo día queda marcado y nunca sale.
   - La hoja diría «Le escribimos el…», y sería falso.
6. **Nit** — Igual que el 3 del arquitecto: el propietario sí corrige la cita Atendida, y si el control pasa a la cita anterior puede salir un segundo email.

Los hallazgos 2 y 3 del catalizador vienen de la misma causa y conviene decidirlos juntos.
