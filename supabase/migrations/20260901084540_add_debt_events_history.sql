create table if not exists public.debt_events (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid null,
  point_debt_item_id uuid null,
  entity_kind text not null,
  event_type text not null,
  company_id uuid null,
  organization_id uuid null,
  operator_id uuid null,
  client_name text null,
  occurred_at timestamptz not null default now(),
  business_date date null,
  week_start date null,
  source text null,
  actor_kind text not null default 'unknown',
  actor_user_id uuid null,
  actor_operator_id uuid null,
  actor_name text null,
  shift_id uuid null,
  point_device_id uuid null,
  delta_amount numeric null,
  amount_before numeric null,
  amount_after numeric null,
  status_before text null,
  status_after text null,
  local_ref text null,
  item_name text null,
  metadata jsonb not null default '{}'::jsonb,
  before_data jsonb null,
  after_data jsonb null,
  dedupe_key text null unique,
  constraint debt_events_entity_kind_check check (entity_kind in ('debt', 'point_debt_item'))
);

create index if not exists debt_events_occurred_at_idx on public.debt_events (occurred_at desc);
create index if not exists debt_events_debt_id_idx on public.debt_events (debt_id) where debt_id is not null;
create index if not exists debt_events_point_item_id_idx on public.debt_events (point_debt_item_id) where point_debt_item_id is not null;
create index if not exists debt_events_company_occurred_idx on public.debt_events (company_id, occurred_at desc) where company_id is not null;
create index if not exists debt_events_week_occurred_idx on public.debt_events (week_start, occurred_at desc) where week_start is not null;
create index if not exists debt_events_operator_occurred_idx on public.debt_events (operator_id, occurred_at desc) where operator_id is not null;

alter table public.debt_events enable row level security;

drop policy if exists debt_events_select_tenant on public.debt_events;
create policy debt_events_select_tenant on public.debt_events for select to authenticated
using (
  (company_id is not null and public.can_access_company(company_id))
  or (organization_id is not null and public.can_access_organization(organization_id))
);

revoke insert, update, delete, truncate on public.debt_events from anon, authenticated;
grant select on public.debt_events to authenticated;

create or replace function public.capture_debt_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_type text;
  v_actor_user_id uuid;
  v_actor_kind text := 'system';
  v_old jsonb;
  v_new jsonb;
begin
  begin
    v_actor_user_id := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    v_actor_user_id := null;
  end;
  if v_actor_user_id is not null then v_actor_kind := 'user'; end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into public.debt_events (
      debt_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name,
      occurred_at, business_date, week_start, source, actor_kind, actor_user_id,
      delta_amount, amount_before, amount_after, status_before, status_after, before_data, after_data
    ) values (
      new.id, 'debt', 'created', new.company_id, new.organization_id, new.operator_id, new.client_name,
      coalesce(new.created_at, now()), new.date, new.week_start, new.source,
      case when new.created_by is not null then 'user' else v_actor_kind end,
      coalesce(new.created_by, v_actor_user_id), new.amount, null, new.amount, null, new.status, null, v_new
    );
    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into public.debt_events (
      debt_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name,
      occurred_at, business_date, week_start, source, actor_kind, actor_user_id,
      delta_amount, amount_before, amount_after, status_before, status_after, before_data, after_data
    ) values (
      old.id, 'debt', 'deleted', old.company_id, old.organization_id, old.operator_id, old.client_name,
      now(), old.date, old.week_start, old.source, v_actor_kind, v_actor_user_id,
      -old.amount, old.amount, null, old.status, null, v_old, null
    );
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if new.settled_via is distinct from old.settled_via and new.settled_via = 'salary' then
    v_event_type := 'settled_via_salary';
  elsif new.status is distinct from old.status then
    v_event_type := 'status_changed';
  elsif new.amount is distinct from old.amount then
    v_event_type := 'amount_changed';
  elsif new.comment is distinct from old.comment then
    v_event_type := 'comment_changed';
  elsif new.operator_id is distinct from old.operator_id
     or new.client_name is distinct from old.client_name
     or new.company_id is distinct from old.company_id then
    v_event_type := 'reassigned';
  else
    v_event_type := 'updated';
  end if;

  insert into public.debt_events (
    debt_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name,
    occurred_at, business_date, week_start, source, actor_kind, actor_user_id,
    delta_amount, amount_before, amount_after, status_before, status_after,
    metadata, before_data, after_data
  ) values (
    new.id, 'debt', v_event_type, coalesce(new.company_id, old.company_id), coalesce(new.organization_id, old.organization_id),
    coalesce(new.operator_id, old.operator_id), coalesce(new.client_name, old.client_name), now(),
    coalesce(new.date, old.date), coalesce(new.week_start, old.week_start), coalesce(new.source, old.source),
    case when new.paid_by is distinct from old.paid_by and new.paid_by is not null then 'user' else v_actor_kind end,
    coalesce(case when new.paid_by is distinct from old.paid_by then new.paid_by else null end, v_actor_user_id),
    coalesce(new.amount, 0) - coalesce(old.amount, 0), old.amount, new.amount, old.status, new.status,
    jsonb_build_object('settled_via_before', old.settled_via, 'settled_via_after', new.settled_via), v_old, v_new
  );
  return new;
