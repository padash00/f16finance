# ТЗ — Мастер добавления расхода (v1)

Статус: к реализации. v1 без AI. v2 (с AI-валидацией категории и scope) — в конце документа, отложено.

## Цель

Закрыть «дыру» с расходами: сейчас руководитель/владелец может добавить расход одной формой — без обязательной точки, без чека, без обоснования. Нужен **обязательный wizard, который нельзя обойти** (ни DevTools, ни прямым POST в API), с обязательным документом по умолчанию и контролируемыми исключениями.

## Принципы

1. **Обход невозможен**: запись в `expenses` создаётся только при наличии валидного `wizard_session_id`. Прямой POST без сессии → 410 Gone.
2. **Документ по умолчанию обязателен**: чек / накладная / счёт прикладываются файлом или фото.
3. **Исключения через whitelist**: уборщик, дворник, регулярные мелкие наличные платежи — заранее заведены в «доверенный список вендоров», проходят без документа.
4. **Разовое без чека → на одобрение**: создаётся со статусом `pending_approval`, владелец одобряет/отклоняет в Telegram (или на сайте).
5. **Аудит всего**: кто, когда, IP, какой `wizard_session_id`, что выбрал на каждом шаге.

## Текущее состояние (что уже есть)

- `app/(main)/expenses/page.tsx` — список расходов с фильтрами.
- `app/(main)/expenses/add/page.tsx` — простая форма (дата, точка, оператор, категория, cash/kaspi, комментарий, чек).
- `app/api/admin/expenses/route.ts` — `createExpense | updateExpense | deleteExpense | removeAttachment`.
- `app/api/admin/expenses/upload/route.ts` — загрузка фото чека.
- `expense_categories`: `id, name, accounting_group, monthly_budget` — категории уже разделены по финансовым группам (ФОТ операционные, COGS, налоги на зарплату, налоги).
- `expenses`: `date, company_id, operator_id, category, cash_amount, kaspi_amount, comment, attachment`.

Wizard заменяет страницу `/expenses/add` и закрывает прямой `createExpense`.

## Роли

| Роль | Создание расхода | Одобрение `pending_approval` |
|------|------------------|------------------------------|
| `operator` / `other` | Нет | Нет |
| `manager` | Да, через wizard | Нет |
| `owner` | Да, через wizard. Свой `one_off` сразу `confirmed` | Да |
| `superadmin` | Да | Да |

Менеджер без чека → `pending_approval` → ждёт владельца. Владелец сам себя не одобряет (его one_off идут сразу `confirmed`).

## Поток wizard (3 шага)

### Шаг 1 — Что и куда
- **Точка** (`company_id`) — обязательно, dropdown из доступных пользователю.
- **Категория** — обязательно, в dropdown сгруппирована заголовками по `accounting_group` (ФОТ операционные / COGS / Налоги / ...). Поиск по названию.
- **Сумма** — cash / kaspi / split. Сумма > 0.
- **Дата** — date picker, по умолчанию сегодня. Запрет даты в будущем. Если выбрана дата старше 7 дней — обязательная галочка «Это действительно дата старого расхода?» (флаг логируется в audit).
- **Краткое название** (например «Кофе зерно», «Зарплата Мерея за апрель») — обязательно, ≥ 5 символов.
- **Комментарий** — обязательно, ≥ 20 символов.

### Шаг 2 — Документ
Радио из трёх вариантов:

**A. Чек / накладная / счёт** (по умолчанию)
- Загрузка файла PDF/JPG/PNG, до 10 МБ.
- Без файла кнопка «Далее» неактивна.
- На submit → `status='confirmed'`.

**B. Без документа — постоянный поставщик** (whitelist)
- Раскрывается dropdown «Выбери из доверенных» (содержимое из `expense_vendor_whitelist`).
- Без выбора кнопка «Далее» неактивна.
- На submit → `status='confirmed'`.

**C. Без документа — разовая услуга**
- Обязательное поле «Кому платим» (имя/название), ≥ 3 символов.
- Обязательное поле «Почему нет чека», ≥ 30 символов.
- На submit → `status='pending_approval'` (если создатель не owner) или `status='confirmed'` (если owner).

### Шаг 3 — Подтверждение
- Read-only сводка всех полей с шагов 1–2.
- Кнопка «Создать расход».
- На клике → POST `/api/admin/expenses/wizard/submit` с `wizard_session_id`.

## Анти-абьюз для пути C

Перед submit на шаге 3, если у того же создателя за 30 дней уже ≥ 3 одобренных one_off с тем же `one_off_payee` (case-insensitive trim) — wizard показывает плашку:

> «Похоже, это регулярный платёж — вы уже трижды платили "{name}". Попросите владельца добавить вендора в whitelist.»

Submit не блокируется, но владельцу в Telegram-уведомлении приходит флаг `suggest_whitelist=true`, и он видит подсказку «Этого вендора стоит добавить в whitelist».

## Статусы расхода

- `confirmed` — обычный путь (документ или whitelist или owner+one_off).
- `pending_approval` — менеджерский one_off, ждёт владельца.
- `approved` — владелец одобрил `pending_approval`.
- `declined` — владелец отклонил, в P&L не учитывается.

