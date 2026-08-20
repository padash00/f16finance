<#
.SYNOPSIS
    Разведка SENET — где что лежит на клиентской машине.

.DESCRIPTION
    Самостоятельный скрипт, не связанный с probe. Ничего не отправляет на
    сервер: только осматривает машину и пишет отчёт в файл рядом с собой.

    Задача одна — найти, откуда читать данные сессии клиента: логин, остаток
    времени, тип счёта, тариф. В задании были перечислены поля, но не пути к
    файлам, а угадывать пути значит писать разбор под файл, которого нет.

    ЧТО ПЕЧАТАЕТ:
      — службы SENET и клубной обвязки с путями к их программам;
      — процессы SENET;
      — каталоги SENET в типовых местах;
      — файлы настроек и журналов: имя, размер, дата;
      — для файлов JSON — ИМЕНА полей, но НЕ значения.

    ЧЕГО НЕ ПЕЧАТАЕТ:
      — значения полей. В них могут быть токены, коды, суммы. Нам нужна
        структура «где лежит account_type», а не сам токен.

    Запускать лучше под КЛИЕНТСКОЙ учётной записью SENET: под Support файлов
    клиентской сессии может не быть видно. Права администратора помогают
    увидеть службы, но не обязательны.
#>

[CmdletBinding()]
param(
    [int]$MaxFiles = 80,
    [int]$MaxKeysPerFile = 60
)

$ErrorActionPreference = 'Continue'

# Каталог для отчёта. $PSScriptRoot есть только когда скрипт запущен файлом;
# при встраивании в батник его нет, и путь приходит переменной $ScanRoot.
# Порядок важен: $ScanRoot приходит снаружи и указывает, где лежит батник.
# $PSScriptRoot при запуске из батника указывает во временную папку — отчёт
# оказался бы в %TEMP% и был бы стёрт вместе с распакованным скриптом.
$Root = if ($ScanRoot) { $ScanRoot }
        elseif ($PSScriptRoot) { $PSScriptRoot }
        else { (Get-Location).Path }

$ReportPath = Join-Path $Root 'senet-scan-report.txt'
if (Test-Path $ReportPath) { Remove-Item $ReportPath -Force -ErrorAction SilentlyContinue }

function Line($text) {
    Write-Host $text
    Add-Content -Path $ReportPath -Value $text -Encoding UTF8 -ErrorAction SilentlyContinue
}
function Head($text) {
    Line ''
    Line "==================================================================="
    Line "  $text"
    Line "==================================================================="
}

# Что считаем «относящимся к SENET». Узко: слово shell в общем виде ловит
# системные процессы Windows, поэтому только точные имена обвязки.
$Pattern = 'senet|clubnet|ccboot|gcafe|appnotify'

Line "РАЗВЕДКА SENET"
Line "Машина: $env:COMPUTERNAME"
Line "Пользователь: $(if ($env:USERNAME) { $env:USERNAME } else { 'неизвестен' })"
Line "Время: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Line "Ничего не отправляется. Значения полей не печатаются."

# ─────────────────────────────────────────────────────────────────────────────
Head "1. СЛУЖБЫ SENET"
# ─────────────────────────────────────────────────────────────────────────────
# Службы виднее процессов: они есть даже когда клиент вышел, и у них в свойствах
# записан путь к программе — по нему находится каталог установки SENET.
try {
    $services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $Pattern -or $_.DisplayName -match $Pattern -or $_.PathName -match $Pattern }
    if ($services) {
        foreach ($svc in $services) {
            Line "  $($svc.Name)  [$($svc.State)]  $($svc.StartMode)"
            Line "      $($svc.PathName)"
        }
    } else {
        Line "  служб по SENET не найдено"
    }
} catch { Line "  не удалось прочитать службы: $($_.Exception.Message)" }

# ─────────────────────────────────────────────────────────────────────────────
Head "2. ПРОЦЕССЫ SENET"
# ─────────────────────────────────────────────────────────────────────────────
$roots = @()
try {
    $procs = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path -notlike "$env:SystemRoot*" -and $_.ProcessName -match $Pattern }
    if ($procs) {
        foreach ($p in $procs) {
            Line "  $($p.ProcessName).exe  ->  $($p.Path)"
            $dir = Split-Path $p.Path -Parent
            if ($dir -and $roots -notcontains $dir) { $roots += $dir }
        }
    } else {
        Line "  процессов по SENET не найдено (возможно, запущены под другим пользователем)"
    }
} catch { Line "  не удалось прочитать процессы: $($_.Exception.Message)" }

