# Especificación: Informe mensual para el negocio

**Carpeta**: `specs/040-informe-mensual` (rama de trabajo: `dev`) · **Creada**: 2026-11-10

**Estado**: Publicada (2026-11-10, PR backend #70 y front #55). Aprobada el 2026-11-10, «lo acepto con todo lo recomendado»

**Repos**:
- **agenda-backend:** el cálculo del mes, el envío mensual en el cron, el ajuste del propietario y la plantilla del
  email (vive en el código compartido).
- **agenda-front:** el interruptor en Configuración → Notificaciones y la plantilla compartida.
- **La beta:** no lleva nada (no envía emails; respuesta 3).

## Pedido

El dueño del producto, el 2026-11-10: «has lo que me recomiendas: el informe mensual». La idea aprobada:

> Informe mensual «Lo que Agenda360 hizo por tu consultorio»: el día 1 de cada mes, el propietario recibe sus
> citas gestionadas, reservas online, recordatorios y confirmaciones del mes. Son cifras reales suyas, no
> inventadas. Ayuda a que se queden y a que lo cuenten.

La analítica del super admin (spec 016) ya lo había dejado pendiente: «mostrarle a cada negocio su "valor
generado" en su propio panel queda para otra spec».

**Para qué sirve:**
- **Retención:** el negocio ve cada mes lo que Agenda360 hace por él.
- **Captación:** el propietario tiene cifras reales suyas para contárselas a otros, con su enlace de
  recomendación.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El propietario recibe el resumen de su mes (Prioridad: P1)

**Por qué esta prioridad:** es el informe en sí; sin esto no hay función.

**Prueba independiente:** con un negocio que tuvo citas en octubre, la pasada del cron del 1 de noviembre envía
un email al propietario con las cifras de octubre, y ninguna pasada siguiente lo repite.

1. **Dado** un negocio activo con citas en el mes anterior, **cuando** llega el día 1 desde las 8:00 de la hora
   del negocio, **entonces** su propietario recibe un email con el asunto «Tu mes de octubre en Agenda360» (con
   el mes que corresponda) y estas cifras del mes anterior, del negocio entero:
   - **citas gestionadas** (sin las canceladas);
   - **reservas online**: cuántas de ellas llegaron por la página de reservas;
   - **recordatorios** enviados a los pacientes;
   - **confirmaciones** de los pacientes («Confirmo que voy», spec 010);
   - **cancelaciones con tiempo**: las que el paciente hizo desde «Tu cita» y liberaron la hora;
   - **pacientes nuevos**;
   - **comprobantes de pago** recibidos por el enlace de pago (spec 039), si el negocio cobra por
     transferencia;
   - los **ingresos estimados**: la suma del precio de las citas completadas, como en Reportes (respuesta 1);
   - la **comparación con el mes anterior**: cuántas citas más o menos, en %.
2. **Dado** una cifra en 0 porque el negocio no usa esa función (por ejemplo, sin página de reservas o sin
   cobro por transferencia), **entonces** esa línea no sale: el informe sólo muestra lo que el negocio usó.
3. **Dado** el mes anterior a ése sin citas, **entonces** la comparación no sale (no hay contra qué comparar).
4. **Dado** el email, **entonces** termina con:
   - un botón **«Ver mis reportes»** que lleva al panel (Reportes);
   - una línea para **recomendar Agenda360** con el enlace de su programa de referidos (spec 023), si el
     negocio lo tiene, sin descuentos ni precios.
5. **Dado** que el cron pasa cada 10 minutos o se reintenta, **entonces** el informe de un mes sale **una sola
   vez** por negocio y queda en su historial de emails, no en la actividad.

### Historia 2 - El propietario decide si lo recibe (Prioridad: P2)

**Por qué esta prioridad:** el informe es un email más; quien no lo quiera tiene que poder apagarlo.

**Prueba independiente:** el propietario lo apaga en Configuración → Notificaciones y el día 1 siguiente no le
llega; lo enciende y vuelve a llegar.

1. **Dado** un negocio nuevo o uno que ya existía, **entonces** el informe mensual está **encendido**.
2. **Dado** Configuración → Notificaciones, **cuando** el propietario apaga «Informe mensual», **entonces** no
   recibe más informes hasta que lo vuelva a encender, y el cambio queda en la actividad.
3. **Dado** el resto del equipo (administradores, recepción, profesionales), **entonces** no ven ni cambian
   este interruptor: el informe es sólo del propietario.

El informe va **sólo por email** (respuesta 2): en el panel ya están los Reportes.

### Casos límite

- **Un negocio sin ninguna cita en el mes:** no recibe informe (un email con todo en 0 no aporta).
- **Un negocio suspendido:** no recibe informe (2026-11-10: los suspendidos no salen en la analítica ni se les
  cobra).
- **Un negocio creado durante el mes:** sí lo recibe si tuvo citas.
- **Un negocio sin propietario:** no se envía a nadie.
- **Si el día 1 el cron no pudo pasar** (una caída de GitHub o de la base): el informe sale en la primera
  pasada siguiente, hasta el día 7 del mes; después ya no sale ese mes.
- **El cupo diario de Gmail** (spec 015): es un email del equipo, no de pacientes. Si un día no cabe, espera al
  día siguiente en la cola.
- **Negocios en otra zona horaria:** el mes y las 8:00 son los de la hora de cada negocio.
- **Sesiones en pareja o en familia** (spec 004 y 005): una cita con varios pacientes cuenta como una cita.
- **Citas que se repiten:** cada cita cuenta por separado.

## Requisitos *(obligatorio)*

- **RF-001**: El propietario de cada negocio activo, con citas en el mes anterior y con el informe encendido,
  DEBE recibir el día 1 desde las 8:00 de la hora del negocio un email con el resumen de ese mes.
- **RF-002**: El informe DEBE mostrar sólo cifras reales del negocio, contadas de sus datos del mes calendario
  anterior, en la hora del negocio: citas gestionadas, reservas online, recordatorios enviados, confirmaciones
  del paciente, cancelaciones con tiempo, pacientes nuevos, comprobantes de pago recibidos y la comparación de
  citas con el mes anterior. Las líneas en 0 de funciones que el negocio no usa NO DEBEN salir.
- **RF-003**: El informe NO DEBE llevar datos de pacientes (ni nombres ni contactos), ni planes, precios o topes
  de Agenda360, ni cifras estimadas o inventadas (como «tiempo ahorrado»), ni menciones a la LOPDP.
- **RF-004**: El informe DEBE terminar con el botón al panel (Reportes) y, si el negocio tiene enlace del
  programa de referidos, una línea para recomendar Agenda360 con ese enlace, sin descuentos ni precios.
- **RF-005**: Cada negocio DEBE recibir como mucho un informe por mes, aunque el cron pase varias veces o se
  reintente. Si no sale el día 1, DEBE salir en la primera pasada siguiente hasta el día 7.
- **RF-006**: El informe DEBE quedar en el historial de emails del negocio y NO en la actividad.
- **RF-007**: El propietario DEBE poder apagar y encender el informe en Configuración → Notificaciones
  (encendido por defecto, también en los negocios que ya existen). El cambio DEBE quedar en la actividad.
- **RF-008**: Los negocios suspendidos, sin propietario o sin citas en el mes NO DEBEN recibir el informe.
- **RF-009**: El informe DEBE prepararse y enviarse fuera de la API (en el cron de GitHub), sin gastar la CPU
  de Vercel.
- **RF-010**: El informe DEBE llevar los ingresos estimados del mes (la suma del precio de las citas completadas,
  como en Reportes, con la moneda del negocio). Si suman 0 (el negocio no pone precios), la línea NO DEBE salir.
- **RF-011**: El informe va sólo por email: ni el panel ni la beta cambian.
- **RF-012**: La constitución DEBE recoger la decisión: qué es el informe, quién lo recibe, qué lleva y qué no.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - cada cifra, contada a mano con citas de prueba de un mes, y el mes en la hora del negocio;
  - que las líneas en 0 de funciones sin usar no salen;
  - un solo informe por negocio y mes, con varias pasadas el mismo día y los días siguientes;
  - la pasada del día 2 al 7 si el día 1 no salió, y nada desde el día 8;
  - nada para un negocio suspendido, sin propietario, sin citas o con el informe apagado;
  - que el email no lleva datos de pacientes, ni planes ni precios;
  - el interruptor: sólo el propietario lo cambia y queda en la actividad.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint, `check:contrast` y `check:data-export` en el
  front, sin errores.
- **CE-003**: El interruptor funciona en el computador y en el celular (390 px), en claro y en oscuro.
- **CE-004**: Una prueba real: el informe llega al buzón de pruebas, se lee bien en el celular y el botón abre
  el panel.

## Supuestos

- **El envío lo hace el cron de GitHub,** que ya pasa cada 10 minutos. Un informe por negocio al mes es poco
  para el cupo de Gmail.
- **«Cancelaciones con tiempo»** son las que el paciente hace desde «Tu cita» con la antelación que permite el
  negocio, como en la analítica del super admin (spec 016).
- **Los recordatorios** que cuenta son los de las citas. Los del comprobante de pago (spec 039) no se suman ahí:
  lo que se cuenta del pago son los comprobantes recibidos.
- **No hace falta migración** si el interruptor vive con los demás ajustes de notificaciones del negocio. Si
  hace falta una para no repetir el informe, se dirá en el plan.
- **El super admin no configura nada.** Si es barato, la ficha del negocio en /admin dice cuándo salió el último
  informe.

## Respuestas del dueño del producto (2026-11-10)

1. **Los ingresos estimados del mes: sí.** Son datos del propio negocio, no precios de Agenda360.
2. **Sólo por email:** sin tarjeta en el panel.
3. **La beta no lleva nada.**
