Set-StrictMode -Version 2.0

$script:OrdaPreviousProcesses = @{}
$script:OrdaPreviousProcessSampleAt = $null

function Reset-OrdaProcessDiagnostics {
    $script:OrdaPreviousProcesses = @{}
    $script:OrdaPreviousProcessSampleAt = $null
}

function Get-OrdaTopProcesses {
    param(
        [int]$LogicalProcessorCount,
        [DateTime]$NowUtc = [DateTime]::UtcNow,
        [object[]]$Processes
    )

    if (-not $PSBoundParameters.ContainsKey('Processes')) {
        $Processes = @(Get-Process -ErrorAction SilentlyContinue)
    }
    $logicalProcessors = [Math]::Max(1, $LogicalProcessorCount)
    $elapsedSeconds = if ($null -ne $script:OrdaPreviousProcessSampleAt) {
        ($NowUtc.ToUniversalTime() - ([DateTime]$script:OrdaPreviousProcessSampleAt).ToUniversalTime()).TotalSeconds
    } else { 0 }
    $current = @{}
    $ranked = @()

    foreach ($process in @($Processes)) {
        try {
            $pidValue = [int]$process.Id
            $cpuSeconds = if ($null -eq $process.CPU) { 0.0 } else { [double]$process.CPU }
            $startTicks = try { ([DateTime]$process.StartTime).ToUniversalTime().Ticks } catch { 0 }
            $key = '{0}|{1}' -f $pidValue, $startTicks
            $current[$key] = $cpuSeconds
            if ($elapsedSeconds -le 0 -or -not $script:OrdaPreviousProcesses.ContainsKey($key)) { continue }

            $delta = $cpuSeconds - [double]$script:OrdaPreviousProcesses[$key]
            if ($delta -lt 0) { continue }
            $cpuPercent = [Math]::Min(100.0, [Math]::Max(0.0, ($delta / $elapsedSeconds / $logicalProcessors) * 100.0))
            $name = ([string]$process.ProcessName).Trim()
            if (-not $name) { $name = 'PID ' + $pidValue }
            $ranked += [pscustomobject][ordered]@{
                pid = $pidValue
                name = $name
                cpuPercent = [Math]::Round($cpuPercent, 2)
                workingSetBytes = [Math]::Max(0, [Math]::Round([double]$process.WorkingSet64))
            }
        } catch { }
    }

    $script:OrdaPreviousProcesses = $current
    $script:OrdaPreviousProcessSampleAt = $NowUtc.ToUniversalTime()
    return [object[]]@($ranked | Sort-Object -Property @{ Expression = 'cpuPercent'; Descending = $true }, @{ Expression = 'workingSetBytes'; Descending = $true } | Select-Object -First 5)
}

function Resolve-OrdaNetworkVerdict {
    param(
        [object]$GatewayReachable,
        [object]$ExternalReachable,
        [object]$DnsReachable,
        [object]$HttpsReachable
    )
    if ($HttpsReachable -eq $true) { return 'healthy' }
    if ($GatewayReachable -eq $false -and $ExternalReachable -eq $false) { return 'gateway_unreachable' }
    if ($DnsReachable -eq $false -and $ExternalReachable -eq $true) { return 'dns_failure' }
    if ($ExternalReachable -eq $false) { return 'internet_unreachable' }
    if ($DnsReachable -eq $false) { return 'dns_failure' }
    if ($HttpsReachable -eq $false) { return 'endpoint_unreachable' }
    return 'unknown'
}

function Invoke-OrdaPingProbe {
    param([string]$Target, [int]$TimeoutMs)
    if (-not $Target) {
        return [ordered]@{ target = $null; reachable = $null; latencyMs = $null; error = 'Target unavailable' }
    }
    $ping = $null
    try {
        $ping = New-Object System.Net.NetworkInformation.Ping
        $reply = $ping.Send($Target, $TimeoutMs)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
            return [ordered]@{ target = $Target; reachable = $true; latencyMs = [double]$reply.RoundtripTime; error = $null }
        }
        return [ordered]@{ target = $Target; reachable = $false; latencyMs = $null; error = [string]$reply.Status }
    } catch {
        return [ordered]@{ target = $Target; reachable = $false; latencyMs = $null; error = [string]$_.Exception.Message }
    } finally {
        if ($null -ne $ping) { $ping.Dispose() }
    }
}

