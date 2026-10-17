# Especificación: Modo oscuro en todo el sistema, con los colores de cada negocio

**Carpeta**: `specs/019-modo-oscuro` (rama de trabajo: `dev`) · **Creada**: 2026-10-16

**Estado**: Spec aprobada (2026-10-16, «si») · plan por aprobar

**Repos**:
- **agenda-backend:** el modo elegido, guardado en la cuenta de cada usuario, y su registro en la
  actividad.
- **agenda-front:** todo lo visual, es decir, la versión oscura de cada pantalla.
- **La beta:** sí, con sus cuentas de prueba (por defecto, salvo que el dueño diga lo contrario).

## Pedido

El dueño del producto preguntó el 2026-10-16: «¿podemos implementar un modo oscuro en todo el sistema,
pero con los colores personalizados?».

Hoy todo el sistema es claro. Cada negocio, y cada super admin para su panel, elige dos colores: el
principal y el de resaltar. Con ellos se calcula el resto: fondos, textos, bordes y gráficos.

**Decisiones del dueño del producto (2026-10-16):**
1. **Se elige en la cuenta.** Hay tres opciones: «Claro», «Oscuro» y «Automático», que sigue al modo
   del celular o de la computadora. Se elige una vez y se ve igual en todos los equipos donde entre la
   persona.
2. **Todos empiezan en «Automático»**, también los usuarios que ya existen. Quien tenga su aparato en
   modo oscuro verá el sistema oscuro desde el día en que se publique.
3. **Las páginas de los pacientes siguen al celular del paciente.** Son la de reservas, la de pago y
   la de su cita. Llevan los colores del negocio.
4. **Los colores del negocio se ajustan solos.** En modo oscuro se usan los mismos dos colores, con el
   mismo tono y la claridad justa para que todo se lea bien sobre fondo oscuro. El negocio no tiene
   que hacer nada.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Elegir el modo en la cuenta (Prioridad: P1)

Cualquier persona del equipo de un negocio, y cada super admin, elige cómo quiere ver el sistema.

**Prueba independiente**:
1. Una persona elige «Oscuro» en una computadora y ve el cambio al momento.
2. Entra con su cuenta en otro aparato y lo ve también oscuro.
3. La actividad registra el cambio.

**Escenarios de aceptación**:

1. **Dado** Configuración → Perfil, en el panel del negocio y en /admin, **entonces** hay una sección
   «Modo de pantalla» con «Claro», «Oscuro» y «Automático». «Automático» viene marcado por defecto.
2. **Dado** que la persona elige un modo, **entonces** el sistema cambia al instante, sin recargar, y
   queda guardado en su cuenta.
3. **Dado** que la persona entra con su cuenta en otro aparato, **entonces** ve el modo que eligió.
4. **Dado** «Automático», **entonces** el sistema se ve oscuro cuando el aparato está en modo oscuro
   y claro cuando no. Si el aparato cambia solo, por ejemplo al anochecer, el sistema cambia también,
   sin recargar.
5. **Dado** el cambio de modo, **entonces** queda en la actividad: quién, cuándo, y de qué modo pasó a
   cuál.
6. **Dado** que dos personas usan la misma computadora, **entonces** cada una ve su propio modo al
   iniciar sesión.

### Historia 2 - Todo el sistema en oscuro, con los colores del negocio (Prioridad: P1)

**Prueba independiente**: con el modo oscuro, recorrer todas las pantallas con los colores de
Agenda360 y con varios colores de negocio, incluidos colores extremos. Comprobar que todo se lee y que
no queda ninguna zona blanca de sobra.

**Escenarios de aceptación**:

1. **Dado** el modo oscuro, **entonces** se ven oscuros todos estos:
   - el panel del negocio, con todas sus páginas, diálogos, menús, avisos y la campana;
   - la agenda, con el color de cada profesional;
   - los reportes y sus gráficos;
   - la historia clínica, con el odontograma y el mapa del cuerpo;
   - la importación de pacientes;
   - la pantalla de citas por cerrar;
   - /admin, con su analítica y su salud.
