import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  CreditCard,
  FileText,
  LogOut,
  Search,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
  CheckCircle2,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import * as api from '@/lib/api'
import { formatDate, formatMoney, todayISO } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  DebtItem,
  OperatorSession,
  OperatorTask,
  PointKnowledgeArticle,
  PointKnowledgeContext,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  returnTo: 'shift' | 'sale' | 'return' | 'scanner' | 'checklists'
  onBackToWork: () => void
  onLogout: () => void
}

type CabinetTab = 'knowledge' | 'shifts' | 'tasks' | 'debts' | 'profile'

type ShiftRow = {
  id: string
  date: string
  shift: string
  company_name: string | null
  cash: number
  kaspi: number
  kaspi_online: number
  total: number
}

const TABS: { id: CabinetTab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'knowledge', label: 'Правила и FAQ', icon: FileText },
  { id: 'shifts', label: 'Мои смены', icon: CalendarDays },
  { id: 'tasks', label: 'Мои задачи', icon: CheckSquare },
  { id: 'debts', label: 'Мои долги', icon: CreditCard },
  { id: 'profile', label: 'Профиль', icon: UserCircle2 },
]

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Инфо',
  normal: 'Обычно',
  warning: 'Важно',
  critical: 'Критично',
}

function taskStatusLabel(status: string) {
  switch (status) {
    case 'done':
      return 'Готово'
    case 'in_progress':
      return 'В работе'
    case 'review':
      return 'На проверке'
    case 'todo':
      return 'К выполнению'
    case 'archived':
      return 'Архив'
    default:
      return 'Бэклог'
  }
}

function taskPriorityLabel(priority: string) {
  switch (priority) {
    case 'critical':
      return 'Критично'
    case 'high':
      return 'Высокий'
    case 'medium':
      return 'Средний'
    default:
      return 'Низкий'
  }
}

function SectionError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      {message}
    </div>
  )
}

function normalizeShiftRows(rows: unknown[], fallbackCompanyName: string): ShiftRow[] {
  return (rows || []).map((row: any) => {
    const cash = Number(row.cash_amount ?? row.cash ?? 0)
    const kaspi = Number(row.kaspi_amount ?? row.kaspi_pos ?? row.kaspi ?? 0)
    const kaspiOnline = Number(row.online_amount ?? row.kaspi_online ?? 0)
    return {
      id: String(row.id),
      date: String(row.date),
      shift: String(row.shift || 'day'),
      company_name: row.company_name || fallbackCompanyName,
      cash,
      kaspi,
      kaspi_online: kaspiOnline,
      total: Number(row.total ?? cash + kaspi + kaspiOnline),
    }
  })
}

