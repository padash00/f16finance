-- =====================================================================
-- Снимаем флаг is_builtin со всех ролей. Концепция «системных ролей»
-- удаляется: все роли создаются и удаляются пользователем одинаково.
-- Колонку is_builtin оставляю в БД на случай rollback — UI и backend
-- перестают её учитывать.
-- =====================================================================

update positions set is_builtin = false where is_builtin = true;

-- Sanity-check: не должно остаться ни одной "встроенной" роли.
do $$
declare
  builtin_count int;
begin
  select count(*) into builtin_count from positions where is_builtin = true;
  if builtin_count <> 0 then
    raise exception 'unexpected: % positions still marked is_builtin=true', builtin_count;
  end if;
  raise notice 'all positions are now user-editable (is_builtin=false)';
end $$;
