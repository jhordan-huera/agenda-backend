# Especificación: Los costos de AWS en /admin

**Carpeta**: `specs/031-costos-aws` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Descartada (2026-10-22)

> **Descartada antes de publicarse.** El dueño del producto, el mismo día, al saber que la consulta diaria
> gastaría unos $0,30 al mes de sus créditos de AWS: «no lo implementemos, porque luego se acaban los
> créditos; dame quitando». Se quitó el código de los dos repos. La migración 051 ya estaba aplicada en
> producción, así que la 052 borra lo que creó. Para ver los costos se usa la consola de AWS y su
> presupuesto de $1.

**Repos**:
- **agenda-backend:** la consulta diaria de los costos, guardarlos, el aviso y lo que lee el super admin. Lleva migración.
- **agenda-front:** la página «Costos», la tarjeta del Inicio de /admin y el monto del aviso.
- **La beta:** no lo lleva, porque no tiene AWS.

## Pedido

El dueño del producto, el 2026-10-22, después de preguntar cómo ver en AWS lo que cuesta el backend:

> «esta parte de costos ¿podrías implementarla en la parte de administrador, donde yo pueda ver el costo
> del backend directamente, sin la necesidad de ingresar a AWS?»

El backend corre en AWS Lambda desde el 2026-10-19.

**Sus decisiones (2026-10-22):**
1. **Qué ver:**
   - lo gastado en el mes hasta hoy;
   - la previsión para fin de mes;
   - el desglose por servicio: Lambda, registros, transferencia de datos…

   No pidió el historial de meses anteriores ni el nivel gratuito o los créditos.
2. **Dónde:**
   - una página nueva, **«Costos»**, en el menú de /admin, con el detalle;
   - en el **Inicio** de /admin, sólo el total del mes.
3. **Cuándo se actualiza:** sola, **una vez al día**, sin botón.

   AWS cobra $0,01 por cada consulta de costos y sólo actualiza esos datos unas tres veces al día.
4. **Aviso:** cuando el gasto del mes pase de un monto que el super admin pone en /admin, le llega un aviso **por ntfy y por email**, una vez al mes.
5. **Los créditos (ampliación, el mismo día):** «estoy consumiendo los créditos que da AWS por cuenta
   nueva, ¿me das viendo eso?». Su cuenta está en el **plan de pago**, así que no la cierran a los 6
   meses. Tiene **$140 de créditos**, todos hasta el 08/10/2027:
   - $100, del nivel gratuito;
   - $20, por crear un presupuesto;
   - $20, por crear una app con Lambda.

   Hasta el 22/10 lleva **$0 usados**: Lambda está dentro de lo que AWS da gratis cada mes. Ya tiene en
   AWS un presupuesto que le avisa si pasa de $1. La página muestra también los créditos (Historia 3),
   sin avisos propios de créditos: con el plan de pago no hay cierre de la cuenta, y lo que importa es
   el aviso de gasto.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El super admin ve lo que cuesta el backend (Prioridad: P1)

**Prueba independiente**: con costos ya guardados de este mes, el super admin abre /admin → Costos y ve
el total, la previsión y el desglose sin entrar a AWS.

**Escenarios de aceptación**:

1. **Dado** /admin → Costos, **entonces** se ve:
   - **lo gastado este mes** hasta hoy, en dólares, como cifra principal;
   - **la previsión para fin de mes:** lo gastado al ritmo que lleva el mes;
   - **el desglose por servicio,** de mayor a menor, con lo que cuesta cada uno. Los que van en $0,00 no
     se listan uno por uno;
   - **cuándo se actualizó,** con la nota de que AWS tarda hasta un día en reflejar el uso.
2. **Dado** el Inicio de /admin, **entonces** una tarjeta muestra el total del mes y lleva a «Costos».
3. **Dado** un día nuevo, **entonces** los costos se actualizan solos una vez, aunque nadie abra la página.
4. **Dado** que el super admin abre la página varias veces el mismo día, **entonces** no se hace ninguna
   consulta nueva a AWS: se muestra lo guardado.

