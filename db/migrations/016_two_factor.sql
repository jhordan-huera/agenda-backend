-- =============================================================================
-- Verificación en dos pasos (TOTP: Google Authenticator, Microsoft Authenticator…)
-- =============================================================================
-- Por ahora sólo la activa el super admin, desde su configuración. Con ella activada, después
-- de la contraseña se pide el código de 6 dígitos de la app (o un código de recuperación).
-- - two_factor_secret: clave compartida con la app (base32). null = desactivada.
-- - two_factor_pending_secret: clave recién generada, a la espera de confirmar con un código.
-- - two_factor_last_step: último intervalo de 30 s usado: un código no sirve dos veces.
-- - two_factor_recovery_codes: hash SHA-256 de los códigos de recuperación sin usar.
alter table users
  add column two_factor_secret         text,
  add column two_factor_pending_secret text,
  add column two_factor_enabled_at     timestamptz,
  add column two_factor_last_step      bigint,
  add column two_factor_recovery_codes text[] not null default '{}';

-- Paso intermedio del inicio de sesión: la contraseña ya es correcta y falta el código. El
-- navegador guarda el token (sólo su hash aquí) unos minutos y con pocos intentos.
create table login_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  remember   boolean not null default false,
  attempts   integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index login_challenges_user_idx on login_challenges (user_id);

-- Como el resto: la API REST de Supabase (clave anónima) no puede leerla.
alter table login_challenges enable row level security;
