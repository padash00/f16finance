import { useState, useEffect, useCallback } from 'react'
import { Send, Clock, LogOut, RefreshCw, CheckCircle2, AlertTriangle, SplitSquareVertical, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatMoney, parseMoney, todayISO, localRef } from '@/lib/utils'
import { toastSuccess, toastError } from '@/lib/toast'
import * as api from '@/lib/api'
import { syncQueue, getPendingCount, queueShiftReport } from '@/lib/offline'
import QueueViewer from '@/components/QueueViewer'
import type { AppConfig, BootstrapData, OperatorSession, ShiftForm } from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  isOffline?: boolean
  onLogout: () => void
  onSwitchToScanner?: () => void
}

// Разбивка выручки на 2 даты (Arena: ночная смена в последний день месяца)
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

export default function ShiftPage({ config, bootstrap, session, isOffline, onLogout, onSwitchToScanner }: Props) {
  const [form, setForm] = useState<ShiftForm>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if ('kaspi_online' in parsed) return parsed
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

  // Диалог подтверждения
  const [confirmDialog, setConfirmDialog] = useState(false)

  // Разбивка дат (только Arena)
  const [splitDialog, setSplitDialog] = useState(false)
  const [splitAfter, setSplitAfter] = useState({ cash: '', kaspi_pos: '', kaspi_online: '' })

  const flags = bootstrap.device.feature_flags
  const hasScanner = flags.debt_report && onSwitchToScanner

  const pointMode = (bootstrap.device.point_mode || '').toLowerCase()
  const isArena = pointMode.includes('arena')
  const wiponLabel = isArena ? 'Senet (система)' : 'Wipon (система)'
  const kaspiLabel = isArena ? 'Kaspi POS' : 'Kaspi'

  // Авто-определение смены по времени (только если нет сохранённого черновика)
  useEffect(() => {
    const hasDraft = !!localStorage.getItem(DRAFT_KEY)
    if (!hasDraft) {
      const hour = new Date().getHours()
      setForm(f => ({ ...f, shift: hour >= 8 && hour < 20 ? 'day' : 'night' }))
    }
  }, [])

  // Автосохранение черновика
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(form)), 500)
    return () => clearTimeout(t)
  }, [form])

  // Счётчик очереди
  useEffect(() => {
    const refresh = async () => setPendingCount(await getPendingCount())
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [])

  // Авто-синхронизация каждые 60 сек
  useEffect(() => {
    const interval = setInterval(async () => {
      const count = await getPendingCount()
      if (count > 0) doSync()
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Ctrl+Enter для отправки
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'Enter') {
        document.getElementById('shift-submit-btn')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  // Авто-синхронизация при восстановлении сети
  useEffect(() => {
    const handleOnline = () => doSync()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [doSync])

  // Формулы
  const vCash = parseMoney(form.cash)
  const vCoins = parseMoney(form.coins)
  const vKaspi = parseMoney(form.kaspi_pos)
  const vKaspiOnline = parseMoney(form.kaspi_online)
  const vDebts = parseMoney(form.debts)
  const vStart = parseMoney(form.start)
  const vWipon = parseMoney(form.wipon)

  const fact = vCash + vCoins + vKaspi + vDebts - vStart   // ФАКТ
  const itog = fact - vWipon                                 // ИТОГ

  function setField(key: keyof ShiftForm, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    setResult(null)
    setError(null)
  }

  function resetForm() {
    localStorage.removeItem(DRAFT_KEY)
    setForm(emptyForm())
    setResult(null)
    setError(null)
  }

  // ─── Отправка одного отчёта ────────────────────────────────────────────────
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

  // ─── Отправка с разбивкой на 2 даты ───────────────────────────────────────
  async function sendSplit(baseForm: ShiftForm, entries: SplitEntry[]): Promise<'success' | 'queued'> {
    let anyQueued = false
    for (const entry of entries) {
      const f: ShiftForm = {
        ...baseForm,
        date: entry.date,
        cash: String(entry.cash),
        kaspi_pos: String(entry.kaspi_pos),
        kaspi_online: String(entry.kaspi_online),
      }
      const r = await sendOne(f)
      if (r === 'queued') anyQueued = true
    }
    return anyQueued ? 'queued' : 'success'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (fact <= 0) { setError('Введите сумму выручки'); return }
    if (!session.operator.operator_id) { setError('Выберите оператора'); return }

    // Arena + ночная + последний день месяца → разбивка
    if (isArena && form.shift === 'night' && isLastDayOfMonth(form.date)) {
      setSplitAfter({ cash: '', kaspi_pos: '', kaspi_online: '' })
      setSplitDialog(true)
      return
    }

    // Показываем диалог подтверждения
    setConfirmDialog(true)
  }

  async function handleConfirm() {
    setConfirmDialog(false)
    setSubmitting(true)
    const fullForm: ShiftForm = { ...form, operator_id: session.operator.operator_id }
    const r = await sendOne(fullForm)
    setPendingCount(await getPendingCount())
    setResult(r)
    if (r === 'success' || r === 'queued') resetForm()
    setSubmitting(false)
  }

  async function handleSplitConfirm() {
    setSplitDialog(false)
    setSubmitting(true)

    const fullForm: ShiftForm = { ...form, operator_id: session.operator.operator_id }

    const afterCash = parseMoney(splitAfter.cash)
    const afterKaspiPos = parseMoney(splitAfter.kaspi_pos)
    const afterKaspiOnline = parseMoney(splitAfter.kaspi_online)

    const today = form.date
    const tomorrow = nextDayISO(form.date)

    const entries: SplitEntry[] = [
      {
        date: today,
        cash: vCash - afterCash,
        kaspi_pos: vKaspi - afterKaspiPos,
        kaspi_online: vKaspiOnline - afterKaspiOnline,
      },
      {
        date: tomorrow,
        cash: afterCash,
        kaspi_pos: afterKaspiPos,
        kaspi_online: afterKaspiOnline,
      },
    ]

    const r = await sendSplit(fullForm, entries)
    setPendingCount(await getPendingCount())
    setResult(r)
    resetForm()
    setSubmitting(false)
  }

  async function handleSplitSkip() {
    setSplitDialog(false)
    setSubmitting(true)
    const fullForm: ShiftForm = { ...form, operator_id: session.operator.operator_id }
    const r = await sendOne(fullForm)
    setPendingCount(await getPendingCount())
    setResult(r)
    resetForm()
    setSubmitting(false)
  }

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Drag region for Windows title bar controls */}
      <div className="h-9 drag-region shrink-0" />
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b bg-card px-5 gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">{operatorName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          {isOffline && (
            <Badge variant="warning" className="gap-1">
              <WifiOff className="h-3 w-3" /> Офлайн
            </Badge>
          )}

          {pendingCount > 0 && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:opacity-80"
              onClick={() => setShowQueue(true)}
            >
              <Clock className="h-3 w-3" />
              {pendingCount} в очереди
            </Badge>
          )}

          {hasScanner && (
            <Button variant="outline" size="sm" onClick={onSwitchToScanner}>
              Сканер
            </Button>
          )}

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

      {/* Content */}
      <div className="flex flex-1 items-start justify-center gap-5 overflow-auto p-5">
        {/* Form */}
        <Card className="w-full max-w-sm shrink-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Отчёт по смене</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4 no-drag">
              {/* Date + Shift */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Дата</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={e => setField('date', e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Смена</Label>
                  <Select value={form.shift} onValueChange={v => setField('shift', v)}>
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

              <Separator />

              {/* Приход */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Приход</p>
                <MoneyInput label="Наличные" value={form.cash} onChange={v => setField('cash', v)} disabled={submitting} />
                <MoneyInput label="Мелочь" value={form.coins} onChange={v => setField('coins', v)} disabled={submitting} />
                <MoneyInput label={kaspiLabel} value={form.kaspi_pos} onChange={v => setField('kaspi_pos', v)} disabled={submitting} labelWidth="w-32" />
                {isArena && (
                  <MoneyInput label="Kaspi Online" value={form.kaspi_online} onChange={v => setField('kaspi_online', v)} disabled={submitting} labelWidth="w-32" note="не в ФАКТ" />
                )}
                <MoneyInput label="Тех (компенс.)" value={form.debts} onChange={v => setField('debts', v)} disabled={submitting} labelWidth="w-32" />
              </div>

              <Separator />

              {/* Вычет */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Вычет</p>
                <MoneyInput label="Старт (касса)" value={form.start} onChange={v => setField('start', v)} disabled={submitting} labelWidth="w-32" />
                <MoneyInput label={wiponLabel} value={form.wipon} onChange={v => setField('wipon', v)} disabled={submitting} labelWidth="w-32" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Комментарий</Label>
                <Input
                  value={form.comment}
                  onChange={e => setField('comment', e.target.value)}
                  placeholder="Необязательно"
                  disabled={submitting}
                />
              </div>

              {/* Arena: подсказка разбивки */}
              {isArena && form.shift === 'night' && isLastDayOfMonth(form.date) && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 text-xs text-primary">
                  <SplitSquareVertical className="h-3.5 w-3.5 shrink-0" />
                  Последний день месяца — при отправке спросим про разбивку дат
                </div>
              )}

              {error && (
                <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
                </p>
              )}

              {result === 'success' && (
                <p className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Отчёт отправлен
                </p>
              )}
              {result === 'queued' && (
                <p className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Нет сети — сохранено в очередь
                </p>
              )}

              <Button id="shift-submit-btn" type="submit" className="w-full gap-2" disabled={submitting} size="lg">
                {submitting
                  ? <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                  : <Send className="h-4 w-4" />
                }
                {submitting ? 'Отправляю...' : 'Отправить отчёт'}
                {!submitting && <span className="ml-auto text-xs opacity-50">Ctrl+↵</span>}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Summary card */}
        <div className="w-60 space-y-3 shrink-0">
          {/* ФАКТ */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">ФАКТ</p>
                <p className="text-3xl font-bold tabular-nums">{formatMoney(fact)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  нал + мелочь + {isArena ? 'kaspi pos' : 'kaspi'} + тех − старт
                </p>
              </div>
              {(vCash + vCoins + vKaspi + vDebts + vStart) > 0 && (
                <div className="space-y-1.5 pt-1">
                  {vCash > 0 && <SummaryRow label="Наличные" value={vCash} />}
                  {vCoins > 0 && <SummaryRow label="Мелочь" value={vCoins} />}
                  {vKaspi > 0 && <SummaryRow label={kaspiLabel} value={vKaspi} />}
                  {isArena && vKaspiOnline > 0 && <SummaryRow label="Kaspi Online" value={vKaspiOnline} dim />}
                  {vDebts > 0 && <SummaryRow label="Тех" value={vDebts} />}
                  {vStart > 0 && <SummaryRow label="− Старт" value={-vStart} highlight />}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ИТОГ */}
          <Card className={itog < 0 ? 'border-destructive/40' : ''}>
            <CardContent className="pt-5 space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">ИТОГ = ФАКТ − {wiponLabel}</p>
                <p className={`text-3xl font-bold tabular-nums ${itog < 0 ? 'text-destructive-foreground' : ''}`}>
                  {itog > 0 ? '+' : ''}{formatMoney(itog)}
                </p>
              </div>
              {vWipon > 0 && (
                <SummaryRow label={`− ${wiponLabel}`} value={-vWipon} highlight />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Диалог подтверждения ─── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className={`w-full max-w-sm mx-4 ${itog < 0 ? 'border-destructive/40' : ''}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {itog < 0
                  ? <><AlertTriangle className="h-4 w-4 text-destructive-foreground" /> Недостача — подтвердить?</>
                  : <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Подтвердить отчёт</>
                }
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-1.5 text-sm">
                <p className="text-xs text-muted-foreground mb-2">
                  👤 {session.operator.short_name || session.operator.name || session.operator.username} · {form.date} · {form.shift === 'day' ? '☀️ Дневная' : '🌙 Ночная'}
                </p>
                {vCash > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Наличные</span><span>{formatMoney(vCash)} ₸</span></div>}
                {vCoins > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Мелочь</span><span>{formatMoney(vCoins)} ₸</span></div>}
                {vKaspi > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{kaspiLabel}</span><span>{formatMoney(vKaspi)} ₸</span></div>}
                {isArena && vKaspiOnline > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Kaspi Online</span><span>{formatMoney(vKaspiOnline)} ₸</span></div>}
                {vDebts > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Тех</span><span>{formatMoney(vDebts)} ₸</span></div>}
                {vStart > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Старт</span><span>−{formatMoney(vStart)} ₸</span></div>}
                {vWipon > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{wiponLabel}</span><span>−{formatMoney(vWipon)} ₸</span></div>}
                <div className="border-t border-white/10 pt-2 flex justify-between font-semibold">
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
                <Button
                  className={`flex-1 ${itog < 0 ? 'bg-destructive hover:bg-destructive/90' : ''}`}
                  onClick={handleConfirm}
                >
                  Отправить
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <QueueViewer open={showQueue} onClose={() => setShowQueue(false)} />

      {/* ─── Диалог разбивки дат (Arena, ночная, последний день месяца) ─── */}
      {splitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-sm mx-4">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <SplitSquareVertical className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Разбивка по месяцу</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Ночная смена в последний день месяца.<br />
                Укажите суммы <b>после 00:00</b> (следующий месяц).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pb-1">
                <span className="font-medium text-foreground">{form.date}</span>
                <span className="font-medium text-foreground text-right">{nextDayISO(form.date)}</span>
              </div>

              <MoneyInput
                label="Нал после 00:00"
                value={splitAfter.cash}
                onChange={v => setSplitAfter(s => ({ ...s, cash: v }))}
                labelWidth="w-36"
              />
              <MoneyInput
                label="Kaspi POS после 00:00"
                value={splitAfter.kaspi_pos}
                onChange={v => setSplitAfter(s => ({ ...s, kaspi_pos: v }))}
                labelWidth="w-36"
              />
              <MoneyInput
                label="Kaspi Online после 00:00"
                value={splitAfter.kaspi_online}
                onChange={v => setSplitAfter(s => ({ ...s, kaspi_online: v }))}
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
      )}
    </div>
  )
}

function MoneyInput({ label, value, onChange, disabled, labelWidth = 'w-24', note }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  labelWidth?: string
  note?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`${labelWidth} shrink-0`}>
        <Label className="text-xs text-muted-foreground leading-none">{label}</Label>
        {note && <span className="text-[10px] text-muted-foreground/60 block">{note}</span>}
      </div>
      <div className="relative flex-1">
        <Input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          disabled={disabled}
          className="pr-6 text-right tabular-nums"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₸</span>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, highlight, dim }: { label: string; value: number; highlight?: boolean; dim?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={highlight ? 'text-destructive-foreground/70' : dim ? 'text-muted-foreground/50' : 'text-muted-foreground'}>
        {label}
      </span>
      <span className={`tabular-nums font-medium ${highlight ? 'text-destructive-foreground' : dim ? 'text-muted-foreground/50' : ''}`}>
        {formatMoney(value)}
      </span>
    </div>
  )
}
