-- Phase 3: SQL функции для инцидентов.
-- incidents_create: создаёт инцидент, подтягивает суммы из статьи если не заданы,
-- привязывает к текущей открытой смене компании если shift_id не передан.

create or replace function public.incidents_create(
  p_company_id uuid,
  p_kind text,
  p_title text,
  p_description text,
  p_subject_staff_id uuid,
  p_reported_by uuid,
  p_reported_by_user_id uuid,
  p_article_id uuid,
  p_severity text,
  p_fine_amount numeric,
  p_bonus_amount numeric,
  p_photo_urls text[],
  p_shift_id uuid,
  p_source text,
  p_checklist_run_id uuid,
  p_checklist_item_id uuid,
  p_status text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_org uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'violation');
  v_severity text := coalesce(nullif(trim(p_severity), ''), 'normal');
  v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
  v_status text := coalesce(nullif(trim(p_status), ''), 'confirmed');
  v_shift_id uuid := p_shift_id;
  v_fine numeric := coalesce(p_fine_amount, 0);
  v_bonus numeric := coalesce(p_bonus_amount, 0);
  v_article_fine numeric;
  v_article_bonus numeric;
begin
  if p_company_id is null then
    raise exception 'incident-company-required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'incident-title-required';
  end if;
  if v_kind not in ('violation', 'bonus', 'note') then
    raise exception 'incident-kind-invalid';
  end if;
  if v_status not in ('draft', 'confirmed', 'disputed', 'voided') then
    raise exception 'incident-status-invalid';
  end if;

  -- Если суммы не заданы и есть статья — подтянуть дефолты.
  if p_article_id is not null then
    select related_fine_amount, related_bonus_amount
      into v_article_fine, v_article_bonus
      from public.knowledge_articles
      where id = p_article_id;

    if (p_fine_amount is null or p_fine_amount = 0) and v_article_fine is not null then
      v_fine := v_article_fine;
    end if;
    if (p_bonus_amount is null or p_bonus_amount = 0) and v_article_bonus is not null then
      v_bonus := v_article_bonus;
    end if;
  end if;

  -- Для note — суммы всегда 0
  if v_kind = 'note' then
    v_fine := 0;
    v_bonus := 0;
  end if;

  -- Привязать к открытой смене, если не передано
  if v_shift_id is null then
    select id into v_shift_id
      from public.point_shifts
      where company_id = p_company_id and status = 'open'
      limit 1;
  end if;

  -- organization_id
  select organization_id into v_org from public.companies where id = p_company_id;

  insert into public.incidents (
    company_id, organization_id, shift_id, article_id,
    checklist_run_id, checklist_item_id,
    kind, subject_staff_id, reported_by, reported_by_user_id,
    title, description, photo_urls,
    fine_amount, bonus_amount,
    severity, status, source
  ) values (
    p_company_id, v_org, v_shift_id, p_article_id,
    p_checklist_run_id, p_checklist_item_id,
    v_kind, p_subject_staff_id, p_reported_by, p_reported_by_user_id,
    trim(p_title), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_photo_urls, '{}'::text[]),
    round(v_fine, 2), round(v_bonus, 2),
    v_severity, v_status, v_source
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Сводка штрафов/бонусов по смене (для интеграции в зарплату).
create or replace function public.incidents_shift_totals(p_shift_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_fines numeric := 0;
  v_bonuses numeric := 0;
  v_violations integer := 0;
  v_bonus_count integer := 0;
  v_notes integer := 0;
begin
  select
    coalesce(sum(case when kind = 'violation' and status = 'confirmed' then fine_amount else 0 end), 0),
    coalesce(sum(case when kind = 'bonus' and status = 'confirmed' then bonus_amount else 0 end), 0),
    count(*) filter (where kind = 'violation' and status = 'confirmed'),
    count(*) filter (where kind = 'bonus' and status = 'confirmed'),
    count(*) filter (where kind = 'note')
  into v_fines, v_bonuses, v_violations, v_bonus_count, v_notes
  from public.incidents
  where shift_id = p_shift_id;

  return jsonb_build_object(
    'fines_total', v_fines,
    'bonuses_total', v_bonuses,
    'violations_count', v_violations,
    'bonuses_count', v_bonus_count,
    'notes_count', v_notes
  );
end;
$$;
