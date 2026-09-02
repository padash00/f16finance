create or replace function public.staff_salary_sync_legacy_remainder(p_settlement_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_settlement public.staff_salary_settlements%rowtype; v_adjustment_id uuid;
begin
  select * into v_settlement from public.staff_salary_settlements where id=p_settlement_id;
  if v_settlement.id is null then return; end if;
  if coalesce((v_settlement.snapshot->>'underpayment_voided')::boolean,false) then return; end if;
  begin v_adjustment_id:=nullif(v_settlement.snapshot->>'underpayment_bridge_adjustment_id','')::uuid;
  exception when others then v_adjustment_id:=null; end;
  if v_adjustment_id is null then return; end if;
  if v_settlement.remaining_amount>0 then
    update public.staff_adjustments set amount=v_settlement.remaining_amount,status='active',closed_at=null
    where id=v_adjustment_id and status<>'voided';
  else
    update public.staff_adjustments set status='paid',closed_at=coalesce(closed_at,now())
    where id=v_adjustment_id and status<>'voided';
  end if;
end $$;

create or replace function public.staff_salary_settlement_remainder_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.remaining_amount is distinct from new.remaining_amount then
    perform public.staff_salary_sync_legacy_remainder(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_staff_salary_settlement_remainder on public.staff_salary_settlements;
create trigger trg_staff_salary_settlement_remainder
after update of remaining_amount on public.staff_salary_settlements
for each row execute function public.staff_salary_settlement_remainder_trigger();

revoke all on function public.staff_salary_sync_legacy_remainder(uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_settlement_remainder_trigger() from public,anon,authenticated;
grant execute on function public.staff_salary_sync_legacy_remainder(uuid) to service_role;