2. **Dado** un negocio con colores propios, **entonces** en modo oscuro se reconocen sus colores:
   - los botones, lo activo del menú y los gráficos llevan el mismo tono;
   - los fondos van oscuros con un toque de ese tono.
3. **Dado** cualquier color que haya elegido un negocio, **entonces** los textos se leen bien sobre
   su fondo en los dos modos. Si hace falta, el sistema aclara o oscurece el color lo justo, como ya
   hace hoy en el modo claro.
4. **Dado** los estados de las citas («Pendiente», «Confirmada», «Completada», «No asistió»,
   «Cancelada») y los avisos de éxito, alerta y error, **entonces** en modo oscuro se distinguen entre
   sí igual que en el claro.
5. **Dado** la vista previa de los colores en Configuración, **entonces** muestra cómo quedan en los
   dos modos, el claro y el oscuro.
6. **Dado** el super admin en modo soporte, **entonces** ve el panel del negocio con su propio modo y
   con los colores del negocio.

### Historia 3 - Pacientes y pantallas antes de iniciar sesión (Prioridad: P1)

**Prueba independiente**: abrir la página de reservas en un celular en modo oscuro y en otro en modo
claro, y comprobar que cada una sigue a su celular, con los colores del negocio.

**Escenarios de aceptación**:

1. **Dado** la página de reservas, la de pago o la de la cita, **entonces** se ve oscura si el celular
   del paciente está en modo oscuro y clara si no, siempre con los colores del negocio.
2. **Dado** la portada, el inicio de sesión, el registro, recuperar la contraseña o la política de
   privacidad:
   - si ese aparato ya tiene guardada la última elección de alguien que entró en él, se usa esa;
   - si no, siguen al modo del aparato.
3. **Dado** el mapa de la página de reservas, **entonces** en modo oscuro también se ve oscuro y se
   lee.

### Historia 4 - Sin destellos al abrir (Prioridad: P2)

**Prueba independiente**: con el aparato en modo oscuro, abrir el sistema, recargar y entrar desde la
app instalada. No debe verse ningún destello blanco.

**Escenarios de aceptación**:

1. **Dado** el modo oscuro, **entonces** la pantalla de carga y la primera pantalla se ven oscuras
   desde el primer instante, sin un destello blanco antes.
2. **Dado** la app instalada en el celular, **entonces** la barra de arriba del celular toma el color
   del modo.

### Casos límite

- **Lo que sigue claro en los dos modos:**
  - los emails;
  - los reportes impresos o en PDF;
  - el código QR, que necesita fondo blanco para escanearse;
  - las fotos y los archivos de la historia clínica, que se ven tal como son.
- **Imprimir desde el modo oscuro** sale igual que hoy, en claro.
- **Un logo oscuro con fondo transparente** no debe desaparecer sobre el fondo oscuro: va sobre una
  placa clara.
- **Colores extremos del negocio,** como un principal casi negro, uno casi blanco, uno gris o uno muy
  chillón: en los dos modos todo se lee, y el oscuro no se ve chillón.
- **El color de cada profesional en la agenda:** en modo oscuro se siguen distinguiendo entre sí y el
  texto de la cita se lee.
- **Un aparato o navegador que no informa su modo:** «Automático» se ve claro.
- **Sin conexión, o mientras carga la cuenta:** se usa la última elección guardada en ese aparato,
  para no cambiar de modo a mitad de la carga.

## Requisitos *(obligatorio)*

- **RF-001**: Cada usuario, del equipo de un negocio o super admin, DEBE poder elegir «Claro», «Oscuro»
  o «Automático» en Configuración → Perfil. La elección se guarda en su cuenta.
