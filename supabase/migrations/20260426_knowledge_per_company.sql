-- Per-company targeting for knowledge categories and articles.
-- company_id IS NULL = доступно на всех точках организации.
-- company_id = X     = только для этой точки.

alter table public.knowledge_categories
  add column if not exists company_id uuid null references public.companies(id) on delete set null;

alter table public.knowledge_articles
  add column if not exists company_id uuid null references public.companies(id) on delete set null;

create index if not exists idx_knowledge_categories_company
  on public.knowledge_categories (company_id, is_active, sort_order);

create index if not exists idx_knowledge_articles_company
  on public.knowledge_articles (company_id, is_published, sort_order);

-- existing slug uniqueness is per-organization; tighten to per-company so одна и та же
-- статья может существовать на разных точках с разным содержимым.
drop index if exists public.idx_knowledge_categories_org_slug;
drop index if exists public.idx_knowledge_articles_org_slug;

create unique index if not exists idx_knowledge_categories_org_company_slug
  on public.knowledge_categories (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    slug
  );

create unique index if not exists idx_knowledge_articles_org_company_slug
  on public.knowledge_articles (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    slug
  );
