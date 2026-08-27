-- Закрыть или уменьшить долг админ-сотрудника прямо в базе.
--
-- ГЛАВНОЕ, ЧТО НУЖНО ЗНАТЬ: карточка сотрудника на /salary не читает таблицу
-- `debts`. Долг там — это живые позиции сканера `point_debt_items` со статусом
-- 'active', взятые после последней выплаты (staff-salary/route.ts:449).
-- Строка «Долги из операторской программы» синтетическая, в базе её нет.
--
-- Поэтому:
--   point_debt_items — источник истины, менять надо здесь;
--   debts            — зеркало: amount = сумма живых позиций группы
--                      (company_id + week_start + должник), 0 → status 'paid'.
--
-- Править только зеркало бесполезно: карточка его не смотрит, а следующий
-- пересчёт всё равно перепишет его от позиций.
--
-- Должник в позиции задаётся ОДНИМ из двух способов:
--   operator_id — если долг записан на оператора-админсостава;
--   client_name — если operator_id пуст (сканер часто пишет только имя).
-- Ниже это учтено везде.

------------------------------------------------------------------------------
-- ШАГ 1 (чтение). Из чего складывается сумма в карточке.
--
-- Подставьте имя. Сумма по столбцу total_amount должна совпасть с тем, что
-- показывает карточка (в примере — 55 400).
------------------------------------------------------------------------------
select
  i.id,
  i.created_at,
  i.client_name,
  i.operator_id,
  i.item_name,
  i.quantity,
  i.unit_price,
  i.total_amount,
  i.week_start,
  i.company_id,
  c.name as точка
from public.point_debt_items i
left join public.companies c on c.id = i.company_id
where i.status = 'active'
  and (
    i.client_name ilike '%олжас%'
    or i.client_name ilike '%olzhas%'
    or i.operator_id in (select id from public.operators where name ilike '%олжас%')
  )
order by i.created_at desc;

-- Контрольная сумма тем же фильтром:
select count(*) as позиций, sum(total_amount)::text as сумма
from public.point_debt_items i
where i.status = 'active'
  and (
    i.client_name ilike '%олжас%'
    or i.client_name ilike '%olzhas%'
    or i.operator_id in (select id from public.operators where name ilike '%олжас%')
  );

------------------------------------------------------------------------------
-- ШАГ 2А (ЗАПИСЬ). Закрыть долг целиком.
--
-- Статус 'deleted' — это штатное «убрано со сканера», так делает и кнопка.
-- Строки НЕ удалять: инвентарь при закрытии не возвращается (товар взят),
-- а история должна остаться.
--
-- Впишите id из шага 1.
------------------------------------------------------------------------------
update public.point_debt_items
set status = 'deleted',
    deleted_at = now()
where id in (
  '00000000-0000-0000-0000-000000000000'  -- ← id из шага 1
);

------------------------------------------------------------------------------
-- ШАГ 2Б (ЗАПИСЬ). Уменьшить сумму вместо полного закрытия.
--
-- Карточка суммирует именно total_amount, поэтому меняем его. quantity и
-- unit_price останутся прежними — если хотите, чтобы строка читалась честно,
-- правьте и их.
------------------------------------------------------------------------------
update public.point_debt_items
set total_amount = 30000  -- ← новая сумма позиции
where id = '00000000-0000-0000-0000-000000000000';

------------------------------------------------------------------------------
-- ШАГ 3 (ЗАПИСЬ). ОБЯЗАТЕЛЬНО после 2А или 2Б: пересчитать зеркало `debts`.
--
-- Ровно то же, что делает `recomputeDebtMirrors` в коде: amount = сумма живых
-- позиций группы, ноль → 'paid'. Без этого PDF «Долги с точки» и страница
-- «Долги точки» продолжат показывать уже закрытые деньги.
--
-- Впишите ТЕ ЖЕ id, что и в шаге 2.
------------------------------------------------------------------------------
with touched as (
  select distinct company_id, week_start, operator_id, client_name
  from public.point_debt_items
  where id in (
    '00000000-0000-0000-0000-000000000000'  -- ← те же id, что в шаге 2
  )
),
sums as (
  select
    t.company_id,
    t.week_start,
    t.operator_id,
    t.client_name,
    coalesce((
      select sum(i.total_amount)
      from public.point_debt_items i
      where i.status = 'active'
        and i.company_id = t.company_id
        and i.week_start = t.week_start
        and (
          (t.operator_id is not null and i.operator_id = t.operator_id)
          or (t.operator_id is null and i.operator_id is null and i.client_name = t.client_name)
        )
    ), 0) as remaining
  from touched t
)
update public.debts d
set amount  = s.remaining,
    status  = case when s.remaining > 0 then 'active' else 'paid' end,
    paid_at = case when s.remaining > 0 then null else now() end
from sums s
where d.company_id = s.company_id
  and d.week_start = s.week_start
  and (
    (s.operator_id is not null and d.operator_id = s.operator_id)
    or (s.operator_id is null and d.operator_id is null and d.client_name = s.client_name)
  );

------------------------------------------------------------------------------
-- ШАГ 4 (чтение). Проверка: позиций не осталось, зеркало сошлось.
------------------------------------------------------------------------------
select
  d.id,
  d.client_name,
  d.operator_id,
  d.week_start,
  d.amount::text as зеркало,
  d.status,
  d.settled_via,
  coalesce((
    select sum(i.total_amount)
    from public.point_debt_items i
    where i.status = 'active'
      and i.company_id = d.company_id
      and i.week_start = d.week_start
      and (
        (d.operator_id is not null and i.operator_id = d.operator_id)
        or (d.operator_id is null and i.operator_id is null and i.client_name = d.client_name)
      )
  ), 0)::text as живые_позиции
from public.debts d
where d.client_name ilike '%олжас%'
   or d.operator_id in (select id from public.operators where name ilike '%олжас%')
order by d.week_start desc;
-- «зеркало» и «живые_позиции» должны совпасть. Если зеркало 0 — статус 'paid'.
