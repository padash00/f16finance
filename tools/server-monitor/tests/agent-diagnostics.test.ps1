[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'agent-diagnostics.ps1')

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message Expected '$Expected', got '$Actual'." }
}

Reset-OrdaProcessDiagnostics
$first = @(Get-OrdaTopProcesses -LogicalProcessorCount 4 -NowUtc ([DateTime]'2026-09-05T10:00:00Z') -Processes @(
    [pscustomobject]@{ Id = 42; ProcessName = 'worker'; CPU = 10.0; WorkingSet64 = 104857600; StartTime = [DateTime]'2026-09-05T09:00:00Z' }
))
Assert-Equal $first.Count 0 'The first process sample must only establish a baseline.'

$second = @(Get-OrdaTopProcesses -LogicalProcessorCount 4 -NowUtc ([DateTime]'2026-09-05T10:00:10Z') -Processes @(
    [pscustomobject]@{ Id = 42; ProcessName = 'worker'; CPU = 30.0; WorkingSet64 = 125829120; StartTime = [DateTime]'2026-09-05T09:00:00Z' }
))
Assert-Equal $second.Count 1 'One busy process must remain an array item.'
Assert-Equal $second[0].cpuPercent 50 'CPU must be normalized across logical processors.'

$healthy = Resolve-OrdaNetworkVerdict -GatewayReachable $true -ExternalReachable $true -DnsReachable $true -HttpsReachable $true
$dnsFailure = Resolve-OrdaNetworkVerdict -GatewayReachable $true -ExternalReachable $true -DnsReachable $false -HttpsReachable $false
$gatewayFailure = Resolve-OrdaNetworkVerdict -GatewayReachable $false -ExternalReachable $false -DnsReachable $false -HttpsReachable $false
Assert-Equal $healthy 'healthy' 'Healthy probes must produce a healthy verdict.'
Assert-Equal $dnsFailure 'dns_failure' 'Reachable IP with failed DNS must identify DNS.'
Assert-Equal $gatewayFailure 'gateway_unreachable' 'Failed gateway and external probes must identify the gateway path.'

$payload = [ordered]@{
    cpu = [ordered]@{ topProcesses = [object[]]@($second) }
    network = [ordered]@{ diagnostics = [ordered]@{ dns = [ordered]@{ addresses = [object[]]@('203.0.113.10') } } }
} | ConvertTo-Json -Depth 10 | ConvertFrom-Json
Assert-Equal @($payload.cpu.topProcesses).Count 1 'A single process must serialize as an array.'
Assert-Equal @($payload.network.diagnostics.dns.addresses).Count 1 'A single DNS address must serialize as an array.'
Assert-Equal ($payload.cpu.topProcesses -is [array]) $true 'The process JSON token must be an array.'
Assert-Equal ($payload.network.diagnostics.dns.addresses -is [array]) $true 'The DNS address JSON token must be an array.'

$unsafePatterns = 'Restart-Computer|Stop-Computer|shutdown\.exe|logoff\.exe|Restart-NetAdapter|Disable-NetAdapter|Enable-NetAdapter|Set-NetIP|New-NetIP|Remove-NetIP|netsh(?:\.exe)?|Set-NetFirewall|New-NetFirewall|Remove-NetFirewall|Set-Service|Restart-Service|Stop-Service|Start-Service|pnputil|New-Service|sc\.exe'
$diagnosticsSource = Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'agent-diagnostics.ps1')
if ($diagnosticsSource -match $unsafePatterns) {
    throw "Diagnostics provider contains a forbidden production operation: $($Matches[0])"
}

Write-Output 'agent-diagnostics tests passed'
