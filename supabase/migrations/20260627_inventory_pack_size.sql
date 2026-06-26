-- Размер упаковки товара (штук в коробке) для плана закупа: заказ округляется
-- до целых упаковок. По умолчанию 1 (штучный товар) — поведение не меняется,
-- пока размер не задан. Безопасно: до применения движок плана падает на 1.

alter table public.inventory_items
  add column if not exists pack_size numeric(12, 3) not null default 1;

comment on column public.inventory_items.pack_size is
  'Штук в упаковке/коробке. План закупа округляет заказ до целых упаковок. 1 = штучный.';
