create table if not exists public.point_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  device_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  point_mode text not null default 'shift-report',
  feature_flags jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  notes text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_point_devices_company_id on public.point_devices(company_id);
create index if not exists idx_point_devices_active on public.point_devices(is_active);

create or replace function public.touch_point_devices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_point_devices_updated_at on public.point_devices;
create trigger trg_point_devices_updated_at
before update on public.point_devices
for each row
execute function public.touch_point_devices_updated_at();
