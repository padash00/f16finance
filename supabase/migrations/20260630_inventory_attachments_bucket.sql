-- Бакет inventory-attachments для накладных склада (store/receipts/upload).
-- Сейчас его нет → загрузка падает с 400 и уходит в запасной expense-attachments.
-- Зеркалим настройки expense-attachments: публичный бакет (getPublicUrl),
-- SELECT только authenticated. INSERT/UPDATE/DELETE — через service role (RLS обходит).

insert into storage.buckets (id, name, public)
values ('inventory-attachments', 'inventory-attachments', true)
on conflict (id) do nothing;

drop policy if exists "inventory-attachments-select-authenticated" on storage.objects;
create policy "inventory-attachments-select-authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'inventory-attachments');
