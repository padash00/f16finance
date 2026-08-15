-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: история цен для нормализации сравнений.
-- ─────────────────────────────────────────────────────────────────────────
-- Проблема, которую это чинит: после повышения цен средний чек растёт сам по
-- себе. Без поправки модель прочитает это как «все продавцы разом стали
-- работать лучше», а через месяц — как провал, если цены откатят назад.
--
-- Отдельной таблицы истории цен заводить не нужно: она уже есть. В
-- `point_sale_items.unit_price` записана цена ровно на момент продажи, то
-- есть фактическая история по каждой позиции. Отсюда и считается индекс.
--
-- Функция отдаёт помесячную среднюю цену и количество по каждому товару.
-- Сам индекс собирается в коде: там видно, какие позиции попали в корзину и
-- какую долю выручки она покрывает.
--
-- Средняя цена взвешена по количеству: две продажи по 500 и одна по 1000
-- дают 667, а не 750 — иначе редкая крупная продажа перекашивала бы месяц.

create or replace function public.store_kpi_price_history(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  month text,
  item_id uuid,
  avg_price numeric,
  quantity numeric,
  revenue numeric
)
language sql
stable
as $$
  with voided as (
    select id from public.point_shifts
     where company_id = p_company_id and status = 'voided'
  )
  select to_char(s.sale_date, 'YYYY-MM') as month,
         pi.item_id,
         -- Взвешивание по количеству: цена позиции, а не среднее по чекам.
         case when sum(pi.quantity) > 0
              then sum(pi.total_price) / sum(pi.quantity)
              else null
         end as avg_price,
         sum(pi.quantity) as quantity,
         sum(pi.total_price) as revenue
    from public.point_sales s
    join public.point_sale_items pi on pi.sale_id = s.id
   where s.company_id = p_company_id
     and s.sale_date between p_from and p_to
     and pi.quantity > 0
     and (s.shift_id is null or s.shift_id not in (select id from voided))
   group by 1, 2
  having sum(pi.quantity) > 0
   order by 1, 2;
$$;
