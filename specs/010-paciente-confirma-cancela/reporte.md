# Reporte final: El paciente confirma o cancela su cita desde el email

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `037_patient_confirms_cancels.sql`

## Resumen

Cada email de una cita activa trae ahora un enlace a la página **«Tu cita»**, sin iniciar sesión. Ahí
el paciente ve su cita y pulsa **«Confirmo que voy»**: el negocio lo ve en la agenda, en la ficha y en
el Inicio («Confirmó el paciente»), sin que cambie el estado de la cita. Si el negocio permite
cancelaciones y aún hay tiempo, también puede **cancelarla**: la hora queda libre, salen los avisos de
siempre y el negocio recibe además un email. Si ya no hay tiempo, la página le da el WhatsApp y el
teléfono del negocio.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El paciente confirma que va | P1 | Hecha | Desde el botón del recordatorio (`?confirmar=1`) o desde la página; repetir no cambia nada |
| H2 – El paciente cancela dentro del plazo | P1 | Hecha | Con la regla del negocio, comprobada con la cita bloqueada; fuera de plazo, el contacto |
| H3 – El enlace en los emails | P1 | Hecha | Seis emails, el enlace de cada persona y nunca en la copia al profesional |
| H4 – El negocio lo controla | P2 | Hecha | La marca en el bloque, la lista del celular, la ficha y el Inicio; los textos y el aviso de Configuración → Agenda |

## Comprobación

Todo en local: PostgreSQL desechable para `npm test`; para los recorridos, API en el 4180, front en
el 5199, beta en el 3199 y una base de prueba con los datos de demostración. Nunca en Vercel ni
contra Supabase.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Enlace privado sin sesión | Cumple | `appointment-page`: el principal entra con su `payment_token` y cada otra persona con su `access_token` (32 hex, distinto). Recorrido: la página se abre sin sesión |
| RF-002 – Lo que muestra y lo que no | Cumple | `appointment-page`: servicio, fecha, hora, profesional, modalidad y negocio; en la respuesta no está el nombre, el email, el teléfono ni la cédula del paciente, ni la dirección de la visita, ni el enlace de la videollamada, ni las notas. Recorrido a 390 px: sin el nombre ni el email de la paciente |
| RF-003 – Confirmar sin cambiar el estado | Cumple | `appointment-page`: guarda la hora, el estado sigue igual, una sola actividad; la segunda vez, `already: true` sin cambiar la hora. Sin la cabecera `X-Requested-With`, 403 y no confirma. Recorrido: «¡Gracias! Te esperamos el …» y, al recargar, «Confirmaste que vas el …» |
| RF-004 – Cancelar dentro del plazo | Cumple | `appointment-page`: a 25 h cancela; la cita queda Cancelada, la hora libre en la página de reservas, la cancelación a cada persona, una copia y el aviso al negocio. Recorrido: pide confirmarlo y «Elegir otra hora» lleva a la reserva, donde esa hora está libre |
| RF-005 – Fuera de plazo o sin cancelaciones | Cumple | `appointment-page`: a 23 h, 409 y la cita sigue igual; sin «Permitir cancelaciones», 409 y `disabled`. Recorrido: «Para cancelar con menos de 24 h, escríbele a…» y «Si no puedes asistir…», con el WhatsApp ya escrito y «Llamar» |
| RF-006 – El enlace en los emails | Cumple | `email-templates`: los seis emails de cita activa lo llevan y los otros tres no; «Ver mi cita» si no podrá cancelar; «Confirmo que voy» en el recordatorio. `reminders`, `multi-client-appointments`, `couple-booking`, `status-notices` y `payments`: cada persona con su enlace y ninguna copia ni aviso al negocio con él. Recorrido: «Ver o cancelar mi cita: http://localhost:5199/cita/…» en Emails enviados, y no en la copia |
| RF-007 – La marca en el panel | Cumple | Recorrido: el bloque de la semana («…, confirmó el paciente» en el árbol de accesibilidad), la lista a 390 px, la ficha («Confirmó el paciente · 14 oct, 23:05»), la ficha en pareja («Confirmaron todos» y la hora de cada persona) y el Inicio («Confirmó») |
| RF-008 – Cambiar la cita borra la confirmación | Cumple | `appointment-page`: la hora, la fecha y el profesional la borran, también la de las otras personas; las notas y el precio, no; cancelar la borra y Atendida la conserva; reactivada, se puede volver a confirmar. Recorrido: al arrastrar la cita desaparece la marca y el email del cambio lleva otra vez el enlace |
| RF-009 – Actividad y ntfy «por el paciente» | Cumple | `appointment-page`: «Confirmó que va, desde su email» y «Cancelada por el paciente desde su email», con «Estado» en los cambios; con un ntfy falso, el cron arma «Agenda360: cita cancelada por el paciente», con la paciente a medias y sin el negocio en el título; la confirmación no avisa. `booking-alert` y `status-notices` |
| RF-010 – Varias personas | Cumple | `appointment-page`: la otra persona confirma la suya, no puede cancelar (409, `not_main`) ni abrir el pago. Recorrido: sólo el principal ve «Cancelar mi cita» y «Pagar la cita» |
| RF-011 – Límites y el mismo 404 | Cumple | `appointment-page`: el mismo 404 para un token inventado, mal formado, de hace 31 días, de una persona quitada y de un negocio suspendido (el de hace 30 días todavía se abre); 61 vistas o 21 acciones desde una IP dan 429. Recorrido: «Este enlace no está disponible» |
| RF-012 – Beta | Cumple | Build y lint. Recorrido `beta-verificar-010.mjs`: 119 de 119 (la bandeja simulada abre «Tu cita», confirmar, cancelar, la marca, la pareja, los casos de 404) |
| CE-001 – Menos de 30 s en el celular | Cumple (medido) | `medir-010.mjs` a 390 px con el build de producción: confirmar desde el enlace del recordatorio, 0,2 s en local y 3,0 s con una red 4G simulada (1,6 Mb/s, 150 ms); abrir la página y cancelar con dos toques, 2,4 s con la misma red. Falta sólo el tiempo de leer y tocar |
| CE-002 – Nunca fuera de plazo | Cumple | `appointment-page`: a 23 h no cancela; dos cancelaciones a la vez cancelan una sola vez, con un solo juego de emails |
| CE-003 – Quién confirmó, sin abrir cada cita | Cumple | Recorrido: icono en el bloque y marca en la lista del celular y en el Inicio |
| CE-004 – Pruebas y 390 px | Cumple | Ver abajo; los recorridos a 390 px sin desplazamiento horizontal |

