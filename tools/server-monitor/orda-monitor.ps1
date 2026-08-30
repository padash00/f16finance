[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
    [switch]$Once,
    [switch]$DryRun,
    [Nullable[double]]$SimulateCpuUsagePercent,
    [Nullable[double]]$SimulateCpuTemperatureC
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:AgentVersion = '1.0.0'
$script:PreviousNetwork = @{}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Rotate-Log {
    param([string]$Path, [long]$MaxBytes = 5242880, [int]$Keep = 5)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $item -or $item.Length -lt $MaxBytes) { return }
    for ($index = $Keep - 1; $index -ge 1; $index--) {
        $source = "$Path.$index"
        $target = "$Path.$($index + 1)"
        if (Test-Path -LiteralPath $source) { Move-Item -LiteralPath $source -Destination $target -Force }
    }
    Move-Item -LiteralPath $Path -Destination "$Path.1" -Force
}

function Write-AgentLog {
    param([ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level, [string]$Message)
    $line = '{0} [{1}] {2}' -f ([DateTime]::UtcNow.ToString('o')), $Level, $Message
    try {
        Rotate-Log -Path $script:LogPath
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    } catch {
        Write-Error $line -ErrorAction Continue
    }
}

function Get-OptionalProperty {
    param([object]$Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Get-DiskHardwareMap {
    $map = @{}
    try {
        foreach ($drive in Get-CimInstance Win32_DiskDrive -ErrorAction Stop) {
            $partitions = @(Get-CimAssociatedInstance -InputObject $drive -Association Win32_DiskDriveToDiskPartition -ErrorAction Stop)
            foreach ($partition in $partitions) {
                $logicalDisks = @(Get-CimAssociatedInstance -InputObject $partition -Association Win32_LogicalDiskToPartition -ErrorAction Stop)
                foreach ($logical in $logicalDisks) {
                    $map[[string]$logical.DeviceID] = @{
                        Id = [string]$drive.PNPDeviceID
                        Model = [string]$drive.Model
                        Status = [string]$drive.Status
                    }
                }
            }
        }
    } catch {
        Write-AgentLog -Level WARN -Message "Physical disk mapping unavailable: $($_.Exception.Message)"
    }
    return $map
}

function Get-Connectivity {
    param([string]$HostName, [int]$TimeoutMs)
    $connected = $false
    $latency = $null
    try {
        $ping = New-Object System.Net.NetworkInformation.Ping
        $reply = $ping.Send($HostName, $TimeoutMs)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
            $connected = $true
            $latency = [double]$reply.RoundtripTime
        }
        $ping.Dispose()
    } catch { }
    if (-not $connected) {
        try {
            $request = [Net.HttpWebRequest]::Create('https://www.gstatic.com/generate_204')
            $request.Method = 'GET'
            $request.Timeout = $TimeoutMs
            $request.ReadWriteTimeout = $TimeoutMs
            $response = $request.GetResponse()
            $connected = ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400)
            $response.Close()
        } catch { }
    }
    return @{ Connected = $connected; LatencyMs = $latency }
}

function Get-NetworkTelemetry {
    $now = [DateTime]::UtcNow
    $interfaces = @()
    try {
        $adapters = @(Get-NetAdapter -IncludeHidden:$false -ErrorAction Stop | Where-Object { $_.HardwareInterface -eq $true })
        foreach ($adapter in $adapters) {
            $statistics = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction Stop
            $key = [string]$adapter.InterfaceIndex
            $rx = 0.0
            $tx = 0.0
            if ($script:PreviousNetwork.ContainsKey($key)) {
                $previous = $script:PreviousNetwork[$key]
                $elapsed = ($now - $previous.At).TotalSeconds
                if ($elapsed -gt 0) {
                    $rx = [Math]::Max(0, ([double]$statistics.ReceivedBytes - [double]$previous.Rx) / $elapsed)
                    $tx = [Math]::Max(0, ([double]$statistics.SentBytes - [double]$previous.Tx) / $elapsed)
                }
            }
            $script:PreviousNetwork[$key] = @{ At = $now; Rx = [double]$statistics.ReceivedBytes; Tx = [double]$statistics.SentBytes }
            $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4, IPv6 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -and $_.AddressState -ne 'Tentative' } | ForEach-Object { [string]$_.IPAddress })
            $interfaces += [ordered]@{
                id = $key
                name = [string]$adapter.Name
                description = [string]$adapter.InterfaceDescription
                ipAddresses = $addresses
                status = if ([string]$adapter.Status -eq 'Up') { 'up' } elseif ([string]$adapter.Status -eq 'Disabled' -or [string]$adapter.Status -eq 'Disconnected') { 'down' } else { 'unknown' }
                macAddress = [string]$adapter.MacAddress
                linkSpeedBps = $null
                rxBytesPerSecond = [Math]::Round($rx, 2)
                txBytesPerSecond = [Math]::Round($tx, 2)
            }
        }
    } catch {
        Write-AgentLog -Level WARN -Message "Network counters unavailable: $($_.Exception.Message)"
    }
    return $interfaces
}

