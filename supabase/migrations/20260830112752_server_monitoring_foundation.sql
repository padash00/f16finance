-- ORDA Server Monitoring: tenant-safe storage and alerting foundation.
--
-- This migration does not seed a production server or an agent secret. A server
-- and its one-time key are created later through the authenticated Next.js API.
-- The Windows agent never connects to Supabase directly.

-- ============================================================================
-- 1. Server registry and credentials
-- ============================================================================

create table public.server_monitor_servers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,

  code text not null,
  name text not null,
  hostname text null,
  description text null,
  enabled boolean not null default true,

  -- Server receive time is authoritative for offline detection. Agent clocks
  -- are retained on telemetry rows but are never used as the heartbeat clock.
  last_seen_at timestamptz null,
  last_agent_version text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint server_monitor_servers_code_check
    check (code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint server_monitor_servers_name_check
    check (char_length(btrim(name)) between 1 and 120),
  constraint server_monitor_servers_hostname_check
    check (hostname is null or char_length(btrim(hostname)) between 1 and 255),
  constraint server_monitor_servers_id_organization_uniq
    unique (id, organization_id),
  constraint server_monitor_servers_organization_code_uniq
    unique (organization_id, code)
);

comment on table public.server_monitor_servers is
  'Configured Windows servers. last_seen_at is set from backend receive time.';
comment on column public.server_monitor_servers.code is
  'Stable human-readable code; the agent protocol uses the UUID id as serverId.';

create index idx_server_monitor_servers_organization
  on public.server_monitor_servers (organization_id, enabled, name);
create index idx_server_monitor_servers_company
  on public.server_monitor_servers (company_id)
  where company_id is not null;
create index idx_server_monitor_servers_last_seen
  on public.server_monitor_servers (last_seen_at)
  where enabled = true;

