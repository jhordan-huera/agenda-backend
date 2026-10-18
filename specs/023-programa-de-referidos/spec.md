# Especificación: El programa de referidos

**Carpeta**: `specs/023-programa-de-referidos` (rama de trabajo: `dev`) · **Creada**: 2026-10-18

**Estado**: Aprobada (2026-10-18, con el plan)

**Repos**:
- **agenda-backend:** el código de cada negocio, quién recomendó a quién y los descuentos.
- **agenda-front:** la tarjeta del negocio y /admin.
- **La beta:** sí.

## Pedido

El dueño del producto quiere que sus clientes le traigan colegas (2026-10-18).

**Decisiones del dueño del producto (2026-10-18):**
1. **El premio:** por cada negocio recomendado que se queda, quien lo recomendó paga **$1,50 menos en
   su siguiente mensualidad**, una sola vez y sólo en el mes siguiente. Todavía no hay cobro
   automático: el sistema lleva la cuenta y el dueño aplica el descuento al cobrar.
2. **El negocio ve su programa** en su panel, con su enlace y cuántos lleva.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El negocio recomienda (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** el propietario en Configuración → Negocio, **entonces** ve la tarjeta «Recomienda
   Agenda360» con:
   - su enlace propio, con «Copiar»;
   - «Compartir por WhatsApp», con un mensaje ya escrito;
   - cuántos negocios recomendó y cuántos ya se quedaron.
2. **Dado** que un colega abre el enlace, **entonces** llega a la portada, y «Quiero mi agenda» (spec
   022) abre un WhatsApp al dueño que dice «Me recomendó <negocio>».
3. **Dado** los demás roles (administradores, Recepción y Profesional), **entonces** no ven la tarjeta.

### Historia 2 - El dueño anota y aplica los descuentos (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** «Nuevo negocio» en /admin (y la ficha del negocio), **entonces** hay un campo «Recomendado
   por», que se completa solo si el negocio llegó por un enlace, y queda en la actividad.
2. **Dado** un negocio recomendado que sigue activo un mes después de crearse, **entonces** su
   recomendación «se queda». Quien lo recomendó gana un descuento de $1,50 para su siguiente
   mensualidad.
3. **Dado** /admin, **entonces** una lista «Descuentos por referidos» muestra:
   - quién recomendó y a quién;
   - desde cuándo se ganó;
   - el monto;
   - «Marcar como aplicado», que queda en la actividad.
4. **Dado** la ficha de un negocio en /admin, **entonces** se ve quién lo recomendó y a quién
   recomendó.

### Casos límite

- **Un negocio que se suspende antes del mes:** no genera descuento. Si se reactiva y cumple el mes
  activo, sí.
- **Un negocio no puede recomendarse a sí mismo.** Cada negocio tiene un solo «Recomendado por».
- **Cada recomendación da un solo descuento,** aunque el negocio siga años.
- **Varios descuentos el mismo mes** se suman: dos referidos son $3,00.

## Requisitos *(obligatorio)*

- **RF-001**: Cada negocio DEBE tener un código y un enlace propios para recomendar.
- **RF-002**: El propietario DEBE ver la tarjeta con su enlace, «Copiar», «Compartir por WhatsApp» y
  sus cifras. Los otros roles, no.
- **RF-003**: El super admin DEBE poder anotar y cambiar «Recomendado por», y DEBE quedar en la
  actividad.
- **RF-004**: Una recomendación DEBE generar un descuento de $1,50 cuando el negocio recomendado
  cumple un mes y sigue activo, una sola vez.
- **RF-005**: El super admin DEBE ver los descuentos pendientes y marcarlos como aplicados. Queda en la
  actividad.
- **RF-006**: Se DEBE ver bien en los dos modos y a 390 px. La beta lo lleva.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Con un negocio recomendado de hace 31 días y activo, el descuento aparece en /admin, y al
  marcarlo aplicado ya no está pendiente. Lo comprueban las pruebas.
- **CE-002**: Las pruebas pasan y las pantallas funcionan en los dos modos y a 390 px.

## Supuestos (para revisar)

- **La tarjeta del negocio dice el premio:** «Por cada colega que se quede, $1,50 menos en tu
  siguiente mensualidad». La regla dice que los negocios no ven planes ni precios. Esto no es un
  precio, sino un descuento, pero hay que confirmarlo.
- **El código** es corto (6 letras y números) y no cambia aunque cambie el enlace de reservas.
- **Con el registro público abierto,** el código entra solo en el registro. Hoy está cerrado.
