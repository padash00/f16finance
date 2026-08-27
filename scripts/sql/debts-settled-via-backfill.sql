-- Проставить способ закрытия уже закрытым долгам.
--
-- Миграция 20260827_debt_settlement_source добавила `debts.settled_via`, но
-- всем закрытым до неё долгам он null — и они, как раньше, из расчёта недели
-- выпадают. Для истории это правильно: пересчитывать декабрь не нужно. А вот
-- недели, которые прямо сейчас висят «Частично» из-за этой дыры, нужно
-- вернуть в норму, и делается это здесь.
--
-- ПОРЯДОК: шаги 1–3 только читают. Ничего не меняют, выполняйте свободно и
-- смотрите, что покажут. Шаги 4 и 5 пишут — запускать после того, как цифры
-- шага 2 и 3 сойдутся с тем, что видно на странице зарплат.
--
-- Что произойдёт после записи: неделя со статусом «Частично» не заморожена и
-- пересчитывается при каждом открытии страницы. Как только долг помечен
-- `salary`, он снова вычитается из суммы к выплате, остаток становится нулём,
-- и неделя сама переходит в «Выплачено». Руками закрывать ничего не нужно.

------------------------------------------------------------------------------
-- ШАГ 1 (чтение). Сколько закрытых долгов вообще без метки.
------------------------------------------------------------------------------
select
  status,
  settled_via,
  count(*)          as строк,
  sum(amount)::text as сумма
from public.debts
group by status, settled_via
order by status, settled_via nulls first;

------------------------------------------------------------------------------
-- ШАГ 2 (чтение). Долги, которые закрыла сама выплата.
--
-- Это те, по которым `closeWeekDebtsIfSettled` оставил запись в журнале —
-- удержание доказано журналом, гадать не нужно. Здесь их не может быть много:
-- автозакрытие живёт с 24.08.2026.
------------------------------------------------------------------------------
with closed_by_payment as (
  select distinct
    (payload ->> 'operator_id')::uuid as operator_id,
    (payload ->> 'week_start')::date  as week_start
  from public.audit_log
  where entity_type = 'debt'
    and action = 'closed-by-payment'
    and payload ->> 'operator_id' is not null
    and payload ->> 'week_start' is not null
)
select
  d.operator_id,
  o.name            as оператор,
  d.week_start      as неделя,
  count(*)          as долгов,
  sum(d.amount)::text as сумма
from public.debts d
join closed_by_payment c
  on c.operator_id = d.operator_id
 and c.week_start = d.week_start
left join public.operators o on o.id = d.operator_id
where d.status = 'paid'
  and d.settled_via is null
group by d.operator_id, o.name, d.week_start
order by d.week_start desc;

------------------------------------------------------------------------------
-- ШАГ 3 (чтение). Недели, которые сломались именно из-за этой дыры.
--
-- Признак строгий: неделя «Частично», выплата была, и незакрытый остаток
-- совпадает с суммой закрытых долгов этой недели до копейки. Совпадение до
-- копейки и означает, что долг из выплаты удержали, а потом он выпал из
-- формулы и всплыл остатком.
--
-- Долги агрегируются по паре «неделя + оператор» ДО соединения с расчётом:
-- иначе sum(amount) умножается на число строк.
------------------------------------------------------------------------------
with paid_debts as (
  select
    operator_id,
    week_start,
    count(*)    as долгов,
    sum(amount) as сумма_долга
  from public.debts
  where status = 'paid'
    and settled_via is null
  group by operator_id, week_start
)
select
  w.operator_id,
  o.name                    as оператор,
  w.week_start              as неделя,
  w.status                  as статус,
  w.net_amount::text        as к_выплате,
  w.paid_amount::text       as выплачено,
  w.remaining_amount::text  as остаток,
  p.долгов,
  p.сумма_долга::text       as закрытый_долг
from public.operator_salary_weeks w
join paid_debts p
  on p.operator_id = w.operator_id
 and p.week_start = w.week_start
left join public.operators o on o.id = w.operator_id
where w.status = 'partial'
  and abs(w.remaining_amount - p.сумма_долга) < 0.01
order by w.week_start desc;

------------------------------------------------------------------------------
-- ШАГ 4 (ЗАПИСЬ). Метка по журналу — то, что закрыла выплата.
------------------------------------------------------------------------------
with closed_by_payment as (
  select distinct
    (payload ->> 'operator_id')::uuid as operator_id,
    (payload ->> 'week_start')::date  as week_start
  from public.audit_log
  where entity_type = 'debt'
    and action = 'closed-by-payment'
    and payload ->> 'operator_id' is not null
    and payload ->> 'week_start' is not null
)
update public.debts d
set settled_via = 'salary'
from closed_by_payment c
where d.operator_id = c.operator_id
  and d.week_start = c.week_start
  and d.status = 'paid'
  and d.settled_via is null;

------------------------------------------------------------------------------
-- ШАГ 5 (ЗАПИСЬ). Метка по совпадению до копейки — недели из шага 3.
--
-- Только они: неделя «Частично» и остаток равен закрытому долгу. Всё
-- остальное не трогаем — там удержания либо не было, либо оно не сошлось, и
-- это разбор руками.
------------------------------------------------------------------------------
with paid_debts as (
  select
    operator_id,
    week_start,
    sum(amount) as сумма_долга
  from public.debts
  where status = 'paid'
    and settled_via is null
  group by operator_id, week_start
),
broken_weeks as (
  select w.operator_id, w.week_start
  from public.operator_salary_weeks w
  join paid_debts p
    on p.operator_id = w.operator_id
   and p.week_start = w.week_start
  where w.status = 'partial'
    and abs(w.remaining_amount - p.сумма_долга) < 0.01
)
update public.debts d
set settled_via = 'salary'
from broken_weeks b
where d.operator_id = b.operator_id
  and d.week_start = b.week_start
  and d.status = 'paid'
  and d.settled_via is null;

------------------------------------------------------------------------------
-- ШАГ 6 (чтение). Проверка: шаг 3 должен теперь вернуть пусто, а недели —
-- перейти в «Выплачено» после открытия страницы зарплат.
------------------------------------------------------------------------------
select
  settled_via,
  count(*)          as строк,
  sum(amount)::text as сумма
from public.debts
where status = 'paid'
group by settled_via
order by settled_via nulls first;
