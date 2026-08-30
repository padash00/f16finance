-- Atomic runtime for ORDA Server Monitoring.
-- The public API validates and authenticates requests; these functions keep
-- each accepted heartbeat and its alert transitions in one database transaction.

create or replace function public.server_monitor_apply_observations(
  p_server_id uuid,
  p_observed_at timestamptz,
  p_observations jsonb
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_server public.server_monitor_servers%rowtype;
  v_settings public.server_monitor_settings%rowtype;
  v_state public.server_monitor_alert_state%rowtype;
  v_alert public.server_monitor_alerts%rowtype;
  v_observation jsonb;
  v_rule_code text;
  v_subject_key text;
  v_title text;
  v_metric text;
  v_unit text;
  v_direction text;
  v_context jsonb;
  v_value numeric;
  v_warning numeric;
  v_critical numeric;
  v_hysteresis numeric;
  v_current_state text;
  v_target_state text;
  v_threshold numeric;
  v_normal_streak smallint;
  v_required_samples smallint;
  v_transition text;
  v_event_severity text;
  v_message_kind text;
  v_message text;
  v_event_id uuid;
  v_notify boolean;
  v_duration_seconds bigint;
  v_event_count integer := 0;
begin
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception using errcode = '22023', message = 'observations must be a JSON array';
  end if;

  select * into strict v_server
  from public.server_monitor_servers
  where id = p_server_id
  for update;

  select * into strict v_settings
  from public.server_monitor_settings
  where server_id = p_server_id;

  for v_observation in select value from jsonb_array_elements(p_observations)
  loop
    v_rule_code := v_observation->>'ruleCode';
    v_subject_key := left(btrim(v_observation->>'subjectKey'), 160);
    v_title := left(btrim(v_observation->>'title'), 240);
    v_metric := nullif(left(btrim(v_observation->>'metric'), 120), '');
    v_unit := nullif(left(btrim(coalesce(v_observation->>'unit', '')), 24), '');
    v_direction := v_observation->>'direction';
    v_context := coalesce(v_observation->'context', '{}'::jsonb);
    v_value := (v_observation->>'value')::numeric;
    v_warning := nullif(v_observation->>'warningThreshold', '')::numeric;
    v_critical := (v_observation->>'criticalThreshold')::numeric;
    v_hysteresis := greatest(0, (v_observation->>'hysteresis')::numeric);

    if v_rule_code !~ '^[a-z][a-z0-9_]{1,63}$'
      or v_subject_key = ''
      or v_title = ''
      or v_direction not in ('high', 'low')
      or jsonb_typeof(v_context) <> 'object'
    then
      raise exception using errcode = '22023', message = 'invalid alert observation';
    end if;

    insert into public.server_monitor_alert_state (
      server_id, organization_id, rule_code, subject_key
    ) values (
      p_server_id, v_server.organization_id, v_rule_code, v_subject_key
    ) on conflict (server_id, rule_code, subject_key) do nothing;

    select * into strict v_state
    from public.server_monitor_alert_state
    where server_id = p_server_id
      and rule_code = v_rule_code
      and subject_key = v_subject_key
    for update;

    v_current_state := v_state.state;
    v_normal_streak := 0;
    v_required_samples := case when v_rule_code = 'server_offline' then 1 else v_settings.recovery_samples end;

    if v_current_state = 'normal' then
      if v_direction = 'high' then
        v_target_state := case
          when v_value >= v_critical then 'critical'
          when v_warning is not null and v_value >= v_warning then 'warning'
          else 'normal'
        end;
      else
        v_target_state := case
          when v_value <= v_critical then 'critical'
          when v_warning is not null and v_value <= v_warning then 'warning'
          else 'normal'
        end;
      end if;
    elsif v_direction = 'high' then
      v_target_state := case
        when v_current_state = 'critical' and v_value >= v_critical - v_hysteresis then 'critical'
        when v_current_state = 'warning' and v_value >= v_critical then 'critical'
        when v_warning is not null and v_value >= v_warning - v_hysteresis then 'warning'
        else 'normal'
      end;
    else
      v_target_state := case
        when v_current_state = 'critical' and v_value <= v_critical + v_hysteresis then 'critical'
        when v_current_state = 'warning' and v_value <= v_critical then 'critical'
        when v_warning is not null and v_value <= v_warning + v_hysteresis then 'warning'
        else 'normal'
      end;
    end if;

    if v_target_state = 'normal' and v_current_state <> 'normal' then
      v_normal_streak := least(100, v_state.normal_streak + 1);
      if v_normal_streak < v_required_samples then
        v_target_state := v_current_state;
      end if;
    end if;

    v_threshold := case when v_target_state = 'critical' then v_critical else v_warning end;
    v_transition := null;
    v_event_severity := null;
    v_message_kind := null;

    if v_current_state = 'normal' and v_target_state in ('warning', 'critical') then
      insert into public.server_monitor_alerts (
        server_id, organization_id, rule_code, subject_key, severity, title, message,
        metric, value_unit, opening_value, current_value, opening_threshold,
        current_threshold, context, started_at, last_observed_at
      ) values (
        p_server_id, v_server.organization_id, v_rule_code, v_subject_key, v_target_state,
        v_title, v_title || ': ' || v_value || coalesce(v_unit, ''), v_metric, v_unit,
        v_value, v_value, v_threshold, v_threshold, v_context, p_observed_at, p_observed_at
      ) returning * into v_alert;

      v_transition := case when v_rule_code = 'server_offline' then 'offline' else 'opened' end;
      v_event_severity := v_target_state;
      v_message_kind := case when v_rule_code = 'server_offline' then 'offline' else v_target_state end;
    elsif v_current_state in ('warning', 'critical') and v_target_state = 'normal' then
      select * into strict v_alert
      from public.server_monitor_alerts
      where id = v_state.active_alert_id
      for update;

      update public.server_monitor_alerts
      set status = 'resolved', current_value = v_value, resolution_value = v_value,
          last_observed_at = p_observed_at, resolved_at = p_observed_at
      where id = v_alert.id
      returning * into v_alert;

      v_transition := case when v_rule_code = 'server_offline' then 'online' else 'resolved' end;
      v_event_severity := 'recovered';
      v_message_kind := case when v_rule_code = 'server_offline' then 'online' else 'recovered' end;
      v_threshold := coalesce(v_state.last_threshold, v_warning, v_critical);
    elsif v_current_state <> v_target_state then
      select * into strict v_alert
      from public.server_monitor_alerts
      where id = v_state.active_alert_id
      for update;

      update public.server_monitor_alerts
      set severity = v_target_state, current_value = v_value, current_threshold = v_threshold,
          last_observed_at = p_observed_at, context = v_context
      where id = v_alert.id
      returning * into v_alert;

      v_transition := case when v_target_state = 'critical' then 'escalated' else 'deescalated' end;
      v_event_severity := v_target_state;
      v_message_kind := v_target_state;
    elsif v_current_state in ('warning', 'critical') then
      select * into strict v_alert
      from public.server_monitor_alerts
      where id = v_state.active_alert_id;

      update public.server_monitor_alerts
      set current_value = v_value, current_threshold = coalesce(v_threshold, current_threshold),
          last_observed_at = greatest(last_observed_at, p_observed_at), context = v_context
      where id = v_alert.id;
    end if;

    if v_transition is not null then
      v_duration_seconds := case
        when v_event_severity = 'recovered'
          then greatest(0, floor(extract(epoch from (p_observed_at - v_alert.started_at)))::bigint)
        else null
      end;
      v_message := case
        when v_event_severity = 'recovered' then v_title || ' восстановлено'
        else v_title || ': ' || v_value || coalesce(v_unit, '') ||
          case when v_threshold is null then '' else ' (порог ' || v_threshold || coalesce(v_unit, '') || ')' end
      end;

      insert into public.server_monitor_alert_events (
        alert_id, server_id, organization_id, transition, severity, rule_code,
        subject_key, title, message, value, threshold, value_unit, context, occurred_at
      ) values (
        v_alert.id, p_server_id, v_server.organization_id, v_transition, v_event_severity,
        v_rule_code, v_subject_key, v_title, v_message, v_value, v_threshold, v_unit,
        v_context, p_observed_at
      ) returning id into v_event_id;

      v_notify := v_settings.telegram_enabled and case
        when v_event_severity = 'warning' then v_settings.notify_warning
        when v_event_severity = 'critical' then v_settings.notify_critical
        else v_settings.notify_recovery
      end;

      if v_notify then
        insert into public.server_monitor_notification_outbox (
          server_id, organization_id, alert_event_id, dedupe_key, message_kind, payload
        ) values (
          p_server_id, v_server.organization_id, v_event_id, v_event_id::text || ':telegram',
          v_message_kind,
          jsonb_build_object(
            'serverId', p_server_id,
            'serverName', v_server.name,
            'hostname', v_server.hostname,
            'ruleCode', v_rule_code,
            'subjectKey', v_subject_key,
            'title', v_title,
            'message', v_message,
            'transition', v_transition,
            'severity', v_event_severity,
            'value', v_value,
            'threshold', v_threshold,
            'unit', v_unit,
            'startedAt', v_alert.started_at,
            'occurredAt', p_observed_at,
            'durationSeconds', v_duration_seconds,
            'context', v_context
          )
        ) on conflict (dedupe_key) do nothing;
      end if;

      v_event_count := v_event_count + 1;
    end if;

    update public.server_monitor_alert_state
    set state = v_target_state,
        normal_streak = case when v_target_state = 'normal' then 0 else v_normal_streak end,
        last_value = v_value,
        last_threshold = coalesce(v_threshold, v_state.last_threshold),
        last_observed_at = greatest(coalesce(last_observed_at, p_observed_at), p_observed_at),
        last_transition_at = case when v_transition is null then last_transition_at else p_observed_at end,
        active_alert_id = case when v_target_state = 'normal' then null else coalesce(v_alert.id, v_state.active_alert_id) end,
        row_version = row_version + 1,
        updated_at = now()
    where id = v_state.id;
  end loop;

  return v_event_count;
end;
$$;

revoke all on function public.server_monitor_apply_observations(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.server_monitor_apply_observations(uuid, timestamptz, jsonb)
  to service_role;

create or replace function public.server_monitor_commit_ingest(
  p_server_id uuid,
  p_agent_key_id uuid,
  p_payload_hash text,
  p_snapshot jsonb,
  p_observations jsonb
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_server public.server_monitor_servers%rowtype;
  v_settings public.server_monitor_settings%rowtype;
  v_received_at timestamptz := clock_timestamp();
  v_observed_at timestamptz := (p_snapshot->>'observedAt')::timestamptz;
  v_telemetry_id uuid := (p_snapshot->>'telemetryId')::uuid;
  v_receipt_id uuid;
  v_current_observed_at timestamptz;
  v_bucket_start timestamptz;
  v_stored boolean := false;
  v_event_count integer := 0;
begin
  if p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid ingest payload';
  end if;

  select * into strict v_server
  from public.server_monitor_servers
  where id = p_server_id
  for update;

  if not v_server.enabled then
    raise exception using errcode = '55000', message = 'server monitor is disabled';
  end if;

  select * into strict v_settings
  from public.server_monitor_settings
  where server_id = p_server_id;

  insert into public.server_monitor_ingest_receipts (
    server_id, organization_id, agent_key_id, telemetry_id, observed_at, received_at, payload_hash
  ) values (
    p_server_id, v_server.organization_id, p_agent_key_id, v_telemetry_id,
    v_observed_at, v_received_at, p_payload_hash
  ) on conflict do nothing
  returning id into v_receipt_id;

  if v_receipt_id is null then
    return jsonb_build_object('accepted', true, 'duplicate', true, 'stored', false, 'eventsCreated', 0);
  end if;

  update public.server_monitor_agent_keys
  set last_used_at = v_received_at
  where id = p_agent_key_id and server_id = p_server_id;

  update public.server_monitor_servers
  set last_seen_at = v_received_at,
      hostname = coalesce(nullif(p_snapshot->>'hostname', ''), hostname),
      last_agent_version = nullif(p_snapshot->>'agentVersion', '')
  where id = p_server_id;

  select observed_at into v_current_observed_at
  from public.server_monitor_current
  where server_id = p_server_id;

  v_stored := v_current_observed_at is null or v_observed_at >= v_current_observed_at;

  if v_stored then
    insert into public.server_monitor_current (
      server_id, organization_id, telemetry_id, schema_version, observed_at, received_at,
      payload_hash, agent_version, hostname, windows_version, uptime_seconds, last_boot_at,
      cpu_usage_pct, cpu_package_temp_c, cpu_core_max_temp_c, memory_usage_pct,
      internet_connected, ping_ms, network_rx_bps, network_tx_bps,
      system_data, cpu_data, memory_data, disks_data, network_data
    ) values (
      p_server_id, v_server.organization_id, v_telemetry_id, (p_snapshot->>'schemaVersion')::smallint,
      v_observed_at, v_received_at, p_payload_hash, nullif(p_snapshot->>'agentVersion', ''),
      nullif(p_snapshot->>'hostname', ''), nullif(p_snapshot->>'windowsVersion', ''),
      nullif(p_snapshot->>'uptimeSeconds', '')::bigint, nullif(p_snapshot->>'lastBootAt', '')::timestamptz,
      nullif(p_snapshot->>'cpuUsagePct', '')::numeric, nullif(p_snapshot->>'cpuPackageTempC', '')::numeric,
      nullif(p_snapshot->>'cpuCoreMaxTempC', '')::numeric, nullif(p_snapshot->>'memoryUsagePct', '')::numeric,
      nullif(p_snapshot->>'internetConnected', '')::boolean, nullif(p_snapshot->>'pingMs', '')::numeric,
      nullif(p_snapshot->>'networkRxBps', '')::numeric, nullif(p_snapshot->>'networkTxBps', '')::numeric,
      coalesce(p_snapshot->'systemData', '{}'::jsonb), coalesce(p_snapshot->'cpuData', '{}'::jsonb),
      coalesce(p_snapshot->'memoryData', '{}'::jsonb), coalesce(p_snapshot->'disksData', '[]'::jsonb),
      coalesce(p_snapshot->'networkData', '[]'::jsonb)
    ) on conflict (server_id) do update set
      telemetry_id = excluded.telemetry_id,
      schema_version = excluded.schema_version,
      observed_at = excluded.observed_at,
      received_at = excluded.received_at,
      payload_hash = excluded.payload_hash,
      agent_version = excluded.agent_version,
      hostname = excluded.hostname,
      windows_version = excluded.windows_version,
      uptime_seconds = excluded.uptime_seconds,
      last_boot_at = excluded.last_boot_at,
      cpu_usage_pct = excluded.cpu_usage_pct,
      cpu_package_temp_c = excluded.cpu_package_temp_c,
      cpu_core_max_temp_c = excluded.cpu_core_max_temp_c,
      memory_usage_pct = excluded.memory_usage_pct,
      internet_connected = excluded.internet_connected,
      ping_ms = excluded.ping_ms,
      network_rx_bps = excluded.network_rx_bps,
      network_tx_bps = excluded.network_tx_bps,
      system_data = excluded.system_data,
      cpu_data = excluded.cpu_data,
      memory_data = excluded.memory_data,
      disks_data = excluded.disks_data,
      network_data = excluded.network_data,
      row_version = public.server_monitor_current.row_version + 1,
      updated_at = v_received_at;

    v_bucket_start := to_timestamp(
      floor(extract(epoch from v_observed_at) / v_settings.history_bucket_seconds)
      * v_settings.history_bucket_seconds
    );

    insert into public.server_monitor_metric_samples (
      server_id, organization_id, bucket_start, observed_at, received_at, cpu_usage_pct,
      cpu_package_temp_c, cpu_core_max_temp_c, memory_usage_pct, internet_connected,
      ping_ms, network_rx_bps, network_tx_bps, uptime_seconds, disks_data, network_data
    ) values (
      p_server_id, v_server.organization_id, v_bucket_start, v_observed_at, v_received_at,
      nullif(p_snapshot->>'cpuUsagePct', '')::numeric, nullif(p_snapshot->>'cpuPackageTempC', '')::numeric,
      nullif(p_snapshot->>'cpuCoreMaxTempC', '')::numeric, nullif(p_snapshot->>'memoryUsagePct', '')::numeric,
      nullif(p_snapshot->>'internetConnected', '')::boolean, nullif(p_snapshot->>'pingMs', '')::numeric,
      nullif(p_snapshot->>'networkRxBps', '')::numeric, nullif(p_snapshot->>'networkTxBps', '')::numeric,
      nullif(p_snapshot->>'uptimeSeconds', '')::bigint, coalesce(p_snapshot->'disksData', '[]'::jsonb),
      coalesce(p_snapshot->'networkData', '[]'::jsonb)
    ) on conflict (server_id, bucket_start) do update set
      observed_at = excluded.observed_at,
      received_at = excluded.received_at,
      cpu_usage_pct = excluded.cpu_usage_pct,
      cpu_package_temp_c = excluded.cpu_package_temp_c,
      cpu_core_max_temp_c = excluded.cpu_core_max_temp_c,
      memory_usage_pct = excluded.memory_usage_pct,
      internet_connected = excluded.internet_connected,
      ping_ms = excluded.ping_ms,
      network_rx_bps = excluded.network_rx_bps,
      network_tx_bps = excluded.network_tx_bps,
      uptime_seconds = excluded.uptime_seconds,
      disks_data = excluded.disks_data,
      network_data = excluded.network_data
    where excluded.observed_at >= public.server_monitor_metric_samples.observed_at;

    -- Alert chronology uses trusted backend receive time. Agent time is kept in
    -- current/history, but a delayed retry must never resolve an incident in the past.
    v_event_count := public.server_monitor_apply_observations(p_server_id, v_received_at, p_observations);
  end if;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'stored', v_stored,
    'eventsCreated', v_event_count,
    'receivedAt', v_received_at
  );
end;
$$;

revoke all on function public.server_monitor_commit_ingest(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.server_monitor_commit_ingest(uuid, uuid, text, jsonb, jsonb)
  to service_role;

create or replace function public.server_monitor_check_offline(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_server record;
  v_age_seconds numeric;
  v_checked integer := 0;
  v_events integer := 0;
begin
  for v_server in
    select servers.id, servers.last_seen_at, servers.created_at, settings.offline_timeout_seconds
    from public.server_monitor_servers servers
    join public.server_monitor_settings settings on settings.server_id = servers.id
    where servers.enabled = true
    order by servers.id
  loop
    v_age_seconds := greatest(0, extract(epoch from (p_now - coalesce(v_server.last_seen_at, v_server.created_at))));
    v_events := v_events + public.server_monitor_apply_observations(
      v_server.id,
      p_now,
      jsonb_build_array(jsonb_build_object(
        'ruleCode', 'server_offline',
        'subjectKey', 'server',
        'title', 'Сервер не отвечает',
        'metric', 'heartbeat_age_seconds',
        'value', v_age_seconds,
        'unit', 's',
        'direction', 'high',
        'warningThreshold', null,
        'criticalThreshold', v_server.offline_timeout_seconds,
        'hysteresis', 0,
        'context', jsonb_build_object('lastSeenAt', v_server.last_seen_at)
      ))
    );
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object('checked', v_checked, 'eventsCreated', v_events, 'checkedAt', p_now);
end;
$$;

revoke all on function public.server_monitor_check_offline(timestamptz)
  from public, anon, authenticated;
grant execute on function public.server_monitor_check_offline(timestamptz)
  to service_role;

create or replace function public.server_monitor_history(
  p_server_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_seconds integer
)
returns table (
  bucket_start timestamptz,
  cpu_usage_pct numeric,
  cpu_package_temp_c numeric,
  cpu_core_max_temp_c numeric,
  memory_usage_pct numeric,
  ping_ms numeric,
  network_rx_bps numeric,
  network_tx_bps numeric,
  internet_connected boolean,
  disks_data jsonb
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    to_timestamp(floor(extract(epoch from samples.bucket_start) / p_bucket_seconds) * p_bucket_seconds) as bucket_start,
    round(avg(samples.cpu_usage_pct), 2),
    round(avg(samples.cpu_package_temp_c), 2),
    round(avg(samples.cpu_core_max_temp_c), 2),
    round(avg(samples.memory_usage_pct), 2),
    round(avg(samples.ping_ms), 3),
    round(avg(samples.network_rx_bps), 2),
    round(avg(samples.network_tx_bps), 2),
    bool_and(coalesce(samples.internet_connected, false)),
    (array_agg(samples.disks_data order by samples.observed_at desc))[1]
  from public.server_monitor_metric_samples samples
  where samples.server_id = p_server_id
    and samples.bucket_start >= p_from
    and samples.bucket_start <= p_to
    and p_to > p_from
    and p_bucket_seconds between 60 and 86400
  group by 1
  order by 1;
$$;

revoke all on function public.server_monitor_history(uuid, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.server_monitor_history(uuid, timestamptz, timestamptz, integer)
  to service_role;

notify pgrst, 'reload schema';
