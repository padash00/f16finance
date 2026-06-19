# Аудит мультитенантной изоляции — 2026-06-19

> ## ✅ ИТОГ: все 53 app-layer утечки закрыты (critical + high + medium)
> Батчи 1→3 (штамп при создании, мутация/чтение по id, customer/арена/debts-резолв),
> per-org Telegram (миграция + listReportTargets), 8 cron на per-org, telegram-бот finance
> по орг, inventory-cron owner-путь, 3 пачки medium. Всё на проде, типы зелёные, F16 не сломан.
> **Осталось (defense-in-depth, не app-layer):** RLS на realtime-таблицы (team_chat/
> direct_messages/supplier_debts/news_posts) — SQL; **Kiosk RCE** — требует релиза киоска.
> Бэкфилл-долги: `customers.company_id` (1 NULL → привязать к клубу) для строгого киоск-фильтра.


Мультиагентный аудит всех 300 API-роутов (37 агентов, audit→verify). **53 подтверждённых утечки** между организациями. LEGACY_SINGLE_TENANT_MODE=false (скоуп активен), но многие роуты ходят service-role клиентом (обходит RLS) → app-скоуп единственная стена, и в этих местах её нет.

Статус: `[ ]` не исправлено, `[x]` исправлено.

## 🔴 CRITICAL (кросс-тенант чтение финансов/PII или захват аккаунта/мутация)

> ✅ Все 7 закрыты — коммит `143e1179` (батч 2).

- [ ] **admin/arena** `searchClient` (`:689-698`) и `topUpClientBalance` (`:662-686`) — customers по phone/card БЕЗ company-скоупа: PII+баланс любой орг, мутация баланса. + `searchClient` не в ACTION_TO_CAPABILITY (без права). Фикс: `.in('company_id', allowedCompanyIds)` + проверка company_id customer + добавить в ACTION_TO_CAPABILITY.
- [ ] **admin/hr/activity** (`:78,102,114,45`) — operators/debts/staff_salary_payments/audit_log по присланному id без org-проверки → долги+зарплаты чужого сотрудника. Фикс: ensureOrganizationOperatorAccess/StaffAccess до выборок.
- [ ] **admin/profitability** GET (`:168-173`) monthly_profitability_inputs без organization_id; POST (`:299-310`) onConflict:'month'. Фикс: `.eq('organization_id', orgId)` + onConflict:'organization_id,month'.
- [ ] **admin/settings** company/staff/expense_category update+delete по body.id без org-ownership (`:195,216,257,279,319,340`). Фикс: проверять organization_id строки перед мутацией.
- [ ] **admin/store/suppliers/[id]** PATCH transferItems/transferReceipt (`:205,212-247`) без org-скоупа. Фикс: валидировать исходного+целевого поставщика по орг, org-скоуп на все update.
- [ ] **reset-password** (`:40-57`) меняет пароль любого userId без проверки принадлежности орг → захват чужого аккаунта. Фикс: ensureOrganizationOperatorAccess(userId→operator).
- [ ] **telegram/staff-ids** GET (`:11-14`) весь staff всех орг; PATCH (`:28-31`) по id. Фикс: скоуп по org + canManage + ensureOrganizationStaffAccess.

## 🟠 HIGH (кросс-тенант мутация или чтение метаданных/агрегатов)

> Прогресс: ✅ 3A (`9018b2c9`), ✅ 3B (`131c8308`), ✅ 3C (`ce230e4e`,`8373cfd1`),
> киоск NULL-толерантность (`9940436d`), salary-snapshot (`137a00a2`).
> ✅ Фундамент per-org Telegram: `organizations.telegram_owner_chat_id` + listReportTargets (`65150e16`).
> ✅ cron overdue-debts, morning-ai-insight (`392158a1`), birthday-greetings, smart-insights (`cf1f9722`).
>
> ✅ telegram/webhook finance-команды (`3a041006`) — botCompanyScope в getFinanceSummary/
> cashflow/top/forecast/compare/detailed-report + AI on_shift/today_shifts.
> ✅ cron recurring-expenses, hr-daily-digest (`70d70a71`).
>
> ВСЕ HIGH ЗАКРЫТЫ, кроме 2 (нужен SQL): cron inventory-integrity / inventory-shortage-alert —
> RPC inventory_integrity_check() / inventory_recurring_shortages() агрегируют по всем
> компаниям без company-параметра. Нужна правка RPC (добавить p_company_ids).

