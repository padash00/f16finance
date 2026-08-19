@echo off
chcp 65001 >nul
title Orda Arena Probe - остановка

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo   Нужны права администратора.
    pause
    exit /b 1
)

set TASK=OrdaArenaProbe

schtasks /end /tn "%TASK%" >nul 2>&1
schtasks /delete /tn "%TASK%" /f >nul 2>&1
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq *arena-probe*" >nul 2>&1

echo.
echo   Наблюдение остановлено, задание удалено.
echo   Станция уйдёт в "не отвечает" через полторы минуты.
echo.
pause
