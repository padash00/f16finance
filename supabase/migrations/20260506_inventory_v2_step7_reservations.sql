-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 7 рефактора: резервирование вместо мгновенного списания.
--
-- Сейчас: одобрение заявки сразу списывает товар со склада.
-- Если оператор не пришёл за товаром — физически он на складе, но в учёте уже на витрине.
--
-- После: одобрение → +резерв на складе. Физический остаток не меняется.
-- Получение точкой → атомарно -склад -резерв +витрина.
-- Откат одобрения → просто снимает резерв.
-- ─────────────────────────────────────────────────────────────────────────


-- 1. Хелпер: применить дельту к quantity_reserved атомарно с проверкой инварианта
create or replace function public.inventory_apply_reserved_delta(
  p_location_id uuid,
  p_item_id uuid,
  p_delta numeric
)
returns void
language plpgsql
as $$
declare
  v_quantity numeric;
  v_reserved numeric;
  v_next numeric;
begin
  -- Создать строку, если не существует
  insert into public.inventory_balances (location_id, item_id, quantity, quantity_reserved)
  values (p_location_id, p_item_id, 0, 0)
  on conflict (location_id, item_id) do nothing;

  -- Атомарно проверить и обновить
  update public.inventory_balances
  set quantity_reserved = quantity_reserved + p_delta,
      updated_at = timezone('utc', now())
  where location_id = p_location_id
    and item_id = p_item_id
  returning quantity, quantity_reserved into v_quantity, v_reserved;

  if v_reserved is null then
    raise exception 'inventory-balance-row-not-found';
  end if;

  if v_reserved < 0 then
    raise exception 'inventory-reserved-negative';
  end if;

  if v_reserved > v_quantity then
    raise exception 'inventory-reservation-exceeds-stock';
  end if;
end;
$$;


-- 2. inventory_decide_request — теперь резервирует, не списывает
create or replace function public.inventory_decide_request(
  p_request_id uuid,
  p_approved boolean,
  p_decision_comment text,
  p_actor_user_id uuid,
  p_items jsonb default '[]'::jsonb
)
returns table (request_id uuid, status text)
language plpgsql
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_request_item record;
  v_line jsonb;
  v_approved_qty numeric;
  v_status text;
  v_quantity numeric;
  v_reserved numeric;
  v_available numeric;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status <> 'new' and v_request.status <> 'disputed' then
    raise exception 'inventory-request-already-decided';
  end if;

  if not p_approved then
    update public.inventory_request_items iri
    set approved_qty = 0
    where iri.request_id = p_request_id;

    update public.inventory_requests ir
    set status = 'rejected',
        decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
        approved_by = p_actor_user_id,
        approved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where ir.id = p_request_id;

    return query select p_request_id as request_id, 'rejected'::text as status;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'inventory-request-decision-items-required';
  end if;

  for v_request_item in
    select iri.* from public.inventory_request_items iri
    where iri.request_id = p_request_id
    order by iri.id
  loop
    select value into v_line
    from jsonb_array_elements(p_items)
    where value ->> 'request_item_id' = v_request_item.id::text
    limit 1;

    if v_line is null then
      raise exception 'inventory-request-decision-line-missing';
    end if;

    v_approved_qty := coalesce((v_line ->> 'approved_qty')::numeric, 0);

    if v_approved_qty < 0 then
      raise exception 'inventory-request-approved-qty-invalid';
    end if;

    if v_approved_qty > v_request_item.requested_qty then
      raise exception 'inventory-request-approved-qty-exceeds-requested';
    end if;

    update public.inventory_request_items iri
    set approved_qty = v_approved_qty
    where iri.id = v_request_item.id;

    if v_approved_qty > 0 then
      -- Лочим строку баланса источника
      select coalesce(quantity, 0), coalesce(quantity_reserved, 0)
      into v_quantity, v_reserved
      from public.inventory_balances
      where location_id = v_request.source_location_id
        and item_id = v_request_item.item_id
      for update;

      v_available := coalesce(v_quantity, 0) - coalesce(v_reserved, 0);
      if v_available < v_approved_qty then
        raise exception 'inventory-insufficient-stock';
      end if;

      -- v7: резервируем, не списываем
      perform public.inventory_apply_reserved_delta(
        v_request.source_location_id, v_request_item.item_id, v_approved_qty
      );

      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_request_item.item_id, 'reservation',
        v_request.source_location_id, null,
        v_approved_qty,
        'inventory_request', p_request_id,
        nullif(trim(coalesce(p_decision_comment, '')), ''), p_actor_user_id
      );
    end if;
  end loop;

  if exists (
    select 1 from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
      and iri.approved_qty < iri.requested_qty
  ) or exists (
    select 1 from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and iri.requested_qty > 0
      and coalesce(iri.approved_qty, 0) = 0
  ) then
    v_status := 'approved_partial';
  else
    v_status := 'approved_full';
  end if;

  update public.inventory_requests ir
  set status = v_status,
      decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
      approved_by = p_actor_user_id,
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;

  return query select p_request_id as request_id, v_status as status;