end;
$$;

revoke all on function public.capture_debt_event() from public, anon, authenticated;

create or replace function public.capture_point_debt_item_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_type text;
  v_actor_user_id uuid;
  v_actor_operator_id uuid;
  v_actor_kind text := 'system';
  v_old jsonb;
  v_new jsonb;
begin
  begin
    v_actor_user_id := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    v_actor_user_id := null;
  end;

  if tg_op = 'INSERT' then
    v_actor_operator_id := new.created_by_operator_id;
    if v_actor_operator_id is not null then
      v_actor_kind := 'operator';
    elsif v_actor_user_id is not null then
      v_actor_kind := 'user';
    end if;
    v_new := to_jsonb(new);
    insert into public.debt_events (
      point_debt_item_id, entity_kind, event_type, company_id, operator_id, client_name,
      occurred_at, week_start, source, actor_kind, actor_user_id, actor_operator_id,
      shift_id, point_device_id, delta_amount, amount_before, amount_after,
      status_before, status_after, local_ref, item_name, before_data, after_data
    ) values (
      new.id, 'point_debt_item', 'item_added', new.company_id, new.operator_id, new.client_name,
      new.created_at, new.week_start, new.source, v_actor_kind, v_actor_user_id, v_actor_operator_id,
      new.shift_id, new.point_device_id, new.total_amount, null, new.total_amount,
      null, new.status, new.local_ref, new.item_name, null, v_new
    );
    return new;
  elsif tg_op = 'DELETE' then
    if v_actor_user_id is not null then v_actor_kind := 'user'; end if;
    v_old := to_jsonb(old);
    insert into public.debt_events (
      point_debt_item_id, entity_kind, event_type, company_id, operator_id, client_name,
      occurred_at, week_start, source, actor_kind, actor_user_id,
      shift_id, point_device_id, delta_amount, amount_before, amount_after,
      status_before, status_after, local_ref, item_name, before_data, after_data
    ) values (
      old.id, 'point_debt_item', 'item_deleted', old.company_id, old.operator_id, old.client_name,
      now(), old.week_start, old.source, v_actor_kind, v_actor_user_id,
      old.shift_id, old.point_device_id, -old.total_amount, old.total_amount, null,
      old.status, null, old.local_ref, old.item_name, v_old, null
    );
    return old;
  end if;

  if v_actor_user_id is not null then v_actor_kind := 'user'; end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if new.status is distinct from old.status and new.status = 'deleted' then
    v_event_type := 'item_settled';
  elsif new.status is distinct from old.status then
    v_event_type := 'item_status_changed';
  elsif new.total_amount is distinct from old.total_amount
     or new.quantity is distinct from old.quantity
     or new.unit_price is distinct from old.unit_price
     or new.item_name is distinct from old.item_name then
    v_event_type := 'item_changed';
  elsif new.comment is distinct from old.comment then
    v_event_type := 'item_comment_changed';
  elsif new.operator_id is distinct from old.operator_id
     or new.client_name is distinct from old.client_name
     or new.company_id is distinct from old.company_id then
    v_event_type := 'item_reassigned';
  else
    v_event_type := 'item_updated';
  end if;

  insert into public.debt_events (
    point_debt_item_id, entity_kind, event_type, company_id, operator_id, client_name,
    occurred_at, week_start, source, actor_kind, actor_user_id,
    shift_id, point_device_id, delta_amount, amount_before, amount_after,
    status_before, status_after, local_ref, item_name, before_data, after_data
  ) values (
    new.id, 'point_debt_item', v_event_type, coalesce(new.company_id, old.company_id),
    coalesce(new.operator_id, old.operator_id), coalesce(new.client_name, old.client_name),
    coalesce(new.deleted_at, now()), coalesce(new.week_start, old.week_start), coalesce(new.source, old.source),
    v_actor_kind, v_actor_user_id, coalesce(new.shift_id, old.shift_id), coalesce(new.point_device_id, old.point_device_id),
    coalesce(new.total_amount, 0) - coalesce(old.total_amount, 0), old.total_amount, new.total_amount,
    old.status, new.status, coalesce(new.local_ref, old.local_ref), coalesce(new.item_name, old.item_name), v_old, v_new
  );
  return new;
