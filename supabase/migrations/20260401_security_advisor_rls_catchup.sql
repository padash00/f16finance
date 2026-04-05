create or replace function public.table_has_column(target_table text, target_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = target_table
      and column_name = target_column
  )
$$;

create or replace function public.can_access_operator(target_operator_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  allowed boolean := false;
begin
  if to_regclass('public.operator_auth') is not null then
    execute
      'select exists (
         select 1
         from public.operator_auth oa
         where oa.operator_id = $1
           and oa.user_id = auth.uid()
       )'
      into allowed
      using target_operator_id;

    if allowed then
      return true;
    end if;
  end if;

  if to_regclass('public.operator_company_assignments') is not null then
    execute
      'select exists (
         select 1
         from public.operator_company_assignments oca
         where oca.operator_id = $1
           and public.can_access_company(oca.company_id)
       )'
      into allowed
      using target_operator_id;

    if allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.can_access_point_project(target_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  allowed boolean := false;
begin
  if to_regclass('public.point_project_companies') is not null then
    if public.table_has_column('point_project_companies', 'project_id') and public.table_has_column('point_project_companies', 'company_id') then
      execute
        'select exists (
           select 1
           from public.point_project_companies ppc
           where ppc.project_id = $1
             and public.can_access_company(ppc.company_id)
         )'
        into allowed
        using target_project_id;

      if allowed then
        return true;
      end if;
    end if;
  end if;

  if to_regclass('public.point_projects') is not null then
    if public.table_has_column('point_projects', 'company_id') then
      execute
        'select exists (
           select 1
           from public.point_projects pp
           where pp.id = $1
             and pp.company_id is not null
             and public.can_access_company(pp.company_id)
         )'
        into allowed
        using target_project_id;

      if allowed then
        return true;
      end if;
    end if;

    if public.table_has_column('point_projects', 'organization_id') then
      execute
        'select exists (
           select 1
           from public.point_projects pp
           where pp.id = $1
             and pp.organization_id is not null
             and public.can_access_organization(pp.organization_id)
         )'
        into allowed
        using target_project_id;

      if allowed then
        return true;
      end if;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.can_access_workspace_project(target_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  allowed boolean := false;
begin
  if to_regclass('public.projects') is null then
    return false;
  end if;

  if public.table_has_column('projects', 'organization_id') then
    execute
      'select exists (
         select 1
         from public.projects p
         where p.id = $1
           and p.organization_id is not null
           and public.can_access_organization(p.organization_id)
       )'
      into allowed
      using target_project_id;

    if allowed then
      return true;
    end if;
  end if;

  if public.table_has_column('projects', 'company_id') then
    execute
      'select exists (
         select 1
         from public.projects p
         where p.id = $1
           and p.company_id is not null
           and public.can_access_company(p.company_id)
       )'
      into allowed
      using target_project_id;

    if allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.can_access_task_record(target_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  allowed boolean := false;
begin
  if to_regclass('public.tasks') is null then
    return false;
  end if;

  if public.table_has_column('tasks', 'organization_id') then
    execute
      'select exists (
         select 1
         from public.tasks t
         where t.id = $1
           and t.organization_id is not null
           and public.can_access_organization(t.organization_id)
       )'
      into allowed
      using target_task_id;

    if allowed then
      return true;
    end if;
  end if;

  if public.table_has_column('tasks', 'company_id') then
    execute
      'select exists (
         select 1
         from public.tasks t
         where t.id = $1
           and t.company_id is not null
           and public.can_access_company(t.company_id)
       )'
      into allowed
      using target_task_id;

    if allowed then
      return true;
    end if;
  end if;

  if public.table_has_column('tasks', 'project_id') then
    execute
      'select exists (
         select 1
         from public.tasks t
         where t.id = $1
           and t.project_id is not null
           and public.can_access_workspace_project(t.project_id)
       )'
      into allowed
      using target_task_id;

    if allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.can_access_salary_calculation_run(target_run_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  allowed boolean := false;
begin
  if to_regclass('public.salary_calculation_runs') is null then
    return false;
  end if;

  if public.table_has_column('salary_calculation_runs', 'company_code') then
    execute
      'select exists (
         select 1
         from public.salary_calculation_runs scr
         join public.companies c on c.code = scr.company_code
         where scr.id = $1
           and public.can_access_company(c.id)
       )'
      into allowed
      using target_run_id;

    if allowed then
      return true;
    end if;
  end if;

  if public.table_has_column('salary_calculation_runs', 'created_by') and auth.uid() is not null then
    execute
      'select exists (
         select 1
         from public.salary_calculation_runs scr
         where scr.id = $1
           and scr.created_by = auth.uid()
       )'
      into allowed
      using target_run_id;

    if allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

