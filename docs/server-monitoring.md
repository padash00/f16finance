# ORDA Control: мониторинг Windows Server 2019

## Гарантия для production-сервера

Установка, обновление, проверка и удаление агента не требуют перезагрузки Windows, logout пользователя, перезапуска сетевого адаптера или сторонних служб. Скрипты не меняют BIOS, драйверы, firewall, Windows Update, сетевую конфигурацию и production-приложения. Они работают только с каталогом `C:\ORDA-Monitor` и задачей Task Scheduler `ORDA Server Monitor`.

Агент работает в no-driver режиме и отправляет CPU, RAM, диски, сеть и heartbeat через штатные read-only API Windows. Аппаратные температуры остаются `null`, если Windows не предоставляет их без драйвера. Агент не загружает сторонние библиотеки датчиков и не устанавливает драйверы.

## A. Supabase migrations

Применить по порядку через Supabase SQL Editor:

1. `supabase/migrations/20260830112752_server_monitoring_foundation.sql`
2. `supabase/migrations/20260830114659_server_monitor_runtime_rpc.sql`

Файлы из `supabase/tests/` в production не применять. Для локальной Supabase:

```powershell
npx supabase start
npx supabase test db
```

## B. Создание сервера

Открыть `Система → Мониторинг сервера`, нажать `Сервер`, заполнить код и название. `SERVER_ID` создаётся автоматически. После создания интерфейс один раз покажет `ORDA_MONITOR_AGENT_KEY`.

## C. Agent key

Ключ генерируется backend через криптографический генератор. В Supabase хранится только SHA-256 hash секретной части. Полный ключ показывается один раз и нужен для установки агента. Новый ключ создаётся в настройках сервера кнопкой `Новый ключ`; предыдущий отзывается.

## D. Telegram Bot

1. Создать отдельного бота через `@BotFather`.
2. Создать отдельный private channel для мониторинга.
3. Добавить бота администратором канала с правом публикации сообщений.
4. Добавить Vercel environment variables:

```text
TELEGRAM_MONITOR_BOT_TOKEN=...
TELEGRAM_MONITOR_CHAT_ID=...
CRON_SECRET=...
```

Не использовать `NEXT_PUBLIC_` для этих переменных.

## E. Telegram channel ID

Опубликовать тестовое сообщение в канале, затем вызвать `getUpdates` у нового бота или переслать сообщение боту `@RawDataBot`. Для private channel ID обычно имеет формат `-100...`. После настройки нажать `Тест Telegram` на странице мониторинга.

## F. Vercel

Обязательные server-side ENV:

```text
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_MONITOR_BOT_TOKEN=...
TELEGRAM_MONITOR_CHAT_ID=-100...
CRON_SECRET=случайная-длинная-строка
```

`vercel.json` запускает `/api/cron/server-monitor` каждую минуту. Endpoint принимает только `Authorization: Bearer <CRON_SECRET>`. Cron проверяет offline, доставляет Telegram outbox с retry и удаляет историю по retention.

## G. Установка на Windows Server 2019

Открыть **Windows PowerShell 5.1 от имени администратора** в каталоге `tools\server-monitor` и выполнить:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1 `
  -Endpoint "https://ordaops.kz/api/system/server-monitor/ingest" `
  -AgentKey "smk_..." `
  -ServerId "00000000-0000-0000-0000-000000000000"
```

Инсталлятор копирует файлы в `C:\ORDA-Monitor`, до записи ключа ограничивает ACL до `SYSTEM` и `Administrators`, создаёт marker установки, регистрирует задачу под `SYSTEM` и сразу запускает её. Если задача с таким именем уже существует, но не принадлежит ORDA, установка останавливается без изменений. Перезагрузка не выполняется.

## H. Проверка ingest

Состояние задачи и последние строки лога:

```powershell
Get-ScheduledTask -TaskName "ORDA Server Monitor" | Select-Object TaskName, State
Get-Content "C:\ORDA-Monitor\logs\orda-monitor.log" -Tail 30
```

Без отправки данных, только локальный JSON:

```powershell
Stop-ScheduledTask -TaskName "ORDA Server Monitor"
& "C:\ORDA-Monitor\orda-monitor.ps1" -Once -DryRun
Start-ScheduledTask -TaskName "ORDA Server Monitor"
```

Остановка касается только самого агента. Production workloads не затрагиваются.

## I. Безопасная симуляция warning

Симуляция не нагружает CPU и не меняет hardware:

```powershell
Stop-ScheduledTask -TaskName "ORDA Server Monitor"
& "C:\ORDA-Monitor\orda-monitor.ps1" -Once -SimulateCpuUsagePercent 95
Start-ScheduledTask -TaskName "ORDA Server Monitor"
```

Для recovery отправить два нормальных измерения:

```powershell
Stop-ScheduledTask -TaskName "ORDA Server Monitor"
& "C:\ORDA-Monitor\orda-monitor.ps1" -Once -SimulateCpuUsagePercent 20
Start-Sleep -Seconds 2
& "C:\ORDA-Monitor\orda-monitor.ps1" -Once -SimulateCpuUsagePercent 20
Start-ScheduledTask -TaskName "ORDA Server Monitor"
```

## J. Проверка SERVER_OFFLINE

Остановить только задачу агента более чем на 2 минуты:

```powershell
Stop-ScheduledTask -TaskName "ORDA Server Monitor"
```

После Telegram offline-alert снова запустить:

```powershell
Start-ScheduledTask -TaskName "ORDA Server Monitor"
```

Следующий heartbeat закроет offline-alert и поставит `SERVER ONLINE` в Telegram outbox.

## K. Удаление

Удалить задачу, сохранив файлы и логи:

```powershell
& "C:\ORDA-Monitor\uninstall.ps1"
```

Удалить также каталог агента:

```powershell
& "C:\ORDA-Monitor\uninstall.ps1" -RemoveFiles
```

Удаление не требует reboot и не трогает другие scheduled tasks или службы. Перед удалением задачи проверяются её описание и путь запуска, а перед рекурсивным удалением каталога проверяется marker ORDA.

## Поток данных и защита

```text
Windows PowerShell 5.1 agent
  → HTTPS + one-time agent credential
  → Next.js ingest (256 KB, Zod, timestamp, auth, rate limit)
  → atomic Supabase RPC (current + 5-minute history + stateful alerts)
  → Realtime invalidation → authenticated ORDA dashboard
  → durable outbox → separate Telegram bot/channel
```

Agent key, Supabase service role и Telegram token никогда не попадают во frontend bundle. Агент не подключается к Supabase напрямую. RLS ограничивает чтение организацией, а запись разрешена только backend service role.
