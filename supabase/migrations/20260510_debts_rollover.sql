-- =====================================================================
-- Debts rollover — поддержка переноса непогашенных долгов на следующую неделю.
--
-- Новые поля в `debts`:
--   rolled_over_from_id  — ссылка на оригинальный долг (если эта запись
--                           создана в результате переноса)
--   rolled_over_to_id    — ссылка на «дочерний» долг (если этот долг
--                           был перенесён, заполняется при создании
--                           дочернего)
--   rolled_over_at       — timestamp когда был перенос
--
-- Новый status: 'rolled_over' (status — text, без enum constraint, добавляем
-- только конвенционно).
-- =====================================================================

alter table public.debts
  add column if not exists rolled_over_from_id uuid null references public.debts(id) on delete set null,
  add column if not exists rolled_over_to_id uuid null references public.debts(id) on delete set null,
  add column if not exists rolled_over_at timestamptz null;

create index if not exists idx_debts_rolled_over_from on public.debts(rolled_over_from_id);
create index if not exists idx_debts_rolled_over_to on public.debts(rolled_over_to_id);
create index if not exists idx_debts_status_week on public.debts(status, week_start);

comment on column public.debts.rolled_over_from_id is
  'Если создан переносом из старого долга — ссылка на оригинал. NULL для свежих долгов.';
comment on column public.debts.rolled_over_to_id is
  'Если этот долг был перенесён — ссылка на дочерний (новый). NULL если не переносился.';
