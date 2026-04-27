-- HR dismissals: add dismissal date (separate from timestamp) and dismissal type.
-- Types: voluntary, mutual_agreement, cause, contract_end, other.

alter table public.staff
  add column if not exists dismissal_date date null,
  add column if not exists dismissal_type text null;

alter table public.operators
  add column if not exists dismissal_date date null,
  add column if not exists dismissal_type text null;

alter table public.staff
  drop constraint if exists staff_dismissal_type_check;
alter table public.staff
  add constraint staff_dismissal_type_check
  check (dismissal_type is null or dismissal_type in ('voluntary','mutual_agreement','cause','contract_end','other'));

alter table public.operators
  drop constraint if exists operators_dismissal_type_check;
alter table public.operators
  add constraint operators_dismissal_type_check
  check (dismissal_type is null or dismissal_type in ('voluntary','mutual_agreement','cause','contract_end','other'));
