# Weekly Salary Foundation Report

Дата: 2026-03-20
Статус: перепроверено перед пушем

## 1. Что было целью

Нужно было подготовить новый фундамент зарплатного контура под реальный процесс:

- неделя всегда фиксированная: понедельник-воскресенье;
- одна логическая выплата на оператора за неделю;
- внутри недели может быть несколько фактических платежей;
- поддерживаются `нал`, `Kaspi` и смешанная выплата;
- частичная выплата разрешена;
- итог к выплате считается как:
  - `смены + бонусы - штрафы - долги - авансы`;
- аванс должен быть одной системной операцией:
  - влиять на формулу зарплаты;
  - сразу создавать расход;
  - учитываться в ОПиУ / EBITDA через категорию;
- расход по зарплате должен разбиваться по компаниям пропорционально фактически начисленной сумме по компании;
- оплату по сменам нужно вывести из логики будущего интерфейса.

## 2. Что сделано в коде

### 2.1. Добавлена новая миграция под weekly salary

Файл:

- `supabase/migrations/20260320_weekly_salary_payments.sql`

Что создаётся:

- `public.operator_salary_weeks`
  - недельный слепок по оператору;
  - хранит агрегаты по неделе: начислено, бонусы, штрафы, долги, авансы, к выплате, выплачено, остаток, статус;
  - уникальность на `operator_id + week_start`.

- `public.operator_salary_week_company_allocations`
  - разрез недели по компаниям;
  - хранит:
    - `accrued_amount`
    - `share_ratio`
    - `allocated_net_amount`.

- `public.operator_salary_week_payments`
  - отдельные фактические платежи внутри недели;
  - поддерживает:
    - partial payment;
    - mixed payment;
    - отмену через статус и поля сторнирования.

- `public.operator_salary_week_payment_expenses`
  - связь между weekly payment и конкретными записями в `expenses`.

Что расширяется в существующих таблицах:

- `operator_salary_adjustments`
  - `company_id`
  - `salary_week_id`
  - `linked_expense_id`
  - `source_type`
  - `status`
  - `voided_at`
  - `voided_by`
  - `void_reason`

- `expenses`
  - `source_type`
  - `source_id`
  - `salary_week_id`

Зачем это нужно:

- связать аванс и выплату с расходами;
- исключить двойной учёт;
- дать трассировку и безопасную отмену;
- подготовить почву под superadmin-only void flow.

### 2.2. Добавлена доменная weekly-логика

Файл:

- `lib/domain/salary.ts`

Что добавлено:

- `SalaryWeekCompanyAllocation`
- `SalaryWeekSummary`
- расширение строк корректировок и долгов полями `company_id` и `status`
- функция `calculateOperatorWeekSummary(...)`

Что делает `calculateOperatorWeekSummary(...)`:

- берёт shift-детализацию через существующий salary domain;
- собирает недельную сумму по оператору;
- учитывает:
  - начисление по сменам;
  - бонусы;
  - штрафы;
  - долги;
  - авансы;
- если у корректировки есть `company_id`, относит её на конкретную компанию;
- если `company_id` нет, распределяет сумму пропорционально начислению по компаниям;
- возвращает:
  - недельный итог;
  - company split;
  - чистую сумму к выплате.

### 2.3. Обновлён salary repository

Файл:

- `lib/server/repositories/salary.ts`

Что изменено:

- из `operator_salary_adjustments` теперь читаются `company_id` и `status`;
- из `debts` теперь читаются `company_id` и `status`.

Это нужно, чтобы weekly summary умел корректно разложить штрафы, долги и авансы по точкам.

### 2.4. Расширен admin salary API

Файл:

- `app/api/admin/salary/route.ts`

Что оставлено для совместимости:

- `createAdjustment`
- `toggleShiftPayout`
- `updateOperatorChatId`
- `GET view=operatorDetail`

Что добавлено:

- `createAdvance`
- `createWeeklyPayment`
- внутренний builder weekly snapshot через `ensureSalaryWeekSnapshot(...)`

#### `createAdvance`

Вход:

