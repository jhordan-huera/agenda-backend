# Contratos: Avisos en el celular desde la app instalada

Lo que cambia en la API, lo que dice cada aviso, el envío al servicio de avisos y el service worker.
Lo que no está aquí sigue igual.

## Rutas nuevas (`/api/push`, `src/routes/push-routes.ts`)

- **Van montadas después de la sesión** (`loadSession`) y con la cabecera `X-Requested-With`, como
  el resto del panel.
- **Sólo el propietario de un negocio activo o el super admin** con la verificación en dos pasos.
  - Los demás reciben 403 `forbidden`: «Los avisos en el celular son sólo para el propietario del
    negocio.».
  - El super admin sin la verificación recibe 403 `two_factor_required`.
- **El aparato se identifica por su dirección** (`endpoint`) en el cuerpo, nunca en la URL. Así no
  queda en los registros.

### `GET /api/push/config`

Lo que necesita el front antes de activar.

**Respuesta 200:**

```json
{ "available": true, "publicKey": "BEl6…(87 caracteres)", "kinds": ["booking", "receipt", "patient_cancel", "new_appointment", "unclosed", "evening_summary"] }
```

- **`available: false` y `publicKey: null`:** la API no tiene claves VAPID válidas (R2).
- **`kinds`:** los del rol, en el orden de la tarjeta. Al super admin le llegan `new_business`,
  `plan_request`, `account_security` y `login_attack`.

### `PUT /api/push/device`

Activa o actualiza el aparato. Lo usan «Activar», la sincronización al abrir el panel y la dirección
renovada del service worker.

**Cuerpo** (`pushDeviceSchema`, compartido):

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": { "p256dh": "BNc…(87)", "auth": "tBH…(22)" },
  "previousEndpoint": "https://…"
}
```

- **`previousEndpoint`:** opcional. Si es de este usuario, esa fila pasa a la dirección nueva y
  conserva sus tipos.
- **Guarda la sesión actual** y quita la pausa (`signed_out_at = null`).
- **Tipos:** conserva los del mismo usuario; si el aparato era de otra persona, vuelven los de
  fábrica.
- **Hasta 10 aparatos por usuario:** si pasa, se borra el más antiguo.

**Respuesta 200:**

```json
{ "mutedKinds": [], "createdAt": "2026-10-14T21:05:00.000Z" }
```

### `PATCH /api/push/device`

Enciende o apaga tipos de este aparato.

**Cuerpo:**

```json
{ "endpoint": "https://…", "mutedKinds": ["unclosed"] }
```

- `mutedKinds` sólo admite tipos del rol, nunca `test`.

**Respuesta 200:**

```json
{ "mutedKinds": ["unclosed"] }
```

### `POST /api/push/device/off`

«Desactivar en este celular»: borra el aparato.

**Cuerpo:**

```json
{ "endpoint": "https://…" }
```

**Respuesta 204.** También si ya no existía: así un doble toque no da error.

### `POST /api/push/device/test`

Manda el aviso de prueba a este aparato, al momento, sin cola, y espera la respuesta del servicio de
avisos (10 s como mucho).

**Cuerpo:**

```json
{ "endpoint": "https://…" }
```

**Respuesta 200:**

```json
{ "sent": true }
```

- Si el servicio responde 404 o 410, el aparato se borra y responde 409 (ver la tabla).

### Errores de las cinco rutas

| Código | Cuándo |
|---|---|
| 400 `validation` | Dirección que no es `https://` o de un servicio que no está en la lista (R4): «Este navegador usa un servicio de avisos que no reconocemos. Prueba con Chrome, Safari, Edge o Firefox.». Claves que no son un punto P-256 o 16 bytes. Un tipo que no es del rol. |
| 401 `unauthorized` | Sin sesión. |
| 403 `forbidden` / `two_factor_required` | Ver arriba. |
| 404 `not_found` | `PATCH` o `test` de una dirección que no es de este usuario. |
| 409 `conflict` | `test` con el aparato dado de baja por el servicio: «Este aparato ya no recibe avisos. Vuelve a activarlos.» |
| 429 `rate_limited` | `avisos-aparato`: 30 en 15 min (`PUT`, `PATCH` y `off`). `aviso-prueba`: 5 en 15 min. |
| 502 `push_failed` | `test` rechazado o sin respuesta: «No pudimos enviar el aviso de prueba. Inténtalo de nuevo en un momento.» |
| 503 `unavailable` | Sin claves VAPID: «Los avisos en el celular todavía no están disponibles.» |

