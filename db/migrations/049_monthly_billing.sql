-- El cobro de las mensualidades por transferencia (spec 029): cada negocio tiene su mensualidad y su día
-- de pago; ese día se crea el cobro del mes, el propietario sube el comprobante (pasa a «En revisión»)
-- y el super admin lo marca pagado o lo rechaza con un motivo. Pasados 5 días de gracia sin
-- comprobante, el panel del propietario se queda en la pantalla de pago (lo decide la API al leer).

-- La mensualidad de cada negocio: la fija el super admin. 0 = sin cobros (plan gratis o cortesía).
-- billing_day: el día del mes en que paga (el que empezó su plan de pago; en los meses cortos, el
-- último día). billing_start: la fecha del primer cobro (null = todavía sin cobros).
alter table subscriptions
  add column monthly_fee numeric(10, 2) not null default 0 check (monthly_fee >= 0),
  add column billing_day smallint check (billing_day between 1 and 31),
  add column billing_start date,
  -- Con mensualidad, el día de pago y el primer cobro son obligatorios.
  add constraint subscriptions_billing_check check (monthly_fee = 0 or (billing_day is not null and billing_start is not null));

-- Las cuentas de la plataforma para recibir las mensualidades (hasta 3), como las de las agendas
-- (migración 030): {"bank", "accountType": "savings" | "checking", "number", "holder", "holderId"}.
-- Nunca van en la lectura pública de la configuración: sólo las leen el super admin y los propietarios.
alter table platform_settings add column bank_accounts jsonb not null default '[]'
  constraint platform_settings_bank_accounts_check check (
    case when jsonb_typeof(bank_accounts) = 'array'
         then jsonb_array_length(bank_accounts) <= 3
              and not jsonb_path_exists(bank_accounts, '$[*] ? (@.type() != "object")')
         else false
    end
  );

-- El cobro de cada mes. amount = base_amount − referral_discount (lo que se paga). referral_ids: las
-- recomendaciones (negocios recomendados) cuyo descuento usa este cobro; al pagarse quedan aplicadas
-- (businesses.referral_reward_applied_at) y ningún otro cobro abierto las vuelve a usar.
-- status: due (por pagar), in_review (con comprobante), paid, rejected (con motivo) o void (anulado).
-- rejection_reason: el motivo del último rechazo (se conserva si vuelve a subir el comprobante);
-- void_reason: el de la anulación; paid_note: la nota de «Pagado sin comprobante» (sólo la ve el super
-- admin). reviewed_by: quién lo marcó pagado, lo rechazó o lo anuló.
create table billing_charges (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses (id) on delete cascade,
  due_date          date not null,
  base_amount       numeric(10, 2) not null check (base_amount >= 0),
  referral_discount numeric(10, 2) not null default 0 check (referral_discount >= 0),
  amount            numeric(10, 2) not null check (amount >= 0),
  referral_ids      uuid[] not null default '{}',
  status            text not null default 'due' check (status in ('due', 'in_review', 'paid', 'rejected', 'void')),
  rejection_reason  text,
  void_reason       text,
  paid_note         text,
  paid_method       text check (paid_method in ('transfer', 'other')),
  paid_at           timestamptz,
  reviewed_by       uuid references users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, due_date)
);
-- La lista de /admin → Cobros (por estado) y el cobro pendiente del propietario.
create index billing_charges_status_idx on billing_charges (status, due_date);

-- Los comprobantes de cada cobro, como payment_receipts (migración 025): primero "pending" (el
-- navegador sube el archivo con una URL firmada) y "ready" cuando la API comprueba que llegó. El
-- archivo vive en el bucket privado de comprobantes, en <negocio>/mensualidades/<cobro>/<id>. El cron
-- borra los de más de 12 meses (el archivo y la fila); el cobro se queda como historial.
create table billing_receipts (
  id           uuid primary key default gen_random_uuid(),
  charge_id    uuid not null references billing_charges (id) on delete cascade,
  file_name    text not null,
  content_type text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  storage_path text not null unique,
  status       text not null default 'pending' check (status in ('pending', 'ready')),
  created_at   timestamptz not null default now()
);
create index billing_receipts_charge_idx on billing_receipts (charge_id);

-- Como el resto de tablas: sin acceso desde la API pública de Supabase (sólo la API de Agenda360).
alter table billing_charges enable row level security;
alter table billing_receipts enable row level security;

-- La campana de /admin (panel_notices, migraciones 041 y 045) acepta un tipo nuevo de la plataforma:
-- billing_receipt, un propietario subió el comprobante de su mensualidad, con su título, su texto y su
-- enlace ya armados (el negocio, el monto y el mes; nunca pacientes). Los dos check que nombran los tipos
-- ya tienen nombre desde la 045: se quitan y se vuelven a crear con el tipo nuevo.
alter table panel_notices
  drop constraint panel_notices_kind_check,
  drop constraint panel_notices_scope_check;

alter table panel_notices
  add constraint panel_notices_kind_check check (kind in (
    'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary',
    'new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt'));

-- Los ocho del negocio con negocio, los seis de la plataforma sin él (y con su texto).
alter table panel_notices
  add constraint panel_notices_scope_check check (
    (kind in ('booking', 'receipt', 'patient_confirm', 'patient_cancel', 'new_appointment', 'unclosed', 'evening_summary', 'morning_summary')
      and business_id is not null and title is null and body is null and url is null)
    or (kind in ('new_business', 'plan_request', 'account_security', 'login_attack', 'reminders_sent', 'billing_receipt')
      and business_id is null and title is not null and body is not null and url is not null)
  );
