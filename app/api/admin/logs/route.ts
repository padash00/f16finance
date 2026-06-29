import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type AuditRow = {
  id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  payload: Record<string, unknown> | null
  created_at: string
}

type NotificationRow = {
  id: string
  channel: string
  recipient: string
  status: string
  payload: Record<string, unknown> | null
  created_at: string
}

type AiUsageRow = {
  id: string
  created_at: string
  user_id: string | null
  endpoint: string
  provider: string
  model: string
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost_estimate: number | null
  status: string
  error: string | null
  payload: Record<string, unknown> | null
}

type CombinedLogItem = {
  id: string
  kind: 'audit' | 'notification' | 'ai'
  createdAt: string
  title: string
  subtitle: string | null
  details: string | null
  detailRows: string[]
  entityType: string | null
  action: string | null
  actorUserId: string | null
  actorEmail: string | null
  channel: string | null
  status: string | null
  recipient: string | null
  payload: Record<string, unknown> | null
}

const ENTITY_LABELS: Record<string, string> = {
  income: 'доход',
  expense: 'расход',
  company: 'компанию',
  staff: 'сотрудника',
  operator: 'оператора',
  expense_category: 'категорию расходов',
  'expense-whitelist': 'белый список расходов',
  'expense-wizard': 'мастер расходов',
  'expense-approval': 'заявку расхода',
  'profitability-input': 'ОПиУ',
  kaspi_terminal: 'Безналичный терминал',
  'operator-salary-adjustment': 'корректировку зарплаты',
  'staff-payment': 'выплату зарплаты',
  salary_payment: 'выплату зарплаты',
  'auth-attempt': 'вход в систему',
  'auth-session': 'сессию',
  'system-error': 'ошибку системы',
  task: 'задачу',
  'task-comment': 'комментарий к задаче',
  shift: 'смену',
  'point-shift-report': 'отчет смены',
  'point-shift': 'смену точки',
  'point-device': 'устройство точки',
  'point-debt': 'долг точки',
  'point-debt-item': 'товар в долг точки',
  'point-product': 'товар точки',
  'point-incident': 'инцидент точки',
  'inventory-item': 'товар склада',
  'inventory-receipt': 'приемку склада',
  'inventory-receipt-draft': 'черновик приемки',
  'inventory-request': 'заявку склада',
  'inventory-return': 'возврат склада',
  'inventory-sale': 'продажу склада',
  'inventory-writeoff': 'списание склада',
  'supplier-debt': 'долг поставщика',
  'ai-usage': 'AI запрос',
  'operator-company-assignment': 'назначение в компанию',
  'operator-career': 'карьеру оператора',
  visit: 'посещение',
  'page-view': 'страницу',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'добавил',
  'create-batch': 'добавил пачкой',
  update: 'изменил',
  'update-online': 'обновил Online сумму',
  delete: 'удалил',
  upsert: 'сохранил',
  approve: 'одобрил',
  approved: 'одобрил',
  decline: 'отклонил',
  declined: 'отклонил',
  dismiss: 'уволил',
  restore: 'восстановил',
  bootstrap: 'подключил',
  open: 'открыл',
  close: 'закрыл',
  handover: 'передал',
  complete: 'завершил',
  login: 'вошел в систему',
  logout: 'вышел из системы',
  failed: 'получил ошибку',
  error: 'получил ошибку',
  'server-error': 'получил ошибку сервера',
  visit: 'открыл',
  'page-view': 'открыл',
  'point-debt-notify': 'уведомил о долге точки',
  notification: 'отправил уведомление',
}

function actorName(email: string | null) {
  if (!email) return 'Система'
  return email.split('@')[0] || email
}

function text(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function money(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return ''
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸`
}

function dateLabel(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  try {
    return new Date(`${raw}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return raw
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' · ')
}

const MONEY_DETAIL_LABELS = new Set(['Наличные', 'Безналичный', 'Online', 'Карта', 'Итого', 'Сумма', 'Цена за единицу', 'Стоимость', 'Старт кассы', 'Монеты', 'Долги', 'Wipon', 'Расхождение'])

const VALUE_LABELS: Record<string, string> = {
  success: 'успешно',
  sent: 'отправлено',
  delivered: 'доставлено',
  failed: 'ошибка',
  error: 'ошибка',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ai: 'ИИ',
  'client-navigation': 'переход по сайту',
  'react-error-boundary': 'ошибка React-интерфейса',
  'unhandledrejection': 'необработанная ошибка браузера',
  'point-debt-notify': 'уведомление о долге точки',
  'point-debt-item': 'товар в долг точки',
}