- **RF-002**: Los usuarios existentes y los nuevos DEBEN empezar en «Automático».
- **RF-003**: El cambio DEBE verse al instante, sin recargar. En otro aparato, la próxima vez que se
  abra el sistema.
- **RF-004**: Cada cambio de modo DEBE quedar en la actividad, con el modo anterior y el nuevo.
- **RF-005**: Con el modo oscuro, todas las pantallas del panel del negocio, de /admin, de los
  pacientes y de antes de iniciar sesión DEBEN verse oscuras, sin zonas blancas de sobra. Quedan fuera
  los emails, lo impreso o en PDF, el código QR, las fotos y los archivos.
- **RF-006**: En modo oscuro se DEBEN usar los mismos colores que eligió cada negocio o super admin,
  ajustados solos. Los colores de Agenda360 también tienen su versión oscura.
- **RF-007**: Los textos DEBEN leerse con contraste suficiente en los dos modos, con cualquier color
  de negocio: al menos 4,5 a 1 en los textos normales.
- **RF-008**: Los estados de las citas, los avisos y los colores de cada profesional DEBEN
  distinguirse entre sí en los dos modos.
- **RF-009**: La vista previa de colores en Configuración DEBE mostrar los dos modos.
- **RF-010**: Las páginas de los pacientes DEBEN seguir al modo de su aparato. Las de antes de iniciar
  sesión, a la última elección guardada en el aparato o, si no hay, al modo del aparato.
- **RF-011**: Con el modo oscuro, NO DEBE verse un destello blanco al abrir o recargar. La barra del
  celular de la app instalada toma el color del modo.
- **RF-012**: En modo soporte, el super admin DEBE ver el panel del negocio con su propio modo y con
  los colores del negocio.
- **RF-013**: La beta DEBE tener el modo oscuro y la elección en sus cuentas de prueba.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pantallas principales cumplen el contraste en los dos modos con los colores de
  Agenda360, con cada combinación de colores que el sistema ofrece al negocio y con cuatro colores
  extremos (casi negro, casi blanco, gris y chillón):
  - el panel: Inicio, Agenda, Pacientes, Historia clínica, Reportes y Configuración;
  - /admin: Inicio, Analítica y Salud;
  - las páginas de los pacientes: Reservas, Pago y Cita.
- **CE-002**: En un recorrido de todas las pantallas en modo oscuro, no aparece ninguna zona blanca de
  sobra ni ningún texto ilegible.
- **CE-003**: Cambiar el modo se ve en menos de un segundo, sin recargar.
- **CE-004**: Al abrir o recargar en modo oscuro, ninguna captura de los primeros instantes muestra un
  destello blanco.
- **CE-005**: Las pruebas pasan, y a 390 px no hay desplazamiento horizontal en ninguno de los dos
  modos.

## Entidades

- **Modo de pantalla del usuario**: «Claro», «Oscuro» o «Automático». Por defecto, «Automático».
  Pertenece a la persona, no al negocio: cada uno del equipo elige el suyo.

## Supuestos

- **Los pacientes no eligen el modo:** la página sigue a su celular. No hay un botón para cambiarlo.
- **Las personas del equipo eligen el modo en Configuración → Perfil**, la pestaña que ve cada rol,
  también el Profesional.
- **El modo no cambia los colores del negocio** ni los de otros super admins. Sólo cambia cómo los ve
  cada persona.
- **La última elección se recuerda también en el aparato,** sólo para no mostrar un destello al
  cargar y para las pantallas de antes de iniciar sesión. Lo que manda es lo guardado en la cuenta.
- **La constitución sube de versión (1.16.0):** el principio VII deja de decir «estilo SaaS claro»
  para decir que hay dos modos, claro y oscuro, los dos con contraste suficiente y con los colores del
  negocio.
- **Al publicar se avisa a los negocios con un mensaje,** porque quien tenga su aparato en modo oscuro
  verá el cambio sin haberlo pedido.
