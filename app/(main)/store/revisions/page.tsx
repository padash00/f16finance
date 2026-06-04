'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Loader2, Package, RefreshCw, ScanLine, ScanSearch, Search, Smartphone, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StoreDataTableSkeleton } from '@/components/store/store-data-table-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { isAbortError } from '@/lib/is-abort-error'

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
  sale_price?: number
  default_purchase_price?: number
}

type InventoryBalance = {
  location_id: string
  item_id: string
  quantity: number
  item?: InventoryItem | null
}

type InventoryRevision = {
  id: string
  counted_at: string
  comment: string | null
  created_by?: string | null
  created_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    expected_qty: number
    actual_qty: number
    delta_qty: number
    comment: string | null
    item?: InventoryItem | null
  }>
}

type RevisionsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    stocktakes: InventoryRevision[]
  }
  error?: string
}

type RevisionLine = {
  item_id: string
  actual_qty: string
  comment: string
}

const emptyLine = (): RevisionLine => ({
  item_id: '',
  actual_qty: '',
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

function actorLabel(staff: { full_name: string | null } | null | undefined, fallbackId: string | null | undefined) {
  if (staff?.full_name) return staff.full_name
  if (fallbackId) return `ID ${String(fallbackId).slice(0, 8)}`
  return '—'
}

export default function StoreRevisionsPage() {
  const [data, setData] = useState<RevisionsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [countedAt, setCountedAt] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<RevisionLine[]>([])
  const [scope, setScope] = useState<'all' | 'warehouse' | 'showcase'>('all')
  const [formSheetOpen, setFormSheetOpen] = useState(false)
  const [revisionSearch, setRevisionSearch] = useState('')
  const [selectedRevision, setSelectedRevision] = useState<InventoryRevision | null>(null)
  const [revisionDetailsOpen, setRevisionDetailsOpen] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [scanFeedback, setScanFeedback] = useState<
    | { kind: 'ok'; itemName: string; prevQty: number; newQty: number; delta: number }
    | { kind: 'error'; message: string }
    | null
  >(null)
  const [recentScanItemId, setRecentScanItemId] = useState<string | null>(null)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [linesFilter, setLinesFilter] = useState<'all' | 'mismatch'>('all')
  const [hasDraft, setHasDraft] = useState(false)
  const [liveActive, setLiveActive] = useState(false)
  const [liveLog, setLiveLog] = useState<{ id: string; name: string; delta: number }[]>([])
  const liveSinceRef = useRef<string | null>(null)
  const liveSeenRef = useRef<Set<string>>(new Set())

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/revisions?scope=${scope}`, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as RevisionsResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить ревизии')
      setData(json.data)
      setLocationId((current) => current || json.data?.locations?.[0]?.id || '')
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      if (!soft) setData(null)
      setError(err?.message || 'Не удалось загрузить ревизии')
    } finally {
      if (!signal?.aborted) {
        if (soft) setRefreshing(false)
        else setLoading(false)
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [scope])

  const activeLocations = data?.locations || []
  const selectedLocation = activeLocations.find((location) => location.id === locationId) || null
  const selectedBalances = useMemo(() => {
    return (data?.balances || [])
      .filter((balance) => balance.location_id === locationId)
      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }, [data?.balances, locationId])
  const itemById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.items || []) map.set(item.id, item)
    return map
  }, [data?.items])
  const balanceItemById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const balance of selectedBalances) {
      if (balance.item?.id) map.set(balance.item.id, balance.item)
    }
    return map
  }, [selectedBalances])
  const itemByBarcode = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.items || []) {
      const barcode = String(item.barcode || '').trim()
      if (!barcode) continue
      map.set(barcode, item)
    }
    return map
  }, [data?.items])

  const loadFromBalances = () => {
    setLines(
      selectedBalances
        .filter((balance) => Number(balance.quantity || 0) > 0)
        .map((balance) => ({
          item_id: balance.item_id,
          actual_qty: formatQty(Number(balance.quantity || 0)),
          comment: '',
        })),
    )
  }

  useEffect(() => {
    if (!formSheetOpen || !locationId) return
    const id = window.setTimeout(() => scanInputRef.current?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [formSheetOpen, locationId])

  // ── Живая ревизия ─────────────────────────────────────────────────────────
  // Пока открыта форма ревизии, опрашиваем продажи/долги/возвраты по локации.
  // «Систему» (ожидаемый остаток) обновляем живьём, а «Факт» по уже посчитанным
  // товарам автоматически корректируем на то, что ушло во время подсчёта.
  useEffect(() => {
    if (!formSheetOpen || !locationId) {
      setLiveActive(false)
      return
    }
    setLiveActive(true)
    liveSinceRef.current = new Date().toISOString()
    liveSeenRef.current = new Set()
    setLiveLog([])
    let cancelled = false

    const tick = async () => {
      try {
        const since = liveSinceRef.current || ''
        const resp = await fetch(
          `/api/admin/store/revisions/live?location_id=${encodeURIComponent(locationId)}&since=${encodeURIComponent(since)}`,
          { cache: 'no-store' },
        )
        if (!resp.ok) return
        const jsonResp = await resp.json().catch(() => null)
        const payload = jsonResp?.data
        if (cancelled || !payload) return

        // 1) Свежие остатки → обновляем «Систему»
        const freshBalances: Array<{ item_id: string; quantity: number }> = payload.balances || []
        if (freshBalances.length) {
          const qtyByItem = new Map(freshBalances.map((b) => [String(b.item_id), Number(b.quantity || 0)]))
          setData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              balances: (prev.balances || []).map((b) =>
                b.location_id === locationId && qtyByItem.has(String(b.item_id))
                  ? { ...b, quantity: qtyByItem.get(String(b.item_id)) as number }
                  : b,
              ),
            }
          })
        }

        // 2) Новые движения → корректируем «Факт» уже посчитанных товаров
        const movements: Array<{ id: string; item_id: string; item_name: string; delta: number }> =
          payload.movements || []
        const deltaByItem = new Map<string, number>()
        const newLog: { id: string; name: string; delta: number }[] = []
        for (const m of movements) {
          if (liveSeenRef.current.has(m.id)) continue
          liveSeenRef.current.add(m.id)
          deltaByItem.set(m.item_id, (deltaByItem.get(m.item_id) || 0) + m.delta)
          newLog.push({ id: m.id, name: m.item_name, delta: m.delta })
        }
        if (deltaByItem.size) {
          setLines((prev) =>
            prev.map((ln) => {
              const d = deltaByItem.get(ln.item_id)
              if (!d) return ln
              const next = Math.max(0, parseQty(ln.actual_qty) + d)
              return { ...ln, actual_qty: formatQty(next) }
            }),
          )
          setLiveLog((prev) => [...newLog, ...prev].slice(0, 6))
        }

        if (payload.now) liveSinceRef.current = String(payload.now)
      } catch {
        // тихо игнорируем — ревизию не ломаем
      }
    }

    void tick()
    const interval = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      setLiveActive(false)
    }
  }, [formSheetOpen, locationId])

  // ── Черновик ревизии в localStorage ───────────────────────────────────────
  // Ключ: revision-draft:${locationId}:${countedAt}.
  // Сохраняется при каждом изменении lines/comment, очищается после успешного провода.
  function draftKey(loc: string, date: string) {
    return `revision-draft:${loc}:${date}`
  }

  type RevisionDraft = {
    lines: RevisionLine[]
    comment: string
    savedAt: string
  }

  useEffect(() => {
    if (!formSheetOpen || !locationId || !countedAt) {
      setHasDraft(false)
      return
    }
    try {
      const raw = window.localStorage.getItem(draftKey(locationId, countedAt))
      setHasDraft(!!raw)
    } catch {
      setHasDraft(false)
    }
  }, [formSheetOpen, locationId, countedAt])

  useEffect(() => {
    if (!formSheetOpen || !locationId || !countedAt) return
    if (lines.length === 0 && !comment) return
    try {
      const payload: RevisionDraft = {
        lines,
        comment,
        savedAt: new Date().toISOString(),
      }
      window.localStorage.setItem(draftKey(locationId, countedAt), JSON.stringify(payload))
      setHasDraft(true)
    } catch {
      /* localStorage может быть забит — пропускаем */
    }
  }, [lines, comment, locationId, countedAt, formSheetOpen])

  function loadDraft() {
    if (!locationId || !countedAt) return
    try {
      const raw = window.localStorage.getItem(draftKey(locationId, countedAt))
      if (!raw) return
      const parsed = JSON.parse(raw) as RevisionDraft
      if (Array.isArray(parsed.lines)) setLines(parsed.lines)
      if (typeof parsed.comment === 'string') setComment(parsed.comment)
    } catch {
      /* поврежденный черновик — игнорируем */
    }
  }

  function dropDraft() {
    if (!locationId || !countedAt) return
    try {
      window.localStorage.removeItem(draftKey(locationId, countedAt))
    } catch {
      /* ignore */
    }
    setHasDraft(false)
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function printRevision(revision: InventoryRevision) {
    const items = revision.items || []
    const counts = {
      rows: items.length,
      shortage: items.reduce((s, i) => s + (Number(i.delta_qty || 0) < 0 ? Math.abs(Number(i.delta_qty || 0)) : 0), 0),
      surplus: items.reduce((s, i) => s + (Number(i.delta_qty || 0) > 0 ? Number(i.delta_qty || 0) : 0), 0),
      saleAmount: items.reduce(
        (s, i) => s + Math.abs(Number(i.delta_qty || 0)) * Number(i.item?.sale_price || 0),
        0,
      ),
      purchaseAmount: items.reduce(
        (s, i) => s + Math.abs(Number(i.delta_qty || 0)) * Number(i.item?.default_purchase_price || 0),
        0,
      ),
    }
    const tableRows = items
      .map((item) => {
        const delta = Number(item.delta_qty || 0)
        const deltaStr = delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${formatQty(delta)}`
        const deltaColor = delta === 0 ? '#475569' : delta > 0 ? '#047857' : '#b91c1c'
        return `<tr>
          <td>${escapeHtml(item.item?.name || 'Товар')}</td>
          <td style="font-family:monospace;color:#64748b">${escapeHtml(item.item?.barcode || '—')}</td>
          <td style="text-align:right">${formatQty(Number(item.expected_qty || 0))}</td>
          <td style="text-align:right">${formatQty(Number(item.actual_qty || 0))}</td>
          <td style="text-align:right;color:${deltaColor};font-weight:600">${deltaStr}</td>
          <td style="color:#64748b">${escapeHtml(item.comment || '')}</td>
        </tr>`
      })
      .join('')

    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8" />
      <title>Акт ревизии ${escapeHtml(formatDate(revision.counted_at))}</title>
      <style>
        @page { size: A4; margin: 16mm; }
        body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#0f172a; }
        h1 { font-size: 18px; margin: 0 0 4px 0; }
        .muted { color:#64748b; font-size:12px; }
        .meta { margin: 12px 0 18px 0; font-size: 13px; line-height: 1.5; }
        table { width:100%; border-collapse: collapse; font-size: 12px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
        thead th { background:#f8fafc; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color:#475569; }
        .summary { margin-top: 18px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 12px; }
        .summary .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
        .signature { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; font-size: 12px; }
        .signature .line { margin-top: 32px; border-top: 1px solid #94a3b8; padding-top: 4px; color: #64748b; }
      </style></head>
      <body>
        <h1>Акт ревизии</h1>
        <div class="muted">${escapeHtml(formatDate(revision.counted_at))} · ${escapeHtml(revision.location?.company?.name || revision.location?.name || 'Локация')}</div>
        <div class="meta">
          <div><strong>Провёл:</strong> ${escapeHtml(actorLabel(revision.created_by_staff, revision.created_by || null))}</div>
          ${revision.comment ? `<div><strong>Комментарий:</strong> ${escapeHtml(revision.comment)}</div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Штрихкод</th>
              <th style="text-align:right">Система</th>
              <th style="text-align:right">Факт</th>
              <th style="text-align:right">Δ</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Позиций нет</td></tr>'}</tbody>
        </table>
        <div class="summary">
          <div class="card"><div class="muted">Позиций</div><div><strong>${counts.rows}</strong></div></div>
          <div class="card"><div class="muted">Недостача</div><div style="color:#b91c1c"><strong>−${formatQty(counts.shortage)}</strong></div></div>
          <div class="card"><div class="muted">Излишек</div><div style="color:#047857"><strong>+${formatQty(counts.surplus)}</strong></div></div>
          <div class="card"><div class="muted">Ущерб по продаже / закупке</div><div><strong>${Math.round(counts.saleAmount).toLocaleString('ru-RU')} ₸</strong> · ${Math.round(counts.purchaseAmount).toLocaleString('ru-RU')} ₸</div></div>
        </div>
        <div class="signature">
          <div><div class="line">Подпись провёдшего</div></div>
          <div><div class="line">Подпись принимающего</div></div>
        </div>
        <script>window.addEventListener('load', () => { setTimeout(() => window.print(), 100); });</script>
      </body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) {
      window.alert('Не удалось открыть окно печати — разрешите всплывающие окна для этого сайта.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  useEffect(() => {
    return () => {
      if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current)
      if (scanHighlightTimer.current) clearTimeout(scanHighlightTimer.current)
    }
  }, [])

  function playScanBeep(kind: 'ok' | 'error') {
    try {
      let ctx = audioCtxRef.current
      if (!ctx) {
        const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
        if (!Ctor) return
        ctx = new Ctor()
        audioCtxRef.current = ctx
      }
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = kind === 'ok' ? 880 : 220
      gain.gain.value = 0.06
      osc.connect(gain).connect(ctx.destination)
      const now = ctx.currentTime
      gain.gain.setValueAtTime(0.06, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
      osc.start(now)
      osc.stop(now + 0.18)
    } catch {
      /* звук опционален */
    }
  }

  const flashScanError = (message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current)
    setScanFeedback({ kind: 'error', message })
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2000)
    playScanBeep('error')
  }

  const flashScanOk = (payload: { itemName: string; prevQty: number; newQty: number; delta: number }) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current)
    setScanFeedback({ kind: 'ok', ...payload })
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 1800)
    playScanBeep('ok')
  }

  const highlightScan = (itemId: string) => {
    if (scanHighlightTimer.current) clearTimeout(scanHighlightTimer.current)
    setRecentScanItemId(itemId)
    scanHighlightTimer.current = setTimeout(() => setRecentScanItemId(null), 1200)
  }

  const addItemByScan = (found: InventoryItem) => {
    const expectedQty = Number(selectedBalances.find((b) => b.item_id === found.id)?.quantity || 0)
    const existingIndex = lines.findIndex((line) => line.item_id === found.id)
    if (existingIndex === -1) {
      setLines((current) => [
        { item_id: found.id, actual_qty: '1', comment: '' },
        ...current,
      ])
      flashScanOk({ itemName: found.name, prevQty: 0, newQty: 1, delta: 1 - expectedQty })
    } else {
      let prev = 0
      let next = 0
      setLines((current) =>
        current.map((line, index) => {
          if (index !== existingIndex) return line
          prev = parseQty(line.actual_qty)
          next = prev + 1
          return { ...line, actual_qty: formatQty(next) }
        }),
      )
      flashScanOk({ itemName: found.name, prevQty: prev, newQty: next, delta: next - expectedQty })
    }
    highlightScan(found.id)
    setScanInput('')
    scanInputRef.current?.focus()
  }

  const handleScan = () => {
    const barcode = scanInput.trim()
    if (!barcode) return
    if (!locationId) {
      flashScanError('Сначала выберите локацию')
      setScanInput('')
      return
    }
    const found = itemByBarcode.get(barcode)
    if (!found) {
      flashScanError(`Штрихкод ${barcode} не найден в каталоге`)
      setScanInput('')
      return
    }
    addItemByScan(found)
  }

  // Подсказки: товары, штрихкод которых ОКАНЧИВАЕТСЯ на введённое (приоритет)
  // или содержит введённое. Показываем при вводе ≥2 символов, лимит 8.
  const barcodeSuggestions = useMemo(() => {
    const query = scanInput.trim()
    if (query.length < 2) return [] as InventoryItem[]
    // Если точное совпадение есть — не показываем подсказки (handleScan добавит).
    if (itemByBarcode.has(query)) return [] as InventoryItem[]
    const endsWith: InventoryItem[] = []
    const contains: InventoryItem[] = []
    for (const item of data?.items || []) {
      const bc = String(item.barcode || '').trim()
      if (!bc || bc === query) continue
      if (bc.endsWith(query)) endsWith.push(item)
      else if (bc.includes(query)) contains.push(item)
      if (endsWith.length >= 8) break
    }
    return [...endsWith, ...contains].slice(0, 8)
  }, [scanInput, data?.items, itemByBarcode])

  const totals = useMemo(() => {
    const rows = lines
      .map((line) => {
        const expected = Number(selectedBalances.find((item) => item.item_id === line.item_id)?.quantity || 0)
        const actual = parseQty(line.actual_qty)
        return { expected, actual, delta: actual - expected }
      })
      .filter((line) => line.expected > 0 || line.actual > 0)

    return {
      count: rows.length,
      shortage: rows.filter((line) => line.delta < 0).reduce((sum, line) => sum + Math.abs(line.delta), 0),
      surplus: rows.filter((line) => line.delta > 0).reduce((sum, line) => sum + line.delta, 0),
    }
  }, [lines, selectedBalances])

  const createRevision = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        actual_qty: parseQty(line.actual_qty),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.actual_qty >= 0)

    if (!locationId) return setError('Выберите локацию для ревизии')
    if (!payloadItems.length) return setError('Загрузите или добавьте строки ревизии')

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createRevision',
          payload: {
            location_id: locationId,
            counted_at: countedAt,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести ревизию')

      setComment('')
      setLines([])
      setSuccess('Ревизия проведена, расхождения записаны')
      dropDraft()
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести ревизию')
    } finally {
      setSaving(false)
    }
  }

  const filteredRevisions = useMemo(() => {
    const q = revisionSearch.trim().toLowerCase()
    const list = data?.stocktakes || []
    if (!q) return list
    return list.filter((r) => {
      const parts = [
        r.location?.company?.name,
        r.location?.name,
        r.comment,
        ...(r.items || []).map((i) => i.item?.name || ''),
      ]
      return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [data?.stocktakes, revisionSearch])

  const revisionsStats = useMemo(() => {
    const list = data?.stocktakes || []
    const withMismatch = list.filter((r) => (r.items || []).some((i) => Number(i.delta_qty || 0) !== 0)).length
    const totalShortage = list.reduce((s, r) => s + (r.items || []).reduce((s2, i) => s2 + (Number(i.delta_qty || 0) < 0 ? Math.abs(Number(i.delta_qty || 0)) : 0), 0), 0)
    const totalSurplus = list.reduce((s, r) => s + (r.items || []).reduce((s2, i) => s2 + (Number(i.delta_qty || 0) > 0 ? Number(i.delta_qty || 0) : 0), 0), 0)
    return { count: list.length, withMismatch, totalShortage, totalSurplus }
  }, [data?.stocktakes])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <ScanSearch className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Ревизии</h1>
            <p className="truncate text-xs text-muted-foreground">Сверка фактических остатков с системой</p>
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
          <Button variant="outline" size="sm" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setFormSheetOpen(true)
            }}
            className="h-9 gap-1.5 bg-cyan-600 hover:bg-cyan-700"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Новый акт
          </Button>
          <Button asChild size="sm" variant="outline" className="h-9 gap-1.5 border-amber-400/40 text-amber-300 hover:bg-amber-400/10">
            <Link href="/store/revisions/scan">
              <Smartphone className="h-3.5 w-3.5" />
              Сканер с телефона
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Актов</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-1 text-xl font-semibold">{revisionsStats.count}</p>}
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-300/70">С расхождениями</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-1 text-xl font-semibold text-amber-200">{revisionsStats.withMismatch}</p>}
        </Card>
        <Card className="border-rose-500/20 bg-rose-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-rose-300/70">Недостача (всего)</p>
          {loading ? <Skeleton className="mt-1 h-7 w-20" /> : <p className="mt-1 text-xl font-semibold text-rose-200">{formatQty(revisionsStats.totalShortage)}</p>}
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Излишек (всего)</p>
          {loading ? <Skeleton className="mt-1 h-7 w-20" /> : <p className="mt-1 text-xl font-semibold text-emerald-200">{formatQty(revisionsStats.totalSurplus)}</p>}
        </Card>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div> : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={revisionSearch}
            onChange={(e) => setRevisionSearch(e.target.value)}
            placeholder="Поиск по локации, товару, комментарию..."
            className="h-9 pl-9"
          />
        </div>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading && filteredRevisions.length === 0 ? (
          <StoreDataTableSkeleton columns={10} />
        ) : filteredRevisions.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            {revisionSearch ? 'Ничего не найдено' : 'Ревизий пока нет — нажмите «Новый акт»'}
          </div>
        ) : (
          <div className="relative max-h-[calc(100vh-380px)] overflow-auto">
            {refreshing ? (
              <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/35 pt-10 backdrop-blur-[0.5px]">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Обновление…
                </div>
              </div>
            ) : null}
            <div className={refreshing ? 'pointer-events-none opacity-50' : undefined}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-24 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="w-40 py-2.5 px-2 font-normal">Провел</th>
                  <th className="w-48 py-2.5 px-2 font-normal">Локация</th>
                  <th className="py-2.5 px-2 font-normal">Комментарий</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-24 py-2.5 px-2 text-right font-normal">Недостача</th>
                  <th className="w-24 py-2.5 px-2 pr-4 text-right font-normal">Излишек</th>
                  <th className="w-28 py-2.5 px-2 text-right font-normal">Сумма (прод.)</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Сумма (закуп.)</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Акт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredRevisions.map((revision) => {
                  const items = revision.items || []
                  const shortage = items.reduce((s, i) => s + (Number(i.delta_qty || 0) < 0 ? Math.abs(Number(i.delta_qty || 0)) : 0), 0)
                  const surplus = items.reduce((s, i) => s + (Number(i.delta_qty || 0) > 0 ? Number(i.delta_qty || 0) : 0), 0)
                  const saleAmount = items.reduce((s, i) => {
                    const deltaAbs = Math.abs(Number(i.delta_qty || 0))
                    const salePrice = Number(i.item?.sale_price || 0)
                    return s + deltaAbs * salePrice
                  }, 0)
                  const purchaseAmount = items.reduce((s, i) => {
                    const deltaAbs = Math.abs(Number(i.delta_qty || 0))
                    const purchasePrice = Number(i.item?.default_purchase_price || 0)
                    return s + deltaAbs * purchasePrice
                  }, 0)
                  const mismatches = items.filter((i) => Number(i.delta_qty || 0) !== 0)
                  return (
                    <tr key={revision.id} className="transition hover:bg-white/[0.02]">
                      <td className="w-24 py-2.5 pl-4 pr-2 align-middle">
                        <span className="text-xs text-muted-foreground">{formatDate(revision.counted_at)}</span>
                      </td>
                      <td className="w-40 py-2.5 px-2 align-middle">
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {actorLabel(revision.created_by_staff, revision.created_by || null)}
                        </span>
                      </td>
                      <td className="w-48 py-2.5 px-2 align-middle">
                        <span className="line-clamp-1 text-xs text-muted-foreground">{revision.location?.company?.name || revision.location?.name || '—'}</span>
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="truncate text-sm">{revision.comment || <span className="text-muted-foreground">Без комментария</span>}</p>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            {revision.comment || 'Без комментария'}
                            {mismatches.length ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {mismatches.map((i) => `${i.item?.name || 'Товар'}: ${Number(i.delta_qty) > 0 ? '+' : ''}${formatQty(Number(i.delta_qty || 0))}`).join(', ')}
                              </div>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="w-20 py-2.5 px-2 text-right align-middle">
                        <span className="text-sm font-semibold">{items.length}</span>
                      </td>
                      <td className="w-24 py-2.5 px-2 text-right align-middle">
                        <span className={`text-sm font-semibold ${shortage > 0 ? 'text-rose-300' : 'text-muted-foreground'}`}>
                          {shortage > 0 ? `-${formatQty(shortage)}` : '—'}
                        </span>
                      </td>
                      <td className="w-24 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className={`text-sm font-semibold ${surplus > 0 ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                          {surplus > 0 ? `+${formatQty(surplus)}` : '—'}
                        </span>
                      </td>
                      <td className="w-28 py-2.5 px-2 text-right align-middle">
                        <span className={`text-sm font-semibold ${saleAmount > 0 ? 'text-amber-200' : 'text-muted-foreground'}`}>
                          {saleAmount > 0 ? `${Math.round(saleAmount).toLocaleString('ru-RU')} ₸` : '—'}
                        </span>
                      </td>
                      <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className={`text-sm font-semibold ${purchaseAmount > 0 ? 'text-cyan-200' : 'text-muted-foreground'}`}>
                          {purchaseAmount > 0 ? `${Math.round(purchaseAmount).toLocaleString('ru-RU')} ₸` : '—'}
                        </span>
                      </td>
                      <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRevision(revision)
                            setRevisionDetailsOpen(true)
                          }}
                        >
                          Открыть
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Card>

      {/* Create revision dialog */}
      <Dialog
        open={formSheetOpen}
        onOpenChange={(open) => {
          setFormSheetOpen(open)
          if (!open) {
            setScanInput('')
            setScanFeedback(null)
            setRecentScanItemId(null)
          }
        }}
      >
        <DialogContent className="flex h-[90vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-cyan-300" />
              Новый акт ревизии
            </DialogTitle>
            <DialogDescription>
              Подтяни остатки системы, исправь факт и проведи один чистый акт.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createRevision} className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Локация</Label>
                <Select
                  value={locationId}
                  onValueChange={(value) => {
                    setLocationId(value)
                    setLines([])
                  }}
                >
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
                <Label>Дата ревизии</Label>
                <Input type="date" value={countedAt} onChange={(event) => setCountedAt(event.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Кто проверял и что важно зафиксировать" rows={2} />
            </div>

            {hasDraft && lines.length === 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <span>Найден сохранённый черновик по этой локации и дате.</span>
                <div className="ml-auto flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={loadDraft}>
                    Продолжить
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={dropDraft}>
                    Начать заново
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
              <span>
                Локация: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              </span>
              <span>Позиций в системе: <span className="font-medium text-foreground">{selectedBalances.length}</span></span>
              <span className="ml-auto">
                Сосчитано: <span className="font-medium text-foreground">{lines.length}</span>
                {selectedBalances.length ? ` / ${selectedBalances.length}` : ''}
              </span>
            </div>

            {/* Живая ревизия: магазин работает во время подсчёта */}
            {liveActive && (
              <div className="space-y-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-200">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="font-medium">Живая ревизия — продажи учитываются автоматически</span>
                </div>
                {liveLog.length > 0 && (
                  <div className="flex flex-col gap-0.5 text-emerald-100/80">
                    {liveLog.map((ev) => (
                      <div key={ev.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{ev.name || 'товар'}</span>
                        <span className={ev.delta < 0 ? 'text-rose-300' : 'text-emerald-300'}>
                          {ev.delta > 0 ? '+' : ''}{formatQty(ev.delta)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Прогресс-бар */}
            {selectedBalances.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Прогресс</span>
                  <span>
                    {Math.min(100, Math.round((lines.length / Math.max(1, selectedBalances.length)) * 100))}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.03]">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(100, (lines.length / Math.max(1, selectedBalances.length)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Фильтры строк */}
            {lines.length > 0 && (
              <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
                {(['all', 'mismatch'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setLinesFilter(f)}
                    className={`rounded-md px-3 py-1.5 transition ${linesFilter === f ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {f === 'all' ? `Все · ${lines.length}` : `Расхождения · ${lines.filter((l) => {
                      const exp = Number(selectedBalances.find((b) => b.item_id === l.item_id)?.quantity || 0)
                      return parseQty(l.actual_qty) - exp !== 0
                    }).length}`}
                  </button>
                ))}
              </div>
            )}

            <div
              className={`space-y-2 rounded-2xl border p-3 transition ${
                scanFeedback?.kind === 'error'
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : scanFeedback?.kind === 'ok'
                    ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                    : 'border-cyan-500/20 bg-cyan-500/[0.03]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <ScanLine className="h-4 w-4 text-cyan-300" />
                <Input
                  ref={scanInputRef}
                  value={scanInput}
                  onChange={(event) => setScanInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleScan()
                    }
                  }}
                  placeholder="Сканируйте или введите штрихкод и нажмите Enter"
                  className="h-11 flex-1 text-base"
                  autoComplete="off"
                  disabled={!locationId}
                />
                <Button type="button" variant="outline" className="h-11" onClick={handleScan} disabled={!locationId}>
                  Добавить +1
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={loadFromBalances}
                  disabled={!locationId || !selectedBalances.length}
                >
                  Подтянуть весь каталог
                </Button>
              </div>
              <div className="text-xs">
                {scanFeedback?.kind === 'ok' ? (
                  <span className="text-emerald-200">
                    {scanFeedback.itemName} · факт {formatQty(scanFeedback.prevQty)} → {formatQty(scanFeedback.newQty)}
                    {' · Δ '}
                    {scanFeedback.delta > 0 ? '+' : ''}
                    {formatQty(scanFeedback.delta)}
                  </span>
                ) : scanFeedback?.kind === 'error' ? (
                  <span className="text-rose-200">{scanFeedback.message}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Скан добавляет товар (+1) или подтягивает весь каталог локации одной кнопкой.
                  </span>
                )}
              </div>
              {locationId && barcodeSuggestions.length > 0 ? (
                <div className="mt-1 rounded-xl border border-cyan-500/20 bg-white/[0.02] p-1.5">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Похожие штрихкоды ({barcodeSuggestions.length})
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {barcodeSuggestions.map((item) => {
                      const bc = String(item.barcode || '')
                      const query = scanInput.trim()
                      const idx = bc.lastIndexOf(query)
                      const before = idx >= 0 ? bc.slice(0, idx) : bc
                      const match = idx >= 0 ? bc.slice(idx, idx + query.length) : ''
                      const after = idx >= 0 ? bc.slice(idx + query.length) : ''
                      const balance = Number(selectedBalances.find((b) => b.item_id === item.id)?.quantity || 0)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => addItemByScan(item)}
                          className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-cyan-500/10"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm text-foreground">{item.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {before}
                              <span className="rounded bg-cyan-500/25 px-0.5 text-cyan-100">{match}</span>
                              {after}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted-foreground">
                            остаток {formatQty(balance)}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {lines.length ? lines.map((line, index) => {
                const expectedQty = Number(selectedBalances.find((item) => item.item_id === line.item_id)?.quantity || 0)
                const actualQty = parseQty(line.actual_qty)
                const deltaQty = actualQty - expectedQty
                if (linesFilter === 'mismatch' && deltaQty === 0) return null
                const lineItem = line.item_id
                  ? itemById.get(line.item_id) || balanceItemById.get(line.item_id) || null
                  : null
                const isManualLine = !line.item_id
                const isRecent = recentScanItemId && recentScanItemId === line.item_id
                return (
                  <div
                    key={`revision-${index}`}
                    className={`grid gap-3 rounded-2xl border p-3 transition md:grid-cols-[minmax(0,1.2fr)_160px_100px_100px_minmax(0,1fr)_110px_auto] ${
                      isRecent ? 'border-emerald-500/40 bg-emerald-500/[0.05]' : 'border-white/10 bg-white/[0.02]'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <Label>Товар</Label>
                      {isManualLine ? (
                        <Select
                          value={line.item_id || `__empty__revision_${index}`}
                          onValueChange={(value) =>
                            setLines((current) => {
                              const nextItemId = value.startsWith('__empty__') ? '' : value
                              if (!nextItemId) {
                                return current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, item_id: '' } : item,
                                )
                              }
                              const duplicateExists = current.some((item, itemIndex) => itemIndex !== index && item.item_id === nextItemId)
                              if (duplicateExists) {
                                setError('Этот товар уже добавлен в акт')
                                return current
                              }
                              setError(null)
                              return current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, item_id: nextItemId } : item,
                              )
                            })
                          }
                        >
                          <SelectTrigger className="min-w-0"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={`__empty__revision_${index}`}>Выберите товар</SelectItem>
                            {(data?.items || []).map((item) => (
                              <SelectItem key={`${index}-${item.id}`} value={item.id} title={`${item.name}`}>
                                <span className="block max-w-[420px] truncate">
                                  {item.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground"
                          title={`${lineItem?.name || 'Товар'}`}
                        >
                          <span className="block truncate">
                            {lineItem?.name || 'Товар'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Штрихкод</Label>
                      <Input value={lineItem?.barcode || '—'} readOnly className="bg-white/[0.03]" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Система</Label>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground">{formatQty(expectedQty)}</div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Факт</Label>
                      <Input value={line.actual_qty} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, actual_qty: event.target.value } : item))} placeholder="0" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Комментарий</Label>
                      <Input value={line.comment} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Причина расхождения" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Δ</Label>
                      <div className={`rounded-xl border px-3 py-2 text-center text-sm ${deltaQty === 0 ? 'border-white/10 bg-white/[0.03] text-muted-foreground' : deltaQty > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
                        {deltaQty === 0 ? '—' : `${deltaQty > 0 ? '+' : ''}${formatQty(deltaQty)}`}
                      </div>
                    </div>

                    <div className="flex items-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              }) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  Пока нет строк. Подтяни остатки системы или добавь строки вручную.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                Добавить строку
              </Button>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>Строк: <span className="font-semibold text-foreground">{totals.count}</span></span>
                <span>Недостача: <span className="font-semibold text-rose-300">{formatQty(totals.shortage)}</span></span>
                <span>Излишек: <span className="font-semibold text-emerald-300">{formatQty(totals.surplus)}</span></span>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
              Провести ревизию
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionDetailsOpen} onOpenChange={setRevisionDetailsOpen}>
        <DialogContent className="flex h-[85vh] !w-[92vw] !max-w-[92vw] sm:!max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-white/10 p-5 text-left">
            <div className="space-y-1">
              <DialogTitle>Детали ревизии</DialogTitle>
              <DialogDescription>
                {selectedRevision
                  ? `${formatDate(selectedRevision.counted_at)} · ${selectedRevision.location?.company?.name || selectedRevision.location?.name || 'Локация'}`
                  : 'Проведенный акт ревизии'}
              </DialogDescription>
            </div>
            {selectedRevision ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => printRevision(selectedRevision)}
              >
                Печать / PDF
              </Button>
            ) : null}
          </DialogHeader>
          <div className="flex-1 overflow-auto p-5">
            {!selectedRevision ? (
              <p className="text-sm text-muted-foreground">Акт не выбран.</p>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Провел: <span className="text-foreground">{actorLabel(selectedRevision.created_by_staff, selectedRevision.created_by || null)}</span>
                  {selectedRevision.comment ? (
                    <span> · Комментарий: <span className="text-foreground">{selectedRevision.comment}</span></span>
                  ) : null}
                </div>
                <div className="overflow-auto rounded-xl border border-white/10">
                  <table className="w-full table-fixed text-sm">
                    <thead className="bg-white/[0.03]">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-normal">Товар</th>
                        <th className="px-3 py-2 font-normal">Штрихкод</th>
                        <th className="px-3 py-2 text-right font-normal">Система</th>
                        <th className="px-3 py-2 text-right font-normal">Факт</th>
                        <th className="px-3 py-2 text-right font-normal">Δ</th>
                        <th className="px-3 py-2 font-normal">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedRevision.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2" title={item.item?.name || 'Товар'}>
                            <span className="block truncate">{item.item?.name || 'Товар'}</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.item?.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right">{formatQty(Number(item.expected_qty || 0))}</td>
                          <td className="px-3 py-2 text-right">{formatQty(Number(item.actual_qty || 0))}</td>
                          <td className="px-3 py-2 text-right">{Number(item.delta_qty || 0) > 0 ? '+' : ''}{formatQty(Number(item.delta_qty || 0))}</td>
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
