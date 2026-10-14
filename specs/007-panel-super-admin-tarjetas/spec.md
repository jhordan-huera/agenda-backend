# Especificación: Panel del super admin con tarjetas y colores propios

**Carpeta**: `specs/007-panel-super-admin-tarjetas` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Implementada (2026-10-14)

**Repos**: agenda-front (principal: las 8 pantallas de `/admin`), agenda-backend (guardar los
colores en la cuenta del super admin, migración 035) y la beta.

## Pedido

El dueño del producto quiere que el panel del super admin se vea **más profesional y con tarjetas en
su gran mayoría**. El cambio es sólo para el panel del super admin, no para el de los negocios.
También pidió que el panel **se pueda personalizar con colores**.

**Decisiones del dueño del producto (2026-10-14):**
1. **Negocios y Usuarios:** en tarjetas, con un botón para pasar a lista.
2. **Ficha del negocio:** una cabecera, 4 cifras y pestañas (Resumen, Equipo, Ajustes y Actividad),
   en vez de una página larga.
3. **Colores:** los elige cada super admin para su propia cuenta.

No cambia lo que se puede hacer en el panel ni los datos que se muestran: es un cambio de forma.
Lo único nuevo que se guarda son los colores de cada super admin.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver los negocios en tarjetas (Prioridad: P1)

El super admin abre Negocios y ve cada negocio en una tarjeta con lo importante, sin leer una tabla.

**Por qué esta prioridad**: es la pantalla que más usa y la que hoy más parece una hoja de cálculo.

**Prueba independiente**: con los negocios de prueba, abrir Negocios y comprobar las tarjetas, los
filtros con su número, la búsqueda y el cambio a lista.

**Escenarios de aceptación**:

1. **Dado** el super admin en Negocios, **cuando** abre la pantalla, **entonces** ve arriba 4 cifras
   (activos, suspendidos, nuevos este mes y cerca del límite de su plan). Debajo hay una tarjeta por
   negocio con:
   - la inicial del negocio, su nombre y su enlace;
   - su plan y su estado;
   - el propietario;
   - el uso: citas del mes y usuarios, con una barra frente a su límite;
   - la fecha de alta y la última actividad;
   - los botones «Ver ficha» y «Página pública».
2. **Dado** el mismo super admin, **cuando** toca el filtro «Pro» (que muestra cuántos negocios
   tiene), **entonces** sólo quedan los negocios Pro. Lo mismo pasa con los estados, y los filtros se
   combinan con la búsqueda.
3. **Dado** el super admin en tarjetas, **cuando** pulsa «Lista», **entonces** ve los mismos negocios
   en una tabla. Al volver otro día en ese equipo, sigue viendo la lista hasta que elija tarjetas.
4. **Dado** un negocio con plan sin límite (Business), **cuando** se ve su tarjeta, **entonces**
   muestra sus cifras sin barra («107 citas · sin límite»).

---

### Historia 2 - La ficha del negocio ordenada en pestañas (Prioridad: P1)

El super admin abre un negocio y encuentra lo que busca sin bajar por una página larga.

**Por qué esta prioridad**: hoy la ficha mide casi tres pantallas y mezcla datos, ajustes y
actividad.

**Prueba independiente**: abrir la ficha de un negocio, recorrer las 4 pestañas y hacer en cada una
lo que hoy se puede hacer: cambiar el plan, agregar un miembro, guardar un ajuste y ver la
actividad.

**Escenarios de aceptación**:

1. **Dado** la ficha de un negocio, **cuando** se abre, **entonces** ve:
   - una cabecera con los colores del panel: inicial, nombre, categoría, fecha de alta, plan, estado
     y las acciones «Gestionar negocio», «Página pública» y «Suspender» (o «Reactivar»);
   - 4 cifras: citas del mes, pacientes, usuarios y agendas, cada una frente a su límite si lo tiene;
   - las pestañas Resumen, Equipo, Ajustes y Actividad, con Resumen abierta.
