@echo off
chcp 65001 >nul
title Orda Arena Probe

rem Запуск probe от администратора.
rem
rem Нужен именно администратор: под обычной учётной записью Windows не отдаёт
rem владельцев чужих процессов, и наблюдение окажется неполным. Насколько
rem неполным — один из вопросов проверки на PC21.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   Нужны права администратора.
    echo   Щёлкните по этому файлу правой кнопкой и выберите
    echo   "Запуск от имени администратора".
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arena-probe.ps1" %*
pause
