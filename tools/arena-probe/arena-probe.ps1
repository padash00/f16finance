<#
.SYNOPSIS
    Orda Arena Probe — временный наблюдатель для проверки контракта.

.DESCRIPTION
    Это НЕ будущая служба Windows. Это одноразовый инструмент, который отвечает
    на один вопрос: можем ли мы наблюдать жизненный цикл игрового компьютера
    снаружи пользовательской сессии и без заметного влияния на машину.

    Probe ничего не решает. Он сообщает то, что видит Windows: кто залогинен,
    какие процессы запущены, когда компьютер загрузился. Все выводы — «станция
    занята», «это игра», «компьютер офлайн» — делает сервер. Так сделано
    специально: правила вывода будут меняться, а менять их на бездисковых
    машинах означает пересобирать образ.

    После перезагрузки бездискового клиента probe исчезнет вместе со всеми
    локальными изменениями. Для проверки это нормально: запустите его заново.

.PARAMETER Register
    Подать заявку. Выводит идентификатор устройства; дальше заявку нужно
    подтвердить в Orda, на вкладке «Мониторинг».

.PARAMETER DeviceToken
    Личный токен устройства. Выдаётся один раз при подтверждении.

.PARAMETER ClientSecret
    Личный секрет устройства. Выдаётся один раз при подтверждении.

.EXAMPLE
    .\arena-probe.ps1 -Register -BootstrapKey "..." -ProjectId "..."
    .\arena-probe.ps1 -DeviceToken "..." -ClientSecret "..."

.EXAMPLE
    # Проверки транспорта: повтор, обратный порядок, событие из будущего
    .\arena-probe.ps1 -DeviceToken "..." -ClientSecret "..." -SelfTest
#>