### Historia 2 - El aviso cuando el gasto pasa de un monto (Prioridad: P2)

**Prueba independiente**: con un monto de aviso de $1 y un gasto guardado de $1,20, la siguiente
actualización diaria manda un ntfy y un email, y no los repite al día siguiente.

**Escenarios de aceptación**:

1. **Dado** /admin → Costos, **entonces** el super admin escribe el **monto del aviso** en dólares, o lo
   deja vacío para no recibir avisos. El cambio queda en la actividad.
2. **Dado** que lo gastado en el mes pasa del monto, **entonces** en la actualización de ese día llega:
   - **un ntfy**, con lo gastado, el monto y la previsión;
   - **un email al super admin principal**, con lo mismo y el enlace a «Costos».
3. **Dado** que ya llegó el aviso este mes, **entonces** no se repite, salvo que el super admin cambie el
   monto y el gasto pase el nuevo.
4. **Dado** un mes nuevo, **entonces** el aviso vuelve a estar disponible.
5. **Dado** que la previsión pasa del monto pero lo gastado todavía no, **entonces** la página lo señala
   («a este ritmo pasarás tu monto»), sin enviar aviso.

### Historia 3 - Los créditos de AWS (Prioridad: P2)

**Prueba independiente**: con $140 de créditos guardados y $0,30 gastados en el mes, la página muestra
los créditos que quedan, lo que cubrieron este mes y lo que se paga de verdad.

**Escenarios de aceptación**:

1. **Dado** /admin → Costos, **entonces** una sección del plan de AWS muestra:
   - **el plan:** de pago o gratuito;
   - **los créditos que quedan,** en dólares, y hasta cuándo valen, si AWS lo informa;
   - **cuánto de lo gastado este mes cubren los créditos y cuánto se paga de verdad.** Con créditos,
     normalmente $0,00.
2. **Dado** el Inicio de /admin, **entonces** la tarjeta suma los créditos que quedan.
3. **Dado** que la cuenta pasara al plan gratuito, **entonces** la sección muestra además cuándo vence
   y avisa en la página de que ese día AWS cierra la cuenta si no se pasa al de pago. No hay avisos por
   ntfy ni email de créditos.
4. **Dado** que AWS no informa los créditos que quedan, **entonces** la sección dice «Míralos en la
   consola de AWS → Créditos», y muestra igual lo que cubrieron este mes.

### Casos límite

- **Sin datos todavía** (en local, antes de la primera actualización o sin el permiso en AWS): la página
  dice que aún no hay costos y por qué, sin cifras en cero que confundan. La tarjeta del Inicio, lo mismo.
- **Si AWS falla:** por permiso, por no tener Cost Explorer activado o por error de red.
  - La página muestra lo último guardado con su fecha y un aviso «No se pudo actualizar», con el motivo
    en palabras sencillas.
  - El resto del trabajo diario (recordatorios, emails, limpieza) sigue igual.
- **Montos muy chicos:** lo que no llega a un centavo se muestra «menos de $0,01», no «$0,00».
- **Cambio de mes:** el mes es el de la facturación de AWS, que corta a medianoche UTC, a las 19:00 de
  Ecuador. La página dice qué mes muestra.
- **El primer día del mes:** la previsión necesita al menos un día. Si no lo hay, la página dice
  «todavía sin previsión».
- **Los registros del trabajo diario son públicos** (GitHub): no muestran montos, sólo si la
  actualización salió bien.

## Requisitos *(obligatorio)*

- **RF-001**: Una vez al día, el sistema DEBE obtener de AWS lo gastado en el mes hasta hoy y su desglose por servicio, y guardarlo. No consulta más de una vez por día.
- **RF-002**: La consulta diaria DEBE hacerse aunque nadie abra la página, y DEBE fallar sin afectar al resto del trabajo diario.
- **RF-003**: /admin → Costos DEBE mostrar:
  - lo gastado en el mes;
  - la previsión para fin de mes, calculada por la app;
  - el desglose por servicio;
  - la fecha de la última actualización;
  - el mes que muestra.