**Pruebas automáticas**:
- **Backend:**
  - `npm run typecheck` sin errores;
  - `env -u DATABASE_URL npm test`: 49 de 49 suites y 1687 comprobaciones;
  - la suite nueva `appointment-page`: 87;
  - las actualizadas: `email-templates` (48), `status-notices` (30), `booking-alert` (54), `reminders`
    (45), `multi-client-appointments` (63), `couple-booking` (71), `booking-verify` (33) y `payments`
    (88).
- **Front:** `npm run build` y `npm run lint` sin errores ni avisos.
- **Beta:** `npm run build` (con los 2 avisos de siempre) y `npm run lint` sin errores ni avisos.
- **Recorridos** (en el scratchpad):
  - `verificar-010.mjs`: 64 de 64, en escritorio y a 390 px;
  - `medir-010.mjs`: los tiempos del CE-001;
  - `beta-verificar-010.mjs`: 119 de 119.

## Cambios respecto al plan

- **El email al negocio de la decisión 2 es un tipo nuevo, `patient_cancelled`** (plantilla
  `patientCancelled`, «Un paciente canceló su cita»). El plan decía «sin tipos nuevos» porque se
  escribió antes de esa decisión.
  - Sale si el email del negocio no es el del profesional (que ya recibe la copia) ni el de un
    paciente, aunque el negocio tenga apagados los emails de cancelación (ésos son los del paciente).
  - No cuenta en el tope de emails a terceros: es un aviso al propio negocio, como «Nueva reserva».
  - ntfy lo muestra como «Aviso al negocio», la bandeja de emails como «Cancelación del paciente (al
    negocio)» y el resumen del cron lo cuenta en su propio grupo.
- **`saveAppointment` vuelve a leer la cita después de guardarla** en lugar de usar `returning`. El
  trigger que borra la confirmación de las otras personas corre después del `returning`, y la
  respuesta del panel salía con la confirmación vieja. Es una consulta más por guardado.
- **Unir a la ficha conserva las horas exactas:** la hora de la confirmación (y la de alta en la
  sesión) pasan como texto, para no perder los microsegundos.
