-- Отправка чека продажи на почту покупателя.
--
-- Очередь, а не отправка в лоб. SMTP (особенно Gmail) иногда отказывает на
-- минуту — лимиты, сеть, таймаут. Если отправлять прямо в запросе и забыть при
-- ошибке, чек пропадает, а покупатель уверен, что его отправили. Поэтому:
--   1. роут кладёт строку сюда и сразу пытается отправить;
--   2. не вышло — строка остаётся pending с next_attempt_at в будущем;
--   3. крон /api/cron/sale-receipt-emails добирает хвост с нарастающей паузой;
--   4. после пятой неудачи — failed, с текстом ошибки в last_error.
--
-- Продажу отправка не блокирует никогда: чек уже проведён к этому моменту.
--
-- Общую client_notification_outbox не берём: там customer_id NOT NULL, а чек
-- чаще всего просит случайный покупатель без карточки клиента, и там нет
-- повторов — первая ошибка навсегда переводит строку в failed.

create table if not exists public.sale_receipt_emails (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.point_sales(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz null,
  -- Кто попросил: 'point:<id устройства>' или 'staff:<id пользователя>'
  requested_by text null,
  created_at timestamptz not null default now()
);

-- Крон берёт только то, что пора отправлять
create index if not exists idx_sale_receipt_emails_due
  on public.sale_receipt_emails (next_attempt_at)
  where status = 'pending';

-- История отправок по чеку и защита от двойного клика
create index if not exists idx_sale_receipt_emails_sale
  on public.sale_receipt_emails (sale_id, created_at desc);

create index if not exists idx_sale_receipt_emails_org
  on public.sale_receipt_emails (organization_id, created_at desc);

comment on table public.sale_receipt_emails is
  'Очередь писем с чеком продажи. pending → sent | failed; повторы с нарастающей паузой, не больше 5 попыток.';

-- Пишут и читают только серверные роуты под service role (обходит RLS), политик нет
alter table public.sale_receipt_emails enable row level security;

notify pgrst, 'reload schema';
