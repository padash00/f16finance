-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 3 рефактора: создание реальных остатков на витрине (point_display).
--
-- Что делает:
--   Для каждой компании, у которой есть warehouse и catalog_total,
--   считает «витрину» как `max(0, catalog - warehouse)` и записывает
--   полученные значения в inventory_balances для location_type='point_display'.
--
-- При этом:
--   - Если у компании нет point_display — создаёт его (стандартное имя)
--   - Только обновляет, если значение отличается от уже записанного на point_display
--   - Создаёт по одному movement типа 'migration_initial' на каждое НЕНУЛЕВОЕ занесение,
--     чтобы потом health-check видел согласованность balance vs movements
--
-- ВАЖНО: миграция идемпотентна — повторный запуск ничего лишнего не сделает,
-- потому что движения 'migration_initial' уже будут учтены в сумме.
--
-- Безопасность: ничего не удаляет, только добавляет/обновляет.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_company record;
  v_pair record;
  v_pd_loc_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_movements integer := 0;
begin
  for v_company in
    select
      c.id as company_id,
      c.name as company_name,
      c.code as company_code,
      c.organization_id,
      wh.id as wh_id,
      ct.id as ct_id,
      pd.id as pd_id
    from public.companies c
    left join lateral (
      select id from public.inventory_locations
      where company_id = c.id and location_type = 'warehouse' and is_active
      order by created_at asc nulls last, id asc
      limit 1
    ) wh on true
    left join lateral (
      select id from public.inventory_locations
      where company_id = c.id and location_type = 'catalog_total' and is_active
      order by created_at asc nulls last, id asc
      limit 1
    ) ct on true
    left join lateral (
      select id from public.inventory_locations
      where company_id = c.id and location_type = 'point_display' and is_active
      order by created_at asc nulls last, id asc
      limit 1
    ) pd on true
    where wh.id is not null and ct.id is not null
  loop
    -- Создаём point_display, если его нет
    if v_company.pd_id is null then
      insert into public.inventory_locations (
        company_id, organization_id, name, code, location_type, is_active
      ) values (
        v_company.company_id,
        v_company.organization_id,
        'Витрина — ' || v_company.company_name,
        case when v_company.company_code is not null then 'PD-' || v_company.company_code else null end,
        'point_display',
        true
      )
      on conflict do nothing
      returning id into v_pd_loc_id;

      if v_pd_loc_id is null then
        select id into v_pd_loc_id
        from public.inventory_locations
        where company_id = v_company.company_id and location_type = 'point_display';
      end if;
    else
      v_pd_loc_id := v_company.pd_id;
    end if;

    -- Для каждого товара, у которого есть запись на warehouse или catalog_total
    for v_pair in
      with src as (
        select b.item_id,
               sum(case when b.location_id = v_company.wh_id then b.quantity else 0 end) as wh_qty,
               sum(case when b.location_id = v_company.ct_id then b.quantity else 0 end) as ct_qty,
               max(case when b.location_id = v_pd_loc_id then b.quantity else 0 end) as pd_current
        from public.inventory_balances b
        where b.location_id in (v_company.wh_id, v_company.ct_id, v_pd_loc_id)
        group by b.item_id
      )
      select
        s.item_id,
        s.wh_qty,
        s.ct_qty,
        s.pd_current,
        greatest(0, s.ct_qty - s.wh_qty) as expected_pd
      from src s
    loop
      -- Если уже совпадает (с погрешностью) — пропускаем
      if abs(coalesce(v_pair.pd_current, 0) - v_pair.expected_pd) < 0.0005 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Upsert баланса витрины
      insert into public.inventory_balances (location_id, item_id, quantity, updated_at)
      values (v_pd_loc_id, v_pair.item_id, v_pair.expected_pd, timezone('utc', now()))
      on conflict (location_id, item_id) do update
        set quantity = excluded.quantity,
            updated_at = excluded.updated_at;

      if coalesce(v_pair.pd_current, 0) = 0 and v_pair.expected_pd > 0 then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
      end if;

      -- Запись стартового движения для health-check согласованности
      -- (только если значение положительное; нулевые позиции не нужны)
      if v_pair.expected_pd > 0 then
        insert into public.inventory_movements (
          item_id,
          movement_type,
          to_location_id,
          quantity,
          reference_type,
          reference_id,
          comment,
          actor_user_id,
          idempotency_key
        ) values (
          v_pair.item_id,
          'migration_initial',
          v_pd_loc_id,
          v_pair.expected_pd,
          'showcase_v2_backfill',
          null,
          'Стартовый остаток витрины (миграция v1→v2: catalog − warehouse)',
          null,
          'showcase_v2_backfill:' || v_pd_loc_id::text || ':' || v_pair.item_id::text
        )
        on conflict (idempotency_key) where idempotency_key is not null do nothing;

        v_movements := v_movements + 1;
      end if;
    end loop;
  end loop;

  raise notice 'Витрина v2 backfill: добавлено %, обновлено %, пропущено %, движений %',
    v_inserted, v_updated, v_skipped, v_movements;
end $$;
