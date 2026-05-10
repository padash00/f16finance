-- =====================================================================
-- operator_documents — добавляем INSERT/UPDATE/DELETE policies.
-- В предыдущей миграции их сдропнули но не пересоздали — INSERT падает
-- с ошибкой «new row violates row-level security policy».
-- =====================================================================

alter table if exists public.operator_documents enable row level security;

-- INSERT: разрешён залогиненным staff (проверка через can_access_operator
-- — staff видит документы операторов своей организации)
drop policy if exists operator_documents_insert on public.operator_documents;
create policy operator_documents_insert
  on public.operator_documents
  for insert
  to authenticated
  with check (
    operator_id is not null
    and public.can_access_operator(operator_id)
  );

-- UPDATE
drop policy if exists operator_documents_update on public.operator_documents;
create policy operator_documents_update
  on public.operator_documents
  for update
  to authenticated
  using (
    operator_id is not null
    and public.can_access_operator(operator_id)
  )
  with check (
    operator_id is not null
    and public.can_access_operator(operator_id)
  );

-- DELETE
drop policy if exists operator_documents_delete on public.operator_documents;
create policy operator_documents_delete
  on public.operator_documents
  for delete
  to authenticated
  using (
    operator_id is not null
    and public.can_access_operator(operator_id)
  );
