# Decisiones técnicas: Avisos en el celular desde la app instalada

Cada decisión tiene tres partes: qué se eligió, por qué y qué otras opciones se descartaron. Los
números (R1…) se citan en el [plan](./plan.md).

## R1. Web Push estándar con VAPID, con un módulo propio y sin librería

- **Decisión:** el envío usa el estándar de los navegadores:
  - **RFC 8030:** se hace un `POST` a la dirección del aparato (el *endpoint*) en el servicio de avisos
    de su navegador;
  - **RFC 8291 y 8188:** el contenido va cifrado (`aes128gcm`) para ese aparato;
  - **RFC 8292 (VAPID):** cada envío va firmado con el par de claves propio de Agenda360.

  Se escribe en un módulo nuevo, `src/services/web-push.ts`, sólo con `node:crypto`:
  - **Cifrado (`encryptPushPayload`):**
    - clave efímera P-256 por envío (`createECDH("prime256v1")`) y secreto compartido con la clave
      `p256dh` del aparato;
    - `hkdfSync("sha256", …)` dos veces: primero con el secreto `auth` y la info `"WebPush: info\0"`
      + clave del aparato + clave efímera; después con una sal de 16 bytes al azar, para la clave
      (`"Content-Encoding: aes128gcm\0"`, 16 bytes) y el nonce (`"Content-Encoding: nonce\0"`, 12
      bytes);
    - `aes-128-gcm` sobre el JSON del aviso + el delimitador `0x02`, en un solo registro;
    - cuerpo = sal (16 bytes) + tamaño de registro 4096 (4 bytes) + largo de la clave (1 byte, 65) +
      clave efímera (65 bytes) + cifrado con su etiqueta (RFC 8188).
  - **Firma (`vapidHeader`):** un JWT `ES256` con `aud` (el origen del servicio de avisos), `exp` a 12 h
    y `sub` (R2), firmado con `crypto.sign("sha256", …, { dsaEncoding: "ieee-p1363" })`. Cabecera:
    `Authorization: vapid t=<jwt>, k=<clave pública>`. El JWT se guarda en memoria por origen y se
    renueva cuando le queda menos de 1 h.
  - **Envío (`sendWebPush`):** `fetch` con `TTL`, `Urgency`, `Content-Encoding: aes128gcm`,
    `redirect: "error"` y 10 s como máximo. Devuelve `sent`, `gone` (404 o 410), `retry` (429, 5xx o
    red, con `Retry-After`) o `rejected` (otros 4xx). Ver R6.
  - **Claves (`generateVapidKeys`):** `generateKeyPairSync("ec", { namedCurve: "prime256v1" })`
    exportadas en base64url (pública de 65 bytes, privada de 32). La usan `scripts/push-keys.ts` y
    `dev:local` (R2).
- **Cómo se asegura que el cifrado está bien:**
  - **Ejemplo de la RFC:** la prueba repite el ejemplo del apéndice A de la RFC 8291 (claves, sal y
    resultado fijos) y compara byte a byte. Por eso `encryptPushPayload` acepta, sólo para pruebas,
    una sal y una clave efímera fijas.
  - **Firma:** el JWT se comprueba con `crypto.verify` y la clave pública.
  - **De punta a punta:** un servicio de avisos falso en la prueba descifra lo recibido con la clave
    privada del aparato de prueba.
  - **Con navegadores reales,** en local: Chrome, Firefox y Safari de la Mac. Safari usa el mismo
    servicio de Apple que el iPhone ([quickstart.md](./quickstart.md)).
- **Por qué no la librería `web-push`** (consultada en el registro de npm el 2026-10-14, sin
  instalarla):
  - **Sin versiones nuevas desde enero de 2024:** la última es la 3.6.7, de un solo responsable.
  - **Licencia MPL-2.0;** el resto del proyecto usa licencias MIT.
  - **Arrastra 16 paquetes:** `asn1.js`, `http_ece` (fijo en 1.2.0), `https-proxy-agent`, `jws`,
    `minimist`, y debajo `bn.js`, `agent-base`, `debug`, `ms`, `jwa`, `ecdsa-sig-formatter`,
    `safe-buffer`, `buffer-equal-constant-time`, `inherits`, `minimalistic-assert` y `safer-buffer`.
  - **Avisos de seguridad en esa cadena:** `web-push` no tiene ninguno propio, pero sí sus
    dependencias:
    - `jws` 4.0.0, aviso alto GHSA-869p-cjfg-cm3x, corregido en la 4.0.1;
    - `bn.js` anterior a 4.12.3 y a 5.2.3, aviso moderado GHSA-378v-28hj-76wf.

    Una instalación de hoy tomaría las versiones corregidas, pero cada aviso nuevo de esa cadena
    sería trabajo para un proyecto sin quien lo mantenga.
  - **Principio VI:** se prefiere lo que ya existe. Todo lo necesario está en `node:crypto`, que ya
    usan `totp.ts` (verificación en dos pasos propia), `secret-box.ts` (AES-256-GCM, spec 009) y la
    firma de la IP. Es el mismo camino que esos módulos, y el cron y Lambda no instalan nada nuevo.
  - **Arranque en frío:** `node:crypto` ya está cargado; la librería sumaría módulos al arranque.
- **Coste:** unas 150 líneas más sus pruebas. El riesgo de equivocarse en el cifrado se cubre con el
  ejemplo exacto de la RFC: si un byte no coincide, la prueba falla.
