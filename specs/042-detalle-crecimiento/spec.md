# Especificación: Detalle de las tarjetas de «Crecimiento del mes»

**Carpeta**: `specs/042-detalle-crecimiento` (rama de trabajo: `dev`) · **Creada**: 2026-11-11

**Estado**: Implementada (2026-11-11). Aprobada el 2026-11-11, «acepto con lo recomendado»

**Repos**:
- **agenda-backend:** el desglose por negocio de cada tarjeta y sus pruebas.
- **agenda-front:** las tarjetas que se pueden pulsar y el panel con el detalle.
- **La beta:** no lo lleva (respuesta 3).

## Pedido

El dueño del producto, el 2026-11-11, con capturas del Resumen de /admin:

> me gustaría tener un panel de super admin en el cual haga clic en él y me muestre cuáles fueron las reservas
> online de qué negocios, esas 17 reservas a quién pertenecen, cuáles son los 8 pacientes nuevos […] pero no
> quiero tener eso en el navbar sino en las tarjetas al momento de hacer clic

Hoy, el Resumen del super admin (spec 006) tiene la sección «Crecimiento del mes». Cuenta lo que va del mes en
toda la plataforma, frente a los mismos días del mes pasado, en cuatro tarjetas:
- Citas agendadas;
- Reservas online;
- Pacientes nuevos;
- Negocios nuevos.

Cada tarjeta da sólo el total. No se puede saber de qué negocios salen esas cifras.

**Para qué sirve:**
- **Ver qué negocios usan Agenda360** y cuáles no.
- **Saber a quién escribirle** para ayudarle o para venderle más.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El super admin ve de qué negocios es cada cifra (Prioridad: P1)

**Por qué esta prioridad:** es lo que se pidió; sin esto no hay función.

**Prueba independiente:** con citas, reservas online y pacientes nuevos de varios negocios en el mes, el super
admin pulsa cada tarjeta y ve cada negocio con su cifra. La suma cuadra con la tarjeta.

1. **Dado** el Resumen de /admin, **cuando** el super admin pulsa una de las cuatro tarjetas (o la elige con el
   teclado y pulsa Enter), **entonces** se abre un panel con el detalle de esa tarjeta:
   - en el computador, al costado;
   - en el celular, desde abajo, casi a pantalla completa.

   El panel lleva el nombre de la tarjeta y el periodo (por ejemplo, «Citas agendadas · del 1 al 11 de
   noviembre»). El menú no cambia y no hay pestañas nuevas.
2. **Dado** el panel de **Citas agendadas** o de **Reservas online**, **entonces** muestra cada negocio con su
   cifra de lo que va del mes y la de los mismos días del mes pasado, de más a menos. Los negocios con 0 en los
   dos periodos no salen. La suma de lo que va del mes es la cifra de la tarjeta.
3. **Dado** el panel de **Pacientes nuevos**, **entonces** muestra cada negocio con su cifra de lo que va del mes
   y la del mes pasado, de más a menos. También dice cuántos llegaron por la página de reservas y cuántos se
   registraron desde el panel. No muestra ningún dato de los pacientes, sólo cifras (respuesta 1).
4. **Dado** el panel de **Negocios nuevos**, **entonces** muestra los negocios creados en el periodo, del más
   nuevo al más antiguo, con su nombre, su fecha de alta, su plan y su estado.
5. **Dado** cualquier negocio de un panel, **cuando** el super admin lo pulsa, **entonces** se abre su ficha en
   /admin. Desde ahí, el modo soporte sigue siendo la forma de ver sus citas y sus pacientes para darle
   asistencia.
6. **Dado** un negocio que tuvo cifras el mes pasado y ninguna este mes, **entonces** sale igual en el panel,
   con 0 este mes. Así se ve qué negocio dejó de usar la función.
7. **Dado** el panel abierto, **cuando** el super admin pulsa Escape, toca fuera o pulsa «Cerrar», **entonces**
   el panel se cierra y vuelve a la tarjeta que lo abrió.

### Casos límite

- **Un periodo sin nada** (por ejemplo, el día 1 temprano): el panel dice que todavía no hay cifras este mes y
  muestra las del mes pasado si hay.
- **Un negocio suspendido** con citas en el periodo: la tarjeta lo cuenta, así que el panel también, con la
  marca «Suspendido». Si no, la suma no cuadraría.
- **Un negocio eliminado:** sus citas y pacientes ya no existen, así que no cuenta ni en la tarjeta ni en el
  panel.
