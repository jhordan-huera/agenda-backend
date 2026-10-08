-- Pago por transferencia: datos bancarios de cada agenda, enlace de pago de cada cita y
-- comprobantes que suben los pacientes (el archivo vive en Supabase Storage; aquí, sus datos).

-- Cuenta a la que le transfieren los pacientes de esta agenda (null: no cobra por transferencia).
-- {"bank", "accountType": "savings" | "checking", "number", "holder", "holderId"}
alter table professionals add column bank_account jsonb
  check (bank_account is null or jsonb_typeof(bank_account) = 'object');

-- Enlace privado de pago (/pago/:token): datos para transferir y subida del comprobante, sin sesión.
alter table appointments add column payment_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index appointments_payment_token on appointments (payment_token);
-- Último comprobante recibido y cuándo el negocio la marcó como pagada.
alter table appointments add column receipt_at timestamptz;
alter table appointments add column paid_at timestamptz;

-- Comprobantes: primero "pending" (el navegador sube el archivo con una URL firmada) y "ready"
-- cuando la API comprueba que llegó. Se borran con la cita (y la API borra el archivo).
create table payment_receipts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses (id) on delete cascade,
  appointment_id uuid not null references appointments (id) on delete cascade,
  file_name      text not null,
  content_type   text not null,
  size_bytes     bigint not null check (size_bytes > 0),
  storage_path   text not null unique,
  status         text not null default 'pending' check (status in ('pending', 'ready')),
  created_at     timestamptz not null default now()
);
create index payment_receipts_appointment on payment_receipts (appointment_id, created_at);

alter table payment_receipts enable row level security;
