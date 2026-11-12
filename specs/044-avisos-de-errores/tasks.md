# Tareas: Avisos de errores con Sentry

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Sin migración. La beta no cambia.

## Fase 1: La base

- [X] T001 back/src/config.ts: `SENTRY_DSN` opcional; se lee en `{ endpoint, publicKey }` y, si está mal escrito, avisa y queda apagado. Se envía sólo en la nube (Vercel o Lambda) o si el DSN apunta al propio equipo. Versión: `VERCEL_GIT_COMMIT_SHA`, o el archivo de versión del paquete de Lambda
- [X] T002 [P] back/scripts/package-lambda.ts: el paquete lleva el commit (`GITHUB_SHA`) en un archivo de versión
- [X] T003 [P] front/package.json: `@sentry/browser` 11.10.0 y `@sentry/vite-plugin` 11.10.0 (sólo para compilar); `check:error-reports`
- [X] T004 back/scripts/test.ts: arranca un Sentry de prueba (guarda los sobres; `GET` los devuelve, `DELETE` los borra y un modo «colgado» no responde) y pasa su DSN a la API

## Fase 2: La API avisa (Historia 1, P1)

- [X] T005 [US1] back/src/services/error-reports.ts: `reportError(error, req?)`, que arma el aviso campo por campo:
  - el tipo de error;
  - el mensaje limpio: en los de la base, sólo el código, la restricción y la tabla; en los demás, emails y números de 7+ cifras tapados, hasta 300 caracteres;
  - la pila con rutas relativas y la causa;
  - la versión y el entorno;
  - las etiquetas de ruta (prefijo de montaje + `req.route.path`, o «/…»), estado, negocio (`/businesses/<id>`) y usuario.

  Envía el sobre con `fetch`, con 3 s como máximo: `waitUntil` en Vercel y `flushErrorReports` en Lambda. Límites: el mismo error una vez por minuto, 30 por hora y la espera tras un 429
- [X] T006 [US1] back/src/http/errors.ts: `errorHandler` avisa en el 500 «server» y en el 503 «unavailable»; los `AppError` no. back/src/app.ts: `flushErrorReports` en el gancho de `res.end` de Lambda
- [X] T007 [US1] back/tests/error-reports.test.ts:
  - un 500 real (la tabla de pacientes renombrada un momento) con la ruta, el negocio, el usuario y la versión;
  - el 503;
  - los previstos no se envían;
  - sin el DSN no se envía;
  - con Sentry colgado tarda lo mismo;
  - el mismo error cinco veces envía uno.

## Fase 3: La web avisa (Historia 2, P1)

- [X] T008 [P] [US2] front/src/lib/anonymize-url.ts: la limpieza de la analítica (que se mueve aquí y `page-analytics.tsx` importa) y la de Sentry, que además cambia `/book/<negocio>` por `/book/[negocio]`
- [X] T009 [US2] front/src/lib/error-reports.ts:
  - `reportError`, `reportServerFailure`, `setErrorContext` y `installGlobalErrorHandlers`;
  - los filtros: conexión, errores previstos, versión vieja, extensiones y «Script error.»;
  - la cola hasta que llega Sentry;
  - el usuario por la página, el número al azar de la visita (`sessionStorage`) y las últimas 10 páginas y 10 pedidos, ya limpios;
  - el mismo error una vez por visita, 5 como mucho.

  Se envía sólo con `VITE_SENTRY_DSN` y fuera del equipo, o con un DSN del propio equipo
- [X] T010 [US2] front/src/lib/sentry-client.ts (se descarga aparte): `@sentry/browser` sin integraciones por defecto (sólo `dedupe` y `linkedErrors`), sin migas, `sendDefaultPii: false`; `beforeSend` arma la petición (página limpia y `User-Agent`) y limpia el mensaje
- [X] T011 [US2] Conectar:
  - front/src/main.tsx: los errores sin atrapar;
  - front/src/pages/route-error-page.tsx: la pantalla rota, salvo la versión vieja y los 404;
  - front/src/lib/api/client.ts: el 5xx sin cuerpo de la API y los pedidos para las migas;
  - el panel: el negocio de `useCurrentBusiness()`.
- [X] T012 [US2] front/vite.config.ts: `VITE_RELEASE` del commit; con `SENTRY_AUTH_TOKEN`, mapas ocultos y `@sentry/vite-plugin` (sube y borra); el paso `agenda:sin-mapas` al final borra cualquier `.map` de `dist`

## Fase 4: Nada de los pacientes y lo publicado (Historia 3, P1)

- [X] T013 [P] [US3] front/scripts/check-error-reports.ts: la página limpia, el mensaje limpio y los filtros
- [X] T014 [P] [US3] front/vercel.json: `connect-src` con `https://*.ingest.us.sentry.io`. front/src/pages/privacy-page.tsx: Sentry entre los proveedores (qué recibe y qué no) y la fecha
- [X] T015 [US3] back/tests/error-reports.test.ts: con un nombre, un email, un teléfono y una cédula ficticios en la consulta, el cuerpo y el mensaje, el sobre no los lleva; el error de la base con valores en su detalle sólo lleva el código, la restricción y la tabla

## Fase 5: Comprobación y cierre

- [X] T016 Constitución 1.43.0 en los dos repos (principios II y VI, y las variables) y los README (las variables y los pasos de Sentry)
- [X] T017 Backend: `typecheck` y `npm test`. Front: build, lint y `check:*`. Una compilación con mapas y sin subirlos sin ningún `.map` en `dist`
- [X] T018 El peso de la primera pantalla de la portada y de la página de reservas, y el arranque de la API (cinco veces), antes y después
- [X] T019 Recorrido con la web compilada y el Sentry de prueba, en Chromium a 1440 px y en WebKit a 390 px:
  - la pantalla rota llega una vez;
  - el error sin atrapar llega;
  - el 502 sin cuerpo llega una vez;
  - el pedido cortado no llega;
  - ningún sobre lleva los datos ficticios;
  - las pantallas, iguales a las de hoy.

## Dependencias

- La fase 1 va primero.
- Las fases 2 y 3 son independientes entre sí.
- La 4 completa las pruebas de las dos.
- La 5 cierra.
- [P]: en archivos distintos, se pueden hacer a la vez.
