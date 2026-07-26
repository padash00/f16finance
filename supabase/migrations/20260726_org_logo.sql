-- White-label: логотип организации в шапке.
-- Сам URL логотипа хранится в существующей JSONB-колонке organizations.branding
-- (ключ logo_url) — отдельную колонку не заводим. Здесь только бакет хранилища.

-- Публичный бакет для логотипов организаций.
-- Загрузка идёт через service-role API (обходит RLS), чтение — публичное.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do update set public = true;

-- Публичное чтение объектов бакета (на случай, если проект требует явную политику).
drop policy if exists "org-logos public read" on storage.objects;
create policy "org-logos public read"
  on storage.objects for select
  using (bucket_id = 'org-logos');
