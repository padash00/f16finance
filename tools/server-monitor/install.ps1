[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$Endpoint,
    [Parameter(Mandatory = $true)][string]$AgentKey,
    [Parameter(Mandatory = $true)][Guid]$ServerId,
    [string]$InstallPath = 'C:\ORDA-Monitor',
    [string]$TaskName = 'ORDA Server Monitor'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run install.ps1 from an elevated Windows PowerShell 5.1 session.'
}
if ($AgentKey -notmatch '^smk_[a-z0-9]{12,48}\.[A-Za-z0-9_-]{43,128}$') { throw 'AgentKey has an invalid format.' }
$resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $InstallPath))
$resolvedInstall = [IO.Path]::GetFullPath($InstallPath)
if ($resolvedInstall -eq [IO.Path]::GetPathRoot($resolvedInstall) -or -not $resolvedInstall.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'InstallPath must be a dedicated non-root directory.'
}
$sourceAgent = Join-Path $PSScriptRoot 'orda-monitor.ps1'
if (-not (Test-Path -LiteralPath $sourceAgent)) { throw "Agent source not found: $sourceAgent" }
$sourceSensorProvider = Join-Path $PSScriptRoot 'sensor-provider.ps1'
if (-not (Test-Path -LiteralPath $sourceSensorProvider)) { throw "Sensor provider not found: $sourceSensorProvider" }
$sourceDiagnostics = Join-Path $PSScriptRoot 'agent-diagnostics.ps1'
if (-not (Test-Path -LiteralPath $sourceDiagnostics)) { throw "Diagnostics provider not found: $sourceDiagnostics" }
$taskDescription = 'ORDA Control Windows Server telemetry agent'
$agentPath = Join-Path $resolvedInstall 'orda-monitor.ps1'
$existing = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    $ownedAction = @($existing.Actions) | Where-Object {
        ([string]$_.Arguments).IndexOf($agentPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($existing.Description -ne $taskDescription -or @($ownedAction).Count -eq 0) {
        throw "Scheduled task '$TaskName' already exists but is not owned by ORDA Monitor. Nothing was changed."
    }
}

if ($PSCmdlet.ShouldProcess($resolvedInstall, 'Install and start ORDA Server Monitor')) {
    if ($existing) {
        Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if ((Get-ScheduledTask -TaskPath '\' -TaskName $TaskName).State -ne 'Running') { break }
            Start-Sleep -Milliseconds 250
        }
        if ((Get-ScheduledTask -TaskPath '\' -TaskName $TaskName).State -eq 'Running') {
            throw 'The existing ORDA Monitor task did not stop within 5 seconds. No files were replaced.'
        }
    }
    New-Item -ItemType Directory -Path $resolvedInstall -Force | Out-Null
    & icacls.exe $resolvedInstall /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict ACL on the installation directory.' }
    New-Item -ItemType Directory -Path (Join-Path $resolvedInstall 'logs') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $resolvedInstall 'state') -Force | Out-Null
    Copy-Item -LiteralPath $sourceAgent -Destination (Join-Path $resolvedInstall 'orda-monitor.ps1') -Force
    Copy-Item -LiteralPath $sourceSensorProvider -Destination (Join-Path $resolvedInstall 'sensor-provider.ps1') -Force
    Copy-Item -LiteralPath $sourceDiagnostics -Destination (Join-Path $resolvedInstall 'agent-diagnostics.ps1') -Force
    $sourceSensors = Join-Path $PSScriptRoot 'sensors'
    if (Test-Path -LiteralPath $sourceSensors -PathType Container) {
        $targetSensors = Join-Path $resolvedInstall 'sensors'
        New-Item -ItemType Directory -Path $targetSensors -Force | Out-Null
        Copy-Item -Path (Join-Path $sourceSensors '*') -Destination $targetSensors -Recurse -Force
    }
    $sourceUninstall = Join-Path $PSScriptRoot 'uninstall.ps1'
    if (Test-Path -LiteralPath $sourceUninstall) {
        Copy-Item -LiteralPath $sourceUninstall -Destination (Join-Path $resolvedInstall 'uninstall.ps1') -Force
    }
    Set-Content -LiteralPath (Join-Path $resolvedInstall '.orda-monitor-install') -Value 'ORDA_CONTROL_SERVER_MONITOR_V1' -Encoding ASCII

    $config = [ordered]@{
        Endpoint = if (([Uri]$Endpoint).Host -eq 'ordaops.kz') { $Endpoint.Replace('https://ordaops.kz', 'https://www.ordaops.kz').TrimEnd('/') } else { $Endpoint.TrimEnd('/') }
        AgentKey = $AgentKey
        ServerId = $ServerId.ToString()
        IntervalSeconds = 30
        RequestTimeoutSeconds = 10
        MaxAttempts = 4
        ConnectivityHost = '1.1.1.1'
        ConnectivityTimeoutMs = 3000
    }
    $configPath = Join-Path $resolvedInstall 'config.json'
    $tempConfig = Join-Path $resolvedInstall 'config.json.new'
    $config | ConvertTo-Json | Set-Content -LiteralPath $tempConfig -Encoding UTF8
    Move-Item -LiteralPath $tempConfig -Destination $configPath -Force

    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$agentPath`"" -WorkingDirectory $resolvedInstall
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    try {
        Register-ScheduledTask -TaskPath '\' -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Description $taskDescription -Force | Out-Null
    } catch {
        if ($existing) { Start-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue }
        throw
    }
    Start-ScheduledTask -TaskPath '\' -TaskName $TaskName
    Start-Sleep -Seconds 2
    $state = (Get-ScheduledTask -TaskPath '\' -TaskName $TaskName).State
    Write-Host "ORDA Monitor installed without reboot. Task state: $state" -ForegroundColor Green
    Write-Host "Install path: $resolvedInstall"
}
