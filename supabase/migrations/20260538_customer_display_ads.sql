-- Реклама на экране клиента (второй монитор операторской программы).
-- Контент управляется из веб-админки, оператор тянет активный плейлист
-- по company_id и проигрывает его в состоянии idle (между клиентами).

create table if not exists public.customer_display_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  url text not null,
  title text null,
  -- сколько секунд держать картинку; для видео null = играть до конца
  duration_sec integer null check (duration_sec is null or duration_sec > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists customer_display_ads_company_idx
  on public.customer_display_ads (company_id, is_active, sort_order);

alter table public.customer_display_ads enable row level security;

drop policy if exists customer_display_ads_select on public.customer_display_ads;
create policy customer_display_ads_select
  on public.customer_display_ads
  for select
  to authenticated
  using (public.can_access_company(company_id));

-- Storage bucket под видео/картинки рекламы (видео тяжелее — лимит 200MB).
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'customer-display-ads') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('customer-display-ads', 'customer-display-ads', true, 209715200);  -- 200MB
  end if;
end $$;

do $$ begin
  drop policy if exists "customer_display_ads_read" on storage.objects;
  create policy "customer_display_ads_read"
    on storage.objects for select
    using (bucket_id = 'customer-display-ads');

  drop policy if exists "customer_display_ads_write" on storage.objects;
  create policy "customer_display_ads_write"
    on storage.objects for insert
    with check (bucket_id = 'customer-display-ads');

  drop policy if exists "customer_display_ads_delete" on storage.objects;
  create policy "customer_display_ads_delete"
    on storage.objects for delete
    using (bucket_id = 'customer-display-ads');
end $$;

notify pgrst, 'reload schema';
