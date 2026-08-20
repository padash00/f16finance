-- Сводка продаж для «Обзора» — одним запросом вместо выгрузки всех чеков.
--
-- Экран сводки складывал суммы в приложении: сервер выкачивал каждую строку
-- продажи за день, за вчера, за неделю и за месяц — постранично по тысяче, —
-- и только потом складывал. На точке с сотней чеков в день это тысячи строк по
-- сети ради четырёх чисел, и «Обзор» открывался секундами.
--
-- Складывать умеет база. Функция возвращает готовые числа: день с разбивкой по
-- способам оплаты, вчера, неделю по дням и месяц.

create or replace function public.dashboard_sales_summary(
  p_company_ids uuid[],
  p_today date,
  p_yesterday date,
  p_week_start date,
  p_month_start date
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select *
    from public.point_sales
    where sale_date >= least(p_month_start, p_week_start, p_yesterday)
      and sale_date <= p_today
      -- Пустой массив означает «все точки»: так зовут суперадмин и
      -- одноарендная установка. Список — фильтр по своим точкам.
      and (p_company_ids is null or cardinality(p_company_ids) = 0 or company_id = any(p_company_ids))
  )
  select jsonb_build_object(
    'today', (
      select jsonb_build_object(
        'total', coalesce(sum(total_amount), 0),
        'cash', coalesce(sum(cash_amount), 0),
        'kaspi', coalesce(sum(kaspi_amount), 0),
        'card', coalesce(sum(card_amount), 0),
        'online', coalesce(sum(online_amount), 0),
        'count', count(*)
      )
      from scoped where sale_date = p_today
    ),
    'yesterday', (
      select coalesce(sum(total_amount), 0) from scoped where sale_date = p_yesterday
    ),
    'month', (
      select coalesce(sum(total_amount), 0) from scoped where sale_date >= p_month_start
    ),
    'week', (
      select coalesce(jsonb_agg(row order by row->>'date'), '[]'::jsonb)
      from (
        select jsonb_build_object('date', sale_date::text, 'total', coalesce(sum(total_amount), 0)) as row
        from scoped
        where sale_date >= p_week_start and sale_date <= p_today
        group by sale_date
      ) days
    )
  );
$$;

comment on function public.dashboard_sales_summary is
  'Суммы продаж для «Обзора»: день, вчера, неделя по дням, месяц. Считает база, а не приложение.';

-- Индекс под этот запрос — по точке и диапазону дат — уже есть:
-- `idx_point_sales_company_sale_date` из 20260629_perf_indexes.sql.
--
-- Здесь стоял `create index if not exists idx_point_sales_company_date`, и он
-- молча ничего не делал: имя было занято другим индексом — по created_at, из
-- 20260417_performance_indexes.sql. `if not exists` сверяет имя, а не смысл,
-- поэтому «индекс уже есть» и «индекс есть, но не тот» выглядят одинаково.
