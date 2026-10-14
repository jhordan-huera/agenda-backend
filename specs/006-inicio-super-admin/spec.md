# Especificación: Inicio del super admin con datos importantes

**Carpeta**: `specs/006-inicio-super-admin` (rama de trabajo: `dev`)

**Creada**: 2026-10-13

**Estado**: Implementada (2026-10-14)

**Repos**: agenda-backend (principal: cifras, salud del sistema y la migración 034), agenda-front
(pantalla `/admin`) y la beta.

## Pedido

El dueño del producto quiere que la pantalla de inicio del super admin muestre **datos
importantes**. El primer cambio, un «centro de control» con una tabla de actividad y gráficos (commit
`b728278`), no le gustó.

**Decisión del dueño del producto (2026-10-13):** eligió tres bloques y aprobó en la conversación el
diseño y cómo se calcula cada dato:
1. **Crecimiento del mes.**
2. **Salud del sistema.**
3. **Negocios para vender.**

Descartó, por ahora, mostrar ingresos: los precios se acuerdan con cada negocio y no se guardan.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Ver cómo crece la plataforma este mes (Prioridad: P1)

El super admin entra y ve de inmediato si la plataforma va mejor o peor que el mes pasado.

**Prueba independiente**: con datos conocidos de este mes y del pasado, comprobar cada cifra y su
diferencia en porcentaje.

**Escenarios de aceptación**:

1. **Dado** el día 13 del mes, **cuando** el super admin abre el inicio, **entonces** ve cuatro
   cifras, cada una frente a los días 1 a 13 del mes pasado, con la diferencia (▲ sube, ▼ baja o
   «igual»):
   - citas agendadas en lo que va del mes;
   - reservas online;
   - pacientes nuevos;
   - negocios nuevos.
2. **Dado** una cifra del mes pasado en cero, **cuando** este mes hay algo, **entonces** se muestra
   «nuevo» en lugar de un porcentaje imposible. Si los dos meses están en cero, se muestra «igual».
3. **Dado** cualquier cifra, **cuando** se muestra, **entonces** dice con qué se compara (por
   ejemplo, «233 del 1 al 13 de septiembre»).

---

### Historia 2 - Saber si el sistema está sano (Prioridad: P1)

El super admin ve si los emails salen, si el cron corre, si hay copia de seguridad reciente y si
alguien intenta adivinar contraseñas, sin tener que revisar GitHub ni los registros.

**Prueba independiente**: con un cron atrasado, emails fallidos y una copia de seguridad vieja,
comprobar que cada cuadro cambia de color y que el estado general cuenta los avisos.

**Escenarios de aceptación**:

1. **Dado** el día de hoy, **cuando** abre el inicio, **entonces** ve los emails de hoy:
   - enviados;
   - fallidos, sin contar los que el sistema descarta a propósito (un recordatorio que ya no vale, una
     dirección de demostración);
   - en cola.

   Con algún fallido, el cuadro se pone ámbar.
2. **Dado** la última pasada del cron, **cuando** se muestra, **entonces** dice hace cuánto pasó y
   si tuvo errores:
   - verde si pasó hace 30 minutos o menos y sin errores;
   - ámbar si pasó hace más de 30 minutos;
   - rojo si pasó hace más de 2 horas o tuvo errores (negocios con fallos o emails que no salieron).
3. **Dado** la última copia de seguridad, **cuando** se muestra, **entonces** dice cuándo se hizo y
   su tamaño:
   - verde hasta 8 días;
   - ámbar entre 8 y 15 días;
   - rojo si tiene más de 15 días o si la última falló.

   Sin ninguna copia anotada, dice «Sin copias registradas todavía», en ámbar.
4. **Dado** los intentos fallidos de inicio de sesión, **cuando** se muestran, **entonces** dice:
   - cuántos hubo en las últimas 24 horas;
   - cuántas cuentas tienen una alerta, que son las que tuvieron 10 o más intentos fallidos en la
     última hora, como las que avisa el cron por ntfy.

   Con alguna cuenta en alerta, el cuadro se pone rojo.
5. **Dado** los cuatro cuadros, **cuando** se muestra el bloque, **entonces** arriba dice «Todo bien»
   si todos están en verde, o «N avisos» con la cantidad de cuadros en ámbar o rojo.

---

### Historia 3 - Encontrar negocios a los que venderles (Prioridad: P1)

El super admin ve a quién ofrecerle un plan mejor, quién está creciendo y quién dejó de usar el
sistema.

**Prueba independiente**: con un negocio Free al 80 % de sus citas, uno que crece y uno sin
actividad, comprobar que cada uno aparece en su lista.

**Escenarios de aceptación**:

1. **Cerca del límite:**
   - **Dado** un negocio activo que usa el 80 % o más de las citas del mes o de los pacientes de su
     plan, **cuando** se abre el inicio, **entonces** aparece con su uso (por ejemplo, «20 de 20 citas
     del mes») y el plan que conviene ofrecerle («ofrecerle Pro»).
2. **Los que más crecen:**
   - **Dado** los negocios activos, **cuando** se calcula, **entonces** aparecen hasta 5, ordenados
     por cuánto crecieron sus citas agendadas frente a los mismos días del mes pasado.
   - Sólo cuentan los que crecieron y tienen al menos 5 citas este mes.
3. **Dejaron de usarlo:**
   - **Dado** un negocio activo sin actividad hace 14 días o más, que no se creó en esos días,
     **cuando** se abre el inicio, **entonces** aparece con «sin actividad hace N días».
4. **Dado** cada negocio de las listas, **cuando** se pulsa, **entonces** abre su ficha.
5. **Dado** una lista sin negocios, **cuando** se muestra, **entonces** lo dice en una frase («Nadie
   cerca del límite»), sin quedar vacía.

