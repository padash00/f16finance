import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { getQueueItems, retryAll, retryItem, QUEUE_CHANGED_EVENT } from '@/lib/offline'
import { toastError, toastSuccess } from '@/lib/toast'
import type { AppConfig, QueueItem } from '@/types'

interface Props {
  config: AppConfig
  onClose: () => void
}

const TYPE_LABELS: Record<string, string> = {
  shift_report: 'Отчёт смены',
  close_shift: 'Закрытие смены',
  create_debt: 'Создание долга',
  delete_debt: 'Удаление долга',
  inventory_sale: 'Продажа POS',
  inventory_return: 'Возврат POS',
  inventory_request: 'Заявка на товар',
  checklist_run: 'Чек-лист',
}

/** Сумма операции из payload (для продаж/возвратов/долгов), если доступна */
function itemAmount(item: QueueItem): number | null {
  const p = item.payload || {}
  const direct = Number(p.total_amount)
  if (Number.isFinite(direct) && direct > 0) return direct
  const cash = Number(p.cash_amount)
  const kaspi = Number(p.kaspi_amount)
  if (Number.isFinite(cash) || Number.isFinite(kaspi)) {
    const sum = (Number.isFinite(cash) ? cash : 0) + (Number.isFinite(kaspi) ? kaspi : 0)
    if (sum > 0) return sum
  }
  const lines = p.items
  if (Array.isArray(lines) && lines.length > 0) {
    const sum = lines.reduce((acc, l: any) => {
      const q = Number(l?.quantity)
      const price = Number(l?.unit_price)
      return acc + (Number.isFinite(q) && Number.isFinite(price) ? q * price : 0)
    }, 0)
    if (sum > 0) return sum
  }
  return null
}

function formatAmount(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₸`
}

function isAttention(item: QueueItem): boolean {
  return item.status === 'attention' || item.status === 'failed'
}

export default function QueuePage({ config, onClose }: Props) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [sendingId, setSendingId] = useState<number | null>(null)
  const [sendingAll, setSendingAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems(await getQueueItems())
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void load()
    window.addEventListener(QUEUE_CHANGED_EVENT, load)
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, load)
  }, [load])

  async function handleSendOne(item: QueueItem) {
    if (sendingId !== null || sendingAll) return
    setSendingId(item.id)
    try {
      const result = await retryItem(config, item.id)
      if (result.synced > 0) {
        toastSuccess('Операция отправлена')
      } else {
        const fresh = (await getQueueItems()).find((i) => i.id === item.id)
        toastError(fresh?.last_error || 'Не удалось отправить — попробуем позже')
      }
    } finally {
      setSendingId(null)
      void load()
    }
  }

  async function handleSendAll() {
    if (sendingId !== null || sendingAll) return
    setSendingAll(true)
    try {
      const result = await retryAll(config)
      if (result.synced > 0) toastSuccess(`Отправлено: ${result.synced}`)
      if (result.failed > 0) toastError(`Не отправлено (нет связи): ${result.failed}`)
      if (result.attention > 0) toastError(`Отклонено сервером: ${result.attention}`)
      if (result.synced === 0 && result.failed === 0 && result.attention === 0) {
        toastSuccess('Очередь пуста')
      }
    } finally {
      setSendingAll(false)
      void load()
    }
  }

  const list = items || []
  const attentionCount = list.filter(isAttention).length
  const busy = sendingAll || sendingId !== null

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      {/* Header */}
      <header className="drag-region flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="no-drag flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-9 gap-2 px-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Очередь отправки</span>
            {list.length > 0 && (
              <Badge variant={attentionCount > 0 ? 'destructive' : 'warning'} className="text-[11px]">
                {list.length}
              </Badge>
            )}
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} className="h-9 w-9 p-0 text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${items === null ? 'animate-spin' : ''}`} />
          </Button>
          {list.length > 0 && (
            <Button size="sm" onClick={() => void handleSendAll()} disabled={busy} className="h-9 gap-2">
              {sendingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Отправить все
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mx-auto w-full max-w-2xl space-y-2.5">
          {items === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-3 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 text-emerald-500/60" />
              <p className="text-base font-medium text-foreground">Все операции отправлены ✓</p>
              <p className="text-sm">Очередь пуста — ничего не ждёт отправки</p>
            </div>
          ) : (
            <>
              {attentionCount > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  Сервер отклонил {attentionCount === 1 ? 'операцию' : `операции: ${attentionCount}`}. Прочитайте текст
                  ошибки и нажмите «Повторить» — или сообщите администратору. Операции не удаляются и не теряются.
                </div>
              )}
              {list.map((item) => {
                const attention = isAttention(item)
                const amount = itemAmount(item)
                const sending = sendingId === item.id
                return (
                  <Card key={item.id} className="p-0">
                    <div className="flex items-start gap-3 p-3.5">
                      <div
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          attention ? 'bg-destructive/15 text-destructive-foreground' : 'bg-amber-500/15 text-amber-500'
                        }`}
                      >
                        {attention ? <AlertTriangle className="h-4.5 w-4.5" /> : <Clock className="h-4.5 w-4.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{TYPE_LABELS[item.type] || item.type}</p>
                          {amount !== null && (
                            <span className="font-mono text-sm font-semibold text-foreground">{formatAmount(amount)}</span>
                          )}
                          <Badge variant={attention ? 'destructive' : 'warning'} className="text-[10px]">
                            {attention ? 'требует внимания' : 'ждёт отправки'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleString('ru-RU')}
                          {item.attempts > 0 ? ` · попыток: ${item.attempts}` : ''}
                        </p>
                        {attention && item.last_error && (
                          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                            Ответ сервера: {item.last_error}
                          </p>
                        )}
                        {!attention && item.last_error && item.attempts > 0 && (
                          <p className="mt-1.5 truncate text-xs text-muted-foreground" title={item.last_error}>
                            Последняя ошибка: {item.last_error}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={attention ? 'destructive' : 'secondary'}
                        disabled={busy}
                        onClick={() => void handleSendOne(item)}
                        className="h-9 shrink-0 gap-1.5"
                      >
                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {attention ? 'Повторить' : 'Отправить сейчас'}
                      </Button>
                    </div>
                  </Card>
                )
              })}
              <p className="px-1 pt-1 text-center text-[11px] text-muted-foreground">
                Операции в очереди не удаляются: они будут отправляться автоматически, пока не дойдут до сервера.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
