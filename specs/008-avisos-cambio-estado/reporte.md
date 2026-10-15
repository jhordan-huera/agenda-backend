# Reporte final: Aviso al paciente en cada cambio de estado de su cita

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-14, PR backend #24 y front #22) · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: No

## Resumen

Ahora el paciente se entera de cada cambio de estado de su cita, avance o retroceda:
- por email, con copia al profesional;
- por WhatsApp, con el mensaje que el panel ofrece ya escrito.

Hay tres emails nuevos: «Tu cita queda pendiente de confirmar», «Gracias por tu visita» y «Te
esperábamos en tu cita».

Para corregir un error sin avisar, la ficha de la cita tiene la casilla «Avisar al paciente», que
está marcada al abrirla.

Los emails de Completada y No asistió van con el interruptor nuevo «Seguimiento», que viene
encendido.

El dueño del producto recibe por ntfy cada cambio de estado.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El paciente se entera de cada cambio de estado | P1 | Hecha | 3 emails nuevos, con copia al profesional |
| H2 – No avisar al corregir un error | P1 | Hecha | Casilla en la ficha, también para «Cancelar cita» |
| H3 – El negocio decide sobre el seguimiento | P2 | Hecha | «Seguimiento: Completada y No asistió», encendido |
| H4 – WhatsApp también en todos los cambios | P2 | Hecha | Aviso nuevo «queda pendiente de confirmar» |
| H5 – El dueño del producto se entera por ntfy | P2 | Hecha | Botones de estado y formulario, hasta 10 por pasada |

## Comprobación

Todo en local: base de prueba, API local y datos de demostración.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Pendiente avisa | Cumple | `status-notices.test.ts`: de Confirmada y de No asistió a Pendiente sale «pendiente de confirmar». Recorrido: el paciente lo recibe |
| RF-002 – Completada avisa | Cumple | Prueba: cita de hoy y de hace 7 días, sí; de hace 10 días o futura, no |
| RF-003 – No asistió avisa | Cumple | Prueba: con las mismas condiciones que Completada |
| RF-004 – Lo de antes sigue | Cumple | Prueba: Confirmada (también desde Completada), Cancelada y «vuelve a estar agendada» |
| RF-005 – Copia y varios pacientes | Cumple | Prueba: copia al profesional; con 2 pacientes, cada uno el suyo y una sola copia |
| RF-006 – La casilla | Cumple | Recorrido: marcada al abrir, otra vez marcada al volver a abrir y vale para «Cancelar cita» |
| RF-007 – Sin avisar | Cumple | Prueba: `notify: false` no deja emails y la actividad lo dice. Recorrido: sin WhatsApp ni email, y la actividad lo muestra |
| RF-008 – «Seguimiento» | Cumple | Recorrido: encendido. Prueba: apagado, Completada y No asistió no avisan; un negocio guardado sin él lo tiene encendido |
| RF-009 – WhatsApp al volver a Pendiente | Cumple | Recorrido: se ofrece «…queda pendiente de confirmar; te escribiremos para confirmarla» |
| RF-010 – El aviso dice si llega email | Cumple | Recorrido: «También le llega un email» |
| RF-011 – Nombres en la bandeja | Cumple | Recorrido: «Pendiente de confirmar» en la bandeja |
| RF-012 – Beta | Cumple | Build y lint. Recorrido en el 3199 (`beta-estado-008.mjs`), 8 de 8: casilla, WhatsApp «queda pendiente de confirmar», el email en la cola simulada, sin avisar, «Seguimiento» y la bandeja. Las reglas de los emails, comparadas con el backend en 16 casos |
| RF-013 – ntfy | Cumple | `booking-alert.test.ts`: el texto; una cancelación, un cambio desde el formulario y uno sin avisar; cada uno una sola vez; el tope de 10 |
| CE-001 – Cada cambio, su email | Cumple | `status-notices.test.ts`, 25 comprobaciones |
| CE-002 – Ninguno sin aviso | Cumple | La prueba recorre todos los estados y vuelve de cada uno |
| CE-003 – Corregir no avisa | Cumple | Prueba y recorrido |
| CE-004 – Pruebas y 390 px | Cumple | Ficha a 390 px sin desplazamiento horizontal |

**Pruebas automáticas:**
- backend: `npm run typecheck` y `npm test`, 44 de 44, con `status-notices` (nueva) y `booking-alert` (ampliada);
- front y beta: `npm run build` y `npm run lint` sin errores ni avisos nuevos;
- recorrido con Playwright: `estado-008.mjs` 16 de 16 y, en la beta, `beta-estado-008.mjs` 8 de 8.

## Cambios respecto al plan

- **«Completada» en vez de «Atendida».** El panel llama así al estado, y así se escribió el
  interruptor: «Seguimiento: Completada y No asistió».
- **Una cita futura marcada Completada o No asistió** (un error) tampoco manda el email de
  seguimiento: el límite es «de hoy hacia atrás, hasta 7 días».
- **`cron.test.mjs`:** se actualizó la línea que espera el registro del cron, que ahora dice también
  «cambios de estado: N».
- **Beta:**
  - sus plantillas son de texto, así que los tres emails nuevos se escribieron a su estilo, con los
    mismos textos;
  - su cola simulada no tiene la copia al profesional, ni ntfy;
  - antes de cambiarla se guardó una copia de su código (`beta-src-antes-008.tgz`, en el
    scratchpad).
- **ntfy:** los emails de cada cambio se reconocen porque se crean en la misma transacción que su
  registro de actividad.

## Pendientes y riesgos

- **Más emails a los pacientes.** La casilla y los interruptores lo controlan.
- **Un cambio de sólo fecha u hora** (sin cambio de estado) sigue sin avisar por ntfy. No se pidió.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 98345a7 | Spec 008: aviso al paciente en cada cambio de estado de su cita (backend) |
| agenda-front | 5e6d6aa | Spec 008: aviso al paciente en cada cambio de estado de su cita |

## Cómo publicarlo

1. **Sin migración.**
2. **PR `dev` → `main` del backend primero.** Si el front sale antes, la casilla desmarcada no tiene
   efecto hasta que salga el backend.
3. **PR `dev` → `main` del front.**
4. **Después:** cambiar el estado de una cita de prueba y mirar el email y el aviso de ntfy en la
   siguiente pasada del cron.

## Texto para el PR

Aviso al paciente en cada cambio de estado de su cita (spec 008): emails nuevos de «pendiente de
confirmar», «gracias por tu visita» y «no asistió», WhatsApp en todos los cambios, casilla «Avisar al
paciente» para corregir errores, interruptor «Seguimiento» y aviso por ntfy de cada cambio. Sin
migración. Reporte: `specs/008-avisos-cambio-estado/reporte.md`.
