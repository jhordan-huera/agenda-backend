-- Centro de avisos del panel (spec 014): la campana del panel del negocio y la de /admin.
--
-- Un aviso por suceso (no uno por persona): quién lo ve se decide AL LEER, con el rol, la agenda y la
-- cita de hoy (src/services/panel-notices.ts y NOTICE_AUDIENCE en src/shared/lib/constants/notices.ts).
-- Los avisos de citas no guardan el texto: se arma al leer con los datos de hoy de la cita, así que al
-- borrar al paciente (y con él sus citas) desaparecen sus avisos y no queda su nombre en ningún sitio.

-- 1. Los avisos. business_id vacío: los del super admin (la plataforma), que sí guardan su texto.
create table panel_notices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references businesses (id) on delete cascade,
  kind            text not null check (kind in (
                    'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary',
                    'new_business', 'plan_request', 'account_security', 'login_attack')),
  -- La cita del aviso (la primera, en una serie).
  appointment_id  uuid references appointments (id) on delete cascade,
  -- Quién confirmó («Confirmo que voy»): en una sesión con varias personas, cada una avisa con su nombre.
  client_id       uuid references clients (id) on delete cascade,
  -- Sólo en el resumen de las 8 de una agenda; vacío en el del negocio entero.
  professional_id uuid references professionals (id) on delete cascade,
  -- Quien lo provocó no lo ve («Cita nueva en tu agenda» que agendó otra persona).
  actor_user_id   uuid references users (id) on delete set null,
  -- Lo que no sale de la cita: { "count": 8 } (serie), { "date": "2026-10-15", "count": 3 } (resumen)…
  data            jsonb not null default '{}',
  -- Sólo los de la plataforma: el texto ya armado (no tienen pacientes).
  title           text,
  body            text,
  url             text check (url like '/%'),
  -- Los del cron y la serie no se repiten si se reintenta la pasada.
  dedupe_key      text unique,
  created_at      timestamptz not null default now(),
  -- Los siete del negocio con negocio, los cuatro de la plataforma sin él (y con su texto).
  check (
    (kind in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary')
      and business_id is not null and title is null and body is null and url is null)
    or (kind in ('new_business', 'plan_request', 'account_security', 'login_attack')
      and business_id is null and title is not null and body is not null and url is not null)
  ),
  -- Los que hablan de una cita la llevan siempre.
  check (kind not in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed') or appointment_id is not null)
);
-- La campana del negocio (contador y lista), la de /admin y el borrado de los 30 días.
create index panel_notices_business_idx on panel_notices (business_id, created_at desc);
create index panel_notices_platform_idx on panel_notices (created_at desc) where business_id is null;
create index panel_notices_created_idx on panel_notices (created_at);
-- Al borrar una cita, un paciente o una agenda, la cascada busca sus avisos.
create index panel_notices_appointment_idx on panel_notices (appointment_id) where appointment_id is not null;
create index panel_notices_client_idx on panel_notices (client_id) where client_id is not null;
create index panel_notices_professional_idx on panel_notices (professional_id) where professional_id is not null;
alter table panel_notices enable row level security;

-- 2. Qué avisos leyó cada persona (cada una lleva el suyo). Leerlo otra vez no hace nada.
create table panel_notice_reads (
  user_id   uuid not null references users (id) on delete cascade,
  notice_id uuid not null references panel_notices (id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (user_id, notice_id)
);
create index panel_notice_reads_notice_idx on panel_notice_reads (notice_id);
alter table panel_notice_reads enable row level security;

-- 3. «Marcar todo como leído»: todo lo creado hasta esta hora cuenta como leído (una fila, no cientos).
create table panel_notice_state (
  user_id     uuid primary key references users (id) on delete cascade,
  read_all_at timestamptz not null
);
alter table panel_notice_state enable row level security;
