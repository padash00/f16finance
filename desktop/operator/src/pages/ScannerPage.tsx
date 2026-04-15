import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ScanBarcode, Plus, Trash2, RefreshCw, LogOut, Clock,
  CheckCircle2, AlertTriangle, ReceiptText, Package, WifiOff, KeyRound
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import WorkModeSwitch from '@/components/WorkModeSwitch'
import { formatMoney, localRef } from '@/lib/utils'
import { toastSuccess, toastError } from '@/lib/toast'
import * as api from '@/lib/api'
import { queueCreateDebt, queueDeleteDebt, syncQueue, getPendingCount } from '@/lib/offline'
import { getCachedProducts, saveProductsCache } from '@/lib/cache'
import QueueViewer from '@/components/QueueViewer'
import type { AppConfig, BootstrapData, OperatorBasic, OperatorSession, Product, DebtItem } from '@/types'

/** Подпись в списке должников: роль не дублируем, если уже есть в ФИО (напр. «Руководитель Иванов»). */
function debtorSelectDisplay(op: OperatorBasic): string {
  const primary = (op.short_name || op.full_name || op.name || '').trim() || '—'
  const role = (op.role_label || '').trim()
  if (!role) return primary
  const p = primary.toLowerCase()
  const r = role.toLowerCase()
  if (p.includes(r)) return primary
  return `${primary} · ${role}`
}

function debtDebtorPayload(
  selectedId: string,
  list: OperatorBasic[],
): { operator_id: string | null; client_name: string | null } {
  if (selectedId.startsWith('staff:') || selectedId.startsWith('orgmember:')) {
    const row = list.find((o) => o.id === selectedId)
    const clientName = (row?.short_name || row?.full_name || row?.name || '').trim()
    return { operator_id: null, client_name: clientName || null }
  }
  return { operator_id: selectedId?.trim() || null, client_name: null }
}

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  isOffline?: boolean
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToSale?: () => void
  onSwitchToRequest?: () => void
  onSwitchToArena?: () => void
  onOpenCabinet?: () => void
}

