-- Phase 4: версии статей знаний + подтверждения операторами.

alter table public.knowledge_articles
  add column if not exists version integer not null default 1,
  add column if not exists requires_confirmation boolean not null default false;

create table if not exists public.knowledge_article_confirmations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  article_version integer not null default 1,
  staff_id uuid not null references public.staff(id) on delete cascade,
  shift_id uuid null references public.point_shifts(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint knowledge_article_confirmations_unique unique (article_id, article_version, staff_id)
);

create index if not exists idx_knowledge_article_confirmations_article
  on public.knowledge_article_confirmations (article_id, article_version);
create index if not exists idx_knowledge_article_confirmations_staff
  on public.knowledge_article_confirmations (staff_id, confirmed_at desc);

-- Триггер: на UPDATE статьи с requires_confirmation=true и изменением content/title — bump version.
create or replace function public.knowledge_articles_bump_version()
returns trigger
language plpgsql
as $$
begin
  if NEW.requires_confirmation = true
     and (OLD.content is distinct from NEW.content
          or OLD.title is distinct from NEW.title
          or OLD.severity is distinct from NEW.severity)
     and OLD.version = NEW.version then
    NEW.version := COALESCE(OLD.version, 1) + 1;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_knowledge_articles_bump_version on public.knowledge_articles;
create trigger trg_knowledge_articles_bump_version
before update on public.knowledge_articles
for each row execute function public.knowledge_articles_bump_version();

alter table public.knowledge_article_confirmations enable row level security;
