# Orda Control Point Client

Первый универсальный desktop-клиент для точек.

Что уже умеет:

- подключаться к `Orda Control` по `API URL + device token`
- после подключения точки запрашивать вход оператора по тем же данным, что и на сайте
- после входа открывать единый рабочий shell точки
- показывать калькулятор смены для `Arena`-сценария
- показывать долговой модуль для `Ramen`-сценария, если устройству включён `debt_report`
- загружать точку и список операторов через `/api/point/bootstrap`
- проверять вход оператора через `/api/point/login`
- отправлять сменный отчёт через `/api/point/shift-report`
- загружать и отправлять долги через `/api/point/debts`
- сохранять отчёты в локальную offline-очередь при ошибке сети
- сохранять долговые действия в отдельную offline-очередь
- повторно отправлять накопленную очередь

Что это заменяет:

- прямой доступ из точек в Supabase REST
- жёстко зашитые `company_code`, `Supabase key` и `Telegram token` в программе

Что дальше:

1. добить полный scanner/product flow из старого `Ramen`
2. перенести оставшиеся точечные сценарии в feature-driven модули
3. включать/выключать модули по `feature_flags`
4. собрать `.exe` из одного клиента для всех точек

Запуск:

```bash
python main.py
```

Ожидается, что на сайте уже выполнена миграция:

- `supabase/migrations/20260315_point_devices_and_bootstrap.sql`
- `supabase/migrations/20260315_point_debt_items.sql`

И в таблице `point_devices` создано устройство с:

- `company_id`
- `name`
- `device_token`
- `point_mode`
- `feature_flags`
