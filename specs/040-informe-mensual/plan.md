# Plan de implementación: Informe mensual para el negocio

**Rama**: `dev` · **Fecha**: 2026-11-10 · **Spec**: [spec.md](./spec.md)

**Sin migración.** El interruptor vive con los demás ajustes de notificaciones del negocio y el tipo de email es
uno más: `notifications.type` no tiene restricción en la base.

## Diseño

1. **El interruptor «Informe mensual»** (sólo el propietario):
   - **Dónde:** un campo más en los ajustes de notificaciones, `monthlyReport` (encendido por defecto), en el tipo
     `NotificationSettings`, en `notificationSettingsSchema` con `.default(true)` (los negocios guardados antes
     quedan encendidos) y en `DEFAULT_NOTIFICATION_SETTINGS`. Todo en el código compartido del front, sincronizado
     al backend con `npm run sync:shared`.
   - **Sólo el propietario lo cambia** (`account-service.ts → update`): si lo manda otra persona del equipo o el
     super admin en modo soporte, se conserva el valor guardado, como se ignora el interruptor del comprobante
     desde el panel.
   - **La actividad:** «Informe mensual» se suma a `NOTIFICATION_FIELDS` (`audit-changes.ts`): el cambio sale con
     el antes y el después, como los demás ajustes.
   - **En el panel** (`notification-settings-form.tsx`): un `SwitchField` «Informe mensual», con la explicación
     «El día 1 de cada mes te llega por email el resumen de tu mes anterior». Sólo lo ve el propietario.

2. **Las cifras del mes** (`src/services/monthly-report.ts`, nuevo). Una consulta por negocio con el mes calendario
   anterior en su hora. Se cuentan igual que en la analítica del super admin (spec 016):

   | Cifra | Cómo se cuenta |
   |---|---|
   | Citas gestionadas | Citas del mes sin las canceladas |
   | Reservas online | De ésas, las que llegaron por la página de reservas |
   | Recordatorios | Emails de recordatorio de cita enviados en el mes |
   | Confirmaciones | Citas del mes con «Confirmo que voy» |
   | Cancelaciones con tiempo | Citas del mes canceladas con 24 h o más de anticipación, desde el panel o desde «Tu cita». La hora quedó libre |
   | Pacientes nuevos | Fichas creadas en el mes, sin las importadas ni las «Por verificar», como cuenta el plan |
   | Comprobantes recibidos | Comprobantes de pago que los pacientes subieron por el enlace en el mes |
   | Ingresos estimados | La suma del precio de las citas completadas del mes, en la moneda del negocio |
   | Comparación | Citas del mes frente a las del mes anterior, en %. Sólo si el anterior tuvo citas |

   Las cifras en 0 no salen. Sin citas en el mes, no hay informe.

   **Cambio respecto a la spec:** las cancelaciones con tiempo son las de la analítica (panel o «Tu cita», 24 h
   antes), no sólo las del paciente. Así el informe y la analítica dicen lo mismo.

3. **El envío** (`runMonthlyReportJob` en `monthly-report.ts` y `queueMonthlyReports(now)` en
   `src/jobs/scheduled-tasks.ts`, como `queuePaymentReminders`):
   - **Qué negocios:** activos, con propietario y con el informe encendido. Cada uno en su transacción.
   - **Cuándo:** del día 1 al 7 del mes, desde las 8:00 de la hora del negocio. Si el día 1 no pudo pasar el cron,
     sale en la primera pasada siguiente de esa semana.
   - **Una sola vez por negocio y mes:** con la clave `monthly-report:<negocio>:<AAAA-MM>` en la cola de emails, que
     no deja repetirla. Antes de contar nada se mira si ya existe, para no recalcular en cada pasada.
   - **El cupo de Gmail:** el tipo `monthly_report` es del nivel «negocio» (`EMAIL_PRIORITY`), como la agenda del
     día de los profesionales. Si un día no cabe, espera y nunca quita sitio a los emails del equipo ni de los
     pacientes.
   - **El registro del cron:** «informes mensuales: N», sólo la cifra.

