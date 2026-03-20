create table if not exists public.shift_week_publications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  version integer not null default 1,
  status text not null default 'published',
  note text null,
  published_at timestamp with time zone not null default now(),
  published_by uuid null references auth.users(id),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_shift_week_publications_company_week
  on public.shift_week_publications(company_id, week_start desc, published_at desc);

create table if not exists public.shift_operator_week_responses (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.shift_week_publications(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  status text not null default 'pending',
  response_source text null,
  note text null,
  responded_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint shift_operator_week_responses_publication_operator_key unique (publication_id, operator_id)
);

create index if not exists idx_shift_operator_week_responses_publication
  on public.shift_operator_week_responses(publication_id, status);

drop trigger if exists update_shift_operator_week_responses_updated_at on public.shift_operator_week_responses;
create trigger update_shift_operator_week_responses_updated_at
before update on public.shift_operator_week_responses
for each row
execute function public.update_updated_at_column();

create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.shift_week_publications(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  shift_date date not null,
  shift_type text not null,
  status text not null default 'awaiting_reason',
  source text null,
  reason text null,
  resolution_note text null,
  responded_at timestamp with time zone null,
  resolved_at timestamp with time zone null,
  resolved_by uuid null references auth.users(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_shift_change_requests_publication
  on public.shift_change_requests(publication_id, status, created_at desc);

create index if not exists idx_shift_change_requests_operator
  on public.shift_change_requests(operator_id, status);

drop trigger if exists update_shift_change_requests_updated_at on public.shift_change_requests;
create trigger update_shift_change_requests_updated_at
before update on public.shift_change_requests
for each row
execute function public.update_updated_at_column();
