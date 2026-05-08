-- Live-presence для operator desktop:
-- — last_operator_id — кто сейчас залогинен на терминале
-- — last_active_at — когда последний раз был API-запрос (alias для last_seen_at, читать через индекс)
-- — last_app_version — какая версия operator запущена
-- + мини-таблица point_device_messages — для push-уведомлений с сайта в operator

alter table public.point_projects
  add column if not exists last_operator_id uuid references public.operators(id) on delete set null,
  add column if not exists last_app_version text;

create index if not exists idx_point_projects_last_seen_at on public.point_projects(last_seen_at desc);

-- Сообщения от админа в operator (опрашиваются operator каждые 30с)
create table if not exists public.point_device_messages (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.point_projects(id) on delete cascade,
  -- Тип сообщения: info / warning / urgent / lock_sales / unlock_sales
  kind text not null default 'info' check (kind in ('info', 'warning', 'urgent', 'lock_sales', 'unlock_sales')),
  body text not null default '',
  -- Кто отправил (auth user)
  sent_by uuid null,
  sent_by_name text null,
  -- Доставлено ли operator (operator делает PATCH с delivered_at когда увидит)
  delivered_at timestamptz null,
  acknowledged_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz null
);

create index if not exists idx_point_device_messages_device_pending
  on public.point_device_messages(device_id, delivered_at)
  where delivered_at is null;

alter table public.point_device_messages enable row level security;
drop policy if exists point_device_messages_all on public.point_device_messages;
create policy point_device_messages_all on public.point_device_messages for all using (true) with check (true);

-- Идемпотентность по local_ref: если operator повторно отправил продажу/возврат с
-- тем же local_ref (флапнула сеть) — БД не создаст дубль.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'point_sales') then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'point_sales' and column_name = 'local_ref') then
      create unique index if not exists point_sales_local_ref_unique on public.point_sales(company_id, local_ref) where local_ref is not null;
    end if;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'point_returns') then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'point_returns' and column_name = 'local_ref') then
      create unique index if not exists point_returns_local_ref_unique on public.point_returns(company_id, local_ref) where local_ref is not null;
    end if;
  end if;
end $$;

-- Reload schema cache
notify pgrst, 'reload schema';
