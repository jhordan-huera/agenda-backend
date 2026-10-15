# Especificación: Avisos en el celular desde la app instalada

**Carpeta**: `specs/013-avisos-en-la-app` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Aprobada (2026-10-14, con los cambios del dueño)

**Repos**: agenda-backend (principal: los aparatos, el envío y qué avisa) y agenda-front (activar los
avisos, el service worker y abrir lo que avisa). La beta no tiene servidor y queda fuera.

## Pedido

El dueño del producto pidió (idea 5 de las mejoras del 2026-10-14) que **la app avise en el celular**,
como cualquier aplicación: «🔔 Nueva reserva · Mañana 16:00 · Limpieza · Juan P.». Hoy esos avisos
sólo llegan por email.

**Decisiones del dueño del producto (2026-10-14):**
1. **Qué se avisa:**
   - una reserva online nueva (también las «Por verificar» de la spec 009);
   - un comprobante de pago recibido;
   - una cancelación del paciente desde su email (spec 010, cuando exista);
   - una cita nueva en la agenda del propietario que agendó otra persona del equipo.
2. **Quién lo recibe:** **sólo el propietario** del negocio.
3. **Qué dice:** el paciente, a medias («Juan P.»), como en ntfy.
4. **El super admin también recibe avisos en la app,** además de ntfy:
   - un negocio nuevo;
   - una solicitud de cambio de plan;
   - un cambio de seguridad en una cuenta de super admin (spec 009);
   - una alerta de intentos fallidos de inicio de sesión.
5. **Activados para todos por defecto, con opción de desactivar.** No hay que ir a Configuración: al
   entrar al panel se ofrece activarlos con un toque (el navegador siempre pide permiso una vez por
   aparato) y todos los tipos vienen encendidos. En Configuración se desactivan.
6. **Citas sin cerrar:** se avisa cuando una cita ya pasó y sigue «Pendiente» o «Confirmada», para
   marcarla «Completada» o «No asistió».
7. **Resumen a las 8 de la noche** (hora del negocio): «Tienes 3 citas de hoy sin cerrar».

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Los avisos vienen activados (Prioridad: P1)

Al entrar al panel, el propietario ve una vez «Activa los avisos en este celular» y con un toque (más
el permiso del navegador) quedan activados, con todos los tipos encendidos. En Configuración puede
desactivarlos.

**Por qué esta prioridad**: sin activar, no hay avisos; tiene que ser fácil y claro.

**Prueba independiente**: activar en un navegador de escritorio y recibir un aviso de prueba.

**Escenarios de aceptación**:

1. **Dado** que el propietario entra al panel en un aparato sin avisos, **entonces** ve una vez el
   aviso «Activa los avisos en este celular» con «Activar» y «Ahora no». Con «Ahora no», no se vuelve
   a ofrecer en ese aparato durante 7 días; en Configuración se puede activar cuando quiera.
2. **Dado** «Activar» (en el aviso o en Configuración → «Avisos en este celular»), **entonces** el
   navegador pide el permiso. Al aceptarlo llega un aviso de prueba
   («Listo: aquí te avisaremos de las reservas») y la tarjeta dice «Activados en este celular».
3. **Dado** varios aparatos (el celular y la computadora), **entonces** cada uno se activa por
   separado y los avisos llegan a todos.
4. **Dado** «Desactivar en este celular», **entonces** dejan de llegar a ése.
5. **Dado** la tarjeta, **entonces** se puede apagar cada tipo de aviso (por ejemplo, sólo reservas y
   comprobantes).
6. **Dado** un iPhone con la app abierta en Safari sin instalar, **entonces** la tarjeta explica cómo
   instalarla («Compartir → Añadir a pantalla de inicio») porque en iPhone sólo funciona así.
7. **Dado** un permiso rechazado, **entonces** la tarjeta explica cómo volver a permitirlo en los
   ajustes del navegador.

---

