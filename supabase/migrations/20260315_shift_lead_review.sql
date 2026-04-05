alter table public.shift_change_requests
add column if not exists lead_status text null,
add column if not exists lead_action text null,
add column if not exists lead_note text null,
add column if not exists lead_operator_id uuid null references public.operators (id) on delete set null,
add column if not exists lead_replacement_operator_id uuid null references public.operators (id) on delete set null,
add column if not exists lead_updated_at timestamp with time zone null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shift_change_requests_lead_status_check'
  ) then
    alter table public.shift_change_requests
    add constraint shift_change_requests_lead_status_check
    check (lead_status is null or lead_status in ('proposed', 'reviewed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shift_change_requests_lead_action_check'
  ) then
    alter table public.shift_change_requests
    add constraint shift_change_requests_lead_action_check
    check (lead_action is null or lead_action in ('keep', 'remove', 'replace'));
  end if;
end $$;

create index if not exists idx_shift_change_requests_lead_status
  on public.shift_change_requests using btree (lead_status);

create index if not exists idx_shift_change_requests_lead_operator_id
  on public.shift_change_requests using btree (lead_operator_id);

create index if not exists idx_shift_change_requests_lead_replacement_operator_id
  on public.shift_change_requests using btree (lead_replacement_operator_id);
