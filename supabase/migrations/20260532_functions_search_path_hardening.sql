-- Хардненинг: фиксируем search_path у функций (Supabase linter
-- function_search_path_mutable). Без зафиксированного search_path функция
-- уязвима к подмене схемы вызывающим. SET search_path = public, pg_temp
-- поведение не меняет — только закрывает эту дыру.
--
-- Идём по pg_proc и альтерим каждую функцию с её реальной сигнатурой,
-- чтобы не угадывать аргументы перегруженных функций.

do $$
declare
  fn record;
begin
  for fn in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'point_receipt_settings_touch',
        'inventory_create_point_sale',
        'inventory_create_point_return',
        'inventory_post_stocktake',
        'incidents_create',
        'point_shift_open',
        'point_shift_close',
        'point_shift_handover',
        'inventory_undecide_request',
        'inventory_create_pos_sale',
        'inventory_decide_request',
        'inventory_cancel_receipt',
        'inventory_receive_request',
        'inventory_create_point_debt',
        'inventory_cancel_writeoff',
        'inventory_post_receipt'
      )
  loop
    execute format(
      'alter function public.%I(%s) set search_path = public, pg_temp',
      fn.proname, fn.args
    );
  end loop;
end $$;
