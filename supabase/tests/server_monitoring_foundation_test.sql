begin;

create extension if not exists pgtap with schema extensions;

select plan(44);

-- Structure
select has_table('public', 'server_monitor_servers', 'server registry exists');
select has_table('public', 'server_monitor_agent_keys', 'agent key registry exists');
select has_table('public', 'server_monitor_settings', 'monitor settings exist');
select has_table('public', 'server_monitor_current', 'current telemetry exists');
select has_table('public', 'server_monitor_metric_samples', 'bounded metric history exists');
select has_table('public', 'server_monitor_ingest_receipts', 'ingest receipts exist');
select has_table('public', 'server_monitor_alerts', 'alert incidents exist');
select has_table('public', 'server_monitor_alert_state', 'stateful alert storage exists');
select has_table('public', 'server_monitor_alert_events', 'alert transition history exists');
select has_table('public', 'server_monitor_notification_outbox', 'notification outbox exists');

select has_column('public', 'server_monitor_agent_keys', 'secret_hash', 'only a secret hash is persisted');
select hasnt_column('public', 'server_monitor_agent_keys', 'secret', 'plaintext secret column does not exist');
select hasnt_column('public', 'server_monitor_agent_keys', 'agent_key', 'plaintext agent key column does not exist');
select has_index(
  'public',
  'server_monitor_alerts',
  'uq_server_monitor_alerts_active_subject',
  'active alert duplicate suppression index exists'
);
select has_function(
  'public',
  'server_monitor_cleanup_retention',
  array['timestamp with time zone'],
  'retention cleanup function exists'
);
select has_function(
  'public',
  'server_monitor_claim_notifications',
  array['text', 'integer', 'timestamp with time zone'],
  'atomic outbox claim function exists'
);

-- RLS and grants
select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'server_monitor_servers',
        'server_monitor_agent_keys',
        'server_monitor_settings',
        'server_monitor_current',
        'server_monitor_metric_samples',
        'server_monitor_ingest_receipts',
        'server_monitor_alerts',
        'server_monitor_alert_state',
        'server_monitor_alert_events',
        'server_monitor_notification_outbox'
      )
      and c.relrowsecurity
  ),
  10::bigint,
  'RLS is enabled on every monitor table'
);
select ok(
  not has_table_privilege('anon', 'public.server_monitor_servers', 'select'),
  'anonymous users cannot read server metadata'
);
select ok(
  has_table_privilege('authenticated', 'public.server_monitor_servers', 'select'),
  'authenticated users have policy-gated server reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.server_monitor_servers', 'insert'),
  'authenticated users cannot write server metadata directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.server_monitor_agent_keys', 'select'),
  'authenticated users cannot read agent credential rows'
);
select ok(
  has_table_privilege('service_role', 'public.server_monitor_agent_keys', 'select'),
  'service role can authenticate agents server-side'
);
select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename like 'server_monitor_%'
  ),
  6::bigint,
  'only six tenant-scoped read policies are exposed'
);

-- Realtime is deliberately limited to live operational rows.
select is(
  (
    select count(*)::bigint
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'server_monitor_current'
  ),
  1::bigint,
  'current telemetry is in the Realtime publication'
);
select is(
  (
    select count(*)::bigint
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'server_monitor_alerts'
  ),
  1::bigint,
  'active alerts are in the Realtime publication'
);
select is(
  (
    select count(*)::bigint
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'server_monitor_alert_events'
  ),
  1::bigint,
  'alert transitions are in the Realtime publication'
);

-- Data flow smoke test. Fixed UUIDs are safe because the transaction rolls back.
select lives_ok(
  $$
    insert into public.organizations (id, name, slug, status)
    values ('10000000-0000-0000-0000-000000000001', 'Monitor Test', 'monitor-foundation-test', 'active')
  $$,
  'test organization can be created'
);

select lives_ok(
  $$
    insert into public.server_monitor_servers (
      id,
      organization_id,
      code,
      name,
      hostname
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'test-server',
      'Test Server',
      'TEST-SERVER'
    )
  $$,
  'server can be registered without production seed data'
);

