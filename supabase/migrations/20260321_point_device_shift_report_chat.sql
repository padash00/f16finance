alter table if exists public.point_devices
  add column if not exists shift_report_chat_id text;
