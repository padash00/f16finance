-- ─────────────────────────────────────────────────────────────────────────
-- Изоляция базы знаний: бэкфилл organization_id.
-- ─────────────────────────────────────────────────────────────────────────
-- Точка-API отдавал статьи/чек-листы по правилу company_id IS NULL OR =точка —
-- из-за чего легаси-строки с organization_id/company_id = NULL (база знаний,
-- правила, FAQ, чек-листы F16) утекали в операторские ДРУГИХ клиентов.
--
-- Теперь запросы точки фильтруют по organization_id устройства. Чтобы контент
-- F16 не пропал у его же операторов, привязываем существующие null-org строки
-- к единственной реальной организации.
--
-- Безопасно, пока организация-владелец контента ОДНА (F16). Идемпотентно.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_org uuid;
  v_org_count int;
begin
  select count(distinct organization_id) into v_org_count
    from public.companies where organization_id is not null;

  if v_org_count <> 1 then
    raise notice 'Пропущено: организаций-владельцев не одна (%). Требуется ручной разбор.', v_org_count;
    return;
  end if;

  select organization_id into v_org
    from public.companies where organization_id is not null
    group by organization_id order by count(*) desc limit 1;

  update public.knowledge_articles   set organization_id = v_org where organization_id is null;
  update public.knowledge_categories set organization_id = v_org where organization_id is null;
  update public.checklist_templates  set organization_id = v_org where organization_id is null;
  -- Категории расхода (COGS) F16 с organization_id IS NULL тоже текли в приёмку
  -- других клиентов — привязываем к F16.
  update public.expense_categories   set organization_id = v_org where organization_id is null;

  raise notice 'Бэкфилл knowledge/categories organization_id → % выполнен.', v_org;
end $$;

notify pgrst, 'reload schema';
