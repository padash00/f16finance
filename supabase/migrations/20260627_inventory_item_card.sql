-- ─────────────────────────────────────────────────────────────────────────────
-- Карточка товара: фото + бренд на inventory_items + storage bucket под фото.
--
-- Веб-портал открывает «красивую карточку» по клику на товар в каталоге:
-- крупное фото, цены/маржа, остатки по точкам, продажи/скорость, поставщик.
-- Сюда добавляем недостающие колонки и публичный bucket под загрузку фото.
-- Идемпотентно — безопасно прогонять повторно.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Колонки на товар (фото и бренд; description уже есть в схеме).
alter table public.inventory_items add column if not exists image_url text;
alter table public.inventory_items add column if not exists brand text;
alter table public.inventory_items add column if not exists description text;

comment on column public.inventory_items.image_url is 'URL фото товара (storage bucket product-photos или внешний из barcode-lookup)';
comment on column public.inventory_items.brand is 'Бренд/производитель товара (показывается в карточке)';

-- 2. Публичный bucket под фото товаров (лимит 5 МБ, как в задаче).
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'product-photos') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('product-photos', 'product-photos', true, 5242880);  -- 5MB
  end if;
end $$;

-- 3. Storage policies (по образцу 20260538_customer_display_ads.sql).
do $$ begin
  drop policy if exists "product_photos_read" on storage.objects;
  create policy "product_photos_read"
    on storage.objects for select
    using (bucket_id = 'product-photos');

  drop policy if exists "product_photos_write" on storage.objects;
  create policy "product_photos_write"
    on storage.objects for insert
    with check (bucket_id = 'product-photos');

  drop policy if exists "product_photos_delete" on storage.objects;
  create policy "product_photos_delete"
    on storage.objects for delete
    using (bucket_id = 'product-photos');
end $$;

notify pgrst, 'reload schema';
