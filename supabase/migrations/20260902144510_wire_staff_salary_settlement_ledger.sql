-- Wire the settlement tables created in 20260901150734 into the legacy salary flow.
-- The ledger is the source of truth; legacy adjustments remain compatibility rows for /salary.

create unique index if not exists staff_salary_adj_alloc_adjustment_settlement_uidx
  on public.staff_salary_settlement_adjustment_allocations(adjustment_id, settlement_id)
  where adjustment_id is not null;
create unique index if not exists staff_salary_adj_alloc_point_item_settlement_uidx
  on public.staff_salary_settlement_adjustment_allocations(point_debt_item_id, settlement_id)
  where point_debt_item_id is not null;

create or replace function public.staff_salary_settlement_refresh_status(p_settlement_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_remaining integer; v_paid integer; v_adjustment integer;
begin
  select remaining_amount,paid_amount,balance_adjustment into v_remaining,v_paid,v_adjustment
  from public.staff_salary_settlements where id=p_settlement_id for update;
  if not found then return; end if;
  update public.staff_salary_settlements set
    status=case when greatest(coalesce(v_remaining,0),0)=0 then 'paid'
      when coalesce(v_paid,0)>0 or coalesce(v_adjustment,0)<>0 then 'partial' else 'unpaid' end,
    closed_at=case when greatest(coalesce(v_remaining,0),0)=0 then coalesce(closed_at,now()) else null end,
    updated_at=now()
  where id=p_settlement_id;
end $$;

create or replace function public.staff_salary_freeze_settlement(
  p_staff_id uuid,p_organization_id uuid,p_period_month date,p_slot text,p_scheduled_date date,
  p_opened_date date,p_period_start date,p_period_end date,p_base_amount integer,p_bonus_amount integer,
  p_debt_amount integer,p_fine_amount integer,p_advance_amount integer,p_net_due integer,
  p_snapshot jsonb default '{}'::jsonb,p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_is_provisional boolean; v_due integer:=greatest(coalesce(p_net_due,0),0);
begin
  v_id:=public.staff_salary_create_settlement(
    p_staff_id,p_organization_id,p_period_month,p_slot,p_scheduled_date,p_opened_date,p_period_start,p_period_end,
    p_base_amount,p_bonus_amount,p_debt_amount,p_fine_amount,p_advance_amount,v_due,null,
    coalesce(p_snapshot,'{}'::jsonb)||jsonb_build_object('provisional',false),p_created_by);
  select coalesce((snapshot->>'provisional')::boolean,false) into v_is_provisional
  from public.staff_salary_settlements where id=v_id for update;
  if v_is_provisional then
    update public.staff_salary_settlements set
      organization_id=coalesce(p_organization_id,organization_id),scheduled_date=p_scheduled_date,
      opened_date=least(opened_date,p_opened_date),period_start=p_period_start,period_end=p_period_end,
      base_amount=greatest(coalesce(p_base_amount,0),0),bonus_amount=greatest(coalesce(p_bonus_amount,0),0),
      debt_amount=greatest(coalesce(p_debt_amount,0),0),fine_amount=greatest(coalesce(p_fine_amount,0),0),
      advance_amount=greatest(coalesce(p_advance_amount,0),0),net_due=v_due,
      remaining_amount=greatest(v_due+balance_adjustment-paid_amount,0),
      snapshot=coalesce(snapshot,'{}'::jsonb)||coalesce(p_snapshot,'{}'::jsonb)||jsonb_build_object('provisional',false,'frozen_at',now()),
      updated_at=now() where id=v_id;
    perform public.staff_salary_settlement_refresh_status(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.staff_salary_sync_payment_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_month date; v_org uuid; v_settlement uuid; v_allocated integer:=0; v_excess integer:=0;
begin
  if new.slot not in ('first','second') or coalesce(new.amount,0)<=0 then return new; end if;
  v_month:=date_trunc('month',new.pay_date)::date;
  select organization_id into v_org from public.staff where id=new.staff_id;
  v_settlement:=public.staff_salary_create_settlement(
    new.staff_id,v_org,v_month,new.slot,
    case when new.slot='first' then v_month else (v_month+interval '14 days')::date end,
    new.pay_date,
    case when new.slot='first' then v_month else (v_month+interval '15 days')::date end,
    case when new.slot='first' then (v_month+interval '14 days')::date else (v_month+interval '1 month - 1 day')::date end,
    greatest(new.amount,0),0,0,0,0,greatest(new.amount,0),new.id,
    jsonb_build_object('source','payment_bridge','provisional',true,'payment_id',new.id,'payment_amount',greatest(new.amount,0),'payment_created_at',new.created_at),null);
  select allocated_amount,excess_amount into v_allocated,v_excess
  from public.staff_salary_allocate_payment(new.staff_id,new.id,greatest(new.amount,0),new.pay_date,null,
    jsonb_build_object('source','payment_insert_trigger','current_settlement_id',v_settlement));
  update public.staff_salary_settlements set source_payment_id=coalesce(source_payment_id,new.id),
    snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('payment_allocated',coalesce(v_allocated,0),'payment_excess',coalesce(v_excess,0)),
    updated_at=now() where id=v_settlement;
  return new;
end $$;

create or replace function public.staff_salary_apply_live_adjustment_row(p_adjustment_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.staff_adjustments%rowtype; v_applied integer:=0; v_unapplied integer:=0; v_comment text;
begin
  select * into v_row from public.staff_adjustments where id=p_adjustment_id for update;
  if v_row.id is null or v_row.staff_id is null or coalesce(v_row.status,'active')<>'active' then return; end if;
  if v_row.source_payment_id is not null or v_row.kind not in ('bonus','debt','fine','advance') or coalesce(v_row.amount,0)<=0 then return; end if;
  if exists(select 1 from public.staff_salary_settlement_adjustment_allocations where adjustment_id=v_row.id) then return; end if;
  select applied_amount,unapplied_amount into v_applied,v_unapplied
  from public.staff_salary_apply_adjustment(v_row.staff_id,v_row.kind,v_row.amount,v_row.id,null,v_row.date,null,jsonb_build_object('source','staff_adjustment_trigger'));
  if coalesce(v_applied,0)<=0 then return; end if;
  if coalesce(v_unapplied,0)<=0 then
    update public.staff_adjustments set status='paid',closed_at=coalesce(closed_at,now()) where id=v_row.id;
  else
    v_comment:=nullif(trim(coalesce(v_row.comment,'')),'');
    update public.staff_adjustments set amount=v_applied,status='paid',closed_at=coalesce(closed_at,now()) where id=v_row.id;
    insert into public.staff_adjustments(staff_id,kind,amount,date,comment,status,created_at)
    values(v_row.staff_id,v_row.kind,v_unapplied,v_row.date,concat_ws(' ',v_comment,'(остаток после зачёта в предыдущий расчёт)'),'active',now());
  end if;
end $$;

create or replace function public.staff_salary_adjustment_insert_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.staff_salary_apply_live_adjustment_row(new.id); return new; end $$;

create or replace function public.staff_salary_adjustment_status_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if old.status is distinct from new.status then
    if new.status='active' and coalesce(old.status,'')<>'active' and new.source_payment_id is null then
      perform public.staff_salary_apply_live_adjustment_row(new.id);
    elsif new.status='voided' and old.status='paid' and new.source_payment_id is null
      and exists(select 1 from public.staff_salary_settlement_adjustment_allocations where adjustment_id=new.id) then
      perform public.staff_salary_reverse_adjustment(new.id,null,null,jsonb_build_object('source','adjustment_void_trigger'));
    end if;
  end if; return new; end $$;

create or replace function public.staff_salary_resolve_point_debt_staff(p_operator_id uuid,p_client_name text)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_staff uuid; v_tg text; v_name text; v_short text;
begin
  if p_operator_id is not null then
    select telegram_chat_id,lower(trim(name)),lower(trim(coalesce(short_name,''))) into v_tg,v_name,v_short
    from public.operators where id=p_operator_id and coalesce(is_admin_staff,false)=true;
    if found then
      select id into v_staff from public.staff
      where (nullif(trim(coalesce(v_tg,'')),'') is not null and telegram_chat_id=v_tg)
        or lower(trim(full_name))=v_name or (v_short<>'' and lower(trim(coalesce(short_name,'')))=v_short)
      order by case when nullif(trim(coalesce(v_tg,'')),'') is not null and telegram_chat_id=v_tg then 0 else 1 end,created_at limit 1;
      if v_staff is not null then return v_staff; end if;
    end if;
  end if;
  if nullif(trim(coalesce(p_client_name,'')),'') is not null then
    select id into v_staff from public.staff where lower(trim(full_name))=lower(trim(p_client_name))
      or lower(trim(coalesce(short_name,'')))=lower(trim(p_client_name)) order by created_at limit 1;
  end if;
  return v_staff;
end $$;

create or replace function public.staff_salary_recompute_point_debt_mirror(p_item_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item public.point_debt_items%rowtype; v_remaining numeric:=0;
begin
  select * into v_item from public.point_debt_items where id=p_item_id; if v_item.id is null then return; end if;
  select coalesce(sum(total_amount),0) into v_remaining from public.point_debt_items
  where status='active' and company_id=v_item.company_id and week_start=v_item.week_start
    and ((v_item.operator_id is not null and operator_id=v_item.operator_id) or (v_item.operator_id is null and operator_id is null and client_name=v_item.client_name));
  update public.debts set amount=v_remaining,status=case when v_remaining>0 then 'active' else 'paid' end,
    paid_at=case when v_remaining>0 then null else coalesce(paid_at,now()) end,
    settled_via=case when v_remaining>0 then settled_via else coalesce(settled_via,'salary_settlement') end
  where company_id=v_item.company_id and week_start=v_item.week_start
    and ((v_item.operator_id is not null and operator_id=v_item.operator_id) or (v_item.operator_id is null and operator_id is null and client_name=v_item.client_name));
end $$;

create or replace function public.staff_salary_apply_live_point_debt_row(p_item_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item public.point_debt_items%rowtype; v_staff uuid; v_applied integer:=0; v_unapplied integer:=0; v_amount integer;
begin
  select * into v_item from public.point_debt_items where id=p_item_id for update;
  if v_item.id is null or v_item.status<>'active' then return; end if;
  if exists(select 1 from public.staff_salary_settlement_adjustment_allocations where point_debt_item_id=v_item.id) then return; end if;
  v_staff:=public.staff_salary_resolve_point_debt_staff(v_item.operator_id,v_item.client_name); if v_staff is null then return; end if;
  v_amount:=greatest(round(coalesce(v_item.total_amount,0))::integer,0); if v_amount<=0 then return; end if;
  select applied_amount,unapplied_amount into v_applied,v_unapplied
  from public.staff_salary_apply_adjustment(v_staff,'debt',v_amount,null,v_item.id,coalesce(v_item.created_at::date,current_date),null,
    jsonb_build_object('source','point_debt_trigger','company_id',v_item.company_id));
  if coalesce(v_applied,0)<=0 then return; end if;
  if coalesce(v_unapplied,0)<=0 then update public.point_debt_items set status='deleted',deleted_at=coalesce(deleted_at,now()) where id=v_item.id;
  else update public.point_debt_items set total_amount=v_unapplied where id=v_item.id; end if;
  perform public.staff_salary_recompute_point_debt_mirror(v_item.id);
end $$;

create or replace function public.staff_salary_point_debt_insert_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.staff_salary_apply_live_point_debt_row(new.id); return new; end $$;

create or replace function public.staff_salary_reverse_payment(p_payment_id bigint,p_actor_user_id uuid default null,p_metadata jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_before integer; v_after integer; v_restored integer:=0;
begin
  for r in select a.*,s.staff_id from public.staff_salary_payment_allocations a
    join public.staff_salary_settlements s on s.id=a.settlement_id where a.payment_id=p_payment_id
    order by a.allocation_order desc,a.created_at desc loop
    select remaining_amount into v_before from public.staff_salary_settlements where id=r.settlement_id for update;
    v_after:=v_before+r.amount;
    update public.staff_salary_settlements set paid_amount=greatest(paid_amount-r.amount,0),remaining_amount=v_after,
      status=case when v_after=0 then 'paid' when greatest(paid_amount-r.amount,0)>0 or balance_adjustment<>0 then 'partial' else 'unpaid' end,
      closed_at=case when v_after=0 then closed_at else null end,updated_at=now() where id=r.settlement_id;
    insert into public.staff_salary_settlement_events(settlement_id,staff_id,event_type,amount,balance_delta,before_remaining,after_remaining,payment_id,business_date,actor_user_id,metadata)
    values(r.settlement_id,r.staff_id,'payment_reversed',r.amount,r.amount,v_before,v_after,p_payment_id,current_date,p_actor_user_id,coalesce(p_metadata,'{}'::jsonb));
    v_restored:=v_restored+r.amount;
  end loop; return v_restored;
end $$;

create or replace function public.staff_salary_payment_delete_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.staff_salary_reverse_payment(old.id,null,jsonb_build_object('source','payment_delete_trigger')); return old; end $$;

drop trigger if exists trg_staff_salary_adjustment_insert on public.staff_adjustments;
create trigger trg_staff_salary_adjustment_insert after insert on public.staff_adjustments for each row
when (new.source_payment_id is null and new.status='active') execute function public.staff_salary_adjustment_insert_trigger();
drop trigger if exists trg_staff_salary_adjustment_status on public.staff_adjustments;
create trigger trg_staff_salary_adjustment_status after update of status on public.staff_adjustments for each row execute function public.staff_salary_adjustment_status_trigger();
drop trigger if exists trg_staff_salary_payment_insert on public.staff_salary_payments;
create trigger trg_staff_salary_payment_insert after insert on public.staff_salary_payments for each row execute function public.staff_salary_sync_payment_insert();
drop trigger if exists trg_staff_salary_payment_delete on public.staff_salary_payments;
create trigger trg_staff_salary_payment_delete before delete on public.staff_salary_payments for each row execute function public.staff_salary_payment_delete_trigger();
drop trigger if exists trg_staff_salary_point_debt_insert on public.point_debt_items;
create trigger trg_staff_salary_point_debt_insert after insert on public.point_debt_items for each row
when (new.status='active') execute function public.staff_salary_point_debt_insert_trigger();

revoke all on function public.staff_salary_freeze_settlement(uuid,uuid,date,text,date,date,date,date,integer,integer,integer,integer,integer,integer,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_reverse_payment(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_salary_freeze_settlement(uuid,uuid,date,text,date,date,date,date,integer,integer,integer,integer,integer,integer,jsonb,uuid) to service_role;
grant execute on function public.staff_salary_reverse_payment(bigint,uuid,jsonb) to service_role;