create table public.server_monitor_agent_keys (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.server_monitor_servers(id) on delete cascade,

  -- Token format: <key_id>.<random secret>. key_id is a lookup identifier and
  -- is not secret. Only the SHA-256 hash of a high-entropy secret is stored.
  key_id text not null,
  secret_hash text not null,
  label text null,
  status text not null default 'active',

  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,

  constraint server_monitor_agent_keys_key_id_uniq unique (key_id),
  constraint server_monitor_agent_keys_secret_hash_uniq unique (secret_hash),
  constraint server_monitor_agent_keys_id_server_uniq unique (id, server_id),
  constraint server_monitor_agent_keys_key_id_check
    check (key_id ~ '^smk_[a-z0-9]{12,48}$'),
  constraint server_monitor_agent_keys_secret_hash_check
    check (secret_hash ~ '^[0-9a-f]{64}$'),
  constraint server_monitor_agent_keys_status_check
    check (status in ('active', 'revoked')),
  constraint server_monitor_agent_keys_expiry_check
    check (expires_at is null or expires_at > created_at),
  constraint server_monitor_agent_keys_revocation_check
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

comment on table public.server_monitor_agent_keys is
  'Agent credentials. Plaintext secrets are never stored and are shown only once at creation.';

create index idx_server_monitor_agent_keys_server_status
  on public.server_monitor_agent_keys (server_id, status, created_at desc);
create index idx_server_monitor_agent_keys_created_by
  on public.server_monitor_agent_keys (created_by)
  where created_by is not null;

-- ============================================================================
-- 2. Per-server settings and current telemetry
-- ============================================================================

create table public.server_monitor_settings (
  server_id uuid primary key,
  organization_id uuid not null,

  cpu_temp_warning_c numeric(6,2) not null default 80,
  cpu_temp_critical_c numeric(6,2) not null default 90,
  cpu_usage_warning_pct numeric(6,2) not null default 90,
  cpu_usage_critical_pct numeric(6,2) not null default 98,
  ram_usage_warning_pct numeric(6,2) not null default 90,
  ram_usage_critical_pct numeric(6,2) not null default 97,
  disk_temp_warning_c numeric(6,2) not null default 65,
  disk_temp_critical_c numeric(6,2) not null default 75,
  disk_free_warning_pct numeric(6,2) not null default 15,
  disk_free_critical_pct numeric(6,2) not null default 7,

  cpu_temp_hysteresis_c numeric(6,2) not null default 5,
  cpu_usage_hysteresis_pct numeric(6,2) not null default 5,
  ram_usage_hysteresis_pct numeric(6,2) not null default 5,
  disk_temp_hysteresis_c numeric(6,2) not null default 5,
  disk_free_hysteresis_pct numeric(6,2) not null default 3,
  recovery_samples smallint not null default 2,

  offline_timeout_seconds integer not null default 120,
  history_bucket_seconds integer not null default 300,
  history_retention_days smallint not null default 30,

  telegram_enabled boolean not null default true,
  notify_warning boolean not null default true,
  notify_critical boolean not null default true,
  notify_recovery boolean not null default true,

  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint server_monitor_settings_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_settings_temperature_order_check
    check (cpu_temp_warning_c < cpu_temp_critical_c and disk_temp_warning_c < disk_temp_critical_c),
  constraint server_monitor_settings_usage_order_check
    check (cpu_usage_warning_pct < cpu_usage_critical_pct and ram_usage_warning_pct < ram_usage_critical_pct),
  constraint server_monitor_settings_disk_free_order_check
    check (disk_free_critical_pct < disk_free_warning_pct),
  constraint server_monitor_settings_percent_range_check
    check (
      cpu_usage_warning_pct between 0 and 100
      and cpu_usage_critical_pct between 0 and 100
      and ram_usage_warning_pct between 0 and 100
      and ram_usage_critical_pct between 0 and 100
      and disk_free_warning_pct between 0 and 100
      and disk_free_critical_pct between 0 and 100
    ),
  constraint server_monitor_settings_temperature_range_check
    check (
      cpu_temp_warning_c between -50 and 200
      and cpu_temp_critical_c between -50 and 200
      and disk_temp_warning_c between -50 and 200
      and disk_temp_critical_c between -50 and 200
    ),
  constraint server_monitor_settings_hysteresis_check
    check (
      cpu_temp_hysteresis_c between 0 and 50
      and cpu_usage_hysteresis_pct between 0 and 50
      and ram_usage_hysteresis_pct between 0 and 50
      and disk_temp_hysteresis_c between 0 and 50
      and disk_free_hysteresis_pct between 0 and 50
    ),
  constraint server_monitor_settings_recovery_samples_check
    check (recovery_samples between 1 and 10),
  constraint server_monitor_settings_offline_timeout_check
    check (offline_timeout_seconds between 60 and 3600),
  constraint server_monitor_settings_history_bucket_check
    check (history_bucket_seconds between 60 and 3600),
  constraint server_monitor_settings_history_retention_check
    check (history_retention_days between 1 and 365)
);

comment on table public.server_monitor_settings is
  'Backend-owned thresholds, hysteresis, retention, and notification preferences.';

create index idx_server_monitor_settings_organization
  on public.server_monitor_settings (organization_id);
create index idx_server_monitor_settings_updated_by
  on public.server_monitor_settings (updated_by)
  where updated_by is not null;

create table public.server_monitor_current (
  server_id uuid primary key,
  organization_id uuid not null,

  telemetry_id uuid not null,
  schema_version smallint not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  agent_version text null,

  hostname text null,
  windows_version text null,
  uptime_seconds bigint null,
  last_boot_at timestamptz null,

  cpu_usage_pct numeric(6,2) null,
  cpu_package_temp_c numeric(6,2) null,
  cpu_core_max_temp_c numeric(6,2) null,
  memory_usage_pct numeric(6,2) null,
  internet_connected boolean null,
  ping_ms numeric(12,3) null,
  network_rx_bps numeric(20,2) null,
  network_tx_bps numeric(20,2) null,

  system_data jsonb not null default '{}'::jsonb,
  cpu_data jsonb not null default '{}'::jsonb,
  memory_data jsonb not null default '{}'::jsonb,
  disks_data jsonb not null default '[]'::jsonb,
  network_data jsonb not null default '[]'::jsonb,

  row_version bigint not null default 1,
  updated_at timestamptz not null default now(),

  constraint server_monitor_current_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_current_schema_version_check
    check (schema_version between 1 and 1000),
  constraint server_monitor_current_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint server_monitor_current_uptime_check
    check (uptime_seconds is null or uptime_seconds >= 0),
  constraint server_monitor_current_percentage_check
    check (
      (cpu_usage_pct is null or cpu_usage_pct between 0 and 100)
      and (memory_usage_pct is null or memory_usage_pct between 0 and 100)
    ),
  constraint server_monitor_current_temperature_check
    check (
      (cpu_package_temp_c is null or cpu_package_temp_c between -100 and 250)
      and (cpu_core_max_temp_c is null or cpu_core_max_temp_c between -100 and 250)
    ),
  constraint server_monitor_current_network_check
    check (
      (ping_ms is null or ping_ms between 0 and 600000)
      and (network_rx_bps is null or network_rx_bps >= 0)
      and (network_tx_bps is null or network_tx_bps >= 0)
    ),
  constraint server_monitor_current_json_shape_check
    check (
      jsonb_typeof(system_data) = 'object'
      and jsonb_typeof(cpu_data) = 'object'
      and jsonb_typeof(memory_data) = 'object'
      and jsonb_typeof(disks_data) = 'array'
      and jsonb_typeof(network_data) = 'array'
    )
);

comment on table public.server_monitor_current is
  'Latest accepted telemetry per server. Sensor values may be null when unavailable without drivers.';

create index idx_server_monitor_current_organization_received
  on public.server_monitor_current (organization_id, received_at desc);

-- ============================================================================
-- 3. Bounded history and ingest idempotency
-- ============================================================================

create table public.server_monitor_metric_samples (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  organization_id uuid not null,

  bucket_start timestamptz not null,
  observed_at timestamptz not null,
  received_at timestamptz not null,

  cpu_usage_pct numeric(6,2) null,
  cpu_package_temp_c numeric(6,2) null,
  cpu_core_max_temp_c numeric(6,2) null,
  memory_usage_pct numeric(6,2) null,
  internet_connected boolean null,
  ping_ms numeric(12,3) null,
  network_rx_bps numeric(20,2) null,
  network_tx_bps numeric(20,2) null,
  uptime_seconds bigint null,

  disks_data jsonb not null default '[]'::jsonb,
  network_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),

  constraint server_monitor_metric_samples_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_metric_samples_server_bucket_uniq
    unique (server_id, bucket_start),
  constraint server_monitor_metric_samples_percentage_check
    check (
      (cpu_usage_pct is null or cpu_usage_pct between 0 and 100)
      and (memory_usage_pct is null or memory_usage_pct between 0 and 100)
    ),
  constraint server_monitor_metric_samples_temperature_check
    check (
      (cpu_package_temp_c is null or cpu_package_temp_c between -100 and 250)
      and (cpu_core_max_temp_c is null or cpu_core_max_temp_c between -100 and 250)
    ),
  constraint server_monitor_metric_samples_network_check
    check (
      (ping_ms is null or ping_ms between 0 and 600000)
      and (network_rx_bps is null or network_rx_bps >= 0)
      and (network_tx_bps is null or network_tx_bps >= 0)
      and (uptime_seconds is null or uptime_seconds >= 0)
    ),
  constraint server_monitor_metric_samples_json_shape_check
    check (jsonb_typeof(disks_data) = 'array' and jsonb_typeof(network_data) = 'array')
);

