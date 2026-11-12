# Reporte final: Lista de espera

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-12) · **Fecha**: 2026-11-12

**Repos**: los dos · **Migración**: Sí, la 056 (la aplica el dueño del producto antes de publicar el backend)

## Resumen

Cada negocio puede encender la lista de espera en Configuración → Agenda.
- **El paciente se anota** desde la página de reservas, con los días, la parte del día y la fecha hasta la que espera.
  Recibe «Te anotamos» con el enlace para salir.
- **Cuando una cita se cancela, cambia de hora o se borra,** la hora queda anotada. El cron avisa por email a todos
  los que la esperan y la pueden reservar online. «Reservar esta hora» abre la página de reservas en el paso de los
  datos, con su nombre, email y teléfono escritos.
- **El equipo ve la lista en la Agenda,** con WhatsApp, «Agendar», «Quitar» y «Anotar». La campana avisa sin
  nombres.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El paciente se anota | P1 | Hecha | En el paso de la fecha y la hora; el mismo email actualiza; como mucho 5 esperas abiertas |
| H2 – Se libera una hora y se avisa | P1 | Hecha | Un disparador de la base anota cada hora liberada; el cron avisa a todos a la vez |
| H3 – El negocio ve y maneja la lista | P2 | Hecha | El botón «Lista de espera (N)» de la Agenda y su panel; el rol Profesional, sólo su agenda |
| H4 – El negocio la enciende | P2 | Hecha | Sólo el propietario (decisión 1 del plan), con su entrada en la actividad |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El interruptor | Cumple | Prueba: Recepción recibe 403 y el propietario la enciende, con «Lista de espera» en la actividad. Recorrido: el interruptor en Configuración → Agenda ([captura](./capturas/interruptor-1440-claro.png)) |
| RF-002 – Anotarse desde la página | Cumple | Recorrido en los dos navegadores ([captura](./capturas/anotarse-1440-claro.png)). Prueba: apagada responde 404; la validación de la fecha y los días |
| RF-003 – «Te anotamos» y salir | Cumple | Prueba: el email, el enlace (`no-store`), «Salir de la lista» con su actividad, salir dos veces y el mismo email que actualiza |
| RF-004 – Avisar la hora libre en menos de 15 minutos | Cumple | Prueba: cancelar desde el panel, cambiar la hora y borrar al paciente anotan la hora; el cron avisa a quien le sirve el día, la parte del día, la fecha y la agenda (o «Cualquiera»). La tarea corre en cada pasada del cron (cada 10 minutos) |
| RF-005 – «Reservar esta hora» | Cumple | Recorrido: abre «Tus datos» con su nombre y su email ([captura](./capturas/reservar-esta-hora-1440-claro.png)); si otra persona la reservó, «Esa hora ya se tomó» y las otras horas ([captura](./capturas/hora-tomada-1440-claro.png)) |
| RF-006 – El tope de 3 al día y el descarte | Cumple | Prueba: varias horas en un email, ninguno más con 3 en el día, y el aviso que esperó más de 3 horas se descarta con su motivo |
| RF-007 – Salir de la lista | Cumple | Prueba: al reservar (también la misma hora: la segunda reserva recibe 409), al pasar la fecha, con el enlace y desde el panel |
| RF-008 – La lista del panel | Cumple | Recorrido: la lista, «Anotar», «Agendar» (sin ficha abre «Nuevo cliente» con sus datos) y «Quitar» ([captura](./capturas/panel-lista-1440-claro.png)). Prueba: el rol Profesional ve sólo su agenda; otro negocio, 403 |
| RF-009 – La campana | Cumple | Prueba: el aviso al anotarse y el de la hora libre (3 personas, también la sin email), sin nombres. Recorrido ([captura](./capturas/campana-1440-claro.png)) |
| RF-010 – La actividad | Cumple | Prueba: `waitlist.joined`, `waitlist.left`, `waitlist.added`, `waitlist.removed` y `waitlist.scheduled`; los envíos del cron no |
| RF-011 – Sin copia al profesional | Cumple | Prueba: ningún `appointment_copy` |
| RF-012 – La descarga de datos y el borrado | Cumple | Prueba: el resumen cuenta la lista y `lista-de-espera.xlsx` trae las abiertas y las cerradas (el rol Profesional, las suyas; Recepción no descarga); las cerradas se borran a los 30 días |
| RF-013 – Apagada, todo igual | Cumple | Prueba: con la lista apagada no se anota nadie ni se anota ninguna hora |
| RF-014 – La constitución | Cumple | 1.46.0 en los dos repos (principio III), con las dos excepciones |
| CE-001 – Las pruebas del backend | Cumple | `tests/waitlist.test.ts`: 60 de 60 |
| CE-002 – Typecheck, pruebas, build, lint y comprobaciones | Cumple | Backend: `typecheck` y las 75 suites (en la corrida completa, 73 de 75; las otras 2 esperaban el texto y los tipos de antes, se pusieron al día y pasan). Front: build, lint sin avisos y las 9 `check:*` (la nueva `check:waitlist`) |
| CE-003 – En el computador y en el celular | Cumple | Recorrido en Chromium a 1440 en claro (20 de 20) y WebKit a 390 en oscuro (9 de 9), sin desplazamiento horizontal ni errores en la consola |
| CE-004 – Una prueba real del email | Sin comprobar | Falta enviarlo con la cuenta de Gmail de pruebas y abrirlo en el celular. Se puede hacer con `npm run dev:local` antes de publicar |

