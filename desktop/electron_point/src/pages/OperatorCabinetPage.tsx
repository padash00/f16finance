import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckSquare,
  CreditCard,
  LogOut,
  RefreshCw,
  UserCircle2,
  CheckCircle2,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import * as api from '@/lib/api'
import { formatDate, formatMoney, todayISO } from '@/lib/utils'
import type { AppConfig, BootstrapData, DebtItem, OperatorSession, OperatorTask } from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  returnTo: 'shift' | 'sale' | 'scanner'
  onBackToWork: () => void
  onLogout: () => void
}

type CabinetTab = 'shifts' | 'tasks' | 'debts' | 'profile'

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
  { id: 'shifts', label: 'Мои смены', icon: CalendarDays },
  { id: 'tasks', label: 'Мои задачи', icon: CheckSquare },
  { id: 'debts', label: 'Мои долги', icon: CreditCard },
  { id: 'profile', label: 'Профиль', icon: UserCircle2 },
]

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

export default function OperatorCabinetPage({
  config,
  bootstrap,
  session,
  returnTo,
  onBackToWork,
  onLogout,
}: Props) {
  const CACHE_KEY = `cabinet_cache_${session.operator.operator_id}`

  const [activeTab, setActiveTab] = useState<CabinetTab>('shifts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)

  // Оплата долга (admin-only)
  const [payDebtId, setPayDebtId] = useState<string | null>(null)
  const [adminTokenInput, setAdminTokenInput] = useState('')
  const [payDebtSaving, setPayDebtSaving] = useState(false)
  const [payDebtError, setPayDebtError] = useState<string | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<'shifts' | 'debts' | 'tasks', string>>>({})
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [debts, setDebts] = useState<DebtItem[]>([])
  const [tasks, setTasks] = useState<OperatorTask[]>([])
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

    const [cabinetResult, tasksResult] = await Promise.allSettled([
      api.getPointOperatorCabinet(config, session),
      api.getPointOperatorTasks(config, session),
    ])

    const nextErrors: Partial<Record<'shifts' | 'debts' | 'tasks', string>> = {}

    if (cabinetResult.status === 'fulfilled') {
      const ownShifts = (cabinetResult.value.shifts || []).map((row: any) => {
        const cash = Number(row.cash_amount || row.cash || 0)
        const kaspi = Number(row.kaspi_amount || row.kaspi_pos || 0)
        const kaspiOnline = Number(row.online_amount || row.kaspi_online || 0)
        return {
          id: String(row.id),
          date: String(row.date),
          shift: String(row.shift || 'day'),
          company_name: row.company_name || session.company.name,
          cash,
          kaspi,
          kaspi_online: kaspiOnline,
          total: Number(row.total || cash + kaspi + kaspiOnline),
        }
      })
      setShifts(ownShifts)
      setDebts(cabinetResult.value.debts || [])
      setIsOffline(false)
    } else {
      // Try to load from cache
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          const { shifts: cs, debts: cd } = JSON.parse(cached)
          setShifts(cs || [])
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

    // Save to cache if both succeeded
    if (cabinetResult.status === 'fulfilled' && tasksResult.status === 'fulfilled') {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          shifts: cabinetResult.value.shifts || [],
          debts: cabinetResult.value.debts || [],
          tasks: tasksResult.value.tasks || [],
          savedAt: Date.now(),
        }))
      } catch { /* storage full */ }
    }

    setSectionErrors(nextErrors)
    if (Object.keys(nextErrors).length >= 3) {
      setError('Не удалось загрузить личный кабинет. Проверьте сеть и попробуйте обновить.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleMarkDebtPaid(debtId: string) {
    const token = adminTokenInput.trim()
    if (!token) { setPayDebtError('Введите токен администратора'); return }
    setPayDebtSaving(true)
    setPayDebtError(null)
    try {
      await api.markPointDebtPaid(config, session, debtId, token)
      setPayDebtId(null)
      setAdminTokenInput('')
      void load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка'
      setPayDebtError(msg === 'admin-token-required' ? 'Неверный или истёкший токен' : msg)
    } finally {
      setPayDebtSaving(false)
    }
  }

  const filteredShifts = useMemo(
    () => shifts.filter((row) => row.date >= from && row.date <= to).sort((a, b) => b.date.localeCompare(a.date)),
    [from, shifts, to],
  )
  const filteredDebts = useMemo(
    () => debts.filter((item) => item.created_at.slice(0, 10) >= from && item.created_at.slice(0, 10) <= to),
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
  const profileName = session.operator.full_name || session.operator.name || session.operator.username

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 pb-3 no-drag">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Личный кабинет{isOffline ? ' (кеш)' : ''}</p>
            <p className="text-xs text-muted-foreground">{profileName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          <WorkModeSwitch
            active="cabinet"
            showScanner={returnTo === 'scanner'}
            onShift={returnTo === 'shift' ? onBackToWork : undefined}
            onScanner={returnTo === 'scanner' ? onBackToWork : undefined}
          />
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

            {error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                {error}
              </div>
            ) : null}

            {activeTab !== 'profile' ? (
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
                        {item.status === 'active' ? (
                          payDebtId === item.id ? (
                            <div className="space-y-2 border-t border-white/10 pt-3">
                              <p className="text-xs text-muted-foreground">Токен администратора:</p>
                              <Input
                                type="password"
                                value={adminTokenInput}
                                onChange={e => setAdminTokenInput(e.target.value)}
                                placeholder="Вставьте токен..."
                                className="text-xs h-8"
                                onKeyDown={e => e.key === 'Enter' && void handleMarkDebtPaid(item.id)}
                                autoFocus
                              />
                              {payDebtError && <p className="text-xs text-destructive-foreground">{payDebtError}</p>}
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => { setPayDebtId(null); setAdminTokenInput(''); setPayDebtError(null) }}>
                                  Отмена
                                </Button>
                                <Button size="sm" className="flex-1 text-xs h-8 gap-1" onClick={() => void handleMarkDebtPaid(item.id)} disabled={payDebtSaving}>
                                  {payDebtSaving ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <CheckCircle2 className="h-3 w-3" />}
                                  Подтвердить
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-xs h-8 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                              onClick={() => { setPayDebtId(item.id); setAdminTokenInput(''); setPayDebtError(null) }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1.5" /> Оплатил долг
                            </Button>
                          )
                        ) : null}
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
