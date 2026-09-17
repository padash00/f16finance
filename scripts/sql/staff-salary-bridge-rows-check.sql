-- Строки «Переплата по выплате» и «Остаток по выплате», чья сумма разошлась
-- со своим же комментарием.
--
-- ТОЛЬКО ЧТЕНИЕ. Запускать после миграции 20260917_disable_staff_salary_ledger_triggers.
--
-- Откуда расхождение: сумму такой строки пишет ведомость при выплате, и тот же
-- расчёт она кладёт в комментарий («выдано X ₸, по расчёту Y ₸»). Расчётный
-- регистр, пока его триггеры работали, переписывал сумму по своим правилам —
-- комментарий при этом оставался прежним. Поэтому комментарий = то, что
-- насчитала ведомость, а amount мог стать другим.
--
--   переплата (advance) = выдано − по расчёту
--   остаток   (bonus)   = по расчёту − выдано
--
-- diff ≠ 0 — строку переписал регистр. Исправлять точечно, по id, после проверки.

with bridge as (
  select
    a.id,
    a.staff_id,
    a.kind,
    a.amount,
    a.status,
    a.date,
    a.comment,
    nullif(regexp_replace(substring(a.comment from 'выдано ([0-9[:space:] ]+) ₸'), '[^0-9]', '', 'g'), '')::int as paid,
    nullif(regexp_replace(substring(a.comment from 'по расч[её]ту ([0-9[:space:] ]+) ₸'), '[^0-9]', '', 'g'), '')::int as calculated
  from public.staff_adjustments a
  where a.source_payment_id is not null
    and (a.comment like 'Переплата по выплате %' or a.comment like 'Остаток по выплате %')
)
select
  s.full_name as сотрудник,
  b.id,
  b.kind,
  b.status,
  b.date,
  b.amount as сейчас,
  case when b.kind = 'advance' then b.paid - b.calculated else b.calculated - b.paid end as по_комментарию,
  b.amount - (case when b.kind = 'advance' then b.paid - b.calculated else b.calculated - b.paid end) as diff,
  b.comment
from bridge b
left join public.staff s on s.id = b.staff_id
order by (b.amount - (case when b.kind = 'advance' then b.paid - b.calculated else b.calculated - b.paid end)) <> 0 desc,
         b.date desc;
