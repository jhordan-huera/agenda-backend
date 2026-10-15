# Modelo de datos: Avisos en el celular desde la app instalada

## Migración 040 (`db/migrations/040_push_notifications.sql`)

Es una sola migración: dos tablas nuevas. No cambia ninguna tabla que ya exista. El dueño la aplica
antes de publicar el backend.

```sql
-- Avisos en el celular (spec 013): los aparatos con avisos y la cola de envío.

-- 1. Cada navegador de un aparato que activó los avisos (Web Push). Es del usuario: el negocio se
--    deduce al enviar (businesses.owner_id), así que cambiar el propietario deja de avisar al
--    anterior. La dirección y las claves sólo sirven con la firma VAPID de Agenda360, que vive en las
--    variables de entorno: no hace falta cifrarlas.
create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  -- Desde qué sesión se activó: al cerrarla (signOut) el aparato se pausa hasta volver a entrar.
  session_id    uuid references sessions (id) on delete set null,
  endpoint      text not null unique check (length(endpoint) <= 2048),
  p256dh        text not null,
  auth          text not null,
  -- Los tipos que NO quiere: los que se añadan en el futuro llegan encendidos.
  muted_kinds   text[] not null default '{}',
  signed_out_at timestamptz,
  -- Rechazos seguidos del servicio de avisos (400, 401, 403, 413): con 5 se borra.
  failures      integer not null default 0 check (failures >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);
create index push_subscriptions_session_idx on push_subscriptions (session_id) where session_id is not null;
alter table push_subscriptions enable row level security;

-- 2. La cola: un aviso por aparato, puesto en la misma transacción que lo provoca (como los emails en
--    notifications). Lo envía la API al momento y, si no pudo, el cron. Caduca a las 24 h.
create table push_messages (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references push_subscriptions (id) on delete cascade,
  business_id     uuid references businesses (id) on delete cascade,   -- null: avisos del super admin
  kind            text not null,
  title           text not null,
  body            text not null,
  url             text not null check (url like '/%'),
  tag             text not null,
  urgency         text not null default 'normal' check (urgency in ('normal', 'high')),
  -- Avisos que salen una sola vez (citas por cerrar, resumen de las 8, los del super admin del cron).
  dedupe_key      text,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create unique index push_messages_dedupe_idx on push_messages (subscription_id, dedupe_key)
  where dedupe_key is not null;
create index push_messages_queue_idx on push_messages (next_attempt_at) where status = 'queued';
create index push_messages_created_idx on push_messages (created_at);
alter table push_messages enable row level security;
```

- **Protección de filas en las dos tablas:** como las demás desde la spec 009, para que la API REST
  automática de Supabase no las pueda leer.
- **`on delete cascade` desde `users`:** borrar un usuario borra sus aparatos y, con ellos, sus
  avisos pendientes.
- **`on delete set null` desde `sessions`:** una sesión que caduca no pausa el aparato; sólo cerrar
  sesión lo pausa (R3).
- **`url like '/%'`:** un aviso sólo puede abrir una ruta del propio sitio. El service worker lo
  vuelve a comprobar (R16).
- **Sin datos de pacientes completos:** `title` y `body` llevan el paciente a medias («Juan P.»).
  Los avisos se borran a los 7 días.

## Entidades

### Aparato con avisos (`push_subscriptions`, tipo `PushDevice`)

Es la «entidad clave» de la spec: de qué usuario es, el permiso del navegador (la dirección y las
claves), cuándo se activó y qué tipos quiere.

**Lo que ve el front de su propio aparato:**

```ts
interface PushDevice {
  mutedKinds: PushKind[];
  createdAt: string;
}
```

**La dirección y las claves nunca salen de la API.** El front ya las tiene: son las de su navegador.

**Ciclo de vida:**

```text
«Activar» (permiso del navegador)             ──► activo, todos los tipos encendidos
   │  un interruptor                           ──► activo, con ese tipo apagado (muted_kinds)
   │  cerrar sesión en ese aparato              ──► pausado (signed_out_at)
   │       └─ volver a entrar                   ──► activo otra vez, con sus tipos (o los de fábrica si entra otra persona)
   │  «Desactivar en este celular»              ──► se borra
   │  el servicio responde 404 o 410             ──► se borra (desinstaló la app o borró los datos)
   │  5 rechazos seguidos (400, 401, 403, 413)   ──► se borra (por ejemplo, cambiaron las claves)
   └─ pausado más de 90 días                     ──► se borra (limpieza del cron)
```

