import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
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
  'point-sale': 'продажу',
  'point-return': 'возврат',
  'operator-salary-week-payment': 'выплату зарплаты за неделю',
  'operator-salary-week': 'зарплату за неделю',
  'shift-week-response': 'ответ на график смен',
  'shift-publication': 'публикацию графика смен',
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
  category: 'категорию',
  'expense-category': 'категорию расходов',
  'operator-staff-link': 'связь оператора с сотрудником',
  'shift-week': 'график смен',
  'shift-change-request': 'заявку на замену смены',
  'income-export': 'выгрузку доходов',
  'expense-export': 'выгрузку расходов',
  'checklist-run': 'чек-лист',
  checklist_run: 'чек-лист',
  bonus: 'бонус',
  fine: 'штраф',
  advance: 'аванс',
  invoice: 'счет',
  client: 'клиента',
  user: 'пользователя',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'добавил',
  created: 'добавил',
  'create-with-advance': 'выдал зарплату с авансом',
  create_with_advance: 'выдал зарплату с авансом',
  'telegram-confirm-week': 'подтвердил график смен в Telegram',
  telegram_confirm_week: 'подтвердил график смен в Telegram',
  'publish-week': 'опубликовал график смен',
  publish_week: 'опубликовал график смен',
  'publish-shifts': 'опубликовал график смен',
  'create-batch': 'добавил пачкой',
  create_batch: 'добавил пачкой',
  updated: 'изменил',
  deleted: 'удалил',
  update: 'изменил',
  'update-online': 'обновил сумму онлайн-оплат',
  delete: 'удалил',
  remove: 'удалил',
  upsert: 'сохранил',
  save: 'сохранил',
  archive: 'архивировал',
  unarchive: 'разархивировал',
  block: 'заблокировал',
  unblock: 'разблокировал',
  approve: 'одобрил',
  approved: 'одобрил',
  decline: 'отклонил',
  declined: 'отклонил',
  reject: 'отклонил',
  cancel: 'отменил',
  cancelled: 'отменил',
  canceled: 'отменил',
  dismiss: 'уволил',
  fire: 'уволил',
  demote: 'понизил',
  promote: 'повысил',
  invite: 'пригласил',
  issue: 'выставил',
  restore: 'восстановил',
  bootstrap: 'подключил',
  open: 'открыл',
  close: 'закрыл',
  closed: 'закрыл',
  handover: 'передал',
  complete: 'завершил',
  completed: 'завершил',
  finish: 'завершил',
  broadcast: 'разослал',
  send: 'отправил',
  'change-role': 'сменил роль',
  change_role: 'сменил роль',
  'change-email': 'сменил email',
  change_email: 'сменил email',
  'change-status': 'сменил статус',
  change_status: 'сменил статус',
  'change-password': 'сменил пароль',
  'add-stock': 'оприходовал',
  add_stock: 'оприходовал',
  'create-bonus': 'начислил бонус',
  create_bonus: 'начислил бонус',
  'create-fine': 'оштрафовал',
  create_fine: 'оштрафовал',
  'create-advance': 'выдал аванс',
  create_advance: 'выдал аванс',
  'admin-mark-paid': 'отметил оплату',
  admin_mark_paid: 'отметил оплату',
  'mark-paid': 'отметил оплату',
  pay: 'оплатил',
  paid: 'отметил оплату',
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

