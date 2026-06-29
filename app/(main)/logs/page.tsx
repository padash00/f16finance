'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity, CircleAlert, Download, Eye, Loader2, RefreshCw,
  Search, ShieldCheck, TrendingUp, TrendingDown, User, Building2,
  Tag, Wallet, CreditCard,
  AlertTriangle, CheckCircle, LogIn, Trash2, Pencil, Plus, FileText,
  Sparkles,
} from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatAuditEvent, type FormattedEvent } from '@/lib/core/event-formatter'

// ─── Types ───────────────────────────────────────────────────────────────────

type LogItem = {
  id: string
  kind: 'audit' | 'notification' | 'ai'
  createdAt: string
  title: string
  subtitle: string | null
  details: string | null
  detailRows?: string[]
  entityType: string | null
  action: string | null
  actorUserId: string | null
  actorEmail: string | null
  channel: string | null
  status: string | null
  recipient: string | null
  payload: Record<string, unknown> | null
}

type LogResponse = {
  ok: boolean
  total: number
  page: number
  limit: number
  items: LogItem[]
  filters: { kinds: string[]; entityTypes: string[]; actions: string[]; actors: string[]; channels: string[]; statuses: string[] }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtMoney = (v: unknown) =>
  Number.isFinite(Number(v)) && Number(v) !== 0
    ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
    : null

const fmtDate = (d: unknown) => {
  if (!d || typeof d !== 'string') return null
  try { return new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) } catch { return String(d) }
}

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

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  email: 'Email',
  ai: 'ИИ',
}

function humanValue(value: unknown): string {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  if (raw.startsWith('/')) return pageLabel(raw)
  return VALUE_LABELS[raw.toLowerCase()] || raw
}

function humanDetailRow(row: string) {
  const [label, ...rest] = row.split(': ')
  return { label, value: humanValue(rest.join(': ')) }
}

const ENTITY_LABELS: Record<string, string> = {
  income: 'Доход',
  expense: 'Расход',
  company: 'Компания',
  staff: 'Сотрудник',
  operator: 'Оператор',
  'expense_category': 'Категория расходов',
  'profitability-input': 'ОПиУ ввод',
  'kaspi_terminal': 'Безналичный терминал',
  'operator-salary-adjustment': 'Корректировка зарплаты',
  'staff-payment': 'Выплата зарплаты',
  'auth-attempt': 'Вход в систему',
  'auth-session': 'Сессия',
  'system-error': 'Ошибка системы',
  'ai-usage': 'ИИ-запрос',
  'task': 'Задача',
  'shift': 'Смена',
  'operator-company-assignment': 'Назначение в компанию',
  'operator-career': 'Карьера оператора',
  'salary_payment': 'Выплата зарплаты',
  'visit': 'Посещение',
  'page-view': 'Просмотр страницы',
  'inventory-receipt': 'Приемка',
  'supplier-debt': 'Долг поставщика',
  'point-debt': 'Долг точки',
  'point-debt-item': 'Товар в долг точки',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'добавил',
  'create-batch': 'добавил пачкой',
  update: 'изменил',
  'update-online': 'обновил Online сумму',
  delete: 'удалил',
  upsert: 'сохранил',
  login: 'вошёл в систему',
  logout: 'вышел из системы',
  failed: 'неудачная попытка входа',
  complete: 'выполнен',
  error: 'ошибка',
  'page-view': 'просмотрел страницу',
  visit: 'посетил сайт',
}

function actorName(email: string | null): string {
  if (!email) return 'Система'
  return email.split('@')[0]
}

function entityLabel(type: string | null): string {
  if (!type) return 'событие'
  return ENTITY_LABELS[type] || type
}

function actionLabel(action: string | null): string {
  if (!action) return 'действие'
  return ACTION_LABELS[action] || action
}

const PAGE_LABELS: Record<string, string> = {
  '': 'Главная',
  '/': 'Главная',
  'income': 'Доходы',
  '/income': 'Доходы',
  'expenses': 'Расходы',
  '/expenses': 'Расходы',
  'reports': 'Отчёты',
  '/reports': 'Отчёты',
  'profitability': 'Рентабельность',
  '/profitability': 'Рентабельность',
  'settings': 'Настройки',
  '/settings': 'Настройки',
  'logs': 'Логи',
  '/logs': 'Логи',
  'operators': 'Операторы',
  '/operators': 'Операторы',
  'kaspi-terminal': 'Безналичный терминал',
  '/kaspi-terminal': 'Безналичный терминал',
  'salary': 'Зарплата',
  '/salary': 'Зарплата',
  'tasks': 'Задачи',
  '/tasks': 'Задачи',
  '/weekly-report': 'Еженедельный отчет',
  '/store/receipts': 'Приемка склада',
  '/store/postings': 'Оприходование',
  '/store/warehouse': 'Склад',
  '/store/movements': 'Движения склада',
  '/store/requests': 'Заявки склада',
  '/store/writeoffs': 'Списания склада',
  '/store/revisions': 'Ревизии склада',
  '/store/showcase': 'Витрина',
  '/point-debts': 'Долги точки',
}