[CmdletBinding()]
param(
    [string]$ServerUrl = 'https://www.ordaops.kz',
    [string]$ProjectId = '',
    [string]$BootstrapKey = '',

    [switch]$Register,
    [switch]$SelfTest,

    [string]$DeviceToken = '',
    [string]$ClientSecret = '',

    # Имена учётных записей Windows. Значения по умолчанию — предположение;
    # на PC21 их надо будет уточнить по факту.
    [string]$SenetUserPattern = 'senet',
    [string]$SupportUserPattern = 'support|admin|техник',

    [int]$IntervalSec = 30,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$AgentVersion = 'probe-1'

# ─────────────────────────────────────────────────────────────────────────────
# МЕСТНЫЕ НАСТРОЙКИ
# ─────────────────────────────────────────────────────────────────────────────
# Ключ и учётные данные лежат в файле рядом со скриптом, а не в самом скрипте.
# Причина простая: скрипт живёт в репозитории и уезжает на GitHub, а секреты
# туда попадать не должны. Файл настроек добавлен в .gitignore.
#
# Заодно это избавляет от необходимости вводить длинные строки руками при
# каждом запуске.

$SettingsPath = Join-Path $PSScriptRoot 'probe-settings.local.json'

function Read-Settings {
    if (-not (Test-Path $SettingsPath)) { return @{} }
    try {
        $raw = Get-Content $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $result = @{}
        foreach ($prop in $raw.PSObject.Properties) { $result[$prop.Name] = $prop.Value }
        return $result
    } catch {
        Write-Host "  Файл настроек повреждён, игнорирую: $($_.Exception.Message)" -ForegroundColor Yellow
        return @{}
    }
}

function Save-Settings($settings) {
    $settings | ConvertTo-Json -Depth 4 | Set-Content -Path $SettingsPath -Encoding UTF8
}

$Settings = Read-Settings

# Параметр из командной строки всегда важнее сохранённого: так можно
# переопределить что угодно, ничего не редактируя.
if (-not $ProjectId    -and $Settings.projectId)    { $ProjectId    = $Settings.projectId }
if (-not $BootstrapKey -and $Settings.bootstrapKey) { $BootstrapKey = $Settings.bootstrapKey }
if (-not $DeviceToken  -and $Settings.deviceToken)  { $DeviceToken  = $Settings.deviceToken }
if (-not $ClientSecret -and $Settings.clientSecret) { $ClientSecret = $Settings.clientSecret }
if ($Settings.serverUrl -and $ServerUrl -eq 'https://www.ordaops.kz') { $ServerUrl = $Settings.serverUrl }

# Учётные данные, введённые руками, запоминаем — чтобы длинные строки
# вводить ровно один раз.
if ($DeviceToken -and $ClientSecret -and
    ($Settings.deviceToken -ne $DeviceToken -or $Settings.clientSecret -ne $ClientSecret)) {
    $Settings.deviceToken = $DeviceToken
    $Settings.clientSecret = $ClientSecret
    if ($ProjectId)    { $Settings.projectId = $ProjectId }
    if ($BootstrapKey) { $Settings.bootstrapKey = $BootstrapKey }
    Save-Settings $Settings
    Write-Host '  Учётные данные сохранены рядом со скриптом.' -ForegroundColor DarkGray
}

# Идентификатор этого запуска. По нему сервер видит, что probe перезапускался,
# и может отличить пропуск в нумерации от потери события.
$script:SourceInstanceId = [guid]::NewGuid().ToString()
$script:Seq = 0

# Запущенный от системы probe не имеет окна: писать в консоль некому.
# Поэтому всё дублируется в файл рядом со скриптом — иначе после смены
# пользователя вы бы не узнали, что вообще происходило.
$LogPath = Join-Path $PSScriptRoot 'arena-probe.log'

function Write-Log($text) {
    try {
        $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        Add-Content -Path $LogPath -Value "$stamp  $text" -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
}

function Write-Step($text) { Write-Host "  $text" -ForegroundColor DarkGray; Write-Log $text }
function Write-Ok($text)   { Write-Host "  $text" -ForegroundColor Green;    Write-Log $text }
function Write-Warn($text) { Write-Host "  $text" -ForegroundColor Yellow;   Write-Log "! $text" }
function Write-Err($text)  { Write-Host "  $text" -ForegroundColor Red;      Write-Log "ОШИБКА: $text" }

# ─────────────────────────────────────────────────────────────────────────────
# НАБЛЮДЕНИЯ
# ─────────────────────────────────────────────────────────────────────────────

<#
    Идентичность машины.

    Номер станции probe себе НЕ назначает. Он сообщает, что о себе знает, а
    привязку к станции создаёт человек при подтверждении. Имена станций в клубе
    идут диапазонами (111, 666, 801-805), и правило «имя равно номеру» дало бы
    уверенно неверную привязку на трети парка.
#>
function Get-MachineIdentity {
    $mac = $null
    try {
        $adapter = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
                   Where-Object { $_.IPEnabled -eq $true -and $_.MACAddress } |
                   Select-Object -First 1
        if ($adapter) { $mac = $adapter.MACAddress }
    } catch {
        Write-Warn "MAC получить не удалось: $($_.Exception.Message)"
    }

    # Номер рабочей станции SENET. Где он лежит — пока неизвестно; это один из
    # вопросов теста на PC21. Пробуем переменную окружения и не настаиваем.
    $wsNum = $null
    foreach ($name in @('SENET_WS_NUM', 'WS_NUM', 'WORKSTATION_NUMBER')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name) }
        if ($value -and $value -match '^\d+$') { $wsNum = [int]$value; break }
    }

    return @{
        hostname = $env:COMPUTERNAME
        mac      = $mac
        wsNum    = $wsNum
    }
}

<#
    Кто сейчас в Windows.

    Возвращает наблюдение, а не вывод: logonui / senet_user / support / unknown.
    Что из этого означает «клиент», решает сервер.

    Здесь же выясняется одна из главных вещей теста: видно ли вообще имя
    залогиненного пользователя из-под той учётной записи, где запущен probe.
