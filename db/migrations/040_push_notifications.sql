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
