@echo off
chcp 65001 >nul
title Orda Arena Probe - наблюдение
cd /d "%~dp0"
echo   Наблюдение запущено. Остановить: Ctrl+C
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arena-probe.ps1"
pause
