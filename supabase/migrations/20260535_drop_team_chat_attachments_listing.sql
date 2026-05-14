-- Supabase linter public_bucket_allows_listing: у публичного бакета
-- team-chat-attachments была широкая SELECT-политика на storage.objects,
-- разрешающая клиентам листинг всех файлов.
--
-- В коде бакет используется только для .upload() и .getPublicUrl() —
-- листинга (.list()) нет нигде. Публичный бакет отдаёт файлы по прямому
-- URL без SELECT-политики, поэтому политику листинга безопасно удалить.

drop policy if exists team_chat_attachments_read on storage.objects;
