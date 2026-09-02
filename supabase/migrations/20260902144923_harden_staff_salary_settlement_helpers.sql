-- Internal salary-ledger helpers are executed only by triggers/service-role code.
revoke all on function public.staff_salary_settlement_refresh_status(uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_sync_payment_insert() from public,anon,authenticated;
revoke all on function public.staff_salary_apply_live_adjustment_row(uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_adjustment_insert_trigger() from public,anon,authenticated;
revoke all on function public.staff_salary_adjustment_status_trigger() from public,anon,authenticated;
revoke all on function public.staff_salary_resolve_point_debt_staff(uuid,text) from public,anon,authenticated;
revoke all on function public.staff_salary_recompute_point_debt_mirror(uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_apply_live_point_debt_row(uuid) from public,anon,authenticated;
revoke all on function public.staff_salary_point_debt_insert_trigger() from public,anon,authenticated;
revoke all on function public.staff_salary_payment_delete_trigger() from public,anon,authenticated;

grant execute on function public.staff_salary_settlement_refresh_status(uuid) to service_role;
grant execute on function public.staff_salary_apply_live_adjustment_row(uuid) to service_role;
grant execute on function public.staff_salary_resolve_point_debt_staff(uuid,text) to service_role;
grant execute on function public.staff_salary_recompute_point_debt_mirror(uuid) to service_role;
grant execute on function public.staff_salary_apply_live_point_debt_row(uuid) to service_role;
