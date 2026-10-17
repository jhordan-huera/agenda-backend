# Plan de implementación: Las citas completadas quedan fijas

**Rama**: `dev` · **Fecha**: 2026-10-16 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La regla, en un solo lugar compartido.** En `lib/constants/appointment-status.ts`, que se edita
   en el front y se copia con `sync:shared`:
   - `canChangeStatus(from, to)`:
     - desde «Completada», nada;
     - a «Pendiente», nada salvo desde «Pendiente»;
     - lo demás, sí.
   - `CORRECTABLE_FROM_COMPLETED = ["confirmed", "no_show", "cancelled"]`.
   - `LOCKED_STATUS = "completed"`.

   El backend y el front usan las mismas funciones.
2. **La API** (`business-data-service.ts`):
   - **`changeAppointmentStatus`** (la ficha y «Por cerrar») comprueba `canChangeStatus`. Si no se
     puede, responde `conflict`: «Esta cita está completada: ya no se puede cambiar. El propietario
     puede corregirla con un motivo.» o «Una cita confirmada no vuelve a Pendiente.».
   - **`update`** (`PUT …/appointments/:id`):
     - si la cita está completada, sólo acepta cambios en `notes`. Si llega cualquier otro campo
       distinto, responde `conflict`;
     - si cambia el estado, aplica `canChangeStatus`.
   - **`setAppointmentArrival`** («Marcar que llegó») ya sólo funciona con Pendiente o Confirmada. No
     cambia.
   - **Ruta nueva `POST …/appointments/:id/correct-status`,** con `{ status, reason, notify }`:
     - **sólo el propietario:** `actor.role === "owner"`, que incluye al super admin en modo
       soporte. Si no, `forbidden`;
     - **sólo desde «Completada»** y hacia un estado de `CORRECTABLE_FROM_COMPLETED`;
     - **el motivo,** de 10 a 300 caracteres, con `appointmentCorrectionSchema`, compartido;
     - **guarda** con la misma lógica que `changeAppointmentStatus`, sin la regla del bloqueo;
     - **la actividad:** acción `appointment.status_corrected` y summary «Corrigió el estado de la cita
       de … de «Completada» a «No asistió». Motivo: …», con «Estado» en los cambios;
     - **`notify`** es falso por defecto.
3. **El front:**
   - **La ficha de la cita** (`appointment-details-sheet.tsx`):
     - si está completada, en lugar de «Cambiar estado» sale «Completada · ya no se puede cambiar»;
     - el propietario ve además el botón «Corregir estado», que abre un diálogo con el estado nuevo,
       el motivo y la casilla «Avisar al paciente», apagada;
     - si está confirmada, «Pendiente» va deshabilitado, con su ayuda.
   - **El formulario de editar** (`appointment-form-dialog.tsx`):
     - si está completada, sólo se editan las notas; el resto va deshabilitado, con el aviso arriba;
     - la lista de estados sólo ofrece los permitidos por `canChangeStatus`.
   - **El repositorio** gana `correctAppointmentStatus`.
4. **La beta:** los mismos archivos del front y el mismo bloqueo en su repositorio simulado, con la
   corrección y su entrada en la actividad simulada.
5. **Constitución 1.17.0** (MENOR), una línea en el principio III:
   > Una cita Completada queda fija: no cambia de estado ni de datos (salvo el pago, los comprobantes
   > y las notas), y sólo el propietario la corrige, con un motivo que queda en la actividad. Ninguna
   > cita vuelve a Pendiente; No asistió y Cancelada se pueden cambiar (2026-10-16).

**Sin migración ni variables.**

## Comprobación contra la constitución

- **Español:** cumple.
- **Privacidad:** no aplica.
- **Decisiones:** cumple. Se respetan las cuatro de esta spec. La corrección deja su motivo en la
  actividad, como pide «Auditar todo».
- **Local:** cumple.
- **Compartido:** las reglas viven en un solo archivo compartido.
- **Barato:** cumple, sin consultas de más.
- **Diseño:** cumple, en los dos modos y a 390 px.

## Pruebas

**Backend** (`tests/completed-appointments.test.ts`, nueva):
- **El bloqueo:**
  - una completada no cambia de estado, ni desde la ficha, ni desde «Editar» ni desde «Por cerrar»;
  - sólo cambian sus notas;
  - el pago y los comprobantes siguen funcionando.
- **Volver a Pendiente:**
  - una confirmada no vuelve a Pendiente;
  - una «No asistió» y una «Cancelada» sí cambian, pero no a Pendiente.
- **La corrección:**
  - funciona para el propietario y para el super admin en modo soporte;
  - un administrador, Recepción y el rol Profesional reciben 403;
  - el motivo es obligatorio: corto o vacío, 400;
  - desde un estado que no es «Completada», 409;
  - queda en la actividad con su motivo;
  - sin `notify`, ningún email.
- **Las pruebas que ya existen** y cambiaban una completada se ajustan a la regla nueva.

**Front:** build y lint, y un recorrido en los dos modos, a 1440 y a 390 px:
- la ficha completada;
- la corrección como propietario;
- la ficha con otro rol;
- el formulario con las notas;
- la confirmada sin «Pendiente».

**Beta:** build, lint y un recorrido corto.

## Publicación

1. **La constitución 1.17.0,** al aprobar.
2. **Primero el PR del backend y después el del front,** sin migración.
3. **Avisar a los negocios** con el mensaje del reporte: «Las citas completadas ya no se pueden
   cambiar; si te equivocas, el propietario puede corregirla con un motivo».

## Riesgos

- **Algún negocio puede tener la costumbre** de reabrir citas completadas. Desde ahora sólo podrá
  hacerlo el propietario, con un motivo.
- **Las pruebas que ya existen** pueden depender de cambiar citas completadas. Se ajustan.
