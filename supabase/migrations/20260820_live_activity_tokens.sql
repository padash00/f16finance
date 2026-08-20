-- Адреса живых активностей смены.
--
-- Карточка смены на экране блокировки обновлялась только изнутри приложения:
-- телефон должен был сам сходить за свежими цифрами. Но продажи пробивают не в
-- телефоне — их пробивают на точке, в операторской программе. Пока приложение
-- лежит в кармане, оно ничего не знает, и на блокировке висят цифры того
-- момента, когда экран последний раз открывали.
--
-- Apple даёт живой активности собственный адрес для уведомлений — отдельный от
-- адреса устройства. Здесь мы его храним, чтобы сервер мог дослать новое
-- состояние сам, когда на точке что-то продали.

create table if not exists public.live_activity_tokens (
  token text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Смена, к которой привязана карточка. Закрылась смена — адрес больше не
  -- нужен: активность на телефоне уже завершена.
  shift_id uuid null references public.point_shifts(id) on delete cascade,
  -- Кому принадлежит телефон: по нему чистим при выходе из аккаунта.
  user_id uuid null,
  operator_id uuid null references public.operators(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_activity_tokens_company
  on public.live_activity_tokens(company_id);

create index if not exists idx_live_activity_tokens_shift
  on public.live_activity_tokens(shift_id);

comment on table public.live_activity_tokens is
  'Адреса Live Activity: сервер шлёт по ним обновление карточки смены на экране блокировки.';

-- Доступ только через серверные роуты: клиенты сюда не ходят.
alter table public.live_activity_tokens enable row level security;
