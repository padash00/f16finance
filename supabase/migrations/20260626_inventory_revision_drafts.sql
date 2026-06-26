-- Серверный черновик ревизии: подсчёты по позициям ДО проведения ревизии.
-- Зачем: localStorage-черновик жил только на одном устройстве. Серверный —
-- переживает смену устройства И позволяет нескольким кассирам считать одну точку
-- совместно (общий счёт, без конфликтов: позиция = последний подсчёт).
-- Доступ только service-role клиентом store-роутов (RLS включён без политик).

create table if not exists public.inventory_revision_drafts (
  location_id     uuid        not null,
  item_id         uuid        not null,
  draft_date      date        not null default current_date,
  actual_qty      numeric     not null default 0,
  counted_by      uuid,
  organization_id uuid,
  updated_at      timestamptz not null default now(),
  primary key (location_id, item_id, draft_date)
);

create index if not exists inventory_revision_drafts_loc_date_idx
  on public.inventory_revision_drafts (location_id, draft_date);

alter table public.inventory_revision_drafts enable row level security;

comment on table public.inventory_revision_drafts is
  'Черновик ревизии: подсчёты по позициям (location_id,item_id,draft_date) до проведения. Доступ только service-role.';
