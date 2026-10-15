# Especificación: Endurecimiento de seguridad

**Carpeta**: `specs/009-endurecimiento-seguridad` (rama de trabajo: `dev`)

**Creada**: 2026-10-14

**Estado**: Publicada (2026-10-14, PR backend #25 y front #23)

**Repos**:
- agenda-backend (principal): inicio de sesión, avisos, reserva pública, emails, configuración y la
  migración 036;
- agenda-front:
  - cerrar sesión, privacidad y CSP;
  - el proxy de `/api` y las peticiones públicas;
  - la reserva «Por verificar» en el panel;
- la beta, sólo en lo que se ve en su interfaz.

**Migración**: sí (036).

## Pedido

El dueño del producto pidió revisar si el front y el backend cumplen con la seguridad informática.
Se revisó el código de los dos repos en cuatro partes:
- el inicio de sesión;
- los permisos entre negocios y roles;
- las entradas, los archivos y los secretos;
- el front.

Cada hallazgo se comprobó en el código. No hubo nada de gravedad crítica ni alta. Las dependencias no
tienen vulnerabilidades conocidas y no hay secretos en el historial de git.

**Decisiones del dueño del producto (2026-10-14):**
1. Esta spec reúne los dos puntos de gravedad media del inicio de sesión (historias 1 y 2) y todos los
   de gravedad baja («procede por favor»).
2. **Reserva con la cédula de un paciente y otros datos** (el tercer punto de gravedad media):
   - **Hoy:** se rechaza con «No pudimos confirmar tus datos».
   - **Ahora:** se acepta como cualquier reserva nueva y queda **«Por verificar»**, aparte de la ficha,
     hasta que el negocio la una a la ficha o la cancele (historia 3).
   - **Por qué:** quita la pista de si alguien es paciente y deja reservar a quien cambió de celular y
     de email.
   - **Qué cambia:** la decisión del 2026-10-09 en ese caso. Sigue sin reconocerse al paciente por la
     cédula.
3. **«Recordarme»:** como mucho 30 días desde que se inicia la sesión, y 7 días para el super admin.
4. **Teléfono en ntfy:** se muestra como «***5555», sólo los últimos 4 dígitos. Hoy es «099***5555».
5. Ninguna otra decisión guardada (principio III) cambia. En particular, siguen igual:
   - el super admin pone las contraseñas y las envía por email; no hay «olvidé mi contraseña»;
   - el modo soporte tiene permisos de propietario y acceso a la historia clínica, y no se registran
     sus consultas;
   - los repositorios son públicos;
   - la copia al profesional es obligatoria;
   - ntfy lleva los datos a medias;
   - la reserva online pide cédula, nombre, email y teléfono.
6. Recepción sigue viendo los precios de las citas y lo que gastó cada paciente. No es un fallo sino
   una decisión del negocio, y queda fuera.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Los topes de intentos no se pueden saltar (Prioridad: P1)

Hoy se bloquea un inicio de sesión tras muchos intentos fallidos. Los topes son:
- 10 fallos por cuenta y conexión;
- 30 fallos por cuenta desde conexiones nuevas;
- 50 fallos por conexión;
- 5 códigos por paso de la verificación en dos pasos;
- el bloqueo dura 15 minutos.

Esos topes se comprueban antes de anotar el fallo. Si llegan muchos intentos a la vez, todos pasan
antes de que se anote el primero. Con la contraseña del super admin y muchas conexiones, alguien
podría acertar su código de 6 dígitos (alrededor de un 1 % por ráfaga). Además, hay sitios que
piden la contraseña con la sesión abierta y no tienen límite ni cuentan para el bloqueo.

**Por qué esta prioridad**: es lo que protege las cuentas, sobre todo la del super admin, que llega a
todas las historias clínicas.

**Prueba independiente**: lanzar a la vez 100 intentos con la contraseña o el código equivocados
contra una cuenta y contar cuántos se llegaron a comprobar.

**Escenarios de aceptación**:

1. **Dado** una cuenta, **cuando** llegan a la vez 100 intentos de contraseña equivocada desde la
   misma conexión, **entonces** se comprueban como mucho 10. Los demás reciben «Demasiados intentos
   fallidos…» sin que se compruebe la contraseña.
2. **Dado** un paso intermedio de la verificación en dos pasos, **cuando** llegan a la vez 50 códigos
   equivocados, **entonces** se comprueban como mucho 5 y el paso deja de servir.
3. **Dado** una sesión abierta, **cuando** se pide cambiar el email del perfil con una contraseña
   equivocada una y otra vez, **entonces** a partir del tope se bloquea como un inicio de sesión. Cada
   fallo queda en los eventos de sesión.
4. **Dado** cambiar la contraseña, desactivar la verificación o generar códigos de recuperación,
   **cuando** se equivoca la contraseña o el código, **entonces** pasa lo mismo: cuenta para el bloqueo
   y queda registrado.
5. **Dado** el uso normal (una persona que se equivoca una o dos veces), **entonces** nada cambia.

---

### Historia 2 - El dueño del producto se entera de los cambios en las cuentas de super admin (Prioridad: P1)

Hoy nadie se entera cuando se activa o desactiva la verificación en dos pasos de un super admin. Un
super admin nuevo recibe la contraseña por email, y quien entre primero activa la verificación con
su propio celular. Cambiar la propia contraseña tampoco avisa, y ni siquiera queda en la auditoría.

**Por qué esta prioridad**: son los cambios que permiten quedarse con una cuenta con acceso a todos
los negocios. Avisar no cambia la decisión de enviar las contraseñas por email.

**Prueba independiente**: activar y desactivar la verificación y cambiar la contraseña de un super
admin de prueba. Después, comprobar los emails que quedan en cola y el aviso que arma la siguiente
pasada del cron.

**Escenarios de aceptación**:

1. **Dado** un super admin que activa la verificación en dos pasos, **cuando** corre el cron,
   **entonces** el dueño del producto recibe por ntfy un aviso:
   - con el título «Agenda360: cambio en una cuenta de super admin», sin nombres;
   - con la cuenta a medias («ju***@gmail.com»), qué cambió y cuándo.
2. **Dado** ese mismo cambio, **entonces** salen dos emails con lo que cambió, cuándo, la IP y el
   navegador:
   - uno al super admin principal;
   - otro a la cuenta afectada.
3. **Dado** que se desactiva la verificación o se cambia la propia contraseña, **entonces** pasa lo
   mismo. El cambio de contraseña queda además en los eventos de sesión, con IP y navegador.
4. **Dado** que el principal cambia su propia verificación o contraseña, **entonces** le llega un
   solo email, no dos.

---

### Historia 3 - La reserva pública no da pistas sobre quién es paciente (Prioridad: P1)

Hoy la reserva responde distinto según la cédula:
- **Cédula de un paciente, con un email y un teléfono que no coinciden:** «No pudimos confirmar tus
  datos».
- **Cédula que no existe:** crea la cita.
- **Topes de pacientes nuevos del día o del plan:** sólo afectan a las cédulas nuevas.

Quien conozca la cédula de alguien puede saber así si es paciente de un psicólogo, a un CAPTCHA por
intento.

Con la decisión del dueño, en ese caso la reserva se acepta como cualquier otra y queda **«Por
verificar»**. Lleva los datos que se escribieron, aparte de la ficha, hasta que el negocio decida.

**Por qué esta prioridad**: ser paciente de ciertos profesionales ya es un dato de salud (principio
II). Además, hoy un paciente que cambió de celular y de email no puede reservar online.

**Prueba independiente**: hacer dos reservas y comparar lo que ve y recibe quien reserva:
- una con la cédula de un paciente y otro email y otro teléfono;
- otra con una cédula nueva.

Después, unir y cancelar reservas por verificar en el panel.

**Escenarios de aceptación**:

1. **Dado** la cédula de un paciente con otro email y otro teléfono, **cuando** se reserva,
   **entonces** quien reserva no puede distinguirlo de una reserva con una cédula nueva:
   - la misma pantalla y la misma respuesta;
   - el mismo email, al correo que escribió;
   - la hora queda ocupada.

   No ve ni recibe nada de la ficha existente.
2. **Dado** esa reserva, **entonces** no se une a la ficha del paciente. Queda aparte, con los datos que
   se escribieron, marcada «Por verificar». No da acceso a la ficha ni a la historia clínica de ese
   paciente, tampoco al rol Profesional con «sólo sus pacientes».
3. **Dado** una cita por verificar, **cuando** alguien del negocio la abre en el panel, **entonces** ve
   el aviso: «La cédula es de [nombre del paciente], pero el email y el teléfono no coinciden con su
   ficha». Tiene dos opciones:
   - **«Es el mismo paciente: unir a su ficha»:** la cita pasa a la ficha, y si quiere actualiza el
     email y el teléfono de la ficha con los nuevos.
   - **«Cancelar la cita».**
4. **Dado** que se une a la ficha, **entonces**:
   - no queda ningún paciente duplicado;
   - la cita sigue como estaba (Pendiente o Confirmada);
   - la actividad registra quién la unió.
5. **Dado** que se cancela, **entonces** la persona que reservó recibe la cancelación de siempre, en el
   correo que escribió. No queda ningún paciente con esa cédula aparte de la ficha original.
6. **Dado** una cita por verificar sin decidir, **entonces** los emails de esa cita van sólo al
   correo que se escribió al reservar, nunca al de la ficha. Son el recordatorio y los cambios de
   estado. La copia al profesional sale como siempre.
7. **Dado** el negocio en su tope de pacientes nuevos del día o del plan, **cuando** se reserva con la
   cédula de un paciente y otros datos, **entonces** la respuesta es la misma que con una cédula
   nueva.
8. **Dado** la reserva por verificar, **cuando** corre el cron, **entonces** el aviso de ntfy de esa
   reserva dice «Por verificar».
9. **Dado** la lista de citas y la agenda, **entonces** las citas por verificar se reconocen de un
   vistazo, también en el celular.
10. **Dado** un paciente antiguo sin cédula guardada, **cuando** alguien reserva con su email y su
    nombre pero con otro teléfono, **entonces** la cédula no se le añade a esa ficha. Se trata como una
    cédula nueva.
11. **Dado** el nombre de quien reserva o de las otras personas de la sesión, **cuando** lleva saltos
    de línea, una dirección web o «@», **entonces** se rechaza con un mensaje claro. Así nadie usa los
    emails de la plataforma para mandar textos a terceros.

---

### Historia 4 - Los recordatorios siempre salen (Prioridad: P2)

Hoy hay un tope de 400 emails al día a personas de fuera, entre todos los negocios. En ese tope
cuentan juntos:
- las reservas nuevas y los registros;
- los recordatorios;
- los avisos que manda el negocio.

Quien llene el tope con reservas falsas deja a todos los negocios sin recordatorios durante 24 h.
Además, los tres emails de la spec 008 no cuentan para ningún tope, y ninguna regla dice si deben
contar.

**Por qué esta prioridad**: los recordatorios son la razón por la que los negocios usan la app.

**Prueba independiente**: llenar el tope con reservas nuevas en la base de prueba y comprobar que
los recordatorios y los avisos del panel siguen saliendo.

**Escenarios de aceptación**:

1. **Dado** el tope de la reserva pública y el registro alcanzado, **cuando** toca un recordatorio o
   un aviso de cambio de estado, **entonces** sale.
2. **Dado** los emails que manda el negocio y los recordatorios, **entonces** tienen su propio tope
   diario. Es más alto que el de hoy y avisa por ntfy al alcanzarse, como el de hoy.
3. **Dado** los tipos de la spec 008 (pendiente de confirmar, gracias por la visita, te esperábamos),
   **entonces** cuentan donde cuentan los demás avisos del negocio.

---

### Historia 5 - Sesiones y secretos que aguantan una filtración (Prioridad: P2)

Varias protecciones dependen hoy de que nada se filtre:
- **Sesiones con «Recordarme»:** se renuevan sin fin.
- **Verificación en dos pasos:** el secreto se guarda sin cifrar en la base.
- **Respuestas públicas:** las que guarda la CDN pueden llevar la cookie de sesión renovada.
- **Proxy del front:** reenvía la IP con un secreto fijo; quien vea una sola petición puede inventar
  cualquier IP desde entonces.
- **Tabla de control de las migraciones:** muy probablemente le falta en producción la protección
  de filas que tienen las otras 31 tablas.

**Por qué esta prioridad**: ninguno se puede aprovechar hoy sin otro fallo antes, pero cada uno
agranda el daño si pasa.

**Prueba independiente**: cada punto por separado. Una sesión vieja que caduca aunque se use. El
secreto guardado no se puede leer. Una respuesta pública sin cookie. Una firma de IP reutilizada que
se rechaza. La tabla protegida.

**Escenarios de aceptación**:

1. **Dado** una sesión con «Recordarme», **cuando** pasan 30 días desde que se inició (7 días si es
   de un super admin), **entonces** caduca aunque se haya usado cada día, y hay que volver a entrar.
   Sin «Recordarme», sigue como hoy: 12 h sin uso y como mucho 24 h.
2. **Dado** un super admin con la verificación activada, **cuando** se publica este cambio,
   **entonces** sigue entrando con su app de siempre, sin volver a activarla. El secreto queda cifrado
   en la base.
3. **Dado** una sesión abierta, **cuando** se abre la página de reservas o se piden los datos públicos
   de la plataforma, **entonces** la respuesta no lleva la cookie de sesión.
4. **Dado** una firma de IP de hace más de 2 minutos, **cuando** llega a la API, **entonces** no
   sirve y se usa la IP de la conexión.
5. **Dado** la base de producción, **cuando** el dueño aplica la migración 036, **entonces** la tabla
   de control de las migraciones queda protegida como las demás.

---

### Historia 6 - La API no arranca desprotegida en la nube (Prioridad: P2)

Hoy, si falta una variable en Vercel o en Lambda, la API arranca igual y en silencio pierde esa
protección. Pasa con:
- las claves del CAPTCHA;
- el secreto del proxy;
- la conexión cifrada a la base.

Además, sin el modo producción la cookie de sesión va sin la marca de segura.

**Por qué esta prioridad**: es fácil que pase al cambiar de hosting (Lambda está lista) o al copiar
variables.

**Prueba independiente**: arrancar la API como si estuviera en la nube, quitando cada variable por
turno.

**Escenarios de aceptación**:

1. **Dado** la API en la nube sin las claves del CAPTCHA, sin el secreto del proxy o sin la conexión
   cifrada y comprobada a la base, **entonces** no atiende peticiones. El registro dice qué falta, sin
   mostrar ningún valor.
2. **Dado** la API en la nube, **entonces** la cookie de sesión va siempre marcada como segura, aunque
   falte el modo producción.
3. **Dado** el equipo del dueño (`dev:local`, `dev:prod`) o las pruebas, **entonces** nada cambia.

---

### Historia 7 - Cada uno recibe sólo lo que necesita (Prioridad: P2)

Algunos datos llegan a quien no los usa:
- **El propietario:** ve en su bandeja de salida los emails de los super admin, al pedir un cambio de
  plan.
- **El rol Profesional:** recibe las cuentas bancarias, el email y la sala de videollamada de las otras
  agendas.
- **La ficha de un usuario:** un super admin la puede ver antes de activar la verificación en dos
  pasos.

**Por qué esta prioridad**: no hay forma de llegar a datos de pacientes, pero son datos de más.

**Prueba independiente**: entrar con cada rol de la demo y mirar lo que devuelve cada pantalla.

**Escenarios de aceptación**:

1. **Dado** un propietario que pidió un cambio de plan, **cuando** mira la bandeja de emails,
   **entonces** no ve los emails que salieron a los super admin. Su solicitud sigue apareciendo como
   hoy.
2. **Dado** el rol Profesional, **cuando** se cargan las agendas, **entonces** de las otras recibe lo
   necesario para la agenda: nombre, foto, color, especialidad y horario. No recibe sus cuentas
   bancarias, su email ni su sala de videollamada. De la suya recibe todo.
3. **Dado** Recepción, el propietario o un administrador, **entonces** siguen recibiendo los datos de
   pago y de videollamada de todas las agendas. Los usan para mandar por WhatsApp los datos de pago y
   el enlace de la consulta.
4. **Dado** un super admin sin la verificación activada, **cuando** pide la ficha de otro usuario,
   **entonces** se le pide activarla, como en el resto del panel.

---

### Historia 8 - El front avisa, informa y carga sólo lo suyo (Prioridad: P3)

Tres puntos en el front:
- **Cerrar sesión:** si la petición falla (sin internet), no avisa y el panel queda abierto en un
  equipo que puede ser compartido.
- **/privacidad:** no nombra a Nominatim (OpenStreetMap), que recibe la dirección del domicilio al
  buscarla en el mapa. Lo pide la LOPDP.
- **CSP:** permite imágenes de cualquier sitio.

**Por qué esta prioridad**: son mejoras de cuidado; ninguna se puede aprovechar sola.

**Prueba independiente**: cerrar sesión sin conexión, leer /privacidad y navegar por el panel, la
página de reservas, los mapas y el CAPTCHA con la nueva CSP.

**Escenarios de aceptación**:

1. **Dado** que falla la petición de cerrar sesión, **entonces** el panel no dice «Sesión cerrada».
   Avisa que la sesión sigue abierta y deja volver a intentarlo.
2. **Dado** /privacidad, **entonces** Nominatim (Fundación OpenStreetMap) aparece entre los
   terceros, con lo que recibe: el texto que se busca y la IP.
3. **Dado** la CSP nueva, **cuando** se navega por todo el producto, **entonces** las imágenes
   cargan, y también los mapas y el CAPTCHA. Sólo se aceptan imágenes del propio sitio, del
   almacenamiento del proyecto y las que genera la página.

---

### Historia 9 - Los registros públicos y ntfy muestran menos (Prioridad: P3)

Tres puntos en los registros públicos y en ntfy:
- **Copias de seguridad:** el registro público de GitHub Actions muestra el email que las recibe.
- **Lambda:** la publicación se puede lanzar desde cualquier rama.
- **ntfy:** el teléfono a medias deja ver 7 de 10 dígitos («099***5555»), y en Ecuador el «09» es
  fijo.

**Por qué esta prioridad**: cada uno da poca información, pero son públicos.

**Prueba independiente**: leer el registro de una copia, intentar publicar en Lambda desde `dev` y
mirar un aviso de ntfy armado en las pruebas.

**Escenarios de aceptación**:

1. **Dado** una copia de seguridad, **entonces** su registro público no muestra el email que la
   recibe.
2. **Dado** la publicación en Lambda lanzada desde una rama que no es `main`, **entonces** no se
   publica nada.
3. **Dado** un aviso de ntfy con teléfono, **entonces** se ve sólo el final: «***5555».

---

### Casos límite

- **Varias pestañas o equipos de una misma persona:** cada intento cuenta una sola vez. Que se
  bloquee una conexión no cierra las sesiones ya abiertas.
- **Super admin principal sin email de avisos:** el email sale a la dirección de su cuenta.
- **Cambio de contraseña hecho por el principal a otro super admin:** ya avisa a esa cuenta con el
  email de la contraseña nueva, como hoy. Se suma el aviso por ntfy.
- **Clave para cifrar el secreto de la verificación:**
  - si falta en la nube, la API no arranca (historia 6);
  - si se cambia por error, los super admin usan sus códigos de recuperación o
    `npm run db:reset-2fa`.
- **Firma de IP durante la transición:** el backend sale antes que el front y acepta la forma vieja y
  la nueva hasta que el front esté publicado. Después se retira la forma vieja.
- **Las claves del CAPTCHA quizá no están puestas hoy en Vercel:** el paso de publicar pide
  comprobarlo antes (`/api/health` con `captcha: true`). Si no, la API dejaría de atender al publicar.
- **Sesiones abiertas el día de la publicación:** las que superan la caducidad máxima caducan al
  publicar, y hay que volver a entrar una vez.
- **Reserva por verificar con dos o tres personas:** las reglas de la historia 3 valen para cada
  persona de la sesión. Si una no coincide, la cita queda por verificar y el panel dice cuál es.
- **La misma persona reserva varias veces con los mismos datos que no coinciden:** cada cita queda
  por verificar. Al unir una a la ficha, el panel ofrece unir también las demás de esa persona.
- **Varias citas por verificar con la misma cédula y datos distintos:** cada una se revisa aparte.
- **«Una cita por día»:** el aviso «Ya tienes una cita ese día» sólo puede salir cuando el email o el
  teléfono coinciden con la ficha, es decir, a la propia persona, como hoy.
- **Quién decide:** unir o cancelar una cita por verificar lo puede hacer quien puede editar pacientes
  y citas en el negocio, también el super admin en modo soporte.

## Requisitos *(obligatorio)*

### Requisitos funcionales

**Inicio de sesión y verificación (historias 1 y 2)**

- **RF-001**: Cada intento de contraseña o de código DEBE quedar contado antes de comprobarse, para
  que los topes de hoy se cumplan exactos también con intentos simultáneos.
- **RF-002**: Cambiar el email del perfil, cambiar la contraseña, desactivar la verificación y generar
  códigos de recuperación DEBEN tener límite de intentos. Sus fallos DEBEN contar para el bloqueo de
  la cuenta y quedar en los eventos de sesión.
- **RF-003**: Cambiar la propia contraseña DEBE quedar en los eventos de sesión, con IP y navegador.
- **RF-004**: Activar o desactivar la verificación en dos pasos de un super admin, o cambiar su propia
  contraseña, DEBE avisar:
  - por ntfy al dueño del producto en la siguiente pasada del cron, con un título genérico y la
    cuenta a medias;
  - por email al super admin principal y a la cuenta afectada, con qué cambió, cuándo, la IP y el
    navegador; un solo email si son la misma.

**Reserva pública (historia 3)**

- **RF-005**: Con la cédula de un paciente y un email y un teléfono que no coinciden, la reserva DEBE
  aceptarse como si fuera de una cédula nueva: la misma pantalla, la misma respuesta, el mismo email
  al correo escrito, la hora ocupada y los mismos topes. NO DEBE dar ninguna pista de que la cédula
  existe.
- **RF-006**: Esa cita DEBE quedar «Por verificar», con los datos que se escribieron y aparte de la
  ficha. NO DEBE dar acceso a la ficha ni a la historia clínica de ese paciente.
- **RF-007**: Mientras esté por verificar, los emails de la cita DEBEN ir al correo escrito al
  reservar, nunca al de la ficha. La copia al profesional sale como siempre.
- **RF-008**: El panel DEBE mostrar las citas por verificar de forma reconocible, en la lista, en la
  agenda y en la ficha de la cita. La ficha DEBE nombrar al paciente de la ficha existente y ofrecer:
  - «Es el mismo paciente: unir a su ficha», con la opción de actualizar su email y su teléfono;
  - «Cancelar la cita».
- **RF-009**: Al unir, NO DEBE quedar un paciente duplicado. La cita conserva su estado, y la
  actividad DEBE registrar quién la unió. Al cancelar, NO DEBE quedar un paciente con esa cédula
  aparte de la ficha original.
- **RF-010**: El aviso de ntfy de una reserva por verificar DEBE decirlo.
- **RF-011**: A un paciente antiguo sin cédula, la reserva sólo DEBE añadirle la cédula si coinciden
  su nombre, su email y su teléfono.
- **RF-012**: Los nombres que escribe el público DEBEN rechazar saltos de línea, direcciones web y «@».
  Se aplica a quien reserva, a las otras personas de la sesión y al registro.

**Emails (historia 4)**

- **RF-013**: El tope diario de emails a personas de fuera DEBE separarse en dos:
  - uno para lo que provoca alguien de fuera: la reserva pública y el registro;
  - otro, propio, para los recordatorios y los avisos que manda el negocio.

  Llegar al primero NO DEBE frenar el segundo.
- **RF-014**: Los tres emails de la spec 008 DEBEN contar en el tope de los avisos del negocio.

**Sesiones y secretos (historia 5)**

- **RF-015**: Las sesiones con «Recordarme» DEBEN caducar como mucho a los 30 días de iniciarse, y a
  los 7 días las de un super admin, aunque se sigan usando.
- **RF-016**: El secreto de la verificación en dos pasos DEBE guardarse cifrado. Los que ya existen se
  cifran sin que ningún super admin tenga que volver a activarla.
- **RF-017**: Las respuestas públicas que la CDN puede guardar NO DEBEN llevar la cookie de sesión. El
  front DEBE pedirlas sin enviarla.
- **RF-018**: La IP que reenvía el proxy del front DEBE ir con una firma que caduca a los 2 minutos.
  Durante la transición, la API acepta también la forma de hoy, hasta que el front esté publicado.
- **RF-019**: La migración 036 DEBE activar la protección de filas en la tabla de control de las
  migraciones de las bases que ya existen.

**Configuración en la nube (historia 6)**

- **RF-020**: En la nube, la API NO DEBE atender peticiones si faltan las claves del CAPTCHA, el
  secreto del proxy o la conexión cifrada y comprobada a la base. El registro DEBE decir qué falta,
  sin valores.
- **RF-021**: En la nube, la cookie de sesión DEBE ir siempre marcada como segura.

**Datos de más (historia 7)**

- **RF-022**: La bandeja de emails del negocio NO DEBE mostrar los emails dirigidos al equipo de la
  plataforma.
- **RF-023**: El rol Profesional NO DEBE recibir las cuentas bancarias, el email ni la sala de
  videollamada de las agendas que no son suyas. Los demás roles las siguen recibiendo.
- **RF-024**: Ver la ficha de un usuario DEBE exigir al super admin la verificación en dos pasos.

**Front (historia 8)**

- **RF-025**: Si falla la petición de cerrar sesión, el panel DEBE avisar que la sesión sigue abierta
  y dejar reintentar. NO DEBE decir «Sesión cerrada».
- **RF-026**: /privacidad DEBE nombrar a Nominatim (Fundación OpenStreetMap) entre los terceros, con
  los datos que recibe.
- **RF-027**: La CSP DEBE aceptar imágenes sólo del propio sitio, del almacenamiento del proyecto y
  las generadas en la página.

**Registros públicos y ntfy (historia 9)**

- **RF-028**: El registro público de las copias de seguridad NO DEBE mostrar el email que las recibe.
- **RF-029**: La publicación en Lambda sólo DEBE poder hacerse desde `main`.
- **RF-030**: En ntfy, el teléfono a medias DEBE mostrar sólo los últimos 4 dígitos («***5555»).

**Beta y constitución**

- **RF-031**: La beta DEBE recibir los cambios que se ven en su interfaz, con sus datos de prueba:
  - el texto de /privacidad;
  - la reserva por verificar (cómo se reserva y cómo se une o se cancela en el panel).

  No tiene backend real, así que no le toca el resto.
- **RF-032**: La constitución DEBE actualizarse en los dos repos (versión 1.6.0):
  - **Principio II:** el formato del teléfono, «***5555».
  - **Principio III:** la regla nueva de la reserva con la cédula de un paciente y otros datos, que
    queda por verificar en lugar de rechazarse. Vale también para las otras personas de una sesión en
    pareja.
  - **Principio III:** la caducidad máxima de las sesiones.

### Entidades clave

- **Intento de acceso**: contraseña o código que alguien prueba en una cuenta. Cuenta para los topes
  antes de comprobarse.
- **Aviso de cambio de cuenta**: activación o desactivación de la verificación y cambio de contraseña
  de un super admin. Lo recoge el cron para ntfy y sale por email.
- **Cita por verificar**: cita de la reserva pública con la cédula de un paciente y otros datos.
  - Guarda los datos que se escribieron y a qué ficha apunta la cédula.
  - Sale de ese estado al unirse a la ficha o al cancelarse.
- **Sesión**: gana una caducidad máxima desde que se inició.
- **Secreto de la verificación**: cifrado con una clave nueva que el dueño pone en la nube.
- **Topes de emails**: dos, uno para lo que provoca el público y otro para los avisos del negocio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: En las pruebas, con 100 intentos simultáneos de contraseña o de código contra una
  cuenta, no se comprueban más de los que permite el tope.
- **CE-002**: Cada activación o desactivación de la verificación y cada cambio de contraseña de un
  super admin deja en cola sus emails, y la siguiente pasada del cron arma su aviso de ntfy.
- **CE-003**: En las pruebas, dos reservas se comparan y no se distinguen en nada de lo que ve o
  recibe quien reserva (pantalla, respuesta, emails, hora ocupada y topes):
  - una con la cédula de un paciente y otros datos;
  - otra con una cédula nueva.
- **CE-004**: Una cita por verificar se une a la ficha o se cancela desde el panel. No deja pacientes
  duplicados ni da acceso a la ficha antes de unirse.
- **CE-005**: En las pruebas, con el tope de la reserva pública alcanzado, los recordatorios y los
  avisos del panel siguen saliendo.
- **CE-006**: Ninguna respuesta pública lleva la cookie de sesión. Una firma de IP vieja o reutilizada
  no sirve.
- **CE-007**: Arrancada como en la nube, sin cualquiera de las protecciones de la historia 6, la API
  no atiende y dice qué falta.
- **CE-008**: Tras publicar, ningún super admin tuvo que volver a activar la verificación y el inicio
  de sesión con código funciona igual.
- **CE-009**: Las pruebas automáticas pasan, y el build y el lint del front y de la beta salen sin
  errores. Las pantallas tocadas se usan sin desplazamiento horizontal a 390 px.

## Supuestos

- **Topes de intentos:** los números de hoy no cambian; sólo se hacen exactos.
- **ntfy:** los avisos de las historias 2 y 3 los manda el cron, como los demás (principio VI).
  Pueden tardar hasta 10 minutos.
- **Tope de los avisos del negocio:** su número lo propone el plan. Debe quedar muy por encima del uso
  normal de hoy.
- **Citas por verificar:** se espera que sean pocas: un paciente que cambió de datos o alguien que se
  equivocó de cédula. No hace falta una pantalla aparte para ellas; basta con verlas en la agenda y
  en la ficha.
- **Clave nueva:** la del cifrado del secreto la crea el dueño y la pone en Vercel (y en Lambda, si la
  usa) antes de publicar. El plan dice cómo.
- **Fuera de esta spec:** son riesgos menores y aceptados:
  - el prefijo `__Host-` de la cookie, que sólo importa con un dominio propio con subdominios;
  - la sesión anterior del mismo navegador, que sigue viva hasta caducar;
  - la pequeña diferencia de tiempo del inicio de sesión cuando el email existe.

## Pasos del dueño del producto (fuera del código)

1. Pegar en el editor SQL de Supabase la consulta de sólo lectura de la revisión. Debe salir:
   - las tablas sin protección de filas: vacío, o sólo `schema_migrations`;
   - los tres buckets con límite de tamaño y de tipos;
   - el registro público cerrado.
2. Abrir `/api/health` del backend publicado y ver `captcha: true`.
3. En Vercel (y en Lambda, si se usa), comprobar las variables de la conexión a la base:
   - `DATABASE_SSL=true`;
   - `DATABASE_URL` sin `sslmode`.
4. Comprobar que `NTFY_TOPIC` sea un nombre largo y aleatorio.
5. Gmail:
   - poner `GMAIL_TRANSPORT=api`;
   - cuando se pueda, cambiar el token por uno que sólo sirva para enviar. El de hoy, con SMTP, abre
     todo el buzón.
6. En GitHub, pasar `BACKUP_EMAIL` de variable a secreto.
7. En AWS, dejar que el rol de publicación de Lambda sólo lo use la rama `main`.
8. Crear la clave del cifrado del secreto de la verificación y ponerla en la nube antes de publicar.