В отчётах P&L по умолчанию: `confirmed` + `approved`. `pending_approval` показывается отдельной строкой «ожидают».

## БД

### Новые таблицы

```sql
create table public.expense_wizard_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid not null,
  company_id uuid null,
  step smallint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'abandoned')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  consumed_at timestamptz,
  expense_id uuid null
);

create index expense_wizard_sessions_user_active_idx
  on public.expense_wizard_sessions (user_id) where consumed_at is null;

create table public.expense_vendor_whitelist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid null,                       -- null = на всю организацию
  vendor_name text not null,
  default_category_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index expense_vendor_whitelist_org_idx
  on public.expense_vendor_whitelist (organization_id) where archived_at is null;
```

### Изменения в `expenses`

```sql
alter table public.expenses
  add column wizard_session_id uuid references public.expense_wizard_sessions(id),
  add column document_kind text check (document_kind in ('receipt','invoice','bill','whitelist','one_off')),
  add column document_url text,
  add column whitelist_vendor_id uuid references public.expense_vendor_whitelist(id),
  add column one_off_payee text,
  add column one_off_reason text,
  add column status text not null default 'confirmed'
    check (status in ('confirmed','pending_approval','approved','declined')),
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column declined_reason text,
  add column declined_at timestamptz;

create index expenses_pending_idx on public.expenses (status) where status = 'pending_approval';
```

### FK на `expense_wizard_sessions.expense_id`

```sql
alter table public.expense_wizard_sessions
  add constraint expense_wizard_sessions_expense_fk
  foreign key (expense_id) references public.expenses(id) on delete set null;
```

## API

### `POST /api/admin/expenses/wizard/start`
Body: `{}`. Создаёт сессию. Возвращает `{ session_id, expires_at }`.

### `PATCH /api/admin/expenses/wizard/[id]`
Body: `{ step, payload }`. Сервер валидирует payload по схеме шага, сохраняет в jsonb. Возвращает `{ session_id, step, payload }`.

### `POST /api/admin/expenses/wizard/[id]/upload`
Body: `multipart/form-data` (`file`). Сохраняет в Supabase Storage. Возвращает `{ document_url }`.

### `POST /api/admin/expenses/wizard/[id]/submit`
Body: `{}`. Сервер:
1. Берёт сессию по id, проверяет `user_id == current`, `expires_at > now()`, `consumed_at IS NULL`.
2. Валидирует полноту payload (все обязательные поля).
3. Определяет `status`:
   - `document_kind in ('receipt','invoice','bill','whitelist')` → `confirmed`.
   - `document_kind = 'one_off'` И user owner/superadmin → `confirmed`.
   - `document_kind = 'one_off'` И user manager → `pending_approval`.
4. Создаёт запись в `expenses` с `wizard_session_id`.
5. Помечает сессию `consumed_at = now()`, `status='submitted'`, `expense_id = ...`.
6. Если `pending_approval` — шлёт владельцу Telegram-уведомление (см. ниже).
7. Аудит.

### `POST /api/admin/expenses/[id]/approve`
Только `owner` / `superadmin`. Body: `{}`. `pending_approval` → `approved`. Аудит.

### `POST /api/admin/expenses/[id]/decline`
Только `owner` / `superadmin`. Body: `{ reason: string }` (≥ 10 символов). `pending_approval` → `declined`, `declined_reason`, `declined_at`. Аудит.

### `GET / POST / PATCH / DELETE /api/admin/expenses/whitelist`
CRUD для `expense_vendor_whitelist`. Только `owner` / `superadmin`.

### Существующий `POST /api/admin/expenses` — закрыть
Возвращает 410 Gone: `"Используйте /api/admin/expenses/wizard/*"`. Старая страница `/expenses/add` удаляется.

`updateExpense` / `deleteExpense` / `removeAttachment` остаются — редактирование старых записей и удаление работает как было.

## Frontend

### Страница `/expenses/new` (заменяет `/expenses/add`)
- Stepper сверху (1 / 2 / 3).
- Кнопки «Назад» / «Далее» / «Создать».
- На шаге 2 три радио-варианта, по выбору раскрывается подформа.
- На шаге 3 read-only сводка.
- `wizard_session_id` хранится в state компонента, не в URL — нельзя пропустить шаг через адресную строку.

### Страница `/expenses/pending`
- Список `pending_approval`. Видит только `owner` / `superadmin`. Кнопки «Одобрить» / «Отклонить с причиной».

### Страница `/expense-whitelist`
- Только `owner` / `superadmin`. CRUD доверенных вендоров. Поля: имя, точка (опционально, null = на всю орг), категория по умолчанию.

### Sidebar
- «Расходы» → подменю: «Все» / «Ожидают одобрения» / «Доверенные поставщики».

## Telegram (для `pending_approval`)

Используем существующий `TELEGRAM_BOT_TOKEN`. `telegram_user_id` владельца — из `staff_members` или новая ENV `TELEGRAM_OWNER_CHAT_ID` (на первое время).

