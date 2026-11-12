# Especificación: Lo que debe cada paciente

**Carpeta**: `specs/046-por-cobrar` (rama de trabajo: `dev`) · **Creada**: 2026-11-12

**Estado**: Implementada (2026-11-12). Aprobada el 2026-11-12, «apruebo con las recomendaciones»

**Repos**:
- **agenda-backend:** la cuenta de lo que debe cada paciente y la acción de marcar varias citas como pagadas.
- **agenda-front:** la ficha del paciente, la lista de pacientes, Inicio, Reportes y el WhatsApp.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-12, después de ver las mejoras que Claude propuso dentro de la app:

> me gust la 1, 2, 5 hagamos esos 3 cambios

Esta es la 1. La 2 (la lista de espera) es la spec 047 y la 5 (la encuesta después de la cita), la 048.

**Lo que ya existe:**
- **Cada cita tiene su precio y la marca de pagada.** «Marcar como pagada» está en la ficha de la cita.
- **El tablero** (spec 034) tiene las columnas «Atendidas» (completadas sin pagar) y «Pagadas».
- **El paciente puede subir el comprobante** de la transferencia y la cita sale con «Comprobante recibido» hasta
  que el negocio la marca como pagada.
- **La ficha del paciente** cuenta sus citas, las atendidas, las canceladas, las inasistencias y la suma de las
  atendidas.
- **En Reportes,** la cifra «Cobrado en citas completadas» es en realidad la suma del precio de las citas
  atendidas, estén pagadas o no.

**Lo que falta:** saber cuánto debe cada paciente, ver en un solo lugar a quién hay que cobrarle y marcarlo como
pagado de una vez. Hoy hay que abrir cita por cita.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver y cobrar lo que debe un paciente (Prioridad: P1)

**Por qué esta prioridad:** es lo que se pidió. El profesional deja de llevar la cuenta en un cuaderno.

**Prueba independiente:** un paciente con dos sesiones atendidas sin pagar muestra «Por cobrar: 2 sesiones» y el
total. Al marcar las dos como pagadas, el bloque desaparece.

1. **Dado** un paciente con sesiones atendidas sin pagar, **cuando** se abre su ficha, **entonces** sale el bloque
   **«Por cobrar»** con:
   - el total y cuántas sesiones son;
   - la lista de esas sesiones, de la más antigua a la más reciente: fecha, servicio, profesional y precio;
   - «Marcar como pagada» en cada una.
2. **Dado** ese bloque, **cuando** se toca **«Marcar todas como pagadas»**, **entonces**:
   - se pide confirmar, con el total y cuántas sesiones son;
   - todas quedan pagadas a la vez y el bloque desaparece;
   - cada cita queda en la actividad como pagada, igual que al marcarla en su ficha.
3. **Dado** una sesión con el comprobante recibido y sin marcar como pagada, **entonces** sigue en la lista con la
   marca **«Comprobante por revisar»** y deja ver el comprobante.
4. **Dado** un paciente sin nada por cobrar, **entonces** su ficha no muestra el bloque.

### Historia 2 - Ver a quién hay que cobrarle (Prioridad: P1)

**Por qué esta prioridad:** sin una lista, hay que revisar paciente por paciente.

**Prueba independiente:** con tres pacientes que deben, el filtro «Con pagos pendientes» muestra a los tres, del que
más debe al que menos, y la tarjeta de Inicio suma lo de los tres.

1. **Dado** la lista de pacientes, **entonces** cada paciente que debe muestra el monto por cobrar.
2. **Dado** la lista, **cuando** se elige el filtro **«Con pagos pendientes»**, **entonces** salen sólo los que
   deben, del que más debe al que menos.
3. **Dado** Inicio, **entonces** sale la tarjeta **«Por cobrar»** con el total y cuántos pacientes deben. Al tocarla
   se abre la lista con ese filtro. Si nadie debe, la tarjeta no sale.
4. **Dado** el rol Profesional, **entonces** ve sólo lo de su agenda: en la ficha, en la lista y en Inicio
   (respuesta 2).

### Historia 3 - Recordar el pago por WhatsApp (Prioridad: P2)

**Por qué esta prioridad:** cobrar es lo que sigue a ver lo que se debe, y en Ecuador se cobra por WhatsApp.

**Prueba independiente:** desde la ficha de un paciente que debe dos sesiones se abre WhatsApp con un mensaje ya
escrito que nombra las dos sesiones, el total y las cuentas.

1. **Dado** el bloque «Por cobrar» de un paciente con teléfono, **cuando** se toca **«Recordar el pago por
   WhatsApp»**, **entonces** se abre WhatsApp con el paciente y un mensaje amable ya escrito, con:
   - las sesiones (fecha y servicio);
   - el total;
   - las cuentas de la agenda, si las tiene.

   El mensaje es un recordatorio, nunca una «deuda».
2. **Dado** un paciente sin teléfono, **entonces** no sale el botón.
3. **Dado** el recordatorio, **entonces** no se envía ningún email ni nada automático: el profesional decide cuándo
   escribir.

### Historia 4 - Reportes sin confusión (Prioridad: P3)

**Por qué esta prioridad:** hoy Reportes dice «Cobrado» a lo atendido, pagado o no. Con «Por cobrar» al lado, la
misma sesión saldría como cobrada y por cobrar a la vez.

**Prueba independiente:** con una sesión atendida sin pagar, Reportes la cuenta en «Ingresos de citas atendidas» y en
«Por cobrar», y en ningún lado dice «Cobrado».

1. **Dado** Reportes, **entonces** la cifra que hoy dice «Cobrado en citas completadas» (y «Cobrado» en la tabla de
   profesionales y en la de pacientes) pasa a decir **«Ingresos de citas atendidas»**, y al lado sale **«Por
   cobrar»** con lo que todavía no se marca como pagado (respuesta 3).
