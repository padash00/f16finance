-- Phase 4: расширение point_shift_open — проверка онбординга оператора.
-- Если в организации есть активный checklist_template со schedule_type='onboarding'
-- и у оператора onboarded_at is null — открытие отклоняется.

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
  v_operator_onboarded timestamptz;
  v_has_onboarding_template boolean := false;
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

  select id into v_existing
    from public.point_shifts
    where company_id = p_company_id and status = 'open'
    limit 1;

  if v_existing is not null then
    raise exception 'point-shift-already-open' using detail = v_existing::text;
  end if;

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

  -- Онбординг: если у организации есть активный onboarding-template и оператор не онбординг —
  -- блокируем открытие смены.
  if p_operator_id is not null then
    select onboarded_at into v_operator_onboarded
      from public.staff where id = p_operator_id;

    if v_operator_onboarded is null then
      select exists(
        select 1 from public.checklist_templates
        where is_active = true
          and schedule_type = 'onboarding'
          and (organization_id = v_org_id or organization_id is null)
      ) into v_has_onboarding_template;

      if v_has_onboarding_template then
        raise exception 'point-shift-operator-not-onboarded' using detail = p_operator_id::text;
      end if;
    end if;
  end if;

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
