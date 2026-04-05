update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('point_projects', 2)
where code = 'starter';

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('point_projects', 12)
where code = 'growth';

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('point_projects', 999)
where code = 'enterprise';
