@echo off
chcp 65001 >nul
title Orda - разведка SENET
cd /d "%~dp0"

rem Ничего не отправляет. Смотрит, где лежат файлы SENET, и пишет отчёт в
rem senet-scan-report.txt рядом с собой.
rem
rem Запускать ПОД КЛИЕНТСКОЙ учёткой SENET (не под Support): иначе файлов
rem клиентской сессии не будет видно. Права администратора помогают увидеть
rem службы, но не обязательны.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0senet-scan.ps1"
echo.
echo   Отчёт: %~dp0senet-scan-report.txt
echo.
pause
