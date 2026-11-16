# Etapa 6 — Comprensión (EGM)

Revisor nuevo `egm-comprehension` sobre [spec.md](../spec.md), archivo completo. Leyó el documento solo, sin otros archivos del proyecto. Fecha: 2026-11-16.

## Qué propone

La spec añade un «recordatorio de control» a una agenda de consultorios.

- **El control:**
  - Cada servicio puede tener un intervalo «Volver en», de 1 semana a 1 año; por defecto, «No».
  - Cada paciente activo cuya última cita Atendida de ese servicio fue en la fecha X tiene un control que vence en X más el intervalo.
  - Sólo cuenta el paciente principal de la cita.
- **La hoja «Controles» de la Agenda:**
  - Muestra los vencidos y los que vencen en los próximos 30 días.
  - Excluye a quien ya tiene una cita futura de cualquier servicio y a los controles quitados.
  - Cada control tiene WhatsApp manual con el mensaje escrito, «Agendar» y «Quitar».
- **La ficha:** muestra el próximo control.
- **Los permisos:** el rol Profesional sólo ve los de su agenda.
- **El email:**
  - Con un interruptor por negocio que enciende el propietario, el cron envía un único email por control desde las 10:00 del día en que vence, con margen de hasta 30 días. Agrupa los controles del mismo día.
  - Lleva un botón a la página de reservas con el servicio ya elegido y un enlace público para no recibir más.
  - No lleva copia al profesional.
  - Nunca sale por controles que ya habían vencido al encender el interruptor o al ponerle «Volver en» al servicio.
- **Dónde se prueba:** se queda sólo en `dev`, con la migración 058.

## Cómo funciona hoy el sistema, según este documento

- Es una agenda multi-negocio, en dos repos (`agenda-backend` y `agenda-front`), y una «beta» aparte que no la recibe.
- Hay roles: propietario, administradores, Recepción y Profesional.
- Las citas tienen estados: Pendiente, Confirmada y Atendida.
- Hay un registro de «actividad».
- Ya existe:
  - el reporte «Pacientes que no volvieron», con WhatsApp, pero hay que acordarse de mirarlo;
  - un cron que envía emails a la hora del negocio: recordatorios, resumen de la noche, informe mensual y encuesta;
  - un cupo de Gmail por niveles, con cola;
  - la hoja «Lista de espera»;
  - una página de reservas que abre con una hora ya elegida.

El revisor dedujo, porque el documento no lo dice:
- que los emails al paciente llevan copia al profesional por norma;
- que existe una «constitución» donde se anotan las excepciones;
- que una cita puede tener varios pacientes, con uno principal.

## Hallazgos: 5 Major, 10 Nit

Pudo parafrasear todas las secciones, así que no hay bloqueantes.

1. **Major — «si se le escribió, cuándo».** El WhatsApp es manual y el sistema no sabe si salió.
   - No se dice si tocar «WhatsApp» marca el control ni si eso evita el email.
   - El equipo puede leer «se le escribió» como «ya lo contactó alguien».
2. **Major — La cita futura de otro servicio oculta el control, pero no lo renueva.**
   - Al pasar esa cita, el control reaparece vencido, y la spec no lo explica.
   - No se dice si se escribe cuando la otra cita queda Atendida dentro de los 30 días, ni si la Historia 2.5 vale para siempre o sólo mientras la cita está pendiente.
3. **Major — Hay tres casos sin «día de inicio».** No se sabe desde cuándo se escribe al:
   - cambiar un intervalo que ya existía (de 6 a 3 meses);
   - apagar y volver a encender el interruptor;
   - desactivar y reactivar el servicio.
4. **Major — «Copia al profesional» y «constitución».**
   - La spec llama «excepción» a no enviar la copia, pero no dice cuál es la regla general.
   - RF-013 pide actualizar la constitución sin decir qué es ni qué decisión recoger.
5. **Major — «La cita Atendida no se corrige (spec 020)» admite dos lecturas.** Si se puede corregir, falta decir qué pasa con el control. La spec 020 no está enlazada.
6. **Nit** — «a las 10:00» frente a «desde las 10:00». No se dice cada cuánto corre el cron ni si un email que espera en la cola puede salir después del día 30.
7. **Nit** — «La actividad» no está definida.
8. **Nit** — «Paciente principal» y «cita en pareja o en familia» no se explican.
9. **Nit** — Términos propios sin definir: «hoja», «la beta», «ntfy», «la campana», «nivel paciente del cupo», «la cola», `dev:local` y «SRI».
10. **Nit** — Las specs 020, 047 y 048 se citan sin enlace.
11. **Nit** — «hasta que él lo pida» usa «él» antes de nombrar al dueño. Además, el Estado dice «Aprobada» y la sección final sigue en condicional.
12. **Nit** — «Dos controles del mismo día» puede leerse como la misma fecha de vencimiento o el mismo día de envío.
13. **Nit** — «Vencidos» no tiene límite de antigüedad, y no se dice si es a propósito.
14. **Nit** — La marca «no quiero recibir estos recordatorios»: no se dice si se ve en el panel, cómo se deshace, ni qué significa «por negocio».
15. **Nit** — No se dice si «Pacientes que no volvieron» se mantiene ni en qué se diferencia de «Controles», ni si el WhatsApp abre la reserva con el servicio ya elegido.
