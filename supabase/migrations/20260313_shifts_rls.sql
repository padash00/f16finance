create or replace function public.can_manage_shifts()
returns boolean
language sql
stable
as $$
  select
    coalesce(lower(auth.jwt() ->> 'email'), '') in (
      'padash00@gmail.com'
    )
    or exists (
      select 1
      from public.staff s
      where lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

grant execute on function public.can_manage_shifts() to authenticated;

alter table if exists public.shifts enable row level security;

drop policy if exists "shifts_select_admin_staff" on public.shifts;
drop policy if exists "shifts_insert_admin_staff" on public.shifts;
drop policy if exists "shifts_update_admin_staff" on public.shifts;
drop policy if exists "shifts_delete_admin_staff" on public.shifts;

create policy "shifts_select_admin_staff"
on public.shifts
for select
to authenticated
using (public.can_manage_shifts());

create policy "shifts_insert_admin_staff"
on public.shifts
for insert
to authenticated
with check (public.can_manage_shifts());

create policy "shifts_update_admin_staff"
on public.shifts
for update
to authenticated
using (public.can_manage_shifts())
with check (public.can_manage_shifts());

create policy "shifts_delete_admin_staff"
on public.shifts
for delete
to authenticated
using (public.can_manage_shifts());
