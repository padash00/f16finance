[CmdletBinding()]
param(
    [string]$OutputPath = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $OutputPath) { $OutputPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'ORDA-Server-Monitor-1.2.0.zip' }

$releaseUrl = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip'
$releaseSha256 = '086D9F1B5A99E643EDC2CFAAAC16051685B551E4C5AC0B32A57C58C0E529C001'
$allowedSensorFiles = @(
    'BlackSharp.Core.dll',
    'LibreHardwareMonitorLib.dll',
    'DiskInfoToolkit.dll',
    'HidSharp.dll',
    'RAMSPDToolkit-NDD.dll',
    'Microsoft.Bcl.AsyncInterfaces.dll',
    'Microsoft.Bcl.HashCode.dll',
    'System.Buffers.dll',
    'System.Collections.Immutable.dll',
    'System.CodeDom.dll',
    'System.Formats.Nrbf.dll',
    'System.IO.Pipelines.dll',
    'System.Memory.dll',
    'System.Numerics.Vectors.dll',
    'System.Reflection.Metadata.dll',
    'System.Resources.Extensions.dll',
    'System.Runtime.CompilerServices.Unsafe.dll',
    'System.Security.AccessControl.dll',
    'System.Security.Principal.Windows.dll',
    'System.Text.Encodings.Web.dll',
    'System.Text.Json.dll',
    'System.Threading.AccessControl.dll',
    'System.Threading.Tasks.Extensions.dll'
)

$work = Join-Path ([IO.Path]::GetTempPath()) ('orda-monitor-package-' + [Guid]::NewGuid().ToString('N'))
$download = Join-Path $work 'LibreHardwareMonitor.zip'
$expanded = Join-Path $work 'lhm'
$package = Join-Path $work 'server-monitor'
try {
    New-Item -ItemType Directory -Path $expanded, $package, (Join-Path $package 'sensors') -Force | Out-Null
    Invoke-WebRequest -Uri $releaseUrl -OutFile $download -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
    if ($actualHash -ne $releaseSha256) { throw "LibreHardwareMonitor archive hash mismatch. Expected $releaseSha256, got $actualHash." }
    Expand-Archive -LiteralPath $download -DestinationPath $expanded

    foreach ($name in @('install.ps1', 'uninstall.ps1', 'orda-monitor.ps1', 'sensor-provider.ps1', 'agent-diagnostics.ps1', 'config.example.json')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $package
    }
    foreach ($name in $allowedSensorFiles) {
        $source = Join-Path $expanded $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required sensor dependency is missing from the pinned release: $name" }
        Copy-Item -LiteralPath $source -Destination (Join-Path $package 'sensors')
    }

    $libraryVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $package 'sensors\LibreHardwareMonitorLib.dll')).FileVersion
    if ($libraryVersion -ne '0.9.6.0') { throw "Unexpected sensor library version: $libraryVersion" }
    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = Split-Path -Parent $resolvedOutput
    if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
    if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Force }
    Compress-Archive -Path $package -DestinationPath $resolvedOutput -CompressionLevel Optimal
    Write-Output $resolvedOutput
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
