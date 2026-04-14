# Orda Kiosk Client (MVP)

Минимальный kiosk-клиент Electron для клиентского ПК в компьютерном клубе.

## Что уже есть

- kiosk fullscreen окно, всегда поверх
- отключенные devtools и меню
- перехват `Alt+F4`, `Alt+Tab`, `Ctrl+W`
- автозапуск Windows (`openAtLogin`)
- WebSocket-клиент с reconnect
- команды: `start_session`, `extend_session`, `end_session`, `launch_game`, `shutdown_pc`, `reboot_pc`
- обработка `binding_ok` / `binding_mismatch` (блокирует UI при несоответствии привязки)
- обработка `station_profile` с каталогом игр и путями запуска
- таймер сессии и 3 экрана: idle / active / ended
- экран блокировки привязки станции (blocked)
- запуск/остановка игры через `child_process` + `taskkill`
- логирование в `%APPDATA%/.../kiosk.log`

## Запуск

```bash
cd desktop/client
npm install
npm start
```

## ENV (опционально)

- `KIOSK_WS_URL` - URL websocket сервера (по умолчанию `ws://127.0.0.1:8787/ws/client`)
- `STATION_CODE` - код станции (по умолчанию `VIP-111`)
- `CLUB_NAME` - название клуба
- `DEFAULT_GAME_PATH` - путь к игре (по умолчанию `D:\Games\CS2\cs2.exe`)
- `KIOSK_HEARTBEAT_URL` - URL HTTP heartbeat (по умолчанию `http://127.0.0.1:3000/api/kiosk/heartbeat`)
- `KIOSK_HEARTBEAT_SECRET` - секрет для heartbeat (обязателен для записи онлайн-статуса в БД)

## Формат команд WebSocket

```json
{ "type": "start_session", "durationSec": 3600, "tariffName": "Standart 60" }
{ "type": "station_profile", "games": [{ "id": "game-cs2", "title": "CS2", "logoUrl": "https://...", "exePath": "D:\\Games\\CS2\\cs2.exe" }] }
{ "type": "extend_session", "addSec": 1800 }
{ "type": "launch_game", "gameId": "game-cs2" }
{ "type": "end_session" }
{ "type": "binding_ok" }
{ "type": "binding_mismatch", "reason": "MAC не совпал с настройкой станции" }
{ "type": "shutdown_pc" }
{ "type": "reboot_pc" }
```

Статус клиента на сервер отправляется с полями `device_ip` и `device_mac` в каждом сообщении `type: "status"`.