## Cambios respecto al plan

- **«Reservar esta hora» pide los horarios al día.** El recorrido encontró que la página de reservas se guarda hasta
  90 s (60 s en el navegador y 30 s en la CDN). Si el paciente abría el enlace justo después de que se liberara la
  hora, la veía todavía ocupada. Al llegar con `espera=…`, la página pide el perfil sin la copia guardada.
- **«Esa hora ya se tomó»** sale como un aviso dentro del paso de la fecha y la hora, no como un mensaje que
  desaparece.
- **El servicio y el aviso del cron** van en `back/src/services/waitlist-service.ts` y `waitlist-offers.ts`.
  `scheduled-tasks.ts` sólo los llama.
- **El rol Profesional** ve en el panel las esperas de su agenda, no las de «Cualquiera», como en la campana.
- **«Agendar»** abre la cita nueva con el servicio, su duración y su precio. Para eso, el formulario de la cita
  acepta ahora un servicio propuesto, y el de cliente nuevo, el email y el teléfono.
- **Se sumó la lista de espera** a la regla de las páginas del paciente (sigue el modo del aparato) y a la limpieza
  de rutas de los avisos de errores (spec 044).

## Pendientes y riesgos

- **La migración 056** la aplica el dueño del producto antes de publicar el backend.
- **CE-004** (el email real en el celular) queda por hacer antes de publicar.
- **El cron de GitHub puede atrasarse** en las horas de más carga: el «menos de 15 minutos» depende de él.
- **Avisar a todos a la vez** hace que alguien llegue tarde. La página se lo dice y le muestra las otras horas.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | f06aba3 | Spec 047: plan de implementación |
| agenda-backend | (este commit) | Spec 047: la migración 056, el servicio, el aviso del cron, las rutas, la descarga de datos, las pruebas y la constitución 1.46.0 |
| agenda-front | c0bb8f5 | Spec 047: anotarse en la página de reservas, el enlace personal, «Reservar esta hora», la lista en la Agenda, el interruptor y la descarga; `check:waitlist`; constitución 1.46.0 |

## Cómo publicarlo

1. **La migración 056 primero:** la aplica el dueño del producto con `npm run db:migrate`.
2. **El PR `dev` → `main` del backend** y después el del front, en verde («Comprobar»).
3. **Después:** el negocio enciende «Lista de espera» en Configuración → Agenda.

## Texto para el PR

Spec 047: lista de espera.
- **En la página de reservas:** «¿No encuentras una hora que te sirva? Anótate en la lista de espera».
- **Al cancelarse o moverse una cita,** el cron avisa por email a quien espera esa hora, con «Reservar esta hora».
- **En la Agenda:** la lista, con WhatsApp, «Agendar», «Quitar» y «Anotar».
- **La enciende el propietario** en Configuración → Agenda.
- **Migración 056.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/047-lista-de-espera/reporte.md
