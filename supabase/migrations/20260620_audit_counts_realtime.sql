-- Realtime для подсчётов ревизии: оператор сразу видит позиции, посчитанные другим
-- кассиром (страница app/operator/audit подписывается на postgres_changes по act_id).
-- Без этого срабатывает только страховочный опрос раз в 15с.

-- 1) Таблица в публикации supabase_realtime (идемпотентно).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_audit_counts'
  ) then
    alter publication supabase_realtime add table public.inventory_audit_counts;
  end if;
end $$;

-- 2) REPLICA IDENTITY FULL — чтобы UPDATE/DELETE несли act_id для серверного фильтра
--    realtime (filter: act_id=eq.<...>). На INSERT не влияет, но нужно для полноты.
alter table public.inventory_audit_counts replica identity full;