const PAGE_LABELS: Record<string, string> = {
  '': 'Главная',
  '/': 'Главная',
  '/logs': 'Логи',
  '/weekly-report': 'Еженедельный отчет',
  '/store/receipts': 'Приемка склада',
  '/store/warehouse': 'Склад',
  '/store/movements': 'Движения склада',
  '/store/requests': 'Заявки склада',
  '/store/writeoffs': 'Списания склада',
  '/store/revisions': 'Ревизии склада',
  '/store/showcase': 'Витрина',
  '/point-debts': 'Долги точки',
  '/income': 'Доходы',
  '/expenses': 'Расходы',
  '/reports': 'Отчеты',
  '/profitability': 'Рентабельность',
  '/settings': 'Настройки',
  '/operators': 'Операторы',
  '/salary': 'Зарплата',
  '/tasks': 'Задачи',
}

function pageLabel(value: unknown) {
  const raw = text(value).split('?')[0]
  if (!raw) return ''
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  return PAGE_LABELS[normalized] || PAGE_LABELS[normalized.replace(/\/$/, '')] || raw
}

function recipientLabel(item: Omit<CombinedLogItem, 'details' | 'detailRows'>) {
  const p = item.payload || {}
  return text(
    p.recipient_name ||
    p.telegram_name ||
    p.telegram_username ||
    p.client_name ||
    p.operator_name ||
    p.company_name ||
    p.point_device_name ||
    p.company_code,
  ) || item.recipient || ''
}

