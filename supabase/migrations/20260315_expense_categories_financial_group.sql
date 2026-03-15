alter table public.expense_categories
  add column if not exists accounting_group text not null default 'operating';

update public.expense_categories
set accounting_group = case
  when lower(name) like '%аванс%' then 'payroll_advance'
  when lower(name) like '%осмс%' then 'payroll_tax'
  when lower(name) like '%соц%' then 'payroll_tax'
  when lower(name) like '%социальн%' then 'payroll_tax'
  when lower(name) like '%пенсион%' then 'payroll_tax'
  when lower(name) like '%зарплатн%' then 'payroll_tax'
  when lower(name) = 'налоги' then 'income_tax'
  when lower(name) like '%3%%' then 'income_tax'
  when lower(name) like '%ипн%' then 'income_tax'
  when lower(name) like '%кпн%' then 'income_tax'
  when lower(name) like '%налог на прибыль%' then 'income_tax'
  when lower(name) = 'зп' then 'payroll'
  when lower(name) like '%зарплат%' then 'payroll'
  when lower(name) like '%фот%' then 'payroll'
  when lower(name) like '%штраф%' then 'non_operating'
  when lower(name) like '%разов%' then 'non_operating'
  else accounting_group
end;