## Rutas que cambian

### `GET /api/health`

- Gana `"push": true | false`: si la API tiene claves VAPID válidas. Es como `"captcha"`, y nunca
  muestra valores.

### `POST /api/auth/logout`

- Además de cerrar la sesión, pausa los aparatos activados desde ella (`signed_out_at = now()`).

### Rutas que ahora ponen avisos en cola

Todas lo hacen en su misma transacción. La respuesta no cambia, y si el aviso falla, la operación
sigue igual (R6).

| Ruta | Aviso |
|---|---|
| `POST /api/public/businesses/:slug/bookings` | `booking`, al propietario |
| `POST /api/public/payments/:token/receipts/:receiptId/complete` | `receipt`, al propietario |
| `POST /api/public/appointments/:token/cancel` (spec 010) | `patient_cancel`, al propietario |
| `POST /api/businesses/:businessId/appointments` | `new_appointment`, al propietario, si es su agenda y no la agendó él |
| `POST /api/businesses/:id/appointment-series` (spec 011) | `new_appointment`, uno por serie, mismas condiciones |
| `POST /api/businesses` (el alta del onboarding, `businessService.create`) | `new_business`, a los super admin |
| `POST /api/businesses/:businessId/subscription/request` (`subscriptionService.requestPlanChange`) | `plan_request`, a los super admin |

Las dos rutas de las specs 010 y 011 se citan como las nombran sus contratos.

## Lo que dice cada aviso

- **Título y texto:** sin la cédula, el email, el teléfono ni datos clínicos del paciente, que va
  con `shortName` («Juan P.»).
- **`{cuándo}`:** «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00», en la zona del negocio.
- **`{pacientes}`:** «Juan P.», «Juan P. y Ana M.» o «Juan P., Ana M. y Luis R.».
- **`{con}`:** «· con Dra. Pérez», sólo si el negocio tiene más de una agenda activa (pregunta 2 del
  plan).

| Tipo | Título | Texto | Abre | Urgencia |
|---|---|---|---|---|
| `booking` | Nueva reserva | `{cuándo} · {servicio} · {pacientes}{con}`, más « · Por verificar» si alguna persona lo está | `/dashboard/calendar?date={fecha}&appointment={id}` | high |
| `receipt` | Comprobante de pago | `{pacientes} · {cuándo}` | la misma | high |
| `patient_cancel` | Cita cancelada por el paciente | `{cuándo} · {pacientes}` | la misma | high |
| `new_appointment` | Cita nueva en tu agenda | `{cuándo} · {pacientes}` | la misma | high |
| `new_appointment` (serie) | Citas nuevas en tu agenda | `{N} citas desde el {cuándo de la primera} · {pacientes}` | la de la primera | high |
| `unclosed` | Cita por cerrar | `{hora} · {servicio} · {pacientes}{con}: márcala Completada o No asistió` | la de la cita | normal |
| `evening_summary` | Tienes {N} citas de hoy sin cerrar (con una: «Tienes 1 cita de hoy sin cerrar») | Márcalas Completada o No asistió para que la agenda y los reportes cuadren. | `/dashboard/calendar?date={hoy}` | normal |
| `new_business` | Negocio nuevo | `{negocio} · {categoría}` | `/admin/businesses/{id}` | normal |
| `plan_request` | Solicitud de cambio de plan | `{negocio} · de {plan actual} a {plan pedido}` | `/admin/businesses/{id}` | normal |
| `account_security` | Cambio de seguridad en una cuenta de super admin | `{cuenta a medias} · {qué cambió}` (los textos de `account-alerts.ts`) | `/admin/activity?ver=seguridad` | high |
| `login_attack` | Posibles intentos de adivinar contraseñas | `{cuenta a medias}: {N} intentos fallidos en la última hora`, más « y {M} cuentas más» | `/admin/activity?ver=seguridad` | high |
| `test` (propietario) | Avisos activados | Listo: aquí te avisaremos de las reservas. | `/dashboard` | high |
| `test` (super admin) | Avisos activados | Listo: aquí te avisaremos de lo importante de la plataforma. | `/admin` | high |

