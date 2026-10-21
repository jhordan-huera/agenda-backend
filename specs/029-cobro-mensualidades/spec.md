# Especificación: El cobro de las mensualidades por transferencia

**Carpeta**: `specs/029-cobro-mensualidades` (rama de trabajo: `dev`) · **Creada**: 2026-10-20

**Estado**: Implementada (2026-10-21)

**Repos**:
- **agenda-backend:** los cobros de cada mes, el comprobante, la revisión, los avisos y la migración.
- **agenda-front:** la pantalla del propietario y la de cobros en /admin.
- **La beta:** preguntar al aprobar (ver los supuestos).

## Pedido

El dueño del producto, el 2026-10-20, después de repasar las opciones de cobro en Ecuador (Stripe no
acepta empresas ecuatorianas; Kushki y PayPhone piden contrato o cobran por retirar), eligió la
transferencia:

> «cuando se cumpla el mes y el propietario inicie sesión, se le abra una pantalla, se le suba el
> comprobante y éste pase a un estado de revisión; le deja usar el sistema, pero el super admin debe
> comprobar que la transferencia se haya hecho y el estado pasa a pagado».

**Decisiones del dueño del producto (2026-10-20):**
1. **Si no sube el comprobante:** la pantalla es **obligatoria desde el día de pago**, sin «Más tarde»
   ni días de gracia. Mientras haya un cobro sin comprobante (por pagar o rechazado), se abre al entrar
   y no se cierra hasta subirlo: sólo queda «Cerrar sesión». Le dice claro que tiene que subirlo para
   seguir usando el panel. Su equipo y su página de reservas siguen funcionando.

   **Cambió el 2026-10-20**, después de aprobar la spec. Antes eran 5 días de gracia con «Más tarde»,
   y desde el día 6 la pantalla ya no se cerraba. **Los 5 días quedan sólo para el super admin:** en
   /admin → Cobros, un cobro por pagar sale en «Por pagar» los primeros 5 días desde su día de pago y en
   «Atrasados» desde ahí, y el Inicio de /admin cuenta los atrasados. Son también la ventana en que se
   crea el cobro del mes.
2. **El día de pago** es el día del mes en que empezó su plan de pago (por ejemplo el 14). El super
   admin lo puede cambiar.
3. **Si la transferencia no llegó o el monto no cuadra,** el super admin la **rechaza con un motivo**.
   Al propietario le llega un email, y al entrar se le vuelve a abrir la pantalla, que no se cierra
   hasta subir otro comprobante.
