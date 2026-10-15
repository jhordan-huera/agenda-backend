# Especificación: Cerrar las citas pendientes de días anteriores

**Carpeta**: `specs/018-cerrar-citas-pendientes` (rama de trabajo: `dev`) · **Creada**: 2026-10-15

**Estado**: Aprobada (2026-10-15, con su plan)

**Repos**:
- **agenda-backend:** la lista y el cierre en bloque.
- **agenda-front:** la lista «Por cerrar» y el bloqueo al entrar.
- **La beta:** sí, con sus citas de prueba (decisión del dueño).

## Pedido

El dueño del producto preguntó el 2026-10-15: «¿qué pasa con las citas anteriores? ¿Cómo le hacemos
para que sea obligatorio que marquen el estado al final del día?». Hoy las citas pasadas sin cerrar se
quedan «Pendiente» o «Confirmada» para siempre, y eso ensucia los reportes y la analítica. El aviso de
las 8 (specs 013, 014 y 017) sólo cuenta las de hoy.

**Decisiones del dueño del producto (2026-10-15):**
1. **Bloquear con «Más tarde».** Al entrar al panel, quien tenga citas sin cerrar de días anteriores
   ve primero la lista. Puede pulsar «Más tarde» una vez cada 4 horas, para atender algo urgente. Le
   vuelve a salir hasta que las cierre.
2. **Nada automático.** Las citas que nadie cierra siguen en la lista hasta que alguien las marque.
3. **Cada uno lo suyo:**
   - el rol Profesional ve las de su agenda;
   - el propietario, los administradores y Recepción, las de todo el negocio, porque también pueden
     cambiar los estados.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - La lista «Por cerrar» (Prioridad: P1)

**Prueba independiente**: con citas pasadas sin cerrar de varios días, abrir la lista, cerrar una por
una y después todas juntas, y comprobar los estados y la actividad.

**Escenarios de aceptación**:

1. **Dado** la agenda, **entonces** hay un botón «Por cerrar (N)», con las citas que ya terminaron y
   siguen «Pendiente» o «Confirmada». Las de días anteriores van arriba, de la más vieja a la más
   nueva, y después las de hoy que ya terminaron.
2. **Dado** cada cita de la lista, **entonces** muestra el día, la hora, el paciente, el servicio y el
   profesional, con los botones «Completada», «No asistió» y «Cancelada».
3. **Dado** «Marcar todas como completadas», **entonces** pide confirmar y cierra todas las de la lista
   que se ven, de una vez.
4. **Dado** que se cierra una cita desde la lista, **entonces** queda en la actividad como cualquier
   cambio de estado. Por defecto no se le escribe al paciente (decisión del dueño), pero hay una
   casilla «Avisar a los pacientes».
5. **Dado** que la lista queda vacía, **entonces** dice «Todo al día».

### Historia 2 - Obligatorio al entrar (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** que alguien entra al panel con citas sin cerrar de días anteriores, **entonces** ve
   primero la pantalla «Antes de seguir, cierra tus citas pendientes», con su lista, y no puede usar el
   resto del panel.
2. **Dado** «Más tarde», **entonces** entra al panel. La pantalla no vuelve a salir en 4 horas en ese
   aparato, pero una franja arriba le recuerda «Tienes N citas por cerrar», con el enlace.
3. **Dado** que cierra todas las de días anteriores, **entonces** entra al panel normalmente. Las de
   hoy no bloquean: el día aún no termina.
4. **Dado** el rol Profesional, **entonces** sólo lo bloquean las de su agenda. Al propietario, a los
   administradores y a Recepción, las de todo el negocio.
5. **Dado** el super admin en modo soporte, **entonces** no se bloquea: ve la franja con la cifra.

### Casos límite

- **Citas con varios pacientes:** se cierra la cita entera.
- **Una cita de una agenda sin usuario:** la cierran el propietario, los administradores o Recepción.
- **Un negocio con cientos de citas viejas sin cerrar:** «Marcar todas como completadas» las cierra
  todas. La lista se carga por tandas.
- **Una cita que alguien cierra mientras otro tiene la lista abierta:** al cerrarla otra vez, se
  respeta el estado que ya tiene y la lista se actualiza.
- **«No asistió»** suma a las inasistencias del paciente, como hoy.
- **La zona horaria:** «días anteriores» es antes de hoy en la zona del negocio.

## Requisitos *(obligatorio)*

- **RF-001**: La agenda DEBE tener la lista «Por cerrar» con las citas que ya terminaron y siguen
  «Pendiente» o «Confirmada»: las de días anteriores primero, después las de hoy.
- **RF-002**: Cada cita de la lista DEBE poder cerrarse como «Completada», «No asistió» o «Cancelada».
  Todas juntas, como «Completada», con confirmación.
- **RF-003**: Cada cierre DEBE quedar en la actividad. Al paciente sólo se le escribe si se marca
  «Avisar a los pacientes».
- **RF-004**: Al entrar al panel con citas sin cerrar de días anteriores, se DEBE mostrar primero la
  lista y no dejar usar el resto, salvo con «Más tarde», una vez cada 4 horas por aparato.
- **RF-005**: Cada persona DEBE ver y quedar bloqueada sólo por lo suyo: el rol Profesional, su agenda;
  el propietario, los administradores y Recepción, el negocio.
- **RF-006**: Nada se DEBE cerrar solo.
- **RF-007**: El super admin en modo soporte NO DEBE quedar bloqueado.
- **RF-008**: La beta DEBE tener la lista y el bloqueo con sus citas de prueba.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Cerrar el día (10 citas) lleva menos de 30 segundos con la lista.
- **CE-002**: Nadie usa el panel con citas de días anteriores sin cerrar sin haber pulsado «Más tarde»
  en las últimas 4 horas (comprobado en pruebas).
- **CE-003**: Las pruebas pasan, y la lista se usa a 390 px sin desplazamiento horizontal.

## Supuestos

- **«Más tarde»** se recuerda en el aparato, como el «Ahora no» de los avisos: es una preferencia de la
  pantalla, no un cambio de datos, así que no va a la actividad.
- **El recordatorio por la mañana de lo de ayer** no entra: lo cubre el bloqueo al entrar.