4. **El email** (`monthlyReport` en `front/src/lib/email/templates.ts`, compartido):
   - **Asunto:** «Tu mes de octubre en Agenda360», con el mes que corresponda.
   - **El cuerpo:** un saludo al propietario por su nombre, las cifras que no están en 0 y la comparación.
   - **Al final:**
     - el botón **«Ver mis reportes»**, a `/dashboard/reports`;
     - si el negocio tiene enlace de referidos, la línea **«¿Conoces a otro profesional? Compártele tu enlace»**,
       con su enlace (`referralLink`), sin descuentos ni precios;
     - una nota: «Si no quieres recibir este resumen, apágalo en Configuración → Notificaciones».
   - **Lo que no lleva:** ningún dato de pacientes, ni planes, precios o topes de Agenda360, ni cifras estimadas, ni
     la LOPDP.
   - **El tipo `monthly_report`** se suma a `EmailType` y al historial de emails del negocio, como «Informe
     mensual» (`email-outbox.tsx`).

5. **La constitución, 1.36.0, en los dos repos:** qué es el informe, quién lo recibe, qué lleva y qué no.

**No se hace** (la spec lo dejaba como opcional): la fecha del último informe en la ficha del negocio en /admin.
Ya se ve en el historial de emails del negocio.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | El email sólo lleva cifras del negocio, nunca datos de pacientes. El registro del cron sólo lleva el número de informes |
| III. Decisiones | Sí | Los negocios no ven planes ni precios. Sin testimonios ni cifras inventadas. La LOPDP no sale |
| Auditoría | Sí | El interruptor va a la actividad, con su prueba. El informe, al historial de emails, como todo envío automático |
| Costo de Vercel | Sí | Todo lo calcula y lo envía el cron de GitHub. La API sólo guarda el interruptor |
| VII. Diseño | Sí | El interruptor es un `SwitchField` como los demás, a 390 px sin desbordes. El email usa los bloques de siempre |

## Pruebas

- **`tests/monthly-report.test.ts`,** con citas de prueba de un mes y el momento como parámetro:
  - **Cada cifra,** contada a mano: citas sin canceladas, online, recordatorios, confirmaciones, cancelaciones con
    tiempo, pacientes nuevos (sin importados), comprobantes, ingresos y la comparación.
  - **El mes en la hora del negocio:** una cita del último día del mes a las 20:00 de Ecuador cuenta en ese mes.
  - **Las líneas en 0 no salen;** sin comparación si el mes anterior no tuvo citas.
  - **Cuándo sale:** nada el día 1 a las 7:59; sale a las 8:00; una sola vez aunque pase el cron varias veces y los
    días siguientes; el día 3 si no salió antes; nada desde el día 8.
  - **Lo que no recibe informe:** un negocio suspendido, sin propietario, sin citas en el mes o con el informe
    apagado.
  - **El contenido:** el asunto con el mes, el botón a Reportes, el enlace de referidos, y ningún nombre, email o
    teléfono de pacientes, ni planes ni precios.
  - **El interruptor:** encendido por defecto (también sin el campo guardado); el propietario lo apaga y queda en la
    actividad; si lo manda un administrador o el super admin en modo soporte, se ignora.
  - **El cupo:** el tipo `monthly_report` es del nivel «negocio».
- **Backend:** `typecheck` y `npm test`.
- **Front:** build, lint, `check:contrast` y `check:data-export`.
- **El interruptor en pantalla,** a 1440 px en claro y a 390 px en oscuro: lo ve el propietario y no un
  administrador.
- **La prueba real:** un informe de verdad al buzón de pruebas, con la base de prueba y la cuenta de Gmail. Se
  comprueba que se lee bien en el celular y que el botón abre Reportes.

## Riesgos

- **El primer día 1 después de publicar,** salen de golpe los informes de todos los negocios con citas. Son pocos
  para el cupo de Gmail y van en el nivel más bajo: si no caben, esperan.
- **Un negocio que no quiere el informe** lo recibe la primera vez, hasta que lo apague. El email dice dónde
  apagarlo.
- **La zona horaria:** el mes y las 8:00 son los de cada negocio. Un negocio con la zona mal puesta recibe el
  informe con su hora, igual que sus recordatorios.
