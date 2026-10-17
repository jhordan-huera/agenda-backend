# Especificación: El aviso de la mañana y el cierre obligatorio del mes

**Carpeta**: `specs/021-aviso-de-la-manana` (rama de trabajo: `dev`) · **Creada**: 2026-10-17

**Estado**: Aprobada (2026-10-17, con el plan)

**Repos**:
- **agenda-backend:** el aviso en el cron, la campana y el celular.
- **agenda-front:** el texto del aviso y su interruptor en «Avisos en tu celular».
- **La beta:** su campana con un aviso de ejemplo.

## Pedido

El dueño del producto, el 2026-10-17: «¿podemos notificar a las 8 de la noche como está y a la hora
que empieza a atender, tipo 8 o 9 de la mañana? Así notificamos dos veces para que el profesional
registre las citas como completadas».

Hoy los avisos de citas sin cerrar son tres:
- uno por cita, 30 minutos después de que termina;
- el resumen de las 8 de la noche, con las citas de hoy;
- la pantalla que bloquea el panel al entrar, con las de días anteriores.

No hay ningún aviso por la mañana que recuerde lo que quedó sin cerrar.

**Decisiones del dueño del producto (2026-10-17):**
1. **A la hora en que empieza a atender.** A cada profesional le llega a la hora de inicio de su
   horario de ese día; si ese día no atiende, no le llega. Al propietario, a la hora en que abre el
   negocio: la primera hora en que atiende alguna agenda ese día.
2. **Cuenta las citas de días anteriores sin cerrar,** es decir, las de ayer o antes que siguen
   Pendientes o Confirmadas. Si no hay ninguna, no llega nada.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El aviso al empezar el día (Prioridad: P1)

**Prueba independiente:** con citas de ayer sin cerrar y un horario que empieza a las 9:00, comprobar
que a las 9:00 llega el aviso, una sola vez, a la campana y al celular, y que no llega a quien no
atiende ese día.

**Escenarios de aceptación**:

1. **Dado** un profesional que hoy atiende desde las 9:00, con 3 citas de días anteriores sin cerrar
   en su agenda, **entonces** a las 9:00 (hora del negocio) le llega «Tienes 3 citas de días
   anteriores sin cerrar», en su campana y en su celular si tiene los avisos activados. Al tocarlo se
   abre la lista «Por cerrar».
2. **Dado** el propietario, **entonces** le llega a la hora en que abre el negocio ese día, con las
   citas de todo el negocio: «Tu negocio tiene N citas de días anteriores sin cerrar».
3. **Dado** que no queda ninguna cita de días anteriores sin cerrar, **entonces** no llega nada.
4. **Dado** que el profesional no atiende ese día, sea por su horario o por un bloqueo de día
   completo, **entonces** no le llega.
5. **Dado** que el cron vuelve a pasar, **entonces** no se repite: llega una vez al día por persona.
6. **Dado** «Avisos en tu celular», **entonces** hay un interruptor «Resumen al empezar el día», que
   viene encendido.

### Historia 2 - Al empezar el mes, cerrar el mes anterior es obligatorio (Prioridad: P1)

El dueño del producto, el 2026-10-17: «además, si en el transcurso del mes no las cerró, el primer
día del siguiente mes tiene obligatoriamente que cerrarlas; si no, no le deja avanzar hasta que las
cierre. Así podemos analizar con datos más verídicos».

**Prueba independiente:** con citas de un mes anterior sin cerrar, entrar al panel y comprobar que no
hay «Más tarde» hasta cerrarlas. Con citas sin cerrar sólo de este mes, comprobar que «Más tarde»
sigue.

**Escenarios de aceptación**:

1. **Dado** que alguien entra al panel con citas sin cerrar de un mes anterior al actual, en la zona
   del negocio, **entonces**:
   - ve la pantalla de citas por cerrar sin el botón «Más tarde»;
   - el texto dice «Empezó un nuevo mes: cierra las citas del mes anterior para seguir»;
   - no puede usar el resto del panel.
2. **Dado** que cierra todas las de meses anteriores, **entonces** entra al panel. Si le quedan del
   mes en curso, vuelve la pantalla de siempre, con «Más tarde».
3. **Dado** que las únicas citas sin cerrar son de este mes, **entonces** todo sigue como en la spec
   018: «Más tarde» cada 4 horas.
4. **Dado** cada rol, **entonces** lo bloquean sólo las suyas, como en la spec 018: el rol Profesional,
   su agenda; el propietario, los administradores y Recepción, el negocio.
5. **Dado** el super admin en modo soporte, **entonces** no se bloquea: ve la franja.

