-- ─────────────────────────────────────────────────────────────────────────
-- Фикс: совмещаем v7 модель (резервирование) с возможностью одобрять больше
-- запрошенного. Раньше эти два изменения шли отдельными миграциями и
-- конфликтовали — последняя применённая перетирала функцию полностью.
--
-- 1. inventory_decide_request: v7 поведение (резерв вместо списания) БЕЗ
--    проверки `approved_qty > requested_qty` — менеджер может одобрить
--    больше чем просили (типичный кейс: оператор ошибся вниз).
--
-- 2. inventory_receive_request: идемпотентен к смешанной модели — если
--    резерва нет (значит товар уже физически списан старой функцией),
--    просто меняет статус заявки и не дёргает балансы повторно.
--    Это спасает зависшие заявки которые были одобрены до этой миграции.
-- ─────────────────────────────────────────────────────────────────────────


-- 1. inventory_decide_request — v7 + overapproval
create or replace function public.inventory_decide_request(
  p_request_id uuid,
  p_approved boolean,
  p_decision_comment text,
  p_actor_user_id uuid,
  p_items jsonb default '[]'::jsonb
)
returns table (request_id uuid, status text)
language plpgsql
as $fn_decide$
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

    -- Верхняя граница убрана: менеджер может одобрить больше, чем запросили.

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

      -- v7: резервируем (физически не списываем — это произойдёт при получении)
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
      and iri.requested_qty > 0
      and coalesce(iri.approved_qty, 0) < iri.requested_qty
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
$fn_decide$;


-- 2. inventory_receive_request — идемпотентен к смешанной модели
create or replace function public.inventory_receive_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $fn_receive$
declare
  v_request public.inventory_requests%rowtype;
  v_item record;
  v_quantity numeric;
  v_reserved numeric;
  v_skip_balance_move boolean;
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
    -- Проверяем есть ли реальный резерв на эту позицию.
    -- Если есть (v7 модель) — двигаем балансы. Если нет (заявка одобрена
    -- старой функцией, которая списала сразу) — только меняем статус.
    select coalesce(quantity, 0), coalesce(quantity_reserved, 0)
    into v_quantity, v_reserved
    from public.inventory_balances
    where location_id = v_request.source_location_id
      and item_id = v_item.item_id
    for update;

    v_skip_balance_move := coalesce(v_reserved, 0) < v_item.approved_qty;

    if not v_skip_balance_move then
      -- Стандартный v7 путь: -склад -резерв +витрина
      perform public.inventory_apply_balance_delta(
        v_request.source_location_id, v_item.item_id, -v_item.approved_qty
      );
      perform public.inventory_apply_reserved_delta(
        v_request.source_location_id, v_item.item_id, -v_item.approved_qty
      );
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
    else
      -- Совместимость: заявка одобрена старой функцией (без резерва).
      -- Товар уже на витрине, балансы не трогаем — только статус.
      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item.item_id, 'transfer_warehouse_to_showcase',
        v_request.source_location_id, v_request.target_location_id,
        v_item.approved_qty,
        'inventory_request_received', p_request_id,
        'Получение заявки (legacy: товар был списан при одобрении)', p_actor_user_id
      );
    end if;
  end loop;

  update public.inventory_requests ir
  set status = 'received',
      received_at = timezone('utc', now()),
      received_by = p_actor_user_id,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$fn_receive$;


comment on function public.inventory_decide_request is
  'v7 + overapproval: резервирует (не списывает) и допускает одобрение больше запрошенного.';
comment on function public.inventory_receive_request is
  'v7 + legacy-safe: переносит со склада на витрину если есть резерв, иначе (старая модель) только меняет статус.';
