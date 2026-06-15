-- Кэш распознавания товара по штрихкоду (EAN/GTIN).
-- Глобальный (личность товара по коду — общая правда): завели в одной точке —
-- подсказка доступна всем. Категорию/цену каждая орг выбирает сама при сохранении.
-- Доступ только через сервер (service role), поэтому RLS не включаем.

create table if not exists public.barcode_cache (
  barcode text primary key,
  name text null,
  brand text null,
  category_raw text null,
  description text null,
  image_url text null,
  country text null,
  source text not null default 'openfoodfacts',
  raw jsonb null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

notify pgrst, 'reload schema';
