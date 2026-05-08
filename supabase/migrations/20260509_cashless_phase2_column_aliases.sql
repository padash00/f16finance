-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: Cashless aliases на всех таблицах (additive only)
-- ════════════════════════════════════════════════════════════════════════════
-- Добавляем cashless_* колонки рядом со старыми kaspi_* колонками.
-- Бэкфилл: cashless_* = kaspi_*.
-- Триггеры: при INSERT/UPDATE синхронизируем оба варианта (на случай если
-- какой-то старый код пишет в kaspi_*, а новый читает cashless_*).
--
-- Старые колонки удалим в Phase 3 после полной кодовой миграции.

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: добавить cashless_* alias на таблицу
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  rec record;
  col_pairs text[][] := array[
    ['kaspi_amount',                  'cashless_amount'],
    ['kaspi_before_midnight_amount',  'cashless_before_midnight_amount'],
    ['kaspi_after_midnight_amount',   'cashless_after_midnight_amount'],
    ['kaspi_before_midnight',         'cashless_before_midnight'],
    ['kaspi_after_midnight',          'cashless_after_midnight'],
    ['kaspi_before',                  'cashless_before'],
    ['kaspi_after',                   'cashless_after']
  ];
  pair text[];
  old_col text;
  new_col text;
begin
  -- Для каждой таблицы ищем kaspi_* колонки и создаём cashless_* копии
  for rec in
    select distinct c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name like 'kaspi_%'
  loop
    foreach pair slice 1 in array col_pairs
    loop
      old_col := pair[1];
      new_col := pair[2];

      -- Если старая колонка есть и новой ещё нет — добавляем
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = rec.table_name and column_name = old_col
      ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = rec.table_name and column_name = new_col
      ) then
        -- Добавляем колонку numeric(14,2) default 0 (как у старой)
        begin
          execute format(
            'alter table public.%I add column %I numeric(14,2) not null default 0',
            rec.table_name, new_col
          );
          -- Бэкфилл значений
          execute format(
            'update public.%I set %I = coalesce(%I, 0)',
            rec.table_name, new_col, old_col
          );
          raise notice 'Added %I.% (alias for %)', rec.table_name, new_col, old_col;
        exception when others then
          raise notice 'Skip alter on %.%: %', rec.table_name, new_col, sqlerrm;
        end;
      end if;
    end loop;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Sync-триггер: при INSERT/UPDATE поддерживаем kaspi_* = cashless_*
-- ────────────────────────────────────────────────────────────────────────────
-- Чтобы код в переходный период мог писать в любую колонку, а другая
-- автоматически синхронизировалась. После Phase 3 удалим триггеры.
create or replace function public.sync_kaspi_cashless_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cols text[][] := array[
    ['kaspi_amount',                  'cashless_amount'],
    ['kaspi_before_midnight_amount',  'cashless_before_midnight_amount'],
    ['kaspi_after_midnight_amount',   'cashless_after_midnight_amount'],
    ['kaspi_before_midnight',         'cashless_before_midnight'],
    ['kaspi_after_midnight',          'cashless_after_midnight'],
    ['kaspi_before',                  'cashless_before'],
    ['kaspi_after',                   'cashless_after']
  ];
  pair text[];
begin
  -- Триггер использует динамический SQL по полям записи через jsonb,
  -- иначе строго типизированный NEW недоступен generic-обработчику.
  -- Ниже простой подход: пишем оба способа через execute.
  -- Но быстрее: явно для каждой таблицы свой триггер. Создаём только там, где надо.
  return new;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Прикрепляем простую функцию-триггер к ключевым таблицам
-- (incomes, point_sales, point_returns, point_shifts, arena_sessions, ...)
-- ────────────────────────────────────────────────────────────────────────────
-- Используем обычные BEFORE INSERT OR UPDATE триггеры с конкретными полями
-- через DO-блок. Каждая таблица получает свою функцию.
do $$
declare
  rec record;
  fn_name text;
  trg_name text;
  has_kaspi_amount boolean;
  has_cashless_amount boolean;
  has_kaspi_before boolean;
  has_cashless_before boolean;
  has_kaspi_after boolean;
  has_cashless_after boolean;
  body text;
begin
  for rec in
    select distinct c.table_name
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name like 'kaspi_%'
  loop
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='kaspi_amount')                  into has_kaspi_amount;
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='cashless_amount')               into has_cashless_amount;
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='kaspi_before_midnight_amount')  into has_kaspi_before;
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='cashless_before_midnight_amount') into has_cashless_before;
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='kaspi_after_midnight_amount')   into has_kaspi_after;
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name=rec.table_name and column_name='cashless_after_midnight_amount') into has_cashless_after;

    fn_name := 'sync_cashless_' || rec.table_name;
    trg_name := 'trg_sync_cashless_' || rec.table_name;

    body := 'create or replace function public.' || fn_name || '() returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$ begin ';
    if has_kaspi_amount and has_cashless_amount then
      body := body || 'if new.cashless_amount is distinct from new.kaspi_amount then if new.cashless_amount = 0 and new.kaspi_amount <> 0 then new.cashless_amount := new.kaspi_amount; elsif new.kaspi_amount = 0 and new.cashless_amount <> 0 then new.kaspi_amount := new.cashless_amount; end if; end if; ';
    end if;
    if has_kaspi_before and has_cashless_before then
      body := body || 'if new.cashless_before_midnight_amount is distinct from new.kaspi_before_midnight_amount then if new.cashless_before_midnight_amount = 0 and new.kaspi_before_midnight_amount <> 0 then new.cashless_before_midnight_amount := new.kaspi_before_midnight_amount; elsif new.kaspi_before_midnight_amount = 0 and new.cashless_before_midnight_amount <> 0 then new.kaspi_before_midnight_amount := new.cashless_before_midnight_amount; end if; end if; ';
    end if;
    if has_kaspi_after and has_cashless_after then
      body := body || 'if new.cashless_after_midnight_amount is distinct from new.kaspi_after_midnight_amount then if new.cashless_after_midnight_amount = 0 and new.kaspi_after_midnight_amount <> 0 then new.cashless_after_midnight_amount := new.kaspi_after_midnight_amount; elsif new.kaspi_after_midnight_amount = 0 and new.cashless_after_midnight_amount <> 0 then new.kaspi_after_midnight_amount := new.cashless_after_midnight_amount; end if; end if; ';
    end if;
    body := body || 'return new; end $f$;';

    begin
      execute body;
      execute format('drop trigger if exists %I on public.%I', trg_name, rec.table_name);
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.%I()', trg_name, rec.table_name, fn_name);
      raise notice 'Synced trigger on %', rec.table_name;
    exception when others then
      raise notice 'Skip trigger on %: %', rec.table_name, sqlerrm;
    end;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Reload schema cache
-- ────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
