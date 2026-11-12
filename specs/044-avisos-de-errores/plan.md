# Plan de implementación: Avisos de errores con Sentry

**Rama**: `dev` · **Fecha**: 2026-11-11 · **Spec**: [spec.md](./spec.md)

**Sin migración.** La API arma y envía sus avisos sin librería nueva. La web carga la librería de Sentry sólo cuando
hay un error que enviar. Lo que se envía se arma con una lista cerrada de campos: nada sale si no está en la lista.

## Lo que se midió antes de decidir

| Opción | Arranque en frío de la API | Peso en la web |
|---|---|---|
| Librería completa de Sentry para Node (`@sentry/node` 11.10.0) | +100 a 125 ms y +130 ms de CPU en este Mac (en Vercel, más) | — |
| Sólo el núcleo de Sentry (`@sentry/core`) | +27 ms | — |
| **Envío propio, sin librería (elegido para la API)** | ~0 ms | — |
| **Librería del navegador mínima (`@sentry/browser` 11.10.0), elegida para la web** | — | 31 KB comprimidos, que se descargan sólo al haber un error |

- **La librería completa en la API** no cumple el CE-005 (menos de 50 ms) ni el principio VI (cuidar el arranque
  en frío).
- **Un envío propio** también cumple mejor el principio II: se arma campo por campo, en lugar de quitar después lo
  que sobra.
- **En la web sí conviene la librería oficial:** lee las pilas de error de cada navegador y marca cada archivo
  publicado para que Sentry encuentre la línea original.
- **La versión 11.10.0** es del 2026-10-28. La 11.11 y la 11.12 tienen menos de dos semanas.

## Diseño

1. **La API: el envío** (`back/src/services/error-reports.ts`, nuevo):
   - **Cuándo envía:** en `errorHandler` (`back/src/http/errors.ts`), en sus dos ramas de error:
     - el error inesperado, que responde 500 «server»;
     - la base no disponible, que responde 503 «unavailable».

     Los errores previstos (`AppError`: validación, sin sesión, límite del plan, sin permiso, no encontrado,
     conflicto, límite diario, demasiados intentos y aviso al celular) no se envían. La respuesta a la persona no
     cambia.
   - **Qué envía**, campo por campo:
     - el tipo de error;
     - el mensaje limpio:
       - en los errores de la base, sólo su código, la restricción y la tabla, como ya hace `errorForLog`, sin el
         mensaje ni el detalle, que pueden citar valores;
       - en los demás, el mensaje con los emails y los números de 7 o más cifras tapados (teléfonos y cédulas),
         cortado a 300 caracteres;
     - la pila, con las rutas de archivo relativas al repositorio (`src/services/…`). Node ejecuta los `.ts` tal
       cual, así que las líneas ya son las del código, sin mapas;
     - la causa, si la hay, hasta dos niveles;
     - la versión: el commit (`VERCEL_GIT_COMMIT_SHA` en Vercel; en Lambda, un archivo con `GITHUB_SHA` que mete
       `scripts/package-lambda.ts` en el paquete);
     - el entorno (Vercel o Lambda);
     - las etiquetas:
       - **ruta:** el método y la ruta tal como está definida en el código, nunca la dirección real. Sale del
         prefijo de montaje más `req.route.path`, por ejemplo «GET /api/businesses/:id/clients». Si el error
         ocurrió antes de llegar a una ruta, va el prefijo con «/…». Se comprobó que Express 5 conserva
         `req.route` en el manejador de errores;
       - **estado:** 500 o 503;
       - **negocio** (respuesta 3): el identificador interno del negocio de la dirección (`/businesses/<id>`), si
         lo hay;
       - **usuario:** «equipo», «super admin» (por `platformRole`), «paciente» (las rutas `/public`) o «sin
         sesión».
   - **Qué NO envía:** el cuerpo, la consulta, las cabeceras, las cookies, la IP, el nombre del servidor ni el
     usuario. No hay un paso de «quitar»: esos campos nunca se agregan.
   - **Cómo envía:** un sobre de Sentry (`/api/<proyecto>/envelope/`) con `fetch`, con 3 segundos como máximo.
     - En Vercel lo mantiene vivo `waitUntil`, como en `mailer.ts`: la respuesta sale antes.
     - En Lambda va en el mismo gancho de `res.end` que ya vacía los emails, los avisos y el celular
       (`flushErrorReports`).
     - Si Sentry falla o tarda, se deja pasar y se anota una línea en el registro, sin datos.
   - **Límites, para no gastar el cupo:**
     - el mismo error (tipo más primera línea de la pila), una vez por minuto en cada instancia;
     - 30 por hora en cada instancia;
     - si Sentry responde 429, se espera lo que pide.
   - **La configuración** (`back/src/config.ts`): `SENTRY_DSN`, opcional. Se envía sólo en la nube (Vercel o
     Lambda), o en local si el DSN apunta al propio equipo (el Sentry de prueba de las pruebas). Sin el DSN no se
     envía nada (RF-009).