4. **El propietario ve su mensualidad:** su monto y su fecha, nunca la lista de planes ni los precios.
   Cambia la decisión vigente de que «los negocios no ven planes ni precios».

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El super admin fija la mensualidad de cada negocio (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la ficha de un negocio en /admin, **entonces** la tarjeta de la suscripción tiene:
   - la **mensualidad** en dólares;
   - el **día de pago**, que se propone con el día de hoy al poner la primera mensualidad;
   - la **fecha del primer cobro**.

   Si la mensualidad es 0, como en el plan gratis o en un negocio de cortesía, no hay cobros.
2. **Dado** /admin → Configuración, **entonces** el super admin escribe **sus cuentas para recibir
   las transferencias:** banco, tipo, número, titular y cédula o RUC. Las ven los propietarios en la
   pantalla de pago.
3. **Dado** cualquiera de estos cambios, **entonces** queda en la actividad.

### Historia 2 - El propietario paga por transferencia (Prioridad: P1)

**Prueba independiente**: un negocio con mensualidad llega a su día de pago; el propietario entra,
sube el comprobante y sigue usando el sistema.

**Escenarios de aceptación**:

1. **Dado** tres días antes del día de pago, **entonces** al propietario le llega un email «Tu
   mensualidad de Agenda360 vence el 14 de noviembre», con el monto y las cuentas.
2. **Dado** el día de pago, **cuando** el propietario entra al panel, **entonces** se abre la pantalla
   **«Tu mensualidad de noviembre»** con:
   - el monto, y el descuento de referidos si lo hay («$9,99 − $1,50 por 1 recomendación = $8,49»);
   - las cuentas para transferir;
   - **«Subir comprobante»** (foto o PDF);
   - el aviso de que **es obligatorio:** «Para seguir usando el panel, tienes que subir el comprobante
     de tu transferencia. Tu equipo y tu página de reservas siguen funcionando.»

   No tiene «Más tarde»: sólo «Cerrar sesión».
3. **Dado** que sube el comprobante, **entonces** el cobro pasa a **«En revisión»**, la pantalla se
   cierra y puede usar el sistema con normalidad. Al super admin le llega un aviso por ntfy y en su
   campana.
4. **Dado** que no sube el comprobante, **entonces** no usa el panel: la pantalla no se cierra, tampoco
   al ir a otra página ni al volver a entrar. Su equipo y su página de reservas siguen funcionando.
5. **Dado** que pasan 5 días desde el día de pago sin comprobante, **entonces** para el propietario
   nada cambia (la pantalla ya era obligatoria). Sólo en /admin → Cobros el cobro pasa de «Por pagar» a
   «Atrasados».
6. **Dado** Configuración → Negocio, **entonces** el propietario ve su **mensualidad**: el monto, el
   próximo día de pago y el historial de sus pagos con su estado («Pagado», «En revisión»,
   «Rechazado»).

### Historia 3 - El super admin revisa y confirma (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** /admin → **Cobros**, **entonces** el super admin ve los cobros del mes filtrados por
   estado: **En revisión**, **Por pagar** (menos de 5 días desde el día de pago), **Atrasados** (5 o
   más), **Pagados** y **Rechazados**. En cada uno ve el negocio, el periodo, el monto y la fecha.
2. **Dado** un cobro en revisión, **entonces** abre el comprobante y lo marca:
   - **«Pagado»:** el estado cambia, al propietario le llega «Recibimos tu pago, gracias», y los
     descuentos de referidos usados quedan aplicados;
   - **«Rechazar»,** con un motivo («No llegó la transferencia», «El monto no coincide»…): al
     propietario le llega un email con el motivo y, al entrar, se le vuelve a abrir la pantalla.
3. **Dado** un pago que llegó por otra vía, como efectivo, **entonces** el super admin lo puede marcar
   «Pagado» sin comprobante.
4. **Dado** el Inicio de /admin, **entonces** muestra cuántos cobros hay en revisión y cuántos
   atrasados.
5. **Dado** cualquier cambio de estado, **entonces** queda en la actividad, con quién lo hizo.

### Casos límite

- **El día de pago no existe en el mes,** como el 31 en noviembre: cae el último día del mes.
- **Un negocio que pasa a mensualidad 0 o al plan gratis:** los cobros siguientes no se crean. Los
  pendientes se pueden anular desde /admin, con motivo.
- **Un negocio suspendido** no genera cobros mientras lo está.
- **Cambia la mensualidad a mitad de mes:** vale desde el siguiente cobro.
- **El modo soporte** no ve la pantalla de pago: es del propietario.
- **Un negocio sin propietario** no genera cobros hasta que lo tenga.
- **Varios meses sin pagar:** cada mes es un cobro aparte, y la pantalla muestra el más antiguo
  pendiente.
- **El comprobante:** foto o PDF de hasta 10 MB. Se guarda privado y sólo lo ven el super admin y el
  propietario.
- **A 390 px y en los dos modos.**

## Requisitos *(obligatorio)*

- **RF-001**: Cada negocio DEBE tener una mensualidad y un día de pago, que fija el super admin. Con 0
  no hay cobros.
- **RF-002**: El sistema DEBE crear el cobro de cada mes en su día de pago, con el monto menos los
  descuentos de referidos ganados y sin aplicar.
- **RF-003**: Al entrar, el propietario DEBE ver la pantalla de pago desde el día de pago, sin «Más
  tarde» ni días de gracia: no se cierra hasta subir el comprobante (2026-10-20).

  Su equipo y su página de reservas NO DEBEN bloquearse. Los 5 días son sólo del super admin: un cobro
  por pagar sale en «Atrasados» de /admin a los 5 días de su día de pago.
- **RF-004**: Al subir el comprobante, el cobro DEBE pasar a «En revisión» y el propietario DEBE poder
  usar el sistema.
- **RF-005**: El super admin DEBE poder revisar, marcar «Pagado» o «Rechazar» con motivo, y marcar
  «Pagado» sin comprobante. Cada cambio DEBE avisar al propietario por email.
- **RF-006**: DEBE haber avisos:
  - el email tres días antes;
  - ntfy y la campana del super admin al llegar un comprobante;
  - las cifras en el Inicio de /admin.
- **RF-007**: El propietario DEBE ver su mensualidad y su historial. Nunca la lista de planes ni los
  precios de otros.
- **RF-008**: Todo cambio DEBE ir a la actividad, y los comprobantes DEBEN ser privados.

## Criterios de éxito *(obligatorio)*

- **CE-001**: El día de pago, el propietario sube su comprobante en menos de un minuto desde que
  entra.
- **CE-002**: El super admin ve en una sola pantalla quién pagó, quién está en revisión y quién está
  atrasado, y confirma un pago en dos toques.
- **CE-003**: Desde el día de pago sin comprobante, el panel del propietario queda bloqueado en la
  pantalla de pago, y su página de reservas sigue recibiendo citas. Lo comprueban las pruebas.
- **CE-004**: Las pruebas pasan y la pantalla se ve bien en los dos modos y a 390 px.

## Supuestos

- **La factura electrónica del SRI** queda fuera: la emite el dueño del producto con su contador. Se
  podría conectar más adelante.
- **El cobro con tarjeta** (Kushki o PayPhone) queda para más adelante.
- **El comprobante se guarda un año** (contabilidad) y después se borra solo.
- **El descuento de referidos** se aplica solo en el siguiente cobro, y deja de ser algo que el super
  admin marca a mano.
- **La constitución cambia:** el propietario ve su mensualidad y su estado de pago. Siguen sin verse
  los planes ni los precios.
- **La beta:** lleva la pantalla con datos de prueba, para las presentaciones (valor por defecto, aprobado
  con la spec el 2026-10-20). Va en una fase propia al final.

## Ampliación: los precios automáticos (2026-10-20)

El dueño del producto, el mismo día: «el plan Pro y Business son de 14,99 y 29,99, entonces todo esto
debe salir automático en los sistemas, y con la campaña de referidos automáticamente se le resta 1,50».

**Sus decisiones (2026-10-20):**
1. **Los precios de los planes,** editables en /admin → Planes:
   - Free, $0 (sin cobros);
   - **Pro, $14,99**;
   - **Business, $29,99 con 3 agendas incluidas y $8 por cada agenda más.** Las agendas que se cuentan
     son las «Agendas contratadas» de su ficha; sin tope, las agendas activas.
2. **Precio especial opcional:** en la ficha del negocio se puede poner otro monto (0 = cortesía, sin
   cobros). Si se quita, vuelve al precio de su plan.
3. **Los negocios que ya existen** con Pro o Business toman su precio y su día de pago (el día en que
   empezó su plan) al publicarse. Su primer cobro es su próximo día de pago, nunca uno ya pasado, con el
   email de aviso tres días antes.

### Historia 5 - La mensualidad se calcula sola (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** un negocio con Pro o Business sin precio especial, **entonces** su mensualidad es la de su
   plan. En Business se suman $8 por cada agenda sobre las 3 incluidas: con 5, $45,99.
2. **Dado** un negocio de pago sin día de pago, porque es nuevo, cambió desde Free o existía antes,
   **entonces** el sistema le pone el día en que empezó su plan y su primer cobro un mes después, o su
   próximo día de pago si ése ya pasó.
3. **Dado** un cambio de plan o de agendas, **entonces** el precio nuevo vale desde el siguiente cobro:
   los ya creados no cambian.
   - Al pasar a Free, no hay más cobros.
   - Al volver de Free a un plan de pago, el día de pago se calcula de nuevo desde ese cambio.
4. **Dado** un precio especial, **entonces** vale ése, y la ficha lo dice («Precio especial: $20,00»).
   Sin él, dice el del plan («Mensualidad: $45,99, Business con 5 agendas»).
5. **Dado** /admin → Planes, **entonces** el super admin cambia los precios, y valen desde el siguiente
   cobro de cada negocio. Queda en la actividad.
6. **Dado** el cobro de cada mes, **entonces** al precio se le restan $1,50 por cada recomendación
   ganada, como antes.
7. **Dado** el propietario, **entonces** sigue viendo sólo su total y su descuento, nunca los precios de
   los planes.

- **RF-009**: Los precios de los planes DEBEN guardarse en el sistema, editables por el super admin y
  nunca públicos ni visibles para los negocios.
- **RF-010**: La mensualidad de cada negocio DEBE salir de su plan y sus agendas, salvo un precio
  especial. El día de pago y el primer cobro DEBEN ponerse solos desde el día en que empezó su plan.