function Invoke-OrdaDnsProbe {
    param([string]$Target, [int]$TimeoutMs)
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $operation = [Net.Dns]::BeginGetHostAddresses($Target, $null, $null)
        if (-not $operation.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return [ordered]@{ target = $Target; reachable = $false; latencyMs = [double]$stopwatch.ElapsedMilliseconds; addresses = [object[]]@(); error = 'DNS timeout' }
        }
        $addresses = [object[]]@([Net.Dns]::EndGetHostAddresses($operation) | ForEach-Object { [string]$_.IPAddressToString } | Select-Object -First 8)
        return [ordered]@{ target = $Target; reachable = ($addresses.Count -gt 0); latencyMs = [double]$stopwatch.ElapsedMilliseconds; addresses = $addresses; error = $null }
    } catch {
        return [ordered]@{ target = $Target; reachable = $false; latencyMs = [double]$stopwatch.ElapsedMilliseconds; addresses = [object[]]@(); error = [string]$_.Exception.Message }
    } finally {
        $stopwatch.Stop()
    }
}

function Invoke-OrdaHttpsProbe {
    param([string]$Target, [int]$TimeoutMs)
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $response = $null
    try {
        $request = [Net.HttpWebRequest]::Create($Target)
        $request.Method = 'HEAD'
        $request.Timeout = $TimeoutMs
        $request.ReadWriteTimeout = $TimeoutMs
        $request.AllowAutoRedirect = $true
        $response = $request.GetResponse()
        return [ordered]@{ target = $Target; reachable = $true; latencyMs = [double]$stopwatch.ElapsedMilliseconds; statusCode = [int]$response.StatusCode; error = $null }
    } catch [Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $response = $_.Exception.Response
            return [ordered]@{ target = $Target; reachable = $true; latencyMs = [double]$stopwatch.ElapsedMilliseconds; statusCode = [int]$response.StatusCode; error = $null }
        }
        return [ordered]@{ target = $Target; reachable = $false; latencyMs = [double]$stopwatch.ElapsedMilliseconds; statusCode = $null; error = [string]$_.Exception.Message }
    } catch {
        return [ordered]@{ target = $Target; reachable = $false; latencyMs = [double]$stopwatch.ElapsedMilliseconds; statusCode = $null; error = [string]$_.Exception.Message }
    } finally {
        if ($null -ne $response) { $response.Close() }
        $stopwatch.Stop()
    }
}

function Get-OrdaNetworkDiagnostics {
    param([string]$Endpoint, [string]$ConnectivityHost, [int]$TimeoutMs)
    $gatewayTarget = $null
    try {
        $route = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
            Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
            Sort-Object -Property RouteMetric, InterfaceMetric |
            Select-Object -First 1)
        if ($route.Count) { $gatewayTarget = [string]$route[0].NextHop }
    } catch { }

    $endpointUri = [Uri]$Endpoint
    $gateway = Invoke-OrdaPingProbe -Target $gatewayTarget -TimeoutMs $TimeoutMs
    $external = Invoke-OrdaPingProbe -Target $ConnectivityHost -TimeoutMs $TimeoutMs
    $dns = Invoke-OrdaDnsProbe -Target $endpointUri.DnsSafeHost -TimeoutMs $TimeoutMs
    $https = if ($dns.reachable -eq $true) {
        Invoke-OrdaHttpsProbe -Target $Endpoint -TimeoutMs $TimeoutMs
    } else {
        [ordered]@{ target = $Endpoint; reachable = $false; latencyMs = $null; statusCode = $null; error = 'DNS resolution failed' }
    }
    $verdict = Resolve-OrdaNetworkVerdict -GatewayReachable $gateway.reachable -ExternalReachable $external.reachable -DnsReachable $dns.reachable -HttpsReachable $https.reachable
    return [ordered]@{
        verdict = $verdict
        gateway = $gateway
        external = $external
        dns = $dns
        https = $https
    }
}
