# Orda — Полный план реализации

> Дата составления: 2026-04-16  
> Статус: в работе

---

## Блок 1 — Kiosk: поведение во время игры (Б + Г + Д)

### Что делаем
Реализуем умное поведение kiosk когда запущена игра. Три варианта объединены в один сценарий.

### Логика поведения

```
[Запуск игры]
  → mainWindow.setAlwaysOnTop(false)
  → mainWindow.minimize()  (убираем kiosk за игру)
  → focusTimer — остановить (иначе каждые 30 сек прерывает игру)
  → gameActive = true  (глобальный флаг в main.js)

[Игрок нажимает Alt+Tab из игры]  ← Вариант Б
  → Alt+Tab НЕ заблокирован глобально пока gameActive = true
  → Игрок видит kiosk (ShellScreen с таймером + кнопка «Вернуться в игру»)
  → Кнопка «Вернуться» — возвращает фокус игре (ищем окно по PID)
  → Kiosk сам не лезет вперёд пока игрок не Alt+Tab'нул

[За 5 минут до конца, игра активна]  ← Вариант Г
  → mainWindow.setAlwaysOnTop(true, 'screen-saver')
  → mainWindow.focus()  (kiosk выходит вперёд)
  → Показываем баннер «Осталось 5 минут! Продлите сессию»
  → Через 15 секунд: mainWindow.setAlwaysOnTop(false), возвращаем игру

[За 1 минуту до конца, игра активна]  ← Вариант Г (жёсткий)
  → mainWindow.setAlwaysOnTop(true, 'screen-saver')
  → mainWindow.focus()
  → Kiosk остаётся на переднем плане, не уходит
  → Игрок видит «Осталась 1 минута» с кнопкой продления

[Время вышло, игра ещё работает]  ← Вариант Д
  → stopGame()  — убиваем процесс игры (process.kill(pid))
  → mainWindow.setAlwaysOnTop(true, 'screen-saver')
  → mainWindow.setKiosk(true)
  → focusTimer — запустить снова
  → gameActive = false
  → pushState() → экран EndedScreen

[Игра закрылась сама / вылетела]
  → onExit callback уже есть — расширить:
  → gameActive = false
  → mainWindow.restore()
  → mainWindow.setAlwaysOnTop(true, 'screen-saver')
  → mainWindow.setKiosk(true)
  → focusTimer — запустить снова
  → pushState()
```

### Файлы для изменения

**`desktop/kiosk/main/main.js`**
- Добавить `let gameActive = false`
- В `launchGame()` onExit: восстановить kiosk, `gameActive = false`, запустить focusTimer
- В `launchConfiguredGame()`: перед запуском `gameActive = true`, отключить focusTimer, `mainWindow.setAlwaysOnTop(false)`, `mainWindow.minimize()`
- В `onTick()`: если `gameActive && remainingSec <= 300` → предупреждение; если `gameActive && remainingSec <= 60` → жёсткое предупреждение; если `gameActive && remainingSec <= 0` → `stopGame()` + восстановить kiosk
- В `setupShortcuts()`: убрать `Alt+Tab` из globalShortcut (пусть работает пока игра активна)
- Добавить IPC хендлер `kiosk:return-to-game` → находим окно игры по PID и фокусируем через `child_process.exec('powershell ...')` или `WM_SETFOREGROUND`

**`desktop/kiosk/src/screens/ShellScreen.tsx`**
- Показывать кнопку «Вернуться в игру» если `kioskState.game?.running === true`
- Кнопка вызывает `ipc.returnToGame()`

**`desktop/kiosk/src/lib/ipc.ts`**
- Добавить `returnToGame: () => ipcRenderer.invoke('kiosk:return-to-game')`

---

## Блок 2 — Браузерные игры и приложения

### Что делаем
Сейчас все игры запускаются как `.exe`. Нужно обработать `category: 'browser'` и `category: 'app'`.

### Логика