function pageLabel(value: string) {
  const raw = value.split('?')[0]
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  return PAGE_LABELS[raw] || PAGE_LABELS[normalized] || raw
}

// ─── Human-readable title (через единый форматтер) ───────────────────────────

function formatItem(item: LogItem): FormattedEvent | null {
  if (!item.entityType || item.kind !== 'audit') return null
  const payload = item.payload || {}
  const actorLabel =
    String((payload as Record<string, unknown>).actor_label || '').trim() ||
    actorName(item.actorEmail)
  return formatAuditEvent({
    entityType: item.entityType,
    action: item.action || '',
    payload: payload as Record<string, unknown>,
    actorLabel,
  })
}

// Проверка: осмысленный ли заголовок от API (не сырой «entity • action», не пустой, без «·»).
function isMeaningfulApiTitle(title: string | null | undefined): boolean {
  const t = String(title || '').trim()
  if (!t) return false
  if (t === '·') return false
  // «inventory-receipt • create» — необработанный технический заголовок API.
  if (t.includes(' • ')) return false
  // Заголовок, заканчивающийся на «·» (пустое имя страницы и т.п.).
  if (/[:·]\s*·?\s*$/.test(t)) return false
  return true
}

// Старый humanTitle оставлен для notification и ai типов событий + как fallback
function humanTitle(item: LogItem): string {
  // ВАЖНО: API отдаёт записи с payload = null (он вырезается ради размера ответа),
  // поэтому формат-функция formatItem на странице работает с пустым payload и даёт
  // вырожденные заголовки («оформил продажу: 0 ₸», «открыл страницу: ·»).
  // Подробный человеческий заголовок строит сервер (route.ts → summarizeLogItem)
  // из РЕАЛЬНОГО payload. Поэтому для audit-событий берём его напрямую.
  if (item.kind === 'audit' && isMeaningfulApiTitle(item.title)) {
    return item.title
  }

  // audit события форматируются через единый форматтер (резерв, если API-заголовок пуст)
  if (item.kind === 'audit') {
    const f = formatItem(item)
    if (f) {
      const head = `${f.icon} ${f.title}`
      return f.details.length ? `${head} · ${f.details.join(' · ')}` : head
    }
  }
  const who = actorName(item.actorEmail)
  const p = item.payload || {}
  const et = (item.entityType || '').toLowerCase()
  const act = (item.action || '').toLowerCase()

  if (item.kind === 'notification') {
    const ch = item.channel === 'telegram' ? 'Telegram' : item.channel === 'email' ? 'Email' : item.channel || ''
    const ok = item.status === 'sent' || item.status === 'delivered'
    const recipient = item.recipient || ''
    return `${ch} уведомление → ${recipient} — ${ok ? 'доставлено' : 'ошибка'}`
  }

  if (item.kind === 'ai' || et === 'ai-usage') {
    const endpoint = String(p.endpoint || item.subtitle || '')
    const status = String(p.status || item.status || '')
    return status === 'error'
      ? `${who}: ошибка ИИ в ${endpoint}`
      : `${who}: ИИ-запрос выполнен ${endpoint}`
  }

  if (et === 'income') {
    if (act === 'create') {
      const total = Number(p.cash_amount || 0) + Number(p.kaspi_amount || 0) + Number(p.online_amount || 0) + Number(p.card_amount || 0)
      const parts = [fmtDate(p.date), p.shift === 'day' ? 'день' : p.shift === 'night' ? 'ночь' : null].filter(Boolean).join(', ')
      return `${who} добавил доход ${fmtMoney(total) ?? ''}${parts ? ` (${parts})` : ''}`
    }
    if (act === 'create-batch') return `${who} добавил пачку доходов (${p.count ?? ''} записей)`
    if (act === 'update') {
      const next = (p.next as Record<string, unknown>) || {}
      const total = Number(next.cash_amount || 0) + Number(next.kaspi_amount || 0) + Number(next.online_amount || 0) + Number(next.card_amount || 0)
      return `${who} изменил доход ${fmtMoney(total) ?? ''} (${fmtDate(next.date) ?? ''})`
    }
    if (act === 'update-online') {
      return `${who} обновил Online: ${fmtMoney(p.previous) ?? '—'} → ${fmtMoney(p.next as number) ?? '0 ₸'} (${fmtDate(p.date) ?? ''})`
    }
    if (act === 'delete') return `${who} удалил доход (${fmtDate(p.date) ?? ''})`
  }

  if (et === 'expense') {
    const total = Number(p.cash_amount || 0) + Number(p.kaspi_amount || 0)
    const next = (p.next as Record<string, unknown>) || {}
    const nextTotal = Number(next.cash_amount || 0) + Number(next.kaspi_amount || 0)
    if (act === 'create') return `${who} добавил расход ${fmtMoney(total) ?? ''} [${p.category || '—'}] (${fmtDate(p.date) ?? ''})`
    if (act === 'update') return `${who} изменил расход ${fmtMoney(nextTotal) ?? ''} [${next.category || p.category || '—'}] (${fmtDate(next.date) ?? ''})`
    if (act === 'delete') return `${who} удалил расход [${p.category || '—'}] (${fmtDate(p.date) ?? ''})`
  }

  if (et === 'expense_category') {
    if (act === 'create') return `${who} создал категорию "${p.name || ''}"`
    if (act === 'update') return `${who} изменил категорию "${p.name || ''}"`
    if (act === 'delete') return `${who} удалил категорию`
  }

  if (et === 'company') {
    if (act === 'create') return `${who} создал компанию "${p.name || ''}"`
    if (act === 'update') return `${who} изменил компанию "${p.name || ''}"`
    if (act === 'delete') return `${who} удалил компанию`
  }

  if (et === 'staff') {
    if (act === 'create') return `${who} добавил сотрудника "${p.name || p.full_name || ''}"`
    if (act === 'update') return `${who} изменил сотрудника "${p.name || p.full_name || ''}"`
    if (act === 'delete') return `${who} удалил сотрудника`
  }

  if (et === 'operator') {
    if (act === 'create') return `${who} добавил оператора`
    if (act === 'update') return `${who} изменил оператора`
    if (act === 'delete') return `${who} удалил оператора`
  }

  if (et === 'staff-payment' || et === 'salary_payment') {
    const amount = Number(p.total_amount || p.amount || 0)
    return `${who} выплатил зарплату ${fmtMoney(amount) ?? ''} оператору`
  }

  if (et === 'profitability-input') {
    const month = String(p.month || '').slice(0, 7)
    return `${who} сохранил данные ОПиУ за ${month}`
  }

  if (et === 'kaspi_terminal') {
    const amount = Number(p.amount || 0)
    if (act === 'create') return `${who} добавил данные терминала ${fmtMoney(amount) ?? ''} (${fmtDate(p.date) ?? ''})`
    if (act === 'update') return `${who} изменил данные терминала ${fmtMoney(amount) ?? ''}`
    if (act === 'delete') return `${who} удалил запись терминала`
  }

  if (et === 'auth-attempt') {
    const success = act === 'login' || act === 'success'
    const email = String(p.email || item.actorEmail || '')
    return success ? `${email} вошёл в систему` : `Неудачная попытка входа — ${email}`
  }

  if (et === 'system-error') {
    const area = String(p.area || p.scope || '')
    const msg = String(p.message || '').slice(0, 80)
    return `Ошибка системы${area ? ` [${area}]` : ''}: ${msg}`
  }

  if (et === 'task') {
    const title = String(p.title || '')
    if (act === 'create') return `${who} создал задачу "${title}"`
    if (act === 'update') return `${who} обновил задачу "${title}"`
    if (act === 'delete') return `${who} удалил задачу`
  }

  if (et === 'shift') {
    const date = fmtDate(p.date as string)
    if (act === 'create') return `${who} создал смену${date ? ` (${date})` : ''}`
    if (act === 'update') return `${who} изменил смену${date ? ` (${date})` : ''}`
    if (act === 'delete') return `${who} удалил смену${date ? ` (${date})` : ''}`
  }

  if (et === 'visit' || et === 'page-view' || act === 'page-view' || act === 'visit') {
    const rawPage = String(p.path || p.page || p.url || '')
    const page = rawPage.replace(/^\//, '').split('?')[0]
    const pageLabel = PAGE_LABELS[page] || (page ? `/${page}` : 'сайт')
    return `${who} открыл страницу: ${pageLabel}`
  }

  // fallback — показываем читаемо, без сырых ключей
  return `${who} — ${entityLabel(item.entityType)}${item.action ? ` (${actionLabel(item.action)})` : ''}`
}

// ─── Payload summary ─────────────────────────────────────────────────────────

function PayloadRows({ item }: { item: LogItem }) {
  const p = item.payload || {}
  const et = (item.entityType || '').toLowerCase()
  const act = (item.action || '').toLowerCase()

  const rows: { label: string; value: string; highlight?: boolean }[] = []

  const add = (label: string, value: unknown, highlight = false) => {
    if (value == null || value === '' || value === 0) return
    rows.push({ label, value: String(value), highlight })
  }

  if (et === 'income') {
    const src = act === 'update' ? ((p.next as Record<string, unknown>) || {}) : p
    const prev = act === 'update' ? ((p.previous as Record<string, unknown>) || {}) : null
    add('Дата', fmtDate(src.date as string))
    add('Наличные', fmtMoney(src.cash_amount))
    add('Безналичный', fmtMoney(src.kaspi_amount))
    add('Онлайн', fmtMoney(src.online_amount))
    add('Карта', fmtMoney(src.card_amount))
    if (act === 'update-online') {
      add('Было', fmtMoney(p.previous))
      add('Стало', fmtMoney(p.next as number), true)
      add('Дата', fmtDate(p.date as string))
    }
    if (prev) {
      const oldTotal = Number(prev.cash_amount || 0) + Number(prev.kaspi_amount || 0) + Number(prev.online_amount || 0) + Number(prev.card_amount || 0)
      const newTotal = Number((src.cash_amount || 0)) + Number((src.kaspi_amount || 0)) + Number((src.online_amount || 0)) + Number((src.card_amount || 0))
      if (oldTotal !== newTotal) add('Итого изменилось', `${fmtMoney(oldTotal)} → ${fmtMoney(newTotal)}`, true)
    }
    if (p.comment) add('Комментарий', p.comment)
  }

  if (et === 'expense') {
    const src = act === 'update' ? ((p.next as Record<string, unknown>) || {}) : p
    add('Дата', fmtDate(src.date as string))
    add('Категория', src.category)
    add('Наличные', fmtMoney(src.cash_amount))
    add('Безналичный', fmtMoney(src.kaspi_amount))
    const total = Number(src.cash_amount || 0) + Number(src.kaspi_amount || 0)
    if (total) add('Итого', fmtMoney(total), true)
    if (src.comment) add('Комментарий', src.comment)
  }

  if (et === 'company' || et === 'staff' || et === 'operator') {
    add('Имя', p.name || p.full_name)
    add('Email', p.email)
    add('Роль', p.role)
    add('Код', p.code)
  }

  if (et === 'expense_category') {
    add('Название', p.name)
    add('Финансовая группа', p.accounting_group)
    add('Бюджет/мес', fmtMoney(p.monthly_budget))
  }

  if (et === 'staff-payment' || et === 'salary_payment') {
    add('Сумма', fmtMoney(p.total_amount || p.amount), true)
    add('Наличными', fmtMoney(p.cash_amount))
    add('Безналичный', fmtMoney(p.kaspi_amount))
    add('Комментарий', p.comment)
  }

  if (et === 'profitability-input') {
    add('Месяц', String(p.month || '').slice(0, 7))
    add('Выручка нал', fmtMoney(p.cash_revenue_override))
    add('Выручка POS', fmtMoney(p.pos_revenue_override))
    add('ФОТ', fmtMoney(p.payroll_amount))
  }

  if (et === 'kaspi_terminal') {
    add('Дата', fmtDate(p.date as string))
    add('Сумма', fmtMoney(p.amount), true)
    add('Заметка', p.note)
  }

  if (et === 'system-error') {
    add('Область', p.area || p.scope)
    add('Сообщение', String(p.message || '').slice(0, 200))
  }

  if (et === 'auth-attempt') {
    add('Email', p.email || item.actorEmail)
    add('IP', p.ip)
    add('Результат', p.result || item.action)
  }

  if (et === 'ai-usage') {
    add('Раздел', p.endpoint || item.subtitle)
    add('Сервис', humanValue(p.provider || item.channel))
    add('Модель', p.model)
    add('Статус', humanValue(p.status || item.status))
    add('Токены', typeof p.total_tokens === 'number' ? p.total_tokens.toLocaleString('ru-RU') : p.total_tokens)
    add('Стоимость', p.cost_estimate)
    add('Ошибка', p.error)
  }

  if (et === 'income' && act === 'create-batch') {
    add('Кол-во записей', p.count)
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">{r.label}:</span>
          <span className={r.highlight ? 'font-semibold text-foreground' : 'text-body'}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Icons & colors per entity ───────────────────────────────────────────────

function entityIcon(entityType: string | null, action: string | null) {
  const et = (entityType || '').toLowerCase()
  const act = (action || '').toLowerCase()

  if (et === 'income') return { Icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (et === 'expense') return { Icon: TrendingDown, color: 'text-rose-400', bg: 'bg-rose-500/10' }
  if (et === 'company') return { Icon: Building2, color: 'text-blue-400', bg: 'bg-blue-500/10' }
  if (et === 'staff' || et === 'operator') return { Icon: User, color: 'text-purple-400', bg: 'bg-purple-500/10' }
  if (et === 'expense_category') return { Icon: Tag, color: 'text-amber-400', bg: 'bg-amber-500/10' }
  if (et === 'staff-payment' || et === 'salary_payment') return { Icon: Wallet, color: 'text-yellow-400', bg: 'bg-yellow-500/10' }
  if (et === 'kaspi_terminal') return { Icon: CreditCard, color: 'text-blue-400', bg: 'bg-blue-500/10' }
  if (et === 'profitability-input') return { Icon: FileText, color: 'text-cyan-400', bg: 'bg-cyan-500/10' }
  if (et === 'system-error') return { Icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' }
  if (et === 'ai-usage') return { Icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10' }
  if (et === 'auth-attempt') return { Icon: LogIn, color: 'text-sky-400', bg: 'bg-sky-500/10' }
  if (et === 'task') return { Icon: CheckCircle, color: 'text-indigo-400', bg: 'bg-indigo-500/10' }
  if (et === 'visit' || et === 'page-view' || act === 'page-view' || act === 'visit') return { Icon: Eye, color: 'text-slate-400', bg: 'bg-slate-500/10' }
  if (act === 'create') return { Icon: Plus, color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (act === 'update') return { Icon: Pencil, color: 'text-amber-400', bg: 'bg-amber-500/10' }
  if (act === 'delete') return { Icon: Trash2, color: 'text-rose-400', bg: 'bg-rose-500/10' }
  return { Icon: Activity, color: 'text-slate-400', bg: 'bg-slate-500/10' }
}

function actionBadgeColor(action: string | null): string {
  const a = (action || '').toLowerCase()
  if (a === 'create' || a === 'create-batch') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (a === 'update' || a.includes('update')) return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  if (a === 'delete') return 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
  if (a === 'login' || a === 'success') return 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
  if (a === 'failed' || a === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-300'
  return 'bg-slate-100 text-slate-500 dark:bg-white/8 dark:text-slate-400'
}

const ACTION_BADGE_LABELS: Record<string, string> = {
  create: 'Создание',
  'create-batch': 'Пачка',
  update: 'Изменение',
  'update-online': 'Online обновление',
  delete: 'Удаление',
  upsert: 'Сохранение',
  login: 'Вход',
  logout: 'Выход',
  failed: 'Ошибка',
  error: 'Ошибка',
  complete: 'Выполнено',
  'page-view': 'Просмотр',
  visit: 'Посещение',
  'point-debt-notify': 'Уведомление о долге',
  'point-debt-item': 'Товар в долг',
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} д назад`
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<LogResponse | null>(null)
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [kind, setKind] = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  // По умолчанию шум (просмотры страниц, AI-вызовы) скрыт — показываем важное.
  const [includeNoise, setIncludeNoise] = useState(false)
  const [page, setPage] = useState(1)

  const applyPreset = (preset: 'all' | 'pages' | 'site-errors' | 'telegram' | 'ai' | 'receipts' | 'debts' | 'auth' | 'finance' | 'staff' | 'operations' | 'structure' | 'errors') => {
    setPage(1); setEntityType(''); setAction(''); setActor(''); setKind(''); setOnlyErrors(false); setSearch('')
    if (preset === 'finance') setDomain('finance')
    else if (preset === 'pages') setDomain('pages')
    else if (preset === 'site-errors') { setDomain('site-errors'); setOnlyErrors(true) }
    else if (preset === 'telegram') setDomain('telegram')
    else if (preset === 'ai') setDomain('ai')
    else if (preset === 'receipts') setDomain('receipts')
    else if (preset === 'debts') setDomain('debts')
    else if (preset === 'auth') { setDomain('auth'); setKind('audit') }
    else if (preset === 'staff') { setDomain('staff'); setKind('audit') }
    else if (preset === 'operations') setDomain('operations')
    else if (preset === 'structure') { setDomain('structure'); setKind('audit') }
    else if (preset === 'errors') { setDomain(''); setEntityType('system-error'); setOnlyErrors(true) }
    else setDomain('')
  }

  const loadLogs = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page)); params.set('limit', '80')
      if (search.trim()) params.set('q', search.trim())
      if (domain) params.set('domain', domain)
      if (kind) params.set('kind', kind)
      if (entityType) params.set('entityType', entityType)
      if (action) params.set('action', action)
      if (actor) params.set('actor', actor)
      if (onlyErrors) params.set('onlyErrors', 'true')
      if (includeNoise) params.set('includeNoise', 'true')
      const response = await fetch(`/api/admin/logs?${params.toString()}`)
      const json = (await response.json().catch(() => null)) as LogResponse | { error?: string } | null
      if (!response.ok || !json || !('ok' in json)) throw new Error((json as any)?.error || 'Не удалось загрузить логи')
      setData(json)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить логи')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }

  // Копировать/скачать одну запись лога в JSON (для отправки разработчику).
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // AI-объяснение ошибки: какая запись грузится + готовые объяснения по id.
  const [explainingId, setExplainingId] = useState<string | null>(null)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const explainError = async (item: any) => {
    if (explanations[item.id] || explainingId === item.id) return
    setExplainingId(item.id)
    try {
      const areaRow = (item.detailRows || []).find((r: string) => r.startsWith('Где упало:') || r.startsWith('Область:'))
      const res = await fetch('/api/ai/explain-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          area: areaRow ? areaRow.split(':').slice(1).join(':').trim() : item.entityType,
          message: (item.detailRows || []).join(' · ') || item.details || item.title,
          action: item.action,
          entityType: item.entityType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      const text = data?.explanation
        || (data?.error === 'too-many-requests' ? 'Слишком часто — подождите минуту.' : 'Не удалось получить объяснение.')
      setExplanations((m) => ({ ...m, [item.id]: text }))
    } catch {
      setExplanations((m) => ({ ...m, [item.id]: 'Не удалось получить объяснение.' }))
    } finally {
      setExplainingId((c) => (c === item.id ? null : c))
    }
  }
  const copyJson = (item: any) => {
    const text = JSON.stringify(item, null, 2)
    navigator.clipboard?.writeText(text).then(
      () => { setCopiedId(item.id); setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500) },
      () => {},
    )
  }
  const downloadJson = (item: any) => {
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `log-${String(item.id).slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportLogs = () => {
    const params = new URLSearchParams()
    params.set('format', 'csv')
    if (search.trim()) params.set('q', search.trim())
    if (domain) params.set('domain', domain)
    if (kind) params.set('kind', kind)
    if (entityType) params.set('entityType', entityType)
    if (action) params.set('action', action)
    if (actor) params.set('actor', actor)
    if (onlyErrors) params.set('onlyErrors', 'true')
    window.open(`/api/admin/logs?${params.toString()}`, '_blank')
  }

  useEffect(() => { loadLogs() }, [page, domain, kind, entityType, action, actor, onlyErrors, includeNoise]) // eslint-disable-line

  const stats = useMemo(() => {
    const items = data?.items || []
    const ent = (i: any) => String(i.entityType || '').toLowerCase()
    const isErr = (i: any) =>
      i.status === 'failed' || i.status === 'error' || ent(i) === 'system-error' ||
      String(i.action || '').toLowerCase().includes('error') || String(i.action || '').toLowerCase().includes('failed')
    const count = (pred: (i: any) => boolean) => items.filter(pred).length
    return {
      total: data?.total || 0,
      shown: items.length,
      errors: count(isErr),
      sales: count(i => ['point-sale', 'point-return'].includes(ent(i))),
      finance: count(i => ['income', 'expense', 'income-export', 'expense-export'].includes(ent(i))),
      debts: count(i => ['point-debt', 'point-debt-item', 'supplier-debt', 'debts', 'debt'].includes(ent(i))),
      shifts: count(i => ['shift', 'point-shift', 'point-shift-report', 'shift-week', 'shift-change-request', 'shift-week-response', 'shift-publication'].includes(ent(i))),
      staff: count(i => ['staff', 'operator', 'staff-payment', 'operator-staff-link', 'operator-salary-adjustment', 'operator-salary-week-payment'].includes(ent(i))),
      inventory: count(i => ent(i).startsWith('inventory')),
      tasks: count(i => ['task', 'task-comment', 'point-incident'].includes(ent(i))),
      notifications: count(i => i.kind === 'notification'),
    }
  }, [data])

  const PRESETS = [
    { key: 'all', label: 'Важное' },
    { key: 'pages', label: '👁 Все страницы' },
    { key: 'site-errors', label: '🚨 Ошибки сайта' },
    { key: 'telegram', label: '✈ Telegram' },
    { key: 'ai', label: '✨ AI' },
    { key: 'receipts', label: '📦 Приемка' },
    { key: 'debts', label: '🧾 Долги' },
    { key: 'finance', label: '💰 Финансы' },
    { key: 'auth', label: '🔑 Входы' },
    { key: 'staff', label: '👤 Кадры' },
    { key: 'operations', label: '📋 Операции' },
    { key: 'structure', label: '🏢 Структура' },
    { key: 'errors', label: '🚨 Ошибки' },
  ] as const

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Журнал действий"
        description="Кто, что и когда сделал в системе — на понятном языке"
        accent="blue"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => { setPage(1); setIncludeNoise(v => !v) }}
              className={`border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 ${includeNoise ? 'ring-1 ring-sky-500/40 text-sky-700 dark:text-sky-300' : ''}`}
              title={includeNoise ? 'Сейчас показаны все события, включая просмотры страниц и AI' : 'Сейчас скрыт шум (просмотры страниц, AI). Нажмите, чтобы показать всё'}
            >
              {includeNoise ? 'Только важное' : 'Показать всё'}
            </Button>
            <Button variant="outline" onClick={exportLogs} className="border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">
              <Download className="mr-2 h-4 w-4" />
              Экспорт CSV
            </Button>
            <Button onClick={() => void loadLogs(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Обновить
            </Button>
          </>
        }
      />

      {/* Сводка по выборке */}
      <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/65 px-4 py-3 text-foreground">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="text-xs text-slate-400">
            Сводка · показано {stats.shown}{stats.total > stats.shown ? ` из ${stats.total}` : ''}
          </span>
          {[
            { label: 'продаж', value: stats.sales, emoji: '🛒' },
            { label: 'фин. операций', value: stats.finance, emoji: '💰' },
            { label: 'долгов', value: stats.debts, emoji: '🧾' },
            { label: 'по сменам', value: stats.shifts, emoji: '📋' },
            { label: 'по кадрам', value: stats.staff, emoji: '👤' },
            { label: 'по складу', value: stats.inventory, emoji: '📦' },
            { label: 'задач/инцидентов', value: stats.tasks, emoji: '✅' },
            { label: 'уведомлений', value: stats.notifications, emoji: '✈️' },
          ].filter(s => s.value > 0).map(s => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span>{s.emoji}</span>
              <span className="font-semibold tabular-nums">{s.value}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => applyPreset('errors')}
            className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition ${stats.errors > 0 ? 'text-red-600 dark:text-red-300 font-semibold hover:bg-red-500/10' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
            title="Показать только ошибки"
          >
            <span>🔴</span>
            <span className="tabular-nums">{stats.errors}</span>
            <span>{stats.errors === 1 ? 'ошибка' : 'ошибок'}</span>
          </button>
        </div>
      </Card>

      {/* Filters */}
      <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/65 p-5 text-foreground">
        {/* Presets */}
        <div className="mb-4 flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${(p.key === 'all' && !domain && !onlyErrors) || (domain === p.key) || (p.key === 'errors' && onlyErrors) ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/40' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Search + filters row */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadLogs(true)}
              placeholder="Поиск по тексту..."
              className="border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60 pl-10 text-foreground" />
          </div>
          <select value={actor} onChange={e => setActor(e.target.value)}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:[color-scheme:dark]">
            <option value="">Все пользователи</option>
            {(data?.filters.actors || []).map(o => <option key={o} value={o}>{o.split('@')[0]}</option>)}
          </select>
          <select value={entityType} onChange={e => setEntityType(e.target.value)}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:[color-scheme:dark]">
            <option value="">Все типы</option>
            {(data?.filters.entityTypes || []).map(o => <option key={o} value={o}>{ENTITY_LABELS[o] || o}</option>)}
          </select>
          <select value={action} onChange={e => setAction(e.target.value)}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:[color-scheme:dark]">
            <option value="">Все действия</option>
            {(data?.filters.actions || []).map(o => <option key={o} value={o}>{ACTION_BADGE_LABELS[o] || o}</option>)}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60 px-3 text-sm text-body cursor-pointer">
            <input type="checkbox" checked={onlyErrors} onChange={e => setOnlyErrors(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-white/20 bg-transparent" />
            Только ошибки
          </label>
          <Button onClick={() => { setPage(1); loadLogs(true) }}>Применить</Button>
          <Button variant="outline" onClick={() => {
            setSearch(''); setDomain(''); setKind(''); setEntityType(''); setAction(''); setActor(''); setOnlyErrors(false); setPage(1)
          }}>Сбросить</Button>
        </div>
      </Card>

      {/* Log items */}
      {loading ? (
        <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/65 p-6 text-foreground">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-sky-500 dark:text-sky-300" /> Загружаем журнал...
          </div>
        </Card>
      ) : error ? (
        <Card className="border-red-500/20 bg-red-500/10 p-6 text-red-700 dark:text-red-200">{error}</Card>
      ) : (
        <div className="space-y-2">
          {(data?.items || []).map((item) => {
            const { Icon, color, bg } = entityIcon(item.entityType, item.action)
            const isError = item.status === 'failed' || item.entityType === 'system-error'
            // Не показываем сырой код действия чипом, если нет русской метки —
            // заголовок и так описывает действие словами.
            const badgeLabel = ACTION_BADGE_LABELS[item.action || ''] || ''
            const isNotif = item.kind === 'notification'

            return (
              <Card key={item.id} className={`border-slate-200 bg-white dark:border-white/8 dark:bg-slate-950/60 p-4 text-foreground transition hover:bg-slate-50 dark:hover:bg-slate-900/60 ${isError ? 'border-red-500/20' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 rounded-xl p-2 ${bg}`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Kind badge */}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${isNotif ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : item.kind === 'ai' ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400'}`}>
                        {isNotif ? 'уведомление' : item.kind === 'ai' ? 'ИИ' : 'аудит'}
                      </span>

                      {/* Action badge */}
                      {badgeLabel && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${actionBadgeColor(item.action)}`}>
                          {badgeLabel}
                        </span>
                      )}

                      {/* Severity badge — для audit-событий */}
                      {(() => {
                        const f = formatItem(item)
                        if (!f) return null
                        const labels: Record<string, { text: string; cls: string }> = {
                          info: { text: 'инфо', cls: 'bg-slate-500/15 text-body' },
                          normal: { text: 'обычное', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
                          important: { text: 'важное', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
                          critical: { text: 'критично', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' },
                        }
                        const sev = labels[f.severity] || labels.info
                        return (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sev.cls}`}>
                            {sev.text}
                          </span>
                        )
                      })()}

                      {/* Error badge */}
                      {isError && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300">ошибка</span>
                      )}

                      {/* Time */}
                      <span className="ml-auto text-xs text-slate-500" title={new Date(item.createdAt).toLocaleString('ru-RU')}>
                        {relativeTime(item.createdAt)}
                      </span>

                      {/* JSON: копировать / скачать всю запись (для разработчика) */}
                      <button
                        type="button"
                        onClick={() => copyJson(item)}
                        title="Скопировать запись в JSON (для отправки разработчику)"
                        className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/10"
                      >
                        {copiedId === item.id ? '✓ скопировано' : '⧉ JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadJson(item)}
                        title="Скачать запись как .json"
                        className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/10"
                      >
                        ↓
                      </button>
                      {isError && (
                        <button
                          type="button"
                          onClick={() => explainError(item)}
                          disabled={explainingId === item.id || !!explanations[item.id]}
                          title="Объяснить ошибку простым языком (AI)"
                          className="rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
                        >
                          {explainingId === item.id ? '🤖 думает…' : '🤖 Объяснить'}
                        </button>
                      )}
                    </div>

                    {/* Main title */}
                    <p className="mt-1.5 text-sm font-medium leading-snug text-slate-900 dark:text-slate-100">
                      {humanTitle(item)}
                    </p>

                    {item.detailRows?.length ? (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                        {item.detailRows.map((row, index) => {
                          const { label, value } = humanDetailRow(row)
                          return (
                            <div key={`${item.id}:${index}`} className="rounded-md border border-slate-200 bg-slate-50 dark:border-white/8 dark:bg-white/[0.03] px-2.5 py-1.5 text-xs">
                              {value ? (
                                <>
                                  <span className="text-slate-500">{label}:</span>{' '}
                                  <span className="text-body">{value}</span>
                                </>
                              ) : (
                                <span className="text-body">{row}</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : item.details && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.details}</p>
                    )}

                    {/* AI-объяснение ошибки */}
                    {explanations[item.id] && (
                      <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-700 dark:border-violet-500/25 dark:bg-violet-500/[0.07] dark:text-slate-200">
                        <div className="mb-1 font-semibold text-violet-700 dark:text-violet-300">🤖 Объяснение AI</div>
                        <div className="whitespace-pre-wrap">{explanations[item.id]}</div>
                      </div>
                    )}

                    {/* Key fields summary */}
                    <PayloadRows item={item} />

                    {/* Actor + exact time */}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      {item.actorEmail && <span>👤 {item.actorEmail}</span>}
                      <span>🕐 {new Date(item.createdAt).toLocaleString('ru-RU')}</span>
                      {(item.kind === 'notification' ? item.subtitle || item.recipient : item.recipient) && (
                        <span>Получатель: {item.kind === 'notification' ? item.subtitle || item.recipient : item.recipient}</span>
                      )}
                      {item.channel && <span>Канал: {CHANNEL_LABELS[item.channel] || humanValue(item.channel)}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Страница {data?.page || 1} • всего {data?.total || 0} событий
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={(data?.page || 1) <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Назад</Button>
              <Button variant="outline" disabled={((data?.page || 1) * (data?.limit || 80)) >= (data?.total || 0)} onClick={() => setPage(p => p + 1)}>Вперёд →</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
