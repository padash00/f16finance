-- Вероятностный движок sales-kpi — аудит данных ПЕРЕД реализацией.
--
-- Зачем: шесть моделей из задания (Negative Binomial, Beta/Binomial, Lognormal,
-- Monte Carlo, Markov, Weibull) имеют разные требования к данным. Строить их
-- «потому что они существуют» — способ получить красивые формулы поверх
-- данных, которые их не выдерживают. Каждый блок ниже отвечает на один
-- вопрос: применима ли модель на РЕАЛЬНЫХ цифрах, а не в теории.
--
-- Как запускать: Supabase SQL Editor, блоки по одному, вывод — в чат.
-- Период правится в первой строке каждого блока.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ОБЪЁМ. Сколько вообще истории и по каким точкам.
--
-- Читать так: Negative Binomial на сегмент нужно хотя бы ~20–30 смен, иначе
-- параметры оценятся хуже, чем нынешние перцентили. Смотрим не на общее
-- число чеков, а на число СМЕН — обучаемся мы на них.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                    as точка,
       count(distinct (s.sale_date, s.shift))    as смен_с_продажами,
       count(*)                                  as чеков,
       min(s.sale_date)                          as с,
       max(s.sale_date)                          as по,
       round(count(*)::numeric / nullif(count(distinct (s.sale_date, s.shift)), 0), 1) as чеков_в_смену
  from public.point_sales s
  join public.companies c on c.id = s.company_id
 where s.sale_date >= '2026-01-01'
 group by c.name
 order by чеков desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ГЛАВНЫЙ ТЕСТ ДЛЯ NEGATIVE BINOMIAL: сверхдисперсия.
--
-- Пуассон предполагает variance = mean. Negative Binomial нужен только когда
-- variance заметно больше mean. Если отношение около 1 — NB не даст ничего
-- сверх Пуассона, и городить его незачем.
--
-- Читать так: колонка var_к_mean. ~1.0 → Пуассон. 1.5–5 → NB оправдан.
-- Больше 10 → сегмент слишком разнородный, надо резать иначе.
-- ─────────────────────────────────────────────────────────────────────────────
with shifts as (
  select s.company_id,
         s.sale_date,
         s.shift,
         extract(isodow from s.sale_date)::int as dow,
         case when extract(month from s.sale_date) in (6, 7, 8) then 'лето' else 'не лето' end as сезон,
         count(*) as receipts
    from public.point_sales s
   where s.sale_date >= '2026-01-01'
   group by s.company_id, s.sale_date, s.shift
)
select c.name                          as точка,
       сезон,
       dow                             as день_недели,
       shift                           as смена,
       count(*)                        as наблюдений,
       round(avg(receipts), 1)         as среднее_чеков,
       round(var_samp(receipts), 1)    as дисперсия,
       round(var_samp(receipts) / nullif(avg(receipts), 0), 2) as var_к_mean
  from shifts
  join public.companies c on c.id = shifts.company_id
 group by c.name, сезон, dow, shift
having count(*) >= 5
 order by точка, сезон, dow, смена;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LOGNORMAL: как на самом деле распределены суммы чеков.
--
-- Логнормальное распределение — одногорбое и правоскошенное. В магазине при
-- клубе часто иначе: горб на напитке за 500 и второй на рамене за 2500. Тогда
-- логнормаль соврёт в обе стороны, а честнее будет бутстрап реальных чеков.
--
-- Читать так: если median и exp(avg(ln)) близки, а p90/p50 в районе 2–3 —
-- логнормаль правдоподобна. Если гистограмма ниже двугорбая — не применять.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name as точка,
       count(*) as чеков,
       round(min(s.total_amount))                                                          as мин,
       round(percentile_cont(0.10) within group (order by s.total_amount)::numeric)        as p10,
       round(percentile_cont(0.50) within group (order by s.total_amount)::numeric)        as медиана,
       round(percentile_cont(0.90) within group (order by s.total_amount)::numeric)        as p90,
       round(max(s.total_amount))                                                          as макс,
       round(avg(s.total_amount))                                                          as среднее,
       -- Геометрическое среднее. Если оно близко к медиане — логнормаль ложится.
       round(exp(avg(ln(nullif(s.total_amount, 0))))::numeric)                             as геом_среднее
  from public.point_sales s
  join public.companies c on c.id = s.company_id
 where s.sale_date >= '2026-01-01'
   and s.total_amount > 0
 group by c.name;

-- Гистограмма сумм чека: ищем второй горб.
select width_bucket(s.total_amount, 0, 5000, 20) * 250 as корзина_тенге,
       count(*)                                        as чеков
  from public.point_sales s
 where s.sale_date >= '2026-01-01'
   and s.total_amount between 0 and 5000
 group by 1
 order by 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BETA/BINOMIAL: годятся ли attach-данные как испытания Бернулли.
