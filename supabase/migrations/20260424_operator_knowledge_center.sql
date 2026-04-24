create table if not exists public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  title text not null,
  slug text not null,
  description text null,
  kind text not null default 'faq',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_categories_kind_check check (kind in ('rules', 'faq', 'salary', 'problem', 'checklist'))
);

create unique index if not exists idx_knowledge_categories_org_slug
  on public.knowledge_categories (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create index if not exists idx_knowledge_categories_org_kind
  on public.knowledge_categories (organization_id, kind, is_active, sort_order);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  category_id uuid null references public.knowledge_categories(id) on delete set null,
  title text not null,
  slug text not null,
  summary text null,
  content text not null default '',
  tags text[] not null default '{}',
  audience text[] not null default array['operator']::text[],
  severity text not null default 'normal',
  related_fine_amount integer null,
  related_bonus_amount integer null,
  is_published boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_articles_severity_check check (severity in ('info', 'normal', 'warning', 'critical'))
);

create unique index if not exists idx_knowledge_articles_org_slug
  on public.knowledge_articles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create index if not exists idx_knowledge_articles_org_category
  on public.knowledge_articles (organization_id, category_id, is_published, sort_order);

create index if not exists idx_knowledge_articles_tags
  on public.knowledge_articles using gin (tags);

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  title text not null,
  description text null,
  role_scope text not null default 'operator',
  shift_scope text not null default 'any',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_templates_role_scope_check check (role_scope in ('operator', 'cashier', 'senior_operator', 'senior_cashier', 'any')),
  constraint checklist_templates_shift_scope_check check (shift_scope in ('day', 'night', 'opening', 'closing', 'handover', 'any'))
);

create index if not exists idx_checklist_templates_org_scope
  on public.checklist_templates (organization_id, role_scope, shift_scope, is_active, sort_order);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  category_id uuid null references public.knowledge_categories(id) on delete set null,
  knowledge_article_id uuid null references public.knowledge_articles(id) on delete set null,
  title text not null,
  description text null,
  answer_type text not null default 'boolean',
  is_required boolean not null default true,
  requires_photo boolean not null default false,
  severity text not null default 'normal',
  fine_amount integer null,
  bonus_amount integer null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_items_answer_type_check check (answer_type in ('boolean', 'text', 'number', 'photo', 'choice')),
  constraint checklist_items_severity_check check (severity in ('info', 'normal', 'warning', 'critical'))
);

create index if not exists idx_checklist_items_template_sort
  on public.checklist_items (template_id, sort_order);

create or replace function public.knowledge_center_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_categories_updated_at on public.knowledge_categories;
create trigger trg_knowledge_categories_updated_at
before update on public.knowledge_categories
for each row execute function public.knowledge_center_set_updated_at();

drop trigger if exists trg_knowledge_articles_updated_at on public.knowledge_articles;
create trigger trg_knowledge_articles_updated_at
before update on public.knowledge_articles
for each row execute function public.knowledge_center_set_updated_at();

drop trigger if exists trg_checklist_templates_updated_at on public.checklist_templates;
create trigger trg_checklist_templates_updated_at
before update on public.checklist_templates
for each row execute function public.knowledge_center_set_updated_at();

drop trigger if exists trg_checklist_items_updated_at on public.checklist_items;
create trigger trg_checklist_items_updated_at
before update on public.checklist_items
for each row execute function public.knowledge_center_set_updated_at();

alter table public.knowledge_categories enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_items enable row level security;
