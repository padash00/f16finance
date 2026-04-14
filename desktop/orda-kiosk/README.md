# Orda Kiosk (отдельный Electron)

Отдельное приложение от `desktop/client`: первый запуск через настройку, затем kiosk-режим.

## Запуск

```bash
cd desktop/orda-kiosk
npm install
npm run setup
```

После сохранения настроек:

```bash
npm start
```

## Переменные (или через UI setup)

- `KIOSK_HEARTBEAT_URL` — по умолчанию `http://127.0.0.1:3000/api/kiosk/heartbeat`
- `KIOSK_HEARTBEAT_SECRET` — обязателен для записи онлайна в БД
- `STATION_CODE` — должен совпадать с **именем станции** в админке
- `KIOSK_WS_URL` — опционально, если есть WS-сервер команд

Конфиг сохраняется в `%APPDATA%/orda-kiosk/config.json`.