#>
function Get-WindowsUserKind {
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        $user = $cs.UserName

        if (-not $user) {
            # Никого нет в интерактивной сессии. Обычно это экран входа.
            $logonui = Get-Process -Name 'LogonUI' -ErrorAction SilentlyContinue
            if ($logonui) { return 'logonui' }
            return 'logonui'
        }

        $short = ($user -split '\\')[-1]

        if ($short -match $SenetUserPattern)   { return 'senet_user' }
        if ($short -match $SupportUserPattern) { return 'support' }

        return 'unknown'
    } catch {
        Write-Warn "Пользователя определить не удалось: $($_.Exception.Message)"
        return 'unknown'
    }
}

<#
    Что запущено.

    Отдаём СПИСОК имён процессов, без всякого отбора «что тут игра». Отбор
    делает сервер. Если бы отбирал probe, правило пришлось бы менять
    пересборкой образа.

    Ограничение по количеству — защита от переполнения запроса, а не
    классификация.
#>
function Get-RunningProcesses {
    try {
        return @(
            Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -or $_.MainWindowHandle -ne 0 } |
            Select-Object -ExpandProperty ProcessName -Unique |
            ForEach-Object { "$_.exe" } |
            Select-Object -First 60
        )
    } catch {
        return @()
    }
}

function Get-BootTime {
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        return $os.LastBootUpTime.ToUniversalTime().ToString('o')
    } catch {
        return $null
    }
}

function Get-NowIso { return (Get-Date).ToUniversalTime().ToString('o') }

# ─────────────────────────────────────────────────────────────────────────────
# ОБМЕН С СЕРВЕРОМ
# ─────────────────────────────────────────────────────────────────────────────

function Invoke-Orda {
    param([string]$Path, [hashtable]$Body, [switch]$WithAuth)

    $headers = @{ 'Content-Type' = 'application/json' }
    if ($WithAuth) {
        $headers['x-arena-agent-device-token'] = $DeviceToken
        $headers['x-arena-agent-secret'] = $ClientSecret
    }

    $json = $Body | ConvertTo-Json -Depth 8 -Compress

    try {
        return Invoke-RestMethod -Uri "$ServerUrl$Path" -Method Post -Headers $headers -Body $json -TimeoutSec 20
    } catch {
        $response = $_.Exception.Response
        if ($response) {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $text = $reader.ReadToEnd()
            throw "HTTP $($response.StatusCode.value__): $text"
        }
        throw
    }
}

function Send-Heartbeat {
    $script:Seq++
    $body = @{
        observedAt       = Get-NowIso
        windowsUserKind  = Get-WindowsUserKind
        processes        = Get-RunningProcesses
        bootAt           = Get-BootTime
        agentVersion     = $AgentVersion
        sourceInstanceId = $script:SourceInstanceId
        sourceSeq        = $script:Seq
    }
    return Invoke-Orda -Path '/api/arena-agent/heartbeat' -Body $body -WithAuth
}

function Send-Events {
    param([array]$Events)
    $body = @{
        sourceInstanceId = $script:SourceInstanceId
        events           = $Events
    }
    return Invoke-Orda -Path '/api/arena-agent/events' -Body $body -WithAuth
}

function New-Event {
    param([string]$Type, [string]$OccurredAt = $null, [hashtable]$Extra = @{})
    $script:Seq++
    $event = @{
        eventId    = [guid]::NewGuid().ToString()
        type       = $Type
        occurredAt = if ($OccurredAt) { $OccurredAt } else { Get-NowIso }
        sourceSeq  = $script:Seq
    }
    foreach ($key in $Extra.Keys) { $event[$key] = $Extra[$key] }
    return $event
}

# ─────────────────────────────────────────────────────────────────────────────
# РЕЖИМЫ
# ─────────────────────────────────────────────────────────────────────────────

