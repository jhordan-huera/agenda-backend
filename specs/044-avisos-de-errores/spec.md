# Especificación: Avisos de errores con Sentry

**Carpeta**: `specs/044-avisos-de-errores` (rama de trabajo: `dev`) · **Creada**: 2026-11-11

**Estado**: Aprobada el 2026-11-11, «apruebo con todo lo recomendado»

**Repos**:
- **agenda-backend:** el envío de los errores de la API a Sentry, sin datos de pacientes, y sus pruebas.
- **agenda-front:** el envío de los errores de la web, la CSP y /privacidad.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-11, después de preguntar qué huecos tiene la app y de que se le explicara
éste:

> listo vamos con sentry

**El hueco, comprobado en el código:**
- **En la API:** cuando algo falla sin estar previsto, la persona ve «Ocurrió un error inesperado. Inténtalo de
  nuevo.» y el error sólo queda en el registro de Vercel, que en el plan Hobby dura alrededor de una hora. Nadie
  recibe un aviso: ntfy sólo avisa de reservas, citas y el cupo de Gmail.
- **En la web:** si una pantalla se rompe, la persona ve la página de error y nadie se entera.

**Qué pasa hoy:** un paciente que no pudo reservar se va sin reservar. El dueño se entera sólo si un profesional
se queja, y sin datos para saber qué pasó ni desde cuándo.

**Lo que ya está cubierto y no cambia:** el cron y la copia de seguridad avisan por ntfy y healthchecks.io si
fallan o dejan de pasar.

**Para qué sirve:**
- **Enterarse de un error antes de que alguien se queje.**
- **Tener lo necesario para arreglarlo:** dónde pasó en el código, cuántas veces, a cuántas personas, en qué
  navegador o aparato y desde qué versión publicada.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El dueño se entera de un error de la API (Prioridad: P1)

**Por qué esta prioridad:** la API atiende al panel, a las reservas y a los pagos. Un error ahí puede dejar a un
paciente sin reservar sin que nadie lo sepa.

**Prueba independiente:** en local, con un Sentry de prueba que recibe lo que se envía, se provoca un error
inesperado en una ruta de la API. Llega el error con la ruta sin identificadores y con la versión, sin datos
personales, y la persona recibe el mismo mensaje de hoy.

1. **Dado** un error inesperado en la API, **cuando** responde «Ocurrió un error inesperado», **entonces** el
   error llega a Sentry con:
   - el lugar del código donde pasó;
   - la ruta sin identificadores ni parámetros (por ejemplo, «POST /businesses/:id/appointments»);
   - la versión publicada;
   - el negocio por su identificador interno y el tipo de usuario (respuesta 3).
2. **Dado** que la base de datos no responde («El servicio no está disponible en este momento»), **entonces**
   también llega: es una caída, no un error de la persona.
3. **Dado** un error que Sentry no había visto, **entonces** el dueño recibe un aviso
   (respuesta 2). Si el mismo error se repite, no recibe un aviso por cada vez: Sentry lo
   agrupa y cuenta las veces y las personas.
4. **Dado** un error que el dueño marcó como resuelto, **cuando** vuelve a pasar, **entonces** recibe el aviso
   otra vez.
5. **Dado** un error previsto (datos no válidos, sin sesión, sin permiso, el límite del plan, no encontrado, un
   conflicto, el límite diario, demasiados intentos o un aviso al celular que no se pudo entregar),
   **entonces** no llega nada a Sentry: la app ya le explica a la persona qué pasó.

### Historia 2 - El dueño se entera de un error de la web (Prioridad: P1)

**Por qué esta prioridad:** en la web se rompen pantallas que la API no ve. Cubre el panel, /admin y las páginas
de los pacientes: reservas, pago y «Tu cita» (respuesta 1).

**Prueba independiente:** en local, con la web compilada como en producción y un Sentry de prueba, se rompe una
pantalla a propósito. Llega el error con la línea del código original, la página sin token, el navegador y el
aparato.

1. **Dado** una pantalla que se rompe (la persona ve la página de error), **entonces** el error llega a Sentry
   con:
   - la línea del código original, no la del archivo comprimido que se publica;
   - la página sin identificadores, tokens ni parámetros (por ejemplo, «/cita/:token»);
   - el navegador, el sistema y el tipo de aparato;
   - la versión publicada.
2. **Dado** un error que no rompe la pantalla pero queda sin atrapar (por ejemplo, al pulsar un botón),
   **entonces** también llega.
3. **Dado** que la web recibe un fallo del servidor que la API no pudo avisar (la API no respondió a tiempo, el
   reenvío de la web a la API falló o Vercel apagó la API), **entonces** la web lo avisa. Los errores que ya
   avisó la API no se avisan dos veces.
