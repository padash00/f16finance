-- Запоминаем последнюю выбранную COGS-категорию для поставщика, чтобы при следующей
-- приёмке UI мог подставить её автоматически.
alter table public.inventory_suppliers
  add column if not exists preferred_expense_category_id uuid null
    references public.expense_categories(id) on delete set null;

create index if not exists inventory_suppliers_preferred_category_idx
  on public.inventory_suppliers (preferred_expense_category_id);