export default function ScannerPage({ config, bootstrap, session, isOffline: initOffline, onLogout, onSwitchToShift, onSwitchToSale, onSwitchToRequest, onSwitchToArena, onOpenCabinet }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [debts, setDebts] = useState<DebtItem[]>([])
  const [allOperators, setAllOperators] = useState<OperatorBasic[]>([])
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(initOffline ?? false)

  // Форма долга
  const [operatorId, setOperatorId] = useState(session.operator.operator_id)
  const [quantity, setQuantity] = useState('1')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flashMsg, setFlashMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Подтверждение удаления
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [debtFilterOpId, setDebtFilterOpId] = useState<string>('all')

  // Админ-модал
  const [adminTarget, setAdminTarget] = useState<{ id: string; item_name: string; total_amount: number } | null>(null)
  const [adminToken, setAdminTokenInput] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  // Сканер
  const [scannedBarcode, setScannedBarcode] = useState('')
  const [foundProduct, setFoundProduct] = useState<Product | null>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Поиск по названию
  const [nameSearch, setNameSearch] = useState('')
  const [showNameSearch, setShowNameSearch] = useState(false)

  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showQueue, setShowQueue] = useState(false)

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [foundProduct])

  useEffect(() => {
    const i = setInterval(async () => {
      const count = await getPendingCount()
      if (count > 0) doSync()
    }, 60000)
    return () => clearInterval(i)
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [prodsResult, opsResult, debtsResult] = await Promise.allSettled([
        api.getProducts(config, session.company.id),
        api.getAllOperators(config, session.company.id),
        api.getDebts(config, session.company.id),
      ])

      if (prodsResult.status === 'fulfilled') {
        saveProductsCache(prodsResult.value).catch(() => null)
        setProducts(prodsResult.value.filter(p => p.is_active))
        setOffline(false)
      } else {
        const cached = await getCachedProducts()
        setProducts(cached.filter(p => p.is_active))
        setOffline(true)
      }

      const sessionOpEntry: OperatorBasic = {
        id: session.operator.operator_id,
        name: session.operator.name || session.operator.username,
        short_name: session.operator.short_name || null,
        full_name: session.operator.full_name || null,
        role_label: null,
      }
      if (opsResult.status === 'fulfilled') {
        const ops = opsResult.value
        const alreadyIn = ops.some(o => o.id === sessionOpEntry.id)
        setAllOperators(alreadyIn ? ops : [sessionOpEntry, ...ops])
      } else {
        const fallback = bootstrap.operators.map(
          (o): OperatorBasic => ({
            id: o.id,
            name: o.name,
            short_name: o.short_name,
            full_name: o.full_name,
            role_label: null,
          }),
        )
        if (!fallback.some(o => o.id === sessionOpEntry.id)) {
          fallback.unshift(sessionOpEntry)
        }
        setAllOperators(fallback)
      }

      setDebts(debtsResult.status === 'fulfilled' ? debtsResult.value : [])
      setPendingCount(await getPendingCount())
    } finally {
      setLoading(false)
    }
  }

  const doSync = useCallback(async () => {
    setSyncing(true)
    try {
      const { synced, failed } = await syncQueue(config)
      setPendingCount(await getPendingCount())
      if (synced > 0) {
        toastSuccess(`Синхронизировано: ${synced} ${synced === 1 ? 'запись' : 'записей'}`)
        await loadAll()
      }
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

  // ─── Обработка штрихкода ─────────────────────────────────────────────────
  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScannedBarcode(e.target.value)
    setFoundProduct(null)
  }

  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const code = scannedBarcode.trim()
      if (!code) return
      const product = products.find(p => p.barcode === code)
      if (product) {
        setFoundProduct(product)
        setQuantity('1')
        setComment('')
        flash('ok', `Найден: ${product.name} — ${formatMoney(product.price)}`)
        playBeep('success')
      } else {
        flash('err', `Штрихкод не найден: ${code}`)
        playBeep('error')
      }
    }
  }

  function flash(type: 'ok' | 'err', text: string) {
    setFlashMsg({ type, text })
    setTimeout(() => setFlashMsg(null), 3000)
  }

  // ─── Добавление долга ─────────────────────────────────────────────────────
  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault()
    if (!foundProduct) return
    const qty = Math.max(1, parseInt(quantity) || 1)
    const total = foundProduct.price * qty
    const ref = localRef()

    setSubmitting(true)
    try {
      const debtor = debtDebtorPayload(operatorId, allOperators)
      await api.createDebt(config, {
        operator_id: debtor.operator_id,
        client_name: debtor.client_name,
        item_name: foundProduct.name,
        barcode: foundProduct.barcode,
        quantity: qty,
        unit_price: foundProduct.price,
        total_amount: total,
        comment: comment || null,
        local_ref: ref,
        created_by_operator_id: session.operator.operator_id,
      }, session.company.id)

      flash('ok', `Долг: ${foundProduct.name} × ${qty} = ${formatMoney(total)}`)
      playBeep('success')
      setFoundProduct(null)
      setScannedBarcode('')
      setQuantity('1')
      setComment('')
      barcodeInputRef.current?.focus()
      api.getDebts(config, session.company.id).then(setDebts).catch(() => {})
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка отправки долга'
      const canQueueOffline =
        message === 'Failed to fetch' ||
        message.includes('fetch') ||
        message.includes('NetworkError') ||
        message.includes('Load failed')

      if (!canQueueOffline) {
        const errorMap: Record<string, string> = {
          'inventory-debt-item-not-found': 'Товар не найден в инвентаре — добавьте его на сайте Orda',
          'inventory-debt-quantity-invalid': 'Неверное количество',
          'inventory-debt-location-not-found': 'Склад точки не настроен — обратитесь к администратору',
          'inventory-insufficient-stock':
            'На витрине точки нет столько товара — переместите со склада в Orda или уменьшите количество',
          'debt-report-disabled-for-device':
            'Долги для этой точки отключены — включите «Долги и сканер» в настройках проекта Orda (или для компании)',
          'operator-not-found': 'Оператор не найден или неактивен',
          'debt-delete-window-expired': 'Удалить можно только в течение 15 минут',
        }
        const friendlyMsg =
          errorMap[message] ||
          (message.includes('inventory_balances_quantity_check')
            ? errorMap['inventory-insufficient-stock']
            : message)
        flash('err', friendlyMsg)
        return
      }

      const debtorQ = debtDebtorPayload(operatorId, allOperators)
      await queueCreateDebt({
        operator_id: debtorQ.operator_id,
        client_name: debtorQ.client_name,
        item_name: foundProduct.name,
        barcode: foundProduct.barcode,
        quantity: qty,
        unit_price: foundProduct.price,
        total_amount: total,
        comment: comment || null,
        local_ref: ref,
        created_by_operator_id: session.operator.operator_id,
      }, session.company.id)
      setPendingCount(await getPendingCount())
      flash('ok', `Сохранено в очередь (нет сети)`)
      setFoundProduct(null)
      setScannedBarcode('')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Удаление долга (с подтверждением) ────────────────────────────────────
  async function handleDeleteConfirmed(itemId: string) {
    setDeleteConfirm(null)
    try {
      await api.deleteDebt(config, itemId, session.company.id, session.operator.operator_id)
    } catch {
      await queueDeleteDebt(itemId, session.company.id)
      setPendingCount(await getPendingCount())
    }
    setDebts(prev => prev.filter(d => d.id !== itemId))
  }

  async function handleAdminDelete() {
    if (!adminTarget) return
    setAdminLoading(true)
    setAdminError(null)
    try {
      await api.deleteDebt(config, adminTarget.id, session.company.id, null, adminToken)
      setDebts(prev => prev.filter(d => d.id !== adminTarget.id))
      setAdminTarget(null)
      setAdminTokenInput('')
      toastSuccess('Долг удалён (инвентарь возвращён)')
    } catch (err: any) {
      setAdminError(err?.message === 'admin-token-required' ? 'Неверный токен' : (err?.message || 'Ошибка'))
    } finally {
      setAdminLoading(false)
    }
  }

  async function handleAdminPay() {
    if (!adminTarget) return
    setAdminLoading(true)
    setAdminError(null)
    try {
      await api.adminPayDebt(config, adminTarget.id, adminToken, session.company.id)
      setDebts(prev => prev.filter(d => d.id !== adminTarget.id))
      setAdminTarget(null)
      setAdminTokenInput('')
      toastSuccess('Долг отмечен оплаченным')
    } catch (err: any) {
      setAdminError(err?.message === 'admin-token-required' ? 'Неверный токен' : (err?.message || 'Ошибка'))
    } finally {
      setAdminLoading(false)
    }
  }

  const totalDebt = debts.reduce((s, d) => s + d.total_amount, 0)

  const debtOperators = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of debts) {
      if (d.operator_id && d.debtor_name) map.set(d.operator_id, d.debtor_name)
    }
    return [...map.entries()]
  }, [debts])

  const filteredDebts = debtFilterOpId === 'all'
    ? debts
    : debts.filter(d => d.operator_id === debtFilterOpId)

  const nameSearchResults = nameSearch.trim().length >= 2
    ? products.filter(p => p.name.toLowerCase().includes(nameSearch.toLowerCase())).slice(0, 8)
    : []

  function selectProductFromSearch(product: Product) {
    setFoundProduct(product)
    setQuantity('1')
    setComment('')
    setNameSearch('')
    setShowNameSearch(false)
    flash('ok', `Найден: ${product.name} — ${formatMoney(product.price)}`)
    playBeep('success')
  }

  function playBeep(type: 'success' | 'error') {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      if (type === 'success') {
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.2, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.12)
      } else {
        osc.type = 'sawtooth'
        osc.frequency.value = 180
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.4)
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 pb-3 no-drag">
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
          {offline && (
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
              <Clock className="h-3 w-3" /> {pendingCount} в очереди
            </Badge>
          )}

          <WorkModeSwitch
            active="scanner"
            showSale={!!onSwitchToSale}
            showScanner
            showRequest={!!onSwitchToRequest}
            showArena={!!onSwitchToArena}
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onRequest={onSwitchToRequest}
            onArena={onSwitchToArena}
            onCabinet={onOpenCabinet}
          />

          <Button variant="ghost" size="sm" onClick={doSync} disabled={syncing} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </Button>

          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 gap-5 overflow-hidden p-5">
        {/* Left: scanner form */}
        <div className="w-80 shrink-0 flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ScanBarcode className="h-4 w-4" /> Сканер штрихкода
                {offline && <span className="text-xs font-normal text-amber-500">(кеш)</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 no-drag">
              <div className="space-y-1.5">
                <Label className="text-xs">Штрихкод</Label>
                <Input
                  ref={barcodeInputRef}
                  value={scannedBarcode}
                  onChange={handleBarcodeChange}
                  onKeyDown={handleBarcodeKeyDown}
                  placeholder="Сканируйте или введите код..."
                  className="font-mono"
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Нажмите Enter после сканирования</p>
                  <button
                    type="button"
                    onClick={() => { setShowNameSearch(!showNameSearch); setNameSearch('') }}
                    className="text-xs text-primary hover:underline cursor-pointer"
                  >
                    {showNameSearch ? 'Скрыть поиск' : 'Найти по названию'}
                  </button>
                </div>
              </div>

              {showNameSearch && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Поиск по названию</Label>
                  <Input
                    value={nameSearch}
                    onChange={e => setNameSearch(e.target.value)}
                    placeholder="Введите название товара..."
                    autoFocus={showNameSearch}
                  />
                  {nameSearchResults.length > 0 && (
                    <div className="rounded-md border bg-popover shadow-md overflow-hidden">
                      {nameSearchResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProductFromSearch(p)}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer text-left"
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="ml-2 shrink-0 tabular-nums text-muted-foreground text-xs">{formatMoney(p.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {nameSearch.trim().length >= 2 && nameSearchResults.length === 0 && (
                    <p className="text-xs text-muted-foreground">Ничего не найдено</p>
                  )}
                </div>
              )}

              {flashMsg && (
                <p className={`rounded-md px-3 py-2 text-xs flex items-center gap-2 ${
                  flashMsg.type === 'ok'
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-destructive/10 border border-destructive/20 text-destructive-foreground'
                }`}>
                  {flashMsg.type === 'ok'
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                  {flashMsg.text}
                </p>
              )}

              {foundProduct && (
                <>
                  <Separator />
                  <div className="rounded-lg bg-muted/50 border p-3 space-y-1">
                    <p className="text-sm font-medium">{foundProduct.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {foundProduct.barcode} · {formatMoney(foundProduct.price)} / шт.
                    </p>
                  </div>

                  <form onSubmit={handleAddDebt} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Оператор (должник)</Label>
                      <Select value={operatorId} onValueChange={setOperatorId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите оператора" />
                        </SelectTrigger>
                        <SelectContent>
                          {allOperators.map(op => (
                            <SelectItem key={op.id} value={op.id}>
                              {debtorSelectDisplay(op)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="space-y-1.5 flex-1">
                        <Label className="text-xs">Количество</Label>
                        <Input
                          type="number"
                          min="1"
                          value={quantity}
                          onChange={e => setQuantity(e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <Label className="text-xs">Сумма</Label>
                        <p className="h-10 flex items-center text-sm font-semibold tabular-nums px-3 rounded-md bg-muted/50 border">
                          {formatMoney(foundProduct.price * (parseInt(quantity) || 1))}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Комментарий</Label>
                      <Input
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        placeholder="Необязательно"
                        disabled={submitting}
                      />
                    </div>

                    <Button type="submit" className="w-full gap-2" disabled={submitting}>
                      {submitting
                        ? <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                        : <Plus className="h-4 w-4" />}
                      Добавить долг
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: debts list */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Долги за неделю
              <Badge variant="secondary">{filteredDebts.length}</Badge>
              {totalDebt > 0 && (
                <span className="text-xs font-normal text-destructive-foreground tabular-nums">
                  · {formatMoney(totalDebt)}
                </span>
              )}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => api.getDebts(config, session.company.id).then(setDebts).catch(() => {})} className="text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Обновить
            </Button>
          </div>

          {debtOperators.length > 1 && (
            <div className="mb-2">
              <select
                value={debtFilterOpId}
                onChange={e => setDebtFilterOpId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-xs text-foreground"
              >
                <option value="all">Все операторы ({debts.length})</option>
                {debtOperators.map(([id, name]) => (
                  <option key={id} value={id}>{name} ({debts.filter(d => d.operator_id === id).length})</option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="animate-spin h-6 w-6 border-2 border-border border-t-foreground rounded-full" />
            </div>
          ) : debts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Package className="h-10 w-10 opacity-20" />
              <p className="text-sm">Долгов нет</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto space-y-2">
              {filteredDebts.map(debt => (
                <div key={debt.id} className="flex items-start justify-between rounded-lg border bg-card px-4 py-3 gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{debt.item_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {debt.debtor_name} · {debt.quantity} шт.
                      {debt.comment && <> · {debt.comment}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-semibold tabular-nums text-destructive-foreground">
                      {formatMoney(debt.total_amount)}
                    </span>
                    {(debt.operator_id === session.operator.operator_id ||
                      debt.created_by_operator_id === session.operator.operator_id) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive-foreground"
                        onClick={() => setDeleteConfirm(debt.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <div className="h-7 w-7" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground/40 hover:text-amber-500"
                      title="Админ: удалить или оплатить"
                      onClick={() => { setAdminTarget({ id: debt.id, item_name: debt.item_name, total_amount: debt.total_amount }); setAdminTokenInput(''); setAdminError(null) }}
                    >
                      <KeyRound className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <QueueViewer open={showQueue} onClose={() => setShowQueue(false)} />

      {/* ─── Админ-модал ─── */}
      {adminTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-xs mx-4">
            <CardContent className="pt-5 space-y-4">
              <p className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-500" /> Действие администратора
              </p>
              <p className="text-xs text-muted-foreground">
                {adminTarget.item_name} — <span className="font-medium">{formatMoney(adminTarget.total_amount)}</span>
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Admin Token</Label>
                <Input
                  type="password"
                  value={adminToken}
                  onChange={e => { setAdminTokenInput(e.target.value); setAdminError(null) }}
                  placeholder="Введите токен..."
                  autoFocus
                />
                {adminError && <p className="text-xs text-destructive">{adminError}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={!adminToken || adminLoading}
                  onClick={handleAdminDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить (вернуть инвентарь)
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2 border-emerald-500/30 text-emerald-400 hover:text-emerald-300"
                  disabled={!adminToken || adminLoading}
                  onClick={handleAdminPay}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Оплатил долг (без возврата)
                </Button>
                <Button variant="ghost" className="w-full" disabled={adminLoading} onClick={() => setAdminTarget(null)}>
                  Отмена
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Диалог подтверждения удаления ─── */}
      {deleteConfirm && (() => {
        const debt = debts.find(d => d.id === deleteConfirm)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <Card className="w-full max-w-xs mx-4">
              <CardContent className="pt-5 space-y-4">
                <p className="text-sm">
                  Удалить долг <strong>{debt?.item_name}</strong>?
                  {debt && <span className="block text-xs text-muted-foreground mt-1">{debt.debtor_name} · {formatMoney(debt.total_amount)}</span>}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                    Отмена
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => handleDeleteConfirmed(deleteConfirm)}>
                    Удалить
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )
      })()}
    </div>
  )
}
