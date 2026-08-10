-- ─────────────────────────────────────────────────────────────────────────
-- Ниша точки и каркас базы знаний.
-- ─────────────────────────────────────────────────────────────────────────
-- Ниша — свойство ТОЧКИ, а не организации: у одного владельца одновременно
-- бывают компьютерный клуб, PS-клуб и продуктовый магазин. Раньше ниша нигде
-- не хранилась (packages.vertical — это тариф на всю орг, не род занятий).
--
-- Следствие для экзаменов: общесетевая статья теперь может быть отраслевой.
-- Правило подбора статей для точки:
--   company_id = точка                                        → всегда
--   company_id is null И (industry is null ИЛИ industry = ниша точки) → да
-- То есть «Что делать, если не работает компьютер» больше не попадёт в экзамен
-- продавца корейского магазина.
-- ─────────────────────────────────────────────────────────────────────────

alter table companies
  add column if not exists industry text;

comment on column companies.industry is
  'Ниша точки: club | ps_club | shop | food | service | other. Каталог — lib/core/industries.ts';

alter table knowledge_articles
  -- Отраслевая принадлежность общесетевой статьи (null = годится всем).
  add column if not exists industry text,
  -- Тема каркаса, которую статья закрывает (lib/core/industries.ts).
  add column if not exists topic_key text,
  -- Откуда взялась: seed | manual | auto_facts | interview.
  add column if not exists source text;

create index if not exists idx_knowledge_articles_industry
  on knowledge_articles (industry)
  where industry is not null;

create index if not exists idx_knowledge_articles_topic
  on knowledge_articles (topic_key)
  where topic_key is not null;

create index if not exists idx_companies_industry
  on companies (industry)
  where industry is not null;

-- ─── Разметка автосида ────────────────────────────────────────────────────
-- Статьи из app/api/admin/knowledge/route.ts написаны под компьютерный клуб
-- («PRO/VIP, PS5/VR/SimRacing», «не работает компьютер») и лежат общесетевыми,
-- то есть формально применяются и к магазину. Помечаем клубными, остальные
-- (деньги, доступы, безопасность) оставляем общими для всех ниш.

update knowledge_articles
set industry = 'club', source = coalesce(source, 'seed'), topic_key = coalesce(topic_key, 'shift_handover')
where slug = 'shift-handover-acceptance' and industry is null;

update knowledge_articles
set industry = 'club', source = coalesce(source, 'seed'), topic_key = coalesce(topic_key, 'club_pc_failure')
where slug = 'pc-not-working' and industry is null;

update knowledge_articles
set source = coalesce(source, 'seed'), topic_key = coalesce(topic_key, 'shift_pay_rules')
where slug in ('salary-fines-bonuses-principle', 'operator-debts-view-only') and source is null;

update knowledge_articles
set source = coalesce(source, 'seed'), topic_key = coalesce(topic_key, 'confidentiality')
where slug = 'operator-confidentiality-rules' and source is null;

update knowledge_articles
set source = coalesce(source, 'seed'), topic_key = coalesce(topic_key, 'safety')
where slug = 'operator-safety-responsibility' and source is null;

-- Доступ к странице настройки. Только если роль owner заведена в positions —
-- базовые роли могут жить исключительно в коде, тогда путь берётся из
-- OWNER_PATHS (lib/core/access.ts), куда он уже добавлен.
insert into position_paths (position_name, path)
select 'owner', '/knowledge-setup'
where exists (select 1 from positions where name = 'owner')
on conflict (position_name, path) do nothing;

notify pgrst, 'reload schema';
