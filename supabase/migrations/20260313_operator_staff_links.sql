create table if not exists public.operator_staff_links (
  id uuid not null default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  assigned_role text not null,
  assigned_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  assigned_by uuid null references auth.users(id),
  constraint operator_staff_links_pkey primary key (id),
  constraint operator_staff_links_operator_id_key unique (operator_id),
  constraint operator_staff_links_staff_id_key unique (staff_id)
);

create index if not exists idx_operator_staff_links_operator_id
  on public.operator_staff_links using btree (operator_id);

create index if not exists idx_operator_staff_links_staff_id
  on public.operator_staff_links using btree (staff_id);

drop trigger if exists update_operator_staff_links_updated_at on public.operator_staff_links;
create trigger update_operator_staff_links_updated_at
before update on public.operator_staff_links
for each row
execute function update_updated_at_column();

create or replace function public.can_manage_operator_career()
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
        and s.role = 'owner'
    );
$$;

grant execute on function public.can_manage_operator_career() to authenticated;

alter table public.operator_staff_links enable row level security;

drop policy if exists "operator_staff_links_select" on public.operator_staff_links;
drop policy if exists "operator_staff_links_insert" on public.operator_staff_links;
drop policy if exists "operator_staff_links_update" on public.operator_staff_links;
drop policy if exists "operator_staff_links_delete" on public.operator_staff_links;

create policy "operator_staff_links_select"
on public.operator_staff_links
for select
to authenticated
using (
  public.can_manage_operator_career()
  or exists (
    select 1
    from public.operator_auth oa
    where oa.operator_id = operator_staff_links.operator_id
      and oa.user_id = auth.uid()
  )
);

create policy "operator_staff_links_insert"
on public.operator_staff_links
for insert
to authenticated
with check (public.can_manage_operator_career());

create policy "operator_staff_links_update"
on public.operator_staff_links
for update
to authenticated
using (public.can_manage_operator_career())
with check (public.can_manage_operator_career());

create policy "operator_staff_links_delete"
on public.operator_staff_links
for delete
to authenticated
using (public.can_manage_operator_career());
