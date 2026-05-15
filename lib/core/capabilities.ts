/**
 * Каталог всех capabilities (прав на действия) в системе.
 *
 * Архитектура:
 *   Раздел (group) → Страница (page) → Действие (capability)
 *
 * Каждое действие имеет ID вида `<page>.<action>`, например `income.create`.
 *
 * Принципы:
 *   - Один файл = единый источник правды для UI настроек, серверных проверок
 *     и клиентского хука useCapabilities()
 *   - severity показывает «опасность» действия (UI выделяет красным)
 *   - deps — какие другие capabilities нужны автоматически (включаются вместе)
 *
 * Чтобы добавить новое право: добавить в нужную страницу, прогнать TS, миграция
 * автоматически подхватит при следующем синке.
 */

export type CapabilitySeverity = 'low' | 'medium' | 'high'

export type Capability = {
  /** Полный ID, например 'income.create' */
  id: string
  /** Человеческое название действия, например 'Добавить доход' */
  label: string
  /** Расширенное описание (показывается в подсказке UI) */
  description?: string
  /** Уровень опасности (для подсветки в UI) */
  severity?: CapabilitySeverity
  /** Другие capabilities которые нужны автоматически */
  deps?: string[]
}

export type CapabilityPage = {
  /** Технический ID страницы (обычно совпадает с path), например 'income' */
  id: string
  /** Путь страницы (если несколько — основной), например '/income' */
  path: string
  /** Дополнительные пути этой страницы (например, /income/add) */
  extraPaths?: string[]
  /** Человеческое название страницы */
  label: string
  /** Действия на этой странице */
  capabilities: Capability[]
}

export type CapabilityGroup = {
  id: string
  label: string
  pages: CapabilityPage[]
}

// Шаблон стандартных capabilities CRUD
function crud(page: string, opts?: {
  view?: boolean
  create?: boolean
  edit?: boolean
  delete?: boolean
  exportData?: boolean
  importData?: boolean
}): Capability[] {
  const o = { view: true, create: true, edit: true, delete: true, exportData: false, importData: false, ...(opts || {}) }
  const list: Capability[] = []
  if (o.view) list.push({ id: `${page}.view`, label: 'Просмотр', severity: 'low' })
  if (o.create) list.push({ id: `${page}.create`, label: 'Создание', severity: 'medium' })
  if (o.edit) list.push({ id: `${page}.edit`, label: 'Изменение', severity: 'medium' })
  if (o.delete) list.push({ id: `${page}.delete`, label: 'Удаление', severity: 'high' })
  if (o.exportData) list.push({ id: `${page}.export`, label: 'Выгрузка в Excel/CSV', severity: 'low' })
  if (o.importData) list.push({ id: `${page}.import`, label: 'Импорт из файла', severity: 'medium' })
  return list
}

