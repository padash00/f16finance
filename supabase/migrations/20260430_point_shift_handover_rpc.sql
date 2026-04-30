create or replace function public.point_shift_handover(
  p_prev_shift_id uuid,
  p_closed_by uuid,
  p_closing_cash numeric,
  p_closing_kaspi numeric,
  p_kaspi_before_midnight numeric,
  p_kaspi_after_midnight numeric,
  p_z_report_url text,
  p_x_report_url text,
  p_closing_notes text,
  p_company_id uuid,
  p_operator_id uuid,
  p_point_device_id uuid,
  p_shift_type text,
  p_opening_cash numeric,
  p_opening_notes text
)
returns jsonb
language plpgsql
as $$
declare
  v_totals jsonb;
  v_new_shift_id uuid;
begin
  v_totals := public.point_shift_close(
    p_prev_shift_id,
    p_closed_by,
    p_closing_cash,
    p_closing_kaspi,
    p_kaspi_before_midnight,
    p_kaspi_after_midnight,
    p_z_report_url,
    p_x_report_url,
    p_closing_notes
  );

  v_new_shift_id := public.point_shift_open(
    p_company_id,
    p_operator_id,
    p_point_device_id,
    coalesce(p_shift_type, 'day'),
    p_opening_cash,
    p_opening_notes,
    p_prev_shift_id
  );

  return jsonb_build_object(
    'previous_shift_id', p_prev_shift_id,
    'new_shift_id', v_new_shift_id,
    'totals', v_totals
  );
end;
$$;