```
category === 'browser'
  → exePath содержит URL (https://...) или путь к html
  → Запускаем не как exe, а открываем в BrowserWindow внутри Electron
  → Новое окно: fullscreen, kiosk:false (отдельное окно), без devtools
  → Закрытие этого окна → onExit аналогично игре

category === 'app'
  → exePath = путь к .exe (как обычная игра)
  → Отличие: не разворачивать kiosk на задний план автоматически
  → Приложение может работать рядом с kiosk

category === 'game'
  → текущее поведение (Блок 1)
```

### Файлы

**`desktop/kiosk/main/launcher.js`**
- Добавить `launchBrowser(url)` — создаёт `BrowserWindow` с `url`
- Возвращает объект с `pid` (для совместимости) и `close()` метод

**`desktop/kiosk/main/main.js`**
- В `launchConfiguredGame()` проверяем `game.category`
- Если `browser` → `launchBrowser(game.exePath)`
- Если `app` → обычный `launchGame` но без minimize kiosk

---

## Блок 3 — Дрейф времени (timezone / clock drift)

### Проблема
`endsAtMs = Date.now() + durationSec * 1000` — считается локально.  
Если часы на машине с kiosk отличаются от сервера — таймер врёт.  
Если Windows перевела время (DST, ручная правка) — сессия сломается.

### Решение
```
При старте сессии (applyStartSession):
  → Сохранять endsAt как ISO строку с сервера (абсолютное время)
  → getRemainingSec() = Math.max(0, (new Date(endsAt).getTime() - Date.now()) / 1000)

При heartbeat ответе:
  → Сервер возвращает activeSession.endsAt
  → Каждые 10 сек синхронизируем локальное endsAtMs с серверным значением
  → Допустимое расхождение: ±5 сек (не перебивать резко)

Дополнительно:
  → Если drift > 30 сек → принудительно взять серверное время
```

### Файлы

**`desktop/kiosk/main/main.js`**
- `session.endsAt` хранить как ISO string
- `getRemainingSec()` пересчитывать от `new Date(session.endsAt)`
- В heartbeat sync: если сервер вернул `activeSession.endsAt` и разница > 5 сек → обновить

---

## Блок 4 — Race condition: двойной запуск станции

### Проблема
Два оператора одновременно открыли одну станцию → оба нажали «Запустить» → два `startArenaSession` запроса → станция занята дважды.

### Решение на сервере (`app/api/point/arena/route.ts`)
```typescript
// Уже есть проверка status='active', но нет pessimistic lock
// Добавить: SELECT FOR UPDATE или upsert с unique constraint

// В startSession action:
const existing = await supabase
  .from('arena_sessions')
  .select('id')
  .eq('station_id', stationId)
  .eq('status', 'active')
  .single()

if (existing.data) {
  return NextResponse.json({ error: 'station-already-occupied' }, { status: 409 })
}
// Затем INSERT — если между SELECT и INSERT успел влезть второй запрос,
// уникальный индекс на (station_id, status='active') отклонит его
```

### Файлы

**`app/api/point/arena/route.ts`** — добавить проверку перед INSERT  
**Supabase migration** — добавить partial unique index:
```sql
CREATE UNIQUE INDEX arena_sessions_station_active 
ON arena_sessions(station_id) 
WHERE status = 'active';
```

---

## Блок 5 — Гостевая сессия на kiosk

### Что делаем
Сейчас `onGuestActivated` передаётся в `WelcomeScreen` но нигде не вызывается.  
Гость = сессия без аккаунта, оплата наличными оператору.

### Логика
```
Оператор запускает сессию с пометкой "гость" (уже есть в ArenaPage)
  → Kiosk получает start_session через heartbeat/realtime
  → client = null, но сессия active
  → ShellScreen показывает "Гость" вместо имени
  → Нет кнопки "Профиль" (client === null → onProfile недоступен)
```

