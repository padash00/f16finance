-- Этап 5: Новостная лента + единый календарь.

-- News feed posts (Stories владельца)
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  author_user_id uuid null,
  author_name text not null default 'Команда',
  -- Контент
  title text null,
  body text not null default '',
  image_url text null,
  link_url text null,
  link_label text null,
  -- Жизненный цикл
  pinned_until timestamptz null,
  expires_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_news_posts_recent
  on public.news_posts(created_at desc)
  where deleted_at is null;

create index if not exists idx_news_posts_org
  on public.news_posts(organization_id, created_at desc)
  where deleted_at is null;

create table if not exists public.news_views (
  post_id uuid not null references public.news_posts(id) on delete cascade,
  user_id uuid not null,
  viewed_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, user_id)
);

alter table public.news_posts enable row level security;
drop policy if exists news_posts_all on public.news_posts;
create policy news_posts_all on public.news_posts for all using (true) with check (true);

alter table public.news_views enable row level security;
drop policy if exists news_views_all on public.news_views;
create policy news_views_all on public.news_views for all using (true) with check (true);

alter publication supabase_realtime add table public.news_posts;

-- KZ holidays — раньше были захардкожены в cron, теперь в БД для календаря
create table if not exists public.kz_holidays (
  date date primary key,
  name text not null,
  is_workday_off boolean not null default true,
  description text null
);

-- Сидируем основные праздники РК на 2026
insert into public.kz_holidays (date, name, is_workday_off, description) values
  ('2026-01-01', 'Новый год',                 true,  'Новогодние праздники'),
  ('2026-01-02', 'Новый год',                 true,  'Новогодние праздники'),
  ('2026-01-07', 'Православное Рождество',    true,  null),
  ('2026-03-08', 'Международный женский день',true,  null),
  ('2026-03-21', 'Наурыз мейрамы',            true,  'Наурыз'),
  ('2026-03-22', 'Наурыз мейрамы',            true,  'Наурыз'),
  ('2026-03-23', 'Наурыз мейрамы',            true,  'Наурыз'),
  ('2026-05-01', 'Праздник единства народа',  true,  null),
  ('2026-05-07', 'День защитника Отечества',  true,  null),
  ('2026-05-09', 'День Победы',                true,  null),
  ('2026-07-06', 'День Столицы',               true,  null),
  ('2026-08-30', 'День Конституции',           true,  null),
  ('2026-10-25', 'День Республики',            true,  null),
  ('2026-12-16', 'День Независимости',         true,  null)
on conflict (date) do nothing;

-- 2027 год — основные
insert into public.kz_holidays (date, name, is_workday_off) values
  ('2027-01-01', 'Новый год', true),
  ('2027-01-02', 'Новый год', true),
  ('2027-01-07', 'Православное Рождество', true),
  ('2027-03-08', 'Международный женский день', true),
  ('2027-03-21', 'Наурыз мейрамы', true),
  ('2027-03-22', 'Наурыз мейрамы', true),
  ('2027-03-23', 'Наурыз мейрамы', true),
  ('2027-05-01', 'Праздник единства народа', true),
  ('2027-05-07', 'День защитника Отечества', true),
  ('2027-05-09', 'День Победы', true),
  ('2027-07-06', 'День Столицы', true),
  ('2027-08-30', 'День Конституции', true),
  ('2027-10-25', 'День Республики', true),
  ('2027-12-16', 'День Независимости', true)
on conflict (date) do nothing;

alter table public.kz_holidays enable row level security;
drop policy if exists kz_holidays_read on public.kz_holidays;
create policy kz_holidays_read on public.kz_holidays for select using (true);

notify pgrst, 'reload schema';
