# Лог изменений — откат SaaS логики

## 2026-04-02 — Удаление SaaS роутов и очистка profitability

### Удалены файлы (чисто SaaS, не нужны в single-tenant)

| Файл | Причина |
|------|---------|
| `app/api/admin/organization-members/route.ts` | Управление членами организаций, использовал `assertOrganizationLimitAvailable`, `access.activeSubscription` |
| `app/api/admin/organizations/route.ts` | Создание/управление организациями, биллинг, подписки |
| `app/api/admin/subscription-plans/route.ts` | CRUD для таблицы `subscription_plans` |
| `app/api/auth/active-organization/route.ts` | Устанавливал cookie `active_organization_id` |

### Исправлен файл: `app/api/admin/profitability/route.ts`

**GET handler:**
- Убрана переменная `activeOrganizationId`
- Убрана фильтрация `query.eq('organization_id', activeOrganizationId)`
- Убран вызов `listOrganizationCompanyIds(...)` и фильтрация devicesQuery/incomesQuery по `allowedCompanyIds`
- Убран импорт `listOrganizationCompanyIds` из `@/lib/server/organizations`

**POST handler:**
- Убрана проверка `activeOrganizationId` (возвращала ошибку `active-organization-required` — ломала POST в single-tenant)
- Убрано поле `organization_id` из upsert payload
- `onConflict` изменён с `'organization_id,month'` → `'month'`

### Не тронуто (уже чистые SaaS-добавления без SaaS логики внутри)

| Файл | Статус |
|------|--------|
| `app/api/admin/expense-categories/route.ts` | Чистый CRUD без org-фильтрации |
| `app/api/admin/operator-analytics/route.ts` | Чистые запросы без org-фильтрации |
| `app/api/admin/operators/profile/route.ts` | Чистые запросы по `operator_id` |
| `app/api/cron/shift-reminders/route.ts` | Telegram напоминания, нет SaaS логики |

### Почему sidebar не сломается

`components/sidebar.tsx` вызывает `/api/auth/active-organization` только внутри `handleSwitchOrganization`,
которая доступна только через компонент `OrganizationSwitcher`.
`OrganizationSwitcher` возвращает `null` когда `organizations.length === 0` (строка 540).
В single-tenant режиме `organizations` всегда пустой — компонент не рендерится.