function Invoke-Register {
    if (-not $ProjectId)    { throw 'Нужен -ProjectId' }
    if (-not $BootstrapKey) { throw 'Нужен -BootstrapKey' }

    $identity = Get-MachineIdentity

    Write-Host ''
    Write-Host 'Что probe узнал о машине:' -ForegroundColor Cyan
    Write-Step "имя компьютера: $($identity.hostname)"
    Write-Step "MAC: $(if ($identity.mac) { $identity.mac } else { 'не получен' })"
    Write-Step "номер SENET: $(if ($identity.wsNum) { $identity.wsNum } else { 'не получен' })"
    Write-Step "загружен: $(Get-BootTime)"
    Write-Step "пользователь: $(Get-WindowsUserKind)"
    Write-Host ''

    $body = @{
        bootstrapKey     = $BootstrapKey
        projectId        = $ProjectId
        deviceInstanceId = "$($identity.hostname)|$($identity.mac)"
        hostname         = $identity.hostname
        mac              = $identity.mac
        senetWsNum       = $identity.wsNum
        agentVersion     = $AgentVersion
    }

    $result = Invoke-Orda -Path '/api/arena-agent/register' -Body $body

    Write-Ok "Заявка принята. Устройство: $($result.deviceId)"
    Write-Ok "Статус: $($result.status)"

    # Учётные данные прошлой машины стираем. Иначе, скопировав папку на другой
    # компьютер, вы бы наблюдали за станцией под чужой личностью: заявка новая,
    # а токен старый, и данные ушли бы не на ту станцию.
    if ($Settings.deviceToken -or $Settings.clientSecret) {
        $Settings.Remove('deviceToken') | Out-Null
        $Settings.Remove('clientSecret') | Out-Null
        $Settings.projectId = $ProjectId
        $Settings.bootstrapKey = $BootstrapKey
        Save-Settings $Settings
        Write-Step 'Учётные данные прошлого устройства стёрты.'
    }
    Write-Host ''
    Write-Warn 'Дальше: откройте Orda, вкладка «Мониторинг», подтвердите заявку.'
    Write-Warn 'После подтверждения скопируйте токен и секрет — они показываются один раз.'
    Write-Host ''
    Write-Host 'Затем запустите:' -ForegroundColor Cyan
    Write-Host "  .\arena-probe.ps1 -DeviceToken <токен> -ClientSecret <секрет>" -ForegroundColor White
}

<#
    Проверка транспорта.

    Здесь проверяется не Windows, а контракт: переживает ли сервер повторную
    доставку, обратный порядок и сбитые часы. Эти проверки не требуют игрового
    компьютера и делаются откуда угодно.
#>
function Invoke-SelfTest {
    Write-Host ''
    Write-Host 'ПРОВЕРКА ТРАНСПОРТА' -ForegroundColor Cyan
    Write-Host ''

    Write-Host '1. Обычное подтверждение' -ForegroundColor White
    $hb = Send-Heartbeat
    Write-Ok "принято, время сервера $($hb.serverTime), расхождение часов $($hb.clockSkewSeconds) сек"

    Write-Host ''
    Write-Host '2. Повторная доставка одного события' -ForegroundColor White
    $duplicate = New-Event -Type 'agent_started'
    $first = Send-Events -Events @($duplicate)
    $second = Send-Events -Events @($duplicate)
    Write-Ok "первая отправка: принято $($first.accepted)"
    if ($second.accepted -eq 0) {
        Write-Ok "повтор: принято 0, распознан как дубль — верно"
    } else {
        Write-Err "повтор: принято $($second.accepted) — ДУБЛЬ ПРОСОЧИЛСЯ"
    }

    Write-Host ''
    Write-Host '3. Обратный порядок: выход приходит после входа' -ForegroundColor White
    $now = Get-Date
    $login = New-Event -Type 'windows_session_changed' `
        -OccurredAt $now.ToUniversalTime().ToString('o') `
        -Extra @{ windowsUserKind = 'senet_user' }
    $logout = New-Event -Type 'windows_session_changed' `
        -OccurredAt $now.AddMinutes(-5).ToUniversalTime().ToString('o') `
        -Extra @{ windowsUserKind = 'logonui' }

    Send-Events -Events @($login) | Out-Null
    Write-Step 'отправлен вход (сейчас)'
    Send-Events -Events @($logout) | Out-Null
    Write-Step 'отправлен выход (пять минут назад)'
    Write-Warn 'Проверьте на экране: станция должна остаться ЗАНЯТОЙ, а не свободной.'

    Write-Host ''
    Write-Host '4. Событие из будущего' -ForegroundColor White
    $future = New-Event -Type 'agent_started' -OccurredAt (Get-Date).AddMinutes(10).ToUniversalTime().ToString('o')
    $result = Send-Events -Events @($future)
    if ($result.rejected -and $result.rejected.Count -gt 0) {
        Write-Ok "отклонено: $($result.rejected[0].reason), расхождение $($result.rejected[0].skewSeconds) сек"
    } else {
        Write-Err 'событие из будущего НЕ отклонено — снимок может замереть'
    }

    Write-Host ''
    Write-Host '5. Попытка прислать секрет в нагрузке' -ForegroundColor White
    $secret = New-Event -Type 'agent_started' -Extra @{ payload = @{ password = 'должно быть вырезано'; note = 'ок' } }
    $result = Send-Events -Events @($secret)
    if ($result.strippedFields) {
        Write-Ok "вырезано: $($result.strippedFields -join ', ')"
    } else {
        Write-Err 'секрет НЕ вырезан — он попал бы в журнал навсегда'
    }

    Write-Host ''
    Write-Warn 'Теперь остановите probe и подождите 90 секунд.'
    Write-Warn 'Станция должна стать OFFLINE сама, без вашего участия.'
    Write-Host ''
}