// ────────────────────────────────────────────────────────────────────────────
// Каталог
// ────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  // ── Финансы ──────────────────────────────────────────────────────────────
  {
    id: 'finance',
    label: 'Финансы',
    pages: [
      {
        id: 'income',
        path: '/income',
        extraPaths: ['/income/add', '/income/analytics'],
        label: 'Доходы',
        capabilities: [
          ...crud('income', { exportData: true }),
          { id: 'income.update_online', label: 'Изменить Online-сумму', severity: 'medium' },
          { id: 'income.create_batch', label: 'Массовое добавление', severity: 'high' },
        ],
      },
      {
        id: 'expenses',
        path: '/expenses',
        extraPaths: ['/expenses/add', '/expenses/new', '/expenses/analysis', '/expenses-embed/new', '/expenses-embed/edit'],
        label: 'Расходы',
        capabilities: [
          ...crud('expenses', { exportData: true }),
          { id: 'expenses.manage_templates', label: 'Управление шаблонами', severity: 'medium' },
          { id: 'expenses.import_file', label: 'Загрузка файлов (чеки, фото)', severity: 'medium' },
        ],
      },
      {
        id: 'expenses-pending',
        path: '/expenses/pending',
        label: 'Ожидающие расходы',
        capabilities: [
          { id: 'expenses-pending.view', label: 'Просмотр очереди', severity: 'low' },
          { id: 'expenses-pending.approve', label: 'Одобрить расход', severity: 'high' },
          { id: 'expenses-pending.decline', label: 'Отклонить расход', severity: 'high' },
        ],
      },
      {
        id: 'expense-whitelist',
        path: '/expense-whitelist',
        label: 'Доверенные поставщики',
        capabilities: crud('expense-whitelist', { edit: false }),
      },
      {
        id: 'cashflow',
        path: '/cashflow',
        label: 'Денежные потоки',
        capabilities: [
          { id: 'cashflow.view', label: 'Просмотр прогноза', severity: 'low' },
          { id: 'cashflow.export', label: 'Выгрузка в Excel', severity: 'low' },
          { id: 'cashflow.ai_analysis', label: 'AI-анализ потоков', severity: 'low' },
        ],
      },
      {
        id: 'profitability',
        path: '/profitability',
        label: 'Рентабельность (ОПиУ)',
        capabilities: [
          { id: 'profitability.view', label: 'Просмотр', severity: 'low' },
          { id: 'profitability.edit', label: 'Изменение параметров месяца', severity: 'high' },
          { id: 'profitability.simulate', label: 'What-if симуляция', severity: 'low' },
        ],
      },
      {
        id: 'valuation',
        path: '/valuation',
        label: 'Оценка бизнеса',
        capabilities: [
          { id: 'valuation.view', label: 'Просмотр оценки бизнеса', severity: 'low' },
        ],
      },
      {
        id: 'simulation',
        path: '/simulation',
        label: 'Симуляция выручки',
        capabilities: [
          { id: 'simulation.view', label: 'Просмотр симуляции', severity: 'low' },
          { id: 'simulation.edit', label: 'Редактирование зон и тарифов', severity: 'medium' },
        ],
      },
      {
        id: 'branch-plan',
        path: '/branch-plan',
        label: 'Финмодель новой точки',
        capabilities: [
          { id: 'branch-plan.view', label: 'Просмотр финмодели', severity: 'low' },
          { id: 'branch-plan.edit', label: 'Редактирование/сохранение', severity: 'medium' },
        ],
      },
      {
        id: 'kaspi-terminal',
        path: '/kaspi-terminal',
        label: 'безналичный терминал',
        capabilities: [
          ...crud('kaspi-terminal', { exportData: true }),
          { id: 'kaspi-terminal.reconcile', label: 'Реконсиляция платежей', severity: 'medium' },
        ],
      },
      {
        id: 'weekly-report',
        path: '/weekly-report',
        label: 'Еженедельный отчёт',
        capabilities: [
          { id: 'weekly-report.view', label: 'Просмотр', severity: 'low' },
          { id: 'weekly-report.export', label: 'Выгрузка в Excel', severity: 'low' },
          { id: 'weekly-report.export_pdf', label: 'Выгрузка в PDF', severity: 'low' },
          { id: 'weekly-report.share', label: 'Поделиться отчётом', severity: 'medium' },
          { id: 'weekly-report.ai_generate', label: 'Сгенерировать AI-отчёт', severity: 'medium' },
        ],
      },
      {
        id: 'reports',
        path: '/reports',
        extraPaths: ['/reports/monthly'],
        label: 'Отчёты',
        capabilities: [
          { id: 'reports.view', label: 'Просмотр отчётов', severity: 'low' },
          { id: 'reports.export', label: 'Выгрузка в Excel', severity: 'low' },
        ],
      },
      {
        id: 'forecast',
        path: '/forecast',
        label: 'Прогноз',
        capabilities: [
          { id: 'forecast.view', label: 'Просмотр прогноза', severity: 'low' },
          { id: 'forecast.generate', label: 'Запустить генерацию AI', severity: 'medium' },
          { id: 'forecast.cancel_generation', label: 'Отменить генерацию AI', severity: 'low' },
        ],
      },
      {
        id: 'analytics',
        path: '/analytics',
        label: 'Аналитика',
        capabilities: [
          { id: 'analytics.view', label: 'Просмотр аналитики', severity: 'low' },
          { id: 'analytics.export', label: 'Выгрузка в Excel', severity: 'low' },
        ],
      },
      {
        id: 'analysis',
        path: '/analysis',
        label: 'AI-анализ',
        capabilities: [
          { id: 'analysis.view', label: 'Просмотр анализа', severity: 'low' },
          { id: 'analysis.refresh', label: 'Запустить новый анализ AI', severity: 'medium' },
          { id: 'analysis.export', label: 'Выгрузка результатов', severity: 'low' },
        ],
      },
      {
        id: 'tax',
        path: '/tax',
        label: 'Налоги',
        capabilities: [
          { id: 'tax.view', label: 'Просмотр налоговых данных', severity: 'low' },
        ],
      },
      {
        id: 'point-debts',
        path: '/point-debts',
        label: 'Долги точек',
        capabilities: [
          { id: 'point-debts.view', label: 'Просмотр задолженности', severity: 'low' },
          { id: 'point-debts.mark_paid', label: 'Отметить как оплачено', severity: 'high' },
          { id: 'point-debts.export', label: 'Выгрузка в Excel', severity: 'low' },
        ],
      },
    ],
  },

  // ── Склад ────────────────────────────────────────────────────────────────
  {
    id: 'inventory',
    label: 'Склад и магазин',
    pages: [
      {
        id: 'store',
        path: '/store',
        label: 'Главная склада',
        capabilities: [
          { id: 'store.view', label: 'Просмотр обзора', severity: 'low' },
          { id: 'store.export', label: 'Выгрузка', severity: 'low' },
          { id: 'store.global_search', label: 'Глобальный поиск по складу', severity: 'low' },
        ],
      },
      {
        id: 'store-warehouse',
        path: '/store/warehouse',
        label: 'Склад (остатки)',
        capabilities: [
          { id: 'store-warehouse.view', label: 'Просмотр остатков', severity: 'low' },
          { id: 'store-warehouse.edit', label: 'Корректировка остатков вручную', severity: 'high' },
          { id: 'store-warehouse.create_item', label: 'Создать товар через сканер штрихкода', severity: 'medium' },
          { id: 'store-warehouse.upload_backroom', label: 'Загрузка файла подсобки', severity: 'medium' },
          { id: 'store-warehouse.apply_backroom', label: 'Применить загруженный файл подсобки', severity: 'high' },
          { id: 'store-warehouse.print_labels', label: 'Печать ценников', severity: 'low' },
          { id: 'store-warehouse.delete_selected', label: 'Удалить выбранные товары', severity: 'high' },
          { id: 'store-warehouse.delete_all', label: 'Очистить весь склад', severity: 'high' },
        ],
      },
      {
        id: 'store-showcase',
        path: '/store/showcase',
        label: 'Витрина (point_display)',
        capabilities: [
          { id: 'store-showcase.view', label: 'Просмотр витрины', severity: 'low' },
          { id: 'store-showcase.move', label: 'Перенос со склада на витрину', severity: 'medium' },
          { id: 'store-showcase.return_to_warehouse', label: 'Возврат с витрины на склад', severity: 'medium' },
        ],
      },
      {
        id: 'store-catalog',
        path: '/store/catalog',
        label: 'Каталог товаров',
        capabilities: [
          ...crud('store-catalog', { exportData: true, importData: true }),
          { id: 'store-catalog.bulk_zero_stock', label: 'Массовое обнуление остатков', severity: 'high' },
          { id: 'store-catalog.bulk_deactivate', label: 'Скрыть все товары', severity: 'high' },
          { id: 'store-catalog.bulk_delete_empty', label: 'Удалить товары без остатков', severity: 'high' },
          { id: 'store-catalog.bulk_delete_all', label: 'Удалить весь каталог', severity: 'high' },
        ],
      },
      {
        id: 'store-receipts',
        path: '/store/receipts',
        label: 'Приёмки от поставщиков',
        capabilities: [
          ...crud('store-receipts', { exportData: true }),
          { id: 'store-receipts.cancel', label: 'Отмена проведённой приёмки', severity: 'high' },
          { id: 'store-receipts.ai_parse', label: 'AI-распознавание накладной', severity: 'medium' },
          { id: 'store-receipts.parse_payment_receipt', label: 'AI-распознавание чека об оплате', severity: 'medium' },
          { id: 'store-receipts.apply_template', label: 'Применить шаблон приёмки', severity: 'low' },
          { id: 'store-receipts.save_template', label: 'Сохранить шаблон приёмки', severity: 'low' },
          { id: 'store-receipts.delete_template', label: 'Удалить шаблон приёмки', severity: 'medium' },
          { id: 'store-receipts.bulk_markup', label: 'Применить наценку ко всем позициям', severity: 'medium' },
          { id: 'store-receipts.bulk_sale_price', label: 'Применить цену продажи ко всем позициям', severity: 'medium' },
          { id: 'store-receipts.quick_add_barcode', label: 'Быстрое добавление товара по штрихкоду', severity: 'low' },
        ],
      },
      {
        id: 'store-postings',
        path: '/store/postings',
        label: 'Оприходование',
        capabilities: crud('store-postings'),
      },
      {
        id: 'store-requests',
        path: '/store/requests',
        label: 'Заявки склад → витрина',
        capabilities: [
          { id: 'store-requests.view', label: 'Просмотр заявок', severity: 'low' },
          { id: 'store-requests.create', label: 'Создание заявки', severity: 'medium' },
          { id: 'store-requests.edit', label: 'Изменение количества', severity: 'medium' },
          { id: 'store-requests.approve', label: 'Одобрить заявку', severity: 'medium' },
          { id: 'store-requests.bulk_approve', label: 'Массовое одобрение', severity: 'high' },
          { id: 'store-requests.reject', label: 'Отклонить заявку', severity: 'medium' },
          { id: 'store-requests.bulk_reject', label: 'Массовое отклонение', severity: 'high' },
          { id: 'store-requests.issue', label: 'Выдать товар со склада', severity: 'medium' },
          { id: 'store-requests.receive', label: 'Отметить получение на точке', severity: 'medium' },
          { id: 'store-requests.undecide', label: 'Отозвать одобрение', severity: 'high' },
          { id: 'store-requests.export', label: 'Выгрузка', severity: 'low' },
        ],
      },
      {
        id: 'store-requests-journal',
        path: '/store/requests-journal',
        label: 'Журнал заявок',
        capabilities: [
          { id: 'store-requests-journal.view', label: 'Просмотр истории заявок', severity: 'low' },
          { id: 'store-requests-journal.export', label: 'Выгрузка истории заявок', severity: 'low' },
        ],
      },
      {
        id: 'store-revisions',
        path: '/store/revisions',
        label: 'Ревизии (инвентаризация)',
        capabilities: [
          ...crud('store-revisions', { exportData: true, delete: false }),
          { id: 'store-revisions.commit', label: 'Подтвердить и провести ревизию', severity: 'high' },
          { id: 'store-revisions.cancel', label: 'Отменить ревизию', severity: 'high' },
          { id: 'store-revisions.add_item_barcode', label: 'Добавить товар по штрихкоду', severity: 'low' },
          { id: 'store-revisions.preload_from_balances', label: 'Автозаполнить остатки в форму ревизии', severity: 'medium' },
        ],
      },
      {
        id: 'store-writeoffs',
        path: '/store/writeoffs',
        label: 'Списания товара',
        capabilities: [
          ...crud('store-writeoffs', { exportData: true }),
          { id: 'store-writeoffs.cancel', label: 'Отменить списание', severity: 'high' },
          { id: 'store-writeoffs.apply_template', label: 'Применить шаблон списания', severity: 'low' },
          { id: 'store-writeoffs.save_template', label: 'Сохранить шаблон списания', severity: 'low' },
          { id: 'store-writeoffs.quick_add_barcode', label: 'Быстрое добавление товара по штрихкоду', severity: 'low' },
        ],
      },
      {
        id: 'store-suppliers',
        path: '/store/suppliers',
        extraPaths: ['/store/suppliers/[id]'],
        label: 'Поставщики',
        capabilities: [
          ...crud('store-suppliers', { delete: false }),
          { id: 'store-suppliers.add_alias', label: 'Добавить алиас товара поставщика', severity: 'medium' },
          { id: 'store-suppliers.delete_alias', label: 'Удалить алиас товара', severity: 'medium' },
        ],
      },
      {
        id: 'store-purchase-orders',
        path: '/store/purchase-orders',
        label: 'Заявки поставщикам',
        capabilities: [
          ...crud('store-purchase-orders', { delete: false }),
          { id: 'store-purchase-orders.send', label: 'Отправить заявку поставщику', severity: 'medium' },
          { id: 'store-purchase-orders.cancel', label: 'Отменить заявку поставщику', severity: 'medium' },
        ],
      },
      {
        id: 'store-receipt-settings',
        path: '/store/receipt-settings',
        label: 'Реквизиты чека ККМ',
        capabilities: [
          { id: 'store-receipt-settings.view', label: 'Просмотр реквизитов чека', severity: 'low' },
          { id: 'store-receipt-settings.edit', label: 'Изменение реквизитов чека', severity: 'high' },
        ],
      },
      {
        id: 'store-consumables',
        path: '/store/consumables',
        label: 'Расходники',
        capabilities: [
          { id: 'store-consumables.view', label: 'Просмотр', severity: 'low' },
          { id: 'store-consumables.create', label: 'Добавить расходник', severity: 'medium' },
          { id: 'store-consumables.edit', label: 'Изменить норму расхода', severity: 'medium' },
          { id: 'store-consumables.issue', label: 'Записать выдачу', severity: 'medium' },
        ],
      },
      {
        id: 'store-movements',
        path: '/store/movements',
        label: 'Движения товара',
        capabilities: [
          { id: 'store-movements.view', label: 'Просмотр истории', severity: 'low' },
          { id: 'store-movements.create', label: 'Создать перемещение', severity: 'medium' },
        ],
      },
      {
        id: 'store-forecast',
        path: '/store/forecast',
        label: 'Прогноз потребности',
        capabilities: [
          { id: 'store-forecast.view', label: 'Просмотр', severity: 'low' },
        ],
      },
      {
        id: 'store-analytics',
        path: '/store/analytics',
        extraPaths: ['/store/abc'],
        label: 'Аналитика склада + ABC',
        capabilities: [
          { id: 'store-analytics.view', label: 'Просмотр аналитики', severity: 'low' },
          { id: 'store-analytics.export', label: 'Выгрузка', severity: 'low' },
          { id: 'store-analytics.edit_sale_price', label: 'Изменить цену продажи', severity: 'medium' },
        ],
      },
      {
        id: 'store-billing',
        path: '/store/billing',
        label: 'Биллинг и долги поставщикам',
        capabilities: [
          { id: 'store-billing.view', label: 'Просмотр счетов и долгов', severity: 'low' },
          { id: 'store-billing.pay_debt', label: 'Оплатить долг поставщику', severity: 'high' },
          { id: 'store-billing.write_off_debt', label: 'Списать долг (без оплаты)', severity: 'high' },
          { id: 'store-billing.bulk_pay', label: 'Массовая оплата долгов', severity: 'high' },
          { id: 'store-billing.reschedule_debt', label: 'Перенести срок оплаты долга', severity: 'medium' },
          { id: 'store-billing.parse_receipt', label: 'AI-распознавание чека/счёта', severity: 'medium' },
          { id: 'store-billing.export', label: 'Выгрузка долгов в Excel', severity: 'low' },
        ],
      },
    ],
  },

  // ── Смены ────────────────────────────────────────────────────────────────
  {
    id: 'shifts',
    label: 'Смены',
    pages: [
      {
        id: 'shifts',
        path: '/shifts',
        extraPaths: ['/shifts/add', '/shifts/report'],
        label: 'Смены (расписание)',
        capabilities: [
          { id: 'shifts.view', label: 'Просмотр графика', severity: 'low' },
          { id: 'shifts.create', label: 'Создать смену', severity: 'medium' },
          { id: 'shifts.edit', label: 'Изменить смену', severity: 'medium' },
          { id: 'shifts.delete', label: 'Удалить смену', severity: 'high' },
          { id: 'shifts.copy_week', label: 'Копировать неделю', severity: 'medium' },
          { id: 'shifts.bulk_assign_week', label: 'Массовое назначение на неделю', severity: 'medium' },
          { id: 'shifts.publish_week', label: 'Опубликовать график', severity: 'medium' },
          { id: 'shifts.resolve_issue', label: 'Решить конфликт смен', severity: 'medium' },
          { id: 'shifts.export', label: 'Выгрузка', severity: 'low' },
        ],
      },
      {
        id: 'shifts-reports',
        path: '/shifts/reports',
        extraPaths: ['/shifts/reports/[id]'],
        label: 'Отчёты смен',
        capabilities: [
          { id: 'shifts-reports.view', label: 'Просмотр отчётов', severity: 'low' },
          { id: 'shifts-reports.export', label: 'Выгрузка', severity: 'low' },
          { id: 'shifts-reports.close_force', label: 'Принудительно закрыть смену', severity: 'high' },
          { id: 'shifts-reports.purge', label: 'Полная очистка данных смены', severity: 'high' },
          { id: 'shifts-reports.reopen', label: 'Переоткрыть смену', severity: 'high' },
        ],
      },
    ],
  },

  // ── Персонал ─────────────────────────────────────────────────────────────
  {
    id: 'staff',
    label: 'Персонал',
    pages: [
      {
        id: 'operators',
        path: '/operators',
        extraPaths: ['/operators/[id]/profile'],
        label: 'Операторы',
        capabilities: [
          ...crud('operators'),
          { id: 'operators.toggle_active', label: 'Активировать/деактивировать', severity: 'medium' },
          { id: 'operators.bulk_delete', label: 'Массовое удаление', severity: 'high' },
          { id: 'operators.promote', label: 'Повысить в должности', severity: 'medium' },
          { id: 'operators.save_assignments', label: 'Изменить назначения на точки', severity: 'medium' },
          { id: 'operators.avatar_upload', label: 'Загрузить фото оператора', severity: 'low' },
          { id: 'operators.document_upload', label: 'Загрузить документы оператора', severity: 'medium' },
          { id: 'operators.create_account', label: 'Создать учётную запись', severity: 'high' },
          { id: 'operators.reset_password', label: 'Сбросить пароль', severity: 'high' },
          { id: 'operators.edit_login', label: 'Изменить логин', severity: 'high' },
          { id: 'operators.send_credentials_telegram', label: 'Отправить логин/пароль в Telegram', severity: 'high' },
          { id: 'operators.bulk_send_credentials_telegram', label: 'Массовая отправка credentials в Telegram', severity: 'high' },
          { id: 'operators.export_credentials', label: 'Выгрузить логины и пароли в Excel', severity: 'high' },
          { id: 'operators.copy_profile_data', label: 'Копирование данных оператора в буфер', severity: 'low' },
        ],
      },
      {
        id: 'staff',
        path: '/staff',
        label: 'Сотрудники',
        capabilities: [
          ...crud('staff'),
          { id: 'staff.invite', label: 'Пригласить сотрудника', severity: 'high' },
          { id: 'staff.toggle_status', label: 'Активировать/деактивировать', severity: 'high' },
          { id: 'staff.create_payment', label: 'Записать выплату', severity: 'high' },
          { id: 'staff.add_adjustment', label: 'Сделать корректировку зарплаты', severity: 'high' },
          { id: 'staff.add_extra_day', label: 'Добавить доп. рабочий день', severity: 'medium' },
          { id: 'staff.reset_password', label: 'Сбросить пароль сотрудника', severity: 'high' },
        ],
      },
      {
        id: 'pass',
        path: '/pass',
        label: 'Пропуска',
        capabilities: [
          { id: 'pass.view', label: 'Просмотр пропусков', severity: 'low' },
          { id: 'pass.export_csv', label: 'Выгрузка списка в CSV', severity: 'high' },
          { id: 'pass.copy_credentials', label: 'Копирование логина/пароля в буфер', severity: 'high' },
        ],
      },
      {
        id: 'salary',
        path: '/salary',
        extraPaths: ['/salary/[operatorId]'],
        label: 'Зарплата операторов',
        capabilities: [
          { id: 'salary.view', label: 'Просмотр зарплат', severity: 'low' },
          { id: 'salary.create_advance', label: 'Выдать аванс', severity: 'high' },
          { id: 'salary.create_payment', label: 'Выплатить зарплату', severity: 'high' },
          { id: 'salary.create_adjustment', label: 'Сделать корректировку (+/-)', severity: 'high' },
          { id: 'salary.void_payment', label: 'Отменить выплату', severity: 'high' },
          { id: 'salary.void_adjustment', label: 'Отменить корректировку', severity: 'high' },
          { id: 'salary.unlock_week', label: 'Разблокировать закрытую неделю', severity: 'high' },
          { id: 'salary.update_chat_id', label: 'Изменить Telegram ID', severity: 'medium' },
          { id: 'salary.add_extra_day', label: 'Добавить доп. рабочий день', severity: 'medium' },
        ],
      },
      {
        id: 'salary-rules',
        path: '/salary/rules',
        label: 'Правила зарплаты',
        capabilities: [
          { id: 'salary-rules.view', label: 'Просмотр правил', severity: 'low' },
          { id: 'salary-rules.create', label: 'Создать правило', severity: 'high' },
          { id: 'salary-rules.edit', label: 'Изменить правило', severity: 'high' },
          { id: 'salary-rules.delete', label: 'Удалить правило', severity: 'high' },
          { id: 'salary-rules.upsert_version', label: 'Изменить версию правила', severity: 'high' },
          { id: 'salary-rules.delete_version', label: 'Удалить версию', severity: 'high' },
          { id: 'salary-rules.upsert_seniority', label: 'Изменить уровень стажа', severity: 'high' },
          { id: 'salary-rules.delete_seniority', label: 'Удалить уровень стажа', severity: 'high' },
        ],
      },
      {
        id: 'structure',
        path: '/structure',
        label: 'Структура подчинения',
        capabilities: [
          { id: 'structure.view', label: 'Просмотр структуры', severity: 'low' },
          { id: 'structure.save_assignments', label: 'Изменить подчинение', severity: 'high' },
          { id: 'structure.drag_drop_reorder', label: 'Перетаскивать структуру (drag-and-drop)', severity: 'medium' },
        ],
      },
      {
        id: 'hr',
        path: '/hr',
        label: 'HR / Кадры',
        capabilities: [
          { id: 'hr.view', label: 'Просмотр кадров', severity: 'low' },
          { id: 'hr.dismiss', label: 'Уволить сотрудника', severity: 'high' },
          { id: 'hr.restore', label: 'Восстановить уволенного', severity: 'high' },
          { id: 'hr.view_history', label: 'Просмотр истории действий', severity: 'low' },
        ],
      },
      {
        id: 'operator-analytics',
        path: '/operator-analytics',
        label: 'Аналитика операторов',
        capabilities: [
          { id: 'operator-analytics.view', label: 'Просмотр', severity: 'low' },
          { id: 'operator-analytics.export', label: 'Выгрузка', severity: 'low' },
        ],
      },
      {
        id: 'operator-achievements',
        path: '/operator-achievements',
        label: 'Достижения операторов',
        capabilities: [
          { id: 'operator-achievements.view', label: 'Просмотр', severity: 'low' },
        ],
      },
      {
        id: 'performance',
        path: '/performance',
        label: 'Эффективность операторов (PI)',
        capabilities: [
          { id: 'performance.view', label: 'Просмотр', severity: 'low' },
        ],
      },
      {
        id: 'operator-tasks',
        path: '/operator-tasks',
        label: 'Задачи операторов',
        capabilities: [
          { id: 'operator-tasks.view', label: 'Просмотр задач', severity: 'low' },
        ],
      },
      {
        id: 'operator-lead',
        path: '/operator-lead',
        label: 'Лид операторов',
        capabilities: [
          { id: 'operator-lead.view', label: 'Просмотр', severity: 'low' },
        ],
      },
    ],
  },

  // ── Точки и оборудование ─────────────────────────────────────────────────
  {
    id: 'points',
    label: 'Точки и оборудование',
    pages: [
      {
        id: 'point-devices',
        path: '/point-devices',
        label: 'Кассовые устройства',
        capabilities: [
          ...crud('point-devices'),
          { id: 'point-devices.toggle_active', label: 'Включить/отключить устройство', severity: 'high' },
          { id: 'point-devices.rotate_token', label: 'Сбросить токен устройства', severity: 'high' },
          { id: 'point-devices.manage_feature_flags', label: 'Управление флагами функций', severity: 'high' },
          { id: 'point-devices.reveal_token', label: 'Просмотр токена устройства', severity: 'high' },
          { id: 'point-devices.copy_token', label: 'Копирование токена в буфер', severity: 'medium' },
        ],
      },
      {
        id: 'stations',
        path: '/stations/[projectId]',
        label: 'PS-станции и игровые проекты',
        capabilities: [
          { id: 'stations.view', label: 'Просмотр станций', severity: 'low' },
          { id: 'stations.create_station', label: 'Создать станцию', severity: 'medium' },
          { id: 'stations.edit_station', label: 'Изменить станцию', severity: 'medium' },
          { id: 'stations.delete_station', label: 'Удалить станцию', severity: 'high' },
          { id: 'stations.edit_theme', label: 'Изменить тему оформления', severity: 'low' },
          { id: 'stations.create_zone', label: 'Создать зону', severity: 'medium' },
          { id: 'stations.edit_zone', label: 'Изменить зону', severity: 'medium' },
          { id: 'stations.delete_zone', label: 'Удалить зону', severity: 'high' },
          { id: 'stations.create_decoration', label: 'Добавить декорацию', severity: 'low' },
          { id: 'stations.delete_decoration', label: 'Удалить декорацию', severity: 'low' },
          { id: 'stations.create_game_catalog', label: 'Добавить игру в каталог', severity: 'medium' },
          { id: 'stations.edit_game_catalog', label: 'Изменить игру', severity: 'medium' },
          { id: 'stations.delete_game_catalog', label: 'Удалить игру', severity: 'high' },
          { id: 'stations.bulk_upsert_games', label: 'Массовое обновление игр', severity: 'high' },
          { id: 'stations.edit_station_game', label: 'Изменить игру на станции', severity: 'medium' },
          { id: 'stations.delete_station_game', label: 'Удалить игру со станции', severity: 'medium' },
          { id: 'stations.create_tariff', label: 'Создать тариф', severity: 'high' },
          { id: 'stations.edit_tariff', label: 'Изменить тариф', severity: 'high' },
          { id: 'stations.delete_tariff', label: 'Удалить тариф', severity: 'high' },
          { id: 'stations.top_up_balance', label: 'Пополнить баланс', severity: 'high' },
          { id: 'stations.admin_start_session', label: 'Принудительно начать сессию', severity: 'high' },
          { id: 'stations.admin_end_session', label: 'Принудительно завершить сессию', severity: 'high' },
          { id: 'stations.rotate_provisioning_key', label: 'Сбросить provisioning-ключ', severity: 'high' },
          { id: 'stations.update_branding', label: 'Изменить брендинг', severity: 'medium' },
          { id: 'stations.update_map_layout', label: 'Изменить карту/раскладку', severity: 'medium' },
          { id: 'stations.get_analytics', label: 'Просмотр аналитики проекта', severity: 'low' },
          { id: 'stations.edit_kiosk_background', label: 'Изменить фон киоска', severity: 'low' },
          { id: 'stations.edit_kiosk_announcement', label: 'Редактировать объявление киоска', severity: 'low' },
        ],
      },
    ],
  },

  // ── POS и клиенты ────────────────────────────────────────────────────────
  {
    id: 'pos',
    label: 'POS и клиенты',
    pages: [
      {
        id: 'pos',
        path: '/pos',
        label: 'Касса (Web POS)',
        capabilities: [
          { id: 'pos.view', label: 'Открыть кассу', severity: 'low' },
          { id: 'pos.sell', label: 'Оформить продажу', severity: 'high' },
          { id: 'pos.refund', label: 'Возврат через кассу', severity: 'high' },
          { id: 'pos.discount', label: 'Применить скидку', severity: 'medium' },
        ],
      },
      {
        id: 'pos-receipts',
        path: '/pos-receipts',
        label: 'Чеки',
        capabilities: [
          { id: 'pos-receipts.view', label: 'Просмотр чеков', severity: 'low' },
          { id: 'pos-receipts.print', label: 'Повторная печать чека', severity: 'low' },
        ],
      },
      {
        id: 'pos-returns',
        path: '/pos-returns',
        label: 'Возвраты',
        capabilities: [
          { id: 'pos-returns.view', label: 'Просмотр возвратов', severity: 'low' },
          { id: 'pos-returns.return', label: 'Оформить возврат', severity: 'high' },
        ],
      },
      {
        id: 'customers',
        path: '/customers',
        label: 'Клиенты',
        capabilities: [
          ...crud('customers', { exportData: true }),
          { id: 'customers.adjust_points', label: 'Корректировка бонусов лояльности', severity: 'high' },
          { id: 'customers.view_sale_history', label: 'Просмотр истории покупок клиента', severity: 'low' },
        ],
      },
      {
        id: 'discounts',
        path: '/discounts',
        label: 'Скидки и промокоды',
        capabilities: [
          ...crud('discounts'),
          { id: 'discounts.generate_promo', label: 'Сгенерировать промокод', severity: 'medium' },
          { id: 'discounts.copy_promo', label: 'Копирование промокода в буфер', severity: 'low' },
        ],
      },
    ],
  },

  // ── Операционка ──────────────────────────────────────────────────────────
  {
    id: 'operations',
    label: 'Операционная',
    pages: [
      {
        id: 'tasks',
        path: '/tasks',
        label: 'Задачи',
        capabilities: [
          { id: 'tasks.view', label: 'Просмотр задач', severity: 'low' },
          { id: 'tasks.create', label: 'Создать задачу', severity: 'medium', deps: ['operators.view'] },
          { id: 'tasks.edit', label: 'Изменить задачу', severity: 'medium' },
          { id: 'tasks.delete', label: 'Удалить задачу', severity: 'high' },
          { id: 'tasks.complete', label: 'Завершить задачу', severity: 'low' },
          { id: 'tasks.add_comment', label: 'Прокомментировать', severity: 'low' },
          { id: 'tasks.respond', label: 'Ответить на задачу', severity: 'low' },
          { id: 'tasks.assign', label: 'Назначить оператору', severity: 'medium', deps: ['operators.view'] },
          { id: 'tasks.notify', label: 'Отправить уведомление по задаче', severity: 'medium' },
          { id: 'tasks.bulk_complete', label: 'Массовое завершение задач', severity: 'medium' },
          { id: 'tasks.bulk_delete', label: 'Массовое удаление задач', severity: 'high' },
        ],
      },
      {
        id: 'incidents',
        path: '/incidents',
        label: 'Инциденты',
        capabilities: [
          { id: 'incidents.view', label: 'Просмотр', severity: 'low' },
          { id: 'incidents.create', label: 'Зарегистрировать инцидент', severity: 'medium' },
          { id: 'incidents.update', label: 'Обновить инцидент', severity: 'medium' },
          { id: 'incidents.close', label: 'Закрыть инцидент', severity: 'medium' },
        ],
      },
      {
        id: 'kpi',
        path: '/kpi',
        extraPaths: ['/kpi/plans'],
        label: 'KPI и планы',
        capabilities: [
          { id: 'kpi.view', label: 'Просмотр KPI', severity: 'low' },
          { id: 'kpi.generate_collective_plans', label: 'Сгенерировать коллективные планы', severity: 'high' },
        ],
      },
      {
        id: 'goals',
        path: '/goals',
        label: 'Цели',
        capabilities: [
          { id: 'goals.view', label: 'Просмотр целей', severity: 'low' },
        ],
      },
      {
        id: 'ratings',
        path: '/ratings',
        label: 'Рейтинги',
        capabilities: [
          { id: 'ratings.view', label: 'Просмотр рейтингов', severity: 'low' },
        ],
      },
      {
        id: 'birthdays',
        path: '/birthdays',
        label: 'Дни рождения',
        capabilities: [
          { id: 'birthdays.view', label: 'Просмотр', severity: 'low' },
        ],
      },
    ],
  },

  // ── Системные ────────────────────────────────────────────────────────────
  {
    id: 'system',
    label: 'Системные',
    pages: [
      {
        id: 'dashboard',
        path: '/dashboard',
        label: 'Дашборд',
        capabilities: [
          { id: 'dashboard.view', label: 'Просмотр главного экрана', severity: 'low' },
          { id: 'dashboard.dismiss_warning', label: 'Скрывать предупреждения', severity: 'low' },
        ],
      },
      {
        id: 'welcome',
        path: '/welcome',
        label: 'Приветственный экран',
        capabilities: [
          { id: 'welcome.view', label: 'Просмотр', severity: 'low' },
        ],
      },
      {
        id: 'workspace',
        path: '/workspace',
        label: 'Рабочее пространство',
        capabilities: [
          { id: 'workspace.view', label: 'Просмотр', severity: 'low' },
        ],
      },
      {
        id: 'access',
        path: '/access',
        label: 'Управление доступом (роли и права)',
        capabilities: [
          { id: 'access.view', label: 'Просмотр прав доступа', severity: 'low' },
          { id: 'access.create_role', label: 'Создать роль/должность', severity: 'high' },
          { id: 'access.edit_role', label: 'Изменить роль/должность', severity: 'high' },
          { id: 'access.delete_role', label: 'Удалить роль/должность', severity: 'high' },
          { id: 'access.toggle_capability', label: 'Включить/выключить право для роли', severity: 'high' },
          { id: 'access.bulk_capabilities', label: 'Массовое управление правами', severity: 'high' },
          { id: 'access.manage_user_overrides', label: 'Переопределить права для сотрудника', severity: 'high' },
          { id: 'access.manage_staff_roles', label: 'Назначить роль сотруднику', severity: 'high' },
          { id: 'access.change_email', label: 'Изменить email сотрудника', severity: 'high' },
          { id: 'access.generate_password', label: 'Сгенерировать пароль сотрудника', severity: 'high' },
          { id: 'access.reveal_password', label: 'Просмотр сгенерированного пароля', severity: 'high' },
          { id: 'access.invite_staff', label: 'Отправить приглашение по email', severity: 'high' },
          { id: 'access.reset_to_defaults', label: 'Сброс к правам по умолчанию', severity: 'high' },
        ],
      },
      {
        id: 'settings',
        path: '/settings',
        label: 'Общие настройки',
        capabilities: [
          { id: 'settings.view', label: 'Просмотр настроек', severity: 'low' },
          { id: 'settings.manage_companies', label: 'Создание/изменение точек', severity: 'high' },
          { id: 'settings.delete_company', label: 'Удалить точку', severity: 'high' },
          { id: 'settings.manage_categories', label: 'Управление категориями расходов', severity: 'medium' },
        ],
      },
      {
        id: 'telegram',
        path: '/telegram',
        label: 'Telegram-интеграция',
        capabilities: [
          { id: 'telegram.view', label: 'Просмотр настроек', severity: 'low' },
          { id: 'telegram.toggle_connection', label: 'Включить/отключить бот', severity: 'high' },
          { id: 'telegram.add_user', label: 'Добавить получателя', severity: 'medium' },
          { id: 'telegram.delete_user', label: 'Удалить получателя', severity: 'medium' },
          { id: 'telegram.toggle_finance', label: 'Включить/отключить фин. отчёты', severity: 'medium' },
          { id: 'telegram.edit_staff_telegram', label: 'Изменить Telegram ID сотрудника', severity: 'medium' },
          { id: 'telegram.setup_webhook', label: 'Настройка webhook', severity: 'high' },
          { id: 'telegram.test_webhook', label: 'Тестировать webhook', severity: 'low' },
          { id: 'telegram.send_report', label: 'Отправить отчёт вручную', severity: 'medium' },
        ],
      },
      {
        id: 'logs',
        path: '/logs',
        label: 'Журнал событий',
        capabilities: [
          { id: 'logs.view', label: 'Просмотр журнала', severity: 'low' },
          { id: 'logs.export', label: 'Выгрузка журнала', severity: 'medium' },
        ],
      },
      {
        id: 'shift-telegram-audit',
        path: '/shift-telegram-audit',
        label: 'Аудит смен в Telegram',
        capabilities: [
          { id: 'shift-telegram-audit.view', label: 'Просмотр аудита', severity: 'low' },
        ],
      },
      {
        id: 'categories',
        path: '/categories',
        label: 'Категории расходов',
        capabilities: crud('categories'),
      },
      {
        id: 'knowledge-admin',
        path: '/knowledge-admin',
        label: 'База знаний (админка)',
        capabilities: [
          ...crud('knowledge-admin'),
          { id: 'knowledge-admin.publish', label: 'Опубликовать статью', severity: 'medium' },
          { id: 'knowledge-admin.manage_checklists', label: 'Управление чек-листами', severity: 'medium' },
          { id: 'knowledge-admin.run_checklist', label: 'Запустить чек-лист в смену', severity: 'medium' },
          { id: 'knowledge-admin.skip_checklist', label: 'Пропустить обязательный чек-лист', severity: 'high' },
        ],
      },
      {
        id: 'debug',
        path: '/debug',
        label: 'Диагностика',
        capabilities: [
          { id: 'debug.view', label: 'Просмотр', severity: 'low' },
          { id: 'debug.run_tests', label: 'Запуск автотестов', severity: 'medium' },
        ],
      },
    ],
  },
]

