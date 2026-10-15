# Reporte final: Citas que se repiten

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-15, PR backend #28 y front #25) · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `038_appointment_series.sql`

## Resumen

En «Nueva cita» del panel aparece **«Repetir»**: se elige cada cuánto (cada semana, cada 2 semanas o
cada mes) y cuántas citas (de 2 a 24, 8 por defecto). **«Revisar fechas»** muestra la lista con su día
y su hora, y marca con su motivo las que chocan con otra cita, un bloqueo, un día sin atención, una
hora fuera del horario o el cupo del plan. A cada una se le cambia la hora o se quita (las de un
bloqueo o fuera del horario también se pueden «Agendar igual»), y **«Crear 7 citas»** crea las demás.
El paciente recibe **un solo email** con todas las fechas y la ficha de cada cita dice «Cita 3 de 7» y
permite **«Cancelar ésta y las siguientes»** con un solo email.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Agendar una serie | P1 | Hecha | «Repetir», la lista con sus marcas, «Otra hora», «Agendar igual», «Quitar» y el cupo recalculado; al crear, cada fecha se vuelve a comprobar con el negocio bloqueado |
| H2 – Un solo email al paciente | P1 | Hecha | «Tus próximas N citas en …» con el enlace a «Tu cita» (spec 010) de cada fecha, la copia al profesional sin esos enlaces y un solo aviso al profesional |
| H3 – Cambiar o cancelar la serie | P2 | Hecha | Cada cita se cambia sola; «Cita 3 de 8 · cada semana» y «Cancelar ésta y las siguientes» con la casilla «Avisar al paciente», un email y el WhatsApp con las fechas |

## Comprobación

Todo en local: PostgreSQL desechable para `npm test`; para los recorridos, API en el 4180, front en
el 5199, beta en el 3199 y la base de prueba del 54400 con los datos de demostración. Nunca en Vercel
ni contra Supabase.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – «Repetir»: cada semana, cada 2 semanas o cada mes, de 2 a 24 | Cumple | `appointment-series`: las fechas de cada frecuencia (cada mes desde el 31: 28 o 29 de febrero, 30 de abril…), 1 y 25 citas → 400, una frecuencia que no existe → 400. Recorrido: 8 y «Cada semana» por defecto; «Cada mes» desde el 31/10/2026 lista 30/11, 31/12 y 31/01 |
| RF-002 – La lista con las que chocan marcadas | Cumple | `appointment-series`: otra cita («Ya hay una cita de 10:00 a 11:00», sin el nombre del otro paciente, con horas libres), bloqueo («Bloqueado: Congreso»), día sin atención (sin horas libres), fuera del horario y el cupo (Free con 18 citas: las 2 últimas «Supera el cupo del plan (20 citas al mes)»); la vista previa no cambia nada. Recorrido: las mismas marcas en el panel y en la beta |
| RF-003 – Cambiar la hora o quitar | Cumple | Recorrido: «Otra hora para el martes …» a las 14:00 pasa a «Se crea»; «Quitar» la deja «Quitada» con «Volver a agregar»; «Agendar igual» la suma («Crear 8 citas»); en un Free, al quitar una la marca del cupo pasa a la siguiente |
| RF-004 – Se crean las que no chocan, con los mismos datos, y se dice cuáles no | Cumple | `appointment-series`: de 8, una con otra hora y una quitada → 7, numeradas 1 a 7 sin huecos, con el mismo paciente, servicio, profesional, modalidad (con la dirección), precio y notas; la serie guarda 8 pedidas y 7 creadas; sin «Agendar igual» el bloqueo no se crea y con él sí. Recorrido: «Se crearon 7 citas» y «No se creó: martes 1 de diciembre» |
| RF-005 – Nunca una cita solapada | Cumple | `appointment-series`: una cita suelta agendada después de la vista previa vuelve en `skipped` con «Se ocupó mientras revisabas la lista»; si ninguna se puede crear, 409 y ninguna serie (402 si todas pasaban el cupo) |
| RF-006 – Un solo email con todas las fechas y su copia | Cumple | `appointment-series`: un `appointment_series` por paciente (dos en pareja, uno si comparten email) y una copia, ninguna confirmación por cita; «pendientes de confirmar» en Pendiente; nada con «Confirmaciones» apagado; con el tope diario bajo queda «No enviado…» y sin copia. `email-templates`: asunto, fechas con su enlace, zona en las virtuales, año si cambia, pago una sola vez y la copia sin enlaces. Recorrido: un «Serie de citas» y su copia en Emails |
| RF-007 – Cada cita es una cita normal | Cumple | `appointment-series`: el recordatorio de la 2.ª y su copia el día que toca; cambiarle la hora a la 4.ª cambia sólo ésa y conserva la serie; confirmar la 2.ª de una serie pendiente manda su «Cita confirmada». Recorrido: «Editar» la 4.ª desde su ficha |
| RF-008 – «Cita 3 de 8» y «Cancelar ésta y las siguientes» con un solo email | Cumple | `appointment-series`: desde la 3.ª de 7 con la 5.ª Atendida se cancelan 3, 4, 6 y 7; un «Se cancelaron 4 citas en …» y una copia; con `notify: false` o «Cancelaciones» apagado, ningún email; una cita suelta y repetirlo → 409. Recorrido: «Cita 3 de 7 · cada semana», «Se cancelaron 5 citas», el WhatsApp con las 5 fechas; sin avisar, ni email ni WhatsApp |
| RF-009 – ntfy una vez por serie | Cumple | `appointment-series` y `booking-alert` con el ntfy falso: un «Agenda360: nueva serie de citas» («serie de 7 citas desde el panel», «1 fecha no se creó», quién, sus emails) y sus citas sin «nueva cita»; un «Agenda360: serie de citas cancelada» sin un cambio de estado por cita; sin el negocio en el título ni datos completos |
| RF-010 – Una entrada de actividad por serie | Cumple | `appointment-series`: una `appointment.series_created` («Agendó una serie de 7 citas de …, cada semana desde el … (1 no se creó)», con «Fechas») y ninguna «Creó la cita»; una `appointment.series_cancelled`. Recorrido: una sola entrada en Actividad |
| RF-011 – La beta | Cumple | Build y lint. Recorrido `beta-verificar-011.mjs`: 27 de 27 (la lista con la cita de prueba, otra hora y quitar, un solo email en la bandeja simulada, «Cita 3 de 4», un solo email de cancelación, el cupo de un Free y 390 px) |
| CE-001 – 8 sesiones en menos de un minuto | Cumple (medido) | `verificar-011.mjs`: de «Nueva cita» a «Se crearon 8 citas» sin choques, 1,2 s con Playwright (paciente, servicio, fecha, hora, «Repetir», «Revisar fechas», «Crear 8 citas»). Falta sólo el tiempo de leer y tocar de una persona |
| CE-002 – Ninguna cita solapada, también con dos series a la vez | Cumple | `appointment-series`: dos series a la vez a la misma hora con el mismo profesional → 8 + 2 creadas y 6 en `skipped`; una serie y una reserva online a la vez → una sola se queda la hora; en los dos casos, 0 solapes con `tsrange … &&` |
| CE-003 – Un email por serie | Cumple | Ver RF-006 y RF-008 |
| CE-004 – Pruebas y 390 px | Cumple | Ver abajo; a 390 px con WebKit (motor de Safari) y con Chrome, el formulario, la lista y la ficha sin desplazamiento horizontal; con Tab se llega a «Repetir» con su etiqueta y el foco visible |