// Превращает любой код действия (включая dotted/префиксные: wizard.expense.submit,
// checklist_run.start, incident-open, change-role) в русский глагол. Никогда не возвращает сырой код.
function actionVerb(rawAction: string): string {
  const act = (rawAction || '').toLowerCase()
  if (!act) return 'выполнил действие'
  if (ACTION_LABELS[act]) return ACTION_LABELS[act]

  // Точка/последняя часть для dotted-действий: wizard.expense.submit → submit
  const tail = act.includes('.') ? act.split('.').pop()! : act
  if (ACTION_LABELS[tail]) return ACTION_LABELS[tail]

  const TAIL_VERBS: Record<string, string> = {
    submit: 'отправил',
    start: 'начал',
    started: 'начал',
    run: 'запустил',
    notify: 'уведомил',
    sync: 'синхронизировал',
    import: 'импортировал',
    export: 'выгрузил',
    upload: 'загрузил',
    download: 'скачал',
    confirm: 'подтвердил',
    confirmed: 'подтвердил',
    accept: 'принял',
    accepted: 'принял',
    assign: 'назначил',
    assigned: 'назначил',
    unassign: 'снял назначение',
    link: 'связал',
    unlink: 'отвязал',
    reset: 'сбросил',
    reopen: 'переоткрыл',
    resolve: 'закрыл',
    resolved: 'закрыл',
    'in-progress': 'взял в работу',
  }
  if (TAIL_VERBS[tail]) return TAIL_VERBS[tail]

  // Префиксные семейства
  if (act.startsWith('incident')) return tail === 'open' ? 'открыл инцидент' : 'обновил инцидент'
  if (act.startsWith('checklist')) return tail === 'start' ? 'начал чек-лист' : tail === 'complete' ? 'завершил чек-лист' : 'обновил чек-лист'
  if (act.startsWith('wizard')) return tail === 'submit' ? 'отправил' : 'заполняет'
  if (act.includes('create')) return 'добавил'
  if (act.includes('update') || act.includes('edit')) return 'изменил'
  if (act.includes('delete') || act.includes('remove')) return 'удалил'
  if (act.includes('cancel')) return 'отменил'
  if (act.includes('approve')) return 'одобрил'

  // Последний шанс — читаемая фраза без подчёркиваний/дефисов, но не сырой технокод
  return tail.replace(/[_-]+/g, ' ')
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

const MONEY_DETAIL_LABELS = new Set(['Наличные', 'Наличными', 'Безналичный', 'Онлайн', 'Карта', 'Итого', 'Сумма', 'Цена за единицу', 'Стоимость', 'Старт кассы', 'Монеты', 'Долги', 'Wipon', 'Расхождение', 'Переплата', 'Аванс', 'База', 'Бонусов на сумму', 'Штрафов на сумму', 'Бонус', 'Штраф', 'Выручка'])

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
  // Тип смены
  day: 'дневная',
  night: 'ночная',
  // Зоны / режимы точки
  pc: 'ПК (зона)',
  ps: 'PlayStation (зона)',
  console: 'консоли (зона)',
  vip: 'VIP (зона)',
  bar: 'бар (зона)',
  // Способы / методы оплаты
  cash: 'наличные',
  kaspi: 'Безналичный',
  card: 'карта',
  online: 'онлайн',
  mixed: 'смешанная оплата',
  deferred: 'отсрочка',
  now: 'оплата сразу',
  // Статусы долга / решений
  open: 'открыт',
  paid: 'оплачен',
  closed: 'закрыт',
  pending: 'ожидает',
  approved: 'одобрено',
  rejected: 'отклонено',
  declined: 'отклонено',
  // Прочие частые значения
  yes: 'да',
  no: 'нет',
  true: 'да',
  false: 'нет',
  manager: 'управляющий',
  owner: 'владелец',
  staff: 'сотрудник',
  operator: 'оператор',
  warehouse: 'склад',
  point_display: 'витрина точки',
  showcase: 'витрина',
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
  '/dashboard': 'Дашборд',
  '/staff': 'Сотрудники',
  '/shifts': 'Смены',
  '/access': 'Права доступа',
  '/platform': 'Панель платформы',
  '/store': 'Склад',
  '/store/catalog': 'Каталог товаров',
  '/store/showcase/requests': 'Заявки витрины',
  '/income/add': 'Добавление дохода',
  '/income-embed/add': 'Доход (встроенная форма)',
  '/income-embed': 'Доход (встроенная форма)',
  '/expenses/add': 'Добавление расхода',
  '/suppliers': 'Поставщики',
  '/clients': 'Клиенты',
  '/notifications': 'Уведомления',
  '/telegram': 'Telegram',
  '/business-intelligence': 'Центр управления',
  '/analysis': 'AI-анализ',
  '/analytics': 'Аналитика',
  '/cashflow': 'Движение денег',
  '/goals': 'Цели',
  '/tax': 'Налоги',
  '/calendar': 'Календарь',
  '/hr': 'Кадры',
  '/discounts': 'Скидки',
  '/categories': 'Категории',
  '/customers': 'Клиенты',
  '/store/suppliers': 'Поставщики',
  '/expense-analysis': 'AI-разбор расходов',
  '/team-analysis': 'AI-разбор команды',
  '/valuation': 'Оценка бизнеса',
  '/operator-analytics': 'Аналитика операторов',
}