2. **Dado** la versión para imprimir de Reportes, **entonces** usa los mismos nombres.
3. **Dado** el informe mensual por email (spec 040), **entonces** no cambia: ya habla de «ingresos estimados».

### Casos límite

- **Cita en pareja o en familia:** cuenta sólo para el paciente principal, el que paga, como hoy.
- **Cita gratis** (precio 0): no cuenta.
- **Cancelada, «No asistió», pendiente o confirmada:** no cuenta. Sólo lo atendido.
- **Una cita pagada por adelantado y atendida después:** ya está pagada, no cuenta.
- **Desmarcar el pago** de una cita atendida: vuelve a contar, como hoy vuelve a «Atendidas» en el tablero.
- **Citas atendidas antes de la fecha en que empieza a contar** (respuesta 1): no salen en el bloque ni en las
  cifras, aunque no estén marcadas como pagadas. Siguen en el tablero y en la ficha de la cita como hoy.
- **Paciente «Por verificar»:** lo suyo cuenta en esa ficha aparte hasta que el negocio la une a la ficha del
  paciente; entonces pasa a la ficha unida.
- **Varias agendas:** el propietario, los administradores y Recepción ven el total del paciente con todas las
  agendas; cada sesión dice de qué profesional es.
- **Modo soporte:** el super admin lo ve como el propietario.
- **Muchos pacientes:** la lista y la tarjeta de Inicio se cargan igual de rápido que hoy.

## Requisitos *(obligatorio)*

- **RF-001**: Una cita DEBE contar como «por cobrar» si está Completada, tiene precio mayor que 0, no está marcada como pagada y se atendió desde la fecha en que empieza a contar (respuesta 1). Cuenta para el paciente principal.
- **RF-002**: La ficha del paciente DEBE mostrar el bloque «Por cobrar» con el total, el número de sesiones y la lista (fecha, servicio, profesional y precio), con «Marcar como pagada» en cada sesión y la marca «Comprobante por revisar» en las que tienen comprobante.
- **RF-003**: El bloque DEBE permitir «Marcar todas como pagadas», con confirmación, y cada cita marcada DEBE quedar en la actividad como al marcarla sola.
- **RF-004**: La lista de pacientes DEBE mostrar el monto por cobrar de cada uno y tener el filtro «Con pagos pendientes», ordenado del que más debe al que menos.
- **RF-005**: Inicio DEBE mostrar la tarjeta «Por cobrar» con el total y el número de pacientes, que abre la lista filtrada, y no mostrarla si nadie debe.
- **RF-006**: Lo ven y lo marcan quienes hoy manejan las citas; el rol Profesional, sólo lo de su agenda (respuesta 2). La API DEBE aplicar la misma regla.
- **RF-007**: El bloque DEBE ofrecer «Recordar el pago por WhatsApp» si el paciente tiene teléfono, con un mensaje amable ya escrito que lleva las sesiones, el total y las cuentas de la agenda si las tiene, sin la palabra «deuda». No DEBE enviarse nada automático.
- **RF-008**: Reportes DEBE llamar «Ingresos de citas atendidas» a la cifra que hoy dice «Cobrado» y mostrar al lado «Por cobrar» (respuesta 3), también en la versión para imprimir.
- **RF-009**: Lo demás DEBE seguir igual: el tablero, la ficha de la cita, los comprobantes, los recordatorios del comprobante (spec 039), el informe mensual y la exportación de datos.
- **RF-010**: La constitución DEBE recoger la decisión (1.45.0, en los dos repos).

### Entidades

- **Sesión por cobrar:** no es un dato nuevo, se deduce de la cita (estado, precio, marca de pagada, fecha y
  paciente principal).
- **Lo que debe un paciente:** la suma de sus sesiones por cobrar y cuántas son.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - qué cuenta y qué no (completadas sin pagar, gratis, canceladas, «No asistió», futuras, pagadas por adelantado,
    anteriores a la fecha en que empieza a contar);
  - el paciente principal en las citas en pareja;
  - «Marcar todas como pagadas», con una entrada en la actividad por cita;
  - el rol Profesional, sólo su agenda, y la API rechaza lo de otra agenda;
  - que nada cambia en el tablero ni en la exportación.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y todas las `check:*` en el front, sin errores
  (también en GitHub, en «Comprobar»).
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px, sin desplazamiento horizontal):
  - la ficha con el bloque, marcar una y marcar todas;
  - el filtro de la lista y la tarjeta de Inicio;
  - el WhatsApp con las sesiones y el total;
  - Reportes con los nombres nuevos.
- **CE-004**: Desde la ficha de un paciente que debe, cobrarle todo y marcarlo como pagado toma menos de 30 segundos,
  sin abrir ninguna cita.

## Supuestos

- **Sin migración:** se calcula con las citas que ya existen.
- **El monto es el precio de cada cita,** el que tenía al agendarse. Si el servicio cambió de precio después, no
  importa.
- **No hay pagos parciales ni saldos a favor:** una sesión está pagada o no, como hoy.
- **La moneda es la del negocio,** como en Reportes.
- **No se envían emails ni avisos automáticos de cobro.** El recordatorio del comprobante antes de la cita (spec 039)
  sigue igual.

## Respuestas del dueño del producto (2026-11-12)

«apruebo con las recomendaciones»:
1. **Qué sesiones cuentan:** las atendidas desde el día en que se publica la función.
2. **Quién lo ve:** todo el que ya maneja las citas. El propietario, los administradores y Recepción ven todo el
   negocio; el rol Profesional, sólo lo de su agenda.
3. **Reportes:** «Cobrado» pasa a «Ingresos de citas atendidas» y al lado sale «Por cobrar».
