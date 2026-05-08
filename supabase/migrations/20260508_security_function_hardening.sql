-- Дополнительное усиление безопасности по отчёту Supabase linter:
-- 1. Функции без явного search_path (function_search_path_mutable WARN) → добавляем SET search_path
-- 2. SECURITY DEFINER функции доступные anon/authenticated → REVOKE EXECUTE
-- НЕ меняем RLS policies на (false) — это сломает клиентские fetch'и.
-- Все наши API ходят через admin (service_role) клиент, RLS обходится.

-- ============================================================================
-- 1. Закрепляем search_path = public, pg_temp на функции (без него триггеры/RPC
--    могут быть атакованы через изменение search_path)
-- ============================================================================
do $$
declare
  func_name text;
  func_signature text;
  fns text[] := array[
    'point_rules_set_updated_at()',
    'inventory_post_receipt(uuid,date,uuid,text,text,uuid,jsonb)',
    'supplier_debts_set_updated_at()',
    'inventory_create_point_sale(uuid,uuid,uuid,uuid,jsonb,uuid)',
    'knowledge_center_set_updated_at()',
    'point_shifts_set_updated_at()',
    'checklist_runs_set_updated_at()',
    'knowledge_articles_bump_version()',
    'inventory_create_point_return(uuid,uuid,uuid,uuid,jsonb,uuid)',
    'knowledge_quiz_set_updated_at()',
    'incidents_set_updated_at()',
    'inventory_post_stocktake(uuid,date,text,text,uuid,jsonb)',
    'incidents_create(jsonb)',
    'incidents_shift_totals(uuid)',
    'point_shift_open(uuid,uuid,uuid)',
    'point_shift_close(uuid,uuid,jsonb)',
    'point_shift_handover(uuid,uuid,uuid,jsonb)',
    'inventory_undecide_request(uuid,uuid)',
    'inventory_recurring_shortages(integer,integer)',
    'inventory_create_pos_sale(uuid,uuid,jsonb,uuid)',
    'inventory_decide_request(uuid,text,uuid,uuid)',
    'touch_role_capabilities_updated_at()',
    'inventory_post_writeoff(uuid,date,text,text,uuid,jsonb)',
    'inventory_cancel_receipt(uuid,uuid)',
    'inventory_validate_movement_v2()',
    'inventory_locations_block_catalog_total()',
    'inventory_apply_reserved_delta(uuid,uuid,numeric)',
    'inventory_receive_request(uuid,uuid)'
  ];
begin
  foreach func_signature in array fns loop
    -- Извлекаем только имя функции для логов
    func_name := split_part(func_signature, '(', 1);
    begin
      execute format('alter function public.%s set search_path = public, pg_temp', func_signature);
    exception when others then
      raise notice 'Skip alter on public.%: %', func_signature, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================================
-- 2. Закрываем SECURITY DEFINER функции от anon/authenticated.
--    Они нужны только внутри RLS policies (где они вызываются от имени БД).
--    Прямой вызов через REST /rpc/<name> не должен быть доступен.
-- ============================================================================
do $$
declare
  func_signature text;
  fns text[] := array[
    'can_access_company(uuid)',
    'can_access_inventory_item(uuid)',
    'can_access_inventory_location(uuid)',
    'can_access_inventory_receipt(uuid)',
    'can_access_inventory_request(uuid)',
    'can_access_inventory_stocktake(uuid)',
    'can_access_inventory_writeoff(uuid)',
    'can_access_operator(uuid)',
    'can_access_organization(uuid)',
    'can_access_point_device(uuid)',
    'can_access_point_project(uuid)',
    'can_access_point_return(uuid)',
    'can_access_point_sale(uuid)',
    'can_access_salary_calculation_run(uuid)',
    'can_access_salary_payment(uuid)',
    'can_access_salary_week(uuid)',
    'can_access_task_record(uuid)',
    'can_access_workspace_project(uuid)',
    'customer_link_matches_auth(uuid)',
    'customer_own_company_row(uuid,uuid)',
    'inventory_integrity_check()',
    'point_shift_admin_close(uuid,uuid,text)',
    'point_shift_admin_purge(uuid,uuid)'
  ];
begin
  foreach func_signature in array fns loop
    begin
      execute format('revoke execute on function public.%s from anon, authenticated', func_signature);
    exception when others then
      raise notice 'Skip revoke on public.%: %', func_signature, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================================
-- 3. Reload schema cache
-- ============================================================================
notify pgrst, 'reload schema';