- [ ] **admin/expense-categories** PATCH(`:172`)/DELETE(`:212`) по id без org. Фикс: проверять organization_id.
- [ ] **admin/expense-templates** DELETE(`:82-90`) existing.company_id не сверяется. Фикс: resolveCompanyScope(existing.company_id).
- [ ] **admin/expenses/upload** (`:88-113`) expenseId без org → прикрепить файл к чужому расходу. Фикс: проверить expense.company_id ∈ allowed.
- [ ] **admin/expenses/whitelist** PATCH(`:177`)/DELETE(`:222`) по id без проверки существующей записи. Фикс: проверять organization_id строки.
- [ ] **admin/hr/history** (`:38-45`) audit_log по entity_id без членства. Фикс: listOrganization*Ids/ensure*Access.
- [ ] **admin/inventory/catalog** deleteItem(`:922`)/updateItem(`:954`) по item_id без org. Фикс: проверять item.organization_id.
- [ ] **admin/knowledge/quiz/submit** (`:30-69`) attempt_id без org → читать/перезаписывать чужую попытку. Фикс: attempt.organization_id == orgId.
- [ ] **admin/kpi-plans** DELETE(`:571`) по id без скоупа (и без capability). Фикс: проверять company_id плана.
- [ ] **admin/operators-presence** POST(`:102-111`) push/lock на чужое устройство. Фикс: фильтровать deviceId по allowedCompanyIds.
- [ ] **admin/performance/ranking** (`:107,143`) company_id из URL без resolveCompanyScope → агрегаты выручки чужой орг. Фикс: валидировать companyId.
- [ ] **admin/point-rules** updateRule(`:191`)/deleteRule(`:214`) по ruleId без проверки current.company_id. Фикс: скоуп current.
- [ ] **admin/production/recipes** PATCH(`:235-252`) recipe_components по recipe_id даже если update 0 строк. Фикс: проверять принадлежность рецепта.
- [ ] **admin/purchase-plan** PATCH(`:171`)/DELETE(`:196`) по id без скоупа. Фикс: org-скоуп на мутации.
- [ ] **calendar** GET (`:61,94,114`) operator_profiles/shift_responses/team_chat_messages без скоупа → PII+объявления всех орг. Фикс: скоуп по operator_id орг + organization_id.
- [ ] **cron/birthday-greetings** (`:41,90-101`) поздравления коллегам шлются между орг. Фикс: группировать по organization_id.
- [ ] **cron/inventory-integrity** owner-путь (`:62-72,111`) RPC без скоупа → инвентарь всех орг. Фикс: scope в RPC/owner-путь.
- [ ] **cron/inventory-shortage-alert** owner-путь (`:44-94`) аналогично. Фикс: scope.
- [ ] **cron/morning-ai-insight** (`:67-156`) финансы+PII всех орг в один owner-чат. Фикс: scope по орг (как smart-insights TELEGRAM_OWNER_ORG_ID).
- [ ] **cron/overdue-debts** (`:43-85`) supplier_debts всех орг в один чат. Фикс: группировать по орг.
- [ ] **cron/smart-insights** (`:108,129`) inventory_balances/tasks не скоуплены + null-org=все. Фикс: обязательный orgId + скоуп этих таблиц.
- [ ] **kiosk/client/login** (`:41-46`) customers по phone/card без station.company_id → вход клиента чужой компании. Фикс: `.eq('company_id', station.company_id)`.
- [ ] **kiosk/qr-login** (`:19-43`) findCustomerByLogin без company-скоупа. Фикс: тянуть station.company_id + фильтр.
- [ ] **news** DELETE(`:120-135`) пост по id без org → owner удаляет чужой пост. Фикс: `.eq('organization_id', orgId)`.
- [ ] **news/views** GET (`:26-72`) postId без org → PII зрителей чужого поста. Фикс: проверять пост.organization_id.
- [ ] **point/arena** startSession/extendSession читают тариф/станцию/занятость по id без point_project_id (`:248,258,535,563`). Фикс: `.eq('point_project_id', projectId)`.
- [ ] **point/debts** resolveOperator/normalizeDebtor (`:85,129,157`) PII по присланному id без company → +Telegram чужому. Фикс: проверять принадлежность company устройства.
- [ ] **team-chat/pin** POST/DELETE (`:40-70`) по id без org → закрепить чужое сообщение. Фикс: проверять organization_id сообщения.
- [ ] **team-chat/polls** GET (`:90-113`) pollId без org → имена голосовавших чужой орг. Фикс: join message.organization_id.
- [ ] **telegram/salary-snapshot** POST (`:48`) operatorId без org → расчёт+отправка зп чужого. Фикс: ensure*Access + ужесточить guard.
- [ ] **telegram/webhook** finance-команды (/week,/top,/report,/cashflow,/forecast) без org-скоупа (owner/manager видят все орг). Фикс: прокинуть botUser.organizationId → allowedCompanyIds во все finance/shift хендлеры.

