# Reporte final: El aviso de la mañana y el cierre obligatorio del mes

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-17, PR backend #45 y front #34) · **Fecha**: 2026-10-17

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `045_morning_summary.sql`

## Resumen

1. **El aviso de la mañana.** Cada profesional, a la hora en que empieza a atender ese día, recibe
   en su campana y en su celular «Tienes N citas de días anteriores sin cerrar». El propietario lo
   recibe cuando abre el negocio, con las de todo el negocio. Si ese día no atiende o no hay nada que
   cerrar, no le llega. El resumen de las 8 de la noche sigue igual.
2. **El cierre obligatorio del mes.** Si quedan citas sin cerrar de un mes anterior, el panel se
   bloquea sin «Más tarde» hasta cerrarlas: «Empezó un nuevo mes: cierra las citas del mes anterior
   para seguir». Las del mes en curso siguen con «Más tarde», y el modo soporte no se bloquea.
3. **El aviso al super admin.** Cada vez que salen los recordatorios de la mañana o de las 8, el super
   admin recibe por la campana, su celular y ntfy «Recordatorios de citas por cerrar enviados», con
   los negocios y sus cifras: «Mañana · 3 negocios: A (6 citas), …». Muestra hasta 10 negocios y no
   lleva datos de pacientes.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El aviso de la mañana | P1 | Hecha | Sale a la hora de inicio del horario de cada agenda; no sale si ese día no atiende |
| H2 – El cierre obligatorio del mes | P1 | Hecha | `previousMonth` en el contador; la pantalla sin «Más tarde» |
| H3 – El aviso al super admin | P2 | Hecha | Uno por pasada con avisos; en la campana, el celular y ntfy |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El aviso a la hora de inicio, una vez | Cumple | `morning-summary` (54 ✓), con el cron simulado a horas fijas |
| RF-002 – El propietario, a la apertura y sin repetir | Cumple | `morning-summary` |
| RF-003 – Si no atiende ese día, nada | Cumple | `morning-summary`: por su horario y por un bloqueo de día completo |
| RF-004 – Campana siempre; celular, si está encendido | Cumple | `morning-summary` y `push-notices`. Recorrido: los tres interruptores |
| RF-005 / RF-010 – Sin pacientes; negocios fuera del título y del registro | Cumple | `morning-summary` revisa los textos y la línea del registro |
| RF-006 – En el cron, fuera de Vercel | Cumple | Corre en `scripts/cron.ts` |
| RF-007 – La beta | Cumple | Su build y lint; su recorrido: la pantalla del mes y el aviso de ejemplo (4/4) |
| RF-008 / RF-009 – El bloqueo del mes y el del mes en curso | Cumple | `close-appointments` (70 ✓): el borde del mes y la zona. Recorrido 48/48: sin «Más tarde» también con uno guardado; al cerrar, se entra; con sólo del mes en curso, «Más tarde»; en modo soporte, la franja |
| CE-001 / CE-002 | Cumple | Las pruebas y el recorrido, en claro y en oscuro, a 1440 y a 390 px |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test`: 60 de 60 suites,
  con 2595 ✓ y 0 ✗.
- **Front:** `npm run build`, `npm run lint` y `npm run check:contrast` sin errores.
- **Beta:** build y lint sin errores.

## Cambios respecto al plan

- **La ventana del aviso:** sale si la hora de inicio cayó entre 2 horas antes y la pasada actual. Así,
  pasadas 2 horas no sale, aunque el cron haya estado parado más tiempo.
- **El resumen de las 8 y el de la mañana** informan a qué negocios avisaron con `RemindersTally`. El
  aviso al super admin lo arma `queueRemindersSentNotices`.
- **La cifra de cada negocio en el aviso al super admin** es la del negocio entero si salió el del
  propietario; si no, la suma de las agendas que avisaron en esa pasada.
- **Cada pasada con avisos manda su propio aviso al celular del super admin.**
- **El título de ntfy** lleva «Agenda360: » delante, como los demás.
- **El aviso abre la lista «Por cerrar»** con `?por-cerrar=1`. Si hay un «Más tarde» guardado, el panel
  espera al contador para no mostrarse un instante antes del bloqueo. Al cerrar las del mes anterior
  sale «Listo: ya cerraste las citas del mes anterior.».
- **La migración 045** deja con nombre los dos `check` que rehace: `panel_notices_kind_check` y
  `panel_notices_scope_check`.
- **Los avisos de la mañana se calculan con una sola consulta para todos los negocios.** Si
  PostgreSQL rechazara la zona horaria de un negocio, ese paso fallaría para todos esa pasada. El fallo
  queda en el registro y el cron sigue con lo demás.
- **En la beta,** la cita del mes anterior se crea reabriendo la última completada de Valeria de antes
  del día 1, y las bases que ya estaban guardadas en el navegador la reciben una vez.

## Pendientes y riesgos

- **Sin comprobar:**
  - celulares reales y el envío real por ntfy, porque en local no hay tema;
  - un día 1 real: el mes anterior se simuló con fechas;
  - la tanda de la noche en el recorrido, que sólo está probada en la suite;
  - la beta a 390 px y en oscuro.
- **Al publicarse,** el 1 de noviembre se bloqueará sin «Más tarde» a quien tenga citas de octubre sin
  cerrar. Conviene avisar antes a los negocios con el mensaje de abajo.

## Mensaje sugerido para los negocios

> Para que tus reportes muestren lo que de verdad pasó, desde hoy Agenda360 te recuerda cerrar tus
> citas también al empezar el día: a la hora en que empiezas a atender te llega cuántas citas de días
> anteriores siguen sin marcar (Completada o No asistió). Además, desde el 1 de noviembre, si quedan
> citas sin cerrar de un mes anterior, el panel te pedirá cerrarlas antes de seguir; con «Marcar todas
> como completadas» lo haces en un momento. Si tienen alguna duda, escríbanme y con gusto les ayudo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 08abd53 | Spec 021: el aviso de la mañana y el cierre obligatorio del mes (spec, plan, tareas y constitución 1.19.0) |
| agenda-front | dc609f8 | Constitución 1.19.0: el aviso de la mañana y el cierre obligatorio del mes (spec 021) |
| agenda-backend | (el de esta entrega) | Spec 021: el aviso de la mañana y el cierre obligatorio del mes (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 021: el aviso de la mañana y el cierre obligatorio del mes (front) |

La beta queda actualizada en su carpeta, con la copia previa `beta-src-antes-021.tgz`.

## Cómo publicarlo

1. **La migración 045, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **Después,** avisar a los negocios con el mensaje de arriba.

## Texto para el PR

Spec 021:
- **El aviso de la mañana:** a cada profesional, a la hora en que empieza a atender, y al propietario,
  cuando abre el negocio, cuántas citas de días anteriores siguen sin cerrar.
- **El cierre obligatorio del mes:** las citas sin cerrar de un mes anterior bloquean el panel sin
  «Más tarde».
- **El aviso al super admin:** por la campana, el celular y ntfy, a qué negocios salió cada tanda de
  recordatorios.

**Migración:** `045_morning_summary.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/021-aviso-de-la-manana/reporte.md