- **Descartado:**
  - **`web-push`:** por lo de arriba.
  - **Firebase Cloud Messaging con su SDK:** es un servicio externo con cuenta propia y no llega a
    Safari ni a Firefox (RF-010).
  - **Web Crypto (`crypto.subtle`) en vez de `node:crypto`:** todo es asíncrono y hay más código, sin
    ganar nada en Node.

## R2. Las claves del servicio de avisos (VAPID)

- **Tres variables nuevas en `src/config.ts`:**
  - **`VAPID_PUBLIC_KEY`:** la pública, en base64url (87 caracteres). No es secreta: el navegador la
    recibe para suscribirse.
  - **`VAPID_PRIVATE_KEY`:** la privada, en base64url (43 caracteres). Es secreta.
  - **`VAPID_SUBJECT`:** opcional. El contacto que exige Apple. Por defecto es `APP_URL` si empieza
    por `https://` y, si no, `mailto:` + `GMAIL_USER`.
- **Cómo se crean:** `npm run push:keys` (`scripts/push-keys.ts`, con `generateVapidKeys` de R1)
  muestra las dos líneas `VAPID_PUBLIC_KEY=…` y `VAPID_PRIVATE_KEY=…` para copiarlas. Es como el
  `openssl rand` de `TWO_FACTOR_KEY` en la spec 009.
- **Sin claves, o con una clave que no sirve, no hay avisos y la API funciona igual (RF-011):**
  - `config.webPush` queda en `null` y el registro dice «Avisos en el celular desactivados: falta
    VAPID_PRIVATE_KEY» (o «no es válida»), sin mostrar valores;
  - `GET /api/push/config` responde `available: false` y la tarjeta dice «Los avisos en el celular
    todavía no están disponibles»;
  - `/api/health` dice `"push": false` (se comprueba al publicar, como `"captcha"`);
  - **no se suman a la lista de R9 de la spec 009** (la API no arranca si falta algo que la
    protege): los avisos no protegen nada, y una clave mal copiada no puede dejar la agenda sin
    servicio.
- **Base local (`dev:local`):** si no hay claves, `scripts/dev-local.ts` crea un par de desarrollo
  la primera vez, lo guarda en `.local-db/vapid.json` (fuera de git) y se lo pasa a la API. Así se
  prueba en local sin escribir claves en el código. Las pruebas crean su propio par en
  `scripts/test.ts`.
- **Dónde van las de verdad:** en el backend de Vercel, en Lambda y en los secretos de GitHub para el
  cron (ver la publicación del plan). En el `.env` de `dev:prod` son opcionales: sin ellas, lo que se
  haga desde el equipo queda en cola y lo envía el cron.
- **Si se pierden o se cambian,** las suscripciones hechas con las anteriores dejan de servir:
  - el servicio de avisos responde 401 o 403 y el aparato acaba dado de baja (R6);
  - al abrir el panel, la app nota que la clave cambió (`subscription.options.applicationServerKey`
    distinta de la de `/api/push/config`) y se vuelve a suscribir sola en Chrome, Edge y Firefox. En
    el iPhone vuelve a salir «Activa los avisos» y basta un toque (R17).

  Por eso se guardan en un lugar seguro, como `TWO_FACTOR_KEY`.

## R3. Los aparatos: uno por navegador, del usuario y con sus tipos

- **Tabla nueva `push_subscriptions`** ([data-model.md](./data-model.md)). Cada fila es un navegador
  de un aparato:
  - la dirección (`endpoint`), única;
  - las claves `p256dh` y `auth`;
  - de qué usuario es y desde qué sesión se activó;
  - los tipos apagados (`muted_kinds`);
  - cuándo se activó.
- **Se guarda por usuario, no por negocio.** El negocio se deduce al enviar (R5): así cambiar el
  propietario deja de avisar al anterior sin tocar nada (RF-009).
- **Activar es «guardar o actualizar» por dirección** (`PUT /api/push/device`):
  - **si la dirección ya existe y es del mismo usuario:** se actualizan las claves y la sesión, y se
    conservan sus tipos;
  - **si era de otro usuario** (otra persona entró en ese navegador): pasa al nuevo, con todos los
    tipos encendidos.
- **Todos los tipos vienen encendidos:** se guardan los apagados, no los encendidos. Un tipo que se
  añada en el futuro llega encendido (decisión 5 del dueño).
- **Varios aparatos (RF-002):** hasta 10 por usuario. Al activar el undécimo, se quita el más
  antiguo.
- **Cerrar sesión pausa ese aparato** (cambio respecto a la spec, ver el plan):
  - `authService.signOut` marca `signed_out_at` en los aparatos activados desde esa sesión;
  - mientras tanto no reciben nada;
  - al volver a entrar, la app los reanuda sola (R17).

  Así, en una computadora compartida (la de recepción), quien entra después no ve los avisos del
  propietario. Si una sesión caduca o se cierra desde otro lado (cambio de contraseña), el aparato
  sigue recibiendo (`on delete set null`): caducar no es cerrar sesión.
- **Sin cifrado propio (`secret-box.ts` no hace falta):**
  - la dirección y las claves sólo sirven para enviar a ese aparato con la firma de Agenda360. Los
    servicios de avisos rechazan lo que no venga firmado con la clave privada VAPID con la que se
    suscribió (RFC 8292). Lo secreto es esa clave, y vive en las variables de entorno, no en la base;
  - la tabla no tiene datos de pacientes.
- **Descartado:**
  - **Los tipos por usuario y no por aparato:** la spec los pone en el aparato («qué tipos de aviso
    quiere») y permite, por ejemplo, sólo reservas en la computadora y todo en el celular.
  - **Borrar el aparato al caducar la sesión:** con «Recordarme» la sesión dura 30 días como mucho.
    El propietario dejaría de recibir avisos sin enterarse.

