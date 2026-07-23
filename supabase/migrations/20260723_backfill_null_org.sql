-- ─────────────────────────────────────────────────────────────────────────────
-- Изоляция арендаторов: бэкфилл organization_id в таблицах ДАННЫХ, где легаси-
-- строки имели organization_id = NULL и потому были видны всем арендаторам
-- через .or(organization_id.eq.X, is.null). Заполняем единственной реальной
-- организацией (F16) — безопасно, пока арендатор один.
--
-- Если организаций-владельцев компаний больше одной — НЕ трогаем (нельзя
-- угадать принадлежность), строки останутся org=NULL для ручного разбора.
-- Идемпотентно (WHERE organization_id IS NULL).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_org uuid;
  v_org_count int;
begin
  select count(distinct organization_id) into v_org_count
    from public.companies where organization_id is not null;

  if v_org_count <> 1 then
    raise notice 'Пропущено: организаций-владельцев не одна (%). Бэкфилл null-org требует ручного разбора.', v_org_count;
    return;
  end if;

  select organization_id into v_org
    from public.companies where organization_id is not null
    group by organization_id order by count(*) desc limit 1;

  update public.inventory_items       set organization_id = v_org where organization_id is null;
  update public.inventory_suppliers   set organization_id = v_org where organization_id is null;
  update public.invoice_name_mappings set organization_id = v_org where organization_id is null;
  update public.supplier_debts        set organization_id = v_org where organization_id is null;
  -- team_chat_messages: колонка есть (20260509_chat_moderation); заполняем
  update public.team_chat_messages    set organization_id = v_org where organization_id is null;

  raise notice 'Бэкфилл organization_id → % выполнен.', v_org;
end $$;

notify pgrst, 'reload schema';
