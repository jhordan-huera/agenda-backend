# Reporte final: Las citas completadas quedan fijas

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-17, PR backend #41 y front #32) · **Fecha**: 2026-10-17

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: No

## Resumen

**Una cita «Completada» queda fija:**
- ya no cambia de estado;
- de sus datos sólo se pueden cambiar las notas, el pago y los comprobantes;
- si alguien se equivocó, el propietario la corrige con «Corregir estado» y un motivo obligatorio,
  que queda en la actividad (también el super admin en modo soporte).

**Ninguna cita vuelve a «Pendiente»:** una «Confirmada» sólo avanza, y «No asistió» y «Cancelada»
se pueden cambiar, pero no a Pendiente. La API hace cumplir las reglas aunque el panel sea antiguo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Una cita completada no cambia | P1 | Hecha | La ficha sin botones de estado; «Editar» sólo con las notas |
| H2 – Una confirmada sólo avanza | P1 | Hecha | «Pendiente» deshabilitado, con su ayuda, y fuera de la lista del formulario |
| H3 – El propietario corrige un error | P1 | Hecha | Con el estado, el motivo (de 10 a 300 caracteres) y «Avisar al paciente» apagada |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Completada no cambia de estado | Cumple | `completed-appointments` (78 comprobaciones): desde la ficha, «Editar» y «Por cerrar» |
| RF-002 – Sólo el pago, los comprobantes y las notas | Cumple | `completed-appointments`; el recorrido: «Editar» con sólo las notas, el pago y la llegada |
| RF-003 – Nunca vuelve a Pendiente | Cumple | `completed-appointments` y `status-notices`: Confirmada → Pendiente responde 409, sin emails |
| RF-004 – La corrección del propietario | Cumple | El propietario y el super admin en modo soporte corrigen; un administrador, Recepción y el rol Profesional reciben 403; sin motivo, 400; desde otro estado, 409; queda en la actividad con el motivo |
| RF-005 – La API la hace cumplir | Cumple | Las pruebas llaman a la API directamente |
| RF-006 – No asistió y Cancelada se pueden cambiar | Cumple | `completed-appointments` y `booking-alert`: de Cancelada a Confirmada |
| RF-007 – La beta | Cumple | Build, lint y su recorrido: la ficha completada y la corrección |
| CE-001 a CE-003 | Cumple | Las pruebas y el recorrido: 133 comprobaciones en claro y en oscuro, a 1440 y a 390 px, sin errores en la consola |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test` con 59 de 59 suites
  y 2527 comprobaciones.
- **Front** (después de fusionarlo con «Comparar» en `dev`): `npm run build`, `npm run lint` y
  `npm run check:contrast` sin errores.

## Cambios respecto al plan

- **Quitar la llegada** de una cita completada también se bloquea (RF-002). Marcarla ya sólo
  funcionaba con citas abiertas.
- **Los mensajes de la API:**
  - al cambiar otros campos de una completada: «Esta cita está completada: sólo se pueden cambiar
    sus notas, el pago y los comprobantes.»;
  - al volver a Pendiente: «Una cita no vuelve a Pendiente: para reactivarla, márcala como
    Confirmada.».
- **En el repositorio,** el método se llama `correctStatus` y la mutación,
  `useCorrectAppointmentStatus`.
- **Tres suites ajustadas** (`booking-alert`, `couple-booking` y `status-notices`): volvían citas a
  Pendiente o cambiaban completadas. Siguen probando lo mismo por caminos permitidos.
- **El email «queda pendiente de confirmar»** ya no tiene ningún camino que lo dispare.
- **La beta** guarda ahora «Estado» en los cambios de la actividad simulada, como producción.
- **Al unir una reserva «Por verificar»,** el paciente de sus citas se sigue cambiando, también el de
  las completadas, porque es la misma persona.
- **El front se hizo en una copia aparte** (worktree, rama `spec-020`), mientras se rediseñaba
  «Comparar», y se fusionó en `dev`.

## Pendientes y riesgos

- **Hallazgo, ya resuelto (2026-10-17, aprobado por el dueño):** al corregir a «Confirmada» una
  cita completada que ya pasó, volvía a quedar por cerrar y el panel se bloqueaba al instante (spec
  018). Ahora «Confirmada» sólo se ofrece si la cita aún no terminó (`correctionTargets`). La API lo
  hace cumplir: si ya pasó, responde 409 con «Esta cita ya terminó: corrígela a «No asistió» o
  «Cancelada»…». La beta, igual.
  - En el diálogo, la ayuda lo explica.
  - Una prueba nueva lo comprueba. `status-notices` corrige su cita moviéndola a mañana, para no
    depender de la hora a la que corre.
  - En el navegador pasaron 8 de 8: en Chromium y en WebKit, una cita pasada y una futura.
- **Sin comprobar:** el aviso de ntfy de una corrección y el WhatsApp ya escrito cuando se corrige
  con «Avisar al paciente».
- **Algún negocio** puede tener la costumbre de reabrir citas completadas. Conviene avisarles.

## Mensaje sugerido para los negocios

> Desde hoy, una cita marcada como «Completada» ya no se puede cambiar, para que tus reportes y el
> historial de cada paciente sean confiables. Si te equivocaste, el propietario del negocio puede
> corregirla desde la cita con «Corregir estado», escribiendo el motivo. Además, una cita confirmada
> ya no vuelve a «Pendiente». Si tienen alguna duda, escríbanme y con gusto les ayudo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | fe72374 | Spec 020: las citas completadas quedan fijas (spec, plan, tareas y constitución 1.17.0) |
| agenda-front | 858240b | Constitución 1.17.0: las citas completadas quedan fijas (spec 020) |
| agenda-front | 7ba8f30 y 297cf68 | Spec 020: las citas completadas quedan fijas (front), fusionado en `dev` |
| agenda-backend | (el de esta entrega) | Spec 020: las citas completadas quedan fijas (backend) y reporte |

La beta queda actualizada en su carpeta, con la copia previa `beta-src-antes-020.tgz`.

## Cómo publicarlo

1. **Primero el PR del backend y después el del front.** Sin migración ni variables.
2. **Después,** avisar a los negocios con el mensaje de arriba.

## Texto para el PR

Spec 020: una cita «Completada» queda fija. Sólo cambian sus notas, el pago y los comprobantes, y
sólo el propietario la corrige, con motivo, en la actividad: `POST
…/appointments/:id/correct-status`. Ninguna cita vuelve a «Pendiente». Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/020-citas-completadas-fijas/reporte.md

## Ajuste del 2026-10-17: las citas del panel nacen confirmadas

El dueño pidió que las citas creadas desde el panel nazcan confirmadas, y que sólo las reservas online
aparezcan como pendientes. Antes el formulario proponía «Confirmada» pero dejaba elegir «Pendiente». En
producción había 24 citas, todas del panel, y 1 seguía pendiente.

**Qué cambió:**
- **«Nueva cita»** no ofrece «Pendiente». Una serie sólo se crea «Confirmada». Para registrar una sesión
  que ya pasó, se puede crear también como Completada, No asistió o Cancelada.
- **La API rechaza** una cita o una serie «Pendiente» desde el panel, con 400 y el mensaje «Las citas
  del panel se crean confirmadas: «Pendiente» es sólo para las reservas online.»
- **Las reservas online** siguen naciendo «Pendientes».
- **La beta,** igual.
- **Constitución 1.18.0:** una línea en el principio III.

**Pruebas:**
- `appointment-series` comprueba los dos rechazos y que confirmada sí se crea. La serie «Pendiente» que
  usaban sus pasos siguientes se deja pendiente en la base, como las que ya existían.
- Pasan todas las suites. Front y beta: build y lint sin errores.
