-- Solicitudes de cambio de plan: el propietario la pide y el super admin la aprueba o rechaza.
create table plan_change_requests (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses (id) on delete cascade,
  current_plan      text not null check (current_plan in ('free', 'pro', 'business')),
  requested_plan    text not null check (requested_plan in ('free', 'pro', 'business')),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      uuid references users (id) on delete set null,
  requested_by_name text not null,
  rejection_reason  text not null default '',
  resolved_by_name  text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);
-- Como mucho una solicitud pendiente por negocio.
create unique index plan_change_requests_one_pending on plan_change_requests (business_id) where status = 'pending';
create index plan_change_requests_status_idx on plan_change_requests (status, created_at desc);

alter table plan_change_requests enable row level security;
