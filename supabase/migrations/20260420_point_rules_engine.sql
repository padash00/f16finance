create table if not exists public.point_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  scope text not null default 'salary',
  event text not null,
  name text not null,
  description text null,
  priority integer not null default 100,
  is_active boolean not null default true,
  stop_processing boolean not null default false,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null
);

create index if not exists idx_point_rules_scope_event_priority
  on public.point_rules(scope, event, is_active, priority);

create index if not exists idx_point_rules_company
  on public.point_rules(company_id);

create or replace function public.point_rules_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_point_rules_set_updated_at on public.point_rules;
create trigger trg_point_rules_set_updated_at
before update on public.point_rules
for each row execute function public.point_rules_set_updated_at();
