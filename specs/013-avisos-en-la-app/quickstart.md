# Cómo comprobarlo en local: Avisos en el celular desde la app instalada

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase.
- **Puertos:** los servidores de prueba van en puertos propios (por ejemplo 4180 para la API y 5199
  para el front) y se detienen por puerto o PID.
- **Claves:** las de desarrollo de `.local-db/vapid.json`, o las que crean las pruebas. Nunca las de
  producción.

## 1. Pruebas automáticas

```
cd ~/Documentos/Proyectos/Backend/agenda-backend
npm run typecheck
npm test
```

```
cd ~/Documentos/Proyectos/Frontend/agenda-front
npm run build
npm run lint
```

### Suites nuevas

**`tests/web-push.test.ts`** (sin red):
- **Cifrado:** con la sal, la clave efímera y las claves del aparato del apéndice A de la RFC 8291,
  `encryptPushPayload` da exactamente el resultado de la RFC, byte a byte.
- **De punta a punta:** con claves al azar, lo cifrado se descifra con la clave privada del aparato.
  Así se recupera el JSON del aviso.
- **Firma VAPID:**
  - el JWT tiene `typ`, `alg: ES256`, `aud` (el origen del servicio), `exp` a 12 h y `sub`;
  - `crypto.verify` lo acepta con la clave pública;
  - para otro servicio, se firma otro.
- **`generateVapidKeys`:** da 87 y 43 caracteres en base64url, y lo firmado con la privada se
  comprueba con la pública.
- **`isAllowedPushEndpoint`:**
  - acepta FCM, Mozilla, Apple y `*.notify.windows.com`;
  - rechaza `http://`, otro puerto, `169.254.169.254`, `localhost`, un dominio parecido
    (`fcm.googleapis.com.ejemplo.net`) y direcciones con usuario;
  - con la base local, acepta `http://127.0.0.1:<puerto>`.
- **Claves del aparato:** `p256dh` que no es un punto P-256, o `auth` de 15 bytes, se rechazan.

**`tests/push-notices.test.ts`**, con la API de pruebas y un servicio de avisos falso en
`tests/helpers/harness.ts`. El falso guarda cada `POST`, lo descifra con la clave del aparato de
prueba y responde 201, 410, 403 o 500 según se le pida.

- **Quién puede activar:**
  - el propietario y el super admin (con la verificación) guardan su aparato;
  - Recepción, un administrador y el rol Profesional reciben 403;
  - un super admin sin la verificación recibe `two_factor_required`;
  - sin claves VAPID, `GET /api/push/config` dice `available: false` y `/api/health`, `"push":
    false`.
- **Aparatos:**
  - dos aparatos del propietario reciben los dos cada aviso;
  - con un tipo apagado en uno, ese aparato no lo recibe y el otro sí;
  - «Desactivar» lo borra;
  - el undécimo borra el más antiguo;
  - la misma dirección guardada por otra persona pasa a ella con los tipos de fábrica.
- **Reserva online:**
  - llega «Nueva reserva» con «Mañana 16:00 · {servicio} · Juan P.» y abre la cita;
  - una reserva «Por verificar» (spec 009) lleva «· Por verificar»;
  - un reintento de la misma reserva no avisa otra vez;
  - una sesión en pareja nombra a las dos personas a medias.
- **Comprobante:** llega «Comprobante de pago · Juan P. · …». Una segunda subida descartada no avisa.
- **Cancelación del paciente** (spec 010): llega «Cita cancelada por el paciente». Un doble toque no
  repite.
- **Cita nueva en la agenda del propietario:**
  - la agenda Recepción → llega;
  - la agenda el propio propietario → no;
  - en la agenda de otro profesional → no;
  - en modo soporte, el super admin la agenda → llega al propietario y no al super admin;
  - una serie de 8 (spec 011) → un solo «Citas nuevas en tu agenda · 8 citas desde…».
- **Propietario que cambia y negocio sin propietario:**
  - sin `owner_id`, una reserva no avisa a nadie;
  - al asignar el propietario, la siguiente le llega a él;
  - los aparatos de quien deja de serlo no reciben nada.
- **Cerrar sesión:**
  - `POST /api/auth/logout` pausa el aparato y una reserva no le llega;
  - al volver a entrar y guardar la misma dirección, se reanuda con sus tipos.
- **Respuestas del servicio:**
  - 410: el aparato se borra y la reserva respondió 200 igual;
  - 500: el aviso queda en cola para reintentar;
  - 403 cinco veces seguidas: el aparato se borra;
  - un aviso de más de 24 h queda «Caducó».
- **Nunca rompe la reserva (RF-011):** con la tabla `push_messages` renombrada un momento (como si
  faltara la migración):
  - la reserva responde 200;
  - la cita y sus emails quedan en la base;
  - el registro dice que el aviso no se pudo poner en cola.

  Después se vuelve a dejar el nombre.
- **Citas por cerrar (cron),** con la hora del cron simulada:
  - una cita Confirmada que terminó hace 30 min dentro de la ventana avisa una vez;
  - en la pasada siguiente, no;
  - si se cerró antes, no avisa;
  - si el cron estuvo parado 6 h, sólo avisan las de las últimas 3 h;
  - una que termina a las 23:45 avisa a las 00:15;
  - un reintento de la misma pasada no duplica.
- **Resumen de las 8:**
  - un negocio de `America/Guayaquil` y otro de `Europe/Madrid` reciben el suyo cuando son las 20:00
    en su zona, una sola vez;
  - con 0 citas sin cerrar no sale nada;
  - una cita que termina a las 20:30 no cuenta;
  - apagado `evening_summary`, no llega aunque `unclosed` siga encendido.
