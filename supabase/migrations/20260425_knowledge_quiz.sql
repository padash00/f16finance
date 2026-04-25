-- Phase 4: квизы по статьям базы знаний.

create table if not exists public.knowledge_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  score integer null,
  questions jsonb not null,
  answers jsonb null,
  total_questions integer null,
  correct_answers integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint knowledge_quiz_status_check check (status in ('in_progress', 'completed', 'abandoned'))
);

create index if not exists idx_knowledge_quiz_staff
  on public.knowledge_quiz_attempts (staff_id, started_at desc);
create index if not exists idx_knowledge_quiz_organization
  on public.knowledge_quiz_attempts (organization_id, started_at desc);

create or replace function public.knowledge_quiz_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_quiz_updated_at on public.knowledge_quiz_attempts;
create trigger trg_knowledge_quiz_updated_at
before update on public.knowledge_quiz_attempts
for each row execute function public.knowledge_quiz_set_updated_at();

alter table public.knowledge_quiz_attempts enable row level security;