## R4. La dirección del aparato no puede apuntar a cualquier sitio

- **El riesgo:** la dirección la manda el navegador y el servidor le hace un `POST`. Cualquiera puede
  registrarse y ser propietario. Una dirección falsa haría que la API llamara a servicios internos
  (SSRF).
- **Decisión (`isAllowedPushEndpoint`):** sólo `https://`, puerto 443, y uno de estos servicios:
  - `fcm.googleapis.com`: Chrome, Edge en Android, Opera, Samsung Internet y Brave;
  - `updates.push.services.mozilla.com`: Firefox;
  - `web.push.apple.com`: Safari en el iPhone, el iPad y la Mac;
  - `*.notify.windows.com`: Edge en Windows.

  Si no, 400: «Este navegador usa un servicio de avisos que no reconocemos. Prueba con Chrome,
  Safari, Edge o Firefox.».
  - **Con la base local** (pruebas y `dev:local`, nunca en la nube ni con `dev:prod`): también
    `http://127.0.0.1:<puerto>`, para el servicio de avisos falso de las pruebas.
  - **Además:** el envío no sigue redirecciones (`redirect: "error"`) y espera 10 s como mucho.
- **Las claves se comprueban al guardar:**
  - `p256dh` debe ser un punto P-256 válido de 65 bytes que empiece por `0x04`. Se comprueba con
    `createECDH().computeSecret`;
  - `auth` debe tener 16 bytes.

  Así un aparato roto no llega a la cola.
- **Los registros nunca muestran la dirección completa:** sólo el servicio (`fcm.googleapis.com`) y
  el código de respuesta.

## R5. A quién va cada aviso

- **Propietario:** los aparatos (no pausados ni muy fallidos) del usuario que es
  `businesses.owner_id`, con la cuenta activa, en un negocio activo y que no tengan ese tipo apagado.
  Se calcula **al poner el aviso en cola**, así:
  - **cambiar el propietario (RF-009):** los aparatos del anterior dejan de recibir solos;
  - **negocio sin propietario:** `owner_id` es null, así que nadie;
  - **super admin en modo soporte:** nunca es `owner_id` (no puede tener negocios), así que no recibe
    los del negocio que gestiona;
  - **Recepción, administradores y el rol Profesional:** no son `owner_id`. Además, las rutas de
    aparatos sólo admiten al propietario y al super admin (contrato).
- **Super admin:** los aparatos de todos los usuarios con `platform_role = 'super_admin'` y la cuenta
  activa. Para activar hace falta la verificación en dos pasos (`authorizeSuperAdmin`), como el resto
  de `/admin`. Si hay varios super admin, cada uno activa los suyos (ver el plan).
- **Quien lo provoca no se avisa a sí mismo:** «Cita nueva en tu agenda» no sale si la agendó el
  propio propietario (`excludeUserId`).
- **Tipos (`PushKind`, compartido en `src/lib/constants/push.ts`):**

  | Tipo | Para | Cuándo |
  |---|---|---|
  | `booking` | Propietario | Reserva online nueva, también «Por verificar» |
  | `receipt` | Propietario | Comprobante de pago recibido |
  | `patient_cancel` | Propietario | El paciente canceló desde su email (spec 010) |
  | `new_appointment` | Propietario | Cita nueva en su agenda que agendó otra persona (una por serie) |
  | `unclosed` | Propietario | Cita que terminó hace 30 min y sigue Pendiente o Confirmada (cron) |
  | `evening_summary` | Propietario | 8 de la noche: citas de hoy sin cerrar (cron) |
  | `new_business` | Super admin | Alguien terminó su alta (onboarding) |
  | `plan_request` | Super admin | Solicitud de cambio de plan |
  | `account_security` | Super admin | Cambio de seguridad en una cuenta de super admin (cron) |
  | `login_attack` | Super admin | Posibles intentos de adivinar contraseñas (cron) |
  | `test` | Los dos | Aviso de prueba: siempre sale, no se puede apagar |

## R6. La cola de avisos: en la misma transacción, como los emails

- **Decisión:** tabla nueva `push_messages`, un aviso por aparato, que funciona igual que la cola de
  emails (`notifications` + `mailer.ts`):
  1. **Poner en cola:** el servicio que provoca el aviso llama a `queuePush(db, audience, message)`
     (`src/services/push-delivery.ts`) **dentro de su transacción**. Si la reserva falla y se
     deshace, el aviso también: nunca llega «Nueva reserva» de una reserva que no existe.
  2. **Enviar al momento:** `schedulePushDelivery()`, la misma idea que `scheduleEmailDelivery`:
     - **servidor normal:** un temporizador de 1 s;
     - **Vercel:** lo mismo, mantenido vivo con `waitUntil` de `@vercel/functions`, que ya usan
       `mailer.ts` y `alerts.ts`. La respuesta no espera al envío;
     - **Lambda:** `flushPushDelivery()` al final de la respuesta, junto a `flushEmailDelivery()` y
       `flushAlerts()` en `src/app.ts`;
     - **el cron:** `disableImmediatePushDelivery()`, porque envía él mismo al final (R15).
  3. **`processPushQueue({ deadline })`:**
     - toma hasta 20 avisos listos (`for update skip locked`) y los reserva 2 minutos;
     - los envía de 5 en 5;
     - guarda el resultado de cada uno al momento.

     En la API el plazo es de 5 s; lo que no salga lo envía el cron.