2. **La web: el aviso** (`front/src/lib/error-reports.ts`, nuevo y pequeño, en el arranque):
   - **Qué atrapa** (respuesta 1: el panel, /admin y las páginas de los pacientes):
     - la pantalla que se rompe: `route-error-page.tsx` llama a `reportError(error)`;
     - los errores sin atrapar: escuchas de `error` y `unhandledrejection` en `main.tsx`;
     - los fallos del servidor que la API no pudo avisar: en `front/src/lib/api/client.ts`, donde un 5xx sin el
       cuerpo de error de la API se vuelve «network», se llama a `reportServerFailure(método, ruta, estado)`.
       Los 500 y 503 con cuerpo de la API ya los avisó la API y no se repiten.
   - **Qué NO atrapa** (RF-004):
     - los fallos de conexión (`DataError` «network» sin respuesta del servidor);
     - los errores previstos de la API (`DataError` con su código);
     - la versión vieja que se recarga sola (`isStaleAssetError`);
     - las páginas que no existen (404);
     - los errores que salen de extensiones del navegador (`chrome-extension://`, `moz-extension://`,
       `safari-web-extension://`);
     - los «Script error.» sin detalle.
   - **La librería, sólo cuando hace falta:** el primer error descarga `front/src/lib/sentry-client.ts` (con
     `@sentry/browser`) en una parte aparte de la web. Mientras llega, los errores esperan en una cola. Si no se
     puede descargar, por ejemplo sin conexión, se pierden sin molestar a nadie.
   - **Cómo se inicia `@sentry/browser`:**
     - sin las integraciones por defecto: sólo `dedupe` y `linkedErrors`;
     - sin migas automáticas: ni clics, ni consola, ni peticiones;
     - `sendDefaultPii: false`;
     - sin grabación ni rendimiento;
     - `beforeSend` arma de nuevo la petición: la página limpia y sólo el `User-Agent`, para el navegador, el
       sistema y el aparato. También limpia el mensaje con las mismas reglas que la API.
   - **La página limpia** (`front/src/lib/anonymize-url.ts`, nuevo):
     - parte de la de la analítica, que se mueve aquí: identificadores → `[id]`, tokens → `[token]`, sin
       parámetros ni `#`;
     - además, el nombre de la página de reservas: `/book/psicovalle` → `/book/[negocio]` (respuesta 3: nunca el
       nombre del negocio);
     - la analítica sigue igual.
   - **Las etiquetas:**
     - **usuario:** por la página: `/book`, `/cita` y `/pago` → «paciente»; `/admin` → «super admin»;
       `/dashboard` → «equipo» o «super admin» en modo soporte; las demás → «visitante»;
     - **negocio:** el identificador interno de `useCurrentBusiness()` en el panel (`setErrorContext`), nunca el
       nombre.
   - **Lo que pasó antes del error:** las últimas 10 páginas y los últimos 10 pedidos a la API (método, ruta
     limpia y estado). Los guarda la propia web en memoria, ya limpios; no los toma la librería de la pantalla.
   - **«A cuántas personas»:** un número al azar por visita, guardado en `sessionStorage`. Se pierde al cerrar
     la pestaña y no se relaciona con la cuenta. Sentry cuenta así las visitas afectadas.
   - **Límites:** el mismo error, una vez por visita; como mucho 5 por visita.
   - **La versión:** el commit, que Vite pone al compilar (`VERCEL_GIT_COMMIT_SHA` → `VITE_RELEASE`).
   - **Se envía** si `VITE_SENTRY_DSN` está puesto y la web no corre en el propio equipo, salvo que el DSN apunte
     al propio equipo (el recorrido de prueba).

