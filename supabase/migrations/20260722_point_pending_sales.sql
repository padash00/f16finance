-- ─────────────────────────────────────────────────────────────────────────────
-- Операторка v2.9: сервер видит размер локальной офлайн-очереди каждой кассы.
--
-- Касса сообщает счётчик неотправленных продаж в sync-check (раз в ~30с);
-- крон offline-sales-alert алертит владельцу в Telegram, если очередь висит
-- дольше 30 минут или касса давно не выходила на связь.
-- Идемпотентно — безопасно прогонять повторно.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.point_devices add column if not exists pending_sales_count integer not null default 0;
alter table public.point_devices add column if not exists attention_sales_count integer not null default 0;
alter table public.point_devices add column if not exists pending_since timestamptz null;
alter table public.point_devices add column if not exists last_offline_alert_at timestamptz null;

comment on column public.point_devices.pending_sales_count is 'Размер локальной офлайн-очереди кассы (продажи, ждущие отправки) — из sync-check';
comment on column public.point_devices.attention_sales_count is 'Продажи, отклонённые сервером по существу (требуют внимания человека)';
comment on column public.point_devices.pending_since is 'С какого момента очередь непуста (для порога алерта 30 мин)';
comment on column public.point_devices.last_offline_alert_at is 'Когда последний раз алертили по этой кассе (анти-спам, раз в 2 часа)';

notify pgrst, 'reload schema';