- **Qué se hace con cada respuesta del servicio de avisos:**

  | Respuesta | Qué se hace |
  |---|---|
  | 201 (o 200, 202) | Enviado. El aparato vuelve a 0 fallos. |
  | 404 o 410 | El aparato ya no existe (desinstaló la app o borró los datos): **se borra** con sus avisos pendientes (RF-008). |
  | 429, 5xx, sin red o más de 10 s | Se reintenta a los 1, 5, 15 y 60 minutos (o lo que pida `Retry-After`, hasta 1 h), mientras no pasen 24 h. |
  | 400, 401, 403 o 413 | No se reintenta. El aparato suma un fallo, y con 5 seguidos se borra: pasa, por ejemplo, si cambiaron las claves (R2). |

- **Caducidad de 24 h (caso límite «Sin conexión»):**
  - el servicio de avisos guarda el aviso hasta que el celular se conecta. Se envía con
    `TTL` = lo que falta para las 24 h desde que se puso en cola;
  - lo que no salió en 24 h queda como fallido («Caducó»).
- **Nunca rompe la reserva ni los emails (RF-011):**
  - `queuePush` trabaja dentro de un punto de guardado (`savepoint aviso … release`). Si algo falla
    (por ejemplo, si se publicó el código antes de aplicar la migración 040), vuelve a ese punto,
    lo anota en el registro sin datos y la transacción sigue: la reserva y sus emails se guardan
    igual;
  - el envío corre después de responder y captura sus propios errores.
- **Sin repetir:** `push_messages.dedupe_key` es único por aparato. Los avisos del cron llevan clave
  (R12–R14), así que un reintento del cron no los duplica. Cada aviso lleva además un `tag` (R7): si
  el servicio de avisos entregara dos veces el mismo, el segundo reemplaza al primero en la
  pantalla.
- **Limpieza (cron):**
  - avisos de más de 7 días, con cualquier estado;
  - aparatos pausados hace más de 90 días.
- **Por qué una cola y no enviar directamente:** el envío directo necesitaría sacar los datos de cada
  transacción para mandarlos al terminar. Habría que cambiar el final de seis servicios y, si la
  instancia de Vercel se congelaba, el aviso se perdía. Con la cola, los servicios hacen lo mismo que
  con los emails (`queueEmail`), y lo que la API no llegó a enviar lo envía el cron.
- **Descartado:** el retraso de 1 s después de la transacción, que es el mismo que usan los emails,
  tiene un caso raro: si la transacción tarda más de 1 s, el aviso sale con el cron. Engancharse al
  `commit` exigiría cambiar `transaction()` para todo el proyecto, y los emails llevan meses así sin
  problemas.

## R7. Lo que dice cada aviso

- **Privacidad (principio II, RF-006):**
  - el paciente siempre con `shortName` de `src/services/masking.ts` («Juan P.»): con dos o tres
    pacientes, «Juan P. y Ana M.» o «Juan P., Ana M. y Luis R.»;
  - nunca la cédula, el email, el teléfono ni nada de la historia clínica;
  - el servicio sí va, porque lo pidió el dueño en el texto («Limpieza»).

  Una prueba recorre todos los avisos con pacientes de nombre largo, email, teléfono y cédula, y
  comprueba que no aparece ninguno de esos datos (CE-003).
- **El contenido va cifrado de punta a punta (R1):** Google, Apple, Mozilla o Microsoft lo
  transportan, pero no lo pueden leer. Los registros de la API y del cron (los de GitHub son
  públicos) nunca escriben el título ni el texto: sólo cifras.
- **El día:** se calcula en la zona del negocio (`getZonedNow`). Puede ser «Hoy 16:00», «Mañana
  16:00» o «Mar 20 oct 16:00» (`formatShortDate`), con la primera letra en mayúscula.
- **Los textos** (contrato completo en [contracts/api.md](./contracts/api.md)):

  | Tipo | Título | Texto | Al tocarlo |
  |---|---|---|---|
  | `booking` | Nueva reserva | Mañana 16:00 · Limpieza · Juan P. (· Por verificar) | La cita en la agenda |
  | `receipt` | Comprobante de pago | Juan P. · Mañana 16:00 | La cita |
  | `patient_cancel` | Cita cancelada por el paciente | Mañana 16:00 · Juan P. | La cita |
  | `new_appointment` | Cita nueva en tu agenda | Mañana 16:00 · Juan P. | La cita |
  | `new_appointment` (serie) | Citas nuevas en tu agenda | 8 citas desde el mar 20 oct 10:00 · Juan P. | La primera cita |
  | `unclosed` | Cita por cerrar | 15:00 · Limpieza · Juan P.: márcala Completada o No asistió | La cita, con sus botones de estado |
  | `evening_summary` | Tienes 3 citas de hoy sin cerrar | Márcalas Completada o No asistió para que la agenda y los reportes cuadren. | La agenda del día |
  | `new_business` | Negocio nuevo | Mente Abierta · Psicología | Su ficha en /admin |
  | `plan_request` | Solicitud de cambio de plan | Mente Abierta · de Free a Pro | Su ficha en /admin |
  | `account_security` | Cambio de seguridad en una cuenta de super admin | ma***@gmail.com · Desactivó la verificación en dos pasos | Actividad → Seguridad |
  | `login_attack` | Posibles intentos de adivinar contraseñas | ju***@gmail.com: 12 intentos fallidos en la última hora | Actividad → Seguridad |
  | `test` | Avisos activados | Listo: aquí te avisaremos de las reservas. (super admin: «…de lo importante de la plataforma.») | El Inicio |

