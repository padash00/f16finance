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
    [switch]$Discover,

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
    $stateMac = $null
    try {
        $adapter = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
                   Where-Object { $_.IPEnabled -eq $true -and $_.MACAddress } |
                   Select-Object -First 1
        if ($adapter) { $mac = $adapter.MACAddress }
    } catch {
        Write-Warn "MAC получить не удалось: $($_.Exception.Message)"
    }

    # Номер рабочей станции SENET.
    #
    # Найден разведкой на станции 21: SENET (вендор Enestech) держит его в
    # State.json своей рабочей службы, рядом с MAC. Это официальное место, а не
    # догадка, — поэтому читаем прямо оттуда.
    $wsNum = $null
    $statePath = "$env:ProgramData\Enestech\Service\State.json"
    if (Test-Path $statePath) {
        try {
            $state = Get-Content $statePath -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($state.ws_num -ne $null -and "$($state.ws_num)" -match '^\d+$') {
                $wsNum = [int]$state.ws_num
            }
            # MAC из этого файла НЕ берём.
            #
            # На бездисковых клиентах State.json, судя по всему, вшит в
            # мастер-образ: на разных машинах он показывает один и тот же
            # адрес и один и тот же номер 1. Настоящий адрес сетевой карты
            # машины отличается — именно он и нужен для опознания.
            #
            # Номер ws_num отсюда шлём как наблюдение, но не как истину: пока
            # не подтверждено, что он у машин разный.
            if ($state.mac) { $stateMac = "$($state.mac)" }
        } catch {
            Write-Warn "State.json не прочитался: $($_.Exception.Message)"
        }
    }

    # Запасной путь на случай другой версии SENET.
    if (-not $wsNum) {
        foreach ($name in @('SENET_WS_NUM', 'WS_NUM', 'WORKSTATION_NUMBER')) {
            $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
            if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name) }
            if ($value -and $value -match '^\d+$') { $wsNum = [int]$value; break }
        }
    }

    return @{
        hostname = $env:COMPUTERNAME
        mac      = $mac
        wsNum    = $wsNum
        stateMac = $stateMac
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
        # Отдаём не только имя, но и вес с признаком окна. Без них сервер не
        # может отличить игру от служебной программы: на станции 21 при
        # запущенной CS2 первым по алфавиту оказался AppNotify.exe.
        #
        # Решение по-прежнему принимает сервер — probe просто перестаёт
        # скрывать от него половину картины.
        $list = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Path } |
            Sort-Object WorkingSet64 -Descending |
            Select-Object -First 40

        return @($list | ForEach-Object {
            [pscustomobject]@{
                name      = "$($_.ProcessName).exe"
                memoryMb  = [int]($_.WorkingSet64 / 1MB)
                hasWindow = ($_.MainWindowHandle -ne 0)
            }
        })
    } catch {
        return @()
    }
}

<#
    Кто вошёл в SENET и по какому счёту.

    Читается из журнала службы SENET. Найдено разведкой на боевых станциях:
    при входе клиента туда пишется строка вида

        Authorize username: olzhas, password=... type: 4

    а следом результат «auth result status: 0» — ноль означает успех.

    ПАРОЛЬ НЕ ЧИТАЕТСЯ И НИКУДА НЕ ИДЁТ. Из строки берутся только имя и тип
    счёта; всё остальное отбрасывается прямо здесь, а не «на сервере разберём».

    Журнал — источник временный. У службы SENET есть локальный интерфейс на
    порту 20001, читать оттуда было бы надёжнее: формат журнала может смениться
    с любым обновлением. Но интерфейс требует отдельного разбора, а журнал
    работает сейчас.