### Что нужно
- `WelcomeScreen`: кнопка «Войти как гость» вызывает `onGuestActivated()`
- Но гостевой вход без оплаты — риск. Лучше: гость активируется только через оператора.
- Текущий flow (оператор запускает → kiosk получает через heartbeat) уже работает для гостей.
- Нужно только убрать ожидание логина: если `kioskState.screen === 'active' && !client` → сразу переходить в ShellScreen

**`desktop/kiosk/src/App.tsx`**
- В `useEffect` для `kioskState`: если `screen === 'active'` и `uiScreen === 'welcome'` → `setUiScreen('shell')` (уже частично есть, проверить edge case)

---

## Блок 6 — Баланс клиента в реальном времени

### Проблема
Баланс загружается при логине и не обновляется. Если кто-то пополнил счёт пока клиент в kiosk — он видит старый баланс.

### Решение
```
В heartbeat ответе добавить clientBalance (если есть активный клиент)
  → Kiosk передаёт clientId в heartbeat body
  → Сервер возвращает текущий баланс
  → Kiosk обновляет client.balance в состоянии

ИЛИ через Supabase Realtime:
  → Подписаться на customers:id=clientId
  → При изменении balance → обновить локально
```

### Файлы

**`app/api/kiosk/heartbeat/route.ts`** — если body содержит `clientId`, вернуть `clientBalance`  
**`desktop/kiosk/main/main.js`** — передавать `clientId` в heartbeat body  
**`desktop/kiosk/src/App.tsx`** — обновлять `client.balance` при получении нового значения

---

## Блок 7 — История сессий + полный экспорт

### Что делаем
Сейчас экспорт CSV содержит только активные сессии. Нужна история за период.

### API

**`app/api/point/arena/route.ts`** — новый action `getSessions`:
```typescript
// GET /api/point/arena?action=getSessions&from=2026-04-01&to=2026-04-30
const { data } = await supabase
  .from('arena_sessions')
  .select('*, arena_stations(name), arena_tariffs(name)')
  .eq('point_project_id', projectId)
  .gte('started_at', from)
  .lte('started_at', to)
  .order('started_at', { ascending: false })
```

### UI

**`desktop/operator/src/pages/ArenaPage.tsx`**
- Кнопка «История» в шапке → открывает модалку с date picker (от/до)
- Загружает сессии, показывает таблицу
- Кнопка «Экспорт CSV» в модалке

---

## Блок 8 — Возврат средств

### Логика
```
Оператор в ArenaPage:
  → Завершить сессию досрочно → предложить возврат
  → Расчёт: (оплачено / длительность) * неиспользованные_минуты
  → Возврат на баланс клиента (если не гость)
  → Или возврат наличными (записать в кассу как расход)
```

### Файлы

**`app/api/point/arena/route.ts`** — action `endSessionWithRefund`  
**`app/api/kiosk/heartbeat/route.ts`** — при следующем heartbeat клиент увидит новый баланс  
**`desktop/operator/src/pages/ArenaPage.tsx`** — в ManageSessionModal добавить «Завершить с возвратом»

---

## Блок 9 — Автообновление kiosk

### Что делаем
Operator app уже имеет `electron-updater`. Kiosk нужна такая же система.

### Логика
```
При старте kiosk (после инициализации):
  → Проверить GitHub Releases API: есть ли версия новее текущей?
  → Если да: скачать в фоне
  → Когда скачано: при следующем переходе в idle (нет активной сессии)
    → Показать оператору (через broadcast или heartbeat) что есть обновление
    → ИЛИ автоустановить в 3:00 ночи

Конфигурация в package.json:
  "publish": {
    "provider": "github",
    "owner": "padash00",
    "repo": "f16finance"
  }
```

### Файлы

**`desktop/kiosk/package.json`** — добавить `publish` секцию, установить `electron-updater`  
**`desktop/kiosk/main/main.js`** — добавить autoUpdater логику (аналогично operator)

---

## Блок 10 — Онлайн оплата (Kaspi Pay / карта)