end;
$$;


-- 3. inventory_undecide_request — снимает резерв, ничего не возвращает физически
create or replace function public.inventory_undecide_request(
  p_request_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_item record;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status not in ('approved_full', 'approved_partial') then
    raise exception 'inventory-request-not-undecidable';
  end if;

  if v_request.received_by is not null then
    raise exception 'inventory-request-already-received';
  end if;

  for v_item in
    select iri.item_id, coalesce(iri.approved_qty, 0) as approved_qty
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
  loop
    -- v7: снимаем только резерв; физически товар не двигался
    perform public.inventory_apply_reserved_delta(
      v_request.source_location_id, v_item.item_id, -v_item.approved_qty
    );

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item.item_id, 'reservation_release',
      v_request.source_location_id, null,
      v_item.approved_qty,
      'inventory_request_undecide', p_request_id,
      nullif(trim(coalesce(p_reason, '')), ''), p_actor_user_id
    );
  end loop;

  update public.inventory_request_items iri
  set approved_qty = null
  where iri.request_id = p_request_id;

  update public.inventory_requests ir
  set status = 'new',
      decision_comment = nullif(trim(coalesce(p_reason, '')), ''),
      approved_by = null,
      approved_at = null,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$$;


-- 4. inventory_receive_request — новая функция: получение точкой
-- Атомарно: -склад -резерв +витрина. Создаёт movement transfer_warehouse_to_showcase.
create or replace function public.inventory_receive_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_item record;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status not in ('approved_full', 'approved_partial', 'issued') then
    raise exception 'inventory-request-not-receivable';
  end if;

  if v_request.received_by is not null then
    raise exception 'inventory-request-already-received';
  end if;

  for v_item in
    select iri.item_id, coalesce(iri.approved_qty, 0) as approved_qty
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
  loop
    -- Списываем со склада + снимаем резерв (атомарно по строке)
    perform public.inventory_apply_balance_delta(
      v_request.source_location_id, v_item.item_id, -v_item.approved_qty
    );
    perform public.inventory_apply_reserved_delta(
      v_request.source_location_id, v_item.item_id, -v_item.approved_qty
    );
    -- Зачисляем на витрину
    perform public.inventory_apply_balance_delta(
      v_request.target_location_id, v_item.item_id, v_item.approved_qty
    );

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item.item_id, 'transfer_warehouse_to_showcase',
      v_request.source_location_id, v_request.target_location_id,
      v_item.approved_qty,
      'inventory_request_received', p_request_id,
      'Получение заявки точкой', p_actor_user_id
    );
  end loop;

  update public.inventory_requests ir
  set status = 'received',
      received_at = timezone('utc', now()),
      received_by = p_actor_user_id,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$$;


-- 5. Расширить статус requests: добавить 'received' и 'issued'
alter table public.inventory_requests
  drop constraint if exists inventory_requests_status_check;

alter table public.inventory_requests
  add constraint inventory_requests_status_check
  check (status in (
    'new', 'approved_partial', 'approved_full', 'rejected', 'disputed',
    'issued', 'received'
  ));

comment on column public.inventory_balances.quantity_reserved is
  'Резерв (зарезервировано под одобренные, но ещё не полученные заявки). Доступное = quantity - quantity_reserved.';
comment on function public.inventory_apply_reserved_delta is
  'Атомарное изменение quantity_reserved с проверкой инвариантов 0 ≤ reserved ≤ quantity.';
comment on function public.inventory_receive_request is
  'Получение заявки точкой: -склад -резерв +витрина атомарно. Меняет статус на received.';
