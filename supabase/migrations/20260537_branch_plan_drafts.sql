-- Финансовая модель открытия новой точки: CAPEX + зоны/тарифы + OPEX →
-- выручка, прибыль, окупаемость. Каждый черновик — один документ в jsonb,
-- структуру держим в коде (часто меняется на этапе доработок).

create table if not exists public.branch_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists branch_plan_drafts_org_updated_idx
  on public.branch_plan_drafts (organization_id, updated_at desc);

alter table public.branch_plan_drafts enable row level security;
drop policy if exists branch_plan_drafts_select_same_org on public.branch_plan_drafts;
create policy branch_plan_drafts_select_same_org
on public.branch_plan_drafts
for select
to authenticated
using (public.can_access_organization(organization_id));

notify pgrst, 'reload schema';