function Invoke-Loop {
    Write-Host ''
    Write-Host "Наблюдение запущено. Подтверждение раз в $IntervalSec сек." -ForegroundColor Cyan
    Write-Host 'Остановить: Ctrl+C' -ForegroundColor DarkGray
    Write-Host ''

    Send-Events -Events @(New-Event -Type 'agent_started') | Out-Null

    while ($true) {
        try {
            $userKind = Get-WindowsUserKind
            $result = Send-Heartbeat
            $stamp = (Get-Date).ToString('HH:mm:ss')
            Write-Host "  $stamp  пользователь: $userKind  расхождение часов: $($result.clockSkewSeconds) сек" -ForegroundColor DarkGray
            Write-Log "пользователь: $userKind, расхождение часов: $($result.clockSkewSeconds) сек" 
            if ($result.warning) { Write-Warn "предупреждение сервера: $($result.warning)" }
        } catch {
            Write-Err "$((Get-Date).ToString('HH:mm:ss'))  $($_.Exception.Message)"
        }

        if ($Once) { break }
        Start-Sleep -Seconds $IntervalSec
    }
}

# ─────────────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '  ORDA ARENA PROBE' -ForegroundColor Cyan
Write-Host '  Временный наблюдатель для проверки контракта' -ForegroundColor DarkGray
Write-Host ''

try {
    if ($Register) {
        Invoke-Register
    } else {
        # Учётных данных нет — спрашиваем один раз и запоминаем. Вводить
        # шестидесятисимвольную строку при каждом запуске никто не станет.
        if (-not $DeviceToken -or -not $ClientSecret) {
            Write-Host '  Устройство ещё не настроено.' -ForegroundColor Yellow
            Write-Host '  Возьмите токен и секрет из Orda — вкладка «Мониторинг», после подтверждения заявки.' -ForegroundColor DarkGray
            Write-Host ''
            if (-not $DeviceToken)  { $DeviceToken  = (Read-Host '  Токен устройства').Trim() }
            if (-not $ClientSecret) { $ClientSecret = (Read-Host '  Секрет устройства').Trim() }

            if (-not $DeviceToken -or -not $ClientSecret) {
                Write-Err 'Без токена и секрета наблюдать нечем.'
                exit 1
            }

            $Settings.deviceToken = $DeviceToken
            $Settings.clientSecret = $ClientSecret
            Save-Settings $Settings
            Write-Ok 'Сохранено — в следующий раз спрашивать не буду.'
            Write-Host ''
        }

        if ($SelfTest) {
            Invoke-SelfTest
        } else {
            Invoke-Loop
        }
    }
} catch {
    Write-Host ''
    Write-Err $_.Exception.Message
    exit 1
}
