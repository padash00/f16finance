-- ─────────────────────────────────────────────────────────────────────────
-- Бронь, время которой прошло, закрывается сама.
-- ─────────────────────────────────────────────────────────────────────────
-- До сих пор бронь оставалась «подтверждённой» вечно. На карте она исчезала
-- (там окно от текущего момента), но в базе висела активной, и в истории
-- номера все прошлые вечера выглядели как незакрытые обещания.
--
-- ПОЧЕМУ НЕ `completed`. Этот статус означает «состоялась» — то есть человек
-- пришёл. Мы этого не знаем: отметку явки никто не ставит и ставить не будет
-- (см. 20260909). Записать «состоялась» на основании одного лишь времени —
-- это выдумать факт. Поэтому вводится честный `expired`: время прошло, что
-- было на самом деле — неизвестно.
--
-- Когда агент будет стоять на всех машинах, слой наблюдения сможет отличить
-- пришедших от неявившихся, и `completed` начнёт значить то, что написано.

alter table public.client_bookings
  drop constraint if exists client_bookings_status_check;

alter table public.client_bookings
  add constraint client_bookings_status_check check (
    status in ('requested', 'confirmed', 'cancelled', 'completed', 'rejected', 'expired')
  );

comment on column public.client_bookings.status is
  'requested/confirmed — живая бронь; cancelled — сняли; expired — время прошло, приходил ли человек, неизвестно; completed — состоялась (ставится только по факту наблюдения).';

-- Крон каждый час спрашивает: что уже закончилось и всё ещё числится живым.
create index if not exists idx_client_bookings_active_ends
  on public.client_bookings (ends_at)
  where status in ('requested', 'confirmed') and ends_at is not null;

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ─────────────────────────────────────────────
-- select status, count(*) from public.client_bookings group by status;
--
-- Ожидается: статусы прежние, `expired` появится после первого прогона крона
-- /api/cron/expire-bookings.
