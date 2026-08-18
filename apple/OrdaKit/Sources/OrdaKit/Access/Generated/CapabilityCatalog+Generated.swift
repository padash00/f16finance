// ВНИМАНИЕ: файл сгенерирован автоматически. Правки будут затёрты.
//
// Источник:  lib/core/capabilities.ts, lib/core/addons.ts
// Генератор: scripts/export-capabilities.mjs
//
// Обновить:  node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs
// Проверить: node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs --check


extension CapabilityCatalog {
    /// Все группы прав, зеркало `CAPABILITY_GROUPS` из веба.
    static let generatedGroups: [CapabilityGroup] = [
        CapabilityGroup(
            id: "finance",
            label: "Финансы",
            pages: [
                CapabilityPage(
                    id: "income",
                    path: "/income",
                    extraPaths: ["/income/add", "/income/analytics", "/income-embed/add"],
                    label: "Доходы",
                    capabilities: [
                        Capability(id: "income.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "income.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "income.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "income.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "income.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "income.update_online", label: "Изменить Online-сумму", description: nil, severity: .medium, deps: []),
                        Capability(id: "income.create_batch", label: "Массовое добавление", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "expenses",
                    path: "/expenses",
                    extraPaths: ["/expenses/add", "/expenses/new", "/expenses-embed/new", "/expenses-embed/edit"],
                    label: "Расходы",
                    capabilities: [
                        Capability(id: "expenses.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "expenses.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "expenses.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "expenses.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "expenses.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "expenses.manage_templates", label: "Управление шаблонами", description: nil, severity: .medium, deps: []),
                        Capability(id: "expenses.import_file", label: "Загрузка файлов (чеки, фото)", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "expenses-pending",
                    path: "/expenses/pending",
                    extraPaths: [],
                    label: "Ожидающие расходы",
                    capabilities: [
                        Capability(id: "expenses-pending.view", label: "Просмотр очереди", description: nil, severity: .low, deps: []),
                        Capability(id: "expenses-pending.approve", label: "Одобрить расход", description: nil, severity: .high, deps: []),
                        Capability(id: "expenses-pending.decline", label: "Отклонить расход", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "expense-whitelist",
                    path: "/expense-whitelist",
                    extraPaths: [],
                    label: "Доверенные поставщики",
                    capabilities: [
                        Capability(id: "expense-whitelist.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "expense-whitelist.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "expense-whitelist.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "cashflow",
                    path: "/cashflow",
                    extraPaths: [],
                    label: "Денежные потоки",
                    capabilities: [
                        Capability(id: "cashflow.view", label: "Просмотр прогноза", description: nil, severity: .low, deps: []),
                        Capability(id: "cashflow.export", label: "Выгрузка в Excel", description: nil, severity: .low, deps: []),
                        Capability(id: "cashflow.ai_analysis", label: "AI-анализ потоков", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "profitability",
                    path: "/profitability",
                    extraPaths: [],
                    label: "Рентабельность (ОПиУ)",
                    capabilities: [
                        Capability(id: "profitability.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "profitability.edit", label: "Изменение параметров месяца", description: nil, severity: .high, deps: []),
                        Capability(id: "profitability.simulate", label: "What-if симуляция", description: nil, severity: .low, deps: []),
                        Capability(id: "profitability.export_pdf", label: "Экспорт PDF", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "valuation",
                    path: "/valuation",
                    extraPaths: [],
                    label: "Оценка бизнеса",
                    capabilities: [
                        Capability(id: "valuation.view", label: "Просмотр оценки бизнеса", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "simulation",
                    path: "/simulation",
                    extraPaths: [],
                    label: "Симуляция выручки",
                    capabilities: [
                        Capability(id: "simulation.view", label: "Просмотр симуляции", description: nil, severity: .low, deps: []),
                        Capability(id: "simulation.edit", label: "Редактирование зон и тарифов", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "branch-plan",
                    path: "/branch-plan",
                    extraPaths: [],
                    label: "Финмодель новой точки",
                    capabilities: [
                        Capability(id: "branch-plan.view", label: "Просмотр финмодели", description: nil, severity: .low, deps: []),
                        Capability(id: "branch-plan.edit", label: "Редактирование/сохранение", description: nil, severity: .medium, deps: []),
                        Capability(id: "branch-plan.delete", label: "Удалить черновик финмодели", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "weekly-report",
                    path: "/weekly-report",
                    extraPaths: [],
                    label: "Еженедельный отчёт",
                    capabilities: [
                        Capability(id: "weekly-report.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "weekly-report.export", label: "Выгрузка в Excel", description: nil, severity: .low, deps: []),
                        Capability(id: "weekly-report.export_pdf", label: "Выгрузка в PDF", description: nil, severity: .low, deps: []),
                        Capability(id: "weekly-report.share", label: "Поделиться отчётом", description: nil, severity: .medium, deps: []),
                        Capability(id: "weekly-report.ai_generate", label: "Сгенерировать AI-отчёт", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "reports",
                    path: "/reports",
                    extraPaths: [],
                    label: "Отчёты",
                    capabilities: [
                        Capability(id: "reports.view", label: "Просмотр отчётов", description: nil, severity: .low, deps: []),
                        Capability(id: "reports.export", label: "Выгрузка в Excel", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "forecast",
                    path: "/forecast",
                    extraPaths: [],
                    label: "Прогноз",
                    capabilities: [
                        Capability(id: "forecast.view", label: "Просмотр прогноза", description: nil, severity: .low, deps: []),
                        Capability(id: "forecast.generate", label: "Запустить генерацию AI", description: nil, severity: .medium, deps: []),
                        Capability(id: "forecast.cancel_generation", label: "Отменить генерацию AI", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "analytics",
                    path: "/analytics",
                    extraPaths: [],
                    label: "Аналитика",
                    capabilities: [
                        Capability(id: "analytics.view", label: "Просмотр аналитики", description: nil, severity: .low, deps: []),
                        Capability(id: "analytics.export", label: "Выгрузка в Excel", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "analysis",
                    path: "/analysis",
                    extraPaths: [],
                    label: "AI-анализ",
                    capabilities: [
                        Capability(id: "analysis.view", label: "Просмотр анализа", description: nil, severity: .low, deps: []),
                        Capability(id: "analysis.refresh", label: "Запустить новый анализ AI", description: nil, severity: .medium, deps: []),
                        Capability(id: "analysis.export", label: "Выгрузка результатов", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "tax",
                    path: "/tax",
                    extraPaths: [],
                    label: "Налоги",
                    capabilities: [
                        Capability(id: "tax.view", label: "Просмотр налоговых данных", description: nil, severity: .low, deps: []),
                        Capability(id: "tax.export_910", label: "Экспорт формы 910 (xlsx)", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "point-debts",
                    path: "/point-debts",
                    extraPaths: [],
                    label: "Долги точек",
                    capabilities: [
                        Capability(id: "point-debts.view", label: "Просмотр задолженности", description: nil, severity: .low, deps: []),
                        Capability(id: "point-debts.mark_paid", label: "Отметить как оплачено", description: nil, severity: .high, deps: []),
                        Capability(id: "point-debts.export", label: "Выгрузка в Excel", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "inventory",
            label: "Склад и магазин",
            pages: [
                CapabilityPage(
                    id: "store",
                    path: "/store",
                    extraPaths: [],
                    label: "Главная склада",
                    capabilities: [
                        Capability(id: "store.view", label: "Просмотр обзора", description: nil, severity: .low, deps: []),
                        Capability(id: "store.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                        Capability(id: "store.global_search", label: "Глобальный поиск по складу", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-warehouse",
                    path: "/store/warehouse",
                    extraPaths: [],
                    label: "Склад (остатки)",
                    capabilities: [
                        Capability(id: "store-warehouse.view", label: "Просмотр остатков", description: nil, severity: .low, deps: []),
                        Capability(id: "store-warehouse.edit", label: "Корректировка остатков вручную", description: nil, severity: .high, deps: []),
                        Capability(id: "store-warehouse.create_item", label: "Создать товар через сканер штрихкода", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-warehouse.upload_backroom", label: "Загрузка файла подсобки", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-warehouse.apply_backroom", label: "Применить загруженный файл подсобки", description: nil, severity: .high, deps: []),
                        Capability(id: "store-warehouse.print_labels", label: "Печать ценников", description: nil, severity: .low, deps: []),
                        Capability(id: "store-warehouse.delete_selected", label: "Удалить выбранные товары", description: nil, severity: .high, deps: []),
                        Capability(id: "store-warehouse.delete_all", label: "Очистить весь склад", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-showcase",
                    path: "/store/showcase",
                    extraPaths: [],
                    label: "Витрина",
                    capabilities: [
                        Capability(id: "store-showcase.view", label: "Просмотр витрины", description: nil, severity: .low, deps: []),
                        Capability(id: "store-showcase.move", label: "Перенос со склада на витрину", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-showcase.return_to_warehouse", label: "Возврат с витрины на склад", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-catalog",
                    path: "/store/catalog",
                    extraPaths: [],
                    label: "Каталог товаров",
                    capabilities: [
                        Capability(id: "store-catalog.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-catalog.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-catalog.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-catalog.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "store-catalog.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "store-catalog.import", label: "Импорт из файла", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-catalog.bulk_zero_stock", label: "Массовое обнуление остатков", description: nil, severity: .high, deps: []),
                        Capability(id: "store-catalog.bulk_deactivate", label: "Скрыть все товары", description: nil, severity: .high, deps: []),
                        Capability(id: "store-catalog.bulk_delete_empty", label: "Удалить товары без остатков", description: nil, severity: .high, deps: []),
                        Capability(id: "store-catalog.bulk_delete_all", label: "Удалить весь каталог", description: nil, severity: .high, deps: []),
                        Capability(id: "store-catalog.print_labels", label: "Печать ценников", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-receipts",
                    path: "/store/receipts",
                    extraPaths: [],
                    label: "Приёмки от поставщиков",
                    capabilities: [
                        Capability(id: "store-receipts.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-receipts.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "store-receipts.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "store-receipts.cancel", label: "Отмена проведённой приёмки", description: nil, severity: .high, deps: []),
                        Capability(id: "store-receipts.ai_parse", label: "AI-распознавание накладной", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.parse_payment_receipt", label: "AI-распознавание чека об оплате", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.apply_template", label: "Применить шаблон приёмки", description: nil, severity: .low, deps: []),
                        Capability(id: "store-receipts.save_template", label: "Сохранить шаблон приёмки", description: nil, severity: .low, deps: []),
                        Capability(id: "store-receipts.delete_template", label: "Удалить шаблон приёмки", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.bulk_markup", label: "Применить наценку ко всем позициям", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.bulk_sale_price", label: "Применить цену продажи ко всем позициям", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-receipts.quick_add_barcode", label: "Быстрое добавление товара по штрихкоду", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-postings",
                    path: "/store/postings",
                    extraPaths: [],
                    label: "Оприходование",
                    capabilities: [
                        Capability(id: "store-postings.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-postings.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-postings.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-postings.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-requests",
                    path: "/store/requests",
                    extraPaths: [],
                    label: "Заявки склад → витрина",
                    capabilities: [
                        Capability(id: "store-requests.view", label: "Просмотр заявок", description: nil, severity: .low, deps: []),
                        Capability(id: "store-requests.create", label: "Создание заявки", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.edit", label: "Изменение количества", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.approve", label: "Одобрить заявку", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.bulk_approve", label: "Массовое одобрение", description: nil, severity: .high, deps: []),
                        Capability(id: "store-requests.reject", label: "Отклонить заявку", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.bulk_reject", label: "Массовое отклонение", description: nil, severity: .high, deps: []),
                        Capability(id: "store-requests.issue", label: "Выдать товар со склада", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.receive", label: "Отметить получение на точке", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-requests.undecide", label: "Отозвать одобрение", description: nil, severity: .high, deps: []),
                        Capability(id: "store-requests.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-requests-journal",
                    path: "/store/requests-journal",
                    extraPaths: [],
                    label: "Журнал заявок",
                    capabilities: [
                        Capability(id: "store-requests-journal.view", label: "Просмотр истории заявок", description: nil, severity: .low, deps: []),
                        Capability(id: "store-requests-journal.export", label: "Выгрузка истории заявок", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-revisions",
                    path: "/store/revisions",
                    extraPaths: [],
                    label: "Ревизии (инвентаризация)",
                    capabilities: [
                        Capability(id: "store-revisions.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-revisions.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-revisions.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-revisions.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "store-revisions.commit", label: "Подтвердить и провести ревизию", description: nil, severity: .high, deps: []),
                        Capability(id: "store-revisions.cancel", label: "Отменить ревизию", description: nil, severity: .high, deps: []),
                        Capability(id: "store-revisions.add_item_barcode", label: "Добавить товар по штрихкоду", description: nil, severity: .low, deps: []),
                        Capability(id: "store-revisions.preload_from_balances", label: "Автозаполнить остатки в форму ревизии", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-writeoffs",
                    path: "/store/writeoffs",
                    extraPaths: [],
                    label: "Списания товара",
                    capabilities: [
                        Capability(id: "store-writeoffs.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-writeoffs.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-writeoffs.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-writeoffs.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "store-writeoffs.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "store-writeoffs.cancel", label: "Отменить списание", description: nil, severity: .high, deps: []),
                        Capability(id: "store-writeoffs.apply_template", label: "Применить шаблон списания", description: nil, severity: .low, deps: []),
                        Capability(id: "store-writeoffs.save_template", label: "Сохранить шаблон списания", description: nil, severity: .low, deps: []),
                        Capability(id: "store-writeoffs.quick_add_barcode", label: "Быстрое добавление товара по штрихкоду", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-suppliers",
                    path: "/store/suppliers",
                    extraPaths: ["/store/suppliers/[id]"],
                    label: "Поставщики",
                    capabilities: [
                        Capability(id: "store-suppliers.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-suppliers.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-suppliers.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-suppliers.add_alias", label: "Добавить алиас товара поставщика", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-suppliers.delete_alias", label: "Удалить алиас товара", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-purchase-orders",
                    path: "/store/purchase-orders",
                    extraPaths: [],
                    label: "Заявки поставщикам",
                    capabilities: [
                        Capability(id: "store-purchase-orders.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-purchase-orders.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-purchase-orders.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-purchase-orders.send", label: "Отправить заявку поставщику", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-purchase-orders.cancel", label: "Отменить заявку поставщику", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-receipt-settings",
                    path: "/store/receipt-settings",
                    extraPaths: [],
                    label: "Реквизиты чека ККМ",
                    capabilities: [
                        Capability(id: "store-receipt-settings.view", label: "Просмотр реквизитов чека", description: nil, severity: .low, deps: []),
                        Capability(id: "store-receipt-settings.edit", label: "Изменение реквизитов чека", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-consumables",
                    path: "/store/consumables",
                    extraPaths: [],
                    label: "Расходники",
                    capabilities: [
                        Capability(id: "store-consumables.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-consumables.create", label: "Добавить расходник", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-consumables.edit", label: "Изменить норму расхода", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-consumables.issue", label: "Записать выдачу", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-movements",
                    path: "/store/movements",
                    extraPaths: [],
                    label: "Движения товара",
                    capabilities: [
                        Capability(id: "store-movements.view", label: "Просмотр истории", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-forecast",
                    path: "/store/forecast",
                    extraPaths: [],
                    label: "Прогноз потребности",
                    capabilities: [
                        Capability(id: "store-forecast.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-analytics",
                    path: "/store/analytics",
                    extraPaths: ["/store/abc"],
                    label: "Аналитика склада + ABC",
                    capabilities: [
                        Capability(id: "store-analytics.view", label: "Просмотр аналитики", description: nil, severity: .low, deps: []),
                        Capability(id: "store-analytics.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                        Capability(id: "store-analytics.edit_sale_price", label: "Изменить цену продажи", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-billing",
                    path: "/store/billing",
                    extraPaths: [],
                    label: "Биллинг и долги поставщикам",
                    capabilities: [
                        Capability(id: "store-billing.view", label: "Просмотр счетов и долгов", description: nil, severity: .low, deps: []),
                        Capability(id: "store-billing.pay_debt", label: "Оплатить долг поставщику", description: nil, severity: .high, deps: []),
                        Capability(id: "store-billing.write_off_debt", label: "Списать долг (без оплаты)", description: nil, severity: .high, deps: []),
                        Capability(id: "store-billing.bulk_pay", label: "Массовая оплата долгов", description: nil, severity: .high, deps: []),
                        Capability(id: "store-billing.reschedule_debt", label: "Перенести срок оплаты долга", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-billing.parse_receipt", label: "AI-распознавание чека/счёта", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-billing.export", label: "Выгрузка долгов в Excel", description: nil, severity: .low, deps: []),
                        Capability(id: "store-billing.delete_debt", label: "Удалить запись долга", description: nil, severity: .high, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "shifts",
            label: "Смены",
            pages: [
                CapabilityPage(
                    id: "shifts",
                    path: "/shifts",
                    extraPaths: ["/shifts/add", "/shifts/report"],
                    label: "Смены (расписание)",
                    capabilities: [
                        Capability(id: "shifts.view", label: "Просмотр графика", description: nil, severity: .low, deps: []),
                        Capability(id: "shifts.create", label: "Создать смену", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.edit", label: "Изменить смену", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.delete", label: "Удалить смену", description: nil, severity: .high, deps: []),
                        Capability(id: "shifts.copy_week", label: "Копировать неделю", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.bulk_assign_week", label: "Массовое назначение на неделю", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.publish_week", label: "Опубликовать график", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.resolve_issue", label: "Решить конфликт смен", description: nil, severity: .medium, deps: []),
                        Capability(id: "shifts.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "shifts-reports",
                    path: "/shifts/reports",
                    extraPaths: ["/shifts/reports/[id]"],
                    label: "Отчёты смен",
                    capabilities: [
                        Capability(id: "shifts-reports.view", label: "Просмотр отчётов", description: nil, severity: .low, deps: []),
                        Capability(id: "shifts-reports.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                        Capability(id: "shifts-reports.close_force", label: "Принудительно закрыть смену", description: nil, severity: .high, deps: []),
                        Capability(id: "shifts-reports.purge", label: "Полная очистка данных смены", description: nil, severity: .high, deps: []),
                        Capability(id: "shifts-reports.reopen", label: "Переоткрыть смену", description: nil, severity: .high, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "staff",
            label: "Персонал",
            pages: [
                CapabilityPage(
                    id: "operators",
                    path: "/operators",
                    extraPaths: ["/operators/[id]/profile"],
                    label: "Операторы",
                    capabilities: [
                        Capability(id: "operators.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "operators.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.toggle_active", label: "Активировать/деактивировать", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.bulk_delete", label: "Массовое удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.promote", label: "Повысить в должности", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.save_assignments", label: "Изменить назначения на точки", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.avatar_upload", label: "Загрузить фото оператора", description: nil, severity: .low, deps: []),
                        Capability(id: "operators.document_upload", label: "Загрузить документы оператора", description: nil, severity: .medium, deps: []),
                        Capability(id: "operators.create_account", label: "Создать учётную запись", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.reset_password", label: "Сбросить пароль", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.edit_login", label: "Изменить логин", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.send_credentials_telegram", label: "Отправить логин/пароль в Telegram", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.bulk_send_credentials_telegram", label: "Массовая отправка credentials в Telegram", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.export_credentials", label: "Выгрузить логины и пароли в Excel", description: nil, severity: .high, deps: []),
                        Capability(id: "operators.copy_profile_data", label: "Копирование данных оператора в буфер", description: nil, severity: .low, deps: []),
                        Capability(id: "operators.export", label: "Экспорт PDF доступов операторов", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "staff",
                    path: "/staff",
                    extraPaths: [],
                    label: "Сотрудники",
                    capabilities: [
                        Capability(id: "staff.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "staff.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "staff.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "staff.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "staff.invite", label: "Пригласить сотрудника", description: nil, severity: .high, deps: []),
                        Capability(id: "staff.toggle_status", label: "Активировать/деактивировать", description: nil, severity: .high, deps: []),
                        Capability(id: "staff.create_payment", label: "Записать выплату", description: nil, severity: .high, deps: []),
                        Capability(id: "staff.add_adjustment", label: "Сделать корректировку зарплаты", description: nil, severity: .high, deps: []),
                        Capability(id: "staff.add_extra_day", label: "Добавить доп. рабочий день", description: nil, severity: .medium, deps: []),
                        Capability(id: "staff.reset_password", label: "Сбросить пароль сотрудника", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "pass",
                    path: "/pass",
                    extraPaths: [],
                    label: "Пропуска",
                    capabilities: [
                        Capability(id: "pass.view", label: "Просмотр пропусков", description: nil, severity: .low, deps: []),
                        Capability(id: "pass.export_csv", label: "Выгрузка списка в CSV", description: nil, severity: .high, deps: []),
                        Capability(id: "pass.copy_credentials", label: "Копирование логина/пароля в буфер", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "salary",
                    path: "/salary",
                    extraPaths: ["/salary/[operatorId]"],
                    label: "Зарплата операторов",
                    capabilities: [
                        Capability(id: "salary.view", label: "Просмотр зарплат", description: nil, severity: .low, deps: []),
                        Capability(id: "salary.create_advance", label: "Выдать аванс", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.create_payment", label: "Выплатить зарплату", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.create_adjustment", label: "Сделать корректировку (+/-)", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.void_payment", label: "Отменить выплату", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.void_adjustment", label: "Отменить корректировку", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.unlock_week", label: "Разблокировать закрытую неделю", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.update_chat_id", label: "Изменить Telegram ID", description: nil, severity: .medium, deps: []),
                        Capability(id: "salary.add_extra_day", label: "Добавить доп. рабочий день", description: nil, severity: .medium, deps: []),
                        Capability(id: "salary.export", label: "Экспорт PDF", description: nil, severity: .low, deps: []),
                        Capability(id: "salary.mark_debt_paid", label: "Отметить долг оператора оплаченным", description: nil, severity: .high, deps: []),
                        Capability(id: "salary.send_telegram", label: "Отправить расчёт ЗП в Telegram", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "salary-rules",
                    path: "/salary/rules",
                    extraPaths: [],
                    label: "Правила зарплаты",
                    capabilities: [
                        Capability(id: "salary-rules.view", label: "Просмотр правил", description: nil, severity: .low, deps: []),
                        Capability(id: "salary-rules.create", label: "Создать правило", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.edit", label: "Изменить правило", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.delete", label: "Удалить правило", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.upsert_version", label: "Изменить версию правила", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.delete_version", label: "Удалить версию", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.upsert_seniority", label: "Изменить уровень стажа", description: nil, severity: .high, deps: []),
                        Capability(id: "salary-rules.delete_seniority", label: "Удалить уровень стажа", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "structure",
                    path: "/structure",
                    extraPaths: [],
                    label: "Структура подчинения",
                    capabilities: [
                        Capability(id: "structure.view", label: "Просмотр структуры", description: nil, severity: .low, deps: []),
                        Capability(id: "structure.save_assignments", label: "Изменить подчинение", description: nil, severity: .high, deps: []),
                        Capability(id: "structure.drag_drop_reorder", label: "Перетаскивать структуру (drag-and-drop)", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "hr",
                    path: "/hr",
                    extraPaths: [],
                    label: "HR / Кадры",
                    capabilities: [
                        Capability(id: "hr.view", label: "Просмотр кадров", description: nil, severity: .low, deps: []),
                        Capability(id: "hr.dismiss", label: "Уволить сотрудника", description: nil, severity: .high, deps: []),
                        Capability(id: "hr.restore", label: "Восстановить уволенного", description: nil, severity: .high, deps: []),
                        Capability(id: "hr.view_history", label: "Просмотр истории действий", description: nil, severity: .low, deps: []),
                        Capability(id: "hr.export", label: "Экспорт CSV сотрудников", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "operator-analytics",
                    path: "/operator-analytics",
                    extraPaths: [],
                    label: "Аналитика операторов",
                    capabilities: [
                        Capability(id: "operator-analytics.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "operator-analytics.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "operator-achievements",
                    path: "/operator-achievements",
                    extraPaths: [],
                    label: "Достижения операторов",
                    capabilities: [
                        Capability(id: "operator-achievements.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "performance",
                    path: "/performance",
                    extraPaths: [],
                    label: "Эффективность операторов (PI)",
                    capabilities: [
                        Capability(id: "performance.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "performance.export", label: "Экспорт CSV рейтинга", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "operator-tasks",
                    path: "/operator-tasks",
                    extraPaths: [],
                    label: "Задачи операторов",
                    capabilities: [
                        Capability(id: "operator-tasks.view", label: "Просмотр задач", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "operator-lead",
                    path: "/operator-lead",
                    extraPaths: [],
                    label: "Лид операторов",
                    capabilities: [
                        Capability(id: "operator-lead.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "points",
            label: "Точки и оборудование",
            pages: [
                CapabilityPage(
                    id: "point-devices",
                    path: "/point-devices",
                    extraPaths: [],
                    label: "Кассовые устройства",
                    capabilities: [
                        Capability(id: "point-devices.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "point-devices.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "point-devices.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "point-devices.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "point-devices.toggle_active", label: "Включить/отключить устройство", description: nil, severity: .high, deps: []),
                        Capability(id: "point-devices.rotate_token", label: "Сбросить токен устройства", description: nil, severity: .high, deps: []),
                        Capability(id: "point-devices.manage_feature_flags", label: "Управление флагами функций", description: nil, severity: .high, deps: []),
                        Capability(id: "point-devices.reveal_token", label: "Просмотр токена устройства", description: nil, severity: .high, deps: []),
                        Capability(id: "point-devices.copy_token", label: "Копирование токена в буфер", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "stations",
                    path: "/stations/[projectId]",
                    extraPaths: [],
                    label: "PS-станции и игровые проекты",
                    capabilities: [
                        Capability(id: "stations.view", label: "Просмотр станций", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.create_station", label: "Создать станцию", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.edit_station", label: "Изменить станцию", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.delete_station", label: "Удалить станцию", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.edit_theme", label: "Изменить тему оформления", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.create_zone", label: "Создать зону", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.edit_zone", label: "Изменить зону", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.delete_zone", label: "Удалить зону", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.create_decoration", label: "Добавить декорацию", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.delete_decoration", label: "Удалить декорацию", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.create_game_catalog", label: "Добавить игру в каталог", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.edit_game_catalog", label: "Изменить игру", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.delete_game_catalog", label: "Удалить игру", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.bulk_upsert_games", label: "Массовое обновление игр", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.edit_station_game", label: "Изменить игру на станции", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.delete_station_game", label: "Удалить игру со станции", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.create_tariff", label: "Создать тариф", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.edit_tariff", label: "Изменить тариф", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.delete_tariff", label: "Удалить тариф", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.top_up_balance", label: "Пополнить баланс", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.admin_start_session", label: "Принудительно начать сессию", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.admin_end_session", label: "Принудительно завершить сессию", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.rotate_provisioning_key", label: "Сбросить provisioning-ключ", description: nil, severity: .high, deps: []),
                        Capability(id: "stations.update_branding", label: "Изменить брендинг", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.update_map_layout", label: "Изменить карту/раскладку", description: nil, severity: .medium, deps: []),
                        Capability(id: "stations.get_analytics", label: "Просмотр аналитики проекта", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.edit_kiosk_background", label: "Изменить фон киоска", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.edit_kiosk_announcement", label: "Редактировать объявление киоска", description: nil, severity: .low, deps: []),
                        Capability(id: "stations.export_analytics", label: "Экспорт аналитики проекта", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "pos",
            label: "POS и клиенты",
            pages: [
                CapabilityPage(
                    id: "pos",
                    path: "/pos",
                    extraPaths: [],
                    label: "Касса (Web POS)",
                    capabilities: [
                        Capability(id: "pos.view", label: "Открыть кассу", description: nil, severity: .low, deps: []),
                        Capability(id: "pos.sell", label: "Оформить продажу", description: nil, severity: .high, deps: []),
                        Capability(id: "pos.refund", label: "Возврат через кассу", description: nil, severity: .high, deps: []),
                        Capability(id: "pos.discount", label: "Применить скидку", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "pos-receipts",
                    path: "/pos-receipts",
                    extraPaths: [],
                    label: "Чеки",
                    capabilities: [
                        Capability(id: "pos-receipts.view", label: "Просмотр чеков", description: nil, severity: .low, deps: []),
                        Capability(id: "pos-receipts.print", label: "Повторная печать чека", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "pos-returns",
                    path: "/pos-returns",
                    extraPaths: [],
                    label: "Возвраты",
                    capabilities: [
                        Capability(id: "pos-returns.view", label: "Просмотр возвратов", description: nil, severity: .low, deps: []),
                        Capability(id: "pos-returns.return", label: "Оформить возврат", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "customers",
                    path: "/customers",
                    extraPaths: [],
                    label: "Клиенты",
                    capabilities: [
                        Capability(id: "customers.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "customers.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "customers.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "customers.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "customers.export", label: "Выгрузка в Excel/CSV", description: nil, severity: .low, deps: []),
                        Capability(id: "customers.adjust_points", label: "Корректировка бонусов лояльности", description: nil, severity: .high, deps: []),
                        Capability(id: "customers.view_sale_history", label: "Просмотр истории покупок клиента", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "discounts",
                    path: "/discounts",
                    extraPaths: [],
                    label: "Скидки и промокоды",
                    capabilities: [
                        Capability(id: "discounts.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "discounts.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "discounts.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "discounts.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "discounts.generate_promo", label: "Сгенерировать промокод", description: nil, severity: .medium, deps: []),
                        Capability(id: "discounts.copy_promo", label: "Копирование промокода в буфер", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "operations",
            label: "Операционная",
            pages: [
                CapabilityPage(
                    id: "tasks",
                    path: "/tasks",
                    extraPaths: [],
                    label: "Задачи",
                    capabilities: [
                        Capability(id: "tasks.view", label: "Просмотр задач", description: nil, severity: .low, deps: []),
                        Capability(id: "tasks.create", label: "Создать задачу", description: nil, severity: .medium, deps: ["operators.view"]),
                        Capability(id: "tasks.edit", label: "Изменить задачу", description: nil, severity: .medium, deps: []),
                        Capability(id: "tasks.delete", label: "Удалить задачу", description: nil, severity: .high, deps: []),
                        Capability(id: "tasks.complete", label: "Завершить задачу", description: nil, severity: .low, deps: []),
                        Capability(id: "tasks.add_comment", label: "Прокомментировать", description: nil, severity: .low, deps: []),
                        Capability(id: "tasks.respond", label: "Ответить на задачу", description: nil, severity: .low, deps: []),
                        Capability(id: "tasks.assign", label: "Назначить оператору", description: nil, severity: .medium, deps: ["operators.view"]),
                        Capability(id: "tasks.notify", label: "Отправить уведомление по задаче", description: nil, severity: .medium, deps: []),
                        Capability(id: "tasks.bulk_complete", label: "Массовое завершение задач", description: nil, severity: .medium, deps: []),
                        Capability(id: "tasks.bulk_delete", label: "Массовое удаление задач", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "sales-kpi",
                    path: "/sales-kpi",
                    extraPaths: [],
                    label: "Эффективность продавцов",
                    capabilities: [
                        Capability(id: "sales-kpi.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "sales-kpi.manage", label: "Настройка модели и правил допродаж", description: nil, severity: .high, deps: []),
                        Capability(id: "sales-kpi.export", label: "Выгрузка", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "incidents",
                    path: "/incidents",
                    extraPaths: [],
                    label: "Инциденты",
                    capabilities: [
                        Capability(id: "incidents.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "incidents.create", label: "Зарегистрировать инцидент", description: nil, severity: .medium, deps: []),
                        Capability(id: "incidents.update", label: "Обновить инцидент", description: nil, severity: .medium, deps: []),
                        Capability(id: "incidents.close", label: "Закрыть инцидент", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "knowledge-setup",
                    path: "/knowledge-setup",
                    extraPaths: ["/regulations/setup"],
                    label: "Настройка базы знаний",
                    capabilities: [
                        Capability(id: "knowledge-setup.view", label: "Просмотр каркаса и покрытия", description: nil, severity: .low, deps: []),
                        Capability(id: "knowledge-setup.set_industry", label: "Выбрать нишу точки", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-setup.generate", label: "Собрать черновики регламентов через ИИ", description: "Из данных системы или из ответов интервью. Публикует всегда человек", severity: .medium, deps: []),
                        Capability(id: "knowledge-setup.reset", label: "Удалить регламенты и собрать заново", description: "Удаление черновиков, регламентов точки или всей базы организации", severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "operator-exams",
                    path: "/operator-exams",
                    extraPaths: ["/regulations/exams"],
                    label: "Экзамены операторов",
                    capabilities: [
                        Capability(id: "operator-exams.view", label: "Просмотр экзаменов и результатов", description: nil, severity: .low, deps: []),
                        Capability(id: "operator-exams.create", label: "Назначить экзамен и разослать", description: "Генерирует вопросы через ИИ и отправляет операторам в Telegram", severity: .medium, deps: ["operators.view"]),
                        Capability(id: "operator-exams.remind", label: "Напомнить о незавершённом экзамене", description: nil, severity: .low, deps: []),
                        Capability(id: "operator-exams.grade", label: "Переставить балл за развёрнутый ответ", description: "Оценка ИИ — предложение; последнее слово за человеком", severity: .medium, deps: []),
                        Capability(id: "operator-exams.cancel", label: "Завершить или отменить экзамен", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "goals",
                    path: "/goals",
                    extraPaths: [],
                    label: "Цели",
                    capabilities: [
                        Capability(id: "goals.view", label: "Просмотр целей", description: nil, severity: .low, deps: []),
                        Capability(id: "goals.create", label: "Создать цель/KPI-план", description: nil, severity: .medium, deps: []),
                        Capability(id: "goals.delete", label: "Удалить план", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "ratings",
                    path: "/ratings",
                    extraPaths: [],
                    label: "Рейтинги",
                    capabilities: [
                        Capability(id: "ratings.view", label: "Просмотр рейтингов", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "birthdays",
                    path: "/birthdays",
                    extraPaths: [],
                    label: "Дни рождения",
                    capabilities: [
                        Capability(id: "birthdays.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "system",
            label: "Системные",
            pages: [
                CapabilityPage(
                    id: "dashboard",
                    path: "/dashboard",
                    extraPaths: [],
                    label: "Дашборд",
                    capabilities: [
                        Capability(id: "dashboard.view", label: "Просмотр главного экрана", description: nil, severity: .low, deps: []),
                        Capability(id: "dashboard.dismiss_warning", label: "Скрывать предупреждения", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "welcome",
                    path: "/welcome",
                    extraPaths: [],
                    label: "Приветственный экран",
                    capabilities: [
                        Capability(id: "welcome.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "workspace",
                    path: "/workspace",
                    extraPaths: [],
                    label: "Рабочее пространство",
                    capabilities: [
                        Capability(id: "workspace.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "access",
                    path: "/access",
                    extraPaths: [],
                    label: "Управление доступом (роли и права)",
                    capabilities: [
                        Capability(id: "access.view", label: "Просмотр прав доступа", description: nil, severity: .low, deps: []),
                        Capability(id: "access.create_role", label: "Создать роль/должность", description: nil, severity: .high, deps: []),
                        Capability(id: "access.edit_role", label: "Изменить роль/должность", description: nil, severity: .high, deps: []),
                        Capability(id: "access.delete_role", label: "Удалить роль/должность", description: nil, severity: .high, deps: []),
                        Capability(id: "access.toggle_capability", label: "Включить/выключить право для роли", description: nil, severity: .high, deps: []),
                        Capability(id: "access.bulk_capabilities", label: "Массовое управление правами", description: nil, severity: .high, deps: []),
                        Capability(id: "access.manage_user_overrides", label: "Переопределить права для сотрудника", description: nil, severity: .high, deps: []),
                        Capability(id: "access.manage_staff_roles", label: "Назначить роль сотруднику", description: nil, severity: .high, deps: []),
                        Capability(id: "access.change_email", label: "Изменить email сотрудника", description: nil, severity: .high, deps: []),
                        Capability(id: "access.generate_password", label: "Сгенерировать пароль сотрудника", description: nil, severity: .high, deps: []),
                        Capability(id: "access.reveal_password", label: "Просмотр сгенерированного пароля", description: nil, severity: .high, deps: []),
                        Capability(id: "access.invite_staff", label: "Отправить приглашение по email", description: nil, severity: .high, deps: []),
                        Capability(id: "access.reset_to_defaults", label: "Сброс к правам по умолчанию", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "settings",
                    path: "/settings",
                    extraPaths: [],
                    label: "Общие настройки",
                    capabilities: [
                        Capability(id: "settings.view", label: "Просмотр настроек", description: nil, severity: .low, deps: []),
                        Capability(id: "settings.manage_companies", label: "Создание/изменение точек", description: nil, severity: .high, deps: []),
                        Capability(id: "settings.delete_company", label: "Удалить точку", description: nil, severity: .high, deps: []),
                        Capability(id: "settings.manage_categories", label: "Управление категориями расходов", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "telegram",
                    path: "/telegram",
                    extraPaths: [],
                    label: "Telegram-интеграция",
                    capabilities: [
                        Capability(id: "telegram.view", label: "Просмотр настроек", description: nil, severity: .low, deps: []),
                        Capability(id: "telegram.toggle_connection", label: "Включить/отключить бот", description: nil, severity: .high, deps: []),
                        Capability(id: "telegram.add_user", label: "Добавить получателя", description: nil, severity: .medium, deps: []),
                        Capability(id: "telegram.delete_user", label: "Удалить получателя", description: nil, severity: .medium, deps: []),
                        Capability(id: "telegram.toggle_finance", label: "Включить/отключить фин. отчёты", description: nil, severity: .medium, deps: []),
                        Capability(id: "telegram.edit_staff_telegram", label: "Изменить Telegram ID сотрудника", description: nil, severity: .medium, deps: []),
                        Capability(id: "telegram.setup_webhook", label: "Настройка webhook", description: nil, severity: .high, deps: []),
                        Capability(id: "telegram.test_webhook", label: "Тестировать webhook", description: nil, severity: .low, deps: []),
                        Capability(id: "telegram.send_report", label: "Отправить отчёт вручную", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "logs",
                    path: "/logs",
                    extraPaths: [],
                    label: "Журнал событий",
                    capabilities: [
                        Capability(id: "logs.view", label: "Просмотр журнала", description: nil, severity: .low, deps: []),
                        Capability(id: "logs.export", label: "Выгрузка журнала", description: nil, severity: .medium, deps: []),
                        Capability(id: "logs.explain_error", label: "AI-объяснение ошибки", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "categories",
                    path: "/categories",
                    extraPaths: [],
                    label: "Категории расходов",
                    capabilities: [
                        Capability(id: "categories.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "categories.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "categories.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "categories.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "knowledge-admin",
                    path: "/knowledge-admin",
                    extraPaths: ["/regulations"],
                    label: "База знаний (админка)",
                    capabilities: [
                        Capability(id: "knowledge-admin.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "knowledge-admin.create", label: "Создание", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-admin.edit", label: "Изменение", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-admin.delete", label: "Удаление", description: nil, severity: .high, deps: []),
                        Capability(id: "knowledge-admin.publish", label: "Опубликовать статью", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-admin.manage_checklists", label: "Управление чек-листами", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-admin.run_checklist", label: "Запустить чек-лист в смену", description: nil, severity: .medium, deps: []),
                        Capability(id: "knowledge-admin.skip_checklist", label: "Пропустить обязательный чек-лист", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "debug",
                    path: "/debug",
                    extraPaths: [],
                    label: "Диагностика",
                    capabilities: [
                        Capability(id: "debug.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "debug.run_tests", label: "Запуск автотестов", description: nil, severity: .medium, deps: []),
                    ]
                ),
            ]
        ),
        CapabilityGroup(
            id: "more-actions",
            label: "Прочие действия",
            pages: [
                CapabilityPage(
                    id: "production",
                    path: "/production",
                    extraPaths: [],
                    label: "Техкарты (производство)",
                    capabilities: [
                        Capability(id: "production.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "production.create", label: "Создать/изменить техкарту", description: nil, severity: .medium, deps: []),
                        Capability(id: "production.delete", label: "Удалить техкарту", description: nil, severity: .high, deps: []),
                        Capability(id: "production.create_ingredient", label: "Добавить ингредиент", description: nil, severity: .medium, deps: []),
                        Capability(id: "production.delete_ingredient", label: "Удалить ингредиент", description: nil, severity: .high, deps: []),
                        Capability(id: "production.stock_receipt", label: "Приход сырья на склад", description: nil, severity: .medium, deps: []),
                        Capability(id: "production.stock_count", label: "Ревизия остатка сырья", description: nil, severity: .medium, deps: []),
                        Capability(id: "production.writeoff", label: "Списание сырья по продажам", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-advertising",
                    path: "/store/advertising",
                    extraPaths: [],
                    label: "Реклама на витрине",
                    capabilities: [
                        Capability(id: "store-advertising.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-advertising.create", label: "Добавить рекламу", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-advertising.edit", label: "Изменить рекламу", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-advertising.delete", label: "Удалить рекламу", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-purchase-plan",
                    path: "/store/purchase-plan",
                    extraPaths: [],
                    label: "План закупа",
                    capabilities: [
                        Capability(id: "store-purchase-plan.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-purchase-plan.create", label: "Создать/изменить план закупа", description: nil, severity: .medium, deps: []),
                        Capability(id: "store-purchase-plan.ai_advice", label: "AI-совет по закупу", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-settings",
                    path: "/store/settings",
                    extraPaths: [],
                    label: "Настройки магазина",
                    capabilities: [
                        Capability(id: "store-settings.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-settings.edit", label: "Изменить настройки магазина", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "store-shifts",
                    path: "/store/shifts",
                    extraPaths: [],
                    label: "Сменные отчёты (магазин)",
                    capabilities: [
                        Capability(id: "store-shifts.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "store-shifts.export", label: "Экспорт сменных отчётов", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "news",
                    path: "/news",
                    extraPaths: [],
                    label: "Новости",
                    capabilities: [
                        Capability(id: "news.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "news.create", label: "Опубликовать пост", description: nil, severity: .medium, deps: []),
                        Capability(id: "news.delete", label: "Удалить пост", description: nil, severity: .high, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "moderation",
                    path: "/moderation",
                    extraPaths: [],
                    label: "Модерация",
                    capabilities: [
                        Capability(id: "moderation.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "moderation.confirm", label: "Подтвердить нарушение", description: nil, severity: .medium, deps: []),
                        Capability(id: "moderation.dismiss", label: "Отклонить нарушение", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "messages",
                    path: "/messages",
                    extraPaths: [],
                    label: "Личные сообщения",
                    capabilities: [
                        Capability(id: "messages.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "messages.send", label: "Отправить сообщение", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "team-chat",
                    path: "/team-chat",
                    extraPaths: [],
                    label: "Командный чат",
                    capabilities: [
                        Capability(id: "team-chat.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "team-chat.pin", label: "Закрепить сообщение", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "team-analysis",
                    path: "/team-analysis",
                    extraPaths: [],
                    label: "Анализ команды",
                    capabilities: [
                        Capability(id: "team-analysis.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "team-analysis.refresh", label: "Перезапустить AI-анализ", description: nil, severity: .low, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "ai-cfo",
                    path: "/ai-cfo",
                    extraPaths: [],
                    label: "AI Финдиректор",
                    capabilities: [
                        Capability(id: "ai-cfo.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "ai-cfo.generate", label: "Сгенерировать анализ (AI)", description: nil, severity: .medium, deps: []),
                    ]
                ),
                CapabilityPage(
                    id: "expense-analysis",
                    path: "/expense-analysis",
                    extraPaths: [],
                    label: "AI-разбор расходов",
                    capabilities: [
                        Capability(id: "expense-analysis.view", label: "Просмотр", description: nil, severity: .low, deps: []),
                        Capability(id: "expense-analysis.refresh", label: "Перезапустить AI-разбор", description: nil, severity: .low, deps: []),
                    ]
                ),
            ]
        ),
    ]
}
