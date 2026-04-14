#Requires -RunAsAdministrator
<#
  Orda Kiosk — Setup Windows Script
  Запускать от имени администратора на каждом ПК перед первым запуском киоска.

  Что делает:
    1. Создаёт учётную запись OrdaKiosk (обычный пользователь, без прав админа)
    2. Настраивает автоматический вход под этой учёткой при загрузке ПК
    3. Блокирует Диспетчер задач, Win-клавишу, кнопку выключения для этого пользователя
    4. Регистрирует кiosk как автозапуск при входе OrdaKiosk
    5. (Опционально) Настраивает Windows Assigned Access — только одно приложение

  Использование:
    Правой кнопкой на файле → "Запуск от имени администратора"
    Или из PowerShell: .\setup-windows.ps1
#>

# ─── КОНФИГУРАЦИЯ (измените под себя) ─────────────────────────────────────────

$KioskUsername = "OrdaKiosk"
$KioskPassword = "OrdaKi0sk#2026"          # Измените на свой пароль
$KioskAppPath  = "$env:ProgramFiles\Orda Kiosk\orda-kiosk.exe"   # Путь после установки

# Установить в $true для Windows Assigned Access (только это приложение, ничего больше)
# Требует Windows 10/11 Pro или Enterprise
$UseAssignedAccess = $false

# ──────────────────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

# ─── 1. Создать учётную запись ────────────────────────────────────────────────

Write-Step "Создание учётной записи $KioskUsername..."

$securePass = ConvertTo-SecureString $KioskPassword -AsPlainText -Force

$existingUser = Get-LocalUser -Name $KioskUsername -ErrorAction SilentlyContinue
if ($existingUser) {
    Set-LocalUser -Name $KioskUsername -Password $securePass -PasswordNeverExpires $true
    Write-OK "Учётная запись уже существует — пароль обновлён"
} else {
    New-LocalUser -Name $KioskUsername `
        -Password $securePass `
        -FullName "Orda Kiosk" `
        -Description "Ограниченная учётная запись для киоска" `
        -PasswordNeverExpires:$true `
        -UserMayNotChangePassword:$true
    Write-OK "Учётная запись создана"
}

# Убедиться что НЕ в группе Администраторы
try {
    Remove-LocalGroupMember -Group "Administrators" -Member $KioskUsername -ErrorAction SilentlyContinue
    Write-OK "Убран из группы Администраторы"
} catch {}

# Добавить в группу Пользователи если ещё нет
try {
    Add-LocalGroupMember -Group "Users" -Member $KioskUsername -ErrorAction SilentlyContinue
} catch {}

# ─── 2. Автологин ─────────────────────────────────────────────────────────────

Write-Step "Настройка автоматического входа..."

$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon"   -Value "1"
Set-ItemProperty -Path $winlogon -Name "DefaultUserName"  -Value $KioskUsername
Set-ItemProperty -Path $winlogon -Name "DefaultPassword"  -Value $KioskPassword
Set-ItemProperty -Path $winlogon -Name "DefaultDomainName"-Value $env:COMPUTERNAME
# Убрать экран блокировки
Set-ItemProperty -Path $winlogon -Name "ForceAutoLogon"   -Value "1" -ErrorAction SilentlyContinue

Write-OK "Автологин настроен под $KioskUsername"

# ─── 3. Блокировки через реестр ───────────────────────────────────────────────

Write-Step "Настройка ограничений безопасности..."

# Загрузить куст реестра пользователя OrdaKiosk (применяется к его HKCU)
$userSid = (Get-LocalUser -Name $KioskUsername).SID.Value
$hkuPath = "HKU:\$userSid"
$ntUserDat = "C:\Users\$KioskUsername\NTUSER.DAT"

# Нужно войти как OrdaKiosk хотя бы раз, чтобы создался профиль.
# Если профиль ещё не создан — применяем через reg.exe после первого входа
# через запланированное задание.

$policyScript = @"
# Disable Task Manager
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f

# Disable Win key
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f

# Disable context menu on taskbar
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoTrayContextMenu /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoViewContextMenu /t REG_DWORD /d 1 /f

# Disable shutdown/restart from Start for non-admins (HKLM — глобально)
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableShutdownButton /t REG_DWORD /d 1 /f
"@

# Сохранить скрипт применения политик
$policyScriptPath = "C:\ProgramData\OrdaKiosk\apply-policies.bat"
New-Item -ItemType Directory -Path "C:\ProgramData\OrdaKiosk" -Force | Out-Null
Set-Content -Path $policyScriptPath -Value $policyScript -Encoding ASCII

# HKLM-блокировки применяем сразу (глобально для всех пользователей)
$sysPolicy = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
if (-not (Test-Path $sysPolicy)) { New-Item -Path $sysPolicy -Force | Out-Null }
Set-ItemProperty -Path $sysPolicy -Name "DisableTaskMgr"      -Value 1 -Type DWord
Set-ItemProperty -Path $sysPolicy -Name "DisableShutdownButton"-Value 1 -Type DWord

$explorerPolicy = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"
if (-not (Test-Path $explorerPolicy)) { New-Item -Path $explorerPolicy -Force | Out-Null }
Set-ItemProperty -Path $explorerPolicy -Name "NoWinKeys" -Value 1 -Type DWord

Write-OK "Task Manager отключён (HKLM)"
Write-OK "Win-клавиша заблокирована (HKLM)"
Write-OK "Кнопка выключения скрыта (HKLM)"

# ─── 4. Автозапуск киоска ─────────────────────────────────────────────────────

Write-Step "Регистрация автозапуска киоска..."

# Через Scheduled Task — надёжнее чем реестр Run для конкретного пользователя
$taskName = "OrdaKioskStart"

# Удалить старое задание если есть
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action   = New-ScheduledTaskAction -Execute $KioskAppPath
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$KioskUsername"
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Seconds 30) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)   # Без ограничения времени

$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$KioskUsername" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-OK "Задача '$taskName' зарегистрирована"

# Watchdog: перезапускает киоск если он упал
$watchdogScript = @"
while (`$true) {
    `$proc = Get-Process -Name "orda-kiosk" -ErrorAction SilentlyContinue
    if (-not `$proc) {
        Start-Process "$KioskAppPath"
        Start-Sleep -Seconds 5
    }
    Start-Sleep -Seconds 10
}
"@
$watchdogPath = "C:\ProgramData\OrdaKiosk\watchdog.ps1"
Set-Content -Path $watchdogPath -Value $watchdogScript -Encoding UTF8