- **El profesional en el aviso:** si el negocio tiene más de una agenda activa, «Nueva reserva» y
  «Cita por cerrar» añaden «· con Dra. Pérez». Es el nombre de la agenda (`display_name`), no un dato
  del paciente. Es un cambio respecto a la spec y queda como pregunta para el dueño.
- **Lo que viaja** (JSON cifrado, menos de 1 KB; el texto se corta a 240 caracteres):
  `{ "title", "body", "url", "tag", "kind" }`.
  - **`url`:** siempre una ruta del propio sitio, por ejemplo
    `/dashboard/calendar?date=2026-10-15&appointment=<id>`, la misma que ya usan los emails al
    negocio. Para el super admin, `/admin/businesses/<id>` o `/admin/activity?ver=seguridad`.
  - **`tag`:** un identificador del aviso, por ejemplo `reserva-<id>`, `comprobante-<id>` o
    `resumen-2026-10-15`. Cada aviso tiene el suyo, así que no se agrupan (caso límite «Muchas
    reservas a la vez»).
- **`Urgency`:**
  - `high` para los del propietario que pasan al momento y para las alertas de seguridad. Android los
    entrega aunque el celular esté en reposo;
  - `normal` para «Cita por cerrar», el resumen, «Negocio nuevo» y las solicitudes de plan.

## R8. Reserva online

- **Dónde:** `publicBookingService.book` (`src/services/public-booking-service.ts`), después de
  `logAudit`, dentro de la transacción: `await notifyOnlineBooking(db, appointment)`
  (`src/services/push-notices.ts`).
- **Qué hace `notifyOnlineBooking`:**
  - lee en una consulta el negocio (zona, propietario, agendas activas), el servicio, el profesional y
    los pacientes, con `claimed_client_id`;
  - si alguno está «Por verificar» (spec 009), añade «· Por verificar».
- **Un reintento de la misma reserva no avisa otra vez:** `findRepeatedBooking` responde antes de
  llegar ahí.
- **En una sesión en pareja o en familia** (specs 004 y 005), un solo aviso con todos los pacientes a
  medias.

## R9. Comprobante de pago

- **Dónde:** `paymentService.completeUpload` (`src/services/payment-service.ts`), junto a
  `notifyReceiptReceived`, dentro de la transacción y sólo cuando el comprobante queda `ready`:
  `await notifyReceipt(db, updated)`.
- **Una segunda pestaña que sube otro comprobante** se descarta antes (`alreadySent`), así que no
  avisa dos veces.
- **El email al negocio no cambia;** el aviso se suma. El ntfy de los comprobantes tampoco cambia:
  hoy no existe y el dueño no lo pidió.

## R10. Cancelación del paciente (spec 010)

- **Dónde:** en `cancelFromPatientLink(db, before)` de `business-data-service.ts`, la función que
  añade la spec 010 (su R6), después de `logAudit`: `await notifyPatientCancel(db, after)`.
- **Un doble toque no avisa dos veces:** si la cita ya estaba cancelada, la 010 responde
  `already: true` sin pasar por ahí.
- **Si la 013 se implementara antes que la 010,** este punto queda para cuando exista esa función.
  El plan pide implementar ésta después de la 010.

## R11. Cita nueva en la agenda del propietario, y las series de la spec 011

- **Una cita suelta:** `appointmentService.create` (`business-data-service.ts`), después de
  `logAudit`: `await notifyNewAppointment(db, appointment, actor.userId)`. Avisa sólo si se cumplen
  las tres cosas:
  - la agenda de la cita es la del propietario: `professionals.user_id = businesses.owner_id`;
  - no la agendó él: `actor.userId <> owner_id`;
  - el estado es Pendiente o Confirmada.

  Entra Recepción, un administrador o el super admin en modo soporte. Crear una cita es un cambio y
  no la entrada al modo soporte, que es lo que no se avisa (principio III).
- **Mover una cita a la agenda del propietario** (`update`) no avisa: la spec habla de citas nuevas.
- **Una serie (spec 011):** `appointment-series-service.ts` crea sus citas sin pasar por
  `appointmentService.create`. Al final de su transacción llama una sola vez a
  `notifyNewSeries(db, created, actor.userId)`, con las mismas tres condiciones:
  - título «Citas nuevas en tu agenda»;
  - texto «8 citas desde el mar 20 oct 10:00 · Juan P.»;
  - abre la primera.

  Es como el email único y el ntfy único de la serie (R7, R8 y R11 de la 011). Ocho avisos seguidos
  serían el mismo spam.
- **La reserva online no es «cita nueva en tu agenda»:** ya tiene su aviso (R8), aunque sea en la
  agenda del propietario. Nunca salen los dos.

## R12. Citas por cerrar (cron)

- **Qué cuenta:** una cita Pendiente o Confirmada cuyo fin más 30 minutos (`UNCLOSED_AFTER_MINUTES`)
  cayó entre la pasada anterior del cron y ésta. Es la misma ventana (desde, hasta] que usan los
  avisos de ntfy (`findStatusChanges` y los demás), con la hora de `cron_runs`.
- **Cómo:** `queueUnclosedNotices(pool, since, until)` en `push-notices.ts`:
  1. una consulta trae los negocios activos con propietario que tienen al menos un aparato con
     `unclosed` encendido;
  2. para cada uno, `getZonedNow(timezone, since)` y `getZonedNow(timezone, until)` dan la ventana en
     su hora;
  3. busca sus citas de esas fechas (índice `appointments_business_date_idx`) con
     `(date, end_time + 30 min)` dentro de la ventana;
  4. pone un aviso por cita con la clave `por-cerrar:<id>:<fecha>T<fin>`.
