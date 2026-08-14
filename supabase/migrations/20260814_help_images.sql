-- Иллюстрации к руководству пользователя (/help).
--
-- Картинки не лежат в коде: слоты заданы в lib/core/help-images.ts, а сами
-- файлы владелец загружает на /platform/help-images. Так скриншот можно
-- заменить после релиза программы, не трогая репозиторий.

create table if not exists public.help_images (
  slot          text primary key,
  url           text not null,
  storage_path  text,
  alt           text,
  caption       text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

comment on table public.help_images is 'Иллюстрации публичного руководства /help. Ключ — слот из lib/core/help-images.ts';

alter table public.help_images enable row level security;

-- Страница публичная: читать может кто угодно.
drop policy if exists "help_images public read" on public.help_images;
create policy "help_images public read"
  on public.help_images for select
  using (true);

-- Запись — только через service-role API (/api/admin/help-images), политик на
-- insert/update/delete намеренно нет.

-- Публичный бакет под скриншоты руководства.
insert into storage.buckets (id, name, public)
values ('help-images', 'help-images', true)
on conflict (id) do update set public = true;

drop policy if exists "help-images public read" on storage.objects;
create policy "help-images public read"
  on storage.objects for select
  using (bucket_id = 'help-images');