end;
$$;

revoke all on function public.capture_point_debt_item_event() from public, anon, authenticated;

drop trigger if exists trg_debts_audit_history on public.debts;
create trigger trg_debts_audit_history after insert or update or delete on public.debts
for each row execute function public.capture_debt_event();

drop trigger if exists trg_point_debt_items_audit_history on public.point_debt_items;
create trigger trg_point_debt_items_audit_history after insert or update or delete on public.point_debt_items
for each row execute function public.capture_point_debt_item_event();

insert into public.debt_events (
  debt_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name,
  occurred_at, business_date, week_start, source, actor_kind, actor_user_id,
  delta_amount, amount_before, amount_after, status_before, status_after, before_data, after_data, dedupe_key
)
select d.id, 'debt', 'historical_created', d.company_id, d.organization_id, d.operator_id, d.client_name,
  coalesce(d.created_at, d.date::timestamptz), d.date, d.week_start, d.source,
  case when d.created_by is not null then 'user' else 'unknown' end, d.created_by,
  d.amount, null, d.amount, null, 'active', null, to_jsonb(d), 'debt:' || d.id::text || ':created'
from public.debts d
on conflict (dedupe_key) do nothing;

insert into public.debt_events (
  debt_id, entity_kind, event_type, company_id, organization_id, operator_id, client_name,
  occurred_at, business_date, week_start, source, actor_kind, actor_user_id,
  delta_amount, amount_before, amount_after, status_before, status_after,
  metadata, before_data, after_data, dedupe_key
)
select d.id, 'debt',
  case when d.settled_via = 'salary' then 'historical_settled_via_salary' else 'historical_paid' end,
  d.company_id, d.organization_id, d.operator_id, d.client_name,
  d.paid_at, d.date, d.week_start, d.source,
  case when d.paid_by is not null then 'user' else 'unknown' end, d.paid_by,
  0, d.amount, d.amount, 'active', d.status,
  jsonb_build_object('settled_via', d.settled_via), to_jsonb(d), to_jsonb(d),
  'debt:' || d.id::text || ':paid'
from public.debts d
where d.paid_at is not null
on conflict (dedupe_key) do nothing;

insert into public.debt_events (
  point_debt_item_id, entity_kind, event_type, company_id, operator_id, client_name,
  occurred_at, week_start, source, actor_kind, actor_operator_id,
  shift_id, point_device_id, delta_amount, amount_before, amount_after,
  status_before, status_after, local_ref, item_name, before_data, after_data, dedupe_key
)
select p.id, 'point_debt_item', 'historical_item_added', p.company_id, p.operator_id, p.client_name,
  p.created_at, p.week_start, p.source,
  case when p.created_by_operator_id is not null then 'operator' else 'unknown' end,
  p.created_by_operator_id, p.shift_id, p.point_device_id,
  p.total_amount, null, p.total_amount, null, 'active', p.local_ref, p.item_name,
  null, to_jsonb(p), 'point-item:' || p.id::text || ':created'
from public.point_debt_items p
on conflict (dedupe_key) do nothing;

insert into public.debt_events (
  point_debt_item_id, entity_kind, event_type, company_id, operator_id, client_name,
  occurred_at, week_start, source, actor_kind,
  shift_id, point_device_id, delta_amount, amount_before, amount_after,
  status_before, status_after, local_ref, item_name, before_data, after_data, dedupe_key
)
select p.id, 'point_debt_item', 'historical_item_settled', p.company_id, p.operator_id, p.client_name,
  p.deleted_at, p.week_start, p.source, 'unknown',
  p.shift_id, p.point_device_id, 0, p.total_amount, p.total_amount,
  'active', p.status, p.local_ref, p.item_name, to_jsonb(p), to_jsonb(p),
  'point-item:' || p.id::text || ':settled'
from public.point_debt_items p
where p.deleted_at is not null
on conflict (dedupe_key) do nothing;
