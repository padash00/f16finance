-- ─────────────────────────────────────────────────────────────────────────
-- Архив ревизий: убрать акт из списка, не стирая его.
-- ─────────────────────────────────────────────────────────────────────────
-- Удалять ревизию нельзя, и вот почему. Проведённая ревизия — это не запись в
-- журнале, а причина, по которой изменились остатки: RPC inventory_post_stocktake
-- пишет движения и правит inventory_balances. Удалив акт, мы оставим движения
-- без основания: товар списан, а почему — уже не узнать. Через полгода такой
-- остаток невозможно объяснить ни себе, ни налоговой.
--
-- Поэтому здесь именно архив: акт остаётся в базе со всеми строками, но
-- пропадает из списка. Видит его только суперадминистратор — и только когда
-- сам включит показ архива.
--
-- Кто и когда убрал, записываем рядом: архив без имени превращается в способ
-- незаметно прятать неудобные цифры.

alter table public.inventory_stocktakes
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null,
  add column if not exists archive_reason text null;

-- Обычный запрос к списку — «дай неархивные». Частичный индекс тут дешевле
-- обычного: архивных строк единицы, а живых — все остальные.
create index if not exists inventory_stocktakes_active_idx
  on public.inventory_stocktakes (created_at desc)
  where archived_at is null;

comment on column public.inventory_stocktakes.archived_at is
  'Убран из списка ревизий. Данные и движения по акту остаются нетронутыми.';
comment on column public.inventory_stocktakes.archived_by is
  'Кто убрал акт в архив (auth.users.id).';
comment on column public.inventory_stocktakes.archive_reason is
  'Зачем убрали. Необязательно, но помогает вспомнить через год.';
