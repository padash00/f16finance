-- =====================================================================
-- Хард-удаление организации (покурга) одной атомарной транзакцией.
--
-- Порядок обязателен: companies.organization_id = ON DELETE RESTRICT, поэтому
-- сначала удаляем компании (их каскад чистит все company-данные), затем
-- явно чистим таблицы с ON DELETE SET NULL (иначе останется «висячий» мусор
-- с organization_id = null), и только потом — саму организацию (её каскад
-- уносит members, subscriptions, tenant_domains, billing и пр.).
--
-- Гейты в функции (защита от дурака, даже если API обойдут):
--   • организация должна быть archived;
--   • F16 (slug='f16') и billing_exempt удалять нельзя.
--
-- Аутентификационные аккаунты (auth.users) тут НЕ трогаем — их чистит API-слой
-- (только «чистые», не состоящие в других орг и не суперадмины).
-- =====================================================================

create or replace function public.delete_organization_cascade(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug   text;
  v_status text;
  v_exempt boolean;
begin
  select slug, status, coalesce(billing_exempt, false)
    into v_slug, v_status, v_exempt
  from public.organizations
  where id = p_org;

  if v_slug is null then
    raise exception 'organization % not found', p_org;
  end if;
  if v_slug = 'f16' then
    raise exception 'F16 нельзя удалить';
  end if;
  if v_exempt then
    raise exception 'billing-exempt организацию нельзя удалить';
  end if;
  if v_status is distinct from 'archived' then
    raise exception 'организацию сначала нужно архивировать (текущий статус: %)', v_status;
  end if;

  -- 1) Компании (RESTRICT) → удалить явно, каскад чистит их данные.
  delete from public.companies where organization_id = p_org;

  -- 2) Таблицы с ON DELETE SET NULL по орг → чистим явно, чтобы не осталось мусора.
  delete from public.incidents               where organization_id = p_org;
  delete from public.point_shifts            where organization_id = p_org;
  delete from public.point_receipt_settings  where organization_id = p_org;
  delete from public.staff_debt_payments     where organization_id = p_org;
  delete from public.customers               where organization_id = p_org;
  delete from public.staff                   where organization_id = p_org;

  -- 3) Сама организация → каскад уносит members, subscriptions, tenant_domains и т.д.
  delete from public.organizations where id = p_org;
end;
$$;

comment on function public.delete_organization_cascade(uuid) is
  'Хард-удаление организации (только archived, кроме F16/exempt). Атомарно. Аккаунты auth.users чистит API.';
