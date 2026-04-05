-- Витрина (point_display) больше не создаётся автоматически при создании точки.
-- Включение/выключение — через приложение (API), чтобы точка без витрины не участвовала в POS/остатках витрин.

create or replace function public.inventory_ensure_company_location()
returns trigger
language plpgsql
as $$
begin
  -- Только синхронизируем название/код уже существующей витрины; новую локацию не создаём.
  update public.inventory_locations
  set
    name = new.name,
    code = new.code,
    updated_at = timezone('utc', now())
  where company_id = new.id
    and location_type = 'point_display';

  return new;
end;
$$;
