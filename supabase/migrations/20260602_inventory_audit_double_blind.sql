-- ─────────────────────────────────────────────────────────────────────────────
-- Аудит-акт: двойной слепой подсчёт (Этап 3)
-- Режим акта: 'single' (один счёт на товар) | 'double' (два оператора считают
-- одни и те же товары независимо; расхождение → пересчёт/решение владельца).
-- Для этого счёт хранится ПО КАЖДОМУ оператору: уникальность (act, item, counted_by).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.inventory_audit_acts add column if not exists mode text not null default 'single';
alter table public.inventory_audit_acts drop constraint if exists inventory_audit_acts_mode_check;
alter table public.inventory_audit_acts add constraint inventory_audit_acts_mode_check check (mode in ('single', 'double'));

-- снимаем старую уникальность (act_id, item_id) — теперь счёт per-operator
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.inventory_audit_counts'::regclass
    and contype = 'u'
    and array_length(conkey, 1) = 2;
  if cname is not null then
    execute format('alter table public.inventory_audit_counts drop constraint %I', cname);
  end if;
exception when others then
  null;
end $$;

-- новая уникальность: один счёт на (акт, товар, оператор)
create unique index if not exists inventory_audit_counts_act_item_op_uidx
  on public.inventory_audit_counts (act_id, item_id, counted_by);

notify pgrst, 'reload schema';
