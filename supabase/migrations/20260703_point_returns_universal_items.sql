-- ─────────────────────────────────────────────────────────────────────────
-- Возврат универсальных товаров.
--
-- Продажа универсальных товаров (item_id = null + universal_name) появилась
-- в 20260506_point_sale_universal_items.sql, но возвраты остались только для
-- каталожных: inventory_create_point_return падал point-return-line-invalid.
-- Здесь: point_return_items учится хранить universal_name, RPC — матчить
-- универсальные строки чека по названию+цене. Остатки/движения для них
-- не трогаем (при продаже ничего не списывалось).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. point_return_items: item_id nullable + universal_name (зеркало sale items)
alter table public.point_return_items
  alter column item_id drop not null;

alter table public.point_return_items
  add column if not exists universal_name text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'point_return_items_item_or_universal'
  ) then
    alter table public.point_return_items
      add constraint point_return_items_item_or_universal
      check (
        (item_id is not null and universal_name is null)
        or (item_id is null and universal_name is not null and length(trim(universal_name)) > 0)
      );
  end if;
end $$;

-- 2. RPC: возврат с поддержкой универсальных строк
create or replace function public.inventory_create_point_return(
  p_company_id uuid,
  p_location_id uuid,
  p_point_device_id uuid,
  p_operator_id uuid,
  p_sale_id uuid,
  p_return_date date,
  p_shift text,
  p_payment_method text,
  p_cash_amount numeric,
  p_kaspi_amount numeric,
  p_kaspi_before_midnight_amount numeric,
  p_kaspi_after_midnight_amount numeric,
  p_comment text,
  p_source text,
  p_local_ref text,
  p_items jsonb
)
returns table (return_id uuid, total_amount numeric)
language plpgsql
set search_path = public, pg_temp
as $fn_point_return$
declare
  v_return_id uuid;
  v_total numeric := 0;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_kaspi numeric := round(coalesce(p_kaspi_amount, 0), 2);
  v_kaspi_before numeric := round(coalesce(p_kaspi_before_midnight_amount, 0), 2);
  v_kaspi_after numeric := round(coalesce(p_kaspi_after_midnight_amount, 0), 2);
  v_item jsonb;
  v_item_id uuid;
  v_universal_name text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_sold_qty numeric;
  v_returned_qty numeric;
  v_sale_item_id uuid;
  v_sale record;
  v_showcase_loc_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'point-return-items-required';
  end if;

  if p_sale_id is null then
    raise exception 'point-return-sale-required';
  end if;

  if p_shift not in ('day', 'night') then
    raise exception 'point-return-shift-invalid';
  end if;

  if p_payment_method not in ('cash', 'kaspi', 'mixed') then
    raise exception 'point-return-payment-method-invalid';
  end if;

  if v_cash < 0 or v_kaspi < 0 or v_kaspi_before < 0 or v_kaspi_after < 0 then
    raise exception 'point-return-payment-invalid';
  end if;

  if abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'point-return-kaspi-split-mismatch';
  end if;

  select ps.id, ps.company_id, ps.location_id, ps.payment_method, ps.total_amount
  into v_sale
  from public.point_sales ps
  where ps.id = p_sale_id and ps.company_id = p_company_id and ps.location_id = p_location_id;

  if v_sale.id is null then
    raise exception 'point-return-sale-not-found';
  end if;

  if v_sale.payment_method <> p_payment_method then
    raise exception 'point-return-payment-method-mismatch';
  end if;

  select id into v_showcase_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  if v_showcase_loc_id is null then
    raise exception 'point-return-showcase-location-missing';
  end if;

  insert into public.point_returns (
    company_id, location_id, point_device_id, operator_id, sale_id,
    return_date, shift, payment_method, cash_amount, kaspi_amount,
    kaspi_before_midnight_amount, kaspi_after_midnight_amount,
    comment, source, local_ref
  )
  values (
    p_company_id, p_location_id, p_point_device_id, p_operator_id, p_sale_id,
    p_return_date, p_shift, p_payment_method, v_cash, v_kaspi,
    v_kaspi_before, v_kaspi_after,
    nullif(trim(coalesce(p_comment, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'point-client'),
    nullif(trim(coalesce(p_local_ref, '')), '')
  )
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item ->> 'item_id', '')::uuid;
    v_universal_name := nullif(trim(coalesce(v_item ->> 'universal_name', '')), '');
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);

    if (v_item_id is null and v_universal_name is null) or v_qty <= 0 then
      raise exception 'point-return-line-invalid';
    end if;

    if v_unit_price < 0 then
      raise exception 'point-return-unit-price-invalid';
    end if;

    if v_item_id is not null then
      -- Каталожная строка: матчим по item_id + цене
      select coalesce(sum(psi.quantity), 0) into v_sold_qty
      from public.point_sale_items psi
      where psi.sale_id = p_sale_id and psi.item_id = v_item_id
        and abs(psi.unit_price - v_unit_price) <= 0.01;

      select psi.id into v_sale_item_id
      from public.point_sale_items psi
      where psi.sale_id = p_sale_id and psi.item_id = v_item_id
        and abs(psi.unit_price - v_unit_price) <= 0.01
      order by psi.id
      limit 1;

      select coalesce(sum(pri.quantity), 0) into v_returned_qty
      from public.point_return_items pri
      join public.point_returns pr on pr.id = pri.return_id
      where pr.sale_id = p_sale_id and pri.item_id = v_item_id
        and abs(pri.unit_price - v_unit_price) <= 0.01;
    else
      -- Универсальная строка: матчим по названию + цене
      select coalesce(sum(psi.quantity), 0) into v_sold_qty
      from public.point_sale_items psi
      where psi.sale_id = p_sale_id and psi.item_id is null
        and trim(coalesce(psi.universal_name, '')) = v_universal_name
        and abs(psi.unit_price - v_unit_price) <= 0.01;

      select psi.id into v_sale_item_id
      from public.point_sale_items psi
      where psi.sale_id = p_sale_id and psi.item_id is null
        and trim(coalesce(psi.universal_name, '')) = v_universal_name
        and abs(psi.unit_price - v_unit_price) <= 0.01
      order by psi.id
      limit 1;

      select coalesce(sum(pri.quantity), 0) into v_returned_qty
      from public.point_return_items pri
      join public.point_returns pr on pr.id = pri.return_id
      where pr.sale_id = p_sale_id and pri.item_id is null
        and trim(coalesce(pri.universal_name, '')) = v_universal_name
        and abs(pri.unit_price - v_unit_price) <= 0.01;
    end if;

    if coalesce(v_sold_qty, 0) <= 0 then
      raise exception 'point-return-item-not-in-sale';
    end if;

    if coalesce(v_returned_qty, 0) + v_qty > v_sold_qty + 0.0001 then
      raise exception 'point-return-exceeds-sold-qty';
    end if;

    v_line_total := round(v_qty * v_unit_price, 2);
    v_total := v_total + v_line_total;

    insert into public.point_return_items (
      return_id, sale_item_id, item_id, universal_name, quantity, unit_price, total_price, comment
    )
    values (
      v_return_id, v_sale_item_id, v_item_id, v_universal_name, v_qty, v_unit_price, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Остаток и движения — только для каталожных (универсальные не списывались)
    if v_item_id is not null then
      perform public.inventory_apply_balance_delta(v_showcase_loc_id, v_item_id, v_qty);

      insert into public.inventory_movements (
        item_id, movement_type, to_location_id, quantity, total_amount,
        reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item_id, 'return', v_showcase_loc_id, v_qty, v_line_total,
        'point_return', v_return_id,
        nullif(trim(coalesce(v_item ->> 'comment', '')), ''), null
      );
    end if;
  end loop;

  v_total := round(v_total, 2);

  if abs(v_total - (v_cash + v_kaspi)) > 0.01 then
    raise exception 'point-return-payment-total-mismatch';
  end if;

  update public.point_returns
  set total_amount = v_total
  where id = v_return_id;

  return query select v_return_id, v_total;
end;
$fn_point_return$;

comment on column public.point_return_items.universal_name is
  'Название универсального товара из чека (item_id = NULL). Матчится с point_sale_items.universal_name.';
