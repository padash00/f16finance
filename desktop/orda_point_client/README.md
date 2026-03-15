# Orda Control Point Client

Первый универсальный desktop-клиент для точек.

Что уже умеет:

- подключаться к `Orda Control` по `API URL + device token`
- после подключения точки запрашивать вход оператора по тем же данным, что и на сайте
- после входа показывать калькулятор смены уже от имени конкретного оператора
- загружать точку и список операторов через `/api/point/bootstrap`
- проверять вход оператора через `/api/point/login`
- отправлять сменный отчёт через `/api/point/shift-report`
- сохранять отчёты в локальную offline-очередь при ошибке сети
- повторно отправлять накопленную очередь

Что это заменяет:

- прямой доступ из точек в Supabase REST
- жёстко зашитые `company_code`, `Supabase key` и `Telegram token` в программе

Что дальше:

1. добавить отправку долгов через отдельный point API
2. перенести scanner/debts flow из Ramen
3. включать/выключать модули по `feature_flags`
4. собрать `.exe` из одного клиента для всех точек

Запуск:

```bash
python main.py
```

Ожидается, что на сайте уже выполнена миграция:

- `supabase/migrations/20260315_point_devices_and_bootstrap.sql`

И в таблице `point_devices` создано устройство с:

- `company_id`
- `name`
- `device_token`
- `point_mode`
- `feature_flags`