export default function OperatorCabinetPage({
  config,
  bootstrap,
  session,
  returnTo,
  onBackToWork,
  onLogout,
}: Props) {
  const CACHE_KEY = `cabinet_cache_${session.operator.operator_id}`

  const [activeTab, setActiveTab] = useState<CabinetTab>('knowledge')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<'shifts' | 'debts' | 'tasks' | 'knowledge', string>>>({})
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [debts, setDebts] = useState<DebtItem[]>([])
  const [tasks, setTasks] = useState<OperatorTask[]>([])
  const [knowledge, setKnowledge] = useState<PointKnowledgeContext | null>(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [confirmingArticleId, setConfirmingArticleId] = useState<string | null>(null)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayISO)

  async function load() {
    setLoading(true)
    setError(null)
    setSectionErrors({})

    const [cabinetResult, tasksResult, knowledgeResult] = await Promise.allSettled([
      api.getPointOperatorCabinet(config, session),
      api.getPointOperatorTasks(config, session),
      api.getPointKnowledge(config, session),
    ])

    const nextErrors: Partial<Record<'shifts' | 'debts' | 'tasks' | 'knowledge', string>> = {}

    if (cabinetResult.status === 'fulfilled') {
      const ownShifts = normalizeShiftRows(cabinetResult.value.shifts || [], session.company.name)
      setShifts(ownShifts)
      setDebts(cabinetResult.value.debts || [])
      setIsOffline(false)
    } else {
      // Try to load from cache
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          const { shifts: cs, debts: cd } = JSON.parse(cached)
          setShifts(normalizeShiftRows(cs || [], session.company.name))
          setDebts(cd || [])
          setIsOffline(true)
        } else {
          setShifts([])
          setDebts([])
        }
      } catch { setShifts([]); setDebts([]) }
      const message = cabinetResult.reason instanceof Error ? cabinetResult.reason.message : 'Не удалось загрузить данные кабинета'
      nextErrors.shifts = message
      nextErrors.debts = message
    }

    if (tasksResult.status === 'fulfilled') {
      setTasks(tasksResult.value.tasks || [])
    } else {
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) setTasks(JSON.parse(cached).tasks || [])
        else setTasks([])
      } catch { setTasks([]) }
      nextErrors.tasks = tasksResult.reason instanceof Error ? tasksResult.reason.message : 'Не удалось загрузить задачи'
    }

    if (knowledgeResult.status === 'fulfilled') {
      setKnowledge(knowledgeResult.value)
    } else {
      setKnowledge(null)
      nextErrors.knowledge = knowledgeResult.reason instanceof Error
        ? knowledgeResult.reason.message
        : 'Не удалось загрузить правила и FAQ'
    }

    // Save to cache if both succeeded
    if (cabinetResult.status === 'fulfilled' && tasksResult.status === 'fulfilled') {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          shifts: normalizeShiftRows(cabinetResult.value.shifts || [], session.company.name),
          debts: cabinetResult.value.debts || [],
          tasks: tasksResult.value.tasks || [],
          savedAt: Date.now(),
        }))
      } catch { /* storage full */ }
    }

    setSectionErrors(nextErrors)
    if (Object.keys(nextErrors).length >= 4) {
      setError('Не удалось загрузить личный кабинет. Проверьте сеть и попробуйте обновить.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredShifts = useMemo(
    () => shifts.filter((row) => row.date >= from && row.date <= to).sort((a, b) => b.date.localeCompare(a.date)),
    [from, shifts, to],
  )
  const filteredDebts = useMemo(
    () => debts.filter((item) => {
      const debtDate = item.week_start || item.created_at.slice(0, 10)
      return debtDate >= from && debtDate <= to
    }),
    [debts, from, to],
  )

  const debtsByWeek = useMemo(() => {
    const map = new Map<string, DebtItem[]>()
    for (const item of filteredDebts) {
      const week = item.week_start || item.created_at.slice(0, 10)
      if (!map.has(week)) map.set(week, [])
      map.get(week)!.push(item)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filteredDebts])

  const totalShiftRevenue = filteredShifts.reduce((sum, row) => sum + row.total, 0)
  const totalDebt = filteredDebts.filter((item) => item.status === 'active').reduce((sum, row) => sum + row.total_amount, 0)
  const activeTasks = tasks.filter((task) => !['done', 'archived'].includes(task.status)).length
  const pendingConfirmations = knowledge?.pending_confirmations || []
  const pendingConfirmationIds = useMemo(
    () => new Set(pendingConfirmations.map((article) => article.id)),
    [pendingConfirmations],
  )
  const knowledgeArticles = useMemo(() => {
    const query = knowledgeQuery.trim().toLowerCase()
    const articles = knowledge?.articles || []
    if (!query) return articles
    return articles.filter((article) => {
      const haystack = [
        article.title,
        article.summary,
        article.content,
        article.category?.title,
        ...(article.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [knowledge?.articles, knowledgeQuery])
  const visibleKnowledgeArticles = useMemo(
    () => knowledgeArticles.filter((article) => !pendingConfirmationIds.has(article.id)),
    [knowledgeArticles, pendingConfirmationIds],
  )
  const profileName = session.operator.full_name || session.operator.name || session.operator.username

  async function handleConfirmArticle(articleId: string) {
    setConfirmingArticleId(articleId)
    setError(null)
    try {
      await api.confirmPointKnowledgeArticle(config, session, articleId)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось подтвердить ознакомление')
    } finally {
      setConfirmingArticleId(null)
    }
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-violet-500/5 blur-3xl dark:bg-violet-500/10" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-500/10" />
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 pb-3 no-drag">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-md shadow-emerald-500/30">
            <span className="text-[10px] font-bold tracking-tight text-white">OP</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Личный кабинет{isOffline ? ' (кеш)' : ''}</p>
            <p className="text-xs text-muted-foreground">{profileName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          <WorkModeSwitch
            active="cabinet"
            showSale={returnTo === 'sale'}
            showReturn={returnTo === 'return'}
            showScanner={returnTo === 'scanner'}
            onShift={returnTo === 'shift' ? onBackToWork : undefined}
            onSale={returnTo === 'sale' ? onBackToWork : undefined}
            onReturn={returnTo === 'return' ? onBackToWork : undefined}
            onScanner={returnTo === 'scanner' ? onBackToWork : undefined}
          />
          {returnTo === 'checklists' ? (
            <Button variant="outline" size="sm" onClick={onBackToWork}>
              К чек-листам
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r bg-sidebar px-2 py-3">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors no-drag ${
                  activeTab === tab.id
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            )
          })}
        </nav>

        <main className="flex-1 overflow-auto p-5">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Смен за период</div>
                  <div className="mt-2 text-2xl font-semibold">{filteredShifts.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatMoney(totalShiftRevenue)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Активные задачи</div>
                  <div className="mt-2 text-2xl font-semibold">{activeTasks}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Всего задач: {tasks.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Активный долг</div>
                  <div className="mt-2 text-2xl font-semibold">{formatMoney(totalDebt)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Позиции: {filteredDebts.length}</div>
                </CardContent>
              </Card>
            </div>

            {pendingConfirmations.length > 0 ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Есть материалы, которые нужно прочитать и подтвердить: {pendingConfirmations.length}
                </div>
                <div className="mt-1 text-xs text-amber-100/70">
                  Откройте вкладку «Правила и FAQ», прочитайте новые правила и нажмите «Ознакомлен».
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                {error}
              </div>
            ) : null}

            {activeTab !== 'profile' && activeTab !== 'knowledge' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">С</label>
                  <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">По</label>
                  <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" />
                </div>
              </div>
            ) : null}

            {!loading && activeTab === 'knowledge' ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Правила, FAQ и подтверждения
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Здесь правила смены, ответы на частые проблемы, штрафы, бонусы и материалы для обучения.
                      </p>
                    </div>
                    <Badge variant={pendingConfirmations.length ? 'destructive' : 'default'}>
                      {pendingConfirmations.length ? `Нужно подтвердить: ${pendingConfirmations.length}` : 'Всё подтверждено'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SectionError message={sectionErrors.knowledge} />

                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      value={knowledgeQuery}
                      onChange={(event) => setKnowledgeQuery(event.target.value)}
                      placeholder="Поиск: Kaspi, штраф, закрытие смены, клиент, техника..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>

                  {pendingConfirmations.length > 0 ? (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <div className="mb-3 text-sm font-semibold text-amber-100">Обязательные материалы</div>
                      <div className="grid gap-3">
                        {pendingConfirmations.map((article) => (
                          <KnowledgeArticleCard
                            key={article.id}
                            article={article}
                            required
                            confirming={confirmingArticleId === article.id}
                            onConfirm={() => void handleConfirmArticle(article.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3">
                    {visibleKnowledgeArticles.map((article) => (
                      <KnowledgeArticleCard
                        key={article.id}
                        article={article}
                        required={pendingConfirmationIds.has(article.id)}
                        confirming={confirmingArticleId === article.id}
                        onConfirm={
                          article.requires_confirmation
                            ? () => void handleConfirmArticle(article.id)
                            : undefined
                        }
                      />
                    ))}
                    {visibleKnowledgeArticles.length === 0 && pendingConfirmations.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-muted-foreground">
                        Материалов пока нет или ничего не найдено по запросу.
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
              </div>
            ) : null}

            {!loading && activeTab === 'shifts' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Мои смены</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SectionError message={sectionErrors.shifts} />
                  {filteredShifts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">За выбранный период смен нет.</div>
                  ) : (
                    filteredShifts.map((shift) => (
                      <div key={shift.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{formatDate(shift.date)} · {shift.shift === 'day' ? 'День' : 'Ночь'}</div>
                            <div className="text-xs text-muted-foreground">{shift.company_name || session.company.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums">{formatMoney(shift.total)}</div>
                            <div className="text-xs text-muted-foreground">Нал {formatMoney(shift.cash)} · Kaspi {formatMoney(shift.kaspi + shift.kaspi_online)}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeTab === 'tasks' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Мои задачи</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SectionError message={sectionErrors.tasks} />
                  {tasks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Сейчас задач нет.</div>
                  ) : (
                    tasks.map((task) => (
                      <div key={task.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium">#{task.task_number} · {task.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {task.company_name || 'Без точки'}
                              {task.due_date ? ` · дедлайн ${formatDate(task.due_date)}` : ''}
                            </div>
                            {task.description ? <div className="pt-1 text-sm text-muted-foreground">{task.description}</div> : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant={task.status === 'done' ? 'success' : task.status === 'in_progress' ? 'warning' : 'secondary'}>
                              {taskStatusLabel(task.status)}
                            </Badge>
                            <div className="text-xs text-muted-foreground">{taskPriorityLabel(task.priority)}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeTab === 'debts' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Мои долги</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SectionError message={sectionErrors.debts} />
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Здесь только просмотр долгов. Оператор не закрывает долг вручную: удержание и погашение делает руководитель через зарплату/админку.
                  </div>
                  {debtsByWeek.length === 0 ? (
                    <div className="text-sm text-muted-foreground">За выбранный период долгов нет.</div>
                  ) : (
                    debtsByWeek.map(([week, items]) => (
                      <div key={week} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Неделя с {formatDate(week)}
                          </p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {formatMoney(items.filter(i => i.status === 'active').reduce((s, i) => s + i.total_amount, 0))}
                          </p>
                        </div>
                        {items.map((item) => (
                      <div key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{item.item_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(item.created_at.slice(0, 10))} · {item.quantity} шт. × {formatMoney(item.unit_price)}
                              {item.company_name ? ` · ${item.company_name}` : null}
                            </div>
                            {item.comment ? <div className="pt-1 text-sm text-muted-foreground">{item.comment}</div> : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="text-sm font-semibold tabular-nums">{formatMoney(item.total_amount)}</div>
                            <Badge variant={item.status === 'active' ? 'destructive' : 'secondary'}>
                              {item.status === 'active' ? 'Активен' : 'Закрыт'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                        ))}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeTab === 'profile' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Профиль</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs text-muted-foreground">Оператор</div>
                    <div className="mt-1 text-sm font-medium">{profileName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">@{session.operator.username}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs text-muted-foreground">Роль</div>
                    <div className="mt-1 text-sm font-medium">{session.operator.role_in_company || 'Оператор'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{session.operator.is_primary ? 'Основная точка' : 'Доп. точка'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs text-muted-foreground">Точка</div>
                    <div className="mt-1 text-sm font-medium">{session.company.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{bootstrap.device.name || bootstrap.device.point_mode}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs text-muted-foreground">Telegram</div>
                    <div className="mt-1 text-sm font-medium">{session.operator.telegram_chat_id || 'Не привязан'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Нужен для уведомлений о долгах и отчётах</div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  )
}

function KnowledgeArticleCard({
  article,
  required,
  confirming,
  onConfirm,
}: {
  article: PointKnowledgeArticle
  required?: boolean
  confirming?: boolean
  onConfirm?: () => void
}) {
  const severityLabel = SEVERITY_LABELS[article.severity] || article.severity
  const isDanger = article.severity === 'critical' || article.severity === 'warning'

  return (
    <article className={`rounded-xl border p-4 ${required ? 'border-amber-500/25 bg-amber-500/10' : 'border-white/10 bg-black/20'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isDanger ? 'destructive' : 'secondary'}>{severityLabel}</Badge>
            {article.category?.title ? <Badge variant="secondary">{article.category.title}</Badge> : null}
            {article.requires_confirmation ? <Badge variant="secondary">нужно подтверждение</Badge> : null}
            {article.version ? <Badge variant="outline">v{article.version}</Badge> : null}
          </div>
          <h3 className="mt-3 break-words text-base font-semibold">{article.title}</h3>
          {article.summary ? (
            <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{article.summary}</p>
          ) : null}
          {article.content ? (
            <div
              className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/10 bg-background/50 p-3 text-sm leading-6 text-foreground/85"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          ) : null}
          {article.tags?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {article.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {onConfirm ? (
          <Button type="button" size="sm" onClick={onConfirm} disabled={confirming} className="shrink-0">
            {confirming ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Ознакомлен
          </Button>
        ) : null}
      </div>
    </article>
  )
}
