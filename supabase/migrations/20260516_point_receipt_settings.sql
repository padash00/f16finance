-- Настройки реквизитов фискального чека ККМ согласно Приказу Министра финансов РК
-- от 24.10.2025 № 626 «О некоторых вопросах, связанных с применением ККМ»
-- (вступает в силу с 01.01.2026).
--
-- Каждая точка (companies row) имеет свои реквизиты: наименование налогоплательщика,
-- БИН/ИИН, адрес, заводской и регистрационный номера ККМ, ставка/сумма НДС,
-- наименование ОФД + ссылка на его портал и др.
--
-- Поля для маркировки товаров и кода НКТ зарезервированы, но логика отключена
-- (включается отдельной миграцией позже).

create table if not exists public.point_receipt_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete set null,

  -- Налогоплательщик
  tax_payer_name text not null default '',
  tax_payer_bin text not null default '',         -- БИН или ИИН
  point_address text not null default '',

  -- ККМ
  kkm_factory_number text not null default '',     -- заводской номер
  kkm_registration_number text not null default '', -- регистрационный номер в налоговом органе

  -- НДС
  is_vat_payer boolean not null default false,
  vat_rate numeric(5, 2) not null default 12.00,

  -- ОФД (оператор фискальных данных)
  ofd_name text not null default '',
  ofd_check_url text not null default '',          -- ссылка на портал для проверки чека

  -- Языки / двуязычие
  receipt_language text not null default 'ru' check (receipt_language in ('ru', 'kk', 'both')),

  -- Дополнительно
  receipt_footer_text text not null default '',    -- произвольный текст в конце чека (благодарности, и т.п.)
  require_buyer_iin boolean not null default false, -- спрашивать ИИН покупателя

  -- Маркировка/НКТ — placeholders на будущее, не используются в логике
  marking_enabled boolean not null default false,
  nkt_enabled boolean not null default false,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ux_point_receipt_settings_company
  on public.point_receipt_settings(company_id);

create index if not exists idx_point_receipt_settings_org
  on public.point_receipt_settings(organization_id);

-- updated_at trigger
create or replace function public.point_receipt_settings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_point_receipt_settings_touch on public.point_receipt_settings;
create trigger trg_point_receipt_settings_touch
  before update on public.point_receipt_settings
  for each row execute function public.point_receipt_settings_touch();

-- RLS
alter table public.point_receipt_settings enable row level security;

drop policy if exists "point_receipt_settings — service role only" on public.point_receipt_settings;
create policy "point_receipt_settings — service role only"
  on public.point_receipt_settings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.point_receipt_settings is
  'Реквизиты фискального чека ККМ по точке. По приказу Минфина РК №626 от 24.10.2025.';
comment on column public.point_receipt_settings.marking_enabled is
  'Маркировка товаров (зарезервировано, логика появится позже).';
comment on column public.point_receipt_settings.nkt_enabled is
  'Код товара по НКТ (зарезервировано, логика появится позже).';

notify pgrst, 'reload schema';