// Превращает технический путь в человеческое название страницы.
// Никогда не возвращает «·» и не пусто: на неизвестный путь показываем сам путь.
function pageLabel(value: unknown) {
  const raw = text(value).split('?')[0].trim()
  if (!raw || raw === '·') return ''
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  const stripped = normalized.replace(/\/+$/, '') || '/'
  const exact = PAGE_LABELS[normalized] || PAGE_LABELS[stripped]
  if (exact) return exact
  // Пробуем по родительскому сегменту (например /tasks/123 → Задачи)
  const firstSeg = `/${stripped.split('/').filter(Boolean)[0] || ''}`
  if (firstSeg !== stripped && PAGE_LABELS[firstSeg]) return PAGE_LABELS[firstSeg]
  // Неизвестный путь — показываем как есть (сам путь), но не «·» и не пусто
  return raw
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

// Поля-даты: их значение (ISO) нужно показывать как ДД.ММ.ГГГГ.
const DATE_DETAIL_LABELS = new Set(['Дата', 'Неделя с', 'Неделя по', 'Дата выплаты', 'Дата приемки', 'Срок оплаты'])

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
  // ISO-дата в поле-дате → ДД.ММ.ГГГГ
  if (label && DATE_DETAIL_LABELS.has(label)) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[3]}.${m[2]}.${m[1]}`
  }
  return VALUE_LABELS[raw.toLowerCase()] || raw
}

function addDetail(parts: string[], label: string, value: unknown) {
  const rendered = renderValue(value, label)
  if (rendered) parts.push(`${label}: ${rendered}`)
}

const FIELD_LABELS: Record<string, string> = {
  date: 'Дата',
  shift: 'Смена',
  shift_type: 'Тип смены',
  zone: 'Зона',
  category: 'Категория',
  category_name: 'Категория',
  comment: 'Комментарий',
  note: 'Заметка',
  cash_amount: 'Наличные',
  kaspi_amount: 'Безналичный',
  online_amount: 'Онлайн',
  card_amount: 'Карта',
  total_amount: 'Итого',
  amount: 'Сумма',
  amount_cash: 'Наличными',
  amount_kaspi: 'Безналичный',
  cash: 'Наличные',
  kaspi: 'Безналичный',
  quantity: 'Количество',
  qty: 'Количество',
  count: 'Количество',
  rows_count: 'Количество записей',
  unit_price: 'Цена за единицу',
  unit_cost: 'Цена за единицу',
  item_name: 'Товар',
  product_name: 'Товар',
  name: 'Название',
  full_name: 'ФИО',
  short_name: 'Имя',
  email: 'Email',
  role: 'Роль',
  code: 'Код',
  operator_name: 'Оператор',
  staff_name: 'Сотрудник',
  point_device_name: 'Точка',
  point_name: 'Точка',
  company_code: 'Компания',
  company_name: 'Компания',
  client_name: 'Клиент',
  reason: 'Причина',
  one_off_reason: 'Причина',
  one_off_payee: 'Разовый получатель',
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
  // Зарплата / недельная выплата
  week_start: 'Неделя с',
  week_end: 'Неделя по',
  payment_date: 'Дата выплаты',
  overpayment_amount: 'Переплата',
  advance_amount: 'Аванс',
  base_amount: 'База',
  bonuses_total: 'Бонусов на сумму',
  fines_total: 'Штрафов на сумму',
  bonus_amount: 'Бонус',
  fine_amount: 'Штраф',
  // Графики смен / публикация
  company_count: 'Компаний',
  publication_required: 'Требует публикации',
  kaspi_before_midnight: 'Каспи до полуночи',
  // Документы
  document_kind: 'Тип документа',
  document_url: 'Документ',
  document_urls: 'Документы',
  backdated_confirmed: 'Задним числом',
  // Сводные суммы (разбивка)
  cash_total: 'Наличные',
  kaspi_total: 'Безналичный',
  revenue: 'Выручка',
  total_revenue: 'Выручка',
  start_cash: 'Старт кассы',
  coins: 'Монеты',
  debts: 'Долги',
  wipon: 'Wipon',
  diff: 'Расхождение',
  ip: 'IP',
  month: 'Месяц',
  operator_count: 'Операторов',
  requested_count: 'Запрошено позиций',
  items_count: 'Позиций',
}

// Технические поля, которые скрываем даже если попали в FIELD_LABELS-список:
// внутренние идентификаторы поставщиков и т.п. — пользователю не нужны.
const HIDDEN_FIELDS = new Set(['whitelist_vendor_id', 'vendor_id'])

function fieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ')
}

// Известно ли поле? (есть человеческий перевод в FIELD_LABELS)
function isKnownField(key: string) {
  return Boolean(FIELD_LABELS[key])
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

  // Значение для отображения: ISO-дата → ДД.ММ.ГГГГ, без кавычек.
  const fmtVal = (v: unknown, label: string) => {
    const r = renderValue(v, label)
    if (!r) return 'пусто'
    const m = r.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}.${m[2]}.${m[1]}` : r
  }

  for (const key of keys) {
    if (HIDDEN_FIELDS.has(key)) continue
    // Незнакомые технические поля не показываем сырым английским.
    if (!isKnownField(key)) continue
    if (normalizeForCompare(previous[key]) === normalizeForCompare(next[key])) continue
    const label = fieldLabel(key)
    rows.push(`${label}: ${fmtVal(previous[key], label)} → ${fmtVal(next[key], label)}`)
  }

  return rows
}