do $$
declare
  table_name text;
  using_expr text;
  policy_name text;
  advisor_tables text[] := array[
    'recurring_expenses',
    'incomes',
    'operator_salary_rules',
    'operator_salary_adjustments',
    'debts',
    'debt_items',
    'telegram_allowed_users',
    'desktop_accounts',
    'kpi_plans',
    'goals',
    'operator_levels',
    'expense_categories',
    'operator_achievements',
    'operators',
    'operator_shifts',
    'operator_salary_payouts',
    'tg_users',
    'assistant_sessions',
    'assistant_audit_log',
    'client_contacts',
    'feedback',
    'operator_xp_history',
    'role_permissions',
    'expense_templates',
    'operator_notifications',
    'operator_profiles',
    'salary_calculation_runs',
    'salary_calculation_items',
    'projects',
    'tasks',
    'task_comments',
    'task_history',
    'task_checklist',
    'tags',
    'task_tags',
    'notifications',
    'reminders',
    'operator_work_history',
    'inventory_consumption_norms',
    'inventory_point_limits',
    'point_sale_returns',
    'point_projects',
    'point_project_companies',
    'arena_map_decorations'
  ];
begin
  foreach table_name in array advisor_tables
  loop
    if to_regclass(format('public.%s', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    using_expr := null;

    if table_name = 'operators' then
      using_expr := 'public.can_access_operator(id)';
    elsif table_name = 'operator_profiles' then
      if public.table_has_column(table_name, 'operator_id') then
        using_expr := 'public.can_access_operator(operator_id)';
      end if;
    elsif table_name = 'point_projects' then
      using_expr := 'public.can_access_point_project(id)';
    elsif table_name = 'point_project_companies' then
      if public.table_has_column(table_name, 'company_id') then
        using_expr := 'public.can_access_company(company_id)';
      elsif public.table_has_column(table_name, 'project_id') then
        using_expr := 'public.can_access_point_project(project_id)';
      end if;
    elsif table_name = 'projects' then
      using_expr := 'public.can_access_workspace_project(id)';
    elsif table_name = 'tasks' then
      using_expr := 'public.can_access_task_record(id)';
    elsif public.table_has_column(table_name, 'organization_id') then
      using_expr := 'organization_id is not null and public.can_access_organization(organization_id)';
    elsif public.table_has_column(table_name, 'company_id') then
      using_expr := 'company_id is not null and public.can_access_company(company_id)';
    elsif public.table_has_column(table_name, 'warehouse_location_id') then
      using_expr := 'warehouse_location_id is not null and public.can_access_inventory_location(warehouse_location_id)';
    elsif public.table_has_column(table_name, 'location_id') then
      using_expr := 'location_id is not null and public.can_access_inventory_location(location_id)';
    elsif public.table_has_column(table_name, 'point_device_id') then
      using_expr := 'point_device_id is not null and public.can_access_point_device(point_device_id)';
    elsif public.table_has_column(table_name, 'operator_id') then
      using_expr := 'operator_id is not null and public.can_access_operator(operator_id)';
    elsif public.table_has_column(table_name, 'sale_id') then
      using_expr := 'sale_id is not null and public.can_access_point_sale(sale_id)';
    elsif public.table_has_column(table_name, 'return_id') then
      using_expr := 'return_id is not null and public.can_access_point_return(return_id)';
    elsif public.table_has_column(table_name, 'payment_id') then
      using_expr := 'payment_id is not null and public.can_access_salary_payment(payment_id)';
    elsif public.table_has_column(table_name, 'salary_week_id') then
      using_expr := 'salary_week_id is not null and public.can_access_salary_week(salary_week_id)';
    elsif public.table_has_column(table_name, 'run_id') then
      using_expr := 'run_id is not null and public.can_access_salary_calculation_run(run_id)';
    elsif public.table_has_column(table_name, 'task_id') then
      using_expr := 'task_id is not null and public.can_access_task_record(task_id)';
    elsif public.table_has_column(table_name, 'project_id') then
      using_expr := 'project_id is not null and (public.can_access_workspace_project(project_id) or public.can_access_point_project(project_id))';
    end if;

    if using_expr is null then
      continue;
    end if;

    policy_name := table_name || '_select_secure';
    execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      policy_name,
      table_name,
      using_expr
    );
  end loop;
end $$;