### Historia 2 - Le llegan los avisos del negocio (Prioridad: P1)

**Por qué esta prioridad**: es el pedido: enterarse al momento, aunque el email tarde o no se lea.

**Prueba independiente**: hacer una reserva online y comprobar que el aviso llega en segundos.

**Escenarios de aceptación**:

1. **Dado** una reserva online nueva, **entonces** llega «Nueva reserva · {día} {hora} · {servicio} ·
   Juan P.», y si está por verificar, «Por verificar». Al tocarlo se abre la cita en la agenda.
2. **Dado** un comprobante recibido, **entonces** llega «Comprobante de pago · Juan P. · {día}
   {hora}». Al tocarlo se abre la cita.
3. **Dado** una cancelación del paciente desde su email, **entonces** llega «Cita cancelada por el
   paciente · {día} {hora} · Juan P.».
4. **Dado** que Recepción o un administrador le agendan una cita al propietario, **entonces** llega
   «Cita nueva en tu agenda · {día} {hora} · Juan P.». Si la agendó él mismo, no.
5. **Dado** que el aviso aparece en la pantalla bloqueada, **entonces** nunca muestra el nombre
   completo, la cédula, el email, el teléfono ni nada de la historia clínica.

---

### Historia 3 - Citas sin cerrar (Prioridad: P1)

Una cita que ya pasó y sigue «Pendiente» o «Confirmada» deja la agenda y los reportes mal. El
propietario recibe un aviso para cerrarla y, a las 8 de la noche, un resumen del día.

**Por qué esta prioridad**: lo pidió el dueño del producto; los reportes y los emails de seguimiento
(spec 008) dependen de que las citas se cierren.

**Escenarios de aceptación**:

1. **Dado** una cita que terminó hace 30 minutos y sigue «Pendiente» o «Confirmada», **entonces** llega
   «Cita por cerrar · {hora} · {servicio} · Juan P.: márcala Completada o No asistió». Al tocarlo se
   abre la cita con los botones de estado.
2. **Dado** las 8 de la noche en la zona del negocio, **entonces** si quedan citas de hoy sin cerrar
   llega «Tienes 3 citas de hoy sin cerrar», que abre la agenda del día. Si no queda ninguna, no llega
   nada.
3. **Dado** que se cierra la cita antes del aviso, **entonces** no se avisa.
4. **Dado** los dos tipos («Citas por cerrar» y «Resumen de las 8 de la noche»), **entonces** se
   pueden apagar por separado en Configuración.

---

### Historia 4 - El super admin recibe los suyos (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** el super admin con los avisos activados (en Configuración de su panel), **entonces**
   recibe:
   - «Negocio nuevo», cuando alguien se registra;
   - «Solicitud de cambio de plan · {negocio}»;
   - «Cambio de seguridad en una cuenta de super admin»;
   - «Posibles intentos de adivinar contraseñas».
2. **Dado** cada uno, **entonces** al tocarlo se abre la pantalla que corresponde en /admin.
3. **Dado** ntfy, **entonces** sigue igual: estos avisos llegan por los dos canales.

---

### Casos límite

- **Super admin en modo soporte:** no recibe los avisos del negocio que gestiona (son del propietario).
- **Negocio sin propietario** (alta sin propietario): nadie recibe sus avisos hasta que lo tenga.
- **Aparato que ya no existe** (desinstaló la app o borró los datos): el servicio de avisos lo dice y
  se deja de usar solo.
- **Muchas reservas a la vez:** un aviso por cada una. No se agrupan en esta versión.
- **Sin conexión:** el aviso llega cuando el celular se conecta. Si pasan más de 24 horas, se descarta.
- **El propietario cambia** (el super admin asigna otro): los aparatos del anterior dejan de recibir
  los avisos de ese negocio.
- **Avisos que llegan tarde:** los que salen del cron pueden tardar hasta 10 minutos: los del super
  admin (intentos fallidos, cambios de cuenta), las citas por cerrar y el resumen de las 8.