# Пути из служб тоже дают каталоги установки.
if ($services) {
    foreach ($svc in $services) {
        if ($svc.PathName) {
            $clean = $svc.PathName.Trim('"')
            $clean = ($clean -split '" ')[0].Trim('"')
            $dir = Split-Path $clean -Parent -ErrorAction SilentlyContinue
            if ($dir -and (Test-Path $dir) -and $roots -notcontains $dir) { $roots += $dir }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Head "3. КАТАЛОГИ SENET"
# ─────────────────────────────────────────────────────────────────────────────
# Типовые места установки. Проверяем каждое; найденное добавляем к каталогам из
# процессов и служб.
$guesses = @(
    "$env:ProgramData\SENET",       "$env:ProgramData\Senet",
    "${env:ProgramFiles(x86)}\SENET", "${env:ProgramFiles(x86)}\Senet",
    "$env:ProgramFiles\SENET",      "$env:ProgramFiles\Senet",
    "$env:LOCALAPPDATA\SENET",      "$env:APPDATA\SENET",
    "$env:ProgramData\ClubNet",     "${env:ProgramFiles(x86)}\ClubNet",
    "$env:ProgramData\CCBoot",      "${env:ProgramFiles(x86)}\CCBoot",
    "C:\SENET", "C:\Senet", "C:\ProgramData\Senet", "D:\SENET"
)
foreach ($g in $guesses) {
    if ((Test-Path $g) -and $roots -notcontains $g) { $roots += $g }
}

if ($roots) {
    foreach ($r in $roots) { Line "  $r" }
} else {
    Line "  каталоги не найдены — SENET установлен в нетиповом месте"
    Line "  подскажите путь вручную, если знаете, где стоит клиент"
}

# ─────────────────────────────────────────────────────────────────────────────
Head "4. ФАЙЛЫ НАСТРОЕК И ЖУРНАЛОВ"
# ─────────────────────────────────────────────────────────────────────────────
$files = @()
foreach ($r in $roots) {
    try {
        $files += Get-ChildItem -Path $r -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Extension -match '^\.(json|xml|ini|cfg|conf|log|txt|dat|db|config)$' -and
                $_.Length -lt 5MB
            }
    } catch { }
}
$files = $files | Sort-Object LastWriteTime -Descending | Select-Object -First $MaxFiles

if ($files) {
    foreach ($f in $files) {
        Line "  $($f.FullName)"
        Line "      $([int]($f.Length / 1KB)) КБ, изменён $($f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    }
} else {
    Line "  подходящих файлов не найдено"
}

# ─────────────────────────────────────────────────────────────────────────────
Head "5. СТРУКТУРА JSON-ФАЙЛОВ (только имена полей, без значений)"
# ─────────────────────────────────────────────────────────────────────────────
# Здесь и ищется то, ради чего всё: поля вроде user_session_id, account_type,
# seconds_left. Печатаем ИМЕНА полей и ничего больше — значение поля может быть
# токеном или кодом, а нам нужна карта, а не содержимое.
function Show-Keys($obj, $prefix, [ref]$count) {
    if ($count.Value -ge $MaxKeysPerFile) { return }
    if ($obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $obj.PSObject.Properties) {
            if ($count.Value -ge $MaxKeysPerFile) { return }
            Line "      $prefix$($prop.Name)"
            $count.Value++
            if ($prop.Value -is [System.Management.Automation.PSCustomObject]) {
                Show-Keys $prop.Value "$prefix$($prop.Name)." $count
            }
        }
    }
}

$jsonFiles = $files | Where-Object { $_.Extension -match '^\.(json|config)$' } | Select-Object -First 15
if ($jsonFiles) {
    foreach ($f in $jsonFiles) {
        try {
            $raw = Get-Content $f.FullName -Raw -ErrorAction Stop
            $obj = $raw | ConvertFrom-Json -ErrorAction Stop
            Line ""
            Line "  $($f.Name):"
            $c = 0
            if ($obj -is [System.Array]) {
                Line "      (массив из $($obj.Count); поля первого элемента:)"
                if ($obj.Count -gt 0) { Show-Keys $obj[0] "" ([ref]$c) }
            } else {
                Show-Keys $obj "" ([ref]$c)
            }
        } catch {
            Line "  $($f.Name): не JSON или не прочитался"
        }
    }
} else {
    Line "  JSON-файлов не найдено"
}

Line ''
Line "==================================================================="
Line "Готово. Отчёт сохранён: $ReportPath"
Line "Пришлите этот файл — по нему будет видно, откуда читать данные сессии."
Line "==================================================================="

# Явный выход с нулём. «Ничего не найдено» — это результат разведки, а не сбой:
# без этого любая мелкая ошибка чтения делала бы код возврата ненулевым, и
# батник сообщал бы о провале там, где всё отработало.
exit 0
