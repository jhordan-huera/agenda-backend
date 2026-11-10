# Reporte final: Recordatorios del comprobante de pago

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-11-10, PR backend #68 y front #51) · **Fecha**: 2026-11-10

**Repos**: agenda-backend y agenda-front (y la beta) · **Migración**: Sí: `055_recordatorio_comprobante.sql`

## Resumen

El super admin activa **«Pedir el comprobante de pago»** en cada negocio, desde su ficha en /admin, y elige qué días
salen los recordatorios. Las opciones son:
- los 3 días anteriores a la cita;
- los 3 días siguientes a la reserva;
- o los 2 días anteriores y la mañana del mismo día.

**Antes de su cita, el paciente recibe un email al día** con el enlace para subir el comprobante, como mucho 3 por
cita:
- sólo en citas con precio, pendientes o confirmadas, de agendas con cuentas para transferir, sin comprobante ni
  pago;
- nunca desde que empieza la cita;
- con varias citas, un solo email al día;
- sin copia al profesional.

**En el panel,** esas citas llevan la marca **«Sin comprobante»**, un filtro en la agenda y el botón **«Recordar el
pago por WhatsApp»**, con el enlace.

**Cuando el paciente sube el comprobante,** el profesional de la agenda recibe el email y el aviso en la app, también
en el celular. **Los negocios sin activar siguen como antes.**

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El super admin activa el negocio | P1 | Hecha | Con los días; el negocio no lo cambia |
| H2 – El paciente recibe el recordatorio y sube el comprobante | P1 | Hecha | Sólo antes de la cita (cambio del 2026-11-10) |
| H3 – El profesional ve lo pendiente y lo recuerda por WhatsApp | P2 | Hecha | Sólo en citas que aún no han empezado |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El interruptor y los días | Cumple | `payment-reminders`: sólo el super admin; el propietario recibe 403 en la ruta de /admin; los campos de más dan 400; queda en la actividad. Recorrido: la tarjeta en /admin |
| RF-002 – Un recordatorio al día, sólo antes de la cita | Cumple | `payment-reminders`: las tres opciones de días avanzando día a día; nunca el día de la reserva ni desde que empieza la cita; el tope de 3; nada para una cita completada, pasada o ya empezada |
| RF-003 – Un email por paciente y día | Cumple | `payment-reminders`: varias citas, un email; con una sesión en pareja, sólo el principal |
| RF-004 – Sin copia; el aviso al profesional | Cumple | `payment-reminders`: ninguna copia; el email del comprobante al profesional aunque tenga apagados los avisos de sus citas; el aviso en el celular del rol Profesional |
| RF-005 – La marca, el filtro y el WhatsApp | Cumple | Recorrido: una cita futura sin comprobante lleva la marca y el WhatsApp con su enlace; una completada, no; el filtro sólo deja las pendientes o confirmadas |
| RF-006 – La actividad y el historial | Cumple | `payment-reminders`: el interruptor y los días en la actividad; los recordatorios, en el historial de emails |
| RF-007 – Los negocios sin activar | Cumple | `payment-reminders` y recorrido: ni emails ni nada nuevo en el panel |
| RF-008 – La constitución | Cumple | 1.32.0, idéntica en los dos repos |
| RF-009 – La beta | Cumple | El interruptor, la marca y el WhatsApp con su repositorio de ejemplo, sin emails; compila y pasa el lint |
| CE-001 – Las pruebas del backend | Cumple | `tests/payment-reminders.test.ts`, 80 comprobaciones |
| CE-002 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test`, 71 de 71 suites. Front: build, lint, `check:contrast`, `check:data-export` y `check:board`. Beta: build y lint |
| CE-003 – Computador y celular | Cumple | Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro: 27 de 27 en cada uno, sin desbordes ni errores en la consola, con capturas |
| CE-004 – La prueba real | Cumple | Un recordatorio real al buzón de pruebas (2026-11-09) y otro al email del dueño del producto como paciente (2026-11-10). Llegaron, se leen bien en el celular y salió uno solo, sin copia |

## Cambios respecto al plan

- **El modo «Después de la cita» y el modo de cada agenda se quitaron** (decisión del 2026-11-10: «el comprobante deben
  subirlo antes de la cita»). La migración 055 se editó, porque aún no estaba aplicada en producción.
- **Los recordatorios salen entre las 9:00 y las 21:00 del negocio.** A partir de las 21:00 rige el silencio de los
  demás recordatorios.
- **Al desactivar el interruptor se conservan los días.** Si se vuelve a activar, quedan como estaban.
- **Si el negocio o el super admin en modo soporte mandan el interruptor desde el panel del negocio,** se ignora. Es
  como con las citas en pareja: el panel no lo cambia. Desde /admin, el propietario recibe 403.
- **Sólo cuentan las citas que van en el email:** el contador de una cita no sube si no se incluyó.
- **El email del comprobante se envía una vez por dirección,** aunque el email del negocio y el del profesional sólo
  difieran en mayúsculas. Vale para todos los negocios.
- **Las citas pasadas sólo pierden la marca en el panel:** la vista Mes aplica el filtro, pero no pinta la marca.
- **El paso diario también corre en el servidor local** (`npm run dev:local -- --recordatorios`).

## Pendientes y riesgos

- **La migración 055 va antes del backend.** Sin ella, el backend nuevo falla al leer los negocios.
- **Un recordatorio que espera en la cola por el cupo de Gmail** puede salir después de que el paciente suba el
  comprobante. La nota del email cubre ese caso.
- **El cupo de Gmail es compartido:** el tope de 3 por cita y un email por paciente y día lo acotan.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 13062ce | Spec 039: recordatorios del comprobante de pago (migración 055, interruptor, paso diario, email, avisos, pruebas, constitución 1.32.0) |
| agenda-backend | 742b8ff | Spec 039: spec, plan y tareas |
| agenda-backend | 289db69 | Spec 039: el recordatorio del comprobante sólo cuenta las citas que van en el email |
| agenda-backend | d799330 | Spec 039: T017 hecha (un recordatorio real al buzón de pruebas) |
| agenda-backend | d866ffb | Spec 039: el comprobante se pide sólo antes de la cita (decisión del 2026-11-10) |
| agenda-front | 10ad605 | Spec 039: recordatorios del comprobante de pago (tarjeta de /admin, marca, filtro, WhatsApp, plantilla, constitución 1.32.0) |
| agenda-front | 3cf7049 | Spec 039: el comprobante se pide sólo antes de la cita (decisión del 2026-11-10) |

## Cómo publicarlo

1. **La migración 055, antes que nada.** El dueño del producto ejecuta `npm run db:migrate` en agenda-backend, o el SQL
   de la migración con su línea en `schema_migrations`.
2. **El PR `dev` → `main` del backend** y después el del front. El del front va sin la portada de prueba.
3. **Después, en producción:**
   - en /admin, la ficha de un negocio muestra la tarjeta «Pedir el comprobante de pago», apagada;
   - se activa sólo en un negocio que lo pida;
   - el día siguiente, a partir de las 9:00, se mira en su historial de emails que salieron los recordatorios.

## Texto para el PR

Spec 039: el super admin activa «Pedir el comprobante de pago» en cada negocio y elige los días. Antes de su cita, el
paciente recibe un email al día con el enlace para subir el comprobante, como mucho 3 por cita y sin copia al
profesional. En el panel, la marca «Sin comprobante», el filtro y «Recordar el pago por WhatsApp». Lleva la
migración 055.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/039-recordatorio-comprobante/reporte.md
