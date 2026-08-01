-- Серия расходов: один платёж, разнесённый на несколько периодов.
-- Пример: налог заплатили одним платежом за полгода — создаём 6 записей
-- (по одной на месяц), связанных общим series_id. Это позволяет:
--   * видеть налог в том месяце, к которому он относится (помесячный P&L честный);
--   * удалить/поправить всю серию целиком, а не искать 6 строк руками.
--
-- series_index — порядковый номер периода внутри серии (0..N-1), нужен для
-- стабильной сортировки и понятного отображения «3 из 6».

alter table public.expenses
  add column if not exists series_id uuid null,
  add column if not exists series_index smallint null;

create index if not exists expenses_series_id_idx
  on public.expenses (series_id)
  where series_id is not null;