### Historia 3 - El super admin se entera de que salieron (Prioridad: P2)

El dueño del producto, el 2026-10-17: «al super admin también se le notifica, por la app y por ntfy,
que las notificaciones se han enviado y a qué negocios». Eligió que sea **cada vez que salen**.

**Prueba independiente:** con el cron simulado a la hora de los avisos, comprobar que el super admin
recibe uno solo por tanda, con los negocios y sus cifras, en la campana de /admin, en su celular y por
ntfy.

**Escenarios de aceptación**:

1. **Dado** que en una pasada del cron salen avisos de la mañana o el resumen de las 8, **entonces** el
   super admin recibe un aviso:
   - **título:** «Recordatorios de citas por cerrar enviados»;
   - **texto:** «Mañana · 3 negocios: Centro Profesional (6 citas), Dra. Nadia Sanipatín (6), Nicole
     Andrade (1)», o «Noche · …»;
   - **dónde:** en la campana de /admin, en su celular si tiene ese tipo encendido, y por ntfy.
2. **Dado** que en esa pasada no salió ninguno, **entonces** no recibe nada.
3. **Dado** más de 10 negocios, **entonces** se nombran los 10 con más citas y del resto, la cifra:
   «y 4 negocios más».
4. **Dado** el aviso, **entonces** no lleva datos de pacientes, sólo nombres de negocios y cifras.
   - El título no nombra a ningún negocio, porque el registro de GitHub Actions es público.
   - La línea del registro del cron sólo lleva cifras.

### Casos límite

- **Varios horarios en un día** (de 9:00 a 13:00 y de 15:00 a 19:00): cuenta el primero, las 9:00.
- **El propietario que también atiende:** recibe sólo el del negocio, sin uno repetido por su agenda,
  como en el resumen de las 8.
- **Una agenda sin usuario:** no recibe aviso propio; sus citas cuentan en el del propietario.
- **Si el cron no corre a esa hora,** el aviso sale en la primera pasada de las 2 horas siguientes.
  Pasado ese tiempo, ese día no sale.
- **Recepción y los administradores** siguen sin avisos al celular. No tienen agenda propia.
- **El modo soporte** no recibe avisos.

## Requisitos *(obligatorio)*

- **RF-001**: Cada día, a la hora en que empieza a atender, cada profesional con agenda DEBE recibir,
  una sola vez, cuántas citas de días anteriores de su agenda siguen sin cerrar, si hay alguna.
- **RF-002**: El propietario DEBE recibirlo a la hora en que abre el negocio, con las de todo el
  negocio, sin uno repetido por su agenda.
- **RF-003**: Si ese día no atiende (por su horario o por un bloqueo de día completo), NO DEBE
  recibirlo.
- **RF-004**: Va a la campana siempre y al celular si tiene los avisos activados y el tipo encendido.
- **RF-005**: No DEBE llevar datos de pacientes: sólo la cifra.
- **RF-006**: Se prepara en el cron de GitHub, sin gastar CPU de Vercel.
- **RF-007**: La beta DEBE mostrar un aviso de ejemplo en su campana y tener el bloqueo del mes.
- **RF-008**: Con citas sin cerrar de un mes anterior, el panel DEBE bloquearse sin «Más tarde» hasta
  cerrarlas, cada uno con lo suyo. El modo soporte no se bloquea.
- **RF-009**: Con citas sin cerrar sólo del mes en curso, el bloqueo DEBE seguir como en la spec 018,
  con «Más tarde».
- **RF-010**: Cada vez que en una pasada del cron salen avisos de la mañana o el resumen de las 8, el
  super admin DEBE recibir uno solo, con los negocios y sus cifras: en la campana de /admin, en su
  celular y por ntfy. Sin datos de pacientes, y sin nombres de negocios en el título ni en el registro
  del cron.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Con el cron simulado a la hora de inicio, llega un solo aviso por persona, con la cifra
  correcta, y ninguno a quien no atiende ese día. Lo comprueban las pruebas automáticas.
- **CE-002**: Las pruebas pasan y el interruptor nuevo se ve bien a 390 px, en los dos modos.

## Supuestos

- **La hora** es la del negocio (su zona horaria), igual que el resumen de las 8.
- **El texto** es «Tienes N citas de días anteriores sin cerrar» para el profesional y «Tu negocio
  tiene N citas de días anteriores sin cerrar» para el propietario. Abren la lista «Por cerrar».
- **La constitución sube a 1.19.0:** el principio III, donde ya está el resumen de las 8, suma el de
  la mañana.