2. **Dado** la pestaña **Resumen**, **entonces** están la suscripción y el uso (cambiar plan y
   agendas contratadas), el propietario (con cambiar contraseña) y la información del negocio.
3. **Dado** la pestaña **Equipo**, **entonces** están los miembros con su rol, «Agregar» y cambiar
   contraseña.
4. **Dado** la pestaña **Ajustes**, **entonces** están los datos obligatorios del paciente, las citas
   con varios pacientes y, al final y separado, «Eliminar negocio».
5. **Dado** la pestaña **Actividad**, **entonces** están las últimas acciones en el negocio.
6. **Dado** el super admin en la pestaña Equipo, **cuando** recarga la página o vuelve atrás desde
   otra pantalla, **entonces** sigue en Equipo.
7. **Dado** un ajuste con cambios sin guardar, **cuando** cambia de pestaña, **entonces** no pierde lo
   escrito sin aviso.

---

### Historia 3 - El resto del panel con el mismo estilo (Prioridad: P1)

Todas las pantallas del super admin se ven como un mismo producto.

**Por qué esta prioridad**: el pedido es que «se vea más profesional», y eso se logra si todas las
pantallas son coherentes, no sólo una.

**Prueba independiente**: recorrer las 8 pantallas y comprobar el encabezado común, las cifras de
arriba donde corresponda, las tarjetas y que todo lo de hoy siga funcionando.

**Escenarios de aceptación**:

1. **Dado** cualquiera de las 8 pantallas, **cuando** se abre, **entonces** tiene el mismo encabezado:
   título, una línea que explica la pantalla y sus acciones a la derecha (abajo en el celular).
2. **Usuarios:** **dado** el super admin en Usuarios, **entonces**:
   - arriba ve el total, los propietarios, los equipos y las cuentas sin negocio;
   - los filtros son botones con su número: Todos, Propietarios, Equipo, Sin negocio y Super admin;
   - cada cuenta es una tarjeta con avatar, nombre, email, negocio y rol, alta, estado y su menú de
     acciones;
   - el botón «Lista» funciona como en Negocios.
3. **Categorías:** **dado** el super admin en Categorías, **entonces**:
   - arriba ve las categorías activas, las que activan la historia clínica y las que tienen negocios;
   - cada categoría es una tarjeta con su icono, nombre, clave, cuántos negocios la usan, si activa la
     historia clínica, su estado, «Editar» y «Eliminar» (desactivado si tiene negocios, como hoy).
4. **Actividad:** **dado** el super admin en Actividad, **entonces**:
   - arriba ve los emails enviados y fallidos de hoy, los intentos fallidos de inicio de sesión en
     24 h y las cuentas en alerta;
   - la auditoría es una línea de tiempo agrupada por día (Hoy, Ayer y después la fecha), con los
     mismos filtros y la exportación de hoy;
   - los emails enviados se ven en tarjetas con su tipo.
5. **Planes:** **dado** el super admin en Planes, **entonces** ve las 3 tarjetas de hoy con el
   encabezado común, y el plan con más negocios está marcado.
6. **Configuración:** **dado** el super admin en Configuración en la computadora, **entonces** las
   tarjetas van en dos columnas, cada una con su icono en el título.
7. **Inicio:** **dado** el inicio (spec 006), **entonces** usa el mismo encabezado y estilo, sin
   cambiar sus bloques ni sus cifras.

---

### Historia 4 - Los colores de mi panel (Prioridad: P2)

Cada super admin viste su panel con los colores que prefiere.

**Por qué esta prioridad**: lo pidió el dueño del producto, pero el panel se puede usar sin ello.

**Prueba independiente**: elegir una paleta en Configuración, guardar, recorrer el panel, cerrar
sesión, entrar desde otro navegador y comprobar que sigue igual; entrar con otro super admin y ver
que tiene los suyos.