- **Una cita con varios pacientes** (spec 004): cuenta como una cita, como en la tarjeta.
- **Los pacientes importados** (spec 012): no cuentan como nuevos, como en la tarjeta.
- **Las citas canceladas:** no cuentan, como en la tarjeta.
- **Un mes pasado más corto:** se compara con el mes pasado entero, como en la tarjeta («todo febrero»).
- **Muchos negocios:** la lista se desplaza dentro del panel. Muestra todos, sin un límite que oculte negocios.
- **Si no se puede cargar el detalle:** el panel lo dice y ofrece «Reintentar». La tarjeta sigue mostrando su
  cifra.

## Requisitos *(obligatorio)*

- **RF-001**: Cada una de las cuatro tarjetas de «Crecimiento del mes» DEBE poder pulsarse y abrirse con el
  teclado. Abre un panel con el detalle, sin agregar nada al menú ni pestañas nuevas.
- **RF-002**: El detalle DEBE contar con los mismos criterios y el mismo periodo que la tarjeta: la suma de lo
  que va del mes por negocio es la cifra de la tarjeta, y la del mes pasado es la cifra de abajo.
- **RF-003**: Los paneles de Citas agendadas, Reservas online y Pacientes nuevos DEBEN mostrar cada negocio con
  su cifra de este periodo y la del mismo periodo del mes pasado, de más a menos. Los negocios en 0 en los dos
  periodos NO DEBEN salir.
- **RF-004**: El panel de Pacientes nuevos DEBE separar cuántos llegaron por la página de reservas y cuántos se
  registraron desde el panel, sólo con cifras: sin nombres ni ningún otro dato de los pacientes (respuesta 1).
- **RF-005**: El panel de Negocios nuevos DEBE listar los negocios creados en el periodo con su nombre, su fecha
  de alta, su plan y su estado.
- **RF-006**: Cada negocio de un panel DEBE llevar a su ficha en /admin.
- **RF-007**: Los negocios que no están activos DEBEN llevar su estado («Suspendido»), para que la suma cuadre
  y se distingan.
- **RF-008**: Sólo el super admin DEBE poder ver el detalle. Un negocio, un miembro de equipo o alguien sin
  sesión NO DEBE poder pedirlo. Ver el detalle no va a la actividad.
- **RF-009**: El detalle DEBE calcularse sólo cuando se abre un panel, no al cargar el Resumen, para no gastar
  más CPU de Vercel en cada visita.
- **RF-010**: El panel DEBE funcionar en el computador y en el celular (390 px), en claro y en oscuro, con
  contraste AA y con la gama de la marca y los grises. DEBE cerrarse con Escape, tocando fuera o con «Cerrar»,
  y al cerrarse devolver el foco a la tarjeta.
- **RF-011**: Los paneles DEBEN llevar sólo cifras por negocio, como la analítica de /admin (respuestas 1 y 2):
  ni pacientes (nombres, contactos, cédulas, historia clínica), ni citas sueltas, servicios o notas.
- **RF-012**: La constitución DEBE recoger el detalle de las tarjetas con la misma regla de privacidad de la
  analítica de /admin.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - cada desglose, contado a mano con citas, reservas y pacientes de prueba de varios negocios;
  - que la suma cuadra con la cifra de la tarjeta, en este periodo y en el del mes pasado;
  - que no cuentan las canceladas ni los importados;
  - el negocio suspendido con su estado;
  - los negocios nuevos con su plan y su estado;
  - que sólo el super admin lo ve: un propietario, un miembro de equipo y alguien sin sesión no;
  - que la respuesta no lleva datos de pacientes ni citas sueltas.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y `check:contrast` en el front, sin errores.
- **CE-003**: Un recorrido en el navegador con capturas: las cuatro tarjetas abren su panel en el computador
  (1440 px, claro) y en el celular (390 px, oscuro), con el teclado y con el ratón, sin desbordes ni errores.
- **CE-004**: El super admin sabe en menos de 10 segundos de qué negocios son las citas, las reservas online y
  los pacientes nuevos del mes, sin entrar en modo soporte.

## Supuestos

- **Las cifras de las tarjetas no cambian:** el detalle reparte la misma cifra por negocio.
- **El periodo es el de la tarjeta:** del día 1 a hoy, frente a los mismos días del mes pasado, en la hora de
  Ecuador.
- **La lista no se exporta.** La analítica de /admin ya tiene su CSV por negocio.
- **No hace falta migración:** las cifras salen de las citas, los pacientes y los negocios que ya existen.
- **El calendario de /admin** (spec 035) sigue igual.

## Respuestas del dueño del producto (2026-11-11)

«Acepto con lo recomendado»:

1. **Pacientes nuevos: sólo la cifra por negocio y por origen** (página de reservas o panel), sin nombres. La
   constitución no cambia en eso; para saber quiénes son, el modo soporte.
2. **Citas y reservas online: por negocio,** con su cifra. Sin citas sueltas.
3. **La beta no lo lleva.**
