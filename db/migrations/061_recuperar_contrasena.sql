-- Recuperar la contraseña con una contraseña temporal (spec 054, pedido del dueño el 2026-11-20).

-- «¿Olvidaste tu contraseña?»: la contraseña temporal que llega por email. Es aparte de la de siempre, que sigue
-- funcionando hasta que se use ésta. Sólo su huella (bcrypt), sirve una vez y vence en 1 hora; sólo vale la última
-- pedida (la API borra las anteriores sin usar).
create table temporary_passwords (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  password_hash text not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index temporary_passwords_user_idx on temporary_passwords (user_id);

-- Como el resto: la API REST de Supabase (clave anónima) no puede leerla.
alter table temporary_passwords enable row level security;

-- La contraseña la puso el soporte (al cambiarla o en un alta): al entrar con ella, hay que crear la propia. Las
-- cuentas que ya existen quedan en false: nadie tiene que cambiar su contraseña al publicar esto.
alter table users add column password_change_required boolean not null default false;

-- La sesión se abrió con una contraseña temporal: sólo puede crear la contraseña nueva (403 password_change_required en
-- el resto). En el paso del código de la verificación en dos pasos, la marca espera en login_challenges.
alter table sessions add column password_change_required boolean not null default false;
alter table login_challenges add column password_change_required boolean not null default false;
