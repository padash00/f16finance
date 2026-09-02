create or replace function public.staff_salary_sync_source_adjustment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_settlement public.staff_salary_settlements%rowtype;
  v_original integer:=greatest(coalesce(new.amount,0),0);
  v_allocated integer:=0;
  v_true_advance integer:=0;
  v_before integer;
  v_after integer;
  v_is_provisional boolean:=false;
  v_event_adjustment_id uuid;
begin
  if new.source_payment_id is null or new.staff_id is null or v_original<=0 then return new; end if;
  v_event_adjustment_id:=case when tg_op='UPDATE' then new.id else null end;

  select s.* into v_settlement
  from public.staff_salary_settlements s
  left join public.staff_salary_payments p on p.id=new.source_payment_id
  where s.staff_id=new.staff_id
    and (s.source_payment_id=new.source_payment_id
      or (p.id is not null and s.period_month=date_trunc('month',p.pay_date)::date and s.slot=p.slot))
  order by case when s.source_payment_id=new.source_payment_id then 0 else 1 end,s.created_at desc
  limit 1 for update of s;
  if v_settlement.id is null then return new; end if;
  v_is_provisional:=coalesce((v_settlement.snapshot->>'provisional')::boolean,false);

  if new.kind='bonus' and coalesce(new.comment,'') like 'Остаток по выплате %' then
    if tg_op='UPDATE' and old.status is distinct from new.status and new.status='voided' and old.status<>'voided' then
      v_before:=v_settlement.remaining_amount;
      if v_before>0 then
        update public.staff_salary_settlements set
          balance_adjustment=balance_adjustment-v_before,remaining_amount=0,
          snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('underpayment_voided',true,'underpayment_voided_at',now()),
          status='paid',closed_at=coalesce(closed_at,now()),updated_at=now()
        where id=v_settlement.id;
        insert into public.staff_salary_settlement_events(
          settlement_id,staff_id,event_type,amount,balance_delta,before_remaining,after_remaining,
          adjustment_id,payment_id,business_date,metadata)
        values(v_settlement.id,new.staff_id,'remainder_voided',v_before,-v_before,v_before,0,
          new.id,new.source_payment_id,coalesce(new.date,current_date),jsonb_build_object('source','legacy_ui_manual_void'));
      end if;
      return new;
    end if;

    if v_is_provisional then
      v_before:=v_settlement.remaining_amount;
      v_after:=v_before+v_original;
      update public.staff_salary_settlements set
        net_due=net_due+v_original,remaining_amount=v_after,
        snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object(
          'provisional',false,'underpayment_amount',v_original,'underpayment_bridge_adjustment_id',new.id),
        status=case when paid_amount>0 then 'partial' else 'unpaid' end,closed_at=null,updated_at=now()
      where id=v_settlement.id;
      insert into public.staff_salary_settlement_events(
        settlement_id,staff_id,event_type,amount,balance_delta,before_remaining,after_remaining,
        adjustment_id,payment_id,business_date,metadata)
      values(v_settlement.id,new.staff_id,'snapshot_underpayment_fixed',v_original,v_original,v_before,v_after,
        v_event_adjustment_id,new.source_payment_id,new.date,
        jsonb_build_object('source','legacy_underpayment_bridge','adjustment_id',new.id));
    else
      update public.staff_salary_settlements set
        snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('underpayment_bridge_adjustment_id',new.id),updated_at=now()
      where id=v_settlement.id and not coalesce((snapshot->>'underpayment_voided')::boolean,false);
      if not coalesce((v_settlement.snapshot->>'underpayment_voided')::boolean,false) then
        new.amount:=greatest(v_settlement.remaining_amount,1);
      end if;
    end if;

    if not coalesce((v_settlement.snapshot->>'underpayment_voided')::boolean,false) then
      new.status:=case when greatest(v_settlement.remaining_amount+case when v_is_provisional then v_original else 0 end,0)>0 then 'active' else 'paid' end;
      new.closed_at:=case when new.status='paid' then coalesce(new.closed_at,now()) else null end;
    end if;
    return new;
  end if;

  if new.kind='advance' and coalesce(new.comment,'') like 'Переплата по выплате %' then
    select coalesce(sum(amount),0)::integer into v_allocated
    from public.staff_salary_payment_allocations where payment_id=new.source_payment_id;
    v_true_advance:=greatest((select greatest(coalesce(p.amount,0)-v_allocated,0)
      from public.staff_salary_payments p where p.id=new.source_payment_id),0);

    if v_is_provisional then
      v_before:=v_settlement.remaining_amount;
      update public.staff_salary_settlements set
        net_due=greatest(net_due-v_original,0),
        remaining_amount=greatest(greatest(net_due-v_original,0)+balance_adjustment-paid_amount,0),
        snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object(
          'provisional',false,'legacy_overpayment_amount',v_original,'true_advance_amount',v_true_advance,
          'overpayment_bridge_adjustment_id',new.id),updated_at=now()
      where id=v_settlement.id returning remaining_amount into v_after;
      perform public.staff_salary_settlement_refresh_status(v_settlement.id);
      insert into public.staff_salary_settlement_events(
        settlement_id,staff_id,event_type,amount,balance_delta,before_remaining,after_remaining,
        adjustment_id,payment_id,business_date,metadata)
      values(v_settlement.id,new.staff_id,'snapshot_overpayment_fixed',v_original,v_after-v_before,v_before,v_after,
        v_event_adjustment_id,new.source_payment_id,new.date,
        jsonb_build_object('source','legacy_overpayment_bridge','true_advance_amount',v_true_advance,'adjustment_id',new.id));
    end if;

    if v_true_advance<=0 then new.status:='voided'; new.closed_at:=coalesce(new.closed_at,now());
    else new.amount:=v_true_advance; new.status:='active'; new.closed_at:=null; end if;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists trg_staff_salary_source_adjustment on public.staff_adjustments;
create trigger trg_staff_salary_source_adjustment
before insert or update of amount,status on public.staff_adjustments
for each row when (new.source_payment_id is not null)
execute function public.staff_salary_sync_source_adjustment();

revoke all on function public.staff_salary_sync_source_adjustment() from public,anon,authenticated;
