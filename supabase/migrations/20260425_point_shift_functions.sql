-- Phase 1: атомарные функции открытия и закрытия смены.

create or replace function public.point_shift_open(
  p_company_id uuid,
  p_operator_id uuid,
  p_point_device_id uuid,
  p_shift_type text,
  p_opening_cash numeric,
  p_opening_notes text,
  p_handover_from uuid
)
returns uuid
language plpgsql
as $$
declare
  v_shift_id uuid;
  v_org_id uuid;
  v_existing uuid;
  v_handover_company uuid;
begin
  if p_company_id is null then
    raise exception 'point-shift-company-required';
  end if;

  if p_shift_type is null then
    p_shift_type := 'day';
  end if;

  if p_shift_type not in ('day', 'night', 'custom') then
    raise exception 'point-shift-type-invalid';
  end if;

  -- Уже есть открытая смена?
  select id into v_existing
    from public.point_shifts
    where company_id = p_company_id and status = 'open'
    limit 1;

  if v_existing is not null then
    raise exception 'point-shift-already-open' using detail = v_existing::text;
  end if;

  -- Handover проверка (только если передано)
  if p_handover_from is not null then
    select company_id into v_handover_company
      from public.point_shifts where id = p_handover_from;
    if v_handover_company is null then
      raise exception 'point-shift-handover-not-found';
    end if;
    if v_handover_company <> p_company_id then
      raise exception 'point-shift-handover-company-mismatch';
    end if;
  end if;

  select organization_id into v_org_id
    from public.companies where id = p_company_id;

  insert into public.point_shifts (
    company_id,
    organization_id,
    operator_id,
    point_device_id,
    shift_type,
    opening_cash,
    opening_notes,
    handover_from_shift_id
  ) values (
    p_company_id,
    v_org_id,
    p_operator_id,
    p_point_device_id,
    p_shift_type,
    coalesce(round(p_opening_cash, 2), 0),
    nullif(trim(coalesce(p_opening_notes, '')), ''),
    p_handover_from
  )
  returning id into v_shift_id;

  return v_shift_id;
end;
$$;

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
  v_totals jsonb;
begin
  select * into v_shift from public.point_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'point-shift-not-found';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'point-shift-not-open';
  end if;

  -- Kaspi split sanity (если split задан)
  if (v_kaspi_before > 0 or v_kaspi_after > 0)
     and abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'point-shift-kaspi-split-mismatch';
  end if;

  -- Итоги по продажам/возвратам этой смены
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