- **Sin repetir:** cada cita entra en una sola ventana, y la clave impide repetirla si el cron
  reintenta su pasada. Si después se cambia la hora y sigue sin cerrar, es otra clave y otro aviso.
- **Si ya se cerró antes del aviso, no se avisa** (escenario 3): el estado se mira al poner en cola.
- **Tope de 3 horas:** si el cron estuvo parado, la ventana empieza como mucho 3 horas atrás. Así no
  llueven los avisos de toda la mañana, y las que queden las cuenta el resumen de las 8.
- **Medianoche:** una cita que termina a las 23:45 se avisa a las 00:15 del día siguiente. La
  ventana compara instantes, no fechas.
- **Las de días anteriores no avisan** (caso límite): quedan fuera de la ventana.
- **Hasta 100 avisos por pasada.** El cron corre en GitHub, no en Vercel.
- **Descartado:** una columna «avisada» en `appointments`. Habría que tocar la tabla más usada y
  borrar la marca cada vez que se mueve la cita, y la ventana con clave da lo mismo sin tocarla.

## R13. Resumen de las 8 de la noche (cron)

- **Cuándo:** en la pasada del cron en cuya ventana cae «hoy a las 20:00» en la zona del negocio
  (`EVENING_SUMMARY_HOUR`), con el mismo tope de 3 horas de R12.
- **Qué cuenta:** las citas de hoy (fecha del negocio) que siguen Pendiente o Confirmada y que
  terminaron a las 20:00 o antes. Las de más tarde todavía no se pueden cerrar.
- **Si cuenta 0, no sale nada** (escenario 2).
- **Texto y clave:**
  - una cita: «Tienes 1 cita de hoy sin cerrar»; varias: «Tienes 3 citas de hoy sin cerrar»;
  - abre `/dashboard/calendar?date=<hoy>`;
  - clave `resumen:<negocio>:<fecha>`.
- **Sale una sola vez por día:** aunque después de las 8 quede otra cita sin cerrar, no se repite.
- **Se apaga aparte de «Citas por cerrar»** (escenario 4): son tipos distintos.
- **Si el cron no corre entre las 20:00 y las 23:00,** ese día no llega el resumen.

## R14. Los avisos del super admin

- **Al momento, desde la API, en la misma transacción:**
  - **Negocio nuevo:** en `businessService.create` (`src/services/account-service.ts`, el alta del
    onboarding, después de registrar `business.created`): `await notifyNewBusiness(db, business)`
    con el nombre y la categoría. Un negocio que crea un super admin desde /admin
    (`adminService.createBusiness`) no avisa: la spec dice «cuando alguien se registra» y quien lo
    crea ya lo sabe (pregunta para el dueño).
  - **Solicitud de cambio de plan:** en `subscriptionService.requestPlanChange` (el mismo archivo),
    junto a los emails `plan_change_requested`: `await notifyPlanRequest(db, …)`. Lleva el negocio y
    los planes, que sólo ve el super admin: la regla «los negocios no ven planes ni precios» no
    cambia.
- **Desde el cron, como sus avisos de ntfy:**
  - **Cambios de seguridad en cuentas de super admin:** con lo que ya devuelve `findAccountChanges`
    (spec 009), la cuenta a medias y qué cambió. Clave `cuenta:<id del registro>`, para lo que
    `AccountChange` gana el `id` del registro.
  - **Intentos fallidos:** con lo que ya devuelve `findLoginAttacks` (`scheduled-tasks.ts`), un solo
    aviso con la primera cuenta y «y 2 cuentas más». Clave `intentos:<cuenta a medias>:<hora>`: como
    mucho uno por cuenta y por hora, aunque el ataque siga en cada pasada.
- **ntfy sigue igual:** estos avisos llegan por los dos canales (escenario 3).

## R15. El cron

- **En `runScheduledTasks` (`src/jobs/scheduled-tasks.ts`)**, después de los avisos de ntfy:
  1. `queueUnclosedNotices` y `queueEveningSummaries` (R12, R13);
  2. los dos del super admin (R14);
  3. `processPushQueue` con 60 s de plazo. Envía lo del cron y lo que la API no llegó a enviar;
  4. la limpieza de R6.
- **El informe (`ScheduledTasksReport`)** gana `push: { queued, sent, retrying, failed,
  removedDevices }`. Se guarda en `cron_runs.report`, que es jsonb: sin migración.
- **La línea del registro (`scripts/cron.ts`)** suma «avisos en la app: enviados N · fallidos N ·
  aparatos dados de baja N». Son sólo cifras: el registro de Actions es público.
- **Si en una pasada fallan avisos y no sale ninguno** (por ejemplo, claves mal puestas), ntfy avisa
  con «Agenda360: los avisos en la app no salen», prioridad 4, sin datos.
- **Variables en `.github/workflows/cron.yml`:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
  `VAPID_SUBJECT`, de los secretos del repositorio. Sin ellas, el cron no envía avisos: quedan en cola
  y caducan.
- **CPU de Vercel:** nada de esto corre en Vercel (principio VI).

## R16. El service worker del front (`src/sw.ts`)

Hoy sólo guarda la app (workbox `injectManifest`, `tsconfig.sw.json` con `WebWorker`). Gana tres
eventos:

