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
    # Найдено разведкой на станции 21: вендор SENET — Enestech.
    "$env:ProgramFiles\Enestech",  "${env:ProgramFiles(x86)}\Enestech",
    "$env:ProgramData\Enestech",   "$env:LOCALAPPDATA\Enestech",
    "$env:APPDATA\Enestech",       "D:\SENET\Enestech", "D:\SENET",
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
                $_.Extension -match '^\.(json|xml|ini|cfg|conf|log|txt|dat|db|config|sqlite|sqlite3|litedb|state|session)$' -and
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

# ─────────────────────────────────────────────────────────────────────────────
Head "6. СТРУКТУРА КАТАЛОГОВ (имена папок, два уровня)"
# ─────────────────────────────────────────────────────────────────────────────
# Названия папок сами по себе подсказывают, где искать: Shell, Client, Session,
# Cache. Без этого приходится гадать по одним лишь файлам.
foreach ($r in $roots) {
    Line ""
    Line "  $r"
    try {
        Get-ChildItem -Path $r -Directory -ErrorAction SilentlyContinue |
            Select-Object -First 25 | ForEach-Object {
                Line "      $($_.Name)\"
                Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue |
                    Select-Object -First 12 | ForEach-Object { Line "          $($_.Name)\" }
            }
    } catch { Line "      нет доступа" }
}

# ─────────────────────────────────────────────────────────────────────────────
Head "7. ФАЙЛЫ, ИЗМЕНЁННЫЕ ЗА ПОСЛЕДНИЙ ЧАС (любые расширения)"
# ─────────────────────────────────────────────────────────────────────────────
# Самый полезный раздел, если запускать при активной сессии клиента: данные
# сессии пишутся В МОМЕНТ входа, и свежая отметка времени выдаёт нужный файл
# вернее любого угадывания по имени.
$since = (Get-Date).AddHours(-1)
$fresh = @()
foreach ($r in $roots) {
    try {
        $fresh += Get-ChildItem -Path $r -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt $since -and $_.Length -lt 20MB }
    } catch { }
}
if ($fresh) {
    foreach ($f in ($fresh | Sort-Object LastWriteTime -Descending | Select-Object -First 40)) {
        Line "  $($f.LastWriteTime.ToString('HH:mm:ss'))  $([int]($f.Length / 1KB)) КБ  $($f.FullName)"
    }
} else {
    Line "  ничего не менялось за час"
    Line "  (запустите при АКТИВНОЙ сессии клиента — тогда здесь будет главное)"
}

# ─────────────────────────────────────────────────────────────────────────────
Head "8. РЕЕСТР: ветки Enestech и SENET"
# ─────────────────────────────────────────────────────────────────────────────
# Настройки клиента часто лежат в реестре, а не в файлах. Печатаются имена
# веток и параметров, значения — нет.
foreach ($hive in @('HKLM:\SOFTWARE', 'HKLM:\SOFTWARE\WOW6432Node', 'HKCU:\SOFTWARE')) {
    foreach ($vendor in @('Enestech', 'SENET', 'Senet')) {
        $path = "$hive\$vendor"
        if (Test-Path $path) {
            Line "  $path"
            try {
                Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue |
                    Select-Object -First 20 | ForEach-Object {
                        Line "      $($_.Name)"
                        $props = ($_ | Get-ItemProperty -ErrorAction SilentlyContinue).PSObject.Properties |
                            Where-Object { $_.Name -notmatch '^PS' } | Select-Object -First 15
                        foreach ($prop in $props) { Line "          параметр: $($prop.Name)" }
                    }
            } catch { Line "      нет доступа" }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Head "9. КЛЮЧЕВЫЕ ФАЙЛЫ: СОДЕРЖИМОЕ С МАСКИРОВКОЙ"
# ─────────────────────────────────────────────────────────────────────────────
# Здесь единственное место, где печатаются значения, — и только для файлов,
# где они заведомо не секрет: номер станции и её MAC.
#
# Для журналов печатается хвост с маскировкой: длинные строки из букв и цифр
# заменяются многоточием, потому что именно так выглядят токены. Нам нужен
# ФОРМАТ записи о входе, а не сам ключ доступа.

function Hide-Secrets([string]$text) {
    if (-not $text) { return $text }
    # Длинные однородные последовательности — почти всегда токен или хэш.
    $out = [regex]::Replace($text, '[A-Za-z0-9+/=_\-]{24,}', '<скрыто>')
    # И всё, что идёт после слова-маркера.
    $out = [regex]::Replace($out, '(?i)(token|password|secret|apikey|api_key|authorization|bearer)\s*[:=]\s*\S+', '$1=<скрыто>')
    return $out
}

Line ""
Line "  --- State.json (номер станции в SENET) ---"
$statePath = "$env:ProgramData\Enestech\Service\State.json"
if (Test-Path $statePath) {
    try {
        $state = Get-Content $statePath -Raw -ErrorAction Stop | ConvertFrom-Json
        Line "      mac    = $($state.mac)"
        Line "      ws_num = $($state.ws_num)"
    } catch { Line "      не прочитался: $($_.Exception.Message)" }
} else {
    Line "      файла нет"
}

Line ""
Line "  --- Session.json (служебное состояние) ---"
$sessionPath = "$env:ProgramData\Enestech\Service\Session.json"
if (Test-Path $sessionPath) {
    try {
        $raw = (Get-Content $sessionPath -Raw -ErrorAction Stop).Trim()
        if ($raw.Length -eq 0) {
            Line "      файл пуст"
        } else {
            Line "      $(Hide-Secrets $raw)"
        }
    } catch { Line "      не прочитался" }
} else {
    Line "      файла нет"
}

# Журналы: последние строки. Ищем, как выглядит запись о входе клиента.
$logs = @(
    'workstation-service.log',
    'senet-credential.log',
    'elauncher.log',
    'lagent.log'
)
foreach ($logName in $logs) {
    $logPath = "$env:ProgramData\Enestech\Logs\$logName"
    Line ""
    Line "  --- $logName (последние 30 строк) ---"
    if (-not (Test-Path $logPath)) {
        Line "      файла нет"
        continue
    }
    try {
        $tail = Get-Content $logPath -Tail 30 -ErrorAction Stop
        foreach ($ln in $tail) {
            $clean = Hide-Secrets $ln
            if ($clean.Length -gt 300) { $clean = $clean.Substring(0, 300) + ' …' }
            Line "      $clean"
        }
    } catch {
        Line "      не прочитался: $($_.Exception.Message)"
    }
}

# Отдельно — строки, где встречается имя вошедшего пользователя. Это самый
# короткий путь к тому, как SENET записывает логин клиента.
$me = $env:USERNAME
Line ""
Line "  --- строки журналов с именем текущего пользователя ---"
if ($me) {
    $hits = 0
    foreach ($logName in $logs) {
        $logPath = "$env:ProgramData\Enestech\Logs\$logName"
        if (-not (Test-Path $logPath)) { continue }
        try {
            $found = Select-String -Path $logPath -Pattern ([regex]::Escape($me)) -SimpleMatch -ErrorAction SilentlyContinue |
                Select-Object -Last 6
            foreach ($f in $found) {
                $clean = Hide-Secrets $f.Line
                if ($clean.Length -gt 300) { $clean = $clean.Substring(0, 300) + ' …' }
                Line "      [$logName : $($f.LineNumber)]  $clean"
                $hits++
            }
        } catch { }
    }
    if ($hits -eq 0) { Line "      имя '$me' в журналах не встречается" }
} else {
    Line "      имя пользователя не определено"
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