- **La página tiene títulos cortos que el contrato no nombra:** «¿Vienes a tu cita?» con «Avísale a
  {negocio} que te espere.» sobre «Confirmo que voy», «¿No puedes ir?» sobre la cancelación o el
  contacto, y en la tarjeta «Confirmada por {negocio}.» (R3). Si el negocio permite cancelar sin
  política escrita, dice «Puedes cancelar hasta 24 h antes de la cita.».
- **Inicio:** «Confirmó» se muestra en las citas pendientes o confirmadas que aún no tienen «Llegó»
  (al llegar, ya no hace falta llamar). En «Tu siguiente cita» va en blanco, sobre la tarjeta de color.
- **Datos demo:** una de cada dos citas activas de mañana y de las que quedan hoy, ya confirmada.
- **`formatDayMonth`** («14 oct») en `src/lib/format.ts`, compartido.
- **La confirmación no toca `updated_at`:** no es un cambio que haga el negocio.
- **Beta** (con sus datos de prueba; copia previa en `beta-src-antes-010.tgz`):
  - sus plantillas son sólo de texto y no tienen copia al profesional: se les añadieron el enlace,
    «Confirmo que voy» y el aviso al negocio, que va siempre a su email (no hay email de profesional
    con el que compararlo);
  - las confirmaciones se guardan en el propio `clientConfirmations` de la cita y los enlaces de las
    otras personas en `extraClientTokens`;
  - no tiene el filtro de actividad por autor, así que no hubo que renombrarlo;
  - en «Tu siguiente cita» la marca usa los colores normales (allí la tarjeta es clara);
  - los enlaces `/cita/…` y `/pago/…` de la bandeja simulada se pulsan y abren otra pestaña;
  - las bases ya guardadas en un navegador reciben los enlaces nuevos, pero no las citas demo
    confirmadas: para verlas, «Restaurar datos demo».

## Pendientes y riesgos

- **Con los valores de fábrica** (recordatorio y antelación de 24 h), el recordatorio dice «Ver mi
  cita»: ya no se puede cancelar desde él, sí desde los emails anteriores. Configuración → Agenda lo
  avisa (decisión 1).
- **Unir a la ficha cuando la ficha ya estaba en la misma sesión:** como en la spec 009, sobra la fila
  del paciente aparte, y su enlace de esa sesión deja de abrirse. La persona conserva el enlace de la
  ficha. Es un caso raro.
- **Un enlace reenviado o filtrado** permite confirmar o cancelar esa cita hasta 30 días después de
  ella (riesgo aceptado en el plan).
- **No probado en producción:** la migración 037 sobre la base real. Se aplicó limpia sobre la base
  local de prueba con los datos demo y en cada `npm test`.
- **Spec 011:** usará la migración 038 y toca los mismos archivos compartidos.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 94190f0 | Spec 010: el paciente confirma o cancela su cita desde el email (backend) |
| agenda-front | 8a7d4f7 | Spec 010: el paciente confirma o cancela su cita desde el email |

Este reporte y el cierre de `tasks.md` van en un commit aparte del backend.

## Cómo publicarlo

**El orden importa:** así ningún email lleva a una página que todavía no existe.

1. **Constitución 1.7.0:** ya va en estos commits, igual en los dos repos (specs 010, 011 y 012).
2. **Migración 037,** como paso aparte, antes de publicar el código:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

   El backend publicado sigue igual con ella: sólo añade columnas y el borrado automático.
3. **PR `dev` → `main` del front.** El panel funciona con el backend de antes (la marca simplemente no
   aparece) y la página «Tu cita» ya existe, aunque ningún email lleve todavía su enlace.
4. **PR `dev` → `main` del backend.** Desde ese momento, los emails y los recordatorios del cron llevan
   el enlace. Al publicarse, abrir esta dirección y ver `"ok":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   No hace falta probar en producción: todo se comprobó antes en local.
5. **Beta:** ya está actualizada en su carpeta (sin git).

No hay variables nuevas en Vercel ni en GitHub.

## Texto para el PR

El paciente confirma o cancela su cita desde el email (spec 010): cada email de una cita activa trae
el enlace a «Tu cita»; «Confirmo que voy» deja la marca «Confirmó el paciente» en la agenda, la ficha
y el Inicio sin cambiar el estado, y «Cancelar mi cita» respeta «Permitir cancelaciones» y la
antelación del negocio, con los avisos de siempre y un email al negocio. Constitución 1.7.0.

**Migración 037 antes de publicar; primero el front y después el backend.** Reporte:
`specs/010-paciente-confirma-cancela/reporte.md`.