- `operator_id`
- `week_start`
- `company_id`
- `payment_date`
- `cash_amount`
- `kaspi_amount`
- `comment`

Что делает:

1. Строит или обновляет недельный snapshot.
2. Создаёт `expense` с категорией `Аванс`.
3. Создаёт `operator_salary_adjustment` типа `advance`.
4. Связывает adjustment с expense.
5. Пересчитывает weekly snapshot.
6. Пишет audit log.

Фактический результат:

- аванс сразу уменьшает будущую выплату;
- аванс попадает в расходы;
- аванс становится трассируемой операцией, а не двумя разрозненными ручными действиями.

#### `createWeeklyPayment`

Вход:

- `operator_id`
- `week_start`
- `payment_date`
- `cash_amount`
- `kaspi_amount`
- `comment`

Что делает:

1. Обновляет weekly snapshot.
2. Проверяет, что сумма не больше `remaining_amount`.
3. Берёт положительные allocations по компаниям.
4. Делит выплату по компаниям пропорционально `allocated_net_amount`.
5. Создаёт отдельные `expenses` категории `Зарплата` по компаниям.
6. Создаёт запись в `operator_salary_week_payments`.
7. Создаёт связки в `operator_salary_week_payment_expenses`.
8. Повторно пересчитывает weekly snapshot.
9. Пишет audit log.

Фактический результат:

- одна логическая недельная выплата;
- несколько расходов по компаниям;
- поддержка partial payment;
- поддержка mixed payment;
- основа для дальнейшей superadmin-отмены.

## 3. Что уже проверено по качеству

Я прогнал проект перед пушем.

### 3.1. Что проходит

- `npm.cmd run lint`
  - проходит;
  - результат: `0 errors`, `251 warnings`.

- `npm.cmd run build`
  - проходит;
  - TypeScript в build запускается;
  - маршруты собираются без ошибок.

- `npm.cmd run verify:release`
  - проходит целиком.

### 3.2. Что требует внимания

Отдельный запуск:

- `npm.cmd run typecheck`

в одном из прогонов дал ошибку:

- отсутствует `.next/types/cache-life.d.ts`

При этом:

- `verify:release` проходит;
- `build` проходит;
- route types и production build генерируются.

Вывод:

- quality gate в целом рабочий;
- но standalone `typecheck` сейчас зависит от состояния `.next`;
- это нужно добить отдельно, если хочется полностью детерминированный локальный прогон без зависимости от промежуточных next-артефактов.

Дополнительно:

- остаётся неблокирующее предупреждение `baseline-browser-mapping`;
- это не ломает сборку, но пакет можно обновить отдельным маленьким проходом.

## 4. Что пользователь пока не увидит в интерфейсе

Скриншот salary-экрана до сих пор соответствует старому UI:

- таблица по операторам;
- колонки вроде `Оклад`, `База`, `Бонус`, `Старший`, `Долги`, `Штрафы`, `Аванс`, `Премия`, `К выплате`;
- старый поток не заменён на weekly actions.

То есть прямо сейчас:

- backend foundation уже готов;
- но `app/salary/page.tsx` ещё не переведён на weekly workflow;
- кнопки `Выдать аванс` и `Выплатить` в новом смысле ещё не подключены;
- оплата по сменам из UX ещё не вычищена.

Иными словами:

- пушить текущее состояние можно как backend этап;
- но нельзя описывать его как полностью завершённую weekly salary фичу.

## 5. Что ещё не сделано

### 5.1. Общая salary page не мигрирована

Файл:

- `app/salary/page.tsx`

Что ещё нужно:

- собрать weekly rows по операторам;
- показать:
  - начислено;
  - аванс;
  - штрафы;
  - долги;
  - выплачено;
  - остаток;
  - статус недели;
- добавить действия:
  - `Выдать аванс`
  - `Выплатить`;
- убрать оплату по сменам.

### 5.2. Детальная salary page ещё не переведена на weekly UX

Файл:

- `app/salary/[operatorId]/page.tsx`

Что важно:

- серверный контур и доменная логика там уже ранее усиливались;
- но weekly flow в UI этой страницы ещё не подключён;
- старая модель отображения ещё жива.

