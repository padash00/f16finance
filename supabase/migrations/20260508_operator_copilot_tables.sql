-- Таблицы для operator-side Copilot — оператор может через бот делать
-- свои запросы (выходной, опоздание, сообщения менеджеру).

-- ============================================================================
-- 1. day_off_requests — запросы на выходной
-- ============================================================================
create table if not exists public.day_off_requests (id uuid primary key default gen_random_uuid());

alter table public.day_off_requests
  add column if not exists operator_id uuid,
  add column if not exists company_id uuid,
  add column if not exists date_from date,
  add column if not exists date_to date,
  add column if not exists reason text,
  add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  add column if not exists decided_by uuid null,
  add column if not exists decided_at timestamptz null,
  add column if not exists decline_reason text null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'day_off_requests' and constraint_name = 'day_off_requests_operator_id_fkey') then
    alter table public.day_off_requests
      add constraint day_off_requests_operator_id_fkey
      foreign key (operator_id) references public.operators(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where table_name = 'day_off_requests' and constraint_name = 'day_off_requests_company_id_fkey') then
    alter table public.day_off_requests
      add constraint day_off_requests_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

create index if not exists idx_day_off_requests_operator on public.day_off_requests(operator_id, status);
create index if not exists idx_day_off_requests_date_from on public.day_off_requests(date_from desc);

alter table public.day_off_requests enable row level security;
drop policy if exists day_off_requests_all on public.day_off_requests;
create policy day_off_requests_all on public.day_off_requests for all using (true) with check (true);

-- ============================================================================
-- 2. late_reports — отчёты об опоздании от оператора
-- ============================================================================
create table if not exists public.late_reports (id uuid primary key default gen_random_uuid());

alter table public.late_reports
  add column if not exists operator_id uuid,
  add column if not exists company_id uuid,
  add column if not exists shift_date date,
  add column if not exists shift_type text check (shift_type in ('day', 'night')),
  add column if not exists minutes_late integer not null default 0,
  add column if not exists reason text,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'late_reports' and constraint_name = 'late_reports_operator_id_fkey') then
    alter table public.late_reports
      add constraint late_reports_operator_id_fkey
      foreign key (operator_id) references public.operators(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where table_name = 'late_reports' and constraint_name = 'late_reports_company_id_fkey') then
    alter table public.late_reports
      add constraint late_reports_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

create index if not exists idx_late_reports_operator_date on public.late_reports(operator_id, shift_date desc);

alter table public.late_reports enable row level security;
drop policy if exists late_reports_all on public.late_reports;
create policy late_reports_all on public.late_reports for all using (true) with check (true);

-- ============================================================================
-- 3. operator_messages — сообщения от оператора менеджеру/владельцу
-- ============================================================================
create table if not exists public.operator_messages (id uuid primary key default gen_random_uuid());

alter table public.operator_messages
  add column if not exists operator_id uuid,
  add column if not exists company_id uuid,
  add column if not exists message text not null default '',
  add column if not exists urgency text not null default 'normal' check (urgency in ('low', 'normal', 'urgent')),
  add column if not exists status text not null default 'new' check (status in ('new', 'read', 'resolved')),
  add column if not exists read_at timestamptz null,
  add column if not exists read_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'operator_messages' and constraint_name = 'operator_messages_operator_id_fkey') then
    alter table public.operator_messages
      add constraint operator_messages_operator_id_fkey
      foreign key (operator_id) references public.operators(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where table_name = 'operator_messages' and constraint_name = 'operator_messages_company_id_fkey') then
    alter table public.operator_messages
      add constraint operator_messages_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

create index if not exists idx_operator_messages_status on public.operator_messages(status, created_at desc);

alter table public.operator_messages enable row level security;
drop policy if exists operator_messages_all on public.operator_messages;
create policy operator_messages_all on public.operator_messages for all using (true) with check (true);

-- ============================================================================
-- Reload schema cache
-- ============================================================================
notify pgrst, 'reload schema';
