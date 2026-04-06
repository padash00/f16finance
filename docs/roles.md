# Роли и контуры доступа (фаза 0)

Документ фиксирует **терминологию** и **поведение после входа** так, как оно устроено в коде на момент введения клиентского контура. При изменении правил обновляйте и этот файл, и [`lib/core/access.ts`](../lib/core/access.ts).

## Контуры продукта

| Контур | Описание |
|--------|----------|
| **Платформа** | Управление организациями, биллинг, системные сущности. Доступен супер-админу. Маршруты `/platform/*`, `/select-organization`. |
| **Tenant (организация клиента)** | Своя среда по поддомену или выбранной организации: staff, операторы, точки, финансы. |
| **Staff** | Учётные записи в таблице `staff`, роли `owner` / `manager` / `marketer` (+ прочие → `other`). |
| **Оператор** | Запись в `operator_auth` + связь с `operators`; кабинет по префиксу `/operator*`. |
| **Клиент (гость клуба)** | Пользователь `auth.users`, связанный с `customers.auth_user_id`; отдельный пользовательский контур `/client`. |

## Матрица: кто это, старт после логина, ограничения

Стартовый путь считается в [`getDefaultAppPath`](../lib/core/access.ts) и отдаётся API [`/api/auth/session-role`](../app/api/auth/session-role/route.ts). Проверка маршрутов — [`canAccessPath`](../lib/core/access.ts), прокси — [`proxy.ts`](../proxy.ts) (Next.js proxy).

| Роль (как в продукте) | Условие в коде | Стартовый URL (типично) | Чего нет / куда не пускают |
|------------------------|----------------|-------------------------|-----------------------------|
| **Супер-администратор** | Email в списке админов (`isAdminEmail`), `isSuperAdmin` | `/dashboard` | Нет ограничений по путям (кроме логики tenant/host). Управляет платформой. |
| **Владелец (tenant)** | `staff.role === 'owner'` | `/welcome` (home из матрицы) | По матрице: нет логов, системных настроек, создания staff через «аккаунты» и т.д. — см. `STAFF_ROLE_MATRIX.owner` в `access.ts`. |
| **Руководитель** | `staff.role === 'manager'` | `/welcome` | Уже по `MANAGER_PATHS`; нет части owner-прав (см. действия в матрице). |
| **Маркетолог** | `staff.role === 'marketer'` | `/welcome` | Только `/welcome` и `/tasks` (+ оверрайды `role_permissions`). |
| **Staff «прочий»** | Роль не manager/marketer/owner → `other` | `/unauthorized` | Пустой список путей — только публичные/служебные. |
| **Оператор** | Есть `operator_auth`, нет staff | `/operator` | Только `OPERATOR_PATHS` (`/operator`, `/operator-dashboard`, …). Админские и staff-разделы закрыты. |
| **Клиент (гость)** | Запись в `customers` с `auth_user_id = auth.uid()`, без staff/`operator_auth` | `/client` | API админки по умолчанию недоступны (`getRequestAccessContext` без `allowCustomer`). Видит только `CLIENT_PATHS` в прокси. RLS: политика `customers_select_self`. |

## Важные файлы

- [`lib/core/access.ts`](../lib/core/access.ts) — `StaffRole`, `STAFF_ROLE_MATRIX`, `OPERATOR_PATHS`, `ADMIN_PATHS`, `getDefaultAppPath`, `canAccessPath`.
- [`lib/server/request-auth.ts`](../lib/server/request-auth.ts) — сбор контекста: super admin, staff, operator, гость (`linkedCustomers`, `persona`, опция `allowCustomer`).
- [`lib/server/auth-persona.ts`](../lib/server/auth-persona.ts) — `resolveRequestAuthPersona` (приоритет super_admin → staff → operator → customer).
- [`lib/server/linked-customers.ts`](../lib/server/linked-customers.ts) — выборка связанных строк `customers` по `auth_user_id`.
- [`app/api/auth/session-role/route.ts`](../app/api/auth/session-role/route.ts) — `roleLabel`, `defaultPath` для клиента UI.
- [`proxy.ts`](../proxy.ts) — редирект с `/`, `/login`, проверка доступа к пути.

## Фаза 1 (текущее состояние)

1. **БД:** колонка `customers.auth_user_id` → `auth.users`, уникальность `(company_id, auth_user_id)` при непустом `auth_user_id`.
2. **RLS:** политика `customers_select_self` (чтение своей строки).
3. **Сервер:** `resolveRequestAuthPersona`, `fetchLinkedCustomersForUser`, расширенный `getRequestAccessContext` (гость только с `{ allowCustomer: true }`, иначе 403). Сессия `/api/auth/session-role` отдаёт `isCustomer`, `persona`, `linkedCustomerIds`, `defaultPath` → `/client`.
4. **Маршруты:** `CLIENT_PATHS`, заготовка UI [`app/(client)/client`](../app/(client)/client/page.tsx).

## Фаза 2 (текущее состояние)

1. `/client` выделен в отдельную route group `app/(client)` c собственным layout.
2. Добавлены страницы-заготовки: `/client`, `/client/bookings`, `/client/points`, `/client/support`.
3. После входа `LoginForm` получает `defaultPath` из `/api/auth/session-role`, поэтому customer сразу уходит в `/client`.

## Фаза 3 (текущее состояние)

1. Добавлены API-маршруты клиента: `/api/client/me`, `/api/client/bookings`, `/api/client/points`, `/api/client/support` (GET/POST).
2. Все маршруты используют `getRequestCustomerContext` (customer-only guard + linked customer ids).
3. Страницы `/client/*` подключены к API: базовая витрина профиля, визитов, баллов и формы обращения.

## Фаза 4 (текущее состояние)

1. Добавлены выделенные таблицы: `client_bookings`, `client_support_tickets`, `client_notification_outbox`.
2. Для клиентского контура добавлены отдельные RLS-политики и helper `customer_link_matches_auth`.
3. `/api/client/bookings` и `/api/client/support` переведены на новые таблицы.
4. В support реализован базовый outbox (`in_app`) для дальнейшей доставки push/telegram/email.

## Фаза 5 (текущее состояние)

1. Добавлены staff API-маршруты: `/api/admin/client/bookings` и `/api/admin/client/support`.
2. Реализована обработка заявок: смена статусов броней и тикетов, приоритет/назначение по тикетам.
3. При изменении тикета создаётся outbox-событие для клиента (`ticket_status_changed`).
4. Добавлен cron-воркер `/api/cron/client-outbox` (обработка `pending` из `client_notification_outbox`).

## Фаза 6 (текущее состояние)

1. `client-outbox` cron обрабатывает `in_app`, `email`, `telegram` каналы.
2. Для `email` используется SMTP-конфигурация (`sendSystemEmail`), адрес берётся из payload или `customers.email`.
3. Для `telegram` используется `payload.telegramChatId`/`payload.chatId`; при отсутствии chat id событие уходит в `failed` с причиной.
4. Staff API при смене статусов брони/тикета теперь добавляет outbox-события (`in_app` + `email`, если email клиента известен).

## Следующие шаги (фаза 7+)

1. Реализовать delivery для `push` (APNs/Firebase) и унифицировать retry/backoff.
2. Добавить UI staff-панели для `/api/admin/client/*` и SLA-метрики/дашборд.

---

*Фаза 0: только документация. Фаза 1: БД + RLS + персона и ограничение API без `allowCustomer`.*
