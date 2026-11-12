# Reporte final: Avisos de errores con Sentry

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev (2026-11-11). La cuenta de Sentry y las variables, puestas por el dueño del producto el 2026-11-12 · **Fecha**: 2026-11-12

**Repos**: los dos · **Migración**: No

## Resumen

Cuando algo falla sin estar previsto, en la API o en la web, Sentry recibe un aviso con lo necesario para
arreglarlo y el dueño del producto recibe un email.

**Lo que llega en cada aviso:**
- dónde falló;
- cuántas veces y en qué navegador;
- desde qué versión;
- de qué negocio es, sólo por su identificador interno.

**Lo que nunca llega:** nombres, contactos, cédulas, notas, la historia clínica, lo escrito en los formularios ni
la dirección IP.

**Para quien usa la app nada cambia:** ve las mismas pantallas y los mismos mensajes, y la app no tarda más.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El dueño se entera de un error de la API | P1 | Hecha | Sin librería: no alarga el arranque |
| H2 – El dueño se entera de un error de la web | P1 | Hecha | El panel, /admin y las páginas de los pacientes; Sentry se descarga sólo con el primer error |
| H3 – Nada de los pacientes llega a Sentry | P1 | Hecha | Probado con datos ficticios en la API y en el navegador |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Los 500 y la base caída llegan | Cumple | `tests/error-reports.test.ts`: un 500 real (la tabla de pacientes renombrada un momento) y un 503 |
| RF-002 – Los errores previstos no llegan | Cumple | La misma prueba: 400, 401, 403, 404, 409 y 429 sin ningún aviso |
| RF-003 – Los errores de la web llegan | Cumple | Recorrido: una pantalla rota, un error sin atrapar y un 502 sin cuerpo, en Chromium y WebKit |
| RF-004 – Conexión, extensiones y versión vieja no llegan | Cumple | Recorrido: un pedido cortado no avisa. `check:error-reports`: la versión vieja, las extensiones, la conexión y los errores de la API |
| RF-005 – Lo que lleva cada aviso | Cumple | La prueba y el recorrido:<br>- la ruta del código («GET /api/businesses/:businessId/clients») o la página limpia;<br>- la versión;<br>- la pila;<br>- el negocio por su id;<br>- el usuario («equipo», «super admin», «paciente»);<br>- en la web, el navegador y las marcas de cada archivo |
| RF-006 – Nada de los pacientes | Cumple | Con un nombre, un email, un teléfono y una cédula ficticios en la búsqueda, el cuerpo, la pantalla y el mensaje, ningún aviso los lleva. Tampoco la IP, las cookies, la contraseña ni el nombre del negocio de `/book/…` |
| RF-007 – Sin grabación ni rendimiento | Cumple | `sentry-client.ts` sin las integraciones por defecto (sólo `dedupe` y `linkedErrors`) y con `dataCollection` todo apagado |
| RF-008 – El aviso por email | Sin comprobar | Es la configuración de Sentry («Alert me on every new issue»). Se comprueba al publicar con la notificación de prueba (CE-006) |
| RF-009 – Sólo en producción | Cumple | La prueba: sin el DSN, apagado; un DSN real desde este equipo no envía; mal escrito, avisa sin mostrarlo. `check:error-reports`, lo mismo en la web |
| RF-010 – Con Sentry caído, todo igual | Cumple | La prueba: con el Sentry de prueba colgado, el 500 respondió en 19 ms (antes, 8 ms) y el aviso salió igual |
| RF-011 – No más lenta | Cumple en la API; ver CE-004 en la web | API: ver CE-005 |
| RF-012 – Los mapas no se publican | Cumple | `SOURCEMAPS=local npm run build`: 257 de 258 archivos marcados y 0 `.map` en `dist` (el paso `agenda:sin-mapas`) |
| RF-013 – La CSP | Cumple | `connect-src` suma sólo `https://*.ingest.us.sentry.io` |
| RF-014 – /privacidad | Cumple | Sentry entre los proveedores: qué recibe, qué no, y que ve la IP al recibir un aviso del navegador pero no la guarda |
| RF-015 – La constitución | Cumple | 1.43.0 en los dos repos (principios II y VI, y las variables) |
| RF-016 – Los pasos para el dueño | Cumple | En el plan («Lo que haces tú») y en los README de los dos repos |
| CE-001 – Las pruebas del backend | Cumple | `tests/error-reports.test.ts`, 43 comprobaciones |
| CE-002 – El recorrido | Cumple | 40 comprobaciones, dos veces seguidas, en Chromium a 1440 px en claro y WebKit a 390 px en oscuro ([capturas](./capturas/)) |
| CE-003 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test` (ver abajo). Front: build, lint y los siete `check:*` |
| CE-004 – La primera carga de la web | **No cumple: +6,3 KB con los mapas (opción 1, elegida al crear el token)** | Antes, 213,29 KB comprimidos.<br>- Con el cambio, sin mapas: 214,05 KB (+0,76 KB).<br>- Con los mapas, como en Vercel: 219,56 KB (+6,3 KB): la marca que el plugin agrega a cada archivo cuesta unos 5,5 KB. Ver «Pendientes» |
| CE-005 – El arranque de la API | Cumple | Cinco veces cada uno: 205 ms de media antes y 191 ms después (dentro del ruido; el límite era +50 ms) |
| CE-006 – La notificación de prueba | Sin comprobar | Después de publicar |
| CE-007 – Las mismas pantallas | Cumple | Recorrido: «Algo salió mal» y «Ocurrió un error inesperado.» como siempre ([captura en el celular](./capturas/webkit-390-oscuro-pantalla-rota.png)) |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores. `npm test`: 73 de 73 suites pasaron, con la nueva.
- **Front:**
  - `npm run build` y `npm run lint` sin errores;
  - `check:contrast`, `check:specialties`, `check:data-export`, `check:landing`, `check:board`,
    `check:admin-calendar` y `check:error-reports`, todas bien.

## Cambios respecto al plan

- **Sentry 11 ya no tiene `sendDefaultPii`.** Lo reemplaza `dataCollection`, que por defecto recoge todo:
  usuario, cookies, cabeceras, cuerpos y parámetros. Se apagó campo por campo. Además, `clean` arma de nuevo la
  petición antes de enviarla.
- **La limpieza de la web se movió a la parte que se descarga con el error** (`error-report-rules.ts`). Al
  arranque sólo queda lo mínimo: la primera carga pasó de crecer 1,8 KB a crecer 0,76 KB.
  `src/lib/anonymize-url.ts` quedó sólo con lo de la analítica, que sigue igual.
- **El límite del mismo error en la API** se cuenta por ruta, tipo y mensaje, no por la primera línea de la
  pila. Los errores de la base pasan casi siempre por el mismo ayudante (`db/pool.ts`), y por la pila se habrían
  juntado errores de rutas distintas.
- **El plugin de Vite no asocia commits ni despliegues en Sentry** (`setCommits` y `deploy` apagados): no hace
  falta conectar GitHub con Sentry.
- **/privacidad** aclara que Sentry ve la IP al recibir un aviso del navegador, aunque no la guarda. El plan
  decía «no recibe la IP».
- **El recorrido bloquea el service worker de la app:** en WebKit, Playwright no intercepta los pedidos que
  pasan por él. Es un detalle de la prueba, no de la app.
- **`scripts/test.ts`** pone `VERCEL_GIT_COMMIT_SHA` (para la versión de los avisos) y arranca el Sentry de
  prueba en cada `npm test`.

## Pendientes y riesgos

- **Los mapas de la web (CE-004):** el dueño del producto creó el token y puso las cuatro variables del front
  (2026-11-12), así que queda la opción 1. Para ver en Sentry la línea exacta del código de la web hacen falta
  los mapas, y había tres formas:
  1. **(Recomendada y la que quedó)** La que recomienda Sentry: +5,5 KB en la primera carga (en total +6,3 KB,
     un 3 %).
  2. La antigua, por versión: +1,9 KB en total. Sentry ya no la recomienda y hay que comprobarla en producción.
  3. Sin mapas: +0,76 KB. Los avisos de la web llegan igual, pero con la línea del archivo comprimido.
- **La cuenta de Sentry** (2026-11-12): los proyectos `agenda-api` y `agenda-web` (sólo «Error monitoring»,
  alertas «High priority issues» por email), las IP sin guardar y las variables en Vercel y Lambda.
- **Si la subida de los mapas falla en Vercel** (por ejemplo, un token mal copiado), la compilación termina
  igual y no publica ningún mapa. Se comprobó en local con un token falso.
- **La línea exacta de la web** sólo se puede ver en Sentry después de publicar, porque los mapas se suben
  desde Vercel.
- **Los bloqueadores de anuncios** pueden frenar algunos avisos de la web. Los de la API llegan siempre.
- **Al traer los cambios a su equipo,** el dueño del producto corre `npm install` en el front, porque hay
  librerías nuevas.
- **La fecha de /privacidad** dice 12 de noviembre, el día de la publicación.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 578a1cf | Spec 044, aprobada |
| agenda-backend | 8a9d851 | Spec 044: plan de implementación |
| agenda-backend | (este commit) | Spec 044: el aviso de errores de la API, sus pruebas, el Sentry de prueba, la constitución 1.43.0, las tareas, las capturas y el reporte |
| agenda-front | 38866a5 | Spec 044: el aviso de errores de la web, los mapas, la CSP, /privacidad, `check:error-reports` y la constitución 1.43.0 |

## Cómo publicarlo

1. **Sin migración.**
2. **Antes de fusionar:** la cuenta de Sentry, los dos proyectos y las variables. Las del front tienen que
   estar antes de que Vercel compile, para que suba los mapas.
3. **Los PR `dev` → `main`** del backend y del front, en cualquier orden.
4. **Después:**
   - pulsar «Send Test Notification» en la regla de alertas de cada proyecto (CE-006);
   - `npm install` en el front.

## Texto para el PR

Spec 044: los errores inesperados de la API y de la web llegan a Sentry, con un email al dueño del producto.
- **La API** envía el aviso sin librería, así que no tarda más en arrancar. La web descarga Sentry sólo con el
  primer error.
- **Nada de los pacientes:** ni nombres, contactos, cédulas, historia clínica, formularios ni la IP.
- **Antes de publicar:** la cuenta de Sentry y las variables `SENTRY_DSN`, `VITE_SENTRY_DSN`,
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` y `SENTRY_PROJECT`.
- **Sin migración.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/044-avisos-de-errores/reporte.md
