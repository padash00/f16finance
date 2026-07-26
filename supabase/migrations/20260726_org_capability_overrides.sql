-- Пульт супер-админа: пер-организационный оверрайд отдельных действий (кнопок).
-- Модель: общий рубильник на всю орг. Строка = оверрайд конкретного права для
-- всей организации. enabled=false → право выключено у ВСЕХ в этой орг (включая
-- владельца), кроме супер-админа. Отсутствие строки = дефолт (право доступно).
create table if not exists public.organization_capability_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  capability text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (organization_id, capability)
);

create index if not exists idx_org_cap_overrides_org
  on public.organization_capability_overrides (organization_id);

-- Доступ только через service-role API (супер-админ). Прямой доступ арендаторов
-- закрыт: включаем RLS без политик — клиентские ключи ничего не увидят.
alter table public.organization_capability_overrides enable row level security;
