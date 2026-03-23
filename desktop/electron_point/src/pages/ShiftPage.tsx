'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  AlertTriangle,
  Building2,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  LogOut,
  ShoppingBasket,
  ReceiptText,
  RefreshCw,
  Send,
  SplitSquareVertical,
  UserCircle2,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import WorkModeSwitch from '@/components/WorkModeSwitch'
import { formatMoney, parseMoney, todayISO, localRef } from '@/lib/utils'
import { toastSuccess, toastError } from '@/lib/toast'
import * as api from '@/lib/api'
import { syncQueue, getPendingCount, queueShiftReport } from '@/lib/offline'
import QueueViewer from '@/components/QueueViewer'
import type {
  AppConfig,
  BootstrapData,
  DailyKaspiReport,
  OperatorSession,
  PointInventorySaleShiftSummary,
  ShiftForm,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  isOffline?: boolean
  onLogout: () => void
  onSwitchToSale?: () => void
  onSwitchToReturn?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

interface SplitEntry {
  date: string
  cash: number
  kaspi_pos: number
  kaspi_online: number
}

const DRAFT_KEY = 'shift_draft_v2'

const emptyForm = (): ShiftForm => ({
  date: todayISO(),
  operator_id: '',
  shift: 'day',
  cash: '',
  coins: '',
  kaspi_pos: '',
  kaspi_before_midnight: '',
  kaspi_online: '',
  debts: '',
  start: '',
  wipon: '',
  comment: '',
})

function isLastDayOfMonth(dateISO: string): boolean {
  const d = new Date(dateISO)
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const last = new Date(next.getTime() - 86400000)
  return d.getDate() === last.getDate()
}

function nextDayISO(dateISO: string): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default function ShiftPage({
  config,
  bootstrap,
  session,
  isOffline,
  onLogout,
  onSwitchToSale,
  onSwitchToReturn,
  onSwitchToScanner,
  onSwitchToRequest,
  onOpenCabinet,
}: Props) {
  const [form, setForm] = useState<ShiftForm>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if ('kaspi_online' in parsed) {
          return {
            ...emptyForm(),
            ...parsed,
            kaspi_before_midnight: typeof parsed.kaspi_before_midnight === 'string' ? parsed.kaspi_before_midnight : '',
          }
        }
      }
    } catch {}
    localStorage.removeItem(DRAFT_KEY)
    return emptyForm()
  })

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<'success' | 'queued' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showQueue, setShowQueue] = useState(false)

  const [confirmDialog, setConfirmDialog] = useState(false)
  const [splitDialog, setSplitDialog] = useState(false)
  const [splitAfter, setSplitAfter] = useState({ cash: '', kaspi_pos: '', kaspi_online: '' })
  const [viewMode, setViewMode] = useState<'shift' | 'daily'>('shift')
  const [dailyDate, setDailyDate] = useState(todayISO())
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [dailyReport, setDailyReport] = useState<DailyKaspiReport | null>(null)
  const [salesSummary, setSalesSummary] = useState<PointInventorySaleShiftSummary | null>(null)
  const [salesSummaryLoading, setSalesSummaryLoading] = useState(false)

  const flags = bootstrap.device.feature_flags
  const hasInventorySale = !!onSwitchToSale
  const hasScanner = flags.debt_report && onSwitchToScanner
  const hasInventoryRequest = !!onSwitchToRequest
  const kaspiDailySplitEnabled = flags.kaspi_daily_split === true
  const isNightKaspiSplit = kaspiDailySplitEnabled && form.shift === 'night'

  const pointMode = (bootstrap.device.point_mode || '').toLowerCase()
  const isArena = pointMode.includes('arena')
  const wiponLabel = isArena ? 'Senet (система)' : 'Wipon (система)'
  const kaspiLabel = isArena ? 'Kaspi POS' : 'Kaspi'

  useEffect(() => {
    const hasDraft = !!localStorage.getItem(DRAFT_KEY)
    if (!hasDraft) {
      const hour = new Date().getHours()
      setForm((current) => ({
        ...current,
        shift: hour >= 8 && hour < 20 ? 'day' : 'night',
      }))
    }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(form)), 500)
    return () => clearTimeout(timeout)
  }, [form])

  useEffect(() => {
    const refresh = async () => setPendingCount(await getPendingCount())
    void refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [])

  const doSync = useCallback(async () => {
    setSyncing(true)
    try {
      const { synced, failed } = await syncQueue(config)
      setPendingCount(await getPendingCount())
      if (synced > 0) toastSuccess(`Синхронизировано: ${synced} ${synced === 1 ? 'отчёт' : 'отчётов'}`)
      if (failed > 0) toastError(`Не удалось синхронизировать: ${failed}`)
    } finally {
      setSyncing(false)
    }
  }, [config])

  useEffect(() => {
    const interval = setInterval(async () => {
      const count = await getPendingCount()
      if (count > 0) void doSync()
    }, 60000)
    return () => clearInterval(interval)
  }, [doSync])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === 'Enter') {
        document.getElementById('shift-submit-btn')?.click()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const handleOnline = () => void doSync()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [doSync])

  const loadDailyReport = useCallback(async (date: string) => {
    if (!kaspiDailySplitEnabled) return
    setDailyLoading(true)
    setDailyError(null)
    try {
      const data = await api.getPointDailyKaspiReport(config, date)
      setDailyReport(data)
    } catch (err: any) {
      setDailyReport(null)
      setDailyError(err?.message || 'Не удалось загрузить суточный Kaspi отчёт')
    } finally {
      setDailyLoading(false)
    }
  }, [config, kaspiDailySplitEnabled])

  useEffect(() => {
    if (viewMode === 'daily' && kaspiDailySplitEnabled) {
      void loadDailyReport(dailyDate)
    }
  }, [dailyDate, kaspiDailySplitEnabled, loadDailyReport, viewMode])

  const loadSalesSummary = useCallback(async (date: string, shift: 'day' | 'night') => {
    if (!hasInventorySale) {
      setSalesSummary(null)
      return
    }

    setSalesSummaryLoading(true)
    try {
      const summary = await api.getPointInventorySaleShiftSummary(config, date, shift)
      setSalesSummary(summary)
    } catch {
      setSalesSummary(null)
    } finally {
      setSalesSummaryLoading(false)
    }
  }, [config, hasInventorySale])

  useEffect(() => {
    if (viewMode !== 'shift') return
    if (form.shift !== 'day' && form.shift !== 'night') return
    void loadSalesSummary(form.date, form.shift)
  }, [form.date, form.shift, loadSalesSummary, viewMode])

  const vCash = parseMoney(form.cash)
  const vCoins = parseMoney(form.coins)
  const vKaspi = parseMoney(form.kaspi_pos)
  const vKaspiBeforeMidnight = parseMoney(form.kaspi_before_midnight)
  const autoSalesCash = salesSummary?.cash_amount || 0
  const autoSalesKaspiBeforeMidnight = salesSummary?.kaspi_before_midnight_amount || 0
  const autoSalesKaspiAfterMidnight = salesSummary?.kaspi_after_midnight_amount || 0
  const autoSalesKaspiTotal = salesSummary?.kaspi_amount || 0
  const vKaspiTotal = isNightKaspiSplit
    ? vKaspiBeforeMidnight + vKaspi + autoSalesKaspiBeforeMidnight + autoSalesKaspiAfterMidnight
    : vKaspi + autoSalesKaspiTotal
  const vKaspiOnline = parseMoney(form.kaspi_online)
  const vDebts = parseMoney(form.debts)
  const vStart = parseMoney(form.start)
  const vWipon = parseMoney(form.wipon)

  const fact = vCash + autoSalesCash + vCoins + vKaspiTotal + vDebts - vStart
  const itog = fact - vWipon

  function setField(key: keyof ShiftForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setResult(null)
    setError(null)
  }

  function resetForm() {
    localStorage.removeItem(DRAFT_KEY)
    setForm(emptyForm())
    setResult(null)
    setError(null)
  }

  async function sendOne(formToSend: ShiftForm): Promise<'success' | 'queued'> {
    const ref = localRef()
    try {
      await api.sendShiftReport(config, formToSend, ref)
      return 'success'
    } catch {
      await queueShiftReport({ ...formToSend, local_ref: ref })
      return 'queued'
    }
  }

  async function sendSplit(baseForm: ShiftForm, entries: SplitEntry[]): Promise<'success' | 'queued'> {
    let anyQueued = false

    for (const entry of entries) {
      const nextForm: ShiftForm = {
        ...baseForm,
        date: entry.date,
        cash: String(entry.cash),
        kaspi_pos: String(entry.kaspi_pos),
        kaspi_online: String(entry.kaspi_online),
      }

      const result = await sendOne(nextForm)
      if (result === 'queued') anyQueued = true
    }

    return anyQueued ? 'queued' : 'success'
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setResult(null)

    if (fact <= 0) {
      setError('Введите сумму выручки')
      return
    }

    if (!session.operator.operator_id) {
      setError('Выберите оператора')
      return
    }

    if (isNightKaspiSplit && (form.kaspi_before_midnight.trim() === '' || form.kaspi_pos.trim() === '')) {
      setError('Для ночной смены заполните Kaspi до 00:00 и после 00:00')
      return
    }

    if (!kaspiDailySplitEnabled && isArena && form.shift === 'night' && isLastDayOfMonth(form.date)) {
      setSplitAfter({ cash: '', kaspi_pos: '', kaspi_online: '' })
      setSplitDialog(true)
      return
    }

    setConfirmDialog(true)
  }

  async function handleConfirm() {
    setConfirmDialog(false)
    setSubmitting(true)
    try {
      const fullForm: ShiftForm = {
        ...form,
        operator_id: session.operator.operator_id,
        cash: String(vCash + autoSalesCash),
        kaspi_pos: String(
          isNightKaspiSplit
            ? vKaspi + autoSalesKaspiAfterMidnight
            : vKaspi + autoSalesKaspiTotal,
        ),
        kaspi_before_midnight: isNightKaspiSplit
          ? String(vKaspiBeforeMidnight + autoSalesKaspiBeforeMidnight)
          : '',
      }
      const sendResult = await sendOne(fullForm)
      setPendingCount(await getPendingCount())
      setResult(sendResult)
      if (sendResult === 'success' || sendResult === 'queued') resetForm()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSplitConfirm() {
    setSplitDialog(false)
    setSubmitting(true)
    try {
      const fullForm: ShiftForm = {
        ...form,
        operator_id: session.operator.operator_id,
        kaspi_before_midnight: '',
      }

      const afterCash = parseMoney(splitAfter.cash)
      const afterKaspiPos = parseMoney(splitAfter.kaspi_pos)
      const afterKaspiOnline = parseMoney(splitAfter.kaspi_online)

      const entries: SplitEntry[] = [
        {
          date: form.date,
          cash: vCash - afterCash,
          kaspi_pos: vKaspi - afterKaspiPos,
          kaspi_online: vKaspiOnline - afterKaspiOnline,
        },
        {
          date: nextDayISO(form.date),
          cash: afterCash,
          kaspi_pos: afterKaspiPos,
          kaspi_online: afterKaspiOnline,
        },
      ]

      const sendResult = await sendSplit(fullForm, entries)
      setPendingCount(await getPendingCount())
      setResult(sendResult)
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSplitSkip() {
    setSplitDialog(false)
    setSubmitting(true)
    try {
      const fullForm: ShiftForm = {
        ...form,
        operator_id: session.operator.operator_id,
        kaspi_before_midnight: '',
      }
      const sendResult = await sendOne(fullForm)
      setPendingCount(await getPendingCount())
      setResult(sendResult)
      resetForm()
    } finally {
      setSubmitting(false)
    }
  }

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username
  const shiftLabel = form.shift === 'day' ? 'Дневная смена' : 'Ночная смена'
  const shiftIcon = form.shift === 'day' ? '☀️' : '🌙'
  const totalEntered = vCash + vCoins + vKaspiTotal + vKaspiOnline + vDebts + vStart + vWipon

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-5 drag-region">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-[0_10px_30px_rgba(255,255,255,0.08)]">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border/80 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Рабочий терминал
              </span>
              <span className="text-[11px] text-muted-foreground">{bootstrap.device.name || bootstrap.device.point_mode}</span>
            </div>
            <p className="text-sm font-semibold leading-none">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">{operatorName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          {isOffline ? (
            <Badge variant="warning" className="gap-1">
              <WifiOff className="h-3 w-3" />
              Оффлайн
            </Badge>
          ) : null}

          {pendingCount > 0 ? (
            <Badge
              variant="secondary"
              className="cursor-pointer gap-1 hover:opacity-80"
              onClick={() => setShowQueue(true)}
            >
              <Clock className="h-3 w-3" />
              {pendingCount} в очереди
            </Badge>
          ) : null}

          <WorkModeSwitch
            active="shift"
            showSale={hasInventorySale}
            showScanner={!!hasScanner}
            showRequest={hasInventoryRequest}
            onSale={onSwitchToSale}
            onScanner={hasScanner ? onSwitchToScanner : undefined}
            onRequest={onSwitchToRequest}
            onCabinet={onOpenCabinet}
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={doSync}
            disabled={syncing}
            className="text-muted-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </Button>

          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3 md:grid-cols-2">
              <ModeToggleCard
                title="Смена"
                description="Ввод выручки, расчёт ФАКТа и отправка сменного отчёта."
                active={viewMode === 'shift'}
                onClick={() => setViewMode('shift')}
                icon={<ReceiptText className="h-4 w-4" />}
              />
              {kaspiDailySplitEnabled ? (
                <ModeToggleCard
                  title="Суточный Kaspi"
                  description="Проверка календарных суток для ночной смены и ОПиУ."
                  active={viewMode === 'daily'}
                  onClick={() => setViewMode('daily')}
                  icon={<CalendarDays className="h-4 w-4" />}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-4 text-sm text-muted-foreground">
                  Суточная сверка Kaspi выключена для этого терминала.
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <TerminalStatusChip
                icon={<CalendarDays className="h-4 w-4" />}
                label="Дата смены"
                value={form.date}
              />
              <TerminalStatusChip
                icon={<Clock className="h-4 w-4" />}
                label="Очередь"
                value={pendingCount > 0 ? `${pendingCount} в очереди` : 'Пусто'}
                tone={pendingCount > 0 ? 'warning' : 'neutral'}
                onClick={pendingCount > 0 ? () => setShowQueue(true) : undefined}
              />
              <TerminalStatusChip
                icon={isOffline ? <WifiOff className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                label="Сеть"
                value={isOffline ? 'Оффлайн' : 'Онлайн'}
                tone={isOffline ? 'warning' : 'success'}
              />
            </div>
          </div>

          <div className="hidden items-center gap-2">
            <Button
              type="button"
              variant={viewMode === 'shift' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('shift')}
            >
              Смена
            </Button>
            {kaspiDailySplitEnabled ? (
              <Button
                type="button"
                variant={viewMode === 'daily' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('daily')}
              >
                Суточный Kaspi
              </Button>
            ) : null}
          </div>

          {viewMode === 'daily' && kaspiDailySplitEnabled ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <Card className="overflow-hidden border-primary/10 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]">
                  <CardContent className="space-y-5 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Суточная сверка
                        </div>
                        <div>
                          <h1 className="text-2xl font-semibold tracking-tight">Kaspi за календарные сутки</h1>
                          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                            Сумма собирается из дневной смены выбранной даты, ночной смены этой даты до 00:00 и хвоста прошлой ночной смены после 00:00.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            Точка
                          </div>
                          <div className="mt-1 text-sm font-medium">{session.company.name}</div>
                          <div className="text-xs text-muted-foreground">{bootstrap.device.name || bootstrap.device.point_mode}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <Calculator className="h-3.5 w-3.5" />
                            Режим
                          </div>
                          <div className="mt-1 text-sm font-medium">Kaspi split</div>
                          <div className="text-xs text-muted-foreground">Ночные смены до и после 00:00</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[220px_auto]">
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Дата суток</Label>
                        <Input
                          type="date"
                          value={dailyDate}
                          onChange={(event) => setDailyDate(event.target.value)}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => void loadDailyReport(dailyDate)}
                          disabled={dailyLoading}
                        >
                          <RefreshCw className={`h-4 w-4 ${dailyLoading ? 'animate-spin' : ''}`} />
                          Обновить
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-card/90">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Разбивка суточного Kaspi</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {dailyError ? (
                      <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                        {dailyError}
                      </div>
                    ) : null}

                    {!dailyError && dailyLoading ? (
                      <div className="flex h-32 items-center justify-center">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
                      </div>
                    ) : null}

                    {!dailyError && !dailyLoading && dailyReport ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-3">
                          {dailyReport.parts.map((part) => (
                            <div key={part.key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{part.label}</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(part.amount)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {part.rowCount > 0 ? `Смен: ${part.rowCount}` : 'Нет записей'}
                              </div>
                            </div>
                          ))}
                        </div>

                        {dailyReport.warning ? (
                          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                            {dailyReport.warning}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              <aside className="space-y-4 xl:sticky xl:top-5 xl:h-fit">
                <Card className="overflow-hidden border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]">
                  <CardContent className="space-y-4 p-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Kaspi за сутки</p>
                      <p className="mt-2 text-4xl font-semibold tabular-nums">
                        {dailyReport ? formatMoney(dailyReport.total) : '0'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{dailyDate}</p>
                    </div>
                    <Badge variant={dailyReport?.isPrecise === false ? 'warning' : 'secondary'}>
                      {dailyReport?.isPrecise === false ? 'Есть старые неточные смены' : 'Точный расчёт'}
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-card/90">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Формула суток</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-sm text-muted-foreground">
                    <div>Дневная смена даты</div>
                    <div>+ Ночная смена даты до 00:00</div>
                    <div>+ Ночная смена предыдущей даты после 00:00</div>
                    <div className="pt-2 text-xs text-muted-foreground/80">
                      `kaspi_amount` хранит полный Kaspi по смене, а `kaspi_before_midnight` нужен только для точной суточной сверки.
                    </div>
                  </CardContent>
                </Card>
              </aside>
            </div>
          ) : null}

          <div className={viewMode === 'shift' ? 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]' : 'hidden'}>
            <form id="shift-report-form" onSubmit={handleSubmit} className="space-y-4 no-drag">
              <Card className="overflow-hidden border-primary/10 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]">
                <CardContent className="space-y-5 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        <ReceiptText className="h-3.5 w-3.5" />
                        Рабочая смена
                      </div>
                      <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Отчёт по смене</h1>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          Быстрый ввод выручки с живым расчётом факта и итоговой суммы. Черновик сохраняется автоматически.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" />
                          Точка
                        </div>
                        <div className="mt-1 text-sm font-medium">{session.company.name}</div>
                        <div className="text-xs text-muted-foreground">{bootstrap.device.name || bootstrap.device.point_mode}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <UserCircle2 className="h-3.5 w-3.5" />
                          Оператор
                        </div>
                        <div className="mt-1 text-sm font-medium">{operatorName}</div>
                        <div className="text-xs text-muted-foreground">{shiftIcon} {shiftLabel}</div>
                      </div>
                    </div>
                  </div>

                  <div className="hidden flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1.5">
                      <CalendarDays className="h-3 w-3" />
                      {form.date}
                    </Badge>
                    <Badge variant="secondary" className="gap-1.5">
                      <Calculator className="h-3 w-3" />
                      Ввод: {formatMoney(totalEntered)}
                    </Badge>
                    {pendingCount > 0 ? (
                      <Badge variant="secondary" className="gap-1.5">
                        <Clock className="h-3 w-3" />
                        Очередь: {pendingCount}
                      </Badge>
                    ) : null}
                    {isOffline ? (
                      <Badge variant="warning" className="gap-1.5">
                        <WifiOff className="h-3 w-3" />
                        Сеть недоступна
                      </Badge>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <TerminalMiniStat label="Дата" value={form.date} />
                    <TerminalMiniStat label="Смена" value={`${shiftIcon} ${shiftLabel}`} />
                    <TerminalMiniStat label="Введено" value={formatMoney(totalEntered)} />
                    <TerminalMiniStat
                      label="Режим"
                      value={isNightKaspiSplit ? 'Kaspi split' : 'Стандартный'}
                      note={isNightKaspiSplit ? 'до и после 00:00' : 'без суточной разбивки'}
                    />
                  </div>

                  {hasInventorySale ? (
                    <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                            <ShoppingBasket className="h-4 w-4" />
                            Товарный контур этой смены
                          </div>
                          <p className="mt-1 text-xs text-emerald-100/80">
                            Продажи добавляются в итог автоматически, возвраты уменьшают его автоматически. В поля прихода их повторно вносить не нужно.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                            onClick={onSwitchToSale}
                          >
                            Продажи
                          </Button>
                          {onSwitchToReturn ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-amber-400/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                              onClick={onSwitchToReturn}
                            >
                              Возвраты
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-5">
                        <TerminalMiniStat
                          label="Продаж"
                          value={salesSummaryLoading ? '...' : String(salesSummary?.sale_count || 0)}
                          tone="success"
                        />
                        <TerminalMiniStat
                          label="Возвратов"
                          value={salesSummaryLoading ? '...' : String(salesSummary?.return_count || 0)}
                          tone="warning"
                        />
                        <TerminalMiniStat
                          label="Чистый нал"
                          value={salesSummaryLoading ? '...' : formatMoney(autoSalesCash)}
                          tone={autoSalesCash >= 0 ? 'success' : 'warning'}
                        />
                        <TerminalMiniStat
                          label={isNightKaspiSplit ? 'Чистый Kaspi до / после 00:00' : 'Чистый Kaspi'}
                          value={
                            salesSummaryLoading
                              ? '...'
                              : isNightKaspiSplit
                                ? `${formatMoney(autoSalesKaspiBeforeMidnight)} / ${formatMoney(autoSalesKaspiAfterMidnight)}`
                                : formatMoney(autoSalesKaspiTotal)
                          }
                          tone={autoSalesKaspiTotal >= 0 ? 'info' : 'warning'}
                        />
                        <TerminalMiniStat
                          label="Чистый итог"
                          value={salesSummaryLoading ? '...' : formatMoney(salesSummary?.total_amount || 0)}
                          tone={(salesSummary?.total_amount || 0) >= 0 ? 'warning' : 'destructive'}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Дата</Label>
                      <Input
                        type="date"
                        value={form.date}
                        onChange={(event) => setField('date', event.target.value)}
                        disabled={submitting}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Смена</Label>
                      <Select value={form.shift} onValueChange={(value) => setField('shift', value)}>
                        <SelectTrigger disabled={submitting}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="day">☀️ Дневная</SelectItem>
                          <SelectItem value="night">🌙 Ночная</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)]">
                <Card className="border-white/10 bg-card/90">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Приход</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Всё, что формирует факт по кассе на этой смене.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <MoneyInput label="Наличные" value={form.cash} onChange={(value) => setField('cash', value)} disabled={submitting} />
                    <MoneyInput label="Мелочь" value={form.coins} onChange={(value) => setField('coins', value)} disabled={submitting} />
                    {isNightKaspiSplit ? (
                      <>
                        <MoneyInput
                          label={`${kaspiLabel} до 00:00`}
                          value={form.kaspi_before_midnight}
                          onChange={(value) => setField('kaspi_before_midnight', value)}
                          disabled={submitting}
                          labelWidth="w-32"
                        />
                        <MoneyInput
                          label={`${kaspiLabel} после 00:00`}
                          value={form.kaspi_pos}
                          onChange={(value) => setField('kaspi_pos', value)}
                          disabled={submitting}
                          labelWidth="w-32"
                          note="в сумме это общий Kaspi смены"
                        />
                      </>
                    ) : (
                      <MoneyInput
                        label={kaspiLabel}
                        value={form.kaspi_pos}
                        onChange={(value) => setField('kaspi_pos', value)}
                        disabled={submitting}
                        labelWidth="w-32"
                      />
                    )}
                    {isArena ? (
                      <MoneyInput label="Kaspi Online" value={form.kaspi_online} onChange={(value) => setField('kaspi_online', value)} disabled={submitting} labelWidth="w-32" note="не входит в ФАКТ" />
                    ) : null}
                    <MoneyInput label="Тех. компенс." value={form.debts} onChange={(value) => setField('debts', value)} disabled={submitting} labelWidth="w-32" />
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card className="border-white/10 bg-card/90">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Вычеты</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Эти значения уменьшают итог по смене.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <MoneyInput label="Старт кассы" value={form.start} onChange={(value) => setField('start', value)} disabled={submitting} labelWidth="w-32" />
                      <MoneyInput label={wiponLabel} value={form.wipon} onChange={(value) => setField('wipon', value)} disabled={submitting} labelWidth="w-32" />
                    </CardContent>
                  </Card>

                  <Card className="border-white/10 bg-card/90">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Комментарий</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Input
                        value={form.comment}
                        onChange={(event) => setField('comment', event.target.value)}
                        placeholder="Например: позднее закрытие, инкассация, корректировка"
                        disabled={submitting}
                      />
                      {isNightKaspiSplit ? (
                        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">
                          <div className="flex items-start gap-2">
                            <SplitSquareVertical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>Для ночной смены Kaspi делится на две части: до 00:00 и после 00:00. В итоге смены будет учтена общая сумма.</span>
                          </div>
                        </div>
                      ) : null}
                      {isArena && !kaspiDailySplitEnabled && form.shift === 'night' && isLastDayOfMonth(form.date) ? (
                        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">
                          <div className="flex items-start gap-2">
                            <SplitSquareVertical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>Последний день месяца: перед отправкой программа предложит разбить ночную смену на две даты.</span>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </form>

            <aside className="space-y-4 xl:sticky xl:top-5 xl:h-fit">
              <Card className={`${itog < 0 ? 'border-destructive/30' : 'border-emerald-500/20'} overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]`}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Итог смены</p>
                      <p className={`mt-2 text-4xl font-semibold tabular-nums ${itog < 0 ? 'text-destructive-foreground' : 'text-foreground'}`}>
                        {itog > 0 ? '+' : ''}{formatMoney(itog)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">ФАКТ минус {wiponLabel}</p>
                    </div>
                    <Badge variant={itog < 0 ? 'destructive' : 'secondary'}>
                      {itog < 0 ? 'Недостача' : 'Готово'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">ФАКТ</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(fact)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{wiponLabel}</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(vWipon)}</div>
                    </div>
                  </div>

                  <Button form="shift-report-form" id="shift-submit-btn" type="submit" className="w-full gap-2" disabled={submitting} size="lg">
                    {submitting ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {submitting ? 'Отправляю...' : 'Отправить отчёт'}
                    {!submitting ? <span className="ml-auto text-xs opacity-60">Ctrl+↵</span> : null}
                  </Button>

                  {error ? (
                    <p className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {error}
                    </p>
                  ) : null}
                  {result === 'success' ? (
                    <p className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Отчёт отправлен успешно
                    </p>
                  ) : null}
                  {result === 'queued' ? (
                    <p className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      Нет сети — отчёт сохранён в локальную очередь
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-card/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Быстрые действия</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  <QuickActionButton
                    icon={<RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />}
                    label="Синхронизировать"
                    onClick={doSync}
                    disabled={syncing}
                  />
                  <QuickActionButton
                    icon={<Clock className="h-4 w-4" />}
                    label={pendingCount > 0 ? `Очередь: ${pendingCount}` : 'Очередь пуста'}
                    onClick={() => setShowQueue(true)}
                  />
                  {onSwitchToSale ? (
                    <QuickActionButton
                      icon={<ShoppingBasket className="h-4 w-4" />}
                      label="Продажи с витрины"
                      onClick={onSwitchToSale}
                    />
                  ) : null}
                  {onSwitchToReturn ? (
                    <QuickActionButton
                      icon={<ReceiptText className="h-4 w-4" />}
                      label="Возврат товара"
                      onClick={onSwitchToReturn}
                    />
                  ) : null}
                  {hasScanner ? (
                    <QuickActionButton
                      icon={<CreditCard className="h-4 w-4" />}
                      label="Открыть сканер"
                      onClick={onSwitchToScanner}
                    />
                  ) : null}
                  {onSwitchToRequest ? (
                    <QuickActionButton
                      icon={<ClipboardList className="h-4 w-4" />}
                      label="Заявка на склад"
                      onClick={onSwitchToRequest}
                    />
                  ) : null}
                  {onOpenCabinet ? (
                    <QuickActionButton
                      icon={<UserCircle2 className="h-4 w-4" />}
                      label="Мой кабинет"
                      onClick={onOpenCabinet}
                    />
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-card/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Формула расчёта</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <SummaryRow label="Наличные" value={vCash} />
                  <SummaryRow label="Мелочь" value={vCoins} />
                  <SummaryRow label={kaspiLabel} value={vKaspiTotal} />
                  {isNightKaspiSplit ? <SummaryRow label="до 00:00" value={vKaspiBeforeMidnight} dim /> : null}
                  {isNightKaspiSplit ? <SummaryRow label="после 00:00" value={vKaspi} dim /> : null}
                  {isArena ? <SummaryRow label="Kaspi Online" value={vKaspiOnline} dim /> : null}
                  <SummaryRow label="Тех. компенс." value={vDebts} />
                  <SummaryRow label="− Старт кассы" value={-vStart} highlight={vStart > 0} />
                  <div className="my-2 border-t border-border/70" />
                  <SummaryRow label="ФАКТ" value={fact} />
                  <SummaryRow label={`− ${wiponLabel}`} value={-vWipon} highlight={vWipon > 0} />
                  <div className="my-2 border-t border-border/70" />
                  <SummaryRow label="ИТОГ" value={itog} emphasize />
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-card/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Быстрые подсказки</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">После отправки</div>
                    <div className="mt-1 text-sm text-foreground/90">Если сеть есть, отчёт сразу уйдёт на сервер. Если сети нет, он автоматически попадёт в очередь.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Горячая клавиша</div>
                    <div className="mt-1 text-sm text-foreground/90">Используй <span className="font-medium">Ctrl+Enter</span>, чтобы отправить смену без мышки.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Режим точки</div>
                    <div className="mt-1 text-sm text-foreground/90">
                      {isArena
                        ? 'Arena: учитываем Kaspi Online и сценарий разбивки ночной смены на две даты.'
                        : 'Стандартный режим: быстрый отчёт без разбивки по датам.'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </div>

      {confirmDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className={`mx-4 w-full max-w-sm ${itog < 0 ? 'border-destructive/40' : ''}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {itog < 0 ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-destructive-foreground" />
                    Недостача — подтвердить?
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Подтвердить отчёт
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                <p className="mb-2 text-xs text-muted-foreground">
                  👤 {session.operator.short_name || session.operator.name || session.operator.username} · {form.date} · {form.shift === 'day' ? '☀️ Дневная' : '🌙 Ночная'}
                </p>
                {vCash > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Наличные</span><span>{formatMoney(vCash)} ₸</span></div> : null}
                {vCoins > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Мелочь</span><span>{formatMoney(vCoins)} ₸</span></div> : null}
                {vKaspiTotal > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">{kaspiLabel}</span><span>{formatMoney(vKaspiTotal)} ₸</span></div> : null}
                {isNightKaspiSplit && vKaspiBeforeMidnight > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">до 00:00</span><span>{formatMoney(vKaspiBeforeMidnight)} ₸</span></div> : null}
                {isNightKaspiSplit && vKaspi > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">после 00:00</span><span>{formatMoney(vKaspi)} ₸</span></div> : null}
                {isArena && vKaspiOnline > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Kaspi Online</span><span>{formatMoney(vKaspiOnline)} ₸</span></div> : null}
                {vDebts > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Тех</span><span>{formatMoney(vDebts)} ₸</span></div> : null}
                {vStart > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Старт</span><span>−{formatMoney(vStart)} ₸</span></div> : null}
                {vWipon > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">{wiponLabel}</span><span>−{formatMoney(vWipon)} ₸</span></div> : null}
                <div className="flex justify-between border-t border-white/10 pt-2 font-semibold">
                  <span>ИТОГ</span>
                  <span className={itog < 0 ? 'text-destructive-foreground' : 'text-emerald-400'}>
                    {itog > 0 ? '+' : ''}{formatMoney(itog)} ₸
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmDialog(false)}>
                  Исправить
                </Button>
                <Button className={`flex-1 ${itog < 0 ? 'bg-destructive hover:bg-destructive/90' : ''}`} onClick={handleConfirm}>
                  Отправить
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <QueueViewer open={showQueue} onClose={() => setShowQueue(false)} />

      {splitDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="mx-4 w-full max-w-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <SplitSquareVertical className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Разбивка по месяцу</CardTitle>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ночная смена в последний день месяца. Укажите суммы <b>после 00:00</b>, которые должны уйти на следующую дату.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 pb-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{form.date}</span>
                <span className="text-right font-medium text-foreground">{nextDayISO(form.date)}</span>
              </div>

              <MoneyInput
                label="Нал после 00:00"
                value={splitAfter.cash}
                onChange={(value) => setSplitAfter((current) => ({ ...current, cash: value }))}
                labelWidth="w-36"
              />
              <MoneyInput
                label="Kaspi POS после 00:00"
                value={splitAfter.kaspi_pos}
                onChange={(value) => setSplitAfter((current) => ({ ...current, kaspi_pos: value }))}
                labelWidth="w-36"
              />
              <MoneyInput
                label="Kaspi Online после 00:00"
                value={splitAfter.kaspi_online}
                onChange={(value) => setSplitAfter((current) => ({ ...current, kaspi_online: value }))}
                labelWidth="w-36"
              />

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={handleSplitSkip}>
                  Без разбивки
                </Button>
                <Button className="flex-1" onClick={handleSplitConfirm}>
                  Разбить
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function ModeToggleCard({
  title,
  description,
  active,
  onClick,
  icon,
}: {
  title: string
  description: string
  active: boolean
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-2xl border p-4 text-left transition-all ${
        active
          ? 'border-primary/30 bg-primary/10 shadow-[0_16px_40px_rgba(255,255,255,0.05)]'
          : 'border-white/10 bg-card/70 hover:border-primary/20 hover:bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            active ? 'bg-primary text-primary-foreground' : 'bg-black/20 text-muted-foreground'
          }`}
        >
          {icon}
        </div>
      </div>
    </button>
  )
}

function TerminalStatusChip({
  icon,
  label,
  value,
  tone = 'neutral',
  onClick,
}: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'neutral' | 'warning' | 'success'
  onClick?: () => void
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-500/20 bg-amber-500/10'
      : tone === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10'
        : 'border-white/10 bg-card/80'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left ${toneClass} ${onClick ? 'cursor-pointer transition-opacity hover:opacity-90' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </button>
  )
}

function TerminalMiniStat({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string
  value: string
  note?: string
  tone?: 'neutral' | 'success' | 'warning' | 'info' | 'destructive'
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'warning'
        ? 'text-amber-300'
        : tone === 'info'
          ? 'text-sky-300'
          : tone === 'destructive'
            ? 'text-rose-300'
            : 'text-foreground'

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${valueClass}`}>{value}</div>
      {note ? <div className="mt-1 text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  )
}

function QuickActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Button type="button" variant="outline" className="justify-start gap-2" onClick={onClick} disabled={disabled}>
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  )
}

function MoneyInput({
  label,
  value,
  onChange,
  disabled,
  labelWidth = 'w-24',
  note,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  labelWidth?: string
  note?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`${labelWidth} shrink-0`}>
        <Label className="block text-xs leading-none text-muted-foreground">{label}</Label>
        {note ? <span className="mt-1 block text-[10px] text-muted-foreground/60">{note}</span> : null}
      </div>
      <div className="relative flex-1">
        <Input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0"
          disabled={disabled}
          className="pr-6 text-right tabular-nums"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₸</span>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  highlight,
  dim,
  emphasize,
}: {
  label: string
  value: number
  highlight?: boolean
  dim?: boolean
  emphasize?: boolean
}) {
  const textClass = emphasize
    ? 'text-foreground'
    : highlight
      ? 'text-destructive-foreground/80'
      : dim
        ? 'text-muted-foreground/50'
        : 'text-muted-foreground'

  const valueClass = emphasize
    ? 'font-semibold text-foreground'
    : highlight
      ? 'text-destructive-foreground'
      : dim
        ? 'text-muted-foreground/50'
        : 'text-foreground'

  return (
    <div className="flex justify-between text-sm">
      <span className={textClass}>{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{formatMoney(value)}</span>
    </div>
  )
}
