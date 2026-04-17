-- =============================================================================
-- Fix: rls_policy_always_true + public_bucket_allows_listing (v3)
-- =============================================================================

-- ─── OPERATOR_DOCUMENTS: удаляем DELETE политику по точному имени ─────────────
-- Используем pg_policies для точного совпадения имени (обходим кэш)
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'operator_documents'
      and policyname = 'Users can delete documents'
  ) then
    execute 'drop policy "Users can delete documents" on public.operator_documents';
    raise notice 'Dropped: Users can delete documents';
  else
    raise notice 'Policy not found (already dropped): Users can delete documents';
  end if;
end $$;

-- ─── STORAGE: expense-attachments ────────────────────────────────────────────
-- Bucket публичный — файлы доступны по URL без политик на storage.objects.
-- Любая SELECT политика на storage.objects вызывает "allows listing" предупреждение.
-- Удаляем нашу политику — bucket работает без неё.
drop policy if exists "expense-attachments-select-authenticated" on storage.objects;