3. **La compilación de la web** (`front/vite.config.ts`):
   - **Con `SENTRY_AUTH_TOKEN`** (sólo en Vercel):
     - mapas ocultos (`build.sourcemap: "hidden"`);
     - `@sentry/vite-plugin` 11.10.0 (sólo para compilar). Marca cada archivo, sube los mapas a Sentry con la
       versión y los borra.
   - **Sin el token** (en local), no se crean mapas, como hoy.
   - **Un paso propio al final** (`agenda:sin-mapas`) borra cualquier `.map` que quede en `dist` y falla si no
     puede. Así no se publican aunque cambie la librería (RF-012).
   - **El service worker** no los incluye (sus patrones no llevan `.map`).

4. **La CSP y /privacidad** (front):
   - **La CSP** (`vercel.json`): `connect-src` suma `https://*.ingest.us.sentry.io`. Nada más cambia: la librería
     se sirve desde la propia web (RF-013).
   - **/privacidad:** Sentry se suma a los proveedores. Recibe los errores técnicos (en qué parte del código
     falló, la página sin identificadores, el navegador y el tipo de aparato) para avisar al equipo de
     Agenda360. No recibe nombres, contactos, cédulas, nada de la historia clínica ni la dirección IP. La fecha
     de actualización es la de la publicación (RF-014).

5. **La constitución, 1.43.0, en los dos repos:**
   - **Principio II:** qué recibe Sentry y qué no. La API lo arma campo por campo; la web, con la página limpia y
     sin nombres de negocio.
   - **Principio VI:** la API envía sin librería, para no alargar el arranque. La web descarga Sentry sólo al
     haber un error.
   - **Restricciones:** las variables `SENTRY_DSN` (backend, en Vercel y en Lambda), `VITE_SENTRY_DSN`,
     `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` y `SENTRY_PROJECT` (front, en Vercel).

**No se hace:**
- el cron ni la copia de seguridad: siguen con ntfy y healthchecks.io (respuesta 1);
- avisos por ntfy (respuesta 2);
- grabación de pantalla ni medición de rendimiento (RF-007);
- la beta.

## Lo que haces tú, antes de publicar

En Sentry:
1. Crea la cuenta en sentry.io con el plan gratis (Developer) y los datos en United States.
2. Crea el proyecto `agenda-api` (Express) y el proyecto `agenda-web` (React). En los dos, en la frecuencia de
   alertas, elige «Alert me on every new issue».
3. En cada proyecto, en Settings → Security & Privacy:
   - enciende «Prevent Storing of IP Addresses»;
   - deja encendidos «Data Scrubber» y «Use Default Scrubbers».
4. En cada proyecto, en Settings → Client Keys (DSN), copia su DSN.
5. En Organization Settings → Auth Tokens, crea un token para subir los mapas.

En Vercel y Lambda:
1. **Backend en Vercel:** `SENTRY_DSN` con el DSN de `agenda-api`.
2. **Lambda (respaldo):** la misma variable, en Configuration → Environment variables.
3. **Front en Vercel:**
   - `VITE_SENTRY_DSN` con el DSN de `agenda-web`;
   - `SENTRY_AUTH_TOKEN` con el token;
   - `SENTRY_ORG` con el nombre corto de tu organización en Sentry;
   - `SENTRY_PROJECT` con `agenda-web`.
4. Revisa que en los dos proyectos de Vercel siga encendido «Automatically expose System Environment Variables».
   Viene así por defecto, y de ahí sale el commit de la versión.

Después de publicar: en Sentry → Alerts, abre la regla de cada proyecto y pulsa «Send Test Notification». Te debe
llegar el email (CE-006).

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | La API arma el aviso campo por campo y nunca agrega el cuerpo, la consulta, las cabeceras, las cookies, la IP ni el usuario. La web limpia la página y el mensaje y no usa las migas de la pantalla. Sentry, además, no guarda la IP. Las pruebas buscan los datos ficticios de pacientes en lo que llega al Sentry de prueba |
| IV. Se comprueba en local | Sí | Un Sentry de prueba en el propio equipo recibe lo que se envía, en las pruebas y en el recorrido. Nada contra Vercel ni la base de producción |
| VI. Barato de operar | Sí | La API no carga ninguna librería (~0 ms de arranque) y sólo gasta CPU cuando hay un error, con límites por minuto y por hora. Plan gratis de Sentry. Es un servicio externo nuevo, aprobado por el dueño del producto, y se permite en la CSP |
| V. Código compartido | Sí | El aviso de la web no va en `src/lib` compartido con el backend: cada lado tiene el suyo |
| Restricciones (claves) | Sí | Los DSN y el token van en las variables de Vercel y Lambda, nunca en el código |
| Auditoría | No aplica | No cambia datos de nadie |