4. **Dado** un fallo de la conexión del aparato o un error que provoca una extensión del navegador,
   **entonces** no llega nada.
5. **Dado** que se publicó una versión nueva mientras la persona tenía la web abierta, **cuando** la web se
   recarga sola con la versión nueva (como hoy), **entonces** no llega nada. Si aun así la persona ve la página
   de error, sí llega.

### Historia 3 - Nada de los pacientes llega a Sentry (Prioridad: P1)

**Por qué esta prioridad:** Agenda360 guarda datos de salud. La privacidad de los pacientes es un principio no
negociable de la constitución (II).

**Prueba independiente:** se provocan errores con datos ficticios de pacientes en la petición, en la dirección,
en la pantalla y en el mensaje del error. Lo que recibe el Sentry de prueba no contiene ninguno.

1. **Dado** un error en una petición con datos del paciente (nombre, email, teléfono, cédula, notas o historia
   clínica), **entonces** lo enviado no lleva el contenido de la petición ni el de la respuesta.
2. **Dado** un error en una página con token (/cita/…, /pago/…), con identificadores (/clients/…) o con
   parámetros (?q=…), **entonces** la dirección va sin ellos, como en la analítica.
3. **Dado** un mensaje de error que cita un valor (por ejemplo, el email repetido de un mensaje de la base de
   datos), **entonces** va con los emails, teléfonos y cédulas tapados.
4. **Dado** cualquier error, **entonces** no van cookies, cabeceras de sesión, tokens ni la dirección IP.
5. **Dado** lo que la persona hizo antes del error (las páginas que visitó y los pedidos a la API),
   **entonces** va con las mismas reglas y sin textos de la pantalla ni lo que escribió.
6. **Nunca** se graba la pantalla ni se mide el rendimiento: sólo se envían errores.

### Casos límite

- **Muchos errores a la vez** (por ejemplo, la base caída diez minutos): se agrupan. El dueño recibe un aviso por
  error, no cientos.
- **El cupo del plan gratis:** si se llena en el mes, Sentry deja de recibir hasta el mes siguiente y la app
  sigue igual. Una avalancha del mismo error no debe gastarlo entero.
- **Sentry caído o lento:** la app no lo espera. Las respuestas y las pantallas salen igual y en el mismo
  tiempo.
- **Los bloqueadores de anuncios:** algunos navegadores bloquean el envío a Sentry, así que esos errores de la
  web no llegan. Se acepta: los de la API llegan siempre.
- **Sin la clave de Sentry** (en local, en las pruebas y en la beta): no se envía nada y todo funciona igual.
- **El modo soporte del super admin:** el error lleva el tipo «super admin» y el negocio en el que estaba.
- **Lambda, de respaldo:** si se vuelve a usar, envía igual, con sus claves.
- **Un error dentro del aviso:** si falla la preparación de lo que se envía a Sentry, la persona recibe la
  respuesta de siempre y no se envía nada a medias.

## Requisitos *(obligatorio)*

- **RF-001**: Los errores inesperados de la API, los que hoy responden «Ocurrió un error inesperado», DEBEN
  llegar a Sentry. La falta de conexión con la base de datos también.
- **RF-002**: Los errores previstos de la API NO DEBEN llegar: datos no válidos, sin sesión, el límite del plan,
  sin permiso, no encontrado, conflicto, el límite diario, demasiados intentos y el aviso al celular que no se
  pudo entregar.
- **RF-003**: Los errores de la web DEBEN llegar: las pantallas que se rompen, los errores sin atrapar y los
  fallos del servidor que la API no pudo avisar. Esto vale en el panel, /admin y las páginas de los pacientes
  (respuesta 1).
- **RF-004**: NO DEBEN llegar los fallos de conexión del aparato, los errores de las extensiones del navegador
  ni los de una versión vieja que la web ya resuelve recargándose.
- **RF-005**: Cada error DEBE llevar:
  - el lugar en el código original;
  - la ruta o la página sin identificadores, tokens ni parámetros;
  - la versión publicada;
  - en la web, el navegador, el sistema y el tipo de aparato;
  - el negocio por su identificador interno y el tipo de usuario (respuesta 3).
- **RF-006** (privacidad, NO NEGOCIABLE): NO DEBEN llegar a Sentry nombres, emails, teléfonos, cédulas, notas,
  nada de la historia clínica, el contenido de formularios, peticiones o respuestas, cookies, cabeceras de
  sesión, tokens ni la dirección IP. Los mensajes de error DEBEN ir con emails, teléfonos y cédulas tapados. Lo
  que la persona hizo antes del error va con las mismas reglas y sin textos de la pantalla.