select is(
  (
    select count(*)::bigint
    from public.server_monitor_settings
    where server_id = '20000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'server registration creates exactly one settings row'
);

select results_eq(
  $$
    select
      cpu_temp_warning_c,
      cpu_temp_critical_c,
      offline_timeout_seconds,
      history_bucket_seconds,
      history_retention_days
    from public.server_monitor_settings
    where server_id = '20000000-0000-0000-0000-000000000001'
  $$,
  $$ values (80::numeric, 90::numeric, 120, 300, 30::smallint) $$,
  'default thresholds and retention match the production specification'
);

select lives_ok(
  $$
    insert into public.organization_members (
      organization_id,
      email,
      role,
      status,
      is_default
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'monitor-test@example.com',
      'owner',
      'active',
      true
    )
  $$,
  'test owner can be attached to the monitor organization'
);

set local "request.jwt.claims" = '{"email":"monitor-test@example.com","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$ select count(*) from public.server_monitor_servers $$,
  array[1::bigint],
  'organization member can read own server through RLS'
);

reset role;
set local "request.jwt.claims" = '{"email":"outsider@example.com","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$ select count(*) from public.server_monitor_servers $$,
  array[0::bigint],
  'different organization cannot read the server through RLS'
);

reset role;

select lives_ok(
  $$
    insert into public.server_monitor_agent_keys (
      id,
      server_id,
      key_id,
      secret_hash
    ) values (
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'smk_abcdefghijkl',
      repeat('a', 64)
    )
  $$,
  'hashed agent credential can be registered'
);

select lives_ok(
  $$
    insert into public.server_monitor_current (
      server_id,
      organization_id,
      telemetry_id,
      schema_version,
      observed_at,
      payload_hash,
      cpu_usage_pct,
      memory_usage_pct
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      1,
      now(),
      repeat('b', 64),
      25,
      40
    )
  $$,
  'valid current telemetry can be stored'
);

select lives_ok(
  $$
    insert into public.server_monitor_metric_samples (
      server_id,
      organization_id,
      bucket_start,
      observed_at,
      received_at,
      cpu_usage_pct,
      memory_usage_pct
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      date_trunc('hour', now()),
      now(),
      now(),
      25,
      40
    )
  $$,
  'one bounded history sample can be stored'
);

select lives_ok(
  $$
    insert into public.server_monitor_alerts (
      id,
      server_id,
      organization_id,
      rule_code,
      subject_key,
      severity,
      title,
      message,
      started_at,
      last_observed_at
    ) values (
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'cpu_temperature',
      'cpu',
      'warning',
      'CPU temperature',
      'CPU temperature exceeded the warning threshold',
      now(),
      now()
    )
  $$,
  'active alert incident can be opened'
);

select lives_ok(
  $$
    insert into public.server_monitor_alert_state (
      server_id,
      organization_id,
      rule_code,
      subject_key,
      state,
      active_alert_id,
      last_observed_at
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'cpu_temperature',
      'cpu',
      'warning',
      '50000000-0000-0000-0000-000000000001',
      now()
    )
  $$,
  'stateful evaluator row can point to its active incident'
);

select lives_ok(
  $$
    insert into public.server_monitor_alert_events (
      id,
      alert_id,
      server_id,
      organization_id,
      transition,
      severity,
      rule_code,
      subject_key,
      title,
      message,
      occurred_at
    ) values (
      '60000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'opened',
      'warning',
      'cpu_temperature',
      'cpu',
      'CPU temperature',
      'CPU temperature exceeded the warning threshold',
      now()
    )
  $$,
  'append-only alert transition can be recorded'
);

select lives_ok(
  $$
    insert into public.server_monitor_notification_outbox (
      server_id,
      organization_id,
      alert_event_id,
      dedupe_key,
      message_kind,
      payload
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      'monitor-test:cpu-temperature:opened',
      'warning',
      '{"server":"Test Server","value":80}'::jsonb
    )
  $$,
  'Telegram notification can be queued idempotently'
);

select lives_ok(
  $$ select * from public.server_monitor_cleanup_retention(now()) $$,
  'retention cleanup executes without touching fresh rows'
);

select results_eq(
  $$ select count(*) from public.server_monitor_claim_notifications('pgtap-worker', 10, now()) $$,
  array[1::bigint],
  'one worker atomically claims the pending notification'
);

select results_eq(
  $$
    select status, attempt_count, locked_by
    from public.server_monitor_notification_outbox
    where dedupe_key = 'monitor-test:cpu-temperature:opened'
  $$,
  $$ values ('processing'::text, 1::smallint, 'pgtap-worker'::text) $$,
  'claimed notification records its worker and attempt'
);

select is(
  (
    select count(*)::bigint
    from public.server_monitor_notification_outbox
    where dedupe_key = 'monitor-test:cpu-temperature:opened'
  ),
  1::bigint,
  'fresh outbox row survives retention cleanup'
);

select * from finish();
rollback;