// ────────────────────────────────────────────────────────────────────────────
// Утилиты
// ────────────────────────────────────────────────────────────────────────────

/** Список всех capability ID — для сидов в БД и проверок */
export function getAllCapabilityIds(): string[] {
  const ids: string[] = []
  for (const group of CAPABILITY_GROUPS) {
    for (const page of group.pages) {
      for (const cap of page.capabilities) {
        ids.push(cap.id)
      }
    }
  }
  return ids
}

/** Найти capability по ID */
export function findCapability(id: string): Capability | null {
  for (const group of CAPABILITY_GROUPS) {
    for (const page of group.pages) {
      for (const cap of page.capabilities) {
        if (cap.id === id) return cap
      }
    }
  }
  return null
}

/** Найти страницу по ID или пути. Query string и hash отрезаются. */
export function findCapabilityPageByPath(pathname: string): CapabilityPage | null {
  // Убираем ?query и #hash чтобы '/operator-analytics?tab=achievements'
  // матчился с '/operator-analytics' в каталоге.
  pathname = pathname.split('?')[0].split('#')[0]
  for (const group of CAPABILITY_GROUPS) {
    for (const page of group.pages) {
      if (page.path === pathname) return page
      if (page.extraPaths?.some((p) => p === pathname)) return page
    }
  }
  return null
}

/** Получить все зависимые capabilities (рекурсивно), включая исходную */
export function expandCapabilityDeps(id: string, visited = new Set<string>()): string[] {
  if (visited.has(id)) return []
  visited.add(id)
  const cap = findCapability(id)
  if (!cap) return [id]
  const result = [id]
  for (const dep of cap.deps || []) {
    result.push(...expandCapabilityDeps(dep, visited))
  }
  return result
}

/** Сводка для UI: сколько групп / страниц / capabilities */
export function getCapabilitiesSummary() {
  const groups = CAPABILITY_GROUPS.length
  let pages = 0
  let capabilities = 0
  for (const group of CAPABILITY_GROUPS) {
    pages += group.pages.length
    for (const page of group.pages) {
      capabilities += page.capabilities.length
    }
  }
  return { groups, pages, capabilities }
}