**`tag` de cada aviso:**
- `reserva-{id}`, `comprobante-{id}`, `cancelada-{id}`, `cita-nueva-{id}` y `por-cerrar-{id}`;
- `resumen-{fecha}`, `negocio-{id}` y `plan-{id}`;
- `cuenta-{registro}`, `intentos-{hora}` y `prueba`.

Cada aviso tiene el suyo, así que no se agrupan.

## Envío al servicio de avisos (RFC 8030, 8291 y 8292)

```
POST {endpoint}
TTL: {segundos hasta las 24 h desde que se puso en cola}
Urgency: high | normal
Content-Type: application/octet-stream
Content-Encoding: aes128gcm
Authorization: vapid t={JWT ES256 con aud = origen del endpoint, exp = ahora + 12 h, sub = VAPID_SUBJECT}, k={VAPID_PUBLIC_KEY}

{sal 16 bytes}{4096 en 4 bytes}{65}{clave efímera 65 bytes}{JSON cifrado + etiqueta}
```

**El JSON, antes de cifrar** (menos de 1 KB):

```json
{ "title": "Nueva reserva", "body": "Mañana 16:00 · Limpieza · Juan P.", "url": "/dashboard/calendar?date=2026-10-15&appointment=…", "tag": "reserva-…", "kind": "booking" }
```

**Respuestas:** ver la tabla de R6 en [research.md](../research.md):
- 201: enviado;
- 404 o 410: el aparato se borra;
- 429, 5xx o sin red: se reintenta;
- otros 4xx: rechazado.

## Service worker (`src/sw.ts`)

| Evento | Qué hace |
|---|---|
| `push` | Muestra el aviso con `title`, `body`, `icon: /icon-app-192.png`, `badge: /icon-badge-96.png`, `tag` y `data.url`. Si no puede leer el contenido, muestra «Agenda360» · «Tienes un aviso nuevo». |
| `notificationclick` | Abre `data.url` sólo si es una ruta propia que empieza por `/dashboard` o `/admin`; si no, `/dashboard`. Si hay una ventana abierta, la enfoca y le manda `{ type: "agenda360:abrir", url }`; si no, `clients.openWindow`. |
| `pushsubscriptionchange` | Se vuelve a suscribir con la misma clave y llama a `PUT /api/push/device` con `previousEndpoint`, con la cookie y `X-Requested-With: fetch`. |

**Front que escucha el mensaje:** `src/features/push/notification-navigation.ts`, cargado en
`main.tsx`. Navega con `router.navigate(url)` si la ruta pasa `safeNextPath`.

## Inicio de sesión con destino

- `/login?next=/dashboard/calendar?date=…&appointment=…`: al entrar, va a `next` si es una ruta propia
  de su panel (`safeNextPath`), y si no, al Inicio.
- Lo usan `dashboard-layout.tsx` y `admin-layout.tsx` cuando no hay sesión.

## Cron (`scripts/cron.ts`)

- **La línea del registro suma:**

  ```
  · avisos en la app: enviados N · fallidos N · aparatos dados de baja N
  ```

- **ntfy:** si en la pasada fallaron avisos y no salió ninguno, ntfy avisa así:

  | Campo | Valor |
  |---|---|
  | Título | «Agenda360: los avisos en la app no salen» |
  | Mensaje | «Fallaron N avisos en esta pasada (servicio: fcm.googleapis.com, 403). Revisa las claves VAPID en Vercel, Lambda y GitHub.» |
  | Prioridad | 4 |
  | Enlace | `/admin/activity` |

- **Los avisos de ntfy de hoy no cambian.**

## Configuración

Ver la tabla de [data-model.md](../data-model.md). Si las claves faltan o no son válidas, la API
arranca igual y el registro dice, sin valores:

```
Avisos en el celular desactivados: falta VAPID_PRIVATE_KEY.
```