**Escenarios de aceptación**:

1. **Dado** el super admin en Configuración, **cuando** abre «Colores del panel», **entonces** ve
   las mismas paletas listas que tienen los negocios (Agenda360, Eucalipto, Lavanda, Rosa, Turquesa,
   Coral, Oliva y Grafito) y la opción de elegir sus dos colores, con una vista previa.
2. **Dado** que elige «Eucalipto», **cuando** guarda, **entonces** todo el panel de plataforma usa
   esos colores al momento: botones, menú lateral, insignias, cabeceras, gráficos, diálogos y menús.
3. **Dado** ese super admin, **cuando** cierra sesión y entra desde otro equipo, **entonces** ve su
   panel con sus colores.
4. **Dado** otro super admin del equipo, **cuando** entra, **entonces** ve sus propios colores (o los
   de Agenda360 si no eligió), no los del primero.
5. **Dado** el super admin con colores propios, **cuando** pulsa «Gestionar negocio», **entonces** el
   panel del negocio se ve con los colores de ese negocio, como hoy.
6. **Dado** que elige «Agenda360» y guarda, **entonces** el panel vuelve a los colores de siempre.

---

### Casos límite

- **Negocio sin propietario:** su tarjeta dice «Sin propietario».
- **Nombres largos:** se cortan con «…» en la tarjeta, sin romper la cuadrícula. El nombre completo
  se ve al pasar el cursor y en la ficha.
- **Sin resultados:** con una búsqueda o un filtro sin resultados, se ve un aviso con «Limpiar
  filtros».
- **Negocio suspendido:** su tarjeta muestra el estado en ámbar y la cabecera de su ficha ofrece
  «Reactivar».
- **Plataforma con muchos negocios** (p. ej. 200): las tarjetas siguen cargando bien, y la lista
  sirve para verlos de un vistazo.
- **Cuenta super admin en Usuarios:** sin menú de acciones, como hoy (se gestiona en Configuración).
- **Colores poco legibles:** si los dos colores elegidos no se leen bien sobre blanco, se ajustan
  como en los negocios, para que el texto mantenga el contraste.
- **Colores que no se pudieron guardar** (sin conexión): se avisa y el panel sigue con los de antes.
- **Equipo compartido:** si dos super admins usan el mismo navegador, cada uno ve sus colores al
  entrar. La preferencia de tarjetas o lista sí es de ese equipo.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Las 8 pantallas del super admin (Inicio, Negocios, ficha del negocio, Usuarios, Planes,
  Categorías, Actividad y Configuración) DEBEN usar el mismo encabezado: título, descripción y
  acciones.
- **RF-002**: Negocios, Usuarios, Categorías y Actividad DEBEN mostrar arriba una fila de cifras, cada
  una con su icono, sacadas de datos que el panel ya tiene.
- **RF-003**: Los filtros de Negocios (plan y estado) y de Usuarios (tipo de cuenta) DEBEN ser botones
  con su número, combinables con la búsqueda.
- **RF-004**: Negocios DEBE mostrar cada negocio en una tarjeta con lo de la historia 1. El uso con
  límite DEBE tener una barra, y sin límite sólo la cifra.
- **RF-005**: Negocios y Usuarios DEBEN tener un botón para pasar de tarjetas a lista y volver. La
  elección se recuerda en ese equipo. Por defecto, tarjetas.
- **RF-006**: Usuarios DEBE mostrar cada cuenta en una tarjeta con avatar, nombre, email, negocio y
  rol, alta, estado y su menú de acciones de hoy.
- **RF-007**: La ficha del negocio DEBE tener la cabecera, las 4 cifras y las 4 pestañas de la
  historia 2. La pestaña abierta DEBE mantenerse al recargar o volver atrás.
