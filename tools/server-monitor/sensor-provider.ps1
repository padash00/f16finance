Set-StrictMode -Version 2.0

$script:OrdaSensorComputer = $null
$script:OrdaSensorSource = $null
$script:OrdaSensorInitializationError = $null

function Get-SensorProperty {
    param([object]$Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object -is [Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Convert-HardwareSensorRecords {
    param([object[]]$Records, [string]$Source)

    $packageTemperatures = @()
    $coreTemperatures = @()
    $cpuSensors = @()
    $storage = @{}

    foreach ($record in @($Records)) {
        $sensorType = [string](Get-SensorProperty $record 'SensorType' '')
        if ($sensorType -ne 'Temperature') { continue }
        $rawValue = Get-SensorProperty $record 'Value'
        if ($null -eq $rawValue) { continue }
        $value = 0.0
        if ($rawValue -is [ValueType]) {
            try { $value = [double]$rawValue } catch { continue }
        } elseif (-not [double]::TryParse([string]$rawValue, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) { continue }
        if ([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt -100 -or $value -gt 250) { continue }

        $hardwareType = [string](Get-SensorProperty $record 'HardwareType' '')
        $hardwareId = [string](Get-SensorProperty $record 'HardwareIdentifier' '')
        $hardwareName = [string](Get-SensorProperty $record 'HardwareName' '')
        $sensorName = [string](Get-SensorProperty $record 'SensorName' '')

        if ($hardwareType -match 'Cpu') {
            if ($value -le 0) { continue }
            $cpuSensors += [ordered]@{ name = $sensorName; temperatureC = [Math]::Round($value, 2) }
            if ($sensorName -match '(?i)package|tdie|tctl') { $packageTemperatures += $value }
            if ($sensorName -match '(?i)core') { $coreTemperatures += $value }
        } elseif ($hardwareType -match 'Storage|HDD|SSD') {
            if ($value -le 0) { continue }
            if (-not $hardwareId) { $hardwareId = $hardwareName }
            if (-not $storage.ContainsKey($hardwareId)) {
                $storage[$hardwareId] = [ordered]@{
                    Name = $hardwareName
                    TemperatureC = $null
                    Source = $Source
                }
            }
            $current = $storage[$hardwareId].TemperatureC
            if ($null -eq $current -or $value -gt [double]$current) {
                $storage[$hardwareId].TemperatureC = [Math]::Round($value, 2)
            }
        }
    }

    $cpuPackage = if ($packageTemperatures.Count) { [Math]::Round(($packageTemperatures | Measure-Object -Maximum).Maximum, 2) } else { $null }
    $cpuCoreMax = if ($coreTemperatures.Count) { [Math]::Round(($coreTemperatures | Measure-Object -Maximum).Maximum, 2) } else { $null }
    return [pscustomobject]@{
        CpuPackage = $cpuPackage
        CpuCoreMax = $cpuCoreMax
        CpuSensors = $cpuSensors
        Storage = $storage
        ThermalZones = @()
        Source = $Source
        Errors = @()
    }
}

function Get-WmiHardwareSensorRecords {
    param([string]$Namespace)

    $hardwareById = @{}
    foreach ($hardware in @(Get-CimInstance -Namespace $Namespace -ClassName Hardware -ErrorAction Stop)) {
        $identifier = [string](Get-SensorProperty $hardware 'Identifier' '')
        $hardwareById[$identifier] = $hardware
    }
    $records = @()
    foreach ($sensor in @(Get-CimInstance -Namespace $Namespace -ClassName Sensor -ErrorAction Stop)) {
        $parent = [string](Get-SensorProperty $sensor 'Parent' '')
        $hardware = $hardwareById[$parent]
        $records += [pscustomobject]@{
            HardwareType = [string](Get-SensorProperty $hardware 'HardwareType' '')
            HardwareIdentifier = $parent
            HardwareName = [string](Get-SensorProperty $hardware 'Name' '')
            SensorType = [string](Get-SensorProperty $sensor 'SensorType' '')
            SensorName = [string](Get-SensorProperty $sensor 'Name' '')
            Value = Get-SensorProperty $sensor 'Value'
        }
    }
    return $records
}

function Initialize-LibreHardwareSensors {
    param([string]$LibraryPath)

    if ($script:OrdaSensorComputer -or $script:OrdaSensorInitializationError) { return }
    if (-not $LibraryPath -or -not (Test-Path -LiteralPath $LibraryPath -PathType Leaf)) { return }
    try {
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($LibraryPath).FileVersion
        if ($version -ne '0.9.6.0') { throw "Unsupported LibreHardwareMonitorLib.dll version '$version'; expected 0.9.6.0." }
        [void][Reflection.Assembly]::LoadFrom($LibraryPath)
        $computer = New-Object LibreHardwareMonitor.Hardware.Computer
        $computer.IsCpuEnabled = $true
        $computer.IsStorageEnabled = $true
        $computer.Open()
        $script:OrdaSensorComputer = $computer
        $script:OrdaSensorSource = 'LibreHardwareMonitorLib 0.9.6'
    } catch {
        $script:OrdaSensorInitializationError = $_.Exception.Message
    }
}

function Get-LibreHardwareRecordsRecursive {
    param([object]$Hardware)

    $records = @()
    $Hardware.Update()
    foreach ($sensor in @($Hardware.Sensors)) {
        $records += [pscustomobject]@{
            HardwareType = [string]$Hardware.HardwareType
            HardwareIdentifier = [string]$Hardware.Identifier
            HardwareName = [string]$Hardware.Name
            SensorType = [string]$sensor.SensorType
            SensorName = [string]$sensor.Name
            Value = $sensor.Value
        }
    }
    foreach ($child in @($Hardware.SubHardware)) {
        $records += @(Get-LibreHardwareRecordsRecursive -Hardware $child)
    }
    return $records
}

function Get-WindowsStorageSensors {
    $storage = @{}
    foreach ($disk in @(Get-PhysicalDisk -ErrorAction Stop)) {
        $temperature = $null
        $wear = $null
        try {
            $reliability = Get-StorageReliabilityCounter -PhysicalDisk $disk -ErrorAction Stop
            $temperature = Get-SensorProperty $reliability 'Temperature'
            $wear = Get-SensorProperty $reliability 'Wear'
        } catch { }
        $id = [string](Get-SensorProperty $disk 'UniqueId' '')
        if (-not $id) { $id = [string](Get-SensorProperty $disk 'DeviceId' '') }
        $storage[$id] = [ordered]@{
            Name = [string](Get-SensorProperty $disk 'FriendlyName' '')
            SerialNumber = [string](Get-SensorProperty $disk 'SerialNumber' '')
            TemperatureC = if ($null -ne $temperature -and [double]$temperature -gt 0 -and [double]$temperature -le 250) { [double]$temperature } else { $null }
            Health = [string](Get-SensorProperty $disk 'HealthStatus' '')
            OperationalStatus = (@(Get-SensorProperty $disk 'OperationalStatus' @()) -join ', ')
            MediaType = [string](Get-SensorProperty $disk 'MediaType' '')
            BusType = [string](Get-SensorProperty $disk 'BusType' '')
            WearPercent = if ($null -ne $wear -and [double]$wear -ge 0 -and [double]$wear -le 100) { [double]$wear } else { $null }
            Source = 'Windows Storage Management'
        }
    }
    return $storage
}

function Get-AcpiThermalZones {
    $zones = @()
    foreach ($zone in @(Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)) {
        $kelvinTenths = Get-SensorProperty $zone 'CurrentTemperature'
        if ($null -eq $kelvinTenths) { continue }
        $celsius = ([double]$kelvinTenths / 10.0) - 273.15
        if ($celsius -ge -100 -and $celsius -le 250) {
            $zones += [ordered]@{ name = [string](Get-SensorProperty $zone 'InstanceName' 'ACPI thermal zone'); temperatureC = [Math]::Round($celsius, 2) }
        }
    }
    return $zones
}

function Merge-StorageSensors {
    param([hashtable]$Primary, [hashtable]$Secondary)

    foreach ($secondaryKey in @($Secondary.Keys)) {
        $secondaryDisk = $Secondary[$secondaryKey]
        $matchKey = @($Primary.Keys | Where-Object {
            $primaryName = [string](Get-SensorProperty $Primary[$_] 'Name' '')
            $secondaryName = [string](Get-SensorProperty $secondaryDisk 'Name' '')
            $primaryName -and $secondaryName -and ($primaryName.IndexOf($secondaryName, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $secondaryName.IndexOf($primaryName, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        } | Select-Object -First 1)
        if ($matchKey.Count) {
            $target = $Primary[$matchKey[0]]
            foreach ($name in @('SerialNumber', 'Health', 'OperationalStatus', 'MediaType', 'BusType', 'WearPercent')) {
                $value = Get-SensorProperty $secondaryDisk $name
                if ($null -ne $value -and [string]$value) { $target[$name] = $value }
            }
            if ($null -eq (Get-SensorProperty $target 'TemperatureC') -and $null -ne (Get-SensorProperty $secondaryDisk 'TemperatureC')) {
                $target['TemperatureC'] = $secondaryDisk.TemperatureC
                $target['Source'] = $secondaryDisk.Source
            }
        } else {
            $Primary[$secondaryKey] = $secondaryDisk
        }
    }
    return $Primary
}

function Get-HardwareSensorSnapshot {
    param([string]$LibraryPath)

    $errors = @()
    $result = $null
    foreach ($namespace in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
        try {
            $records = @(Get-WmiHardwareSensorRecords -Namespace $namespace)
            if ($records.Count) {
                $result = Convert-HardwareSensorRecords -Records $records -Source ($namespace -replace '^root/', '')
                break
            }
        } catch { }
    }

    if (-not $result) {
        Initialize-LibreHardwareSensors -LibraryPath $LibraryPath
        if ($script:OrdaSensorComputer) {
            try {
                $records = @()
                foreach ($hardware in @($script:OrdaSensorComputer.Hardware)) {
                    $records += @(Get-LibreHardwareRecordsRecursive -Hardware $hardware)
                }
                $result = Convert-HardwareSensorRecords -Records $records -Source $script:OrdaSensorSource
            } catch { $errors += $_.Exception.Message }
        } elseif ($script:OrdaSensorInitializationError) {
            $errors += $script:OrdaSensorInitializationError
        }
    }
    if (-not $result) { $result = Convert-HardwareSensorRecords -Records @() -Source 'Windows native' }

    try { $result.Storage = Merge-StorageSensors -Primary $result.Storage -Secondary (Get-WindowsStorageSensors) } catch { $errors += $_.Exception.Message }
    try { $result.ThermalZones = @(Get-AcpiThermalZones) } catch { }
    $result.Errors = $errors
    return $result
}

function Close-HardwareSensorProvider {
    if ($script:OrdaSensorComputer) {
        try { $script:OrdaSensorComputer.Close() } catch { }
        $script:OrdaSensorComputer = $null
    }
}
