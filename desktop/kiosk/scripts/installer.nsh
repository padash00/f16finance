; Orda Kiosk — NSIS custom hook
; Запускается после завершения установки файлов

!macro customInstall
  ; Запустить PowerShell скрипт настройки Windows (от имени администратора)
  ; Установщик уже запрошен с requireAdministrator, так что права есть
  Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\setup-windows.ps1"'
!macroend