## Pruebas

- **Backend, `tests/error-reports.test.ts`** (nueva). `scripts/test.ts` arranca un Sentry de prueba (un
  servidor pequeño que guarda los sobres) y le pasa su DSN a la API.
  - **Un 500 real:** se renombra un momento la tabla de pacientes en la base desechable y se pide la lista de
    pacientes con un nombre ficticio en la búsqueda. Llega un aviso con:
    - la ruta «GET /api/businesses/:id/clients»;
    - el negocio y el usuario «equipo»;
    - la versión;
    - sin el nombre ficticio, el email ni la consulta.

    La persona recibe el mismo 500 de siempre.
  - **La caída de la base:** un 503 llega con su estado.
  - **Los errores previstos no llegan:** validación, 401, 403, 404, 409 y 429.
  - **Un error de la base con valores en su detalle:** sólo su código, la restricción y la tabla.
  - **Un mensaje con email, teléfono y cédula:** va tapado.
  - **Sin el DSN** no se envía nada.
  - **Con el Sentry de prueba colgado,** la respuesta tarda lo mismo.
  - **El mismo error cinco veces seguidas** envía uno.
- **Front, `npm run check:error-reports`** (nueva). Prueba la página limpia (identificadores, tokens,
  `/book/<negocio>`, parámetros), el mensaje limpio y los filtros (versión vieja, extensión, conexión, errores
  previstos).
- **Recorrido en el navegador:** la web compilada con el DSN del Sentry de prueba, en Chromium a 1440 px y en
  WebKit a 390 px:
  - una pantalla rota (una respuesta de la API mal formada, con nombres ficticios) llega una vez, con la página
    limpia, el usuario y la versión;
  - un error sin atrapar llega;
  - un 502 sin cuerpo llega una vez;
  - un pedido cortado (sin conexión) no llega;
  - en ningún sobre aparecen los nombres, emails o tokens ficticios;
  - la persona ve las mismas pantallas y mensajes (CE-007).
- **Peso (CE-004):** lo que descargan la portada y la página de reservas antes de la primera pantalla, antes y
  después.
- **Arranque (CE-005):** el tiempo de cargar la API (`src/app.ts`) en local, cinco veces antes y cinco después.
- **Los mapas:** una compilación local con mapas y sin subirlos termina sin ningún `.map` en `dist`.
- **Comprobaciones:** backend, `typecheck` y `npm test`; front, build, lint y las comprobaciones (`check:*`).

## Cambios respecto a la spec, para aprobar con el plan

- **CE-004:** lo que la web descarga antes de la primera pantalla crece menos de 1 KB, no 0. Es el módulo pequeño
  que guarda el error mientras se descarga Sentry; Sentry mismo (31 KB) sólo se descarga si hay un error.
- **«A cuántas personas»:** en la web, Sentry cuenta visitas (el número al azar de cada visita), no personas.
  Sería lo mismo salvo que alguien vuelva a entrar con el error. En la API se ve por negocio.

## Riesgos

- **La línea exacta del código de la web** sólo se puede comprobar después de publicar, porque la resuelve Sentry
  con los mapas que se suben desde Vercel. En local se comprueba que cada archivo queda marcado y que no se
  publican los mapas. Con el primer error real, o con uno de prueba, se ve en Sentry.
- **Los bloqueadores de anuncios** pueden frenar algunos avisos de la web. Los de la API llegan siempre.
- **El sobre de la API lo arma código propio.** Sigue el formato publicado por Sentry. Si algún día Sentry lo
  cambiara, dejarían de llegar los avisos de la API sin romper nada: la prueba del Sentry de prueba lo vigila en
  cada cambio.
- **El cupo del plan gratis:** los límites de la API y de la web, más la protección de Sentry contra picos,
  evitan que un error repetido lo gaste entero.

## Cómo publicarlo

1. **Sin migración.**
2. **Antes de fusionar:** la cuenta, los proyectos y las variables de «Lo que haces tú».
3. **Los PR `dev` → `main`:** el del backend y el del front, en cualquier orden. Cada lado envía lo suyo.
4. **Después:** la notificación de prueba de Sentry en cada proyecto (CE-006) y `npm install` en el front de tu
   equipo (librerías nuevas).
