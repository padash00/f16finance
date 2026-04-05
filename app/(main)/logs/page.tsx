'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity, BellRing, CircleAlert, Download, Eye, Loader2, RefreshCw,
  Search, ShieldCheck, TrendingUp, TrendingDown, User, Building2,
  Tag, Wallet, CreditCard, Settings, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, LogIn, Trash2, Pencil, Plus, FileText,
} from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ─── Types ───────────────────────────────────────────────────────────────────

type LogItem = {
  id: string
  kind: 'audit' | 'notification'
  createdAt: string
  title: string
  subtitle: string | null
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

const ENTITY_LABELS: Record<string, string> = {
  income: 'Доход',
  expense: 'Расход',
  company: 'Компания',
  staff: 'Сотрудник',
  operator: 'Оператор',
  'expense_category': 'Категория расходов',
  'profitability-input': 'ОПиУ ввод',
  'kaspi_terminal': 'Kaspi терминал',
  'operator-salary-adjustment': 'Корректировка зарплаты',
  'staff-payment': 'Выплата зарплаты',
  'auth-attempt': 'Вход в систему',
  'auth-session': 'Сессия',
  'system-error': 'Ошибка системы',
  'task': 'Задача',
  'shift': 'Смена',
  'operator-company-assignment': 'Назначение в компанию',
  'operator-career': 'Карьера оператора',
  'salary_payment': 'Выплата зарплаты',
  'visit': 'Посещение',
  'page-view': 'Просмотр страницы',
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
  'income': 'Доходы',
  'expenses': 'Расходы',
  'reports': 'Отчёты',
  'profitability': 'Рентабельность',
  'settings': 'Настройки',
  'logs': 'Логи',
  'operators': 'Операторы',
  'kaspi-terminal': 'Kaspi терминал',
  'salary': 'Зарплата',
  'tasks': 'Задачи',
}

// ─── Human-readable title ────────────────────────────────────────────────────

function humanTitle(item: LogItem): string {
  const who = actorName(item.actorEmail)
  const p = item.payload || {}

  if (item.kind === 'notification') {
    const ch = item.channel === 'telegram' ? 'Telegram' : item.channel === 'email' ? 'Email' : item.channel || ''
    const ok = item.status === 'sent' || item.status === 'delivered'
    const recipient = item.recipient || ''
    return `${ch} уведомление → ${recipient} — ${ok ? 'доставлено' : 'ошибка'}`
  }

  const et = (item.entityType || '').toLowerCase()
  const act = (item.action || '').toLowerCase()

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
    add('Kaspi', fmtMoney(src.kaspi_amount))
    add('Online', fmtMoney(src.online_amount))
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
    add('Kaspi', fmtMoney(src.kaspi_amount))
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
    add('Kaspi', fmtMoney(p.kaspi_amount))
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

  if (et === 'income' && act === 'create-batch') {
    add('Кол-во записей', p.count)
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">{r.label}:</span>
          <span className={r.highlight ? 'font-semibold text-white' : 'text-slate-300'}>{r.value}</span>
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
  if (a === 'create' || a === 'create-batch') return 'bg-emerald-500/15 text-emerald-300'
  if (a === 'update' || a.includes('update')) return 'bg-amber-500/15 text-amber-300'
  if (a === 'delete') return 'bg-rose-500/15 text-rose-300'
  if (a === 'login' || a === 'success') return 'bg-sky-500/15 text-sky-300'
  if (a === 'failed' || a === 'error') return 'bg-red-500/15 text-red-300'
  return 'bg-white/8 text-slate-400'
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
  'page-view': 'Просмотр',
  visit: 'Посещение',
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
  const [page, setPage] = useState(1)
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(new Set())

  const toggleRaw = (id: string) =>
    setExpandedRaw((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const applyPreset = (preset: 'all' | 'auth' | 'finance' | 'staff' | 'operations' | 'structure' | 'errors') => {
    setPage(1); setEntityType(''); setAction(''); setActor(''); setKind(''); setOnlyErrors(false); setSearch('')
    if (preset === 'finance') setDomain('finance')
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

  useEffect(() => { loadLogs() }, [page]) // eslint-disable-line

  const stats = useMemo(() => {
    const items = data?.items || []
    return {
      total: data?.total || 0,
      audit: items.filter(i => i.kind === 'audit').length,
      notifications: items.filter(i => i.kind === 'notification').length,
      failed: items.filter(i => i.status === 'failed').length,
      systemErrors: items.filter(i => i.entityType === 'system-error').length,
    }
  }, [data])

  const PRESETS = [
    { key: 'all', label: 'Все' },
    { key: 'finance', label: '💰 Финансы' },
    { key: 'auth', label: '🔑 Входы' },
    { key: 'staff', label: '👤 Кадры' },
    { key: 'operations', label: '📋 Операции' },
    { key: 'structure', label: '🏢 Структура' },
    { key: 'errors', label: '🚨 Ошибки' },
  ] as const

  return (
    <div className="app-page space-y-6">
      <AdminPageHeader
        title="Журнал действий"
        description="Кто, что и когда сделал в системе — на понятном языке"
        accent="blue"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button variant="outline" onClick={exportLogs} className="border-white/10 bg-white/5 hover:bg-white/10">
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

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        {[
          { label: 'Всего событий', value: stats.total, icon: Activity },
          { label: 'Действия', value: stats.audit, icon: ShieldCheck },
          { label: 'Уведомления', value: stats.notifications, icon: BellRing },
          { label: 'Ошибки отправки', value: stats.failed, icon: CircleAlert },
          { label: 'Ошибки системы', value: stats.systemErrors, icon: AlertTriangle },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-white/10 bg-slate-950/65 p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1.5 text-2xl font-semibold">{value}</p>
              </div>
              <div className="rounded-xl bg-white/6 p-2.5"><Icon className="h-4 w-4 text-sky-300" /></div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="border-white/10 bg-slate-950/65 p-5 text-white">
        {/* Presets */}
        <div className="mb-4 flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${domain === (p.key === 'all' ? '' : p.key) && !onlyErrors && p.key !== 'errors' || (p.key === 'errors' && onlyErrors) ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
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
              className="border-white/10 bg-slate-900/60 pl-10 text-white" />
          </div>
          <select value={actor} onChange={e => setActor(e.target.value)}
            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white [color-scheme:dark]">
            <option value="">Все пользователи</option>
            {(data?.filters.actors || []).map(o => <option key={o} value={o}>{o.split('@')[0]}</option>)}
          </select>
          <select value={entityType} onChange={e => setEntityType(e.target.value)}
            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white [color-scheme:dark]">
            <option value="">Все типы</option>
            {(data?.filters.entityTypes || []).map(o => <option key={o} value={o}>{ENTITY_LABELS[o] || o}</option>)}
          </select>
          <select value={action} onChange={e => setAction(e.target.value)}
            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white [color-scheme:dark]">
            <option value="">Все действия</option>
            {(data?.filters.actions || []).map(o => <option key={o} value={o}>{ACTION_BADGE_LABELS[o] || o}</option>)}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-200 cursor-pointer">
            <input type="checkbox" checked={onlyErrors} onChange={e => setOnlyErrors(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-transparent" />
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
        <Card className="border-white/10 bg-slate-950/65 p-6 text-white">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-sky-300" /> Загружаем журнал...
          </div>
        </Card>
      ) : error ? (
        <Card className="border-red-500/20 bg-red-500/10 p-6 text-red-200">{error}</Card>
      ) : (
        <div className="space-y-2">
          {(data?.items || []).map((item) => {
            const { Icon, color, bg } = entityIcon(item.entityType, item.action)
            const isError = item.status === 'failed' || item.entityType === 'system-error'
            const isRawOpen = expandedRaw.has(item.id)
            const badgeLabel = ACTION_BADGE_LABELS[item.action || ''] || item.action || ''
            const isNotif = item.kind === 'notification'

            return (
              <Card key={item.id} className={`border-white/8 bg-slate-950/60 p-4 text-white transition hover:bg-slate-900/60 ${isError ? 'border-red-500/20' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 rounded-xl p-2 ${bg}`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Kind badge */}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${isNotif ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400'}`}>
                        {isNotif ? 'уведомление' : 'аудит'}
                      </span>

                      {/* Action badge */}
                      {badgeLabel && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${actionBadgeColor(item.action)}`}>
                          {badgeLabel}
                        </span>
                      )}

                      {/* Error badge */}
                      {isError && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-300">ошибка</span>
                      )}

                      {/* Time */}
                      <span className="ml-auto text-xs text-slate-500" title={new Date(item.createdAt).toLocaleString('ru-RU')}>
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>

                    {/* Main title */}
                    <p className="mt-1.5 text-sm font-medium leading-snug text-slate-100">
                      {humanTitle(item)}
                    </p>

                    {/* Key fields summary */}
                    <PayloadRows item={item} />

                    {/* Actor + exact time */}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      {item.actorEmail && <span>👤 {item.actorEmail}</span>}
                      <span>🕐 {new Date(item.createdAt).toLocaleString('ru-RU')}</span>
                      {item.recipient && <span>→ {item.recipient}</span>}
                      {item.channel && <span>via {item.channel}</span>}
                    </div>

                    {/* Raw JSON toggle */}
                    {item.payload && (
                      <button onClick={() => toggleRaw(item.id)}
                        className="mt-2 flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition">
                        {isRawOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {isRawOpen ? 'Скрыть данные' : 'Показать данные'}
                      </button>
                    )}

                    {isRawOpen && item.payload && (
                      <pre className="mt-2 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-3 text-[11px] leading-5 text-slate-400">
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-slate-400">
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