- **`push`:**
  - lee el JSON y muestra `self.registration.showNotification(title, { body, icon:
    "/icon-app-192.png", badge: "/icon-badge-96.png", tag, data: { url }, lang: "es" })`;
  - todo dentro de `event.waitUntil`;
  - si no puede leer el contenido, muestra «Agenda360 · Tienes un aviso nuevo».

  Siempre muestra algo: Safari y Chrome dan de baja a los sitios que reciben avisos sin mostrarlos
  (`userVisibleOnly`).
- **`notificationclick`:**
  1. cierra el aviso;
  2. acepta sólo rutas del propio sitio que empiecen por `/dashboard` o `/admin`. Cualquier otra cosa
     abre `/dashboard`;
  3. si la app ya está abierta, la enfoca y le manda un mensaje (`postMessage`). El front navega sin
     recargar: `src/features/push/notification-navigation.ts`, cargado en `main.tsx`, llama a
     `router.navigate`;
  4. si no, `clients.openWindow(url)`. En el iPhone abre la app instalada.

  Si la sesión caducó, el panel lleva al inicio de sesión y después a esa pantalla (R18).
- **`pushsubscriptionchange`** (Firefox, cuando el servicio de avisos renueva la dirección):
  - se vuelve a suscribir con la misma clave;
  - avisa a la API con `PUT /api/push/device` y `previousEndpoint`, con la cookie y
    `X-Requested-With`.

  Si falla (sin sesión), lo arregla la sincronización al abrir el panel (R17).
- **Icono nuevo `public/icon-badge-96.png`:** la silueta del calendario en blanco sobre transparente,
  para la barra de estado de Android. Sin él, Android muestra una campana genérica. Entra en la lista
  de archivos guardados por el patrón `png` de `vite.config.ts`.
- **El service worker sólo se registra en la versión compilada** (`useInstallableApp`, con
  `import.meta.env.PROD`). En `npm run dev` la tarjeta dice «Los avisos se prueban con la versión
  compilada», y en local se prueba con `npm run build` y `vite preview` ([quickstart.md](./quickstart.md)).
- **Tipos:** `PushEvent` y `NotificationEvent` vienen en `lib.webworker`. Si falta el evento de la
  suscripción renovada, se declara en `sw.ts`.

## R17. Activar, desactivar y elegir los tipos (front)

- **Qué puede este navegador** (`src/features/push/push-support.ts`), reutilizando `isStandalone` e
  `isAppleMobile` de `features/install/install-prompt.ts`, que se exportan:

  | Estado | Cuándo | Qué dice la tarjeta |
  |---|---|---|
  | `unavailable` | `/api/push/config` dice `available: false` | «Los avisos en el celular todavía no están disponibles.» |
  | `ios-install` | iPhone o iPad, no instalada | «En el iPhone los avisos sólo llegan con la app instalada.» y «Cómo instalarla» (el diálogo `IosInstallDialog` de `install-app.tsx`, que se exporta) |
  | `ios-old` | iPhone o iPad instalada, sin `PushManager` | «Tu iPhone necesita iOS 16.4 o más reciente para recibir avisos.» |
  | `unsupported` | Sin `serviceWorker`, `PushManager` o `Notification` (por ejemplo, el navegador de otra app) | «Este navegador no permite avisos. Ábrela en Chrome, Safari, Edge o Firefox.» |
  | `denied` | `Notification.permission === "denied"` | «Bloqueaste los avisos en este navegador» y los pasos para permitirlos: Chrome y Edge (el candado → Notificaciones → Permitir), Firefox, Safari de la Mac y el iPhone (Ajustes → Notificaciones → Agenda360) |
  | `off` | Puede, pero no está activado | «Activar los avisos» |
  | `on` | Activado en este aparato | «Activados en este celular», «Enviar un aviso de prueba», «Desactivar en este celular» y un interruptor por tipo |

- **El gesto del usuario:** el navegador sólo pide el permiso como respuesta a un toque. Por eso
  «Activar» hace, sin esperar nada de la red en medio:
  1. `Notification.requestPermission()`;
  2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.

  La clave pública y el service worker (`navigator.serviceWorker.ready`) se tienen listos desde que
  aparece la tarjeta o el aviso: `usePushConfig` los pide con `staleTime: Infinity`. Después:
  - `PUT /api/push/device`;
  - `POST /api/push/device/test`, que manda el aviso de prueba (escenario 2);
  - «Avisos activados».

  Si el navegador no da el permiso, el mensaje dice cómo cambiarlo.
- **El aviso al entrar al panel** (`src/features/push/push-prompt.tsx`, RF-001b):
  - **dónde:** una franja arriba del contenido, en el mismo lugar que la de modo soporte (nunca
    coinciden). Va en `dashboard-layout.tsx` para el propietario fuera del modo soporte y en
    `admin-layout.tsx` para el super admin con la verificación activada;
  - **cuándo:** sólo en el estado `off`, si el navegador no está bloqueado, si no se eligió «Ahora no»
    en los últimos 7 días (`agenda360:avisos-ahora-no`, en `localStorage`, por aparato) y si esa
    persona no desactivó los avisos en este aparato (`agenda360:avisos-desactivados:<usuario>`);
  - **texto:** «Activa los avisos en este celular · Te avisamos al momento de las reservas, los
    comprobantes y las cancelaciones.» con «Activar» y «Ahora no». Para el super admin: «…de los
    negocios nuevos, las solicitudes de plan y las alertas de seguridad.»;
  - **sin almacenamiento** (navegación privada): vuelve a salir en cada visita, como
    `InstallAppCard`. Todo el acceso a `localStorage` va con `try/catch`.
