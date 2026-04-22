'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveX, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type InventoryItem = {
  id: string
  name: string
  barcode: string
  unit: string
  item_type: string
}

type InventoryBalance = {
  location_id: string
  item_id: string
  quantity: number
  item?: InventoryItem | null
  location?: InventoryLocation | null
}

type InventoryWriteoff = {
  id: string
  written_at: string
  reason: string
  comment: string | null
  total_amount: number
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    comment: string | null
    item?: InventoryItem | null
  }>
}

type WriteoffsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    writeoffs: InventoryWriteoff[]
  }
  error?: string
}

type WriteoffLine = {
  item_id: string
  quantity: string
  comment: string
}

const emptyLine = (): WriteoffLine => ({
  item_id: '',
  quantity: '',
  comment: '',
})

function parseQty(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 1000) / 1000
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

export default function StoreWriteoffsPage() {
  const [data, setData] = useState<WriteoffsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [writtenAt, setWrittenAt] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<WriteoffLine[]>([emptyLine()])
  const [quickQuery, setQuickQuery] = useState('')
  const [quickError, setQuickError] = useState<string | null>(null)
  const quickInputRef = useRef<HTMLInputElement>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplates, setSavedTemplates] = useState<Array<{ name: string; lines: WriteoffLine[]; reason: string }>>([])
  const [scope, setScope] = useState<'all' | 'warehouse' | 'showcase'>('all')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/writeoffs?scope=${scope}`, { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as WriteoffsResponse | null
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить списания')
      setData(json.data)
      setLocationId((current) => current || json.data?.locations?.[0]?.id || '')
    } catch (err: any) {
      setData(null)
      setError(err?.message || 'Не удалось загрузить списания')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('q')
      if (q) setQuickQuery(q)
    } catch { /* ignore query parse errors */ }
    void load()
  }, [scope])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('store-writeoffs-templates-v1')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) setSavedTemplates(parsed)
    } catch { /* ignore parse errors */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('store-writeoffs-templates-v1', JSON.stringify(savedTemplates))
    } catch { /* ignore write errors */ }
  }, [savedTemplates])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        quickInputRef.current?.focus()
        quickInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activeLocations = data?.locations || []
  const selectedLocation = activeLocations.find((location) => location.id === locationId) || null
  const selectedBalances = useMemo(() => {
    return (data?.balances || [])
      .filter((balance) => balance.location_id === locationId && Number(balance.quantity || 0) > 0)
      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }, [data?.balances, locationId])

  const quickCandidates = useMemo(() => {
    const q = quickQuery.trim().toLowerCase()
    if (!q) return []
    return selectedBalances
      .filter((balance) => {
        const barcode = String(balance.item?.barcode || '').toLowerCase()
        const name = String(balance.item?.name || '').toLowerCase()
        return barcode.includes(q) || name.includes(q)
      })
      .slice(0, 8)
  }, [quickQuery, selectedBalances])

  const upsertWriteoffLine = (itemId: string, mode: 'increment' | 'set' = 'increment') => {
    const inLocation = selectedBalances.find((balance) => balance.item_id === itemId)
    if (!inLocation) return false

    setLines((current) => {
      const idx = current.findIndex((line) => line.item_id === itemId)
      if (idx >= 0) {
        return current.map((line, lineIndex) => {
          if (lineIndex !== idx) return line
          const nextQty = mode === 'increment' ? parseQty(line.quantity) + 1 : Math.max(1, parseQty(line.quantity))
          return { ...line, quantity: String(nextQty) }
        })
      }
      const nextLine: WriteoffLine = { item_id: itemId, quantity: '1', comment: '' }
      const hasOnlyEmpty = current.length === 1 && !current[0].item_id && !current[0].quantity && !current[0].comment
      return hasOnlyEmpty ? [nextLine] : [...current, nextLine]
    })
    return true
  }

  const handleQuickAdd = () => {
    setQuickError(null)
    const q = quickQuery.trim()
    if (!q) return

    const exactBarcode = selectedBalances.find((balance) => String(balance.item?.barcode || '').trim() === q)
    if (exactBarcode) {
      upsertWriteoffLine(exactBarcode.item_id, 'increment')
      setQuickQuery('')
      return
    }

    const byContains = selectedBalances.filter((balance) => {
      const barcode = String(balance.item?.barcode || '').toLowerCase()
      const name = String(balance.item?.name || '').toLowerCase()
      const query = q.toLowerCase()
      return barcode.includes(query) || name.includes(query)
    })

    if (byContains.length === 1) {
      upsertWriteoffLine(byContains[0].item_id, 'increment')
      setQuickQuery('')
      return
    }
    if (byContains.length === 0) {
      setQuickError('Товар не найден в выбранной локации.')
      return
    }
    setQuickError('Найдено несколько товаров — выбери ниже.')
  }

  const createWriteoff = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0)

    if (!locationId) return setError('Выберите локацию для списания')
    if (!reason.trim()) return setError('Укажите причину списания')
    if (!payloadItems.length) return setError('Добавьте хотя бы одну позицию в списание')

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createWriteoff',
          payload: {
            location_id: locationId,
            written_at: writtenAt,
            reason: reason.trim(),
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести списание')

      setReason('')
      setComment('')
      setLines([emptyLine()])
      setSuccess('Списание проведено, остатки обновлены')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести списание')
    } finally {
      setSaving(false)
    }
  }

  const saveTemplate = () => {
    const name = templateName.trim()
    if (!name) return setError('Введите название шаблона')
    const nonEmptyLines = lines.filter((line) => line.item_id && parseQty(line.quantity) > 0)
    if (nonEmptyLines.length === 0) return setError('Нет строк для шаблона')
    setSavedTemplates((prev) => {
      const rest = prev.filter((tpl) => tpl.name !== name)
      return [{ name, lines: nonEmptyLines, reason: reason.trim() }, ...rest].slice(0, 25)
    })
    setTemplateName('')
    setSuccess(`Шаблон «${name}» сохранён`)
  }

  const applyTemplate = (name: string) => {
    const tpl = savedTemplates.find((item) => item.name === name)
    if (!tpl) return
    setLines(tpl.lines.map((line) => ({ ...line })))
    if (tpl.reason) setReason(tpl.reason)
    setSuccess(`Шаблон «${name}» применён`)
  }

  const deleteTemplate = (name: string) => {
    setSavedTemplates((prev) => prev.filter((tpl) => tpl.name !== name))
  }

  const exportCsv = () => {
    const rows = lines
      .filter((line) => line.item_id)
      .map((line) => {
        const balance = selectedBalances.find((b) => b.item_id === line.item_id)
        return {
          name: balance?.item?.name || '',
          barcode: balance?.item?.barcode || '',
          quantity: line.quantity,
          comment: line.comment || '',
          reason: reason || '',
        }
      })
    if (rows.length === 0) return
    const headers = ['name', 'barcode', 'quantity', 'comment', 'reason']
    const csv = [headers.join(',')]
      .concat(rows.map((r) => headers.map((h) => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `writeoffs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-5 md:px-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-xs text-rose-200">
              <ArchiveX className="h-3.5 w-3.5" />
              Списания
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Списание склада и витрин</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Отдельный экран для брака, служебного расхода, порчи и любых непригодных остатков по складу или точке.
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-2xl">
                <MoreHorizontal className="mr-2 h-4 w-4" />
                Действия
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Управление списаниями</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Обновить данные
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setReason('')
                  setComment('')
                  setLines([emptyLine()])
                }}
              >
                <ArchiveX className="h-4 w-4" />
                Очистить форму
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div> : null}

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <button type="button" onClick={() => setScope('all')} className={`rounded-lg px-3 py-2 text-sm ${scope === 'all' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}>Все</button>
        <button type="button" onClick={() => setScope('warehouse')} className={`rounded-lg px-3 py-2 text-sm ${scope === 'warehouse' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}>Подсобка</button>
        <button type="button" onClick={() => setScope('showcase')} className={`rounded-lg px-3 py-2 text-sm ${scope === 'showcase' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}>Витрина</button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="border-white/10 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Новый документ списания</h2>
            <p className="text-sm text-muted-foreground">Сначала локация и причина, потом только нужные позиции.</p>
          </div>

          <form onSubmit={createWriteoff} className="space-y-5">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={quickInputRef}
                  value={quickQuery}
                  onChange={(event) => {
                    setQuickQuery(event.target.value)
                    if (quickError) setQuickError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleQuickAdd()
                    }
                  }}
                  placeholder="Сканируй штрихкод или введи название товара"
                  className="min-w-[260px] flex-1"
                />
                <Button type="button" onClick={handleQuickAdd}>
                  Добавить товар
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-rose-200/80">Горячая клавиша: Ctrl/Cmd + K — фокус на сканер</p>
              {quickError ? <p className="mt-2 text-xs text-rose-300">{quickError}</p> : null}
              {quickCandidates.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickCandidates.map((balance) => (
                    <button
                      key={`quick-${balance.location_id}-${balance.item_id}`}
                      type="button"
                      onClick={() => {
                        upsertWriteoffLine(balance.item_id, 'increment')
                        setQuickQuery('')
                        setQuickError(null)
                        quickInputRef.current?.focus()
                      }}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 hover:bg-white/[0.08]"
                    >
                      {balance.item?.name || 'Товар'} · {balance.item?.barcode || '—'} · {formatQty(Number(balance.quantity || 0))}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Шаблоны и экспорт</p>
              <div className="flex flex-wrap gap-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона" className="min-w-[220px] flex-1" />
                <Button type="button" variant="outline" onClick={saveTemplate}>Сохранить шаблон</Button>
                <Button type="button" variant="outline" onClick={exportCsv}>Экспорт CSV</Button>
              </div>
              {savedTemplates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {savedTemplates.map((tpl) => (
                    <div key={tpl.name} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs">
                      <button type="button" onClick={() => applyTemplate(tpl.name)} className="text-slate-200 hover:text-white">{tpl.name}</button>
                      <button type="button" onClick={() => deleteTemplate(tpl.name)} className="text-rose-300 hover:text-rose-200">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Локация</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Подсобка' : 'Витрина'} · {location.company?.name || location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Дата списания</Label>
                <Input type="date" value={writtenAt} onChange={(event) => setWrittenAt(event.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Причина</Label>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Брак, просрочка, служебное использование..." />
              </div>

              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Подробности по документу" />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
              Доступно в локации: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              {' · '}
              {selectedBalances.length} товарных позиций
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={`writeoff-${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[minmax(0,1.5fr)_140px_minmax(0,1fr)_110px]">
                  <div className="space-y-1.5">
                    <Label>Товар</Label>
                    <Select
                      value={line.item_id || `__empty__writeoff_${index}`}
                      onValueChange={(value) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__writeoff_${index}`}>Выберите товар</SelectItem>
                        {selectedBalances.map((balance) => (
                          <SelectItem key={`${index}-${balance.item_id}`} value={balance.item_id}>
                            {balance.item?.name || 'Товар'} · {formatQty(Number(balance.quantity || 0))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Списать</Label>
                    <Input value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Комментарий</Label>
                    <Input value={line.comment} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, брак" />
                  </div>

                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                Добавить строку
              </Button>
              <div className="text-sm text-muted-foreground">
                Сумма списаний в истории: <span className="font-semibold text-foreground">{formatMoney((data?.writeoffs || []).reduce((sum, item) => sum + Number(item.total_amount || 0), 0))}</span>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="rounded-2xl">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveX className="mr-2 h-4 w-4" />}
              Провести списание
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 p-5">
            <h2 className="text-lg font-semibold text-foreground">Последние списания</h2>
            <p className="mt-1 text-sm text-muted-foreground">История по складу и витринам с суммой и причинами.</p>

            <div className="mt-4 space-y-3">
              {(data?.writeoffs || []).length ? (
                data!.writeoffs.slice(0, 10).map((writeoff) => (
                  <div key={writeoff.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-foreground">{writeoff.location?.company?.name || writeoff.location?.name || 'Локация'}</div>
                        <div className="text-sm text-muted-foreground">{writeoff.reason}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-foreground">{formatMoney(Number(writeoff.total_amount || 0))}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(writeoff.written_at)}</div>
                      </div>
                    </div>
                    {writeoff.comment ? <div className="mt-3 text-sm text-slate-300">{writeoff.comment}</div> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(writeoff.items || []).slice(0, 4).map((item) => (
                        <span key={item.id} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                          {item.item?.name || 'Товар'} · {formatQty(Number(item.quantity || 0))}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-muted-foreground">
                  Пока нет списаний.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
