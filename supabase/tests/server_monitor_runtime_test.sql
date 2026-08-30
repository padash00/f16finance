begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select has_function('public', 'server_monitor_apply_observations', array['uuid', 'timestamp with time zone', 'jsonb'], 'generic alert evaluator exists');
select has_function('public', 'server_monitor_commit_ingest', array['uuid', 'uuid', 'text', 'jsonb', 'jsonb'], 'atomic ingest function exists');
select has_function('public', 'server_monitor_check_offline', array['timestamp with time zone'], 'external offline checker exists');
select has_function('public', 'server_monitor_history', array['uuid', 'timestamp with time zone', 'timestamp with time zone', 'integer'], 'downsampled history function exists');

select lives_ok(
  $$ insert into public.organizations (id, name, slug, status)
     values ('11000000-0000-0000-0000-000000000001', 'Monitor Runtime', 'monitor-runtime-test', 'active') $$,
  'runtime test organization can be created'
);

select lives_ok(
  $$ insert into public.server_monitor_servers (id, organization_id, code, name, hostname)
     values (
       '21000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'runtime-server', 'Runtime Server', 'RUNTIME-SERVER'
     ) $$,
  'runtime server can be registered'
);

select lives_ok(
  $$ insert into public.server_monitor_agent_keys (id, server_id, key_id, secret_hash)
     values (
       '31000000-0000-0000-0000-000000000001',
       '21000000-0000-0000-0000-000000000001',
       'smk_runtimecheck', repeat('a', 64)
     ) $$,
  'runtime key hash can be registered'
);

select lives_ok(
  $$ select public.server_monitor_commit_ingest(
    '21000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    repeat('b', 64),
    jsonb_build_object(
      'telemetryId', '41000000-0000-4000-8000-000000000001',
      'schemaVersion', 1,
      'observedAt', '2026-08-30T10:00:00Z',
      'agentVersion', 'test-1',
      'hostname', 'RUNTIME-SERVER',
      'windowsVersion', 'Windows Server 2019',
      'uptimeSeconds', 3600,
      'lastBootAt', '2026-08-30T09:00:00Z',
      'cpuUsagePct', 92,
      'cpuPackageTempC', 82,
      'cpuCoreMaxTempC', 83,
      'memoryUsagePct', 50,
      'internetConnected', true,
      'pingMs', 12,
      'networkRxBps', 1000,
      'networkTxBps', 500,
      'systemData', '{}'::jsonb,
      'cpuData', '{}'::jsonb,
      'memoryData', '{}'::jsonb,
      'disksData', '[]'::jsonb,
      'networkData', '[]'::jsonb
    ),
    jsonb_build_array(jsonb_build_object(
      'ruleCode', 'cpu_usage',
      'subjectKey', 'cpu',
      'title', 'CPU usage',
      'metric', 'cpu_usage_pct',
      'value', 92,
      'unit', '%',
      'direction', 'high',
      'warningThreshold', 90,
      'criticalThreshold', 98,
      'hysteresis', 5,
      'context', '{}'::jsonb
    ))
  ) $$,
  'one telemetry and its warning commit atomically'
);

select is((select count(*) from public.server_monitor_current where server_id = '21000000-0000-0000-0000-000000000001'), 1::bigint, 'current telemetry is stored');
select is((select count(*) from public.server_monitor_metric_samples where server_id = '21000000-0000-0000-0000-000000000001'), 1::bigint, 'one history bucket is stored');
select is((select count(*) from public.server_monitor_alerts where server_id = '21000000-0000-0000-0000-000000000001' and status = 'active'), 1::bigint, 'one active warning is opened');
select is((select count(*) from public.server_monitor_alert_events where server_id = '21000000-0000-0000-0000-000000000001'), 1::bigint, 'one transition event is appended');
select is((select count(*) from public.server_monitor_notification_outbox where server_id = '21000000-0000-0000-0000-000000000001'), 1::bigint, 'one Telegram notification is queued');

select lives_ok(
  $$ select public.server_monitor_commit_ingest(
    '21000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    repeat('b', 64),
    jsonb_build_object('telemetryId', '41000000-0000-4000-8000-000000000001', 'observedAt', '2026-08-30T10:00:00Z'),
    '[]'::jsonb
  ) $$,
  'duplicate delivery is accepted idempotently'
);

select is((select count(*) from public.server_monitor_ingest_receipts where server_id = '21000000-0000-0000-0000-000000000001'), 1::bigint, 'duplicate delivery creates no second receipt');

select * from finish();
rollback;
