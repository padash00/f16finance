-- =============================================================================
-- Fix: function_search_path_mutable
-- Все функции в public schema без фиксированного search_path получают
-- set search_path = public. Это предотвращает search_path injection атаки.
-- =============================================================================

do $$
declare
  func_record record;
begin
  for func_record in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')  -- functions and procedures
      and not exists (
        select 1
        from pg_options_to_table(coalesce(p.proconfig, array[]::text[]))
        where option_name = 'search_path'
      )
  loop
    begin
      execute format(
        'alter function public.%I(%s) set search_path = public',
        func_record.proname,
        func_record.args
      );
    exception when others then
      -- Пропускаем функции которые не удалось изменить (например встроенные)
      raise notice 'Skipped: %.%(%): %',
        'public', func_record.proname, func_record.args, sqlerrm;
    end;
  end loop;
end $$;
