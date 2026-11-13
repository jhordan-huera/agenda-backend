# Especificación: La pantalla Actividad del super admin, rediseñada

**Carpeta**: `specs/049-actividad-super-admin` (rama de trabajo: `dev`) · **Creada**: 2026-11-13

**Estado**: Implementada (2026-11-13). Aprobada el 2026-11-13, «me gusta la a, apruebo todo planes y todo no me pidas que configure nada mas de la spec esta bien asi procede»

**Repos**:
- **agenda-front:** la pantalla `/admin/activity` y sus piezas nuevas.
- **agenda-backend:** sólo esta carpeta de la spec. La API no cambia y no hay migración.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-13:

> dame cambiando la pantalla de actividades de super admin que se vea mejor por favor

Claude dibujó dos propuestas en un lienzo, junto a una captura de cómo se ve hoy
(https://claude.ai/artifact/Sw7D9ak998YowLcKtGmft7). El dueño eligió la **A, «Pestañas: una cosa a la vez»**, y
aprobó la spec, el plan y las tareas sin más preguntas.

**Cómo es hoy la pantalla:**
- **Cuatro tarjetas de cifras** arriba: los emails enviados hoy, los fallidos hoy, los intentos fallidos de inicio de
  sesión en 24 horas y las cuentas en alerta.
- **La tarjeta «Auditoría»:** Super admin / Seguridad / Todo, el buscador, el tipo, el negocio, dos campos de fecha y
  «Exportar». Cada día es una caja aparte y cada fila repite el avatar y el nombre de quien lo hizo.
- **Debajo, «Emails enviados»:** Hoy / Fallidos / Todos. Cada email lleva dos etiquetas: el tipo en color y el estado
  en gris. Al tocar uno se abre su contenido.

**Lo que falla:**
- **Los emails quedan al final.** En el celular, a casi 1900 px de la parte de arriba.
- **Las cuatro tarjetas ocupan mucho y casi siempre dicen 0.** No dicen si todo está bien.
- **Cajas dentro de cajas:** una caja por día dentro de la tarjeta, aunque el día tenga una sola acción.
- **En los emails resalta lo que menos importa:** el tipo va en color; el estado (si salió o falló), en gris.
- **En el celular el asunto se corta:** «Recuerda que tiene…».
- **Las fechas** salen como «mm/dd/yyyy» y desalinean la fila de filtros.

**Para qué sirve:** que el super admin vea de un vistazo si hoy algo falló (emails, accesos) y llegue a lo que busca
sin bajar por toda la página.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Saber de un vistazo cómo va hoy (Prioridad: P1)

**Por qué esta prioridad:** es lo primero que mira el super admin al entrar.

**Prueba independiente:** con 2 emails fallidos hoy, la parte de arriba dice en rojo «2 emails fallaron hoy» y el
botón lleva a esos emails. Sin fallidos ni cuentas en alerta, dice «Todo en orden hoy».

1. **Dado** que hoy no falló ningún email y no hay cuentas en alerta, **entonces** en lugar de las cuatro tarjetas sale
   un resumen: **«Todo en orden hoy»** y, en una frase, cuántos emails salieron, cuántos están en cola, que ninguno
   falló, cuántos intentos fallidos de inicio de sesión hubo en las últimas 24 horas y que ninguna cuenta está en
   alerta.
2. **Dado** que hoy fallaron emails, **entonces** el título lo dice en rojo («1 email falló hoy», «2 emails fallaron
   hoy») y trae el botón **«Ver los fallidos»**, que abre Emails con el filtro Fallidos.
3. **Dado** que hay cuentas en alerta, **entonces** el título lo dice en rojo («1 cuenta en alerta») y el botón **«Ver
   la seguridad»** abre Seguridad con «Sólo intentos fallidos».
4. **Dado** los intentos fallidos de la frase, **cuando** son más de 0, **entonces** son un enlace que abre Seguridad
   con «Sólo intentos fallidos».
5. **Dado** que las cifras no cargan, **entonces** la pantalla funciona igual, sin el resumen.

### Historia 2 - Ver una cosa a la vez: Acciones, Seguridad y Emails (Prioridad: P1)

**Por qué esta prioridad:** es el arreglo principal: los emails dejan de quedar al final.

**Prueba independiente:** abrir `/admin/activity?emails=fallidos` muestra la pestaña Emails con el filtro Fallidos;
`?ver=seguridad`, la pestaña Seguridad. Cambiar de pestaña cambia la dirección.

1. **Dado** la pantalla, **entonces** tiene tres pestañas: **Acciones**, **Seguridad** y **Emails**. Empieza en
   Acciones.
2. **Dado** las pestañas, **entonces** cada una muestra su cifra si importa:
   - Seguridad, los intentos fallidos de las últimas 24 horas, si hubo;
   - Emails, «N fallidos» en rojo si hoy falló alguno; si no, «N en cola» si hay en cola.
3. **Dado** que se cambia de pestaña, **entonces** queda en la dirección (`?ver=acciones`, `?ver=seguridad`,
   `?ver=emails`). Con «Atrás» del navegador se vuelve a la anterior.
4. **Dado** los enlaces que ya existen, **entonces** siguen funcionando:
   - `?ver=seguridad` (los avisos de seguridad) abre Seguridad;
   - `?emails=hoy`, `?emails=fallidos` y `?emails=todos` (la tarjeta «Emails de hoy» del Inicio) abren Emails con ese
     filtro.
5. **Dado** que la pantalla ya está abierta y llega otro de esos enlaces (por ejemplo, desde la campana), **entonces**
   cambia de pestaña sin recargar.

### Historia 3 - Leer la actividad sin cajas dentro de cajas (Prioridad: P1)

**Prueba independiente:** en Acciones, con acciones de varios días, la lista es una sola superficie. El día va a la
izquierda, la hora en cada fila y el negocio a la derecha. Las acciones propias dicen «Tú».

1. **Dado** Acciones, **entonces** se elige **Super admin** o **Todo**, como hoy, y se filtra con el buscador, el
   tipo, el negocio y las fechas.
2. **Dado** las fechas, **entonces** hay un solo botón: **«Cualquier fecha»**. Abre los atajos (Hoy, Últimos 7 días,
   Últimos 30 días) y los campos Desde y Hasta. El botón muestra lo elegido (por ejemplo, «Últimos 7 días» o «3 nov –
   12 nov»).
3. **Dado** la lista, **entonces** es una sola superficie agrupada por día:
   - el día va a la izquierda: «Hoy», «Ayer» o el nombre del día, con la fecha corta debajo («viernes 13 nov»);
   - cada fila lleva la hora, la frase y, debajo, quién lo hizo como texto. Las acciones propias dicen «Tú»;
   - si la acción es de un negocio, su nombre va a la derecha como enlace a su ficha;
   - «Ver cambios» funciona como hoy.
4. **Dado** el celular, **entonces** el día pasa arriba de sus filas y el negocio va debajo de la frase. Nada se sale
   del ancho.
5. **Dado** «Exportar», **entonces** está en la barra de las pestañas, en Acciones y en Seguridad, y descarga el CSV
   con los filtros elegidos, como hoy.
6. **Dado** que no hay actividad con esos filtros, **entonces** lo dice y deja limpiarlos.

### Historia 4 - Seguridad (Prioridad: P2)

1. **Dado** Seguridad, **entonces** muestra los inicios y cierres de sesión y los intentos fallidos en la misma lista
   de la Historia 3, con el navegador y la IP debajo de cada uno.
2. **Dado** «Sólo intentos fallidos», **entonces** filtra como hoy. Los intentos fallidos se ven en rojo.
3. **Dado** Seguridad, **entonces** no tiene el filtro de tipo, como hoy.

### Historia 5 - Emails: el estado primero (Prioridad: P1)

**Prueba independiente:** en Emails, un email que falló sale con un tinte rojo, «Falló» y el motivo debajo del asunto.
Los enviados y en cola, en gris. En el celular, el asunto se lee completo.

1. **Dado** Emails, **entonces** se elige **Hoy**, **Fallidos (N)** o **Todos**, como hoy (los 200 más recientes).
2. **Dado** el computador, **entonces** es una tabla agrupada por día con las columnas Hora, Estado, Email (el asunto
   y, debajo, el destinatario), Negocio y Tipo.
3. **Dado** el estado, **entonces**:
   - **«Falló»** en rojo, con su icono, la fila con un tinte rojo y el motivo debajo del asunto;
   - **«Enviado»**, **«En cola»** y **«Descartado»** en gris, cada uno con su icono. El descartado lleva su motivo
     debajo;
   - el tipo va como texto gris, sin color.
4. **Dado** el celular, **entonces** cada email va en varias líneas: el asunto completo, el estado con la hora y el
   tipo, el destinatario con el negocio y, si hay, el motivo. Nada se corta ni se sale del ancho.
5. **Dado** que se toca un email, **entonces** se abre su contenido, como hoy.
6. **Dado** que no hay emails con ese filtro, **entonces** lo dice, con el texto de hoy para cada filtro.

### Casos límite

- **Un email sin negocio** (los de cuenta o de la plataforma): en Negocio dice «Sin negocio».
- **Un fallido sin motivo guardado:** dice «Sin motivo registrado».
- **Muchas acciones en un día:** el día se ve una sola vez, a la izquierda, al lado de todas sus filas.
- **Un nombre de negocio largo:** se corta con «…» en el computador y se ve completo al pasar el ratón; en el celular
  se ve en su propia línea.
- **Una acción de un negocio que ya no existe:** sin enlace, sólo el nombre si lo hay.
- **Modo oscuro:** los mismos colores de la app; el rojo sólo para lo que falló.

## Requisitos *(obligatorio)*

- **RF-001**: Arriba de la pantalla DEBE salir el resumen del día en una frase («Todo en orden hoy» o, en rojo, los emails fallidos de hoy o las cuentas en alerta, con un botón para verlos) en lugar de las cuatro tarjetas de cifras. Los intentos fallidos de 24 horas DEBEN ser un enlace a Seguridad cuando son más de 0.
- **RF-002**: La pantalla DEBE tener tres pestañas, Acciones, Seguridad y Emails, con la cifra de cada una según la Historia 2, y la elegida DEBE quedar en la dirección.
- **RF-003**: Los enlaces de hoy (`?ver=seguridad`, `?emails=hoy|fallidos|todos`) DEBEN abrir la pestaña y el filtro que corresponden, también con la pantalla ya abierta.
- **RF-004**: Acciones y Seguridad DEBEN mostrar la actividad en una sola superficie agrupada por día, con el día a la izquierda (arriba en el celular), la hora, la frase, quién lo hizo como texto («Tú» si fue el super admin que mira), el negocio como enlace y «Ver cambios». En Seguridad, también el navegador y la IP.
- **RF-005**: Las fechas DEBEN elegirse con un solo botón, con los atajos Hoy, Últimos 7 días y Últimos 30 días y los campos Desde y Hasta. El botón DEBE mostrar lo elegido.
- **RF-006**: «Exportar» DEBE estar en la barra de las pestañas en Acciones y Seguridad, con los filtros elegidos.
- **RF-007**: Emails DEBE mostrar primero el estado: en rojo sólo los que fallaron, con el motivo; en gris los enviados, en cola y descartados (este último con su motivo). El tipo DEBE ir en texto gris. En el computador, una tabla por día; en el celular, sin cortar el asunto.
- **RF-008**: Al tocar un email DEBE abrirse su contenido, como hoy.
- **RF-009**: La pantalla DEBE verse bien en claro y en oscuro, en el computador y en el celular (390 px), sin desplazamiento horizontal, con una sola gama de color (la marca y los grises; el rojo sólo para lo que falló).
- **RF-010**: Todo DEBE salir de lo que la API ya manda. Ni la API ni la base cambian.
- **RF-011**: La actividad y la bandeja de emails del panel del negocio NO DEBEN cambiar.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Una comprobación automática del front (`check:*`) cubre:
  - la frase del resumen con y sin fallidos, en singular y en plural;
  - la cifra de cada pestaña;
  - la pestaña y el filtro de cada enlace (`?ver=…` y `?emails=…`);
  - los atajos de fechas y el texto del botón;
  - el estado de cada email: enviado, en cola, falló y descartado, con su motivo.
- **CE-002**: Build, lint y todas las `check:*` del front pasan sin errores, también en GitHub («Comprobar»). Las
  pruebas del backend siguen en verde.
- **CE-003**: El recorrido funciona en el computador (1440 px, claro) y en el celular (390 px, oscuro), sin
  desplazamiento horizontal ni errores en la consola:
  - el resumen;
  - las tres pestañas y los enlaces de hoy;
  - los filtros y las fechas;
  - un email fallido con su motivo;
  - abrir un email.
- **CE-004**: Desde que se abre la pantalla, el super admin llega a los emails fallidos de hoy con un toque (antes
  había que bajar hasta el final de la página).
- **CE-005**: En el celular la pantalla entera mide al menos un tercio menos que hoy con los mismos datos de prueba
  (hoy, 2245 px), porque muestra una pestaña a la vez.

## Supuestos

- **Las cifras del resumen** son las mismas que hoy muestran las cuatro tarjetas. No hay cifras nuevas.
- **«Tú»** sale cuando quien hizo la acción es el super admin que mira la pantalla. Los demás, con su nombre.
- **Los atajos de fechas** cuentan en la hora del navegador, como los campos de hoy.
- **El nombre de la pestaña Acciones** reemplaza al título «Auditoría». Las opciones Super admin y Todo se llaman igual
  que hoy.
- **El Inicio y la campana** no cambian: sus enlaces siguen siendo los mismos.
- **La constitución** no cambia: no hay datos nuevos, permisos nuevos ni excepciones.

## Respuestas del dueño del producto (2026-11-13)

«me gusta la a, apruebo todo planes y todo no me pidas que configure nada mas de la spec esta bien asi procede»:
- **La propuesta elegida:** la A, «Pestañas: una cosa a la vez».
- **Lo demás:** con lo recomendado, sin más preguntas. Al terminar, abrir los PR `dev` → `main` y avisar por ntfy para
  fusionarlos desde el celular.