function Get-Telemetry {
    param([hashtable]$Config)
    $observedAt = [DateTime]::UtcNow
    $os = Get-CimInstance Win32_OperatingSystem
    $processors = @(Get-CimInstance Win32_Processor)
    $cpuUsage = [double](($processors | Measure-Object -Property LoadPercentage -Average).Average)
    $cpuModel = (($processors | ForEach-Object { [string]$_.Name }) -join '; ').Trim()
    $totalMemory = [double]$os.TotalVisibleMemorySize * 1024
    $availableMemory = [double]$os.FreePhysicalMemory * 1024
    $usedMemory = [Math]::Max(0, $totalMemory - $availableMemory)
    $memoryPercent = if ($totalMemory -gt 0) { ($usedMemory / $totalMemory) * 100 } else { 0 }
    $lastBootRaw = $os.LastBootUpTime
    $lastBoot = if ($lastBootRaw -is [DateTime]) {
        ([DateTime]$lastBootRaw).ToUniversalTime()
    } else {
        [Management.ManagementDateTimeConverter]::ToDateTime([string]$lastBootRaw).ToUniversalTime()
    }
    # Hardware temperatures remain null in production-safe no-driver mode.
    $temperatures = @{ CpuPackage = $null; CpuCoreMax = $null }
    if ($null -ne $SimulateCpuUsagePercent) { $cpuUsage = [double]$SimulateCpuUsagePercent }
    if ($null -ne $SimulateCpuTemperatureC) { $temperatures.CpuPackage = [double]$SimulateCpuTemperatureC }

    $diskHardware = Get-DiskHardwareMap
    $disks = @()
    foreach ($disk in Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3') {
        $total = [double]$disk.Size
        $free = [double]$disk.FreeSpace
        $used = [Math]::Max(0, $total - $free)
        $hardware = $diskHardware[[string]$disk.DeviceID]
        $model = if ($hardware) { [string]$hardware.Model } else { $null }
        $diskId = if ($hardware -and $hardware.Id) { [string]$hardware.Id } elseif ($disk.VolumeSerialNumber) { [string]$disk.VolumeSerialNumber } else { [string]$disk.DeviceID }
        if ($diskId.Length -gt 160) { $diskId = $diskId.Substring(0, 160) }
        $disks += [ordered]@{
            id = $diskId
            name = if ($disk.VolumeName) { [string]$disk.VolumeName } else { [string]$disk.DeviceID }
            model = $model
            driveLetter = [string]$disk.DeviceID
            volumeName = if ($disk.VolumeName) { [string]$disk.VolumeName } else { $null }
            fileSystem = if ($disk.FileSystem) { [string]$disk.FileSystem } else { $null }
            totalBytes = [Math]::Round($total)
            usedBytes = [Math]::Round($used)
            freeBytes = [Math]::Round($free)
            freePercent = if ($total -gt 0) { [Math]::Round(($free / $total) * 100, 2) } else { 0 }
            temperatureC = $null
            health = if ($hardware) { [string]$hardware.Status } else { $null }
            status = [string]$disk.Status
        }
    }

    $networkInterfaces = Get-NetworkTelemetry
    $connectivity = Get-Connectivity -HostName ([string]$Config.ConnectivityHost) -TimeoutMs ([int]$Config.ConnectivityTimeoutMs)
    return [ordered]@{
        schemaVersion = 1
        telemetryId = [Guid]::NewGuid().ToString()
        serverId = [string]$Config.ServerId
        timestamp = $observedAt.ToString('o')
        agentVersion = $script:AgentVersion
        system = [ordered]@{
            hostname = [Environment]::MachineName
            windowsVersion = ('{0} {1} build {2}' -f $os.Caption, $os.OSArchitecture, $os.BuildNumber).Trim()
            uptimeSeconds = [Math]::Max(0, [Math]::Floor(($observedAt - $lastBoot).TotalSeconds))
            lastBootAt = $lastBoot.ToString('o')
            agentTime = $observedAt.ToString('o')
        }
        cpu = [ordered]@{
            model = if ($cpuModel) { $cpuModel } else { 'Unknown CPU' }
            usagePercent = [Math]::Min(100, [Math]::Max(0, [Math]::Round($cpuUsage, 2)))
            packageTemperatureC = $temperatures.CpuPackage
            maxCoreTemperatureC = $temperatures.CpuCoreMax
        }
        memory = [ordered]@{
            totalBytes = [Math]::Round($totalMemory)
            usedBytes = [Math]::Round($usedMemory)
            availableBytes = [Math]::Round($availableMemory)
            usagePercent = [Math]::Round($memoryPercent, 2)
        }
        disks = $disks
        network = [ordered]@{
            internetConnected = [bool]$connectivity.Connected
            latencyMs = $connectivity.LatencyMs
            interfaces = $networkInterfaces
        }
    }
}