- **RF-008**: Categorías DEBE mostrar cada categoría en una tarjeta con lo de la historia 3.
- **RF-009**: Actividad DEBE mostrar la auditoría agrupada por día (Hoy, Ayer, fecha), con sus filtros
  y la exportación, y los emails enviados en tarjetas.
- **RF-010**: Planes, Configuración e Inicio DEBEN tener el mismo encabezado y estilo. Configuración
  va en dos columnas en pantallas anchas.
- **RF-011**: Todo lo que hoy se puede hacer en el panel del super admin DEBE seguir pudiéndose hacer,
  con las mismas reglas y avisos.
- **RF-012**: Configuración DEBE tener «Colores del panel», con las paletas listas de los negocios, la
  opción de elegir dos colores y una vista previa.
- **RF-013**: Los colores DEBEN guardarse en la cuenta de cada super admin. Sólo él puede cambiarlos y
  se ven en cualquier equipo donde entre.
- **RF-014**: Los colores elegidos DEBEN aplicarse a todo el panel de plataforma, incluidos los
  diálogos, los menús y los gráficos. Sin colores elegidos se usan los de Agenda360.
- **RF-015**: Los colores del super admin NO DEBEN aplicarse al panel de un negocio («Gestionar
  negocio»), ni a la portada, el inicio de sesión o la página de reservas.
- **RF-016**: Ninguna pantalla DEBE mostrar datos de pacientes que hoy no muestre.
- **RF-017**: Todo DEBE funcionar en el celular (390 px) sin desplazamiento horizontal y ser accesible:
  etiquetas, foco visible, contraste y lectura con lector de pantalla.
- **RF-018**: La beta DEBE tener el mismo panel con sus datos de prueba, incluidos los colores por
  cuenta.

### Entidades clave

- **Colores del panel de un super admin**: dos colores (el principal y el de resaltar), o ninguno
  para usar los de Agenda360. Pertenecen a una cuenta de super admin.
- **Preferencia de vista** (tarjetas o lista): de ese equipo, por pantalla (Negocios y Usuarios). No
  se guarda en la cuenta.

## Criterios de éxito *(obligatorio)*

- **CE-001**: El 100 % de las acciones que hoy tiene el panel del super admin siguen funcionando,
  comprobadas una por una en el recorrido: crear, suspender, reactivar y eliminar negocio; cambiar
  plan y agendas; agregar miembros; cambiar contraseñas; categorías; solicitudes de plan; exportar la
  auditoría; ajustes de soporte; equipo de la plataforma; verificación en dos pasos y contraseña.
- **CE-002**: En la ficha de un negocio, cualquier ajuste se alcanza con un toque de pestaña y sin
  bajar más de una pantalla en la computadora.
- **CE-003**: Los colores guardados se ven en todo el panel al momento. Siguen al entrar desde otro
  navegador y no cambian el panel de otro super admin.
- **CE-004**: Con cualquier paleta, los textos y botones mantienen un contraste de al menos 4,5:1 (y
  3:1 en elementos grandes y gráficos).
- **CE-005**: Las 8 pantallas se usan a 390 px sin desplazamiento horizontal.
- **CE-006**: Las pruebas automáticas pasan, incluida la de guardar los colores: sólo los cambia su
  dueño y un negocio no puede usarlos.

## Supuestos

- Las cifras de arriba salen de datos que el panel ya carga o que ya da el servidor (inicio del super
  admin, spec 006). En Actividad se usan los emails de hoy, los intentos fallidos y las cuentas en
  alerta en vez de «acciones de hoy»: la auditoría llega por páginas y contarla exigiría un dato
  nuevo.
- Las paletas y la forma de calcular los tonos son las mismas que usan los negocios. Así no hay dos
  sistemas de colores distintos.
- El inicio de sesión y la pantalla de activar la verificación en dos pasos no cambian.
- El orden de los negocios y de las cuentas es el de hoy (los más nuevos primero).
- No se añade paginación: hoy se cargan todos y la plataforma tiene pocos negocios.
