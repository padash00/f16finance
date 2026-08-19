@echo off
chcp 65001 >nul
title Orda Arena Probe - проверка транспорта
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arena-probe.ps1" -SelfTest
echo.
pause