- **La tarjeta «Avisos en este celular»** (`src/features/push/push-settings-card.tsx`):
  - **negocio:** en Configuración → Notificaciones, arriba de todo, sólo para el propietario y no en
    modo soporte. Esa pestaña ya es sólo del propietario (`business.manage`);
  - **super admin:** en Configuración de /admin, en la columna de la cuenta, junto a la verificación
    en dos pasos;
  - **los tipos:** los del rol (`kinds` de `/api/push/config`), con `SwitchField` y las etiquetas de
    `PUSH_KIND_LABELS`. Cada interruptor se guarda al momento (`PATCH`) y lo confirma con «Guardado»;
  - **«Desactivar en este celular»:** `POST /api/push/device/off` más `subscription.unsubscribe()`,
    y guarda la marca de desactivado;
  - **«celular» o «computadora»:** «en este celular» con pantalla táctil (`(pointer: coarse)`) y «en
    esta computadora» si no;
  - **accesible:** el estado se anuncia con `aria-live="polite"` y cada interruptor tiene su
    etiqueta;
  - **a 390 px,** una columna sin desplazamiento horizontal (CE-004).
- **Sincronización silenciosa al abrir el panel** (`usePushSync`, en los dos layouts):
  - con el permiso ya dado y una suscripción en el navegador, `PUT /api/push/device` sin preguntar
    nada. Así:
    - se reanuda lo que pausó cerrar sesión (R3);
    - se pasa el aparato a quien entró;
    - se arregla una dirección renovada;
  - si la clave pública cambió (R2): en Chrome, Edge y Firefox se vuelve a suscribir sola; en Safari
    se deja en `off` para que el aviso ofrezca el toque;
  - nunca si esa persona lo desactivó en este aparato.
- **Datos:**
  - `src/lib/data/repository.ts` y `api-repository.ts` ganan `push: { getConfig, saveDevice,
    updateKinds, turnOff, sendTest }`;
  - los hooks van en `src/hooks/queries/use-push.ts`.
  - **Si la API todavía no tiene las rutas** (front publicado antes), `getConfig` trata el 404 como
    `available: false`: no se ve nada.
- **La tarjeta de instalar** (`InstallAppCard`) cambia su texto a «Ábrela desde un icono en tu
  pantalla de inicio y recibe avisos, como cualquier aplicación.»

## R18. Abrir un aviso con la sesión cerrada (RF-007)

- **Hoy** `dashboard-layout.tsx` y `admin-layout.tsx` mandan a `/login` y, al entrar,
  `login-form.tsx` va siempre al Inicio (`getHomePath`).
- **Decisión:**
  - los layouts mandan a `/login?next=<ruta y parámetros>`;
  - `login-form.tsx` va a `next` si `safeNextPath` lo acepta, y si no, al Inicio.

  `safeNextPath` es una función nueva en `src/lib/auth`. Acepta sólo rutas propias que empiezan por
  `/dashboard` (usuario de negocio) o `/admin` (super admin). Rechaza `//`, `\` y cualquier
  dirección completa, para que no sirva para mandar a otro sitio. Con la verificación en dos pasos,
  `next` se conserva hasta el final.
- **La analítica no ve `next`:** `page-analytics.tsx` ya quita los parámetros.
- **«Actividad → Seguridad»:** `admin-activity-page.tsx` lee `?ver=seguridad` para abrir esa
  pestaña. Hoy guarda la pestaña sólo en el estado.

## R19. CSP, privacidad y analítica

- **`vercel.json` del front no cambia:**
  - `pushManager.subscribe` lo resuelve el propio navegador con su servicio de avisos, sin pasar por
    `connect-src` de la página;
  - el service worker sólo usa iconos y rutas del propio sitio (`'self'`);
  - el envío lo hace el backend, de servidor a servidor;
  - `Permissions-Policy` no limita las notificaciones: no hay una directiva estándar para eso.
- **`/privacidad`** (`src/pages/privacy-page.tsx`) gana un párrafo en la sección de servicios de
  terceros, y cambia la fecha de «Última actualización»:

  > «Avisos en el celular: si el propietario de un negocio o el super admin los activan, cada aviso
  > viaja cifrado por el servicio de avisos de su navegador (Google, Apple, Mozilla o Microsoft), que
  > no puede leer su contenido. Sólo lleva el nombre del paciente abreviado, nunca su contacto ni su
  > historia clínica.»

- **Los servicios de avisos no son servicios nuevos de pago:** son los de cada navegador, gratis y
  sin cuenta (RF-010). Lo aprobó el dueño en la spec.

## R20. Beta, orden con las specs 010 a 012 y archivos compartidos

- **La beta queda fuera:** no tiene servidor que envíe avisos ni claves. No se toca.
- **Se implementa después de las specs 010, 011 y 012,** con ellas ya cerradas en `dev`:
  - usa funciones que crean la 010 (`cancelFromPatientLink`) y la 011
    (`appointment-series-service.ts`);
  - comparte archivos con las tres: `scheduled-tasks.ts`, `scripts/cron.ts`, `src/types/index.ts`,
    `business-data-service.ts` y `src/db/seed.ts`.

  Su migración es la 040, después de la 039 de la 012.
- **Archivos compartidos nuevos (principio V):** `src/lib/constants/push.ts` y
  `src/lib/validations/push.ts` se escriben en el front. En el backend se crean vacíos antes de
  `npm run sync:shared`, porque el script sólo actualiza los que ya existen, como en la 011 y la 012.
- **`src/db/seed.ts`:** `push_messages` y `push_subscriptions` entran en `TABLES`, al principio para
  que el `truncate` las vacíe.
