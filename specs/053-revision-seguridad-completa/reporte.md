# Reporte: Revisión de seguridad completa

**Estado**: Publicada (2026-11-18, PR back #82 y front #66) · **Fecha**: 2026-11-18

**Repos**: los dos · **Migración**: No

## Resumen

Revisión a fondo pedida por el dueño, sobre todo lo de la lista que pidió. Primero, una auditoría sin tocar nada:
- tres revisores independientes: la API, los datos y el front con el despliegue;
- `npm audit`, `npm outdated` y búsqueda de paquetes sin uso en los dos repos;
- búsqueda de secretos en toda la historia de git de los dos repos.

Después, con su aprobación, se arreglaron 12 hallazgos (3 medios, 8 bajos y uno de higiene). Al final se probaron las
protecciones contra la API real en local. Ya existía mucho de lo pedido (specs 009 y 050); esta revisión cerró los
huecos que quedaban y lo nuevo de las specs 049 a 052.

## Lo que ya estaba bien (comprobado)

| Pedido | Cómo está |
|---|---|
| Autenticación sólida | Contraseñas con bcrypt 12 (se rehacen al entrar). Sesiones de 256 bits guardadas con hash, nuevas en cada inicio de sesión, que caducan por inactividad. 2FA obligatoria para el super admin. Bloqueo por intentos, exacto también con peticiones simultáneas. |
| Claves API fuera / variables de entorno | Sin secretos en el código. En la nube la API no arranca sin CAPTCHA, `PROXY_SECRET`, TLS ni `TWO_FACTOR_KEY`. El front sólo publica 4 variables `VITE_*`, todas públicas. |
| Secretos filtrados en git | Ninguno: ni un `.env` ni una clave real en toda la historia de los dos repos (sólo `.env.example` con valores de ejemplo y valores de prueba inventados). **No hay claves comprometidas que revocar.** |
| Base de datos protegida | RLS en todas las tablas y sin políticas (cerrada para `anon` y `authenticated`), sin `SECURITY DEFINER`, conexión con TLS verificado contra la CA de Supabase. |
| HTTPS forzado | HSTS en la API (helmet) y en el front (vercel.json); cookies `Secure` en la nube. |
| Validar en el servidor | Todo lo que llega pasa por un esquema (zod); ids, fechas, listas y largos con tope. |
| Consultas parametrizadas | Las 365 interpolaciones en el SQL son constantes, columnas fijas o números de parámetro. |
| Protección XSS | Sin `dangerouslySetInnerHTML`; CSP sin scripts en línea; los emails escapan todo y sólo publican enlaces http/https. |
| Blindar rutas admin | Las 53 rutas de `/admin` piden super admin con 2FA. |
| CORS, CSRF, cabeceras | CORS con lista cerrada; `X-Requested-With` obligatorio en todo lo que cambia algo; helmet, `no-store`, sin `x-powered-by`; en el front, CSP, `frame-ancestors 'none'`, COOP, CORP, `Permissions-Policy`. |
| Cookies seguras | HttpOnly, `Secure` en la nube y `SameSite=Lax`. |
| Enlaces que caducan | Restablecer contraseña, «Tu cita», pago, encuestas y controles: caducan, y los cerrados no muestran datos. |
| Precios y pagos en el servidor | El precio de la reserva, la mensualidad, los referidos y los descuentos se calculan en la API. |
| Sin modo depuración | Sin trazas en las respuestas, sin `console.*` en el front, sin mapas de código publicados, Sentry sin datos de más. |
| Archivos expuestos | `dist/` sólo trae lo previsto; la API no sirve archivos estáticos; `/api/files` sólo existe en local y está protegida. |
| Paquetes sin uso | Ninguno (los que marcó la herramienta se cargan desde el CSS). |

## Hallazgos y arreglos

| # | Gravedad | Hallazgo | Arreglo |
|---|---|---|---|
| 1 | Media | Las cuentas del equipo (ven historias clínicas) aguantaban unas 2.900 contraseñas al día desde muchas IP: el tope de 15 minutos se reiniciaba. | Tope de 100 intentos por cuenta en 24 horas desde conexiones nuevas y CAPTCHA después de 3. Desde la conexión o el navegador de siempre («dispositivo de confianza», cookie firmada que deja de valer al cambiar la contraseña) no se aplican: un ataque no deja fuera al dueño. |
| 2 | Media | «Servicio gratis» dejaba en $0 una cita de otro servicio, y el premio de un paciente rebajaba la sesión entera de varios. | Sólo en una cita de ese servicio y nunca en sesiones de varios pacientes; el diálogo de canje muestra sólo las citas válidas. |
| 3 | Media | Una dependencia comprometida podía correr un script al instalarse en Vercel y llevarse las claves. | `.npmrc` con `ignore-scripts=true` en los dos repos y Dependabot con 7 días de espera. |
| 4 | Baja | El tope de 100 kB (spec 050) se saltaba con la ruta en mayúsculas, y sin sesión se leían 2 MB antes del 401. | Sin distinguir mayúsculas y 100 kB en cualquier petición sin sesión. |
| 5 | Baja | La 2FA no tenía tope diario (unos 2.400 códigos al día con la contraseña robada) ni avisaba de que la contraseña ya era correcta. | Tope de 20 códigos incorrectos en 24 horas; al primer código incorrecto tras la contraseña, email a la cuenta y al dueño de la plataforma, y aviso por ntfy. |
| 6 | Baja | Los comprobantes de la mensualidad y los adjuntos clínicos no comprobaban el tipo real del archivo (una página web con nombre de foto). | La misma comprobación que el comprobante del paciente: se rechaza y se borra. |
| 7 | Baja | El enlace de contraseña del paciente calculaba bcrypt antes de comprobar el enlace. | Primero el enlace. |
| 8 | Baja | La cuenta del paciente no dejaba rastro; no había alerta de intentos repartidos entre muchas cuentas. | Intentos, esperas, contraseñas, eliminación y «Cerrar sesión en todos» en Actividad → Seguridad del super admin (sin teléfonos), y alerta por ntfy con muchos en una hora (pacientes y equipo en total). |
| 9 | Baja | La sesión del paciente duraba 180 días fijos (un celular perdido). | 30 días sin uso (hasta 180) y «Cerrar sesión en todos los dispositivos». |
| 10 | Baja | Los teléfonos quedaban en claro 30 días en los contadores. | Sólo su huella (SHA-256). |
| 11 | Baja | No había `/.well-known/security.txt`. | Publicado, con `novastackcore@gmail.com`. |
| 12 | Higiene | `zxing-wasm` se usaba sin declararlo; los `node_modules` locales estaban atrasados respecto a sus lockfiles. | Declarado con versión fija; los dos `node_modules` reinstalados desde su lockfile. |

## Dependencias

- **Backend:** 0 vulnerabilidades. Al día con su lockfile (Dependabot); lo que queda más nuevo salió hace menos de dos
  semanas, y TypeScript 7 se deja fuera a propósito.
- **Front:** 13 alertas, todas de herramientas de compilación (vite, workbox, picomatch, glob, minimatch), no del código
  que reciben los usuarios. picomatch no tiene versión corregida todavía; las demás llegan con workbox. Riesgo
  aceptado: los patrones que procesan los escribimos nosotros en la configuración. Dependabot las subirá cuando salgan.

## Comprobación

- **Backend:** `npm test`, 79 de 80 suites; la que falló, `push-notices` (un aviso que no llegó a tiempo, la falla
  intermitente conocida), pasó entera al repetirla sola. Incluye la suite nueva `tests/login-protection.test.ts` y
  pruebas nuevas en `two-factor`, `security`, `loyalty`, `billing`, `clinical-custom` y `patient-accounts`.
- **Front:** `tsc`, `lint`, `build` y las 13 comprobaciones `check:*`; `security.txt` sale en el build.
- **Prueba de las protecciones** contra la API real en local (puerto aparte y base de prueba), todas bien:
  - cabeceras: HSTS, `nosniff`, sin iframe ajeno, sin `x-powered-by`, `no-store`;
  - CORS: un origen ajeno no recibe permiso y el front sí, con credenciales;
  - CSRF: sin `X-Requested-With`, 403;
  - tope de 100 kB: también en mayúsculas y sin sesión;
  - `/admin`: 401 sin sesión y 403 con la de un propietario;
  - cookies HttpOnly y `SameSite=Lax`;
  - 429 con muchos intentos;
  - tres intentos de inyección SQL tratados como texto, y la base sigue bien;
  - errores sin traza ni SQL;
  - `.env` y `package.json` no se sirven;
  - el HTML de los emails escapa los nombres y no publica enlaces `javascript:`.

## Riesgos que quedan (bajos)

- Los tokens de los enlaces públicos (pago, «Tu cita», encuestas, lista de espera, controles, QR) se guardan en claro:
  quien leyera la base podría usarlos. Pasarlos a hash es un cambio grande, aparte.
- La ficha dice si un teléfono tiene cuenta de paciente; alguien con un negocio propio podría consultar teléfonos.
- Quien sepa el teléfono de un paciente puede dejar su cuenta esperando hasta 24 horas; el enlace del consultorio la
  desbloquea.
- Desde una conexión nueva, una cuenta del equipo puede quedar esperando hasta 24 horas si alguien prueba 100
  contraseñas; desde la conexión o el navegador de siempre, el dueño entra igual.

## Lo que hace el dueño (fuera del código)

1. **GitGuardian, PR #66 del front:** marcar el incidente como falso positivo. Es la línea
   `resetPassword: (token, password) => …` de `src/lib/data/api-repository.ts`, que manda la contraseña nueva a la API
   y no contiene ningún secreto.
2. **Vercel, backend:** confirmar que existen `NODE_ENV=production` y `TRUST_PROXY`, y que el «Install Command» es el de
   siempre (respeta el `.npmrc`).
3. **Supabase, Storage:** que los buckets `comprobantes` e `imagenes` tengan su tope de tamaño y sus tipos permitidos.
4. **Vercel, Firewall (si el plan lo permite):** una regla de límite para `/api/public/*` y `/api/patient/*`.
5. **GitHub:** pasar `AWS_DEPLOY_ROLE_ARN` de variable a secreto (pendiente de la revisión 050).
6. **Opcional:** la 2FA para los propietarios, en otra spec.

## Cómo publicarlo

Sin migración. Va en el próximo PR de `dev` a `main` (los PR #81 y #66 ya estaban abiertos cuando se hizo; se suben a
`dev` cuando el dueño diga). Publicar el backend antes que el front: el front nuevo sabe mostrar el CAPTCHA que pide la
API, y el viejo sólo mostraría el mensaje.