- **Super admin:**
  - el alta de un negocio por el onboarding avisa «Negocio nuevo» a cada super admin con aparato;
    uno creado desde /admin, no;
  - una solicitud de plan avisa con el negocio y los planes;
  - el cron avisa los cambios de seguridad de la spec 009, y los intentos fallidos una vez por
    cuenta y hora;
  - ntfy sigue mandando los suyos.
- **Privacidad (CE-003):**
  - en todos los avisos de la suite, con pacientes de nombre y apellidos largos, email, teléfono y
    cédula, el título y el texto no contienen el nombre completo, la cédula, el email, el teléfono
    ni notas;
  - lo que imprimieron la API y el cron tampoco tiene títulos, textos ni direcciones de aparatos.
- **Aviso de prueba:** `POST /api/push/device/test` llega con «Listo: aquí te avisaremos de las
  reservas.». Con el servicio respondiendo 410, da 409 y el aparato se borra.

### Suites que se actualizan

| Suite | Qué cambia |
|---|---|
| `cron.test.mjs` | La línea del registro con «avisos en la app» y el aviso de ntfy «los avisos en la app no salen». |
| `hardening.test.ts` | `/api/health` con `push`. En la nube (`VERCEL=1`) sin claves VAPID, la API arranca igual. |
| `delete-business.test.mjs` | Borrar un negocio no deja avisos suyos en cola. |

## 2. El front con Playwright (local, escritorio y 390 px)

El service worker sólo se registra en la versión compilada. Por eso:
- la API local va en el 4180, con la demo y las claves de desarrollo;
- el front, con `npm run build` y `npx vite preview --port 5199 --strictPort`, con
  `API_PROXY_TARGET=http://localhost:4180`. `vite preview` usa el mismo proxy de `/api`.

Chromium de Playwright no llega a un servicio de avisos real. Por eso `page.addInitScript` cambia
`PushManager.prototype.subscribe` por una suscripción de prueba que apunta al servicio falso de las
pruebas, con claves que el script conoce.

1. **Como Ricardo** (propietario de la demo), con el permiso concedido
   (`context.grantPermissions(["notifications"])`):
   - aparece la franja «Activa los avisos en este celular»;
   - «Activar» → el servicio falso recibe el aviso de prueba, lo descifra y dice «Listo: aquí te
     avisaremos de las reservas.»;
   - la tarjeta de Configuración → Notificaciones dice «Activados».
2. **«Ahora no» en otra sesión del navegador:** la franja no vuelve al recargar. Con la fecha
   adelantada 8 días (`page.clock`), vuelve.
3. **Con el permiso denegado:** sin franja, y la tarjeta explica cómo volver a permitirlo.
4. **iPhone sin instalar** (`userAgent` de iPhone, sin `PushManager`): la tarjeta explica la
   instalación y abre el diálogo «Instalar en tu iPhone o iPad».
5. **Los interruptores:** apagar «Citas por cerrar» se guarda al momento («Guardado») y sigue
   apagado al recargar.
6. **Como Elena (Recepción)** y como Valeria (rol Profesional): ni franja ni tarjeta.
7. **Super admin en modo soporte:** sin franja ni tarjeta en el panel del negocio. En /admin →
   Configuración sí, con sus cuatro tipos.
8. **Tocar un aviso,** con CDP `ServiceWorker.deliverPushMessage`, que entrega al service worker el
   JSON de una «Nueva reserva»:
   - `registration.getNotifications()` muestra el título, el texto y el `tag`;
   - al simular el toque desde el service worker, la app abierta navega a
     `/dashboard/calendar?date=…&appointment=…` y se abre la ficha de la cita;
   - sin ventana abierta, se abre una nueva.
9. **Con la sesión cerrada:** abrir la ruta de un aviso lleva a `/login?next=…`. Tras entrar, va a la
   cita. Un `next` hacia otro sitio (`//ejemplo.com`) lleva al Inicio.
10. **A 390 px:** la franja y la tarjeta, sin desplazamiento horizontal (CE-004), con foco visible y
    los interruptores con su etiqueta.

## 3. Con navegadores reales (el servicio de avisos de verdad)

Con la misma API (4180) y el front compilado (5199), en el equipo del dueño. `http://localhost`
cuenta como sitio seguro para los navegadores.

1. **Chrome** (servicio de Google): «Activar» → llega «Avisos activados».
   - Desde otra ventana, reservar en la página de la clínica demo: el aviso llega en segundos
     (CE-001).
   - Tocarlo abre la cita.
2. **Firefox** (servicio de Mozilla): lo mismo.
3. **Safari de la Mac** (servicio de Apple, el mismo que usa el iPhone): lo mismo. Si Safari no
   permite avisos en `localhost`, se anota en el reporte y queda el riesgo del iPhone del plan.
4. **Opcional, Android:** con el celular por cable y `adb reverse tcp:5199 tcp:5199`, abrir
   `http://localhost:5199` en Chrome del celular, instalar la app y activar.
5. **Cron:**
   - una cita demo de hoy que terminó hace más de 30 min y sigue Confirmada: `node --env-file=…
     scripts/cron.ts` con las variables de la base local y las claves de desarrollo. Llega «Cita por
     cerrar»;
   - con la zona de un negocio demo cambiada para que allí sean las 20:05, llega el resumen.
6. **Desactivar en este celular:** la siguiente reserva no llega a ese navegador.

## 4. CSP

1. `npm run build`.
2. Servir `dist/` con un servidor estático del scratchpad que aplique las cabeceras de `vercel.json`
   y reenvíe `/api` a la API local, como en la spec 009.
3. Activar los avisos en Chrome, recibir uno y tocarlo.

La consola no debe mostrar ningún error de CSP: `vercel.json` no cambia.

## 5. Beta

No cambia: no tiene servidor para enviar avisos.