## 🟡 MEDIUM (метаданные/тренинг/узкая ось)

- [ ] **admin/knowledge/quiz-attempts** (`:41`) ветка organization_id.is.null отдаёт legacy чужих орг.
- [ ] **admin/store/audit-timeline** (`:60-63`) staff-lookup без org → ФИО через legacy-NULL.
- [ ] **admin/store/receipts/ai-parse** (`:238`) supplier по id без org → имя организации поставщика.
- [ ] **admin/structure** (`:89-94`) audit_log history без скоупа (пропускает записи без company_id).
- [ ] **cron/hr-daily-digest** (`:70-173`) PII всех орг в общий дайджест + news_posts без org.
- [ ] **cron/recurring-expenses** (`:84-97`) Telegram-свод расходов всех орг в один чат.
- [ ] **kiosk/debug** (`:18-108`) без auth: метаданные станций любой орг + broadcast.
- [ ] **news/view** POST (`:25-27`) отметить прочитанным чужой пост.
- [ ] **operator/shift/current** (`:47-52`) checklist_templates без company-скоупа. (тот же баг в **point/shift/current** `:50-55`)
- [ ] **point/quiz/generate** (`:32,119`) operator_id из заголовка без проверки company.
- [ ] **point/quiz/last-attempt** (`:18-30`) operator_id из заголовка без проверки.
- [ ] **point/quiz/submit** (`:30-73`) attempt_id без привязки к device.
- [ ] **pos/ai-hint** (`:88-90`) location_id без проверки company → остатки чужой точки.
- [ ] **pos/sale** (`:185,251,282`) discount/customer/item по id без company → смешение.
- [ ] **team-chat/polls/[pollId]/vote** (`:32-37`) голосование в чужом опросе.
- [ ] **team-chat/reactions** (`:29,68`) реакции/имена по messageId без org.

## Неперепроверено (1)
- [ ] **admin/store/warehouse** lookupBarcode (`:248`) товар по barcode без org (для суперадмина/общего barcode).

## Паттерны фиксов
- **A. Мутация-по-id:** прочитать строку, сверить organization_id/company_id с орг; иначе 403/404 (или `.eq('organization_id', orgId)` на update/delete).
- **B. Чтение-по-id:** валидировать принадлежность id (ensureOrganization*Access / listOrganization*Ids / resolveCompanyScope) ДО выборки.
- **C. Customer-резолв:** `.eq('company_id', station/device.company_id)`.
- **D. Cron:** группировать по organization_id, слать в чат соответствующей орг (маппинг org→chat_id).
- **E. Telegram-бот finance:** прокинуть botUser.organizationId во все не-AI хендлеры.
