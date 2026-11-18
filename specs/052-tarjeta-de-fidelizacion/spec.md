# Especificación: Tarjeta de fidelización

**Carpeta**: `specs/052-tarjeta-de-fidelizacion` (rama de trabajo: `dev`) · **Creada**: 2026-11-16

**Estado**: Implementada en dev (2026-11-16). Aprobada el 2026-11-16 («si aprobado procede»). Las decisiones del dueño del producto están al final.
El dueño eligió la vista previa B, «Tarjeta clara» (lienzo https://claude.ai/artifact/FaEHLgwVqbgtVbpd356czH), y aprobó el plan el 2026-11-16.

**Repos**:
- **agenda-backend:** el programa, los beneficios, los sellos, las recompensas, el canje, la cuenta del paciente, el
  escaneo del QR, los emails, las redes del negocio y la migración.
- **agenda-front:** la sección «Fidelización» del panel, el bloque de la ficha, «Escanear», la cuenta y la tarjeta del
  paciente, las redes en Configuración → Negocio y en la página de reservas, y los textos que hoy dicen «sin cuenta».
- **La beta:** no lo lleva.

Plan técnico: [plan.md](plan.md), cuando se apruebe esta spec.

## Pedido

El dueño del producto, el 2026-11-16, pidió un módulo «Tarjeta Digital de Fidelización»: que cada negocio cree sus
propios beneficios según las citas completadas, que el paciente vea su progreso y que el equipo canjee las recompensas.
Después de ver el diagnóstico, lo precisó:

> lo que quisiera es que el cliente inicie sesion con el usuario su numero de telefono y un contraseña que el la cree
> y se le genre un qr propio para el para cuando tenga la cita el profecional escanea y se le agrega como completa osea
> siempre y cuando el profesional lo registe

Y mandó una imagen de referencia de lo que ve el paciente: una tarjeta de sellos con el logo del negocio, un contador
de sellos, las casillas de los premios, «Mis premios», el botón del QR y las redes del negocio.

**Lo que ya existe:**
- **Las citas:** pasan a Atendida desde la ficha, «Por cerrar» (spec 018) y el tablero. Sólo el propietario corrige
  una cita Atendida («Corregir estado», spec 020). Una cita puede tener hasta 3 personas (specs 004 y 005).
- **Los pacientes no tienen cuenta:** reservan sin registrarse y entran por enlaces privados (la encuesta, el
  recordatorio de control, la lista de espera y el pago). La portada y el inicio de sesión lo dicen.
- **«Por cobrar»** (spec 046) y Reportes usan el precio de cada cita.
- **El negocio ya guarda su logo y sus colores** (spec 033), y la página de reservas los usa.

**Para qué sirve:** que el paciente tenga un motivo más para volver al mismo consultorio, y que el consultorio premie a
los pacientes frecuentes sin llevar tarjetas de cartón ni la cuenta a mano.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El consultorio arma su programa (Prioridad: P1)

**Por qué esta prioridad:** sin programa no hay tarjeta; todo lo demás depende de esto.

**Prueba independiente:** el propietario enciende la tarjeta, la llama «Club Sonrisa», elige el sello del diente y crea
dos beneficios: «Limpieza con 50 % de descuento» a las 5 citas y «Blanqueamiento gratis» a las 10. Los ve en la lista,
desactiva uno, lo vuelve a activar y borra un tercero de prueba que nadie ganó.

1. **Dado** el panel, **entonces** el menú tiene **«Fidelización»** para el propietario y los administradores. Empieza
   apagada; mientras lo está, muestra qué es y el interruptor para encenderla.
2. **Dado** el programa, **entonces** se configura:
   - el nombre (por ejemplo «Club Sonrisa») y una descripción corta;
   - el **sello**: un ícono de una lista (diente, tijeras, corazón, hoja, estrella, mano, gota y otros), que se
     dibuja en cada casilla ganada;
   - **qué pasa al llegar al último beneficio:** «Seguir sumando» (la tarjeta se queda llena y no hay más premios) o
     «Empezar una tarjeta nueva» (el paciente sube de nivel y empieza de cero; ver la Historia 2).
3. **Dado** «+ Agregar beneficio», **entonces** se abre un formulario con:
   - **nombre** y **descripción**;
   - **citas necesarias** (de 1 a 100);
   - **tipo:** descuento en porcentaje, descuento de un valor fijo, cita gratis, servicio gratis (eligiendo el servicio)
     o personalizado (sólo el texto);
   - **valor**, según el tipo (de 1 a 100 % o un monto en dólares);
   - **condiciones** (texto libre, por ejemplo «no acumulable»);
   - **vence a los N días** de desbloquearse, opcional.
4. **Dado** un beneficio, **entonces** se puede editar, desactivar (deja de desbloquearse, pero lo ya ganado sigue) y
   volver a activar.
5. **Dado** «Eliminar», **entonces** pide confirmación. Si nadie lo ganó, se borra. Si alguien ya lo ganó, se
   **archiva**: desaparece de la tarjeta y de la lista, y las recompensas ya ganadas siguen igual.
6. **Dado** que se edita un beneficio, **entonces** lo ya desbloqueado no cambia: cada recompensa guarda el beneficio
   como era el día que se ganó.
7. Cada acción de esta historia queda en la actividad.

### Historia 2 - Las citas atendidas suman sellos y desbloquean premios (Prioridad: P1)

**Por qué esta prioridad:** es la regla que hace que la tarjeta valga; tiene que funcionar sola y sin errores.

**Prueba independiente:** con la tarjeta encendida y beneficios a las 5 y a las 10, una paciente llega a su quinta cita
Atendida y le aparece la recompensa de 5; se corrige esa cita a «No asistió» y la recompensa se anula.

1. **Dado** una cita que pasa a **Atendida**, por cualquier camino (el QR, la ficha, «Por cerrar», el tablero o
   «Editar»), **entonces** cada paciente de esa cita suma **un sello**. Una cita nunca da dos sellos al mismo paciente.
2. **Dado** que la tarjeta se enciende, **entonces** sólo suman las citas que pasan a Atendida desde ese momento; el
   historial no cuenta.
3. **Dado** que un paciente llega a las citas de un beneficio activo, **entonces** se desbloquea su **recompensa**,
   con un código propio (por ejemplo `K7Q-3MD`). Si llega a varios a la vez, se desbloquean todos. Cada beneficio se
   gana una sola vez por tarjeta.
4. **Dado** que el propietario corrige una cita Atendida («Corregir estado»), **entonces** se le quita el sello a cada
   paciente de esa cita y se **anulan** sus recompensas aún no canjeadas que ya no alcanza. Las ya canjeadas se quedan.
   Todo queda en su historial.
5. **Dado** «Empezar una tarjeta nueva», **entonces** al ganar el último beneficio el paciente **sube de nivel** y su
   tarjeta vuelve a cero: **Clásica** (la primera), **Plata** (la segunda) y **Oro** (de la tercera en adelante). Las
   recompensas de las tarjetas anteriores se conservan.
6. **Dado** «Seguir sumando», **entonces** el paciente sigue sumando sellos después del último beneficio, sin premios
   nuevos y sin niveles.
7. **Dado** que canjea una recompensa, **entonces** sus sellos no cambian.
8. Ni el paciente ni el equipo pueden sumar o quitar sellos a mano: sólo cambian con el estado de las citas.

### Historia 3 - El paciente tiene su cuenta y su tarjeta (Prioridad: P1)

**Por qué esta prioridad:** es lo que el paciente ve y lo que le pidió el dueño: entrar con su teléfono y tener su QR.

**Prueba independiente:** un paciente crea su cuenta con su teléfono y una contraseña, ve su QR y, después del primer
escaneo en el consultorio (Historia 4), ve la tarjeta de ese consultorio con sus sellos y sus premios.

1. **Dado** la página **«Mi tarjeta»**, **entonces** el paciente crea su cuenta con su **nombre**, su **teléfono** y
   una **contraseña** que elige él. Inicia sesión con el teléfono y la contraseña. La cuenta es **opcional**: reservar
   sigue igual que hoy, sin cuenta.
2. **Dado** que entra, **entonces** tiene su **QR propio**, siempre el mismo, en el botón de arriba. Puede pedir uno
   nuevo si lo perdió o se lo fotografiaron; el anterior deja de servir.
3. **Dado** que su cuenta todavía no está unida a ningún consultorio, **entonces** ve su QR y un texto: «Muéstralo en
   tu próxima cita para empezar a sumar sellos».
4. **Dado** que ya lo escanearon en un consultorio con la tarjeta encendida, **entonces** ve la tarjeta, como la imagen
   de referencia:
   - el saludo con su nombre y el nombre del consultorio;
   - su **nivel** (Clásica, Plata u Oro), si el programa empieza tarjetas nuevas;
   - la tarjeta con el logo, el nombre del programa y el contador de sellos;
   - las **casillas**: una por cita hasta el último beneficio, en filas de 5. Las ganadas llevan el sello del
     consultorio, y la casilla de cada beneficio dice **«Premio»** con un regalo (o una estrella en la última);
   - cuántas citas le faltan para el próximo premio;
   - las **redes** del consultorio, si las puso (Historia 8).
5. **Dado** **«Mis premios»**, **entonces** ve cada recompensa con su estado y su código:
   - **Disponible:** con su código y, si vence, hasta cuándo;
   - **Canjeada:** cuándo;
   - **Vencida** o **Anulada:** se ve en el historial.

   También ve los beneficios que le faltan y sus visitas (fecha y servicio).
6. **Dado** que es paciente de varios consultorios, **entonces** elige de cuál ver la tarjeta.
7. **Dado** el engranaje, **entonces** puede cambiar su contraseña, salir y **eliminar su cuenta**. Al eliminarla, los
   consultorios conservan su ficha y sus sellos como datos del negocio, pero la cuenta y su QR desaparecen.
8. El paciente no puede canjear, sumar ni cambiar nada: sólo mirar.

### Historia 4 - El profesional escanea el QR en la cita (Prioridad: P1)

**Por qué esta prioridad:** es el momento que pidió el dueño: el QR registra la visita y, la primera vez, une la cuenta
con la ficha del paciente.

**Prueba independiente:** con una cita Confirmada de hoy, el profesional abre «Escanear», escanea el QR del paciente,
confirma y la cita queda Atendida con su sello.

1. **Dado** el panel, **entonces** hay **«Escanear»** (en la Agenda y en Inicio) para quien maneja citas: el
   propietario, los administradores, Recepción y el profesional en su agenda. Usa la cámara del celular o del
   computador.
2. **Dado** un QR que todavía no está unido a una ficha de ese consultorio, **entonces** muestra el nombre de la cuenta
   y las citas de hoy de ese consultorio que el usuario puede ver, para elegir **cuál es este paciente**. Al confirmar,
   la cuenta queda **unida a esa ficha**. Ese escaneo en persona es la verificación: con sólo registrarse con un
   teléfono, nadie ve nada de un consultorio.
3. **Dado** un QR ya unido, **entonces** muestra al paciente y su cita de hoy (o sus citas, si tiene varias), con
   **«Marcar como atendida»**. Al confirmar, la cita pasa a Atendida por el mismo camino de siempre (la actividad, el
   email de seguimiento y «Por cerrar») y suma el sello.
4. **Dado** que el paciente no tiene cita hoy, **entonces** dice «No tiene cita hoy» y no suma; el equipo puede crear
   la cita y marcarla.
5. **Dado** que la cita ya está Atendida, Cancelada o es de otro profesional, **entonces** lo dice y no hace nada.
6. **Dado** un QR que no existe o que se cambió, **entonces** dice «Este QR ya no sirve: pídele al paciente que abra su
   tarjeta».
7. Escanear sin tener la tarjeta encendida también marca la cita (el QR sirve para registrar la visita); los sellos
   sólo suman con la tarjeta encendida.
8. Unir una cuenta a una ficha y marcar una cita con el QR quedan en la actividad.

### Historia 5 - El equipo canjea las recompensas (Prioridad: P2)

**Por qué esta prioridad:** el premio sólo vale si se puede usar; se puede probar después de que haya recompensas.

**Prueba independiente:** una paciente con «Limpieza con 50 % de descuento» disponible llega a su limpieza de $40. En
la cita, Recepción pulsa «Canjear» y el precio queda en $20; un segundo «Canjear» dice que ya se usó.

1. **Dado** la ficha del paciente, **entonces** su bloque **«Tarjeta de fidelización»** muestra sus sellos, su nivel,
   sus recompensas y, si tiene cuenta, que está unida.
2. **Dado** una recompensa disponible, **entonces** **«Canjear»** la marca como canjeada: guarda la fecha y la hora,
   quién lo hizo y, si se elige, en qué cita. Se canjea una sola vez, aunque dos personas lo intenten a la vez.
3. **Dado** que se canjea en una cita que todavía no está pagada, **entonces** se aplica al **precio de esa cita**:
   - el porcentaje o el valor fijo lo baja (nunca por debajo de $0);
   - «Cita gratis» y «Servicio gratis» lo dejan en $0;
   - «Personalizado» no cambia el precio.

   Así «Por cobrar» y Reportes cuadran. El cambio de precio queda en la actividad, junto al canje.
4. **Dado** la cita de un paciente con recompensas disponibles, **entonces** la cita lo avisa («Tiene 1 premio
   disponible») con «Canjear en esta cita».
5. **Dado** un código, **entonces** el equipo puede buscarlo en «Fidelización» para canjearlo.
6. Pueden canjear el propietario, los administradores y Recepción. El profesional ve la tarjeta en la ficha, pero no
   canjea.
7. Una recompensa vencida o anulada no se puede canjear.

### Historia 6 - Avisos y la contraseña olvidada (Prioridad: P2)

**Por qué esta prioridad:** ayudan, pero la tarjeta funciona sin ellos.

**Prueba independiente:** la paciente desbloquea un premio y le llega un email; el consultorio recibe la copia. Otra
paciente olvidó su contraseña: Recepción le manda el enlace por WhatsApp desde la ficha y ella crea una nueva.

1. **Dado** que se desbloquea una recompensa, **entonces** le llega al paciente un email «Ganaste un premio en
   [negocio]», con el beneficio, el código y el botón a su tarjeta (si tiene email en la ficha), y al profesional su
   copia aparte, como los demás emails al paciente.
2. **Dado** el email de seguimiento de una cita Atendida, **entonces**, con la tarjeta encendida, dice cuántos sellos
   lleva y cuántos le faltan para el próximo premio, con el enlace a «Mi tarjeta».
3. **Dado** una ficha con cuenta unida, **entonces** el equipo puede pulsar **«Enlace para cambiar la contraseña»**:
   se genera un enlace de un solo uso que vence en 24 horas y se abre WhatsApp hacia el teléfono de esa cuenta con el
   mensaje ya escrito. Queda en la actividad.
4. **Dado** que la contraseña se cambió con un enlace del consultorio, **entonces** al entrar el paciente ve un aviso
   con el nombre del consultorio y la fecha.

### Historia 7 - El consultorio ve cómo va el programa (Prioridad: P3)

**Por qué esta prioridad:** es para seguir el programa; no hace falta para que funcione.

**Prueba independiente:** en «Fidelización», el propietario ve cuántos pacientes participan, filtra las recompensas
canjeadas de un beneficio y encuentra a los pacientes a los que les falta una cita para un premio.

1. **Dado** «Fidelización», **entonces** arriba se ven las cifras:
   - pacientes que participan (con al menos un sello);
   - sellos dados;
   - recompensas disponibles, canjeadas y vencidas.
2. **Dado** **«Pacientes»**, **entonces** se ve cada paciente con sus sellos, su nivel, el próximo premio y cuánto le
   falta. Se puede ordenar por «les falta poco», con el WhatsApp ya escrito.
3. **Dado** **«Recompensas»**, **entonces** se ve el historial: paciente, beneficio, fecha de desbloqueo, estado,
   código y fecha de canje. Se filtra por paciente, beneficio y estado.
4. **Dado** el rol Profesional, **entonces** no entra a «Fidelización». Ve la tarjeta de sus pacientes en la ficha.

### Historia 8 - Las redes sociales del negocio (Prioridad: P3)

**Por qué esta prioridad:** completan la tarjeta y la página de reservas, pero no cambian cómo funciona.

**Prueba independiente:** el propietario pone sólo su Instagram; en la tarjeta y en la página de reservas sale sólo el
ícono de Instagram. Sin ninguna red, no sale la sección.

1. **Dado** Configuración → Negocio, **entonces** hay tres campos opcionales: **Facebook**, **Instagram** y **TikTok**
   (el enlace o el usuario).
2. **Dado** la tarjeta del paciente y la página de reservas, **entonces** «Síguenos en nuestras redes» muestra sólo las
   redes que el negocio puso. Si no puso ninguna, la sección no aparece.

### Casos límite

- **Cita con varias personas:** cada una suma su sello. Si sólo una tiene cuenta, sólo esa ve su tarjeta, pero todas
  suman en su ficha.
- **Paciente sin cuenta:** suma igual en su ficha; si después crea la cuenta y lo escanean, ve los sellos que ya tenía.
- **Unir dos fichas del mismo paciente:** sus sellos, recompensas y su cuenta pasan a la ficha que queda. Si las dos
  tenían cuenta, queda la de la ficha que se conserva.
- **Paciente o negocio borrado:** su tarjeta, sus sellos y sus recompensas se borran con él. Una cuenta de paciente
  sigue existiendo si tiene otros consultorios.
- **Paciente desactivado:** no suma sellos mientras lo esté.
- **Apagar la tarjeta:** no se suman sellos ni se desbloquean premios; lo ganado se conserva y se puede canjear. Al
  volver a encenderla, suma desde ese momento.
- **Cambiar las citas de un beneficio** (de 5 a 6): vale para lo que viene; lo desbloqueado no cambia. Si un paciente
  ya tenía 6 sellos, se desbloquea al guardar.
- **Dos beneficios con las mismas citas:** no se permite; se avisa al guardar.
- **Teléfono ya registrado:** «Ya hay una cuenta con este teléfono: inicia sesión». El teléfono se guarda en un solo
  formato (+593…), así «0991234567» y «+593991234567» son la misma cuenta.
- **Varios intentos fallidos al entrar:** se pide el CAPTCHA y, si siguen, se bloquea un rato, como el inicio de sesión
  del equipo.
- **Cita marcada antes de tiempo con el QR:** se puede (el paciente está ahí); si no se atendió, el propietario la
  corrige y el sello se quita.
- **Sin cupo de Gmail:** el email del premio espera en la cola; la tarjeta ya lo muestra.

## Requisitos *(obligatorio)*

### Requisitos funcionales

**Programa y beneficios**
- **RF-001:** Cada negocio DEBE tener a lo sumo un programa, apagado al empezar, con nombre, descripción, ícono del
  sello y qué pasa al terminar («Seguir sumando» o «Empezar una tarjeta nueva»). Sólo el propietario y los
  administradores lo configuran.
- **RF-002:** Un negocio DEBE poder crear tantos beneficios como quiera, cada uno con nombre, descripción, citas
  necesarias (1 a 100, sin repetir entre los activos), tipo, valor según el tipo, servicio (si es «Servicio gratis»),
  condiciones y vencimiento opcional en días.
- **RF-003:** Un beneficio DEBE poder editarse, desactivarse y activarse. Eliminar uno que nadie ganó lo borra; uno ya
  ganado se archiva y sus recompensas se conservan.
- **RF-004:** Cada recompensa DEBE guardar una copia del beneficio tal como era al desbloquearse; editar el beneficio
  no la cambia.

**Sellos y recompensas**
- **RF-005:** Cada paciente de una cita que pasa a Atendida, por cualquier camino, DEBE sumar un sello si la tarjeta
  está encendida y la cita pasó a Atendida después de encenderla. Una cita da como máximo un sello por paciente.
- **RF-006:** Al sumar un sello, DEBEN desbloquearse en la misma operación todas las recompensas de los beneficios
  activos alcanzados en la tarjeta actual, sin duplicados aunque haya cambios a la vez.
- **RF-007:** Al corregir una cita Atendida, se DEBE quitar el sello a cada paciente de esa cita y anular sus
  recompensas no canjeadas que ya no alcanza, dejando constancia de cuándo y por qué.
- **RF-008:** Con «Empezar una tarjeta nueva», al desbloquear el último beneficio activo, el paciente DEBE pasar al
  siguiente nivel (Clásica, Plata, Oro y después sigue en Oro) con la tarjeta en cero, conservando lo anterior.
- **RF-009:** Las recompensas DEBEN tener los estados Disponible, Canjeada, Vencida (calculada por su vencimiento) y
  Anulada. «Bloqueada» no se guarda: es un beneficio que el paciente todavía no alcanza.
- **RF-010:** Ni el paciente ni el equipo DEBEN poder sumar, quitar sellos ni crear recompensas a mano.

**Canje**
- **RF-011:** Canjear DEBE hacerse en el backend, una sola vez por recompensa, guardando cuándo, quién y, si se elige,
  la cita. Pueden canjear el propietario, los administradores y Recepción.
- **RF-012:** Canjear en una cita no pagada DEBE ajustar su precio según el tipo (sin bajar de $0), y dejar el cambio
  en la actividad.

**Cuenta del paciente y QR**
- **RF-013:** El paciente DEBE poder crear una cuenta con nombre, teléfono (único, en formato +593) y contraseña, e
  iniciar sesión con teléfono y contraseña. La cuenta es opcional y reservar no la pide.
- **RF-014:** Las cuentas de pacientes y sus sesiones DEBEN ir aparte de las del equipo: una sesión de paciente nunca
  da acceso al panel ni a la API del negocio.
- **RF-015:** La contraseña DEBE guardarse cifrada como las del equipo, con límite de intentos y CAPTCHA. Puede ser un
  PIN de 4 números (cambio del 2026-11-16): se rechazan los fáciles (0000, 1234, 1212, años…) y, desde el 5.º fallo
  seguido, hay que esperar 15 minutos, el doble con cada fallo más, hasta 24 horas; entrar bien o el enlace del
  consultorio lo ponen en cero.
- **RF-016:** Cada cuenta DEBE tener un QR propio que el paciente puede cambiar; el anterior deja de servir.
- **RF-017:** Una cuenta DEBE unirse a la ficha de un negocio sólo cuando alguien del equipo escanea su QR y elige la
  ficha: la que tiene el mismo teléfono que la cuenta (sin cita, con el final de su cédula para comprobar), la de una
  de las citas de hoy que puede ver o una ficha nueva que crea ahí con el teléfono de la cuenta («Paciente nuevo»).
  Antes de eso, la cuenta no ve nada de ese negocio. La ficha DEBE decir si el paciente tiene su cuenta unida, si
  creó una con su teléfono y falta escanearla, o si no tiene (cambio del 2026-11-16).
- **RF-018:** Al escanear un QR unido (o al unirlo), su única cita de hoy pendiente o confirmada DEBE quedar Atendida
  sola, por el mismo camino que la ficha (permisos, alcance del profesional, actividad y emails); con varias, se elige
  cuál (cambio del 2026-11-16).
- **RF-019:** El paciente DEBE ver sólo sus propias tarjetas, de los negocios donde está unido y con la tarjeta
  encendida, y nunca datos de otros pacientes.
- **RF-020:** El equipo DEBE poder generar, para una ficha con cuenta unida, un enlace de un solo uso que vence en 24
  horas para cambiar la contraseña, enviado por WhatsApp al teléfono de la cuenta. El paciente DEBE ver después un
  aviso con el negocio y la fecha.
- **RF-021:** El paciente DEBE poder cambiar su contraseña, salir y eliminar su cuenta.

**Avisos, panel y redes**
- **RF-022:** Al desbloquearse una recompensa DEBE ponerse en cola un email al paciente (si tiene email en la ficha) y
  su copia aparte al profesional. El email de seguimiento de una cita Atendida DEBE mostrar el progreso si la tarjeta
  está encendida.
- **RF-023:** «Fidelización» DEBE mostrar las cifras, los pacientes con su progreso y el historial de recompensas, con
  filtros por paciente, beneficio y estado, y la búsqueda por código.
- **RF-024:** El negocio DEBE poder guardar Facebook, Instagram y TikTok; la tarjeta y la página de reservas DEBEN
  mostrar sólo las que tenga, y nada si no tiene ninguna.
- **RF-025:** Cada acción del equipo que cambia datos (programa, beneficios, unir una cuenta, marcar con el QR, canjear,
  el enlace de contraseña, las redes) DEBE quedar en la actividad. Lo automático (sumar sellos, desbloquear) queda en el
  historial de la tarjeta, no en la actividad.
- **RF-026:** Los textos que hoy prometen «sin cuenta» DEBEN decir la verdad: reservar sigue sin cuenta y la cuenta es
  sólo para la tarjeta. La página de privacidad DEBE explicar la cuenta del paciente y sus datos.
- **RF-027:** La tarjeta DEBE existir sólo en los negocios que habilite el super admin (migración 060); el negocio no
  puede habilitarla. Sin ella no hay «Fidelización», «Escanear» ni «QR para tus pacientes», y la API lo rechaza. Al
  quitarla, el programa se apaga y se guardan los sellos, los premios y las cuentas unidas (cambio del 2026-11-18).


### Entidades

- **Programa de fidelización:** uno por negocio; encendido y desde cuándo, nombre, descripción, sello y qué pasa al
  terminar.
- **Beneficio:** del negocio; lo que se gana y con cuántas citas; activo, archivado.
- **Sello:** una cita Atendida contada para un paciente, con su tarjeta (número de tarjeta y nivel); si se anuló,
  cuándo y quién.
- **Recompensa:** un beneficio ganado por un paciente en una tarjeta; copia del beneficio, código, estado, vencimiento
  y canje (cuándo, quién y en qué cita).
- **Cuenta del paciente:** nombre, teléfono, contraseña cifrada, QR; global, no de un negocio.
- **Unión cuenta–ficha:** qué ficha de qué negocio es esta cuenta, cuándo se unió y quién la escaneó.
- **Enlace para cambiar la contraseña:** de un solo uso, 24 horas, quién lo generó.
- **Redes del negocio:** Facebook, Instagram y TikTok, opcionales.

## Criterios de éxito *(obligatorio)*

- **CE-001:** Las 16 pruebas del pedido pasan en las pruebas automáticas del backend:
  1. crear varios beneficios;
  2. editarlos;
  3. activarlos y desactivarlos;
  4. eliminar uno sin historial;
  5. archivar uno con recompensas;
  6. sumar sellos;
  7. que una cita no cuente dos veces;
  8. desbloquear varios hitos a la vez;
  9. que no haya recompensas duplicadas;
  10. canjear;
  11. que no se canjee dos veces;
  12. conservar los beneficios históricos;
  13. editar sin cambiar lo ganado;
  14. los ciclos y niveles;
  15. el aislamiento entre negocios;
  16. los permisos de pacientes y del equipo.

  Pasan también las pruebas de la cuenta, del QR y de la corrección de una cita.
- **CE-002:** Con la cámara abierta, marcar la cita de hoy de un paciente unido toma un escaneo y un toque
  («Marcar como atendida»).
- **CE-003:** Una cuenta recién creada con el teléfono de otra persona no ve ningún dato de ningún negocio (prueba
  automática).
- **CE-004:** La tarjeta del paciente, «Fidelización», la ficha y «Escanear» se ven sin desplazamiento horizontal a
  390 px y a 1440 px, en claro y en oscuro.
- **CE-005:** Las funciones que ya existen siguen igual: las pruebas del backend y las comprobaciones del front pasan
  completas.

## Alternativas consideradas

- **Enlace privado sin cuenta** (como la encuesta): más simple, pero el dueño quiere que el paciente entre con su
  teléfono y tenga un QR. Descartado por decisión del dueño.
- **Verificar el teléfono con un código por SMS o WhatsApp:** no hay proveedor de SMS y el envío por la API de WhatsApp
  está aplazado. El escaneo en persona cumple esa función.
- **Una cuenta por negocio:** el paciente tendría una contraseña por consultorio. Se elige una cuenta para todos; el
  riesgo que trae está en «Riesgos».
- **Un programa por profesional:** los pacientes son del negocio y en un consultorio con varios profesionales debe
  sumar cualquier cita. Descartado.
- **Contar el historial al encender:** daría de golpe muchas recompensas por citas viejas. Descartado (decisión del
  dueño).
- **Una tabla de versiones de los beneficios:** la copia dentro de cada recompensa cumple lo mismo con menos.
- **Un QR que cambia cada minuto:** evita las fotos del QR, pero pide internet y complica el escaneo. Por ahora el QR es
  fijo, el equipo ve el nombre y la cita de hoy al escanear, y el paciente puede cambiarlo.
- **Que sólo sume el QR:** el dueño eligió que sume cualquier cita Atendida (por si el paciente olvida el celular).
- **Vencimiento por fecha fija:** dejaría inútil lo ganado un día antes. Se usa «vence a los N días».

## Riesgos y cómo se mitigan

- **Alguien crea una cuenta con el teléfono de otro:** no ve nada hasta que un consultorio la une en persona (RF-017),
  y el que escanea elige la ficha entre las citas de hoy.
- **Adivinar contraseñas:** cifrado como las del equipo, límite de intentos, CAPTCHA y bloqueo temporal.
- **Foto del QR:** sólo sirve con una cita de hoy, el equipo ve el nombre al escanear y el paciente puede cambiar el
  QR.
- **Un empleado genera el enlace de contraseña y entra a la cuenta:**
  - el enlace sólo se abre por WhatsApp hacia el teléfono de la cuenta, es de un solo uso y vence en 24 horas;
  - queda en la actividad;
  - el paciente ve el aviso con el nombre del consultorio.

  Riesgo aceptado: en la cuenta sólo hay sellos y premios.
- **Doble canje o dos escaneos a la vez:** el canje y el sello son una sola operación en la base de datos, con
  claves únicas.
- **Una sesión de paciente que llegue al panel:** van aparte (RF-014), con pruebas que lo comprueban.
- **Privacidad:** la tarjeta no muestra nada de la historia clínica. Los servicios de sus visitas sólo los ve el
  paciente dentro de su cuenta. El asunto del email no lleva el servicio.
- **Cupo de Gmail:** el email del premio es uno por recompensa; si no hay cupo, espera.

## Supuestos

- La tarjeta está en todos los planes, como las demás funciones.
- El precio que se ajusta al canjear es el de la cita; no hay facturas ni comprobantes que cambiar.
- Los niveles se llaman Clásica, Plata y Oro y no se configuran.
- Los íconos del sello son una lista fija, de la misma librería de íconos que usa la app.
- El diseño de la tarjeta sigue la imagen de referencia con los colores de cada negocio y la letra de la app. Antes de
  programarla se muestran 2 o 3 vistas previas para elegir.

## Fuera de alcance

- Puntos por montos, compras o productos.
- Tarjetas para el Wallet de iPhone o de Google.
- Enviar mensajes por la API de WhatsApp (sigue aplazado); el WhatsApp es a mano, como en el resto de la app.
- Que el paciente vea, confirme o cancele sus citas desde su cuenta.
- Las recompensas en el informe mensual y en la descarga de datos del negocio.

## Decisiones del dueño del producto (2026-11-16)

1. **Un programa por negocio.**
2. **Sólo cuentan las citas atendidas desde que se enciende.**
3. **El paciente entra con su teléfono y una contraseña, con un QR propio** que escanea el profesional.
4. **Vencimiento opcional,** «vence a los N días».
5. **Al corregir una cita atendida,** se quita el sello y se anulan las recompensas no canjeadas que ya no alcanza.
6. **Al canjear en una cita sin pagar,** el descuento se aplica a su precio.
7. **Configuran** el propietario y los administradores; **canjean** ellos y Recepción.
8. **El email del premio lleva copia aparte al profesional.**
9. **Suma cualquier cita Atendida,** no sólo las del QR.
10. **La contraseña olvidada la resuelve el consultorio** con un enlace por WhatsApp.
11. **Lo que ve el paciente** es como la imagen de referencia.
12. **«Clásica» es el nivel,** y sube con cada tarjeta completa (Plata y Oro).
13. **Las redes del negocio** salen en la tarjeta y en la página de reservas, sólo las que tenga.
14. **Saber quién es (2026-11-16):** al escanear sale primero la ficha con el mismo teléfono, aunque no tenga cita hoy;
    si no hay, «Paciente nuevo». La ficha avisa «Creó su cuenta, falta escanear su QR». Unir sigue siendo en persona.
15. **Al escanear, la cita pasa a Atendida** sin otro toque (2026-11-16).
16. **La contraseña puede ser un PIN de 4 números,** con el bloqueo creciente (2026-11-16).
17. **El QR para los pacientes (2026-11-16):** el consultorio descarga una lámina con un QR a «Mi tarjeta» con su
    nombre, con su logo en el centro (o el de Agenda360 si no tiene), y la comparte por WhatsApp o la imprime.
18. **Sólo en los negocios que habilite el super admin (2026-11-18):** apagada en todos al empezar; el negocio no la
    habilita. Al quitarla se apaga todo (sin «Fidelización», «Escanear» ni sellos; sus pacientes dejan de verla) y se
    guarda lo ganado, que se canjea desde la ficha.
