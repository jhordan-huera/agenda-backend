# Plan de implementación: Cerrar las citas pendientes de días anteriores

**Rama**: `dev` · **Fecha**: 2026-10-15 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **`GET /businesses/:id/appointments/to-close?cursor=`.** Las citas que ya terminaron y siguen
   «Pendiente» o «Confirmada», en el alcance de quien pregunta (`agendaScope`: el rol Profesional, sólo
   su agenda), de la más vieja a la más nueva, por tandas de 50.
   - Devuelve `{ appointments, overdue, today }`: cuántas son de días anteriores y cuántas de hoy.
   - Usa el índice `(business_id, date)` que ya existe.
   - Cada fila trae lo que se ve en la agenda: el nombre del paciente, el servicio y el profesional.
2. **`GET …/appointments/to-close/count`:** sólo `{ overdue, today }`. Es barato: lo pide el panel al
   entrar y cada 3 minutos con la pestaña visible, junto con la campana. Así no suma CPU.
3. **El cierre de una cita:** la ruta de hoy, `PATCH …/appointments/:id/status`, con `notify`. Cada cita
   queda en la actividad, como hoy.
4. **`POST …/appointments/close-all`:** `{ status: "completed", notify, ids }`.
   - Cierra las que se ven y siguen sin cerrar, en una transacción.
   - Va dentro del alcance de quien llama, con una entrada en la actividad por cita, como un cambio de
     estado normal.
   - Si `notify` está marcado, los emails de la spec 008 entran en el cupo de Gmail (spec 015).
5. **El front:**
   - **En la agenda:** el botón «Por cerrar (N)» abre la lista, en un `Sheet` en el celular.
   - **En `dashboard-layout.tsx`:** si `overdue > 0` y no hay un «Más tarde» de menos de 4 horas en
     ese aparato (en `localStorage`, con `try/catch`), muestra la pantalla «Antes de seguir, cierra tus
     citas pendientes» con la lista, en lugar del panel.
   - **Con «Más tarde»,** la franja «Tienes N citas por cerrar».
   - **En modo soporte,** sólo la franja.
6. **El aviso al paciente:** por defecto, cerrar desde la lista **no** le escribe (la casilla «Avisar a
   los pacientes» viene apagada). Es un cierre administrativo de citas que ya pasaron.
7. **Constitución 1.15.0** (MENOR), una línea en el principio III:
   > Las citas de días anteriores sin cerrar bloquean el panel de quien puede cerrarlas (el rol
   > Profesional, las de su agenda; el resto del equipo, las del negocio) hasta cerrarlas o pulsar «Más
   > tarde», una vez cada 4 horas; nada se cierra solo (2026-10-15).

**Sin migración ni variables.**

## Pruebas

**Backend** (`tests/close-appointments.test.ts`, nueva):
- la lista y las cifras por rol (el rol Profesional sólo ve su agenda);
- de la más vieja a la más nueva, sin las ya cerradas y sin las que no terminaron;
- «Marcar todas» sólo cierra las de su alcance que siguen sin cerrar, cada una con su entrada en la
  actividad;
- `notify` falso no pone emails en la cola;
- una cita cerrada a la vez por dos personas;
- la zona horaria.

**Front:**
- build y lint;
- recorrido:
  - entrar con citas de ayer: la pantalla de bloqueo;
  - «Más tarde» y la franja;
  - cerrar una cita y después todas: «Todo al día»;
  - el rol Profesional sólo ve lo suyo;
  - el modo soporte, sin bloqueo;
  - a 390 px.

## Publicación

Primero el backend y después el front, sin migración. Al publicarse, los que tengan citas viejas sin
cerrar verán la pantalla al entrar. Conviene avisar a los negocios: hay un mensaje sugerido en el
reporte.

## Decisiones del dueño (2026-10-15)

1. **Bloquear con «Más tarde»,** una vez cada 4 horas.
2. **Nada automático.**
3. **Cada uno lo suyo.**
4. **Cerrar desde la lista no le escribe al paciente,** salvo que se marque «Avisar a los pacientes».
5. **La beta lo lleva,** con sus citas de prueba: la misma lista y el mismo bloqueo, en su repositorio
   mock.
