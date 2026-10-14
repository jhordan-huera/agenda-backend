# Contratos: Endurecimiento de seguridad

Lo que cambia en la API, en las cabeceras del proxy, en los emails y en los avisos. Lo que no está
aquí sigue igual.

## Rutas nuevas

### `POST /api/businesses/:businessId/clients/:clientId/confirm-claim`

Une un paciente «por verificar» a la ficha que reclamó (R5).

**Cuerpo:**

```json
{ "updateEmail": true, "updatePhone": false }
```

- Los dos campos son opcionales y valen `false` por defecto.
- Con `true`, se copia a la ficha el email o el teléfono del paciente aparte.

**Respuesta 200:** el `Client` de la ficha, ya actualizado.

**Errores:**

| Código | Cuándo |
|---|---|
| 404 `not_found` | El paciente no es del negocio o no está al alcance de quien lo pide. |
| 403 `forbidden` | Rol Profesional: «Pide a recepción o al propietario que la revise». O sin permiso `clients.manage`. |
| 409 `conflict` | El paciente no está por verificar, o la ficha reclamada ya no existe. |
| 409 `conflict` | El paciente aparte ya tiene historia clínica. |

## Rutas que cambian

### `POST /api/public/businesses/:slug/bookings`

Ya no responde 403 «No pudimos confirmar tus datos» ni «No pudimos confirmar los datos de …». Con la
cédula de un paciente y otro email y otro teléfono responde lo mismo que con una cédula nueva:
- 200 con `BookingConfirmation`;
- o los mismos 409, 429 y 402 de los topes.

El 403 sólo queda para el CAPTCHA.

### `GET /api/businesses/:id/clients` y `GET /api/businesses/:id/clients/:clientId`

- Cada paciente gana `claimedClientId: string | null`.

### `GET /api/businesses/:id/professionals`

- Al rol Profesional, en las agendas que no son la suya, le llegan en blanco tres campos:
  - `email: ""`;
  - `meetingUrl: ""`;
  - `bankAccounts: []`.
- Su agenda llega entera, y a los demás roles todo les llega como hoy.

### `GET /api/businesses/:id/notifications`

- Sin los emails dirigidos al equipo de la plataforma (`plan_change_requested`).

### `GET /api/users/:userId`

- Un super admin sin la verificación activada que pide a otro usuario recibe 403
  `two_factor_required`.

### Inicio de sesión y comprobaciones de contraseña

Son estas rutas:
- `POST /api/auth/login` y `POST /api/auth/login/two-factor`;
- `POST /api/auth/change-password`;
- `POST /api/auth/two-factor/disable` y `POST /api/auth/two-factor/recovery-codes`;
- `PUT /api/users/:userId`, cuando cambia el email.

Todas siguen así:
- **Al pasar el tope:** 429 `rate_limited` «Demasiados intentos fallidos…», sin comprobar nada.
- **Topes:** los de hoy, exactos también con peticiones simultáneas (R1).
- **Los fallos con la sesión abierta:** quedan como `session.login_failed`.
- **Cambiar la contraseña:** registra `session.password_changed` y pone en cola
  `account_security_changed`.
- **Activar o desactivar la verificación** también pone en cola `account_security_changed`.

## Cookie de sesión

- **`Secure`:** siempre en la nube.
- **Caducidad:** los topes de la tabla de [data-model.md](./data-model.md).
- **`/api/public/*`:** nunca responde con `Set-Cookie`. El front pide esas rutas con
  `credentials: "omit"`.

## Cabeceras del proxy del front a la API

| Cabecera | Valor |
|---|---|
| `x-agendo-client-ip` | La IP del visitante. |
| `x-agendo-client-ts` | La hora en segundos (Unix). |
| `x-agendo-client-sig` | HMAC-SHA256, en hex, de `<ip>.<ts>` con `PROXY_SECRET`. |
| `x-agendo-proxy-secret` | **Sólo en la fase 1.** El secreto de hoy, para que el orden de publicación no importe (R8). |

**Cómo los usa la API:**
- **La IP del visitante:** la acepta si la firma es válida y `ts` está a ±120 s, o, sólo en la fase
  1, si llega el secreto de hoy. Si no, usa la IP de la conexión.
- **La guarda de Lambda:** acepta lo mismo.

Las cabeceras `x-agendo-*` que llegan del navegador se borran en el proxy, como hoy.

## Emails

### `account_security_changed` (nuevo)

Plantilla `accountSecurityChanged`, compartida.

| Campo | Contenido |
|---|---|
| Asunto | «Agenda360: cambio de seguridad en la cuenta de {nombre}» |
| Datos | La cuenta, qué cambió, cuándo (hora de Ecuador), la IP y el navegador. |
| Cierre | «Si no fuiste tú, cambia la contraseña y avisa al super admin principal.» |

**Qué cambió** es uno de estos tres:
- «Activó la verificación en dos pasos»;
- «Desactivó la verificación en dos pasos»;
- «Cambió su contraseña».

**A quién va:** a la cuenta afectada y al super admin principal, en un solo email si son la misma
persona.

### `booking_received` (al negocio)

- Si la reserva quedó por verificar, añade un aviso: «La cédula es de un paciente del negocio, pero
  el email y el teléfono no coinciden con su ficha. Revísala en la agenda.»

## Avisos por ntfy (cron)

- **Nuevo:**
  - **Título:** «Agenda360: cambio en una cuenta de super admin».
  - **Mensaje, una línea por dato:**
    - la cuenta a medias (`ma***@gmail.com`);
    - qué cambió;
    - cuándo;
    - quién lo hizo, si fue otra persona;
    - «Si no fuiste tú, revisa la cuenta en /admin».
  - **Prioridad:** 4.
  - **Tope:** 10 por pasada, más la cifra del resto.
- **Reserva online:** a la persona por verificar se le añade «· Por verificar (la cédula es de un
  paciente con otros datos)».
- **Teléfono a medias, en todos los avisos:** «***5555».
- **Registro del cron:** suma «cambios de cuenta: N».

## Configuración

Ver la tabla de [data-model.md](./data-model.md). En la nube, si falta algo de la lista, el proceso
termina con este mensaje, sin valores:

```
Configuración insegura para la nube: falta TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY, TWO_FACTOR_KEY
```