### 5.3. Legacy shift payout ещё не выведен из системы

Старые сущности и действия пока оставлены специально:

- чтобы не ломать текущий интерфейс до миграции;
- чтобы weekly foundation можно было внедрить поэтапно.

## 6. Текущий состав изменений в worktree

На момент перепроверки изменены или добавлены:

- `app/api/admin/salary/route.ts`
- `app/api/point/reports/route.ts`
- `app/operator-dashboard/page.tsx`
- `desktop/electron_point/src/lib/api.ts`
- `desktop/electron_point/src/pages/admin/AdminLayout.tsx`
- `desktop/electron_point/src/pages/admin/DebtHistoryPage.tsx`
- `desktop/electron_point/src/pages/admin/ShiftHistoryPage.tsx`
- `lib/domain/salary.ts`
- `lib/server/repositories/salary.ts`
- `docs/weekly-salary-foundation-2026-03-20.md`
- `supabase/migrations/20260320_weekly_salary_payments.sql`

## 7. Что из этого относится к weekly salary foundation

Непосредственно относится:

- `app/api/admin/salary/route.ts`
- `lib/domain/salary.ts`
- `lib/server/repositories/salary.ts`
- `supabase/migrations/20260320_weekly_salary_payments.sql`
- `docs/weekly-salary-foundation-2026-03-20.md`

## 8. Что в worktree есть дополнительно и не стоит смешивать в один push без решения

### 8.1. Operator dashboard

Файл:

- `app/operator-dashboard/page.tsx`

Что там менялось:

- убраны `console.log`;
- polling интервал изменён с `10s` на `30s`;
- улучшен перенос и адаптивность некоторых карточек.

Это полезно, но к weekly salary foundation напрямую не относится.

### 8.2. Electron point admin

Файлы:

- `app/api/point/reports/route.ts`
- `desktop/electron_point/src/lib/api.ts`
- `desktop/electron_point/src/pages/admin/AdminLayout.tsx`
- `desktop/electron_point/src/pages/admin/DebtHistoryPage.tsx`
- `desktop/electron_point/src/pages/admin/ShiftHistoryPage.tsx`

Что там по сути:

- добавлен режим, где superadmin может тянуть отчёты по всем точкам;
- в desktop admin прокинуты credentials и новые поля отчётов;
- `DebtHistoryPage` и `ShiftHistoryPage` теперь умеют забирать общие данные через superadmin session;
- подправлен заголовок admin layout.

Это отдельный набор изменений, не связанный напрямую с weekly salary.

## 9. Мой честный вывод перед пушем

Если пушить прямо сейчас:

- код собирается;
- lint не красный;
- verify зелёный;
- backend foundation weekly salary уже лежит в коде;
- но UI зарплаты ещё старый;
- и в worktree лежат дополнительные несвязанные изменения.

Правильный вариант перед пушем:

1. либо коммитить weekly salary foundation отдельно;
2. либо явно решить, что дополнительные desktop/operator-dashboard изменения тоже идут в тот же push;
3. не смешивать это молча.

## 10. Что рекомендую следующим шагом

1. Отделить weekly salary foundation от посторонних локальных правок по возможности.
2. Применить миграцию к БД.
3. Переписать `app/salary/page.tsx` на weekly workflow.
4. Подключить модалки:
   - `Выдать аванс`
   - `Выплатить`
5. После этого убрать shift payout из интерфейса.

## 11. Короткий итог

Сделано:

- новый weekly DB foundation;
- weekly domain calculation;
- company-aware разложение по точкам;
- единая операция аванса;
- weekly payment action;
- связка с `expenses`;
- подготовка под partial и mixed payments;
- аудит и трассировка.

Не сделано:

- weekly UI на общей salary page;
- полный отказ от старой shift payout UX;
- чистый отдельный commit без сопутствующих локальных изменений.

Итоговое состояние:

- backend foundation: готов;
- build/lint/verify: в целом зелёные;
- standalone `typecheck`: требует отдельной доводки из-за `.next/types`;
- UI migration: ещё впереди.
