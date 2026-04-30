create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  endpoint text not null,
  provider text not null default 'openai',
  model text not null,
  prompt_tokens integer null,
  completion_tokens integer null,
  total_tokens integer null,
  cost_estimate numeric(12, 6) null,
  status text not null default 'success',
  error text null,
  payload jsonb null
);

create index if not exists ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_user_id_idx on public.ai_usage_log (user_id);
create index if not exists ai_usage_log_endpoint_idx on public.ai_usage_log (endpoint);

alter table public.ai_usage_log enable row level security;
