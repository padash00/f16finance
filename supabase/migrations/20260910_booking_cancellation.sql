-- ─────────────────────────────────────────────────────────────────────────
-- Отмена брони: причина отдельно от заметки.
-- ─────────────────────────────────────────────────────────────────────────
-- Отмена уже была на сервере, но причина писалась в `notes` — то же поле, где
-- лежит просьба клиента. «Просил место у окна» превращалось в «передумал», и
-- восстановить исходное было неоткуда.
--
-- Заметка — это то, что сказал клиент при бронировании. Причина отмены — то,
-- что он сказал при отмене. Это разные разговоры и разные поля.

alter table public.client_bookings
  add column if not exists cancel_reason text null,
  add column if not exists cancelled_at timestamptz null,
  -- Кто отменил со стороны сайта. У кассы человека нет: устройство общее на
  -- точку, ответственность там привязана к смене через shift_id.
  add column if not exists cancelled_by_user_id uuid null references auth.users(id) on delete set null;

comment on column public.client_bookings.cancel_reason is
  'Почему бронь отменили. Отдельно от notes: заметка — про бронирование, причина — про отмену.';
comment on column public.client_bookings.cancelled_at is
  'Когда отменили. Нужен, чтобы отличить отменённую час назад от отменённой вчера.';
comment on column public.client_bookings.cancelled_by_user_id is
  'Кто отменил на сайте. NULL для отмены из кассы — там ответственность через shift_id.';

-- Список отмен за смену и «что отменяли последним» — оба запроса идут по
-- времени отмены, а не по времени брони.
create index if not exists idx_client_bookings_cancelled_at
  on public.client_bookings (company_id, cancelled_at desc)
  where cancelled_at is not null;

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ─────────────────────────────────────────────
-- select count(*) as всего,
--        count(*) filter (where status = 'cancelled') as отменённых,
--        count(*) filter (where cancelled_at is not null) as с_датой_отмены
--   from public.client_bookings;
--
-- Ожидается: с датой отмены — ноль. Старые отмены задним числом не
-- восстанавливаются: когда их отменили, никто не записывал.