---

### Historia 4 - Lo de siempre, arriba y en su lugar (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** el inicio, **cuando** se abre, **entonces** arriba muestra:
   - el saludo y la fecha;
   - una línea con los negocios activos por plan (por ejemplo, «5 negocios activos: 3 Free · 1 Pro ·
     1 Business»);
   - el botón «Nuevo negocio».
2. **Dado** una solicitud de cambio de plan pendiente, **cuando** se abre el inicio, **entonces** se
   puede aprobar o rechazar ahí mismo, como hoy. Sin pendientes, no ocupa lugar.
3. **Dado** el celular, **cuando** se abre el inicio, **entonces** todo se lee sin desplazamiento
   horizontal y cada bloque queda en una columna.

---

### Casos límite

- **Primer mes de la plataforma** o meses sin datos: las comparaciones muestran «nuevo» o «igual»,
  nunca un error ni un porcentaje infinito.
- **Fin de mes:** el 31 se compara con los días 1 a 31 del mes pasado. Si el mes pasado tuvo menos
  días, se compara con el mes pasado completo.
- **Negocios suspendidos:** no aparecen en «Negocios para vender», pero sí cuentan en el crecimiento
  de la plataforma.
- **Plan Business:** no tiene tope de citas ni de pacientes, así que nunca aparece «cerca del límite».
- **Copia de seguridad que falla:** queda anotada como fallida y el cuadro se pone rojo, aunque haya
  una buena anterior.
- **Cron sin ninguna pasada registrada** (base nueva): «Sin pasadas registradas», en ámbar.
- **Zona horaria:** «hoy» y «este mes» son los de Ecuador, la zona del panel de plataforma.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: El inicio del super admin DEBE mostrar el crecimiento del mes: citas agendadas (sin
  las canceladas), reservas online, pacientes nuevos y negocios nuevos, desde el día 1 hasta hoy,
  cada una frente a los mismos días del mes pasado, con la diferencia en porcentaje. Si el mes pasado
  fue 0, dice «nuevo»; si los dos son 0, «igual».
- **RF-002**: DEBE mostrar los emails de hoy: enviados, fallidos (sin los descartados a propósito) y
  en cola.
- **RF-003**: DEBE mostrar la última pasada del cron, hace cuánto fue y si tuvo errores, con los
  colores de la historia 2.
- **RF-004**: Cada copia de seguridad, buena o fallida, DEBE quedar anotada con su fecha, su tamaño y,
  si falló, el motivo, sin datos personales. El inicio DEBE mostrar la última, con los colores de la
  historia 2.
- **RF-005**: DEBE mostrar los intentos fallidos de inicio de sesión de las últimas 24 horas y cuántas
  cuentas están en alerta (10 o más en la última hora).
- **RF-006**: El bloque de salud DEBE resumir arriba «Todo bien» o «N avisos».
- **RF-007**: DEBE listar los negocios activos cerca del límite de su plan (80 % o más de las citas
  del mes o de los pacientes), con su uso y el plan siguiente para ofrecer.
- **RF-008**: DEBE listar hasta 5 negocios activos que más crecen en citas agendadas frente a los
  mismos días del mes pasado, con al menos 5 citas este mes.
- **RF-009**: DEBE listar los negocios activos sin actividad hace 14 días o más, salvo los creados en
  esos días.
- **RF-010**: Arriba DEBE mostrar el saludo, la fecha, los negocios activos por plan y el botón
  «Nuevo negocio». Las solicitudes de cambio de plan pendientes DEBEN poder resolverse en el inicio, y
  sin pendientes no se muestran.
- **RF-011**: Salen del inicio la tabla de actividad, el gráfico de altas y el reparto por planes del
  diseño anterior.
- **RF-012**: Sólo el super admin DEBE poder ver estos datos. No DEBEN aparecer datos de pacientes:
  sólo cifras y nombres de negocios.
- **RF-013**: La beta DEBE mostrar la misma pantalla con sus datos de prueba. Donde no tenga un dato
  (cron, copias, emails reales), lo dice.

### Entidades clave

- **Copia de seguridad registrada**: cuándo se hizo, si salió bien, su tamaño y el motivo si falló.
- **Pasada del cron**: ya existe. Se usa la última, con su hora y su resumen.
- **Crecimiento**: cifras del periodo actual y del periodo comparable del mes pasado, de la plataforma
  y de cada negocio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Al abrir el inicio, el super admin sabe en menos de 10 segundos si la plataforma crece,
  si el sistema está sano y a qué negocios llamar.
- **CE-002**: En pruebas, el 100 % de las cifras de crecimiento y de salud coinciden con los datos
  preparados, incluidos los casos con el mes pasado en cero.
- **CE-003**: En pruebas, un cron atrasado, un email fallido, una copia vieja o fallida y una cuenta
  en alerta cambian el color de su cuadro y el resumen del bloque.
- **CE-004**: Ningún dato de pacientes aparece en el inicio ni en la respuesta del servidor que lo
  alimenta.
- **CE-005**: Las pruebas automáticas pasan y la pantalla se usa sin desplazamiento horizontal a
  390 px de ancho.

## Supuestos

- «Citas agendadas» cuenta las citas creadas en el periodo, sea para el día que sea, y no cuenta las
  que ya están canceladas. Así se mide la actividad, no la agenda.
- «Actividad» de un negocio es la que ya muestra el panel de plataforma: su último movimiento
  registrado.
- La copia de seguridad semanal ya existe. Esta función sólo la anota y la muestra. Las copias
  anteriores a la función no aparecen hasta la primera nueva.
- Los ingresos quedan fuera: los precios no se guardan.
