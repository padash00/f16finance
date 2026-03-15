create table if not exists public.operator_company_assignments (
  id uuid not null default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role_in_company text not null default 'operator',
  is_primary boolean not null default false,
  is_active boolean not null default true,
  notes text null,
  assigned_by uuid null references auth.users(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint operator_company_assignments_pkey primary key (id),
  constraint operator_company_assignments_operator_company_key unique (operator_id, company_id),
  constraint operator_company_assignments_role_check check (
    role_in_company in ('operator', 'senior_operator', 'senior_cashier')
  )
);

create index if not exists idx_operator_company_assignments_operator_id
  on public.operator_company_assignments using btree (operator_id);

create index if not exists idx_operator_company_assignments_company_id
  on public.operator_company_assignments using btree (company_id);

create unique index if not exists idx_operator_company_assignments_primary_active
  on public.operator_company_assignments using btree (operator_id)
  where (is_primary = true and is_active = true);

create or replace function public.validate_operator_company_assignments()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if new.is_active then
    select count(*)
      into active_count
      from public.operator_company_assignments
     where operator_id = new.operator_id
       and is_active = true
       and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if active_count >= 2 then
      raise exception 'Оператор может быть назначен максимум на 2 активные компании';
    end if;
  end if;

  if new.is_primary and not new.is_active then
    raise exception 'Основная компания должна быть активной';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_operator_company_assignments on public.operator_company_assignments;

create trigger validate_operator_company_assignments
before insert or update on public.operator_company_assignments
for each row
execute function public.validate_operator_company_assignments();

drop trigger if exists update_operator_company_assignments_updated_at on public.operator_company_assignments;

create trigger update_operator_company_assignments_updated_at
before update on public.operator_company_assignments
for each row
execute function update_updated_at_column();

create or replace function public.can_manage_operator_structure()
returns boolean
language sql
stable
as $$
  select
    coalesce(lower(auth.jwt() ->> 'email'), '') = 'padash00@gmail.com'
    or exists (
      select 1
      from public.staff s
      where lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and s.role in ('owner', 'manager')
    );
$$;

grant execute on function public.can_manage_operator_structure() to authenticated;

alter table public.operator_company_assignments enable row level security;

drop policy if exists "operator_company_assignments_select" on public.operator_company_assignments;
drop policy if exists "operator_company_assignments_insert" on public.operator_company_assignments;
drop policy if exists "operator_company_assignments_update" on public.operator_company_assignments;
drop policy if exists "operator_company_assignments_delete" on public.operator_company_assignments;

create policy "operator_company_assignments_select"
on public.operator_company_assignments
for select
to authenticated
using (public.can_manage_operator_structure());

create policy "operator_company_assignments_insert"
on public.operator_company_assignments
for insert
to authenticated
with check (public.can_manage_operator_structure());

create policy "operator_company_assignments_update"
on public.operator_company_assignments
for update
to authenticated
using (public.can_manage_operator_structure())
with check (public.can_manage_operator_structure());

create policy "operator_company_assignments_delete"
on public.operator_company_assignments
for delete
to authenticated
using (public.can_manage_operator_structure());
