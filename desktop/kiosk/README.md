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

## Provisioning flow

1. В админке станции сгенерируйте `provisioning key`.
2. В `npm run setup` укажите:
   - код станции (`station_code` или имя станции),
   - URL сайта (например `https://example.com`),
   - provisioning key.
3. Клиент вызовет `POST /api/kiosk/register`, получит `clientSecret` и сохранит локально.
4. После этого heartbeat идёт в `POST /api/kiosk/heartbeat` по паре `clientSecret + deviceToken`.

## Переменные (опционально)

- `KIOSK_SERVER_BASE_URL` — базовый URL сайта
- `KIOSK_WS_URL` — URL websocket сервера команд (если используется)
- `STATION_CODE` — override station code
- `KIOSK_CLIENT_SECRET` — override client secret

Конфиг сохраняется в `%APPDATA%/orda-kiosk/config.json`.