function Send-Telemetry {
    param([hashtable]$Config, [object]$Payload)
    $json = $Payload | ConvertTo-Json -Depth 10 -Compress
    if ($DryRun) {
        Write-Output ($Payload | ConvertTo-Json -Depth 10)
        return
    }
    $headers = @{ Authorization = "Bearer $($Config.AgentKey)" }
    $attempts = [Math]::Min(8, [Math]::Max(1, [int]$Config.MaxAttempts))
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri ([string]$Config.Endpoint) -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec ([int]$Config.RequestTimeoutSeconds)
            Write-AgentLog -Level INFO -Message "Telemetry accepted. duplicate=$($response.duplicate) stored=$($response.stored)"
            return
        } catch {
            $statusCode = $null
            if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
            if ($statusCode -in @(400, 401, 403, 413, 415, 422)) {
                Write-AgentLog -Level ERROR -Message "Telemetry rejected with HTTP $statusCode. $($_.Exception.Message)"
                return
            }
            if ($attempt -ge $attempts) {
                Write-AgentLog -Level ERROR -Message "Telemetry delivery failed after $attempt attempts. $($_.Exception.Message)"
                return
            }
            $delay = [Math]::Min(30, [Math]::Pow(2, $attempt - 1)) + (Get-Random -Minimum 0 -Maximum 1000) / 1000
            Write-AgentLog -Level WARN -Message "Delivery attempt $attempt failed; retry in $([Math]::Round($delay, 1))s. $($_.Exception.Message)"
            Start-Sleep -Milliseconds ([int]($delay * 1000))
        }
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Config not found: $ConfigPath" }
$rawConfig = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$config = @{
    Endpoint = if ($env:ORDA_MONITOR_ENDPOINT) { $env:ORDA_MONITOR_ENDPOINT } else { [string](Get-OptionalProperty $rawConfig 'Endpoint') }
    AgentKey = if ($env:ORDA_MONITOR_AGENT_KEY) { $env:ORDA_MONITOR_AGENT_KEY } else { [string](Get-OptionalProperty $rawConfig 'AgentKey') }
    ServerId = if ($env:SERVER_ID) { $env:SERVER_ID } else { [string](Get-OptionalProperty $rawConfig 'ServerId') }
    IntervalSeconds = [int](Get-OptionalProperty $rawConfig 'IntervalSeconds' 30)
    RequestTimeoutSeconds = [int](Get-OptionalProperty $rawConfig 'RequestTimeoutSeconds' 10)
    MaxAttempts = [int](Get-OptionalProperty $rawConfig 'MaxAttempts' 4)
    ConnectivityHost = [string](Get-OptionalProperty $rawConfig 'ConnectivityHost' '1.1.1.1')
    ConnectivityTimeoutMs = [int](Get-OptionalProperty $rawConfig 'ConnectivityTimeoutMs' 3000)
}
if ($config.Endpoint -notmatch '^https://') { throw 'Endpoint must use HTTPS.' }
if ($config.AgentKey -notmatch '^smk_[a-z0-9]{12,48}\.[A-Za-z0-9_-]{43,128}$') { throw 'AgentKey has an invalid format.' }
$parsedServerId = [Guid]::Empty
if (-not [Guid]::TryParse($config.ServerId, [ref]$parsedServerId)) { throw 'ServerId must be a UUID.' }
if ($config.IntervalSeconds -lt 15 -or $config.IntervalSeconds -gt 3600) { throw 'IntervalSeconds must be between 15 and 3600.' }

$logDirectory = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }
$script:LogPath = Join-Path $logDirectory 'orda-monitor.log'

$mutex = [System.Threading.Mutex]::new($false, 'Global\ORDA_Server_Monitor')
$lockTaken = $false
try {
    try { $lockTaken = $mutex.WaitOne(0, $false) } catch [Threading.AbandonedMutexException] { $lockTaken = $true }
    if (-not $lockTaken) { throw 'Another ORDA Monitor instance is already running.' }
    Write-AgentLog -Level INFO -Message "ORDA Monitor $script:AgentVersion started in no-driver mode. once=$Once dryRun=$DryRun"
    do {
        $cycleStart = [DateTime]::UtcNow
        try {
            $payload = Get-Telemetry -Config $config
            Send-Telemetry -Config $config -Payload $payload
        } catch {
            Write-AgentLog -Level ERROR -Message "Collection cycle failed: $($_.Exception.Message)"
        }
        if ($Once) { break }
        $elapsed = ([DateTime]::UtcNow - $cycleStart).TotalSeconds
        $sleep = [Math]::Max(1, [int]$config.IntervalSeconds - [int][Math]::Floor($elapsed))
        Start-Sleep -Seconds $sleep
    } while ($true)
} finally {
    if ($lockTaken) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
