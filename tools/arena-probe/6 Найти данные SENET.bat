@echo off
chcp 65001 >nul
title Orda Arena Probe - поиск данных SENET
cd /d "%~dp0"

rem Ничего не отправляет на сервер. Только смотрит, где на машине лежат файлы
rem SENET и в каком из них встречается имя вошедшего пользователя.
rem
rem Запускать НЕ под Support, а под клиентской учётной записью — иначе файлов
rem клиентской сессии просто не будет видно.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arena-probe.ps1" -Discover
echo.
pause
