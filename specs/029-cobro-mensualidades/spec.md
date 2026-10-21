# Especificación: El cobro de las mensualidades por transferencia

**Carpeta**: `specs/029-cobro-mensualidades` (rama de trabajo: `dev`) · **Creada**: 2026-10-20

**Estado**: Aprobada (2026-10-20)

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
1. **Si no sube el comprobante:** durante **5 días de gracia** la pantalla se abre al entrar, con
   «Más tarde». **Desde el día 6** ya no se puede cerrar: sólo queda subir el comprobante. Su equipo y
   su página de reservas siguen funcionando.
2. **El día de pago** es el día del mes en que empezó su plan de pago (por ejemplo el 14). El super
   admin lo puede cambiar.
3. **Si la transferencia no llegó o el monto no cuadra,** el super admin la **rechaza con un motivo**.
   Al propietario le llega un email, y al entrar se le vuelve a abrir la pantalla con los días de
   gracia que le queden.
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
   - **«Más tarde»**, con «Te quedan 5 días».
3. **Dado** que sube el comprobante, **entonces** el cobro pasa a **«En revisión»**, la pantalla se
   cierra y puede usar el sistema con normalidad. Al super admin le llega un aviso por ntfy y en su
   campana.
4. **Dado** que toca «Más tarde» dentro de los 5 días de gracia, **entonces** usa el sistema, y la
   pantalla vuelve a abrirse en su siguiente inicio de sesión.
5. **Dado** el día 6 sin comprobante, **entonces** la pantalla ya no tiene «Más tarde». El propietario
   no usa el panel hasta subirlo. Su equipo y su página de reservas siguen funcionando.
6. **Dado** Configuración → Negocio, **entonces** el propietario ve su **mensualidad**: el monto, el
   próximo día de pago y el historial de sus pagos con su estado («Pagado», «En revisión»,
   «Rechazado»).

### Historia 3 - El super admin revisa y confirma (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** /admin → **Cobros**, **entonces** el super admin ve los cobros del mes filtrados por
   estado: **En revisión**, **Por pagar** (dentro de la gracia), **Atrasados** (pasada la gracia),
   **Pagados** y **Rechazados**. En cada uno ve el negocio, el periodo, el monto y la fecha.
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
- **RF-003**: Al entrar, el propietario DEBE ver la pantalla de pago desde el día de pago:
  - con «Más tarde» durante 5 días de gracia;
  - sin él desde el sexto, hasta subir el comprobante.

  Su equipo y su página de reservas NO DEBEN bloquearse.
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
- **CE-003**: Pasados los 5 días sin comprobante, el panel del propietario queda bloqueado en la
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
