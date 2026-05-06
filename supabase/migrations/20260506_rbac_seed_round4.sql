-- Засев финальных 4 capabilities (включая мелкие — clipboard, drag-drop).
-- Каталог: 334 → 338. Идемпотентная.

do $$
declare
  v_role text;
  v_capability text;
  v_new_capabilities text[] := array[
    'discounts.copy_promo',
    'operators.copy_profile_data',
    'forecast.cancel_generation',
    'structure.drag_drop_reorder'
  ];
  v_existing_roles text[];
begin
  select array_agg(distinct role) into v_existing_roles from role_capabilities;
  if v_existing_roles is null or array_length(v_existing_roles, 1) is null then
    v_existing_roles := array['owner','manager','marketer','other','super_admin'];
  end if;

  foreach v_role in array v_existing_roles loop
    foreach v_capability in array v_new_capabilities loop
      insert into role_capabilities (role, capability, granted)
      values (v_role, v_capability, true)
      on conflict (role, capability) do nothing;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
