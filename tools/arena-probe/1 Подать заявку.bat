@echo off
chcp 65001 >nul
title Orda Arena Probe - заявка
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arena-probe.ps1" -Register
echo.
echo   Дальше: откройте Orda, вкладка "Мониторинг", подтвердите заявку.
echo.
pause
