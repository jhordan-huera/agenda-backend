# Contratos: Centro de avisos en el panel

Lo que cambia en la API, lo que dice cada aviso de la campana y el mensaje del service worker. Lo que
no está aquí sigue igual. Decisiones en [research.md](../research.md).

## Rutas del negocio (`/api/businesses/:businessId/notices`)

- **Van en `business-routes.ts`,** después de la sesión y con la cabecera `X-Requested-With`, como el
  resto del panel.
- **Cualquier rol del equipo** (`authorize` sin permiso especial). Cada persona recibe lo suyo (R2).
- **El super admin en modo soporte** recibe 403 `forbidden`: «La campana es del equipo del negocio.»
  (R8).
- **Ninguna escribe en la actividad** (decisión 5).

### `GET …/notices/unread`

El contador. Lo pide el front al abrir el panel, al volver a la pestaña, cada 3 minutos con la pestaña
visible y al llegar un aviso al celular (R6). Sólo cuenta: no arma textos.

**Respuesta 200:**

```json
{ "unread": 3 }
```

### `GET …/notices?limit=20&cursor=…&unread=1`

La lista de la campana (`limit=20`) y la página «Avisos» (con `cursor` para «Cargar más»).

- `limit`: de 1 a 50; 20 por defecto.
- `unread=1`: sólo los no leídos.
- `cursor`: el `nextCursor` de la página anterior.

**Respuesta 200** (`PanelNoticePage`, ver [data-model.md](../data-model.md)):

```json
{
  "notices": [
    {
      "id": "…",
      "kind": "booking",
      "title": "Nueva reserva",
      "body": "Mañana 16:00 · Limpieza · Juan Pérez · con Dra. Valeria Cruz",
      "url": "/dashboard/calendar?date=2026-10-16&appointment=…",
      "createdAt": "2026-10-15T14:05:00.000Z",
      "read": false
    }
  ],
  "unread": 3,
  "nextCursor": "2026-10-15T09:12:00.000Z|…"
}
```

**400** `validation`: `limit` o `cursor` no válidos.

### `POST …/notices/:noticeId/read`

Marca uno como leído (al tocarlo). Repetirlo no cambia nada. **204.**

- **404:** el aviso no existe o esa persona no lo puede ver. Es la misma respuesta en los dos casos,
  para no revelar los avisos de otros.

### `POST …/notices/read-all`

«Marcar todo como leído». Todo lo creado hasta ahora cuenta como leído. **204.**

## Rutas del super admin (`/api/admin/notices`)

Las mismas cuatro rutas, con los avisos de la plataforma:
- `GET /api/admin/notices/unread`;
- `GET /api/admin/notices`;
- `POST /api/admin/notices/:noticeId/read`;
- `POST /api/admin/notices/read-all`.

Van en `platform-routes.ts` y piden ser super admin con la verificación en dos pasos
(`two_factor_required`), como el resto de /admin.

## Lo que dice cada aviso de la campana

Con los constructores compartidos (`describeNotice`, R3), igual que el celular pero con el **nombre
completo** del paciente. Las fechas se calculan al leer, en la zona del negocio: «Hoy 16:00»,
«Mañana 16:00» o «Mar 20 oct 16:00».

| Tipo | Título | Texto | Abre |
|---|---|---|---|
| `booking` | Nueva reserva | `{día} {hora} · {servicio} · {pacientes}[ · con {profesional}][ · Por verificar]` | La cita |
| `receipt` | Comprobante de pago | `{pacientes} · {día} {hora}` | La cita |
| `patient_confirm` | El paciente confirmó | `{día} {hora} · {quien confirmó}` | La cita |
| `patient_cancel` | Cita cancelada por el paciente | `{día} {hora} · {pacientes}` | La cita |
| `new_appointment` | Cita nueva en tu agenda | `{día} {hora} · {pacientes}` | La cita |
| `new_appointment` (serie) | Citas nuevas en tu agenda | `{n} citas desde {día} {hora} · {pacientes}` | La primera cita |
| `unclosed` | Cita por cerrar | `{hora} · {servicio} · {pacientes}[ · con {profesional}]: márcala Completada o No asistió` | La cita |
| `evening_summary` | Tienes {n} citas de hoy sin cerrar | Márcalas Completada o No asistió para que la agenda y los reportes cuadren. | La agenda de ese día |
| `new_business` | Negocio nuevo | `{negocio} · {categoría}` | `/admin/businesses/:id` |
| `plan_request` | Solicitud de cambio de plan | `{negocio} · de {plan} a {plan}` | `/admin/businesses/:id` |
| `account_security` | Cambio de seguridad en una cuenta de super admin | `{cuenta a medias} · {cambio}` | `/admin/activity?ver=seguridad` |
| `login_attack` | Posibles intentos de adivinar contraseñas | `{cuenta a medias}: {n} intentos fallidos…` | `/admin/activity?ver=seguridad` |

- **«con {profesional}»** sólo aparece si el negocio tiene más de una agenda activa, como en el
  celular.
- **Nunca** la cédula, el email, el teléfono ni las notas (CE-003).
- **Los del celular no cambian:** siguen a medias («Juan P.»).

## Rutas que cambian

No cambia ninguna respuesta. Lo que provocan los avisos (la reserva online, el comprobante, «Confirmo
que voy», la cancelación desde el email, la cita y la serie del panel, el alta del onboarding y la
solicitud de plan) **añade también el aviso de la campana**, en la misma transacción y en su propio
punto de guardado (R4).

## Service worker (`src/sw.ts`)

En `push`, después de mostrar el aviso, manda a las ventanas abiertas de la app:

```json
{ "type": "agenda360:aviso" }
```

El panel escucha `navigator.serviceWorker` `message` y vuelve a pedir el contador y, si está abierta,
la lista (R11).

## Cron (`scripts/cron.ts`)

- **Citas por cerrar y resumen de las 8:** ahora para todos los negocios activos (R5).
- **Los del super admin:** salen también en la campana.
- **Borrado:** se borran los avisos de más de 30 días.
- **El informe** (`cron_runs.report` y la línea del registro) suma `avisos del panel: N`.