- **RF-007**: NO DEBE grabarse la pantalla ni medirse el rendimiento. Sólo se envían errores.
- **RF-008**: El dueño DEBE recibir un aviso cuando aparece un error nuevo y cuando vuelve uno que marcó como
  resuelto, no por cada repetición (respuesta 2).
- **RF-009**: Sólo en producción. Sin la clave de Sentry no se envía nada, y el local, las pruebas y la beta
  funcionan igual que hoy.
- **RF-010**: Si Sentry no responde, la API y la web DEBEN funcionar igual y sin tardar más.
- **RF-011**: La web NO DEBE tardar más en mostrar la primera pantalla. La API NO DEBE alargar de forma notable
  su arranque en frío ni gastar CPU de Vercel salvo cuando hay un error (constitución, principio VI).
- **RF-012**: Los mapas para ver la línea exacta del código original DEBEN subirse a Sentry al compilar y NO
  DEBEN publicarse en la web.
- **RF-013**: La CSP de la web DEBE permitir el envío a Sentry y nada más nuevo.
- **RF-014**: /privacidad DEBE nombrar a Sentry entre los proveedores, con lo que recibe (el error técnico, la
  página sin identificadores, el navegador y el aparato) y lo que no recibe (los datos de los pacientes y la
  dirección IP), y con su fecha de actualización.
- **RF-015**: La constitución DEBE pasar a 1.43.0 en los dos repos, con la regla de qué se envía a Sentry.
- **RF-016**: El plan DEBE darle al dueño del producto, sin comentarios `#`, los pasos para:
  - crear la cuenta y los proyectos de Sentry;
  - activar en Sentry que no guarde las direcciones IP y que tape los datos sensibles;
  - poner las claves en Vercel (backend y front) y en Lambda.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren, con un Sentry de prueba en local:
  - que un error inesperado se envía con la ruta sin identificadores y con la versión;
  - que la caída de la base se envía;
  - que los errores previstos no se envían;
  - que, con datos ficticios de pacientes en la petición y en el mensaje, lo enviado no contiene ninguno;
  - que sin la clave no se envía nada;
  - que con Sentry caído la respuesta es la misma y no tarda más.
- **CE-002**: Un recorrido en local con la web compilada y un Sentry de prueba:
  - una pantalla rota y un error sin atrapar llegan con la línea del código original y la página sin token;
  - un fallo de conexión no llega;
  - lo enviado no lleva los datos ficticios de pacientes puestos en la pantalla y en la dirección;
  - la persona ve las mismas pantallas y mensajes que hoy.
- **CE-003**: `typecheck` y `npm test` en el backend, y build, lint y las comprobaciones del front, sin errores.
- **CE-004**: Lo que la web descarga antes de mostrar la primera pantalla de la portada y de la página de
  reservas no crece. Se mide antes y después.
- **CE-005**: El arranque en frío de la API crece menos de 50 ms, medido en local antes y después.
- **CE-006**: Después de publicar, el dueño del producto recibe el aviso de prueba de Sentry en su email.
- **CE-007**: Nada del panel ni de las páginas de los pacientes cambia a la vista: los mensajes de error y las
  pantallas son los mismos.

## Supuestos

- **El plan gratis de Sentry** alcanza para el volumen de hoy. Si un mes se llena, la app sigue igual.
- **Sentry guarda los datos en EE. UU.,** como los demás proveedores (Supabase, Vercel, Gmail).
- **Los bloqueadores de anuncios** pueden impedir que lleguen algunos errores de la web. Se acepta.
- **No hace falta migración** ni cambios en la base de datos.
- **El dueño del producto crea la cuenta y pone las claves.** Claude no crea cuentas ni ve sus claves.
- **El cron y la copia de seguridad** siguen avisando por ntfy y healthchecks.io, como hoy.
- **La beta no lo lleva.**

## Respuestas del dueño del producto (2026-11-11)

«Apruebo con todo lo recomendado»:

1. **Cubre la API y toda la web:** el panel, /admin y las páginas de los pacientes (reservas, pago y «Tu cita»).
   El cron y la copia siguen avisando por ntfy y healthchecks.io, sin Sentry.
2. **Avisa por el email de Sentry** (y su app del celular, si la instala) cuando aparece un error nuevo o vuelve
   uno resuelto. Sin ntfy.
3. **El error dice de qué negocio es,** sólo con su identificador interno y el tipo de usuario (equipo, super admin
   o paciente). Nunca el nombre del negocio, del usuario ni del paciente.
