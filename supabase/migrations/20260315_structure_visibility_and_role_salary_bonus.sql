alter table public.companies
add column if not exists show_in_structure boolean not null default true;

alter table public.operator_salary_rules
add column if not exists senior_operator_bonus integer not null default 0;

alter table public.operator_salary_rules
add column if not exists senior_cashier_bonus integer not null default 0;
