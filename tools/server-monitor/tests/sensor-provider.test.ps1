[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$providerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'sensor-provider.ps1'
if (-not (Test-Path -LiteralPath $providerPath)) {
    throw "Sensor provider is missing: $providerPath"
}
. $providerPath

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Expected='$Expected' Actual='$Actual'"
    }
}

$records = @(
    [pscustomobject]@{ HardwareType = 'Cpu'; HardwareIdentifier = '/cpu/0'; HardwareName = 'Intel Xeon'; SensorType = 'Temperature'; SensorName = 'CPU Package'; Value = 87.0 },
    [pscustomobject]@{ HardwareType = 'Cpu'; HardwareIdentifier = '/cpu/0'; HardwareName = 'Intel Xeon'; SensorType = 'Temperature'; SensorName = 'CPU Core #1'; Value = 82.0 },
    [pscustomobject]@{ HardwareType = 'Cpu'; HardwareIdentifier = '/cpu/0'; HardwareName = 'Intel Xeon'; SensorType = 'Temperature'; SensorName = 'CPU Core #2'; Value = 92.0 },
    [pscustomobject]@{ HardwareType = 'Storage'; HardwareIdentifier = '/nvme/0'; HardwareName = 'Samsung SSD 990 PRO'; SensorType = 'Temperature'; SensorName = 'Composite Temperature'; Value = 55.0 },
    [pscustomobject]@{ HardwareType = 'Storage'; HardwareIdentifier = '/nvme/0'; HardwareName = 'Samsung SSD 990 PRO'; SensorType = 'Temperature'; SensorName = 'Temperature #1'; Value = 61.0 },
    [pscustomobject]@{ HardwareType = 'Storage'; HardwareIdentifier = '/nvme/0'; HardwareName = 'Samsung SSD 990 PRO'; SensorType = 'Temperature'; SensorName = 'Warning Temperature'; Value = 84.0 },
    [pscustomobject]@{ HardwareType = 'Storage'; HardwareIdentifier = '/nvme/0'; HardwareName = 'Samsung SSD 990 PRO'; SensorType = 'Temperature'; SensorName = 'Critical Temperature'; Value = 93.0 },
    [pscustomobject]@{ HardwareType = 'Cpu'; HardwareIdentifier = '/cpu/0'; HardwareName = 'Intel Xeon'; SensorType = 'Temperature'; SensorName = 'Invalid sensor'; Value = 0.0 },
    [pscustomobject]@{ HardwareType = 'Cpu'; HardwareIdentifier = '/cpu/0'; HardwareName = 'Intel Xeon'; SensorType = 'Load'; SensorName = 'CPU Total'; Value = 41.0 }
)

$result = Convert-HardwareSensorRecords -Records $records -Source 'fixture'
Assert-Equal 87.0 $result.CpuPackage 'CPU package temperature was not mapped.'
Assert-Equal 92.0 $result.CpuCoreMax 'Maximum CPU core temperature was not mapped.'
Assert-Equal 55.0 $result.Storage['/nvme/0'].TemperatureC 'Storage temperature was not mapped.'
Assert-Equal 'Composite Temperature' $result.Storage['/nvme/0'].TemperatureSensor 'Storage did not select its composite temperature.'
Assert-Equal 'fixture' $result.Source 'Sensor source was not retained.'

$windowsStorage = @{
    'disk-0' = [ordered]@{
        Name = 'Samsung SSD 990 PRO'
        TemperatureC = $null
        Health = 'Healthy'
        WearPercent = 4.0
        Source = 'Windows Storage Management'
    }
}
$merged = Merge-StorageSensors -Primary $result.Storage -Secondary $windowsStorage
Assert-Equal 55.0 $merged['/nvme/0'].TemperatureC 'Hardware temperature was overwritten.'
Assert-Equal 'Healthy' $merged['/nvme/0'].Health 'Windows health was not merged.'
Assert-Equal 4.0 $merged['/nvme/0'].WearPercent 'Windows wear was not merged.'

$unsafePatterns = 'InstallPawnIO|PawnIO_setup|New-Service|sc\.exe|pnputil|Restart-Computer|Stop-Computer'
$providerSource = Get-Content -Raw -LiteralPath $providerPath
if ($providerSource -match $unsafePatterns) {
    throw "Sensor provider contains a forbidden production operation: $($Matches[0])"
}

Write-Output 'PASS sensor-provider'
