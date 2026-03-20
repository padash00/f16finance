# Role Matrix

## Super Admin

- Full access to all admin and system routes.
- Can manage system settings, logs, diagnostics, staff accounts, and privileged staff operations.

## Owner

- Sees and uses:
  - `Центр управления`
  - `Деньги`
  - `Команда и зарплаты`
  - `Операционная работа`
  - `Аналитика операторов`
- Can manage:
  - incomes and expenses
- ОПиУ / EBITDA and monthly POS commission inputs
  - operators
  - structure
  - salary and salary rules
  - staff
  - KPI, tasks, shifts
  - point devices
- Cannot access:
  - `Доступы`
  - system settings
  - logs
  - diagnostics
  - staff account administration

## Manager

- Operational role with limited finance creation rights.
- Can work with:
  - tasks
  - shifts
  - salary views
  - income and expense creation
  - structure-related assignment flows
- Cannot manage critical system or privileged staff actions.

## Marketer

- Task-only staff role.
- Does not access finance, salary, shifts, or system areas.

## Operator

- Uses only operator-space routes.
- No staff/admin access.

## Enforcement Layers

- UI navigation filtering in `components/sidebar.tsx`
- Route protection in `proxy.ts`
- Server capability checks in `lib/server/request-auth.ts`
- Role matrix source of truth in `lib/core/access.ts`
