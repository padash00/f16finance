alter table if exists public.salary_calculation_runs
  drop constraint if exists salary_calculation_runs_created_by_fkey;

alter table if exists public.salary_calculation_runs
  add constraint salary_calculation_runs_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table if exists public.audit_log
  drop constraint if exists audit_log_actor_user_id_fkey;

alter table if exists public.audit_log
  add constraint audit_log_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;

alter table if exists public.operator_staff_links
  drop constraint if exists operator_staff_links_assigned_by_fkey;

alter table if exists public.operator_staff_links
  add constraint operator_staff_links_assigned_by_fkey
  foreign key (assigned_by) references auth.users(id) on delete set null;

alter table if exists public.shift_week_publications
  drop constraint if exists shift_week_publications_published_by_fkey;

alter table if exists public.shift_week_publications
  add constraint shift_week_publications_published_by_fkey
  foreign key (published_by) references auth.users(id) on delete set null;

alter table if exists public.shift_change_requests
  drop constraint if exists shift_change_requests_resolved_by_fkey;

alter table if exists public.shift_change_requests
  add constraint shift_change_requests_resolved_by_fkey
  foreign key (resolved_by) references auth.users(id) on delete set null;

alter table if exists public.operator_company_assignments
  drop constraint if exists operator_company_assignments_assigned_by_fkey;

alter table if exists public.operator_company_assignments
  add constraint operator_company_assignments_assigned_by_fkey
  foreign key (assigned_by) references auth.users(id) on delete set null;