#>
function Get-SenetSession {
    $logPath = "$env:ProgramData\Enestech\Logs\senet-credential.log"
    if (-not (Test-Path $logPath)) { return $null }

    try {
        # Хвоста хватает: нас интересует последний вход, а не вся история.
        $tail = Get-Content $logPath -Tail 400 -ErrorAction Stop

        $login = $null
        $accountType = $null

        for ($i = $tail.Count - 1; $i -ge 0; $i--) {
            $m = [regex]::Match($tail[$i], 'Authorize username:\s*([^,]+),.*?type:\s*(-?\d+)')
            if ($m.Success) {
                $login = $m.Groups[1].Value.Trim()
                $accountType = [int]$m.Groups[2].Value
                break
            }
        }

        if (-not $login) { return $null }

        return @{ login = $login; accountType = $accountType }
    } catch {
        return $null
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

    # Данные сессии SENET шлём только когда за компьютером клиент. Под
    # технической учётной записью последний вход в журнале относится к
    # предыдущему человеку, и показывать его было бы прямым враньём.
    if ($body.windowsUserKind -eq 'senet_user') {
        $senet = Get-SenetSession
        if ($senet) {
            $body.senetLogin = $senet.login
            $body.senetAccountType = $senet.accountType
        }
    }

    $identity = Get-MachineIdentity
    if ($identity.wsNum) { $body.senetWsNum = $identity.wsNum }
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
# ПОИСК ДАННЫХ SENET
# ─────────────────────────────────────────────────────────────────────────────
# Ничего никуда не отправляет. Только смотрит, где на машине лежат файлы SENET
# и в каком из них встречается имя вошедшего пользователя.
#
# Нужно, потому что в задании были перечислены поля (user_session_id,
# account_type, seconds_left), но не пути к ним. Угадывать пути — верный способ
# построить разбор под файл, которого нет.
#
# Содержимое файлов НЕ печатается и никуда не уходит: там могут быть токены.
# Печатаются только имена файлов, размеры и факт совпадения.

function Invoke-Discover {
    Write-Host ''
    Write-Host 'ПОИСК ДАННЫХ SENET' -ForegroundColor Cyan
    Write-Host '  Ничего не отправляется. Только смотрим, что где лежит.' -ForegroundColor DarkGray
    Write-Host ''

    $user = $null
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        if ($cs.UserName) { $user = ($cs.UserName -split '\')[-1] }
    } catch { }

    Write-Host "1. Кто сейчас в системе: $(if ($user) { $user } else { 'никого' })" -ForegroundColor White
    Write-Host ''

    Write-Host '2. Процессы SENET и клубной обвязки' -ForegroundColor White
    # Шаблон узкий намеренно: слово «shell» ловит системные ShellHost и
    # ShellExperienceHost, и поиск уходит в System32, где искать нечего.
    # Заодно отбрасываем всё, что лежит внутри каталога Windows.
    $senetProcs = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and
            $_.Path -notlike "$env:SystemRoot*" -and
            ($_.ProcessName -match 'senet|clubnet|ccboot|appnotify|gcafe' -or
             $_.ProcessName -match '^(dashboard|serviceapp|shell)$')
        }
    if ($senetProcs) {
        foreach ($proc in $senetProcs) {
            Write-Step "$($proc.ProcessName).exe  ->  $($proc.Path)"
        }
    } else {
        Write-Warn 'не найдено — возможно, запущены под другим пользователем'
    }
    Write-Host ''

    Write-Host '3. Каталоги, где может лежать SENET' -ForegroundColor White
    $roots = @()
    foreach ($proc in $senetProcs) {
        $dir = Split-Path $proc.Path -Parent
        if ($dir -and $dir -notlike "$env:SystemRoot*" -and $roots -notcontains $dir) { $roots += $dir }
    }
    foreach ($guess in @(
        "$env:ProgramFiles\SENET", "${env:ProgramFiles(x86)}\SENET",
        "$env:ProgramData\SENET", "$env:LOCALAPPDATA\SENET",
        "$env:ProgramData\Senet", "C:\SENET", "C:\Senet", "C:\Games\SENET"
    )) {
        if ((Test-Path $guess) -and $roots -notcontains $guess) { $roots += $guess }
    }

    if (-not $roots) {
        Write-Warn 'каталоги не найдены'
        Write-Host ''
        return
    }

    foreach ($root in $roots) { Write-Step $root }
    Write-Host ''

    Write-Host '4. Файлы настроек и журналов в этих каталогах' -ForegroundColor White
    $files = @()
    foreach ($root in $roots) {
        try {
            $files += Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Extension -match '^\.(json|xml|ini|cfg|conf|log|txt|dat)$' -and $_.Length -lt 5MB } |
                Select-Object -First 60
        } catch { }
    }

    if (-not $files) {
        Write-Warn 'подходящих файлов не найдено'
        Write-Host ''
        return
    }

    foreach ($file in ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 25)) {
        Write-Step "$($file.FullName)  ($([int]($file.Length / 1KB)) КБ, изменён $($file.LastWriteTime.ToString('HH:mm:ss')))"
    }
    Write-Host ''

    if (-not $user) {
        Write-Warn 'Пользователь не определён — искать его имя в файлах не по чему.'
        Write-Host ''
        return
    }

    Write-Host "5. В каких файлах встречается имя '$user'" -ForegroundColor White
    Write-Host '   (показываются только имена файлов, содержимое не печатается)' -ForegroundColor DarkGray
    $found = $false
    foreach ($file in $files) {
        try {
            if (Select-String -Path $file.FullName -Pattern ([regex]::Escape($user)) -SimpleMatch -Quiet -ErrorAction SilentlyContinue) {
                Write-Ok $file.FullName
                $found = $true
            }
        } catch { }
    }
    if (-not $found) { Write-Warn 'имя пользователя в файлах не встречается' }

    Write-Host ''
    Write-Warn 'Пришлите этот вывод — по нему будет видно, откуда читать данные сессии.'
    Write-Host ''
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
    if ($identity.stateMac -and $identity.stateMac -ne $identity.mac) {
        Write-Warn "MAC в State.json ($($identity.stateMac)) не совпадает с адресом сетевой карты"
        Write-Warn "Похоже, файл вшит в образ — опознавать станцию по нему нельзя"
    }
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
    if ($Discover) {
        Invoke-Discover
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
