-- Привязка арены к открытой смене и фиксация возврата при досрочном завершении.

alter table public.arena_sessions
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null,
  add column if not exists refund_amount numeric not null default 0,
  add column if not exists refund_cash_amount numeric not null default 0,
  add column if not exists refund_kaspi_amount numeric not null default 0,
  add column if not exists refund_at timestamptz null;

create index if not exists idx_arena_sessions_shift_id
  on public.arena_sessions(shift_id)
  where shift_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'arena_sessions_refund_amount_nonnegative'
      and conrelid = 'public.arena_sessions'::regclass
  ) then
    alter table public.arena_sessions
      add constraint arena_sessions_refund_amount_nonnegative
      check (refund_amount >= 0 and refund_cash_amount >= 0 and refund_kaspi_amount >= 0);
  end if;
end $$;

comment on column public.arena_sessions.shift_id is
  'Открытая POS-смена, в рамках которой стартовала/продлевалась arena-сессия.';

comment on column public.arena_sessions.refund_amount is
  'Сумма возврата при досрочном завершении arena-сессии.';