function addScalarDetails(rows: string[], source: Record<string, unknown>) {
  // Показываем поле ТОЛЬКО если у него есть человеческий перевод в FIELD_LABELS.
  // Незнакомые технические поля скрываем целиком — лучше ничего, чем сырой английский.
  for (const [key, value] of Object.entries(source)) {
    if (HIDDEN_FIELDS.has(key)) continue
    if (key.endsWith('_id') || key.endsWith('_ids')) continue
    if (!isKnownField(key)) continue
    const label = fieldLabel(key)
    if (rows.some((row) => row.startsWith(`${label}:`))) continue
    const rendered = renderValue(value, label)
    if (rendered) rows.push(`${label}: ${rendered}`)
  }
}

function summarizeSystemError(p: Record<string, unknown>, item: Omit<CombinedLogItem, 'details' | 'detailRows'>) {
  const areaRaw = text(p.area) || text(p.scope) || text(item.subtitle)
  const area = areaRaw && areaRaw !== '·' ? VALUE_LABELS[areaRaw.toLowerCase()] || areaRaw : 'системе'
  // В сообщение НЕ берём стек — только первую человеческую строку.
  const message = text(p.message) || text(p.error) || 'без текста ошибки'
  const rows = [`Область: ${area}`, `Сообщение: ${message}`]
  addDetail(rows, 'Код', p.code)
  addDetail(rows, 'Подробности', p.details)
  addDetail(rows, 'Подсказка', p.hint)
  // Стек — только в детали, не в заголовок.
  const stack = text(p.stack)
  if (stack) rows.push(`Стек: ${stack.split('\n').slice(0, 6).join(' ')}`)
  return {
    title: `Ошибка в ${area}: ${message}`,
    subtitle: area,
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
  const entity = ENTITY_LABELS[et] || (et ? et.replace(/[_-]+/g, ' ') : 'событие')
  const action = actionVerb(act)
  // Действия, где глагол уже полностью описывает событие — НЕ дописываем сущность,
  // иначе выходит дубль («подтвердил график смен … ответ на график смен»).
  const SELF_DESCRIBING = new Set([
    'telegram-confirm-week', 'telegram_confirm_week',
    'publish-week', 'publish_week', 'publish-shifts',
  ])
  const genericTitle = SELF_DESCRIBING.has(act) ? `${who} ${action}` : `${who} ${action} ${entity}`
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
    const section = text(p.endpoint)
    const isError = text(p.status) === 'error'
    const errText = text(p.error)
    const title = isError
      ? `ИИ${section ? ` ${section}` : ''}: ошибка${errText ? ` ${errText}` : ''}`
      : `ИИ-запрос выполнен${section ? `: ${section}` : ''}`
    return {
      title,
      subtitle: compact([renderValue(p.provider), text(p.model)]),
      details: compact(details),
      detailRows: details,
    }
  }

  if (et === 'system-error') {
    return summarizeSystemError(p, item)
  }

  if (et === 'income' && (act === 'create-batch' || act === 'create_batch')) {
    // Два источника пачки: серверный (count + rows[]) и клиентский (rows_count + total_amount).
    const rows = Array.isArray(p.rows) ? p.rows.map((r) => record(r)) : []
    const ids = Array.isArray(p.ids) ? p.ids : []
    const count =
      Number(p.count) ||
      Number(p.rows_count) ||
      rows.length ||
      ids.length ||
      0
    const total =
      Number(p.total_amount) ||
      rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0) ||
      0
    // Дата/смена: из верхнего уровня (клиентский payload) или из первой строки (серверный).
    const first = rows[0] || {}
    const dateRaw = text(p.date) || text(first.date)
    const shiftRaw = text(p.shift) || text(first.shift)
    const shiftLabel = shiftRaw === 'day' ? 'день' : shiftRaw === 'night' ? 'ночь' : shiftRaw
    const point = text(p.company_name)

    addDetail(details, 'Записей', count || '')
    addDetail(details, 'Дата', dateLabel(dateRaw))
    addDetail(details, 'Смена', shiftLabel)
    addDetail(details, 'Точка', point)
    addDetail(details, 'Итого', total)

    // Человеческий заголовок: «X внёс доходы пачкой ...», без «0 записей».
    const countPart = count ? `${count} ${count === 1 ? 'запись' : count < 5 ? 'записи' : 'записей'}` : ''
    const dateLbl = dateLabel(dateRaw)
    const whenPart = compact([dateLbl, shiftLabel])
    const title = total
      ? `${who} внёс доходы пачкой${countPart ? ` (${countPart})` : ''} на ${money(total)}`
      : `${who} внёс доходы пачкой${countPart ? ` (${countPart})` : ''}`
    const subtitle = compact([point, whenPart]) || (count ? `${countPart}` : item.subtitle)
    return { title, subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'income') {
    const src = act === 'update' ? record(p.next) : p
    const prev = act === 'update' ? record(p.previous) : {}
    const total = Number(src.cash_amount || 0) + Number(src.kaspi_amount || 0) + Number(src.online_amount || 0) + Number(src.card_amount || 0)
    addDetail(details, 'Дата', dateLabel(src.date))
    addDetail(details, 'Смена', src.shift === 'day' ? 'день' : src.shift === 'night' ? 'ночь' : src.shift)
    addDetail(details, 'Наличные', src.cash_amount)
    addDetail(details, 'Безналичный', src.kaspi_amount)
    addDetail(details, 'Онлайн', src.online_amount)
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

  if (et === 'point-sale' || et === 'point-return') {
    // Реальная сумма — из total_amount/amount/sum/sum_total, не из «0».
    const saleTotal =
      Number(p.total_amount) ||
      Number(p.amount) ||
      Number(p.sum) ||
      Number(p.sum_total) ||
      0
    addDetail(details, 'Товар', p.product_name || p.item_name || p.name)
    addDetail(details, 'Количество', p.quantity || p.qty)
    addDetail(details, 'Итого', saleTotal)
    addDetail(details, 'Метод оплаты', p.payment_method || p.payment_mode)
    addDetail(details, 'Точка', p.point_name || p.point_device_name || p.company_name || p.company_code)
    addDetail(details, 'Оператор', p.operator_name)
    addDetail(details, 'Клиент', p.client_name)
    addDetail(details, 'Неделя с', dateLabel(p.week_start))
    const what = et === 'point-return' ? 'возврат' : 'продажу'
    const verb = et === 'point-return' ? 'оформил' : (act === 'refund' ? 'вернул' : act === 'cancel' ? 'отменил' : 'оформил')
    const title = saleTotal
      ? `${who} ${verb} ${what} на ${money(saleTotal)}`
      : `${who} ${verb} ${what}`
    return { title, subtitle: text(p.point_name || p.point_device_name || p.company_name) || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et.includes('inventory') || et.startsWith('point-')) {
    addDetail(details, 'Товар', p.product_name || p.item_name || p.name)
    addDetail(details, 'Количество', p.quantity || p.qty)
    addDetail(details, 'Сумма', p.amount || p.total_amount)
    addDetail(details, 'Точка', p.point_name || p.point_device_name || p.company_code)
    addDetail(details, 'Оператор', p.operator_name)
    addDetail(details, 'Клиент', p.client_name)
    addDetail(details, 'Неделя с', dateLabel(p.week_start))
    addDetail(details, 'Режим', p.point_mode)
    return { title: `${who} ${action} ${entity}`, subtitle: text(p.product_name) || text(p.item_name) || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'staff-payment' || et === 'salary_payment' || et === 'operator-salary-week-payment' || et === 'operator-salary-week') {
    const payTotal = Number(p.total_amount) || Number(p.amount) || 0
    addDetail(details, 'Оператор', p.operator_name || p.staff_name)
    addDetail(details, 'Итого', payTotal)
    addDetail(details, 'Наличные', p.cash_amount)
    addDetail(details, 'Безналичный', p.kaspi_amount)
    addDetail(details, 'Аванс', p.advance_amount)
    addDetail(details, 'Переплата', p.overpayment_amount)
    addDetail(details, 'Бонусов на сумму', p.bonuses_total)
    addDetail(details, 'Штрафов на сумму', p.fines_total)
    addDetail(details, 'Неделя с', dateLabel(p.week_start))
    addDetail(details, 'Дата выплаты', dateLabel(p.payment_date))
    addDetail(details, 'Комментарий', p.comment)
    // Действие: выдача с авансом / обычная выплата.
    const withAdvance = act.includes('advance') || Number(p.advance_amount) > 0
    const verb = act === 'delete' || act === 'deleted'
      ? 'удалил выплату зарплаты'
      : withAdvance
        ? 'выдал зарплату с авансом'
        : 'выплатил зарплату'
    const title = payTotal && act !== 'delete' && act !== 'deleted'
      ? `${who} ${verb}${payTotal ? ` ${money(payTotal)}` : ''}`
      : `${who} ${verb}`
    return { title, subtitle: text(p.operator_name) || text(p.staff_name) || item.subtitle, details: compact(details), detailRows: details }
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
    const subj = email || who
    const title =
      act === 'failed' || act === 'error'
        ? `Неудачная попытка входа: ${email || subj}`
        : act === 'logout'
          ? `${subj} вышел из системы`
          : `${subj} вошел в систему`
    return { title, subtitle: email || item.subtitle, details: compact(details), detailRows: details }
  }

  if (et === 'visit' || et === 'page-view' || act === 'visit' || act === 'page-view') {
    // Путь может прийти как '·'/пусто — берём первый осмысленный источник.
    const rawPath = text(p.pathname || p.path || p.page || p.url)
    const subtitlePath = text(item.subtitle) === '·' ? '' : text(item.subtitle)
    const page = rawPath && rawPath !== '·' ? rawPath : subtitlePath
    const readablePage = pageLabel(page)
    const display = readablePage || page || 'неизвестная страница'
    // Заголовок самодостаточен («открыл страницу «Логи»») — детали-боксы не нужны,
    // чтобы не дублировать («Страница: … · Путь: … · Источник: …»).
    return { title: `${who} открыл страницу «${display}»`, subtitle: display, details: '', detailRows: [] }
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
        title: genericTitle,
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
    const denied = await requireCapability(access, 'logs.view')
    if (denied) return denied

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
    const includeNoise = url.searchParams.get('includeNoise') === 'true'
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
        // По умолчанию (без выбранного пресета) прячем шум: просмотры страниц и
        // AI-вызовы — чтобы важные события (продажи, долги, ошибки) не тонули.
        // Кнопка «Показать всё» (includeNoise) или пресеты «Страницы»/«AI» их вернут.
        if (!domain && !includeNoise) {
          const ent = (item.entityType || '').toLowerCase()
          const act2 = (item.action || '').toLowerCase()
          if (['page-view', 'visit', 'ai-usage'].includes(ent) || act2 === 'page-view' || act2 === 'visit') {
            return false
          }
        }

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