- **RF-004**: El Inicio de /admin DEBE mostrar el total del mes con un enlace a «Costos».
- **RF-005**: Sólo el super admin DEBE poder ver los costos y cambiar el monto del aviso. Los negocios nunca, y tampoco el modo soporte dentro de un negocio.
- **RF-006**: El super admin DEBE poder poner, cambiar o quitar el monto del aviso. Cada cambio va a la actividad. Leer los costos no.
- **RF-007**: Cuando lo gastado en el mes pase del monto, DEBE llegar un aviso por ntfy y por email al super admin principal, una sola vez por mes y por monto.
- **RF-008**: Sin datos o con la última actualización fallida, la página y la tarjeta DEBEN decirlo con claridad y mostrar lo último guardado, si existe.
- **RF-009**: Los registros públicos del trabajo diario NO DEBEN mostrar montos.
- **RF-010**: Una vez al día, junto con los costos, el sistema DEBE obtener de AWS:
  - el plan de la cuenta (de pago o gratuito);
  - los créditos que quedan y su vencimiento, si AWS los informa;
  - cuánto de lo gastado en el mes cubren los créditos.
- **RF-011**: /admin → Costos DEBE mostrar el plan, los créditos que quedan (o dónde verlos si AWS no los informa), lo que cubrieron este mes y lo que se paga de verdad. En el plan gratuito, además, cuándo vence y qué hacer antes.

### Entidades clave

- **Costos del mes:** el mes de facturación, lo gastado hasta el momento, el desglose por servicio
  (nombre y monto), la moneda, cuándo se obtuvo y el resultado de la última actualización (bien, o el
  motivo del fallo).
- **Monto del aviso:** el monto en dólares (vacío = sin aviso) y para qué mes y monto ya se avisó.
- **Plan de AWS:** de pago o gratuito, los créditos que quedan y su vencimiento (si AWS los informa) y
  cuánto cubrieron en el mes.

## Criterios de éxito *(obligatorio)*

- **CE-001**: El super admin ve lo que cuesta el backend este mes sin entrar a AWS, en menos de 10 segundos desde que abre /admin.
- **CE-002**: Las cifras de «Costos» coinciden, al centavo, con la factura del mes en la consola de AWS del mismo día. Se comprueba una vez publicado.
- **CE-003**: Las consultas a AWS no pasan de una por día, unos $0,30 al mes, aunque la página se abra muchas veces.
- **CE-004**: El aviso llega una sola vez por mes y monto cuando se pasa, y nunca si no se pasa. Se comprueba con pruebas automáticas.
- **CE-005**: Se ve bien en el computador y en el celular (390 px), en claro y oscuro, sin desplazamiento horizontal.
- **CE-006**: Los créditos que quedan coinciden con los de la consola de AWS → Créditos del mismo día. Hoy son $140.

## Supuestos

- **Los pasos en AWS los hace el dueño del producto una sola vez,** con instrucciones paso a paso, como con las migraciones:
  - activar Cost Explorer (los datos tardan hasta un día en aparecer la primera vez);
  - dar el permiso de **sólo leer costos y el estado del plan gratuito**.

  Hasta entonces la página dice que aún no hay datos.
- **Consultar los costos es un servicio de pago** (constitución, principio VI). El dueño del producto lo aprobó el 2026-10-22, sabiendo que cuesta $0,01 por consulta.
- **Lo gastado** es el costo de uso. Aparte se muestra cuánto cubren los créditos y lo que se paga de verdad (ampliación del 2026-10-22: primero no quería ver los créditos, después los pidió).
- **La cuenta ya está en el plan de pago** (captura del dueño del producto, 2026-10-22). La app nunca cambia el plan ni nada en AWS: sólo lee.
- **Sólo se cuenta la cuenta de AWS del backend.** Vercel y Supabase no se incluyen: hoy son gratis.
- **Se guarda el último dato de cada mes.** No hay historial ni gráfico de meses anteriores, por decisión del dueño del producto. Se podría añadir más adelante con lo guardado.
- **La beta no lo lleva:** no tiene AWS.