comment on table public.server_monitor_metric_samples is
  'Downsampled history. One row per server and bucket; default bucket is five minutes.';

create index idx_server_monitor_metric_samples_server_time
  on public.server_monitor_metric_samples (server_id, bucket_start desc);
create index idx_server_monitor_metric_samples_organization_time
  on public.server_monitor_metric_samples (organization_id, bucket_start desc);

create table public.server_monitor_ingest_receipts (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  organization_id uuid not null,
  agent_key_id uuid null,

  telemetry_id uuid not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_hash text not null,

  constraint server_monitor_ingest_receipts_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_ingest_receipts_agent_key_fkey
    foreign key (agent_key_id, server_id)
    references public.server_monitor_agent_keys(id, server_id)
    on delete restrict,
  constraint server_monitor_ingest_receipts_telemetry_uniq
    unique (server_id, telemetry_id),
  constraint server_monitor_ingest_receipts_payload_uniq
    unique (server_id, observed_at, payload_hash),
  constraint server_monitor_ingest_receipts_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.server_monitor_ingest_receipts is
  'Short-lived idempotency receipts. Payload bodies and secrets are not stored here.';

create index idx_server_monitor_ingest_receipts_received
  on public.server_monitor_ingest_receipts (received_at);
create index idx_server_monitor_ingest_receipts_agent_key
  on public.server_monitor_ingest_receipts (agent_key_id, server_id)
  where agent_key_id is not null;

-- ============================================================================
-- 4. Stateful alert incidents and append-only transition history
-- ============================================================================

create table public.server_monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  organization_id uuid not null,

  rule_code text not null,
  subject_key text not null,
  severity text not null,
  status text not null default 'active',

  title text not null,
  message text not null,
  metric text null,
  value_unit text null,
  opening_value numeric null,
  current_value numeric null,
  opening_threshold numeric null,
  current_threshold numeric null,
  resolution_value numeric null,
  context jsonb not null default '{}'::jsonb,

  started_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint server_monitor_alerts_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_alerts_identity_uniq
    unique (id, server_id, organization_id),
  constraint server_monitor_alerts_rule_code_check
    check (rule_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint server_monitor_alerts_subject_key_check
    check (char_length(btrim(subject_key)) between 1 and 160),
  constraint server_monitor_alerts_severity_check
    check (severity in ('warning', 'critical')),
  constraint server_monitor_alerts_status_check
    check (status in ('active', 'resolved')),
  constraint server_monitor_alerts_resolution_check
    check (
      (status = 'active' and resolved_at is null)
      or (status = 'resolved' and resolved_at is not null)
    ),
  constraint server_monitor_alerts_context_shape_check
    check (jsonb_typeof(context) = 'object'),
  constraint server_monitor_alerts_time_order_check
    check (last_observed_at >= started_at and (resolved_at is null or resolved_at >= started_at))
);

comment on table public.server_monitor_alerts is
  'Alert incidents. A unique partial index permits only one active incident per rule subject.';

create unique index uq_server_monitor_alerts_active_subject
  on public.server_monitor_alerts (server_id, rule_code, subject_key)
  where status = 'active';
create index idx_server_monitor_alerts_organization_status
  on public.server_monitor_alerts (organization_id, status, severity, started_at desc);
create index idx_server_monitor_alerts_server_history
  on public.server_monitor_alerts (server_id, started_at desc);

create table public.server_monitor_alert_state (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  organization_id uuid not null,

  rule_code text not null,
  subject_key text not null,
  state text not null default 'normal',
  normal_streak smallint not null default 0,
  last_value numeric null,
  last_threshold numeric null,
  last_observed_at timestamptz null,
  last_transition_at timestamptz null,
  active_alert_id uuid null,
  row_version bigint not null default 1,
  updated_at timestamptz not null default now(),

  constraint server_monitor_alert_state_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_alert_state_active_alert_fkey
    foreign key (active_alert_id, server_id, organization_id)
    references public.server_monitor_alerts(id, server_id, organization_id)
    on delete restrict,
  constraint server_monitor_alert_state_subject_uniq
    unique (server_id, rule_code, subject_key),
  constraint server_monitor_alert_state_rule_code_check
    check (rule_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint server_monitor_alert_state_subject_key_check
    check (char_length(btrim(subject_key)) between 1 and 160),
  constraint server_monitor_alert_state_state_check
    check (state in ('normal', 'warning', 'critical')),
  constraint server_monitor_alert_state_streak_check
    check (normal_streak between 0 and 100),
  constraint server_monitor_alert_state_active_alert_check
    check (
      (state = 'normal' and active_alert_id is null)
      or (state in ('warning', 'critical') and active_alert_id is not null)
    )
);

comment on table public.server_monitor_alert_state is
  'Mutable evaluator state for hysteresis and consecutive-normal recovery checks.';

create index idx_server_monitor_alert_state_server
  on public.server_monitor_alert_state (server_id, state);
create index idx_server_monitor_alert_state_active_alert
  on public.server_monitor_alert_state (active_alert_id, server_id, organization_id)
  where active_alert_id is not null;

create table public.server_monitor_alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null,
  server_id uuid not null,
  organization_id uuid not null,

  transition text not null,
  severity text not null,
  rule_code text not null,
  subject_key text not null,
  title text not null,
  message text not null,
  value numeric null,
  threshold numeric null,
  value_unit text null,
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint server_monitor_alert_events_alert_identity_fkey
    foreign key (alert_id, server_id, organization_id)
    references public.server_monitor_alerts(id, server_id, organization_id)
    on delete cascade,
  constraint server_monitor_alert_events_identity_uniq
    unique (id, server_id, organization_id),
  constraint server_monitor_alert_events_transition_check
    check (transition in ('opened', 'escalated', 'deescalated', 'resolved', 'offline', 'online')),
  constraint server_monitor_alert_events_severity_check
    check (severity in ('warning', 'critical', 'recovered')),
  constraint server_monitor_alert_events_rule_code_check
    check (rule_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint server_monitor_alert_events_subject_key_check
    check (char_length(btrim(subject_key)) between 1 and 160),
  constraint server_monitor_alert_events_context_shape_check
    check (jsonb_typeof(context) = 'object')
);

comment on table public.server_monitor_alert_events is
  'Append-only transition history used by the events table and notification outbox.';

create index idx_server_monitor_alert_events_organization_time
  on public.server_monitor_alert_events (organization_id, occurred_at desc);
create index idx_server_monitor_alert_events_server_time
  on public.server_monitor_alert_events (server_id, occurred_at desc);
create index idx_server_monitor_alert_events_alert
  on public.server_monitor_alert_events (alert_id, server_id, organization_id);

-- ============================================================================
-- 5. Reliable Telegram delivery queue
-- ============================================================================

create table public.server_monitor_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  organization_id uuid not null,
  alert_event_id uuid null,

  dedupe_key text not null,
  channel text not null default 'telegram',
  message_kind text not null,
  status text not null default 'pending',
  payload jsonb not null,

  attempt_count smallint not null default 0,
  max_attempts smallint not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  sent_at timestamptz null,
  last_error text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint server_monitor_notification_outbox_server_organization_fkey
    foreign key (server_id, organization_id)
    references public.server_monitor_servers(id, organization_id)
    on delete cascade,
  constraint server_monitor_notification_outbox_event_identity_fkey
    foreign key (alert_event_id, server_id, organization_id)
    references public.server_monitor_alert_events(id, server_id, organization_id)
    on delete cascade,
  constraint server_monitor_notification_outbox_dedupe_uniq unique (dedupe_key),
  constraint server_monitor_notification_outbox_channel_check
    check (channel in ('telegram')),
  constraint server_monitor_notification_outbox_message_kind_check
    check (message_kind in ('warning', 'critical', 'recovered', 'offline', 'online', 'test')),
  constraint server_monitor_notification_outbox_status_check
    check (status in ('pending', 'processing', 'sent', 'failed')),
  constraint server_monitor_notification_outbox_attempt_check
    check (attempt_count between 0 and 100 and max_attempts between 1 and 100),
  constraint server_monitor_notification_outbox_payload_shape_check
    check (jsonb_typeof(payload) = 'object'),
  constraint server_monitor_notification_outbox_sent_check
    check ((status = 'sent' and sent_at is not null) or (status <> 'sent' and sent_at is null))
);

comment on table public.server_monitor_notification_outbox is
  'Retryable Telegram outbox. Bot tokens and chat IDs remain in server-only environment variables.';

create index idx_server_monitor_outbox_pending
  on public.server_monitor_notification_outbox (next_attempt_at, created_at)
  where status = 'pending';
create index idx_server_monitor_outbox_stale_processing
  on public.server_monitor_notification_outbox (locked_at)
  where status = 'processing';
create index idx_server_monitor_outbox_server
  on public.server_monitor_notification_outbox (server_id, created_at desc);
create index idx_server_monitor_outbox_alert_event
  on public.server_monitor_notification_outbox (alert_event_id, server_id, organization_id)
  where alert_event_id is not null;

-- ============================================================================
-- 6. Integrity helpers and retention
-- ============================================================================

create or replace function public.server_monitor_validate_company_organization()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.company_id is not null and not exists (
    select 1
    from public.companies c
    where c.id = new.company_id
      and c.organization_id = new.organization_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'server monitor company must belong to the selected organization';
  end if;

  return new;
end;
$$;

revoke all on function public.server_monitor_validate_company_organization() from public, anon, authenticated;
grant execute on function public.server_monitor_validate_company_organization() to service_role;

create trigger trg_server_monitor_servers_company_organization
before insert or update of organization_id, company_id
on public.server_monitor_servers
for each row execute function public.server_monitor_validate_company_organization();

create or replace function public.server_monitor_create_default_settings()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.server_monitor_settings (server_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (server_id) do nothing;

  return new;
end;
$$;

revoke all on function public.server_monitor_create_default_settings() from public, anon, authenticated;
grant execute on function public.server_monitor_create_default_settings() to service_role;

create trigger trg_server_monitor_servers_default_settings
after insert on public.server_monitor_servers
for each row execute function public.server_monitor_create_default_settings();

create trigger trg_server_monitor_servers_updated_at
before update on public.server_monitor_servers
for each row execute function public.update_updated_at_column();

create trigger trg_server_monitor_settings_updated_at
before update on public.server_monitor_settings
for each row execute function public.update_updated_at_column();

create trigger trg_server_monitor_current_updated_at
before update on public.server_monitor_current
for each row execute function public.update_updated_at_column();

create trigger trg_server_monitor_alerts_updated_at
before update on public.server_monitor_alerts
for each row execute function public.update_updated_at_column();

create trigger trg_server_monitor_outbox_updated_at
before update on public.server_monitor_notification_outbox
for each row execute function public.update_updated_at_column();

create or replace function public.server_monitor_cleanup_retention(
  p_now timestamptz default now()
)
returns table (
  metric_samples_deleted bigint,
  ingest_receipts_deleted bigint,
  sent_outbox_rows_deleted bigint
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_metrics bigint := 0;
  v_receipts bigint := 0;
  v_outbox bigint := 0;
begin
  delete from public.server_monitor_metric_samples samples
  using public.server_monitor_settings settings
  where settings.server_id = samples.server_id
    and samples.bucket_start < p_now - make_interval(days => settings.history_retention_days);
  get diagnostics v_metrics = row_count;

  delete from public.server_monitor_ingest_receipts
  where received_at < p_now - interval '2 days';
  get diagnostics v_receipts = row_count;

  delete from public.server_monitor_notification_outbox
  where status = 'sent'
    and sent_at < p_now - interval '30 days';
  get diagnostics v_outbox = row_count;

  return query select v_metrics, v_receipts, v_outbox;
end;
$$;

revoke all on function public.server_monitor_cleanup_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.server_monitor_cleanup_retention(timestamptz) to service_role;

create or replace function public.server_monitor_claim_notifications(
  p_worker_id text,
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns setof public.server_monitor_notification_outbox
language sql
set search_path = pg_catalog, public
as $$
  with claimable as (
    select outbox.id
    from public.server_monitor_notification_outbox outbox
    where (
      outbox.status = 'pending'
      and outbox.next_attempt_at <= p_now
      and outbox.attempt_count < outbox.max_attempts
    ) or (
      outbox.status = 'processing'
      and outbox.locked_at < p_now - interval '5 minutes'
      and outbox.attempt_count < outbox.max_attempts
    )
    order by outbox.next_attempt_at, outbox.created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.server_monitor_notification_outbox outbox
  set
    status = 'processing',
    attempt_count = outbox.attempt_count + 1,
    locked_at = p_now,
    locked_by = left(p_worker_id, 160),
    updated_at = p_now
  from claimable
  where outbox.id = claimable.id
  returning outbox.*
$$;

revoke all on function public.server_monitor_claim_notifications(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.server_monitor_claim_notifications(text, integer, timestamptz)
  to service_role;

-- ============================================================================
-- 7. RLS, grants, and Realtime
-- ============================================================================

alter table public.server_monitor_servers enable row level security;
alter table public.server_monitor_agent_keys enable row level security;
alter table public.server_monitor_settings enable row level security;
alter table public.server_monitor_current enable row level security;
alter table public.server_monitor_metric_samples enable row level security;
alter table public.server_monitor_ingest_receipts enable row level security;
alter table public.server_monitor_alerts enable row level security;
alter table public.server_monitor_alert_state enable row level security;
alter table public.server_monitor_alert_events enable row level security;
alter table public.server_monitor_notification_outbox enable row level security;

revoke all on table
  public.server_monitor_servers,
  public.server_monitor_agent_keys,
  public.server_monitor_settings,
  public.server_monitor_current,
  public.server_monitor_metric_samples,
  public.server_monitor_ingest_receipts,
  public.server_monitor_alerts,
  public.server_monitor_alert_state,
  public.server_monitor_alert_events,
  public.server_monitor_notification_outbox
from public, anon, authenticated;

grant all on table
  public.server_monitor_servers,
  public.server_monitor_agent_keys,
  public.server_monitor_settings,
  public.server_monitor_current,
  public.server_monitor_metric_samples,
  public.server_monitor_ingest_receipts,
  public.server_monitor_alerts,
  public.server_monitor_alert_state,
  public.server_monitor_alert_events,
  public.server_monitor_notification_outbox
to service_role;

-- The dashboard can subscribe to these rows through Supabase Realtime, but
-- only for organizations available to the authenticated user. All writes stay
-- behind the Next.js service-role backend.
grant select on table
  public.server_monitor_servers,
  public.server_monitor_settings,
  public.server_monitor_current,
  public.server_monitor_metric_samples,
  public.server_monitor_alerts,
  public.server_monitor_alert_events
to authenticated;

create policy server_monitor_servers_select_same_organization
on public.server_monitor_servers
for select to authenticated
using (public.can_access_organization(organization_id));

create policy server_monitor_settings_select_same_organization
on public.server_monitor_settings
for select to authenticated
using (public.can_access_organization(organization_id));

create policy server_monitor_current_select_same_organization
on public.server_monitor_current
for select to authenticated
using (public.can_access_organization(organization_id));

create policy server_monitor_samples_select_same_organization
on public.server_monitor_metric_samples
for select to authenticated
using (public.can_access_organization(organization_id));

create policy server_monitor_alerts_select_same_organization
on public.server_monitor_alerts
for select to authenticated
using (public.can_access_organization(organization_id));

create policy server_monitor_alert_events_select_same_organization
on public.server_monitor_alert_events
for select to authenticated
using (public.can_access_organization(organization_id));

-- Supabase Realtime requires explicit publication membership. Keep the list to
-- live operational rows; historical metric samples are fetched through bounded
-- API queries instead of streamed to every browser.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'server_monitor_current'
    ) then
      execute 'alter publication supabase_realtime add table public.server_monitor_current';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'server_monitor_alerts'
    ) then
      execute 'alter publication supabase_realtime add table public.server_monitor_alerts';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'server_monitor_alert_events'
    ) then
      execute 'alter publication supabase_realtime add table public.server_monitor_alert_events';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Post-apply smoke query:
-- select
--   to_regclass('public.server_monitor_servers') as servers,
--   to_regclass('public.server_monitor_current') as current_state,
--   to_regclass('public.server_monitor_metric_samples') as metric_samples,
--   to_regclass('public.server_monitor_alerts') as alerts,
--   to_regclass('public.server_monitor_notification_outbox') as outbox;