### Что делаем
Сейчас: клиент платит наличными оператору → оператор вручную пополняет баланс → клиент покупает тариф на kiosk.

Новый flow:
```
Клиент на kiosk нажимает «Купить тариф»
  → Выбирает тариф
  → Выбирает способ оплаты: Баланс / Kaspi QR
  → Kaspi QR: kiosk показывает QR код
  → Kaspi Pay webhook → сервер получает оплату
  → Сервер через Realtime broadcast → kiosk активирует сессию
  → Клиент видит «Оплата прошла, сессия запущена»
```

### Файлы

**`app/api/kiosk/kaspi-webhook/route.ts`** — новый endpoint для Kaspi  
**`desktop/kiosk/src/screens/TariffScreen.tsx`** — кнопка «Оплатить через Kaspi», QR-экран  
**`app/api/kiosk/payment-status/route.ts`** — polling endpoint пока QR не оплачен

---

## Блок 11 — Мультиязычность kiosk (рус / каз / англ)

### Что делаем
Все тексты в kiosk вынести в словари, добавить переключатель языка на WelcomeScreen.

### Реализация
```typescript
// src/lib/i18n.ts
const dict = {
  ru: { welcome: 'Добро пожаловать', login: 'Войти', ... },
  kz: { welcome: 'Қош келдіңіз', login: 'Кіру', ... },
  en: { welcome: 'Welcome', login: 'Sign in', ... },
}
```

**Файлы:**
- `desktop/kiosk/src/lib/i18n.ts` — создать словари
- Все экраны — заменить хардкод строки на `t('key')`
- `WelcomeScreen` — добавить переключатель языка

---

## Приоритет выполнения

| # | Блок | Сложность | Важность |
|---|------|-----------|----------|
| 1 | Игра: Б+Г+Д | Средняя | 🔴 Критично |
| 2 | Дрейф времени | Низкая | 🔴 Критично |
| 3 | Race condition | Низкая | 🔴 Критично |
| 4 | Браузерные игры | Средняя | 🟠 Важно |
| 5 | Гостевая сессия | Низкая | 🟠 Важно |
| 6 | Баланс в реальном времени | Низкая | 🟡 Желательно |
| 7 | История сессий + экспорт | Средняя | 🟡 Желательно |
| 8 | Возврат средств | Средняя | 🟡 Желательно |
| 9 | Автообновление kiosk | Средняя | 🟡 Желательно |
| 10 | Онлайн оплата Kaspi | Высокая | 🔵 Долгосрочно |
| 11 | Мультиязычность | Высокая | 🔵 Долгосрочно |

---

## Промпт для следующей сессии с Claude

```
Продолжаем проект Orda Electron (C:\Users\padas\Desktop\Orda_Electron).

Стек: Next.js 14 (app router) + Supabase + Electron (kiosk + operator).

Реализуй блок 1 — поведение kiosk во время игры (Б+Г+Д):

1. В main.js добавить флаг gameActive, при запуске игры:
   - отключить focusTimer
   - mainWindow.setAlwaysOnTop(false)
   - mainWindow.minimize()
   - разрешить Alt+Tab (убрать из globalShortcut пока gameActive)

2. В onTick() при gameActive:
   - remainingSec <= 300: предупреждение, kiosk выходит на 15 сек
   - remainingSec <= 60: kiosk остаётся на переднем плане
   - remainingSec <= 0: stopGame() + восстановить kiosk

3. В onExit callback игры:
   - gameActive = false
   - восстановить alwaysOnTop, kiosk mode, focusTimer

4. ShellScreen: если game.running → кнопка «Вернуться в игру»
   ipc.returnToGame() → фокус на окно игры по PID

Прочитай сначала:
- desktop/kiosk/main/main.js
- desktop/kiosk/main/launcher.js
- desktop/kiosk/src/screens/ShellScreen.tsx
- desktop/kiosk/src/lib/ipc.ts (если есть)
```
