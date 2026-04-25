-- Phase 3: расширение point_shift_close — учёт штрафов/бонусов из incidents в totals_json.
-- Полная замена функции (та же сигнатура).

create or replace function public.point_shift_close(
  p_shift_id uuid,
  p_closed_by uuid,
  p_closing_cash numeric,
  p_closing_kaspi numeric,
  p_kaspi_before_midnight numeric,
  p_kaspi_after_midnight numeric,
  p_z_report_url text,
  p_x_report_url text,
  p_closing_notes text
)
returns jsonb
language plpgsql
as $$
declare
  v_shift public.point_shifts%rowtype;
  v_sales_total numeric := 0;
  v_sales_count integer := 0;
  v_sales_cash numeric := 0;
  v_sales_kaspi numeric := 0;
  v_returns_total numeric := 0;
  v_returns_count integer := 0;
  v_returns_cash numeric := 0;
  v_returns_kaspi numeric := 0;
  v_kaspi numeric := round(coalesce(p_closing_kaspi, 0), 2);
  v_kaspi_before numeric := round(coalesce(p_kaspi_before_midnight, 0), 2);
  v_kaspi_after numeric := round(coalesce(p_kaspi_after_midnight, 0), 2);
  v_fines numeric := 0;
  v_bonuses numeric := 0;
  v_violations integer := 0;
  v_bonus_count integer := 0;
  v_checklist_fines numeric := 0;
  v_checklist_bonuses numeric := 0;
  v_totals jsonb;
begin
  select * into v_shift from public.point_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'point-shift-not-found';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'point-shift-not-open';
  end if;

  if (v_kaspi_before > 0 or v_kaspi_after > 0)
     and abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'point-shift-kaspi-split-mismatch';
  end if;

  select
    coalesce(sum(total_amount), 0),
    coalesce(sum(cash_amount), 0),
    coalesce(sum(kaspi_amount), 0),
    count(*)
  into v_sales_total, v_sales_cash, v_sales_kaspi, v_sales_count
  from public.point_sales
  where shift_id = p_shift_id;

  select
    coalesce(sum(total_amount), 0),
    coalesce(sum(cash_amount), 0),
    coalesce(sum(kaspi_amount), 0),
    count(*)
  into v_returns_total, v_returns_cash, v_returns_kaspi, v_returns_count
  from public.point_returns
  where shift_id = p_shift_id;

  -- Инциденты (только confirmed)
  select
    coalesce(sum(case when kind = 'violation' then fine_amount else 0 end), 0),
    coalesce(sum(case when kind = 'bonus' then bonus_amount else 0 end), 0),
    count(*) filter (where kind = 'violation'),
    count(*) filter (where kind = 'bonus')
  into v_fines, v_bonuses, v_violations, v_bonus_count
  from public.incidents
  where shift_id = p_shift_id and status = 'confirmed';

  -- Сводка из чек-листов (для аудита; основной источник — incidents).
  select
    coalesce(sum(fines_total), 0),
    coalesce(sum(bonuses_total), 0)
  into v_checklist_fines, v_checklist_bonuses
  from public.checklist_runs
  where shift_id = p_shift_id and status = 'completed';

  v_totals := jsonb_build_object(
    'sales_total', v_sales_total,
    'sales_count', v_sales_count,
    'sales_cash', v_sales_cash,
    'sales_kaspi', v_sales_kaspi,
    'returns_total', v_returns_total,
    'returns_count', v_returns_count,
    'returns_cash', v_returns_cash,
    'returns_kaspi', v_returns_kaspi,
    'net_total', v_sales_total - v_returns_total,
    'closing_cash', round(coalesce(p_closing_cash, 0), 2),
    'closing_kaspi', v_kaspi,
    'opening_cash', v_shift.opening_cash,
    'shift_type', v_shift.shift_type,
    'fines_total', v_fines,
    'bonuses_total', v_bonuses,
    'violations_count', v_violations,
    'bonuses_count', v_bonus_count,
    'checklist_fines_total', v_checklist_fines,
    'checklist_bonuses_total', v_checklist_bonuses,
    'salary_adjustment', v_bonuses - v_fines,
    'computed_at', to_jsonb(now())
  );

  update public.point_shifts
  set
    status = 'closed',
    closed_at = now(),
    closed_by = p_closed_by,
    closing_cash = round(coalesce(p_closing_cash, 0), 2),
    closing_kaspi = v_kaspi,
    closing_kaspi_before_midnight = v_kaspi_before,
    closing_kaspi_after_midnight = v_kaspi_after,
    z_report_url = nullif(trim(coalesce(p_z_report_url, '')), ''),
    x_report_url = nullif(trim(coalesce(p_x_report_url, '')), ''),
    closing_notes = nullif(trim(coalesce(p_closing_notes, '')), ''),
    totals_json = v_totals
  where id = p_shift_id;

  return v_totals;
end;
$$;
