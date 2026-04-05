-- One-time QR login handoff from web (operator session) to point terminal.
-- Access only via service role in API routes.

create table if not exists public.point_qr_login_challenges (
  id uuid primary key default gen_random_uuid(),
  point_project_id uuid not null references public.point_projects (id) on delete cascade,
  nonce text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'consumed', 'expired')),
  result jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_user_id uuid
);

create unique index if not exists idx_point_qr_login_challenges_nonce on public.point_qr_login_challenges (nonce);
create index if not exists idx_point_qr_login_challenges_project_status
  on public.point_qr_login_challenges (point_project_id, status);

alter table public.point_qr_login_challenges enable row level security;