**Reglas:**
- **La dirección es única:** activar en un navegador que ya estaba registrado lo actualiza. Si era de
  otra persona, pasa a quien activa, con los tipos de fábrica.
- **Hasta 10 aparatos por usuario:** al activar el undécimo, se borra el más antiguo.
- **Sólo pueden tener aparatos:**
  - el propietario de un negocio activo (`businesses.owner_id`);
  - un super admin con la verificación en dos pasos activada.

  Para los demás, las rutas responden 403.

### Aviso pendiente o enviado (`push_messages`)

- **Uno por aparato,** con el texto ya armado y a medias ([contracts/api.md](./contracts/api.md)).
- **Estados:** `queued` (en cola o reintentándose), `sent` o `failed` (rechazado, caducado o
  descartado).
- **`dedupe_key`:** única por aparato. Estas son las claves:

  | Aviso | Clave |
  |---|---|
  | Cita por cerrar | `por-cerrar:<cita>:<fecha>T<fin>` |
  | Resumen de las 8 | `resumen:<negocio>:<fecha>` |
  | Cambio de seguridad de una cuenta | `cuenta:<id del registro de actividad>` |
  | Intentos fallidos | `intentos:<cuenta a medias>:<YYYY-MM-DDTHH>` (como mucho uno por cuenta y hora) |
  | Los demás (al momento) | Sin clave: cada evento ocurre una vez en su transacción |

- **Reintentos:** a los 1, 5, 15 y 60 minutos, hasta `expires_at` (24 h).
- **Se borran a los 7 días,** con cualquier estado (limpieza del cron).

### Tipos de aviso (`PushKind`, compartido)

```ts
type PushKind =
  | "booking" | "receipt" | "patient_cancel" | "new_appointment" | "unclosed" | "evening_summary"
  | "new_business" | "plan_request" | "account_security" | "login_attack"
  | "test";
```

En `src/lib/constants/push.ts` (front, copiado al backend):
- **`OWNER_PUSH_KINDS`:** los seis primeros.
- **`PLATFORM_PUSH_KINDS`:** los cuatro del super admin.
- **`PUSH_KIND_LABELS`:** etiqueta y descripción de cada uno, para la tarjeta.
- **`UNCLOSED_AFTER_MINUTES`:** 30.
- **`EVENING_SUMMARY_HOUR`:** 20.
- **`PUSH_SNOOZE_DAYS`:** 7.

`test` nunca se puede apagar.

### Lo que no cambia

- **`appointments`:** sin columnas nuevas. «Ya avisada» sale de la ventana del cron y de la clave del
  aviso (R12), no de una marca en la cita.
- **`notifications` (emails):** igual. Los avisos en el celular se suman a los emails, que no cambian
  (supuesto de la spec).
- **`cron_runs.report`:** gana el bloque `push` (cifras), sin migración porque es jsonb.

## Configuración nueva

| Variable | Dónde | Qué |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Backend en Vercel y Lambda, secretos de GitHub (cron) | Clave pública del servicio de avisos, base64url de 87 caracteres. |
| `VAPID_PRIVATE_KEY` | Los mismos sitios | Clave privada, base64url de 43 caracteres. **Secreta.** |
| `VAPID_SUBJECT` | Opcional, en los mismos sitios | El contacto que piden los servicios de avisos (`mailto:` o `https:`). Por defecto, `APP_URL` si es `https`, y si no, `mailto:` + `GMAIL_USER`. |

- **Se crean con `npm run push:keys`.**
- **Si faltan o no son válidas,** no hay avisos y todo lo demás sigue igual:
  - `/api/health` dice `"push": false`;
  - **no se suman a lo que impide arrancar en la nube** (R2).
- **En el front no hay variables nuevas:** la clave pública llega de `GET /api/push/config`.
- **`dev:local`** crea un par de desarrollo en `.local-db/vapid.json` (fuera de git), y las pruebas
  el suyo.