function renderValue(value: unknown, label?: string): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    if (label === 'Цена за единицу') return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} ₸`
    if (label && MONEY_DETAIL_LABELS.has(label)) return money(value) || '0 ₸'
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
  }
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (Array.isArray(value)) return value.map((item) => renderValue(item, label)).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  const raw = String(value).trim()
  return VALUE_LABELS[raw.toLowerCase()] || raw
}

function addDetail(parts: string[], label: string, value: unknown) {
  const rendered = renderValue(value, label)
  if (rendered) parts.push(`${label}: ${rendered}`)
}

const FIELD_LABELS: Record<string, string> = {
  date: 'Дата',
  shift: 'Смена',
  zone: 'Зона',
  category: 'Категория',
  comment: 'Комментарий',
  cash_amount: 'Наличные',
  kaspi_amount: 'Безналичный',
  online_amount: 'Online',
  card_amount: 'Карта',
  total_amount: 'Итого',
  amount: 'Сумма',
  quantity: 'Количество',
  qty: 'Количество',
  unit_price: 'Цена за единицу',
  item_name: 'Товар',
  product_name: 'Товар',
  name: 'Название',
  full_name: 'ФИО',
  email: 'Email',
  role: 'Роль',
  code: 'Код',
  operator_name: 'Оператор',
  point_device_name: 'Точка',
  point_name: 'Точка',
  company_code: 'Компания',
  company_name: 'Компания',
  client_name: 'Клиент',
  reason: 'Причина',
  message: 'Сообщение',
  source: 'Источник',
  endpoint: 'Раздел',
  provider: 'Сервис',
  model: 'Модель',
  status: 'Статус',
  total_tokens: 'Токены всего',
  prompt_tokens: 'Токены запроса',
  completion_tokens: 'Токены ответа',
  cost_estimate: 'Стоимость',
  supplier_name: 'Поставщик',
  supplier_organization_name: 'Организация поставщика',
  supplier_bin_iin: 'БИН/ИИН поставщика',
  invoice_number: 'Накладная',
  received_at: 'Дата приемки',
  location_name: 'Склад/точка',
  location_type: 'Тип локации',
  item_count: 'Позиций',
  payment_mode: 'Способ оплаты',
  payment_method: 'Метод оплаты',
  supplier_debt_status: 'Статус долга поставщика',
  due_date: 'Срок оплаты',
  is_consignment: 'Реализация',
  title: 'Название',
  point_mode: 'Режим точки',
  low_stock_threshold: 'Минимальный остаток',
}

function fieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ')
}

function normalizeForCompare(value: unknown) {
  if (value == null || value === '') return ''
  if (typeof value === 'number') return Number(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim()
  return JSON.stringify(value)
}

function describeChanges(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const rows: string[] = []
  const keys = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]))
    .filter((key) => !key.endsWith('_id') && !['id', 'created_at', 'updated_at'].includes(key))

  for (const key of keys) {
    if (normalizeForCompare(previous[key]) === normalizeForCompare(next[key])) continue
    const label = fieldLabel(key)
    const before = renderValue(previous[key], label) || 'пусто'
    const after = renderValue(next[key], label) || 'пусто'
    rows.push(`${label}: было "${before}", стало "${after}"`)
  }

  return rows
}

function addScalarDetails(rows: string[], source: Record<string, unknown>) {
  // Технический шум — не показываем пользователю (дамп ключей, метка актора уже есть отдельно).
  const ignored = new Set(['id', 'created_at', 'updated_at', 'previous', 'next', 'meta', 'payload_keys', 'actor_label', 'actor_name'])
  for (const [key, value] of Object.entries(source)) {
    if (ignored.has(key) || key.endsWith('_id') || key.endsWith('_ids')) continue
    if (rows.some((row) => row.startsWith(`${fieldLabel(key)}:`))) continue
    const rendered = renderValue(value, fieldLabel(key))
    if (rendered) rows.push(`${fieldLabel(key)}: ${rendered}`)
  }
}

function summarizeSystemError(p: Record<string, unknown>, item: Omit<CombinedLogItem, 'details' | 'detailRows'>) {
  const area = text(p.area) || text(p.scope) || item.subtitle || 'неизвестная область'
  const message = text(p.message) || 'без текста ошибки'
  const rows = [
    `Где упало: ${area}`,
    `Техническое действие: ${item.action || 'не указано'}`,
    `Сообщение ошибки: ${message}`,
  ]
  addDetail(rows, 'Код', p.code)
  addDetail(rows, 'Подробности', p.details)
  addDetail(rows, 'Подсказка', p.hint)
  return {
    title: `Ошибка системы в ${area}`,
    subtitle: `Действие: ${item.action || 'не указано'}`,
    details: rows.join(' · '),
    detailRows: rows,
  }
}

function summarizeNotification(item: Omit<CombinedLogItem, 'details' | 'detailRows'>) {
  const p = item.payload || {}
  const ok = item.status === 'sent' || item.status === 'delivered'
  const channel = item.channel === 'telegram' ? 'Telegram' : item.channel === 'email' ? 'Email' : item.channel || 'канал'
  const recipient = recipientLabel(item)
  const rows = [
    `Канал: ${channel}`,
    `Статус: ${ok ? 'доставлено' : 'ошибка отправки'}`,
  ]
  addDetail(rows, 'Получатель', recipient)
  addDetail(rows, 'Тип уведомления', p.kind)
  addDetail(rows, 'Товар', p.item_name)
  addDetail(rows, 'Количество', p.quantity)
  addDetail(rows, 'Сумма', p.total_amount)
  addDetail(rows, 'Компания', p.company_name)
  addDetail(rows, 'Точка', p.point_device_name)
  addDetail(rows, 'Оператор', p.operator_name)
  return {
    title: ok ? `Уведомление ${channel} доставлено` : `Ошибка отправки уведомления ${channel}`,
    subtitle: recipient || 'получатель не указан',
    details: rows.join(' · '),
    detailRows: rows,
  }
}

function summarizeLogItem(item: Omit<CombinedLogItem, 'details' | 'detailRows'>): Pick<CombinedLogItem, 'title' | 'subtitle' | 'details' | 'detailRows'> {
  const p = item.payload || {}
  const et = (item.entityType || '').toLowerCase()
  const act = (item.action || '').toLowerCase()
  const who = actorName(item.actorEmail)
  const entity = ENTITY_LABELS[et] || et || 'событие'
  const action = ACTION_LABELS[act] || act || 'сделал действие'
  const details: string[] = []

  if (item.kind === 'notification') {
    return summarizeNotification(item)
  }

  if (item.kind === 'ai' || et === 'ai-usage') {
    addDetail(details, 'Раздел', p.endpoint)
    addDetail(details, 'Сервис', p.provider)
    addDetail(details, 'Модель', p.model)
    addDetail(details, 'Статус', p.status)
    addDetail(details, 'Токены всего', p.total_tokens)
    addDetail(details, 'Стоимость', p.cost_estimate)
    addDetail(details, 'Ошибка', p.error)
    const statusLabel = text(p.status) === 'error' ? 'ошибка ИИ' : 'ИИ-запрос выполнен'
    return {
      title: `${who}: ${statusLabel} ${text(p.endpoint) || ''}`.trim(),
      subtitle: compact([renderValue(p.provider), text(p.model)]),
      details: compact(details),
      detailRows: details,
    }
  }

  if (et === 'system-error') {
    return summarizeSystemError(p, item)
  }

  if (et === 'income') {
    const src = act === 'update' ? record(p.next) : p
    const prev = act === 'update' ? record(p.previous) : {}
    const total = Number(src.cash_amount || 0) + Number(src.kaspi_amount || 0) + Number(src.online_amount || 0) + Number(src.card_amount || 0)
    addDetail(details, 'Дата', dateLabel(src.date))
    addDetail(details, 'Смена', src.shift === 'day' ? 'день' : src.shift === 'night' ? 'ночь' : src.shift)
    addDetail(details, 'Наличные', src.cash_amount)
    addDetail(details, 'Безналичный', src.kaspi_amount)
    addDetail(details, 'Online', src.online_amount)
    addDetail(details, 'Карта', src.card_amount)
    const detailRows = act === 'update'
      ? describeChanges(prev, src)
      : [...details]
    return { title: `${who} ${action} доход ${money(total)}`, subtitle: text(src.company_name) || item.subtitle, details: compact(detailRows.length ? detailRows : details), detailRows: detailRows.length ? detailRows : details }
  }

  if (et === 'expense') {
    const src = act === 'update' ? record(p.next) : p
    const prev = act === 'update' ? record(p.previous) : {}
    const total = Number(src.cash_amount || 0) + Number(src.kaspi_amount || 0)
    addDetail(details, 'Категория', src.category)
    addDetail(details, 'Дата', dateLabel(src.date))
    addDetail(details, 'Наличные', src.cash_amount)
    addDetail(details, 'Безналичный', src.kaspi_amount)
    addDetail(details, 'Комментарий', src.comment)
    const detailRows = act === 'update'
      ? describeChanges(prev, src)
      : [...details]
    return { title: `${who} ${action} расход ${money(total)}`, subtitle: text(src.category) || item.subtitle, details: compact(detailRows.length ? detailRows : details), detailRows: detailRows.length ? detailRows : details }
  }

  if (et === 'point-shift-report') {
    addDetail(details, 'Точка', p.point_device_name || p.company_code)
    addDetail(details, 'Оператор', p.operator_name)
    addDetail(details, 'Дата', dateLabel(p.date))
    addDetail(details, 'Смена', p.shift === 'day' ? 'день' : p.shift === 'night' ? 'ночь' : p.shift)
    addDetail(details, 'Зона', p.zone)
    addDetail(details, 'Итого', p.total_amount)
    const meta = record(p.meta)
    addDetail(details, 'Старт кассы', meta.start_cash)
    addDetail(details, 'Монеты', meta.coins)
    addDetail(details, 'Долги', meta.debts)
    addDetail(details, 'Wipon', meta.wipon)
    addDetail(details, 'Расхождение', meta.diff)
    return { title: `${who} добавил отчет смены ${money(p.total_amount)}`, subtitle: text(p.point_device_name) || text(p.company_code) || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'inventory-receipt') {
    addDetail(details, 'Поставщик', p.supplier_name || p.supplier_organization_name)
    addDetail(details, 'Организация поставщика', p.supplier_organization_name)
    addDetail(details, 'БИН/ИИН поставщика', p.supplier_bin_iin)
    addDetail(details, 'Накладная', p.invoice_number)
    addDetail(details, 'Дата приемки', dateLabel(p.received_at))
    addDetail(details, 'Склад/точка', p.location_name || p.company_name)
    addDetail(details, 'Позиций', p.item_count)
    addDetail(details, 'Итого', p.total_amount)
    addDetail(details, 'Оплата', p.payment_mode === 'deferred' ? 'отсрочка' : 'оплачено сразу')
    addDetail(details, 'Метод оплаты', p.payment_method === 'kaspi' ? 'Безналичный' : p.payment_method === 'cash' ? 'наличные' : p.payment_method)
    addDetail(details, 'Долг поставщика', p.supplier_debt_status === 'open' ? 'открыт' : p.supplier_debt_status === 'paid' ? 'закрыт' : p.supplier_debt_status)
    addDetail(details, 'Срок оплаты', dateLabel(p.due_date))
    addDetail(details, 'Категория расхода', p.auto_expense_category_name)
    const preview = Array.isArray(p.items_preview)
      ? p.items_preview
        .map((item) => record(item))
        .map((item) => {
          const name = text(item.invoice_name) || text(item.item_name) || 'товар'
          const qty = renderValue(item.quantity)
          const cost = renderValue(item.unit_cost, 'Цена за единицу')
          return `${name}${qty ? ` x ${qty}` : ''}${cost ? ` по ${cost}` : ''}`
        })
        .filter(Boolean)
        .slice(0, 5)
      : []
    if (preview.length) details.push(`Товары: ${preview.join('; ')}`)
    return {
      title: `${who} провел приемку ${money(p.total_amount) || ''}`.trim(),
      subtitle: compact([text(p.supplier_name || p.supplier_organization_name), text(p.invoice_number)]),
      details: compact(details),
      detailRows: details,
    }
  }

  if (et === 'inventory-receipt-draft') {
    addDetail(details, 'Название', p.title)
    addDetail(details, 'Накладная', p.invoice_number)
    addDetail(details, 'Дата приемки', dateLabel(p.received_at))
    addDetail(details, 'Позиций', p.item_count)
    addDetail(details, 'Оплата', p.payment_mode === 'deferred' ? 'отсрочка' : p.payment_mode === 'now' ? 'оплата сразу' : p.payment_mode)
    return {
      title: `${who} ${action} черновик приемки`,
      subtitle: text(p.title) || text(p.invoice_number) || item.subtitle,
      details: compact(details),
      detailRows: details,
    }
  }

  if (et === 'point-device') {
    addDetail(details, 'Режим', p.point_mode)
    addDetail(details, 'Операторов', p.operator_count)
    const companies = Array.isArray(p.company_ids) ? `${p.company_ids.length} компаний` : ''
    addDetail(details, 'Компании', companies)
    return { title: `${who} ${action} устройство точки`, subtitle: item.subtitle, details: compact(details), detailRows: details }
  }

  if (et.includes('inventory') || et.startsWith('point-')) {
    addDetail(details, 'Товар', p.product_name || p.item_name || p.name)
    addDetail(details, 'Кол-во', p.quantity || p.qty)
    addDetail(details, 'Сумма', p.amount || p.total_amount)
    addDetail(details, 'Точка', p.point_name || p.point_device_name || p.company_code)
    addDetail(details, 'Оператор', p.operator_name)
    addDetail(details, 'Клиент', p.client_name)
    addDetail(details, 'Неделя продажи', p.week_start)
    addDetail(details, 'Режим', p.point_mode)
    return { title: `${who} ${action} ${entity}`, subtitle: text(p.product_name) || text(p.item_name) || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'staff-payment' || et === 'salary_payment') {
    addDetail(details, 'Сумма', p.total_amount || p.amount)
    addDetail(details, 'Оператор', p.operator_name || p.staff_name)
    addDetail(details, 'Комментарий', p.comment)
    return { title: `${who} ${action} выплату зарплаты ${money(p.total_amount || p.amount)}`, subtitle: text(p.operator_name) || text(p.staff_name) || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'company' || et === 'staff' || et === 'operator' || et === 'expense_category') {
    const src = act === 'update' ? record(p.next) : p
    const prev = act === 'update' ? record(p.previous) : {}
    addDetail(details, 'Название', src.name || src.full_name)
    addDetail(details, 'Email', src.email)
    addDetail(details, 'Роль', src.role)
    addDetail(details, 'Код', src.code)
    const detailRows = act === 'update' ? describeChanges(prev, src) : [...details]
    return { title: `${who} ${action} ${entity}`, subtitle: text(src.name) || text(src.full_name) || text(src.email) || item.subtitle, details: compact(detailRows.length ? detailRows : details), detailRows: detailRows.length ? detailRows : details }
  }

  if (et === 'auth-attempt' || et === 'auth-session') {
    const email = text(p.email) || item.actorEmail || ''
    addDetail(details, 'Email', email)
    addDetail(details, 'IP', p.ip)
    addDetail(details, 'Результат', p.result || item.action)
    return { title: act === 'failed' ? `Неудачная попытка входа: ${email}` : `${email || who} вошел в систему`, subtitle: email || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'visit' || et === 'page-view' || act === 'visit' || act === 'page-view') {
    const page = text(p.pathname || p.path || p.page || p.url || item.subtitle)
    const readablePage = pageLabel(page)
    const source = text(p.source)
    const rows = [`Страница: ${readablePage || page || 'не указана'}`]
    if (source) rows.push(`Источник: ${renderValue(source)}`)
    return { title: `${who} открыл страницу ${readablePage || page || ''}`.trim(), subtitle: readablePage || page || item.subtitle, details: rows.join(' · '), detailRows: rows }
  }

  // Мастер расходов: показываем по-человечески, без дампа ключей payload.
  if (et === 'expense-wizard' || act.startsWith('wizard.expense')) {
    const amount = (Number(p.amount_cash) || 0) + (Number(p.amount_kaspi) || 0)
    if (act.endsWith('.submit')) {
      addDetail(details, 'Категория', p.category_name)
      addDetail(details, 'Сумма', amount || p.amount || p.total_amount)
      addDetail(details, 'Комментарий', p.comment)
      return { title: `${who} добавил расход${amount ? ` ${money(amount)}` : ''}`, subtitle: text(p.category_name) || item.subtitle, details: compact(details), detailRows: details }
    }
    if (act.endsWith('.start')) {
      return { title: `${who} начал добавлять расход`, subtitle: item.subtitle, details: '', detailRows: [] }
    }
    const step = p.step != null ? ` (шаг ${p.step})` : ''
    return { title: `${who} заполняет расход${step}`, subtitle: item.subtitle, details: '', detailRows: [] }
  }

  addDetail(details, 'Название', p.title || p.name || p.full_name)
  addDetail(details, 'Дата', dateLabel(p.date))
  addDetail(details, 'Сумма', p.amount || p.total_amount)
  addDetail(details, 'Точка', p.point_name || p.point_device_name || p.company_code)
  addDetail(details, 'Оператор', p.operator_name)
  addDetail(details, 'Комментарий', p.comment || p.reason || p.message)
  if (record(p.previous) && record(p.next)) {
    const changeRows = describeChanges(record(p.previous), record(p.next))
    if (changeRows.length) {
      return {
        title: `${who} ${action} ${entity}`,
        subtitle: text(record(p.next).title) || text(record(p.next).name) || text(record(p.next).full_name) || item.subtitle,
        details: compact(changeRows),
        detailRows: changeRows,
      }
    }
  }
  addScalarDetails(details, p)

  return {
    title: `${who} ${action} ${entity}`,
    subtitle: text(p.title) || text(p.name) || text(p.full_name) || item.subtitle,
    details: compact(details),
    detailRows: details,
  }
}

function toCsvValue(value: unknown) {
  const stringValue =
    value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${stringValue.replace(/"/g, '""')}"`
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(req.url)
    const search = url.searchParams.get('q')?.trim().toLowerCase() || ''
    const domain = url.searchParams.get('domain')?.trim().toLowerCase() || ''
    const kind = url.searchParams.get('kind')?.trim().toLowerCase() || ''
    const entityType = url.searchParams.get('entityType')?.trim().toLowerCase() || ''
    const action = url.searchParams.get('action')?.trim().toLowerCase() || ''
    const channel = url.searchParams.get('channel')?.trim().toLowerCase() || ''
    const status = url.searchParams.get('status')?.trim().toLowerCase() || ''
    const actor = url.searchParams.get('actor')?.trim().toLowerCase() || ''
    const onlyErrors = url.searchParams.get('onlyErrors') === 'true'
    const format = url.searchParams.get('format')?.trim().toLowerCase() || 'json'
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    const limit = Math.min(200, Math.max(20, Number(url.searchParams.get('limit') || 80)))

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const [
      { data: auditRows, error: auditError },
      { data: notificationRows, error: notificationError },
      aiUsageResult,
    ] = await Promise.all([
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('ai_usage_log').select('*').order('created_at', { ascending: false }).limit(300).then(
        (res: any) => res,
        (error: any) => ({ data: [], error }),
      ),
    ])

    if (auditError) throw auditError
    if (notificationError) throw notificationError
    const aiUsageRows = aiUsageResult?.error ? [] : ((aiUsageResult?.data || []) as AiUsageRow[])

    const actorIds = Array.from(
      new Set([
        ...((auditRows || []) as AuditRow[]).map((row) => row.actor_user_id).filter(Boolean),
        ...aiUsageRows.map((row) => row.user_id).filter(Boolean),
      ]),
    ) as string[]

    const actorEmailMap = new Map<string, string>()
    const actorNameMap = new Map<string, string>()
    if (actorIds.length > 0 && hasAdminSupabaseCredentials()) {
      const adminClient = createAdminSupabaseClient()
      const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (!error && data?.users) {
        for (const user of data.users) {
          if (user.id && user.email && actorIds.includes(user.id)) {
            actorEmailMap.set(user.id, user.email)
          }
        }
      }
      // Резолвим имена сотрудников по email — для красивого отображения и в TG, и на странице
      const emails = Array.from(actorEmailMap.values())
      if (emails.length > 0) {
        const { data: staffRows } = await adminClient
          .from('staff')
          .select('email, full_name, short_name')
          .in('email', emails)
        const emailToName = new Map<string, string>()
        for (const row of (staffRows || []) as any[]) {
          const email = String(row.email || '').toLowerCase()
          const name = String(row.full_name || row.short_name || '').trim()
          if (email && name) emailToName.set(email, name)
        }
        for (const [userId, email] of actorEmailMap) {
          const n = emailToName.get(email.toLowerCase())
          if (n) actorNameMap.set(userId, n)
        }
      }
    }

    // Резолвим имена компаний из payload, чтобы фронт мог красиво выводить точку
    const companyIds = new Set<string>()
    for (const row of (auditRows || []) as AuditRow[]) {
      const payload = row.payload as Record<string, unknown> | null
      if (!payload) continue
      const direct = String(payload.company_id || '').trim()
      if (direct) companyIds.add(direct)
      const next = (payload.next as Record<string, unknown>) || null
      const prev = (payload.previous as Record<string, unknown>) || null
      if (next?.company_id) companyIds.add(String(next.company_id))
      if (prev?.company_id) companyIds.add(String(prev.company_id))
    }
    const companyNameMap = new Map<string, string>()
    if (companyIds.size > 0) {
      const { data: companies } = await supabase
        .from('companies')
        .select('id, name')
        .in('id', Array.from(companyIds))
      for (const row of (companies || []) as any[]) {
        if (row.id && row.name) companyNameMap.set(String(row.id), String(row.name))
      }
    }

    const notificationRecipients = Array.from(
      new Set(((notificationRows || []) as NotificationRow[])
        .map((row) => String(row.recipient || '').trim())
        .filter(Boolean)),
    )
    const recipientNameMap = new Map<string, string>()
    if (notificationRecipients.length > 0) {
      const recipientSet = new Set(notificationRecipients)
      const [operatorsByTelegram, staffByTelegram] = await Promise.all([
        supabase
          .from('operators')
          .select('name, short_name, telegram_chat_id')
          .in('telegram_chat_id', notificationRecipients)
          .then((res: any) => res, () => ({ data: [], error: null })),
        supabase
          .from('staff')
          .select('full_name, short_name, telegram_chat_id')
          .in('telegram_chat_id', notificationRecipients)
          .then((res: any) => res, () => ({ data: [], error: null })),
      ])

      for (const row of (operatorsByTelegram?.data || []) as any[]) {
        const chatId = String(row.telegram_chat_id || '').trim()
        const name = text(row.short_name || row.name)
        if (chatId && name && recipientSet.has(chatId)) recipientNameMap.set(chatId, name)
      }
      for (const row of (staffByTelegram?.data || []) as any[]) {
        const chatId = String(row.telegram_chat_id || '').trim()
        const name = text(row.short_name || row.full_name)
        if (chatId && name && recipientSet.has(chatId)) recipientNameMap.set(chatId, name)
      }
    }

    const combined = [
      ...((auditRows || []) as AuditRow[]).map((row) => {
        const payload: Record<string, unknown> = row.payload ? { ...row.payload } : {}
        // Подмешиваем имя точки, чтобы фронт красиво показывал «точка: F16 Ramen»
        const companyId = String(payload.company_id || '').trim()
        if (companyId && !payload.company_name) {
          const cn = companyNameMap.get(companyId)
          if (cn) payload.company_name = cn
        }
        // Подмешиваем имя действующего лица для форматтера
        const actorName = row.actor_user_id ? actorNameMap.get(row.actor_user_id) : null
        if (actorName) payload.actor_label = actorName
        return {
          id: `audit:${row.id}`,
          kind: 'audit' as const,
          createdAt: row.created_at,
          title: `${row.entity_type} • ${row.action}`,
          subtitle: row.entity_id,
          details: null,
          detailRows: [],
          entityType: row.entity_type,
          action: row.action,
          actorUserId: row.actor_user_id,
          actorEmail: row.actor_user_id ? actorEmailMap.get(row.actor_user_id) || null : null,
          channel: null,
          status: null,
          recipient: null,
          payload,
        }
      }),
      ...((notificationRows || []) as NotificationRow[]).map((row) => {
        const recipientKey = String(row.recipient || '').trim()
        const recipientName = recipientNameMap.get(recipientKey) || null
        const payload: Record<string, unknown> = row.payload ? { ...row.payload } : {}
        if (recipientName && !payload.recipient_name) payload.recipient_name = recipientName
        if (recipientKey && !payload.recipient_chat_id) payload.recipient_chat_id = recipientKey
        return {
          id: `notification:${row.id}`,
          kind: 'notification' as const,
          createdAt: row.created_at,
          title: `${row.channel} • ${row.status}`,
          subtitle: recipientName || row.recipient,
          details: null,
          detailRows: [],
          entityType: null,
          action: row.payload?.kind ? String(row.payload.kind) : 'notification',
          actorUserId: null,
          actorEmail: null,
          channel: row.channel,
          status: row.status,
          recipient: row.recipient,
          payload,
        }
      }),
      ...aiUsageRows.map((row) => ({
        id: `ai:${row.id}`,
        kind: 'ai' as const,
        createdAt: row.created_at,
        title: `${row.provider} • ${row.endpoint}`,
        subtitle: row.model,
        details: null,
        detailRows: [],
        entityType: 'ai-usage',
        action: row.status === 'error' ? 'error' : 'complete',
        actorUserId: row.user_id,
        actorEmail: row.user_id ? actorEmailMap.get(row.user_id) || null : null,
        channel: 'ai',
        status: row.status,
        recipient: null,
        payload: {
          endpoint: row.endpoint,
          provider: row.provider,
          model: row.model,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          total_tokens: row.total_tokens,
          cost_estimate: row.cost_estimate,
          status: row.status,
          error: row.error,
          ...(row.payload || {}),
        },
      })),
    ]
      .map((item) => {
        const summary = summarizeLogItem(item)
        return { ...item, ...summary }
      })
      .filter((item) => {
        if (domain === 'auth') {
          const authEntityTypes = ['auth-attempt', 'auth-session']
          if (!authEntityTypes.includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'pages') {
          const entity = (item.entityType || '').toLowerCase()
          const act = (item.action || '').toLowerCase()
          if (entity !== 'page-view' && entity !== 'visit' && act !== 'page-view' && act !== 'visit') return false
        }

        if (domain === 'site-errors') {
          if (
            item.status !== 'failed' &&
            item.status !== 'error' &&
            item.entityType !== 'system-error' &&
            !(item.action || '').toLowerCase().includes('error') &&
            !(item.action || '').toLowerCase().includes('failed')
          ) return false
        }

        if (domain === 'telegram') {
          const payloadKind = String(record(item.payload).kind || '').toLowerCase()
          if (item.channel !== 'telegram' && !payloadKind.includes('telegram')) return false
        }

        if (domain === 'ai') {
          if (item.kind !== 'ai' && (item.entityType || '').toLowerCase() !== 'ai-usage') return false
        }

        if (domain === 'receipts') {
          if (!['inventory-receipt', 'point-shift-report'].includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'debts') {
          const debtEntities = ['point-debt', 'point-debt-item', 'supplier-debt']
          if (!debtEntities.includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'finance') {
          const financeEntityTypes = [
            'income',
            'income-export',
            'expense',
            'expense-export',
            'operator-salary-adjustment',
            'staff-payment',
          ]
          if (!financeEntityTypes.includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'staff') {
          const staffEntityTypes = [
            'staff',
            'staff-payment',
            'operator',
            'operator-staff-link',
            'auth-session',
            'auth-attempt',
          ]
          if (!staffEntityTypes.includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'operations') {
          const operationsEntityTypes = ['task', 'task-comment', 'shift', 'shift-week', 'shift-change-request']
          if (!operationsEntityTypes.includes((item.entityType || '').toLowerCase())) return false
        }

        if (domain === 'structure') {
          const structureEntityTypes = ['operator-company-assignment', 'operator-career', 'shift-change-request']
          if (!structureEntityTypes.includes((item.entityType || '').toLowerCase())) return false
        }

        if (kind && item.kind.toLowerCase() !== kind) return false
        if (entityType && (item.entityType || '').toLowerCase() !== entityType) return false
        if (action && (item.action || '').toLowerCase() !== action) return false
        if (channel && (item.channel || '').toLowerCase() !== channel) return false
        if (status && (item.status || '').toLowerCase() !== status) return false
        if (actor && (item.actorEmail || '').toLowerCase() !== actor) return false
        if (
          onlyErrors &&
          item.status !== 'failed' &&
          item.status !== 'error' &&
          item.entityType !== 'system-error' &&
          !(item.action || '').toLowerCase().includes('error') &&
          !(item.action || '').toLowerCase().includes('failed')
        ) {
          return false
        }
        if (!search) return true

        const haystack = JSON.stringify(item).toLowerCase()
        return haystack.includes(search)
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    if (format === 'csv') {
      const includeRawPayload = url.searchParams.get('raw') === 'true'
      const csvHeader = [
        'Дата и время',
        'Кто сделал',
        'Что произошло',
        'Где/объект',
        'Коротко',
        'Очень детально',
        'Тип',
        'Действие',
        'Канал',
        'Статус',
        'Получатель',
        ...(includeRawPayload ? ['Технические данные JSON'] : []),
      ]
      const csvRows = combined.map((item) =>
        [
          new Date(item.createdAt).toLocaleString('ru-RU'),
          item.actorEmail || 'Система',
          item.title,
          item.subtitle,
          item.details,
          item.detailRows.join('\n'),
          item.entityType,
          item.action,
          item.channel,
          item.status,
          item.recipient,
          ...(includeRawPayload ? [item.payload] : []),
        ]
          .map(toCsvValue)
          .join(','),
      )

      return new NextResponse([csvHeader.join(','), ...csvRows].join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="f16-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    const total = combined.length
    const start = (page - 1) * limit
    const items = combined.slice(start, start + limit).map((item) => ({
      ...item,
      payload: null,
    }))

    return json({
      ok: true,
      total,
      page,
      limit,
      items,
      filters: {
        kinds: Array.from(new Set(combined.map((item) => item.kind).filter(Boolean))).sort(),
        entityTypes: Array.from(new Set(combined.map((item) => item.entityType).filter(Boolean))).sort(),
        actions: Array.from(new Set(combined.map((item) => item.action).filter(Boolean))).sort(),
        actors: Array.from(new Set(combined.map((item) => item.actorEmail).filter(Boolean))).sort(),
        channels: Array.from(new Set(combined.map((item) => item.channel).filter(Boolean))).sort(),
        statuses: Array.from(new Set(combined.map((item) => item.status).filter(Boolean))).sort(),
      },
    })
  } catch (error: any) {
    console.error('Admin logs route error', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
