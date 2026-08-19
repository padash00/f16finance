@echo off
chcp 65001 >nul
title Orda Arena Probe - проверка транспорта
cd /d "%~dp0"

rem Токен и секрет вводятся один раз: скрипт сохранит их рядом с собой
rem и в следующий раз не спросит.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = Join-Path '%~dp0' 'probe-settings.local.json';" ^
  "$c = if (Test-Path $s) { Get-Content $s -Raw | ConvertFrom-Json } else { $null };" ^
  "if (-not $c.deviceToken) { $t = Read-Host 'Токен устройства'; $sec = Read-Host 'Секрет устройства'; & '%~dp0arena-probe.ps1' -DeviceToken $t -ClientSecret $sec -SelfTest }" ^
  "else { & '%~dp0arena-probe.ps1' -SelfTest }"
echo.
pause
