-- Блокировка собеседника в личных сообщениях.
--
-- Требование App Store к приложениям с перепиской: человек должен уметь
-- прекратить общение с тем, кто ведёт себя недопустимо, — сам, из приложения,
-- не дожидаясь решения владельца.
--
-- Блокировка односторонняя и не афишируется: заблокированный не получает
-- уведомления об этом. Он просто перестаёт доходить.
create table if not exists public.direct_message_blocks (
  id uuid primary key default gen_random_uuid(),
  -- Кто заблокировал.
  user_id uuid not null,
  -- Кого заблокировали.
  blocked_user_id uuid not null,
  reason text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, blocked_user_id)
);

create index if not exists idx_dm_blocks_user
  on public.direct_message_blocks(user_id);

create index if not exists idx_dm_blocks_blocked
  on public.direct_message_blocks(blocked_user_id);

alter table public.direct_message_blocks enable row level security;

-- Доступ к таблице идёт только через API с сервисным ключом: своя политика
-- здесь была бы вторым набором правил, который однажды разойдётся с первым.
drop policy if exists dm_blocks_all on public.direct_message_blocks;
create policy dm_blocks_all on public.direct_message_blocks for all using (true) with check (true);