```
🟡 Расход на одобрение
Точка: {company}
Категория: {category} ({accounting_group})
Сумма: {amount} ₸ ({cash/kaspi})
Дата: {date}
Кому: {one_off_payee}
Почему нет чека: {one_off_reason}
Создал: {user_name}

[✅ Одобрить] [❌ Отклонить]
```

При флаге `suggest_whitelist=true` дополнительная строка перед кнопками:
```
⚠️ Это уже 3-й платёж этому вендору за месяц. Возможно стоит добавить в whitelist.
```

Inline callback → `approve_expense:{id}` / `decline_expense:{id}`. На «Отклонить» бот спрашивает причину текстовым ответом.

## Аудит

Каждый шаг wizard и финальные действия пишутся в `audit_logs`:
- `wizard.expense.start` — `{ session_id }`
- `wizard.expense.step` — `{ session_id, step, payload_keys }`
- `wizard.expense.upload` — `{ session_id, file_size, mime }`
- `wizard.expense.submit` — `{ session_id, expense_id, status, document_kind, backdated: bool }`
- `expense.approve` — `{ expense_id, by }`
- `expense.decline` — `{ expense_id, by, reason }`

## Валидация на сервере (источник истины)

На submit:
- Все обязательные поля заполнены.
- `amount > 0`.
- `date <= today`. Если `date < today - 7d` — обязательный флаг `backdated_confirmed: true` в payload.
- `category_id` принадлежит организации.
- `company_id` входит в `allowedCompanyIds` пользователя.
- Если `document_kind in ('receipt','invoice','bill')` → `document_url` не пустой.
- Если `document_kind = 'whitelist'` → `whitelist_vendor_id` существует и не архивирован.
- Если `document_kind = 'one_off'` → `one_off_payee.length >= 3`, `one_off_reason.length >= 30`.

## Миграции (порядок)

1. `20260427_expense_wizard_sessions.sql` — создание таблицы сессий.
2. `20260427_expense_vendor_whitelist.sql` — создание whitelist.
3. `20260427_expenses_wizard_columns.sql` — alter expenses.
4. Backfill существующих: `expenses.status = 'confirmed'`, `document_kind = NULL`.

## Последовательность реализации

1. Миграции БД.
2. API: `wizard/start`, `wizard/step`, `wizard/upload`, `wizard/submit`. Тест: прямой POST `/api/admin/expenses` без сессии → 410.
3. UI wizard `/expenses/new`. Удалить `/expenses/add`.
4. `/expense-whitelist` CRUD.
5. `/expenses/pending` + Telegram-уведомления + approve/decline.
6. Анти-абьюз счётчик с подсказкой.

## Acceptance

Готово, когда:
- `/expenses/new` показывает wizard, `/expenses/add` удалён.
- POST `/api/admin/expenses` без `wizard_session_id` → 410.
- Прямой submit без uploaded чека / без выбора whitelist / с короткой причиной one_off → отклонён сервером.
- One_off от менеджера → `pending_approval` + Telegram владельцу с кнопками.
- One_off от владельца → сразу `confirmed`.
- Approve/decline в Telegram меняет статус и пишет аудит.
- Whitelist-вендоры создаются и используются на шаге 2.
- Анти-абьюз триггер срабатывает при 3+ one_off на одного payee за 30 дней.
- Каждый созданный расход имеет полный аудит-след шагов wizard.

## Out of scope (v1)

- AI-валидация выбора точки/scope.
- AI-рекомендация категории.
- OCR чеков (распознавание суммы/даты).
- Подпись на планшете.
- Авто-эскалация на 24 часа без реакции.
- Дайджест владельцу по `pending_approval`.

---

# v2 (расширенная, после v1)

После того как v1 поработает 1–2 месяца и накопится статистика — оценить:

1. **Категоризация ошибается?** Если да — добавить AI-подсказку категории (Claude Haiku) на шаге 1. Контекст: список активных категорий с `accounting_group`. Не блокирующая, человек всегда может выбрать другую. Кэш в `ai_cache` на 24 часа по hash(item_name + scope).
2. **Расходы попадают не на ту точку?** Если да — добавить AI-cross-check (item_name + scope + company → ok/warning). Пример: «Кофе зерно» + scope=club → «Кофе обычно для магазина, точно для клуба?». Не блокирующий.
3. **Поле `scope` (`shop` / `club`)** — если AI-cross-check внедряется, добавить колонку `expenses.scope` и шаг «Для магазина / Для клуба» в wizard.
4. **OCR чеков** — проверять, что сумма в чеке совпадает с введённой. Дорого по API-косту, делать только при случаях фальсификации.
5. **Авто-эскалация `pending_approval`** — если 24 часа без реакции, повторное напоминание владельцу.
6. **Дайджест владельцу** — каждое утро Telegram «вчера ожидало одобрения N расходов на сумму X».
7. **Подсказка владельцу при approve** — если `suggest_whitelist=true`, в Telegram добавлять кнопку «➕ Добавить в whitelist» которая создаёт запись и одобряет расход одним действием.

v2 пишется отдельным ТЗ, когда v1 даст данные о реальных проблемах.