--
-- Модель требует: «попытка» — одна, независимая, и успех у неё либо есть,
-- либо нет. А в RPC store_kpi_shift_facts opportunities — это СУММА ВЕСОВ всех
-- сработавших правил на чек. Один чек может дать 3 попытки, а вес бывает не
-- единицей. Тогда «7 из 10» перестаёт быть биномиальным, и доверительный
-- интервал получится уже, чем на самом деле — то есть мы будем увереннее, чем
-- имеем право.
--
-- Читать так: если правил с весом ≠ 1 нет и почти все чеки дают ровно одну
-- попытку — Beta/Binomial применим как есть. Иначе нужно считать попытки
-- по чекам (есть исходная категория / нет), а веса оставить только для score.
-- ─────────────────────────────────────────────────────────────────────────────
select weight as вес_правила, count(*) as правил
  from public.store_kpi_cross_sell_rules
 where active
 group by weight
 order by weight;

with sale_cats as (
  select s.id,
         s.company_id,
         array_remove(array_agg(distinct ii.category_id), null) as cats,
         array_remove(array_agg(distinct pi.item_id), null)     as item_ids
    from public.point_sales s
    left join public.point_sale_items pi on pi.sale_id = s.id
    left join public.inventory_items ii on ii.id = pi.item_id
   where s.sale_date >= '2026-01-01'
   group by s.id, s.company_id
),
hits as (
  select sc.id, count(*) as правил_сработало
    from sale_cats sc
    join public.store_kpi_cross_sell_rules r
      on r.company_id = sc.company_id
     and r.active
     and ((r.source_kind = 'category' and r.source_ref = any(sc.cats))
       or (r.source_kind = 'item'     and r.source_ref = any(sc.item_ids)))
   group by sc.id
)
select правил_сработало, count(*) as чеков
  from hits
 group by правил_сработало
 order by правил_сработало;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MARKOV: есть ли вообще узнаваемый клиент.
--
-- Цепь Маркова по состояниям клиента (новый → вернувшийся → постоянный →
-- спящий) требует, чтобы покупки одного человека связывались во времени. Поле
-- customer_id в чеке есть. Вопрос в том, заполняется ли оно — в магазине люди
-- редко называют себя ради воды.
--
-- Читать так: если доля чеков с клиентом ниже ~20% или у большинства клиентов
-- один-единственный визит, переходы считать не на чем. Тогда честный ответ —
-- не строить Маркова, а не строить его на 3% данных и выдать за поведение всех.
-- ─────────────────────────────────────────────────────────────────────────────
select count(*)                                                          as чеков,
       count(s.customer_id)                                              as с_клиентом,
       round(100.0 * count(s.customer_id) / nullif(count(*), 0), 1)       as доля_процентов,
       count(distinct s.customer_id)                                     as уникальных_клиентов
  from public.point_sales s
 where s.sale_date >= '2026-01-01';

-- Сколько раз возвращается тот, кого мы узнали.
select визитов, count(*) as клиентов
  from (
    select customer_id, count(*) as визитов
      from public.point_sales
     where sale_date >= '2026-01-01'
       and customer_id is not null
     group by customer_id
  ) t
 group by визитов
 order by визитов;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ДЛИТЕЛЬНОСТЬ СМЕНЫ (экспозиция для модели спроса).
--
-- Двенадцатичасовую смену и смену на четыре часа нельзя сравнивать как равные:
-- в короткой чеков меньше не потому, что поток слабый, а потому, что она
-- короче. Если разброс длительностей большой — в модель нужна экспозиция.
--
-- Читать так: если почти все смены по 11–13 часов, экспозицию можно не
-- вводить и не усложнять. Если есть заметный хвост коротких — вводить.
-- ─────────────────────────────────────────────────────────────────────────────
select round(extract(epoch from (closed_at - opened_at)) / 3600.0) as часов,
       count(*)                                                    as смен
  from public.point_shifts
 where closed_at is not null
   and opened_at >= '2026-01-01'
 group by 1
 order by 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. WEIBULL: есть ли жизненный цикл оборудования.
--
-- Для надёжности нужны ЭКЗЕМПЛЯРЫ (эта мышь, купленная тогда-то, сломалась
-- тогда-то), а не справочник моделей. Запрос ниже показывает, что в базе
-- сейчас лежит: строки вида «Logitech G102» без единиц, дат установки и
-- отказов. На таком Weibull не считается никак.
-- ─────────────────────────────────────────────────────────────────────────────
select kind as тип, count(*) as моделей_в_справочнике
  from public.hardware_catalog
 group by kind
 order by kind;
