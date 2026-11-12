# Reporte final: Encuesta después de la cita

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-12) · **Fecha**: 2026-11-12

**Repos**: los dos · **Migración**: Sí, la 057 (la aplica el dueño del producto antes de publicar el backend)

## Resumen

El propietario puede encender «Preguntar al paciente cómo le fue» en Configuración → Notificaciones.
- **El email:** al día siguiente de una cita Atendida, desde las 10:00, el paciente recibe «¿Cómo te fue?» con 5
  estrellas. A cada paciente se le pregunta como mucho una vez cada 90 días y puede pedir no recibirlas.
- **La respuesta:** responde en una página sencilla, con la estrella del email ya elegida y un comentario opcional.
- **Dónde se ven las respuestas:** en Reportes y en la ficha del paciente, sólo para quien ve Reportes.
  - Con 1 o 2 estrellas, la campana avisa al propietario y al profesional, sin el comentario.
  - El informe mensual suma el promedio.
  - La descarga de datos trae `encuestas.xlsx`.
- **Las opiniones nunca se publican.**

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El paciente dice cómo le fue | P1 | Hecha | El email del día siguiente, la página /encuesta/:token y «No quiero recibir estas encuestas» |
| H2 – El negocio ve las opiniones | P1 | Hecha | La tarjeta de Reportes, «Sus opiniones» en la ficha y el aviso de 1 o 2 estrellas |
| H3 – El negocio la enciende | P2 | Hecha | En Configuración → Notificaciones, con su entrada en la actividad |
| H4 – El informe mensual | P3 | Hecha | El promedio y cuántas respondieron, con el mes anterior; sin comentarios |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El interruptor | Cumple | Prueba: Recepción recibe 403; el propietario la enciende y queda en la actividad. Recorrido: empieza apagada y se enciende ([captura](./capturas/interruptor-1440-claro.png)) |
| RF-002 – Quién la recibe y cuándo | Cumple | Prueba: nada antes de las 10:00, ni el mismo día de la cita, ni pasados 3 días. Sólo las Atendidas y sólo el paciente principal con email y sin la marca. Una por paciente (la cita más reciente); a los 30 días no, a los 91 sí |
| RF-003 – Las estrellas y sin copia | Cumple | Prueba y `check:surveys`: las 5 estrellas con su enlace, «No quiero recibir estas encuestas» y ningún `appointment_copy` |
| RF-004 – La página | Cumple | Prueba: una sola respuesta (la segunda, 409), las estrellas de 1 a 5, el comentario de hasta 1000, cerrada a los 14 días y 404 sin enlace. Recorrido: la estrella del email ya viene elegida, «Gracias» y «Ya respondiste» ([captura](./capturas/encuesta-1440-claro.png)) |
| RF-005 – Reportes y la ficha | Cumple | Prueba: el promedio y los conteos por periodo y paciente. Recorrido: «3,0 de 5, de 2 respuestas», con los comentarios ([captura](./capturas/reportes-1440-claro.png)), y «Sus opiniones» en la ficha ([captura](./capturas/ficha-1440-claro.png)) |
| RF-006 – Quién las ve | Cumple | Prueba: el rol Profesional, sólo las de su agenda; Recepción y otro negocio, 403 |
| RF-007 – El aviso de 1 o 2 estrellas | Cumple | Prueba: el aviso con las estrellas y sin el comentario; con 4 estrellas, ninguno. Recorrido ([captura](./capturas/campana-1440-claro.png)) |
| RF-008 – La actividad | Cumple | Prueba: `survey.answered` con las estrellas y sin el comentario, y `client.surveys_opted_out` una sola vez |
| RF-009 – El informe mensual | Cumple | Prueba: `monthStats` cuenta las respuestas del mes y su promedio, y el email los suma sin comentarios |
| RF-010 – La descarga de datos y el borrado | Cumple | Prueba: el resumen cuenta las respondidas y `encuestas.xlsx` las trae (el rol Profesional, las suyas); al borrar al paciente se borran sus encuestas |
| RF-011 – Apagada, todo igual | Cumple | Prueba: apagada no sale ninguna |
| RF-012 – La constitución | Cumple | 1.47.0 en los dos repos (principio III), con las dos excepciones |
| CE-001 – Las pruebas del backend | Cumple | `tests/surveys.test.ts`: 47 de 47 |
| CE-002 – Typecheck, pruebas, build, lint y comprobaciones | Cumple | Backend: `typecheck` y «76 de 76 suites pasaron» (en 4 min 22 s). Front: build, lint sin avisos y las 10 `check:*` (la nueva `check:surveys`) |
| CE-003 – En el computador y en el celular | Cumple | Recorrido en Chromium a 1440 en claro (16 de 16) y WebKit a 390 en oscuro (5 de 5), sin desplazamiento horizontal ni errores en la consola ([captura](./capturas/encuesta-390-oscuro.png)) |
| CE-004 – Responder en menos de 30 segundos | Cumple | Desde el email: tocar una estrella abre la página con ella elegida; el comentario es opcional y basta «Enviar» |
| CE-005 – Una prueba real del email | Sin comprobar | Falta enviarlo con la cuenta de Gmail de pruebas y abrirlo en el celular, como el de la lista de espera |

## Cambios respecto al plan

- **La prueba de la lista de espera (047) terminaba lenta:** no cerraba su conexión a la base. Ahora termina con
  `process.exit()`, como las demás. Pasó de varios minutos a segundos.
- **La actividad de la respuesta** va en la cita (`entityType: "appointment"`), y la de «No quiero recibir estas
  encuestas», en el paciente. No hizo falta un tipo nuevo.
- **El interruptor** está en su propia sección de Configuración → Notificaciones, como el informe mensual. Lo ve
  también el super admin en modo soporte.

## Pendientes y riesgos

- **La migración 057** la aplica el dueño del producto antes de publicar el backend.
- **CE-005** (el email real en el celular) queda por hacer antes de publicar.
- **En psicología, una encuesta puede incomodar.** Por eso empieza apagada y pregunta como mucho cada 90 días.
- **Con pocas respuestas,** el promedio siempre sale con «de N respuestas».

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 8b7ea54 | Spec 048: plan de implementación |
| agenda-backend | (este commit) | Spec 048: la migración 057, el envío, la página, las opiniones, el aviso, el informe mensual, la descarga, las pruebas y la constitución 1.47.0 |
| agenda-front | 4427915 | Spec 048: la página /encuesta/:token, las opiniones en Reportes y en la ficha, el interruptor, el aviso, `encuestas.xlsx`; `check:surveys`; constitución 1.47.0 |

## Cómo publicarlo

1. **La migración 057 primero:** la aplica el dueño del producto con `npm run db:migrate`.
2. **Los PR `dev` → `main`**, en verde («Comprobar»): primero el del backend y después el del front.
3. **Después:** el propietario de cada negocio la enciende si la quiere.

## Texto para el PR

Spec 048: encuesta después de la cita.
- **Al día siguiente de una cita atendida,** el paciente recibe «¿Cómo te fue?» con 5 estrellas (como mucho una vez
  cada 90 días; puede pedir no recibirlas).
- **Las opiniones** en Reportes y en la ficha del paciente, privadas.
- **Con 1 o 2 estrellas,** avisa la campana.
- **La enciende el propietario** en Configuración → Notificaciones.
- **Migración 057.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/048-encuesta-despues-de-la-cita/reporte.md
