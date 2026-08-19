@echo off
chcp 65001 >nul
title Orda Arena Probe - запуск от системы

rem Обычный процесс умирает вместе с сессией пользователя — это выяснилось на
rem станции 21: probe пропал при выходе из Support. Запуск от системы решает
rem задачу: задание живёт отдельно от того, кто залогинен.
rem
rem Окна у такого запуска нет. Всё, что происходит, пишется в arena-probe.log
rem рядом со скриптом.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   Нужны права администратора.
    echo   Щёлкните правой кнопкой - "Запуск от имени администратора".
    echo.
    pause
    exit /b 1
)

set TASK=OrdaArenaProbe

echo.
echo   Создаю задание от имени SYSTEM...
schtasks /create /tn "%TASK%" /f /ru SYSTEM /rl HIGHEST /sc onstart ^
  /tr "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0arena-probe.ps1\"" >nul

if %errorLevel% neq 0 (
    echo   Не удалось создать задание.
    pause
    exit /b 1
)

echo   Запускаю...
schtasks /run /tn "%TASK%" >nul

echo.
echo   Готово. Наблюдение работает от имени системы и переживёт смену
echo   пользователя.
echo.
echo   Что происходит - смотрите в файле:
echo   %~dp0arena-probe.log
echo.
echo   Остановить: "5 Остановить наблюдение.bat"
echo.
pause
