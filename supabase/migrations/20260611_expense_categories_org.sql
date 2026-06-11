-- expense_categories не была скоуплена по организации: каждый тенант видел чужие
-- категории, а новые создавались «ничьими». Добавляем organization_id + бэкфилл
-- существующих в F16 (единственный тенант с данными до мультитенанта).
-- GET/POST в API теперь скоупят по активной организации (+ NULL = глобальные дефолты).

alter table public.expense_categories add column if not exists organization_id uuid;

create index if not exists expense_categories_org_idx
  on public.expense_categories (organization_id);

-- Существующие категории принадлежат F16.
update public.expense_categories
set organization_id = '447fdc6d-f3bd-453a-b471-465eb3c81e99'
where organization_id is null;