**Pruebas automáticas**:
- **Backend:**
  - `npm run typecheck` sin errores;
  - `env -u DATABASE_URL npm test`: 50 de 50 suites y 1825 comprobaciones;
  - la suite nueva `appointment-series`: 110;
  - las actualizadas: `booking-alert` (65), `cron` (30), `email-templates` (62), `whatsapp-notice` (13)
    y `delete-business` (32).
- **Front:** `npm run build` y `npm run lint` sin errores ni avisos nuevos (el build da los 2 avisos de
  siempre: un trozo de más de 500 kB e `inlineDynamicImports`).
- **Beta:** `npm run build` (con los mismos 2 avisos de siempre) y `npm run lint` sin errores ni avisos.
- **Recorridos** (en el scratchpad, `shot/`):
  - `verificar-011.mjs`: 66 de 66, en escritorio, a 390 px con WebKit y a 390 px con Chrome;
  - `beta-verificar-011.mjs`: 27 de 27.

## Cambios respecto al plan

- **La vista previa devuelve también `monthlyLimit`** (el tope de citas al mes del plan, o null). Hace
  falta para el motivo «Supera el cupo del plan (20 citas al mes)» cuando la lista se recalcula en el
  navegador. No dice nada nuevo: el tope de cada plan es público y el cupo de cada mes ya llegaba.
- **Los motivos de `skipped`**, además de «Se ocupó mientras revisabas la lista»: «Se bloqueó…»,
  «Cambió el horario…» (día sin atención o fuera del horario sin «Agendar igual») y «Se llenó el cupo
  del plan…».
- **El texto de los emails conserva la fecha junto al enlace.** El bloque de datos de `layout.ts` gana
  `textWithHref`: en la versión de texto (y en Actividad → Emails) cada fecha sale como «Cita 1: Martes
  20 de octubre, 10:00 – 11:00 · https://…/cita/…»; sin él, el texto sólo mostraba el enlace.