- **Citas sin cerrar de días anteriores:** el aviso por cita es sólo el del día; el resumen de las 8
  cuenta las de hoy. Las viejas siguen visibles en la agenda, como hoy.
- **Un negocio con muchas citas:** un aviso por cita por cerrar; quien no los quiera, apaga ese tipo y
  se queda con el resumen de las 8.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Configuración DEBE tener «Avisos en este celular» para el propietario y para el super
  admin: activar, desactivar, un aviso de prueba y qué tipos de aviso quiere. Todos los tipos vienen
  encendidos.
- **RF-001b**: Al entrar al panel en un aparato sin avisos, se DEBE ofrecer activarlos con un toque
  («Activar» o «Ahora no»; con «Ahora no», no se vuelve a ofrecer en 7 días).
- **RF-002**: Cada aparato DEBE activarse por separado. Un usuario puede tener varios.
- **RF-003**: En iPhone sin la app instalada, la tarjeta DEBE explicar cómo instalarla. Con el permiso
  rechazado, cómo volver a permitirlo.
- **RF-004**: El propietario DEBE recibir un aviso al momento por:
  - cada reserva online nueva (marcando «Por verificar» si lo está);
  - cada comprobante de pago;
  - cada cancelación del paciente desde su email;
  - cada cita nueva en su agenda que agendó otra persona.
- **RF-005**: El super admin DEBE recibir un aviso por:
  - cada negocio nuevo;
  - cada solicitud de cambio de plan;
  - cada cambio de seguridad en una cuenta de super admin;
  - cada alerta de intentos fallidos.
- **RF-005b**: El propietario DEBE recibir un aviso por cada cita que terminó hace 30 minutos y sigue
  «Pendiente» o «Confirmada», y a las 8 de la noche (zona del negocio) un resumen de las citas de hoy
  sin cerrar, si hay alguna. Los dos se pueden apagar por separado.
- **RF-006**: Los avisos DEBEN llevar al paciente a medias («Juan P.») y nunca su cédula, email,
  teléfono ni datos clínicos.
- **RF-007**: Al tocar un aviso se DEBE abrir la pantalla que corresponde (la cita en la agenda, la
  solicitud de plan…), pidiendo iniciar sesión si hace falta.
- **RF-008**: Un aparato que el servicio de avisos da por desaparecido DEBE dejar de usarse solo.
- **RF-009**: Cambiar el propietario de un negocio DEBE dejar de avisar al anterior.
- **RF-010**: Los avisos NO DEBEN depender de servicios de pago. Usan los avisos estándar de los
  navegadores, sin publicar la app en Play Store ni App Store.
- **RF-011**: Si los avisos fallan, el resto (la reserva, los emails) DEBE seguir funcionando igual.

### Entidades clave

- **Aparato con avisos**: de qué usuario es, el permiso del navegador para enviarle avisos, cuándo se
  activó y qué tipos de aviso quiere.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Tras una reserva online, el aviso llega al celular del propietario en menos de 30
  segundos.
- **CE-002**: Activar los avisos lleva menos de un minuto (en Android, escritorio e iPhone con la app
  instalada).
- **CE-003**: Ningún aviso muestra datos completos del paciente (comprobado en pruebas).
- **CE-004**: Las pruebas pasan y la tarjeta se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- **iPhone:** sólo con la app instalada en la pantalla de inicio y iOS 16.4 o más reciente. Es una
  regla de Apple.
- **Lo mismo por email:** los avisos por email de hoy no cambian; el aviso en el celular se suma.
- **Recepción, administradores y el rol Profesional** no reciben avisos en esta versión (decisión del
  dueño). Se podría ampliar después.
- **Claves del servicio de avisos:** un par de claves propio (gratis) que el dueño del producto pondrá
  en Vercel antes de publicar, como `TWO_FACTOR_KEY`.