$watchdogAction   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogPath`""
$watchdogTrigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$KioskUsername"
$watchdogSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$watchdogPrincipal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$KioskUsername" -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName "OrdaKioskWatchdog" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName "OrdaKioskWatchdog" `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Settings $watchdogSettings `
    -Principal $watchdogPrincipal `
    -Force | Out-Null

Write-OK "Watchdog зарегистрирован (перезапуск при падении)"

# ─── 5. Windows Assigned Access (опционально) ─────────────────────────────────

if ($UseAssignedAccess) {
    Write-Step "Настройка Windows Assigned Access..."
    try {
        # Requires Win10/11 Pro+
        $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<AssignedAccessConfiguration xmlns="http://schemas.microsoft.com/AssignedAccess/2017/config">
  <Profiles>
    <Profile Id="{EDB3036B-780D-487D-A375-69369D8A8F78}">
      <KioskModeApp AppUserModelId="OrdaKiosk" />
    </Profile>
  </Profiles>
  <Configs>
    <Config>
      <Account>$KioskUsername</Account>
      <DefaultProfile Id="{EDB3036B-780D-487D-A375-69369D8A8F78}"/>
    </Config>
  </Configs>
</AssignedAccessConfiguration>
"@
        $xmlPath = "C:\ProgramData\OrdaKiosk\assigned-access.xml"
        Set-Content -Path $xmlPath -Value $xml -Encoding UTF8
        Set-AssignedAccess -UserName $KioskUsername -AppName "OrdaKiosk"
        Write-OK "Assigned Access настроен"
    } catch {
        Write-Warn "Assigned Access недоступен (требует Win10/11 Pro+): $_"
    }
}

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host "`n" + ("=" * 60) -ForegroundColor Green
Write-Host "  УСТАНОВКА ЗАВЕРШЕНА" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Green
Write-Host ""
Write-Host "  Пользователь : $KioskUsername"
Write-Host "  Пароль       : $KioskPassword"
Write-Host "  Автологин    : Включён"
Write-Host "  Task Manager : Отключён"
Write-Host "  Win-клавиша  : Заблокирована"
Write-Host "  Выключение   : Скрыто"
Write-Host "  Watchdog     : Активен (перезапуск каждые 10 сек)"
Write-Host ""
Write-Host "  Следующий шаг: установите Orda Kiosk в" -ForegroundColor Yellow
Write-Host "  $KioskAppPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Перезагрузите ПК — войдёт автоматически под OrdaKiosk" -ForegroundColor Cyan
Write-Host ""

$restart = Read-Host "Перезагрузить сейчас? (y/n)"
if ($restart -eq 'y') { Restart-Computer -Force }