- **El pago en el email de la serie no lleva el botón «Enviar el comprobante»:** el comprobante es de
  cada cita y se sube desde el enlace de cada fecha («Transfiere $30 por cada cita y sube el
  comprobante desde el enlace de cada fecha»).
- **El email de cancelación de la serie** va con el id de la primera cita cancelada de ese paciente
  (normalmente la de la ficha); el aviso de ntfy toma cuántas de la fila «Citas canceladas» de la
  actividad y desde cuándo de la primera cita cancelada.
- **«Otra hora» ofrece también la hora de la serie** («10:00 (de la serie)») para volver atrás, y si ese
  día no quedan horas libres lo dice («Ese día no quedan horas libres.»).
- **Con «Repetir», el formulario no muestra el choque de la primera fecha** (ni el aviso de bloqueo o
  fuera de horario): la lista ya lo marca. Y comprueba en el navegador que la primera fecha sea desde
  hoy, con el mismo texto que la API.
- **El WhatsApp de la serie cancelada** se ofrece a todos los pacientes de las citas canceladas, cada
  uno con sus fechas.
- **La confirmación de «Cancelar ésta y las siguientes»** dice además «Las atendidas no cambian.», y la
  ayuda de la casilla «Avisar al paciente» nombra también esta acción.
- **La lista de otra agenda también da 403** al rol Profesional (no sólo crear la serie).
- **Beta:** guarda la serie en cada cita (`series`), sin copia ni aviso al profesional (como hoy), y su
  actividad sólo tiene el resumen (la beta no guarda «Fechas» en los cambios). Copia previa del código en
  `beta-src-antes-011.tgz`.
- **Orden de publicación con la spec 010** (ver «Cómo publicarlo»): el plan dice backend antes que el
  front, y el reporte de la 010 lo contrario. Si se publican juntas se elige lo más prudente.

## Pendientes y riesgos

- **No probado en producción:** la migración 038 sobre la base real. Se aplicó limpia sobre la base
  local de prueba (que ya tenía la 037) y en cada `npm test`.
- **Cancelar la serie no se deshace en bloque:** para recuperar una cita hay que reactivarla sola (riesgo
  aceptado en el plan).
- **Una serie mensual llega a casi 2 años:** si cambia el horario o se pone un bloqueo, las citas ya
  creadas no se mueven solas, como hoy con las citas sueltas.
- **El plan Free (20 citas al mes) se llena rápido** con series: la lista lo muestra antes de crear.
- **CE-001** se midió con Playwright; falta el tiempo real de una persona.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 6942875 | Spec 011: citas que se repiten (backend) |
| agenda-front | 8012d75 | Spec 011: citas que se repiten |

Este reporte, el estado de la spec y el cierre de `tasks.md` van en un commit aparte del backend.

## Cómo publicarlo

**La migración va antes del código que la usa.** El orden del backend y el front depende de la spec 010:

1. **Migración 038,** como paso aparte, antes de publicar el código. Si la 010 aún no está publicada,
   el mismo paso aplica también su 037:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

   El backend publicado sigue igual con ella: sólo añade una tabla y dos columnas vacías.
2. **Si la 010 ya está publicada:** como dice el plan, primero el PR `dev` → `main` del **backend** y
   después el del **front** (el front nuevo llama a las rutas nuevas).
3. **Si la 010 y la 011 se publican juntas:** primero el **front** y después el **backend**, como pide la
   010 (así ningún email lleva a una página «Tu cita» que aún no existe). Mientras termina el despliegue
   del backend, «Revisar fechas» responde «Ruta no encontrada»: no usar «Repetir» hasta entonces. Las
   citas sin `series` se ven como sueltas.
4. **Al publicarse el backend,** abrir esta dirección y ver `"ok":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   No hace falta probar en producción: todo se comprobó antes en local.
5. **Beta:** ya está actualizada en su carpeta (sin git).

No hay variables nuevas en Vercel, Lambda ni GitHub. La constitución ya está en la 1.7.0 con el texto
de esta spec.

## Texto para el PR

Citas que se repiten (spec 011): en «Nueva cita», «Repetir» (cada semana, cada 2 semanas o cada mes,
de 2 a 24 citas) y la lista de fechas con las que chocan marcadas, donde se cambia la hora, se quita o
se agenda igual; al crear se vuelve a comprobar cada fecha con el negocio bloqueado. Un solo email por
paciente con todas las fechas, un aviso de ntfy y una entrada de actividad por serie; la ficha dice
«Cita 3 de 8» y permite «Cancelar ésta y las siguientes».

**Migración 038 antes de publicar.** Reporte: `specs/011-citas-que-se-repiten/reporte.md`.
