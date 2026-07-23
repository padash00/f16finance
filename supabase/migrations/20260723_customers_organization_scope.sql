-- ─────────────────────────────────────────────────────────────────────────────
-- Изоляция арендаторов, класс 3: клиенты лояльности скоупятся по ОРГАНИЗАЦИИ.
--
-- Дыра: у customers есть company_id, но «сетевой» клиент хранится с
-- company_id = NULL, и запросы .or(company_id.eq.X, company_id.is.null) делали
-- таких клиентов видимыми/изменяемыми ЛЮБЫМ арендатором (баллы, kiosk_balance,
-- номер карты). Правильно: клиент принадлежит организации; company_id = NULL
-- означает «любая точка ВНУТРИ своей орг», а не «общий для всех арендаторов».
--
-- Добавляем organization_id и бэкфиллим. Безопасно: сейчас один реальный
-- арендатор (F16), поэтому null-company клиенты корректно уезжают в его орг.
-- Идемпотентно.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- 1) У кого есть company_id — берём орг его компании.
update public.customers c
  set organization_id = comp.organization_id
  from public.companies comp
  where c.company_id = comp.id
    and c.organization_id is null
    and comp.organization_id is not null;

-- 2) Сетевые клиенты (company_id IS NULL) — привязываем к единственной
--    организации, у которой есть компании. Если организаций-владельцев больше
--    одной — НЕ трогаем (нельзя угадать), эти строки останутся org=NULL и будут
--    видны только суперадмину до ручного разбора.
update public.customers
  set organization_id = (
    select organization_id from public.companies
    where organization_id is not null
    group by organization_id order by count(*) desc limit 1
  )
  where organization_id is null
    and (select count(distinct organization_id) from public.companies where organization_id is not null) = 1;

create index if not exists customers_organization_id_idx on public.customers (organization_id);

notify pgrst, 'reload schema';
