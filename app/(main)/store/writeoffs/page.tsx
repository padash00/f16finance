'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveX, Loader2, MoreHorizontal, Package, RefreshCw, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  const [formSheetOpen, setFormSheetOpen] = useState(false)
  const [writeoffSearch, setWriteoffSearch] = useState('')
  const [selectedWriteoff, setSelectedWriteoff] = useState<InventoryWriteoff | null>(null)
  const [writeoffDetailsOpen, setWriteoffDetailsOpen] = useState(false)

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

  const filteredWriteoffs = useMemo(() => {
    const q = writeoffSearch.trim().toLowerCase()
    const list = data?.writeoffs || []
    if (!q) return list
    return list.filter((w) => {
      const parts = [
        w.location?.company?.name,
        w.location?.name,
        w.reason,
        w.comment,
        ...(w.items || []).map((i) => i.item?.name || ''),
      ]
      return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [data?.writeoffs, writeoffSearch])

  const totalWriteoffsAmount = useMemo(() => {
    return (data?.writeoffs || []).reduce((s, w) => s + Number(w.total_amount || 0), 0)
  }, [data?.writeoffs])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10">
            <ArchiveX className="h-5 w-5 text-rose-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Списания</h1>
            <p className="truncate text-xs text-muted-foreground">Брак, просрочка, служебный расход — по складу и витринам</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
            {(['all', 'warehouse', 'showcase'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 transition ${scope === s ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {s === 'all' ? 'Все' : s === 'warehouse' ? 'Подсобка' : 'Витрина'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button size="sm" onClick={() => setFormSheetOpen(true)} className="h-9 gap-1.5 bg-rose-600 hover:bg-rose-700">
            <ArchiveX className="h-3.5 w-3.5" />
            Новое списание
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Документов</p>
          <p className="mt-1 text-xl font-semibold">{(data?.writeoffs || []).length}</p>
        </Card>
        <Card className="border-rose-500/20 bg-rose-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-rose-300/70">Сумма всех списаний</p>
          <p className="mt-1 truncate text-xl font-semibold text-rose-200" title={formatMoney(totalWriteoffsAmount)}>{formatMoney(totalWriteoffsAmount)}</p>
        </Card>
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Причин</p>
          <p className="mt-1 text-xl font-semibold">{new Set((data?.writeoffs || []).map((w) => w.reason).filter(Boolean)).size}</p>
        </Card>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div> : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={writeoffSearch}
            onChange={(e) => setWriteoffSearch(e.target.value)}
            placeholder="Поиск по локации, причине, товару..."
            className="h-9 pl-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
              Действия
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Списания</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFormSheetOpen(true)}>
              <ArchiveX className="h-4 w-4" />
              Новый документ
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setReason('')
                setComment('')
                setLines([emptyLine()])
              }}
            >
              <Trash2 className="h-4 w-4" />
              Очистить форму
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredWriteoffs.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            {writeoffSearch ? 'Ничего не найдено' : 'Списаний пока нет — нажмите «Новое списание»'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-380px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-24 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="w-48 py-2.5 px-2 font-normal">Локация</th>
                  <th className="py-2.5 px-2 font-normal">Причина</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-32 py-2.5 px-2 pr-4 text-right font-normal text-rose-300/70">Сумма</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Акт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredWriteoffs.map((writeoff) => (
                  <tr key={writeoff.id} className="transition hover:bg-white/[0.02]">
                    <td className="w-24 py-2.5 pl-4 pr-2 align-middle">
                      <span className="text-xs text-muted-foreground">{formatDate(writeoff.written_at)}</span>
                    </td>
                    <td className="w-48 py-2.5 px-2 align-middle">
                      <span className="line-clamp-1 text-xs text-muted-foreground">{writeoff.location?.company?.name || writeoff.location?.name || '—'}</span>
                    </td>
                    <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="truncate text-sm font-medium">{writeoff.reason || '—'}</p>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-md">
                          {writeoff.reason || '—'}
                          {writeoff.comment ? <div className="mt-1 text-xs text-muted-foreground">{writeoff.comment}</div> : null}
                          {(writeoff.items || []).length ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {(writeoff.items || []).map((i) => `${i.item?.name || 'Товар'} · ${formatQty(Number(i.quantity || 0))}`).join(', ')}
                            </div>
                          ) : null}
                        </TooltipContent>
                      </Tooltip>
                      {writeoff.comment ? <p className="truncate text-[11px] text-muted-foreground">{writeoff.comment}</p> : null}
                    </td>
                    <td className="w-20 py-2.5 px-2 text-right align-middle">
                      <span className="text-sm font-semibold">{(writeoff.items || []).length}</span>
                    </td>
                    <td className="w-32 py-2.5 px-2 pr-4 text-right align-middle">
                      <span className="text-sm font-semibold text-rose-300">{formatMoney(Number(writeoff.total_amount || 0))}</span>
                    </td>
                    <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedWriteoff(writeoff)
                          setWriteoffDetailsOpen(true)
                        }}
                      >
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create writeoff dialog */}
      <Dialog open={formSheetOpen} onOpenChange={setFormSheetOpen}>
        <DialogContent className="flex h-[90vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[1300px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ArchiveX className="h-5 w-5 text-rose-300" />
              Новый документ списания
            </DialogTitle>
            <DialogDescription>
              Сначала локация и причина, потом только нужные позиции.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createWriteoff} className="flex-1 space-y-5 overflow-y-auto p-5">
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
                      title={`${balance.item?.name || 'Товар'} · ${balance.item?.barcode || '—'} · ${formatQty(Number(balance.quantity || 0))}`}
                    >
                      <span className="block max-w-[340px] truncate">
                        {balance.item?.name || 'Товар'} · {balance.item?.barcode || '—'} · {formatQty(Number(balance.quantity || 0))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Шаблоны и экспорт</p>
              <div className="flex flex-wrap gap-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона" className="min-w-[220px] flex-1" />
                <Button type="button" variant="outline" onClick={saveTemplate}>Сохранить</Button>
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
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Подробности по документу" rows={2} />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
              Доступно в локации: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              {' · '}
              {selectedBalances.length} товарных позиций
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const selectedBalance = selectedBalances.find((balance) => balance.item_id === line.item_id)
                return (
                <div key={`writeoff-${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[minmax(0,1.3fr)_180px_120px_minmax(0,1fr)_auto]">
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
                      <SelectTrigger className="min-w-0 [&>span]:truncate"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__writeoff_${index}`}>Выберите товар</SelectItem>
                        {selectedBalances.map((balance) => (
                          <SelectItem
                            key={`${index}-${balance.item_id}`}
                            value={balance.item_id}
                            title={`${balance.item?.name || 'Товар'} · ${formatQty(Number(balance.quantity || 0))}`}
                          >
                            <span className="block max-w-[420px] truncate">
                              {balance.item?.name || 'Товар'} · {formatQty(Number(balance.quantity || 0))}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Штрихкод</Label>
                    <Input value={selectedBalance?.item?.barcode || '—'} readOnly className="bg-white/[0.03]" />
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
                    <Button type="button" variant="ghost" size="icon" onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )})}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                Добавить строку
              </Button>
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveX className="mr-2 h-4 w-4" />}
              Провести списание
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={writeoffDetailsOpen} onOpenChange={setWriteoffDetailsOpen}>
        <DialogContent className="flex h-[85vh] !w-[92vw] !max-w-[92vw] sm:!max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle>Детали списания</DialogTitle>
            <DialogDescription>
              {selectedWriteoff
                ? `${formatDate(selectedWriteoff.written_at)} · ${selectedWriteoff.location?.company?.name || selectedWriteoff.location?.name || 'Локация'}`
                : 'Проведенный акт списания'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-5">
            {!selectedWriteoff ? (
              <p className="text-sm text-muted-foreground">Документ не выбран.</p>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Причина: <span className="text-foreground">{selectedWriteoff.reason || '—'}</span>
                  {selectedWriteoff.comment ? (
                    <span> · Комментарий: <span className="text-foreground">{selectedWriteoff.comment}</span></span>
                  ) : null}
                  <span> · Сумма: <span className="text-foreground">{formatMoney(Number(selectedWriteoff.total_amount || 0))}</span></span>
                </div>
                <div className="overflow-auto rounded-xl border border-white/10">
                  <table className="w-full table-fixed text-sm">
                    <thead className="bg-white/[0.03]">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-normal">Товар</th>
                        <th className="px-3 py-2 font-normal">Штрихкод</th>
                        <th className="px-3 py-2 text-right font-normal">Количество</th>
                        <th className="px-3 py-2 text-right font-normal">Себестоимость</th>
                        <th className="px-3 py-2 text-right font-normal">Сумма</th>
                        <th className="px-3 py-2 font-normal">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedWriteoff.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2" title={item.item?.name || 'Товар'}>
                            <span className="block truncate">{item.item?.name || 'Товар'}</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.item?.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right">{formatQty(Number(item.quantity || 0))}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number(item.unit_cost || 0))}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number(item.total_cost || 0))}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.comment || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
