-- ─────────────────────────────────────────────────────────────────────────
-- Админские действия над сменами для тестирования и отладки.
--
-- 1. point_shift_admin_close — закрыть открытую смену принудительно
--    (без продажи каких-либо отчётов, для теста)
-- 2. point_shift_admin_purge — полностью удалить смену и ВСЁ связанное:
--    продажи, возвраты, чек-листы, инциденты. Остатки витрины
--    возвращаются (продажи/возвраты откатываются).
--    ОПАСНАЯ операция — только для super-admin.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Закрыть смену принудительно
create or replace function public.point_shift_admin_close(
  p_shift_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.point_shifts%rowtype;
begin
  select * into v_shift
  from public.point_shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    raise exception 'shift-not-found';
  end if;

  if v_shift.status = 'closed' then
    raise exception 'shift-already-closed';
  end if;

  update public.point_shifts
  set status = 'closed',
      closed_at = timezone('utc', now()),
      closed_by = p_actor_user_id,
      closing_notes = coalesce(closing_notes || E'\n', '') ||
        '[Принудительное закрытие админом' ||
        case when p_note is not null and length(trim(p_note)) > 0 then ': ' || p_note else '' end ||
        ']',
      updated_at = timezone('utc', now())
  where id = p_shift_id;
end;
$$;


-- 2. Полное удаление смены (для тестов).
-- Возвращает товары на витрину для каждой продажи смены, потом удаляет всё.
create or replace function public.point_shift_admin_purge(
  p_shift_id uuid,
  p_actor_user_id uuid
)
returns table (
  sales_deleted integer,
  returns_deleted integer,
  movements_deleted integer,
  checklist_runs_deleted integer,
  incidents_deleted integer,
  showcase_restored integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_pd_loc_id uuid;
  v_sale_count integer := 0;
  v_return_count integer := 0;
  v_mov_count integer := 0;
  v_run_count integer := 0;
  v_inc_count integer := 0;
  v_restore_count integer := 0;
  v_sale record;
  v_item record;
  v_return record;
begin
  -- Найти компанию смены
  select company_id into v_company_id from public.point_shifts where id = p_shift_id;
  if v_company_id is null then
    raise exception 'shift-not-found';
  end if;

  -- Найти витрину компании
  select id into v_pd_loc_id
  from public.inventory_locations
  where company_id = v_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  -- Откатить продажи: вернуть товары на витрину
  for v_sale in select id from public.point_sales where shift_id = p_shift_id
  loop
    if v_pd_loc_id is not null then
      for v_item in
        select item_id, quantity
        from public.point_sale_items
        where sale_id = v_sale.id and item_id is not null
      loop
        perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item.item_id, v_item.quantity);
        v_restore_count := v_restore_count + 1;
      end loop;
    end if;
  end loop;

  -- Откатить возвраты: вычесть с витрины (возврат добавлял на витрину)
  for v_return in select id from public.point_returns where shift_id = p_shift_id
  loop
    if v_pd_loc_id is not null then
      for v_item in
        select item_id, quantity
        from public.point_return_items
        where return_id = v_return.id and item_id is not null
      loop
        perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item.item_id, -v_item.quantity);
        v_restore_count := v_restore_count + 1;
      end loop;
    end if;
  end loop;

  -- Удалить движения связанные со сменой
  delete from public.inventory_movements where reference_id in (
    select id from public.point_sales where shift_id = p_shift_id
    union
    select id from public.point_returns where shift_id = p_shift_id
  );
  get diagnostics v_mov_count = row_count;

  -- Удалить инциденты
  delete from public.incidents where shift_id = p_shift_id;
  get diagnostics v_inc_count = row_count;

  -- Удалить чек-листы
  delete from public.checklist_runs where shift_id = p_shift_id;
  get diagnostics v_run_count = row_count;

  -- Удалить items продаж и сами продажи
  delete from public.point_sale_items where sale_id in (
    select id from public.point_sales where shift_id = p_shift_id
  );
  delete from public.point_sales where shift_id = p_shift_id;
  get diagnostics v_sale_count = row_count;

  -- Удалить items возвратов и сами возвраты
  delete from public.point_return_items where return_id in (
    select id from public.point_returns where shift_id = p_shift_id
  );
  delete from public.point_returns where shift_id = p_shift_id;
  get diagnostics v_return_count = row_count;

  -- Наконец — саму смену
  delete from public.point_shifts where id = p_shift_id;

  return query select v_sale_count, v_return_count, v_mov_count, v_run_count, v_inc_count, v_restore_count;
end;
$$;

comment on function public.point_shift_admin_close is
  'Принудительное закрытие смены админом (для тестов и редких корректировок).';
comment on function public.point_shift_admin_purge is
  'ПОЛНОЕ удаление смены: продажи, возвраты, движения, чек-листы, инциденты. Остатки витрины откатываются. ОПАСНО — только для super-admin.';
