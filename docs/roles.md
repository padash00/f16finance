# Роли и контуры доступа (фаза 0)

Документ фиксирует **терминологию** и **поведение после входа** так, как оно устроено в коде на момент введения клиентского контура. При изменении правил обновляйте и этот файл, и [`lib/core/access.ts`](../lib/core/access.ts).

## Контуры продукта

| Контур | Описание |
|--------|----------|
| **Платформа** | Управление организациями, биллинг, системные сущности. Доступен супер-админу. Маршруты `/platform/*`, `/select-organization`. |
| **Tenant (организация клиента)** | Своя среда по поддомену или выбранной организации: staff, операторы, точки, финансы. |
| **Staff** | Учётные записи в таблице `staff`, роли `owner` / `manager` / `marketer` (+ прочие → `other`). |
| **Оператор** | Запись в `operator_auth` + связь с `operators`; кабинет по префиксу `/operator*`. |
| **Клиент (гость клуба)** | **Планируется (фаза 2+)**. Отдельный пользовательский контур: брони, точки, жалобы. Пока в коде не выделен. |

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
| **Клиент** | *Будущая реализация* | *План: `/client`* | Не видит `/api/admin`, staff-страницы, операторский кабинет; только свои данные (RLS). |

## Важные файлы

- [`lib/core/access.ts`](../lib/core/access.ts) — `StaffRole`, `STAFF_ROLE_MATRIX`, `OPERATOR_PATHS`, `ADMIN_PATHS`, `getDefaultAppPath`, `canAccessPath`.
- [`lib/server/request-auth.ts`](../lib/server/request-auth.ts) — сбор контекста: super admin, staff, operator.
- [`app/api/auth/session-role/route.ts`](../app/api/auth/session-role/route.ts) — `roleLabel`, `defaultPath` для клиента UI.
- [`proxy.ts`](../proxy.ts) — редирект с `/`, `/login`, проверка доступа к пути.

## Следующие шаги (не фаза 0)

1. Тип/флаг **customer** в БД и в сессии.
2. Префикс приложения клиента (например `/client`) + `CLIENT_PATHS` + правка `getDefaultAppPath` / `canAccessPath` / proxy.
3. RLS и `/api/client/*`.

---

*Фаза 0: только документация и единая терминология; поведение продукта не меняется.*
