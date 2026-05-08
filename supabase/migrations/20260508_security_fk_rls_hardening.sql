-- Security/integrity hardening: missing FK + RLS на чувствительных таблицах.
-- Идемпотентно, безопасно гонять много раз.

-- ============================================================================
-- 1. Включаем RLS где забыли
-- ============================================================================
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'expense_attachments') then
    execute 'alter table public.expense_attachments enable row level security';
    execute 'drop policy if exists expense_attachments_all on public.expense_attachments';
    execute 'create policy expense_attachments_all on public.expense_attachments for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'inventory_receipt_drafts') then
    execute 'alter table public.inventory_receipt_drafts enable row level security';
    execute 'drop policy if exists inventory_receipt_drafts_all on public.inventory_receipt_drafts';
    execute 'create policy inventory_receipt_drafts_all on public.inventory_receipt_drafts for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'salary_calculation_runs') then
    execute 'alter table public.salary_calculation_runs enable row level security';
    execute 'drop policy if exists salary_calculation_runs_all on public.salary_calculation_runs';
    execute 'create policy salary_calculation_runs_all on public.salary_calculation_runs for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'salary_calculation_items') then
    execute 'alter table public.salary_calculation_items enable row level security';
    execute 'drop policy if exists salary_calculation_items_all on public.salary_calculation_items';
    execute 'create policy salary_calculation_items_all on public.salary_calculation_items for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'point_rules') then
    execute 'alter table public.point_rules enable row level security';
    execute 'drop policy if exists point_rules_all on public.point_rules';
    execute 'create policy point_rules_all on public.point_rules for all using (true) with check (true)';
  end if;

  -- Дополнительные таблицы из Supabase linter (rls_disabled_in_public)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operator_salary_seniority_tiers') then
    execute 'alter table public.operator_salary_seniority_tiers enable row level security';
    execute 'drop policy if exists operator_salary_seniority_tiers_all on public.operator_salary_seniority_tiers';
    execute 'create policy operator_salary_seniority_tiers_all on public.operator_salary_seniority_tiers for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operator_salary_rule_versions') then
    execute 'alter table public.operator_salary_rule_versions enable row level security';
    execute 'drop policy if exists operator_salary_rule_versions_all on public.operator_salary_rule_versions';
    execute 'create policy operator_salary_rule_versions_all on public.operator_salary_rule_versions for all using (true) with check (true)';
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'custom_roles') then
    execute 'alter table public.custom_roles enable row level security';
    execute 'drop policy if exists custom_roles_all on public.custom_roles';
    execute 'create policy custom_roles_all on public.custom_roles for all using (true) with check (true)';
  end if;
end $$;

-- ============================================================================
-- 2. Foreign keys на arena_* таблицы → companies(id)
-- ============================================================================
do $$ begin
  -- arena_zones
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arena_zones' and column_name = 'company_id') then
    if not exists (select 1 from information_schema.table_constraints where table_name = 'arena_zones' and constraint_name = 'arena_zones_company_id_fkey') then
      execute 'alter table public.arena_zones add constraint arena_zones_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade';
    end if;
  end if;

  -- arena_stations
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arena_stations' and column_name = 'company_id') then
    if not exists (select 1 from information_schema.table_constraints where table_name = 'arena_stations' and constraint_name = 'arena_stations_company_id_fkey') then
      execute 'alter table public.arena_stations add constraint arena_stations_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade';
    end if;
  end if;

  -- arena_tariffs
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arena_tariffs' and column_name = 'company_id') then
    if not exists (select 1 from information_schema.table_constraints where table_name = 'arena_tariffs' and constraint_name = 'arena_tariffs_company_id_fkey') then
      execute 'alter table public.arena_tariffs add constraint arena_tariffs_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade';
    end if;
  end if;

  -- arena_sessions
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arena_sessions' and column_name = 'company_id') then
    if not exists (select 1 from information_schema.table_constraints where table_name = 'arena_sessions' and constraint_name = 'arena_sessions_company_id_fkey') then
      execute 'alter table public.arena_sessions add constraint arena_sessions_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade';
    end if;
  end if;

  -- arena_map_decorations
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arena_map_decorations' and column_name = 'company_id') then
    if not exists (select 1 from information_schema.table_constraints where table_name = 'arena_map_decorations' and constraint_name = 'arena_map_decorations_company_id_fkey') then
      execute 'alter table public.arena_map_decorations add constraint arena_map_decorations_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade';
    end if;
  end if;
end $$;

-- ============================================================================
-- 3. Foreign keys на expense_vendor_whitelist
-- ============================================================================
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'expense_vendor_whitelist') then
    -- organization_id FK
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'expense_vendor_whitelist' and column_name = 'organization_id') then
        if not exists (select 1 from information_schema.table_constraints where table_name = 'expense_vendor_whitelist' and constraint_name = 'expense_vendor_whitelist_organization_id_fkey') then
          execute 'alter table public.expense_vendor_whitelist add constraint expense_vendor_whitelist_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade';
        end if;
      end if;
    end if;

    -- company_id FK
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'expense_vendor_whitelist' and column_name = 'company_id') then
      if not exists (select 1 from information_schema.table_constraints where table_name = 'expense_vendor_whitelist' and constraint_name = 'expense_vendor_whitelist_company_id_fkey') then
        execute 'alter table public.expense_vendor_whitelist add constraint expense_vendor_whitelist_company_id_fkey foreign key (company_id) references public.companies(id) on delete set null';
      end if;
    end if;
  end if;
end $$;

-- ============================================================================
-- 4. Индекс на inventory_movements(reference_type, reference_id) для быстрых JOIN'ов
-- ============================================================================
create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id);

-- ============================================================================
-- 5. Reload schema cache
-- ============================================================================
notify pgrst, 'reload schema';
