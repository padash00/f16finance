[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallPath = 'C:\ORDA-Monitor',
    [string]$TaskName = 'ORDA Server Monitor',
    [switch]$RemoveFiles
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run uninstall.ps1 from an elevated Windows PowerShell 5.1 session.'
}
$resolvedInstall = [IO.Path]::GetFullPath($InstallPath)
if ($resolvedInstall -eq [IO.Path]::GetPathRoot($resolvedInstall)) { throw 'Refusing to operate on a filesystem root.' }
$agentPath = Join-Path $resolvedInstall 'orda-monitor.ps1'
$taskDescription = 'ORDA Control Windows Server telemetry agent'

if ($PSCmdlet.ShouldProcess($TaskName, 'Stop and unregister only the ORDA monitoring task')) {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        $ownedAction = @($task.Actions) | Where-Object {
            ([string]$_.Arguments).IndexOf($agentPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
        }
        if ($task.Description -ne $taskDescription -or @($ownedAction).Count -eq 0) {
            throw "Scheduled task '$TaskName' is not owned by ORDA Monitor. Nothing was removed."
        }
        Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false
    }
}
if ($RemoveFiles -and (Test-Path -LiteralPath $resolvedInstall)) {
    $markerPath = Join-Path $resolvedInstall '.orda-monitor-install'
    $marker = if (Test-Path -LiteralPath $markerPath) { (Get-Content -Raw -LiteralPath $markerPath).Trim() } else { '' }
    if ($marker -ne 'ORDA_CONTROL_SERVER_MONITOR_V1') {
        throw "Refusing to remove '$resolvedInstall': the ORDA installation marker is missing or invalid."
    }
    if ($PSCmdlet.ShouldProcess($resolvedInstall, 'Remove ORDA Monitor files and logs')) {
        Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
    }
}
Write-Host 'ORDA Monitor removed without reboot. No other service or system setting was changed.' -ForegroundColor Green
