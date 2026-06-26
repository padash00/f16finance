'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Package, ScanLine, Search, X } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { CameraScanner, scanFeedback } from '@/components/store/camera-scanner'

type Item = { id: string; name: string; barcode?: string | null; unit?: string }
type Balance = { location_id: string; item_id: string; quantity: number; item?: Item | null }
type Loc = { id: string; name: string; location_type: string; company?: { name?: string | null } | null }
type RevData = { items: Item[]; locations: Loc[]; balances: Balance[] }

function parseQty(value: string) {
  const n = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round((n + Number.EPSILON) * 1000) / 1000)
}
function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

const locLabel = (l: Loc) =>
  `${l.company?.name ? l.company.name + ' · ' : ''}${l.location_type === 'point_display' ? 'Витрина' : l.location_type === 'warehouse' ? 'Склад' : l.name}`

export default function ScanRevisionPage() {
  const [data, setData] = useState<RevData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [pending, setPending] = useState<{ item: Item; expected: number } | null>(null)
  const [qtyInput, setQtyInput] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [manual, setManual] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ changed: number } | null>(null)

  const fbTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Черновик ревизии: СЕРВЕРНЫЙ (переживает смену устройства + общий для
  //    параллельных кассиров) с localStorage как офлайн-подстраховкой. ──
  const draftKey = useCallback(
    (loc: string) => `revision-scan-draft:${loc}:${new Date().toISOString().slice(0, 10)}`,
    [],
  )
  // item_id → ms последнего ЛОКАЛЬНОГО изменения (чтобы поллинг не затирал свежий ввод)
  const lastLocalRef = useRef<Record<string, number>>({})

  // Записать подсчёт позиции на сервер (fire-and-forget)
  const pushDraftItem = useCallback((itemId: string, qty: number) => {
    if (!locationId) return
    lastLocalRef.current[itemId] = Date.now()
    void fetch('/api/admin/store/revisions/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locationId, item_id: itemId, actual_qty: qty }),
    }).catch(() => { /* офлайн — localStorage подстрахует */ })
  }, [locationId])

  // Загрузка при выборе точки: сначала сервер (общий счёт), иначе localStorage
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/admin/store/revisions/draft?location_id=${encodeURIComponent(locationId)}`, { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json().catch(() => null)
          const srv = json?.data?.counts
          if (!cancelled && srv && typeof srv === 'object') { setCounts(srv); return }
        }
      } catch { /* сервер недоступен — фолбэк ниже */ }
      try {
        const raw = window.localStorage.getItem(draftKey(locationId))
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed.counts === 'object') setCounts(parsed.counts || {})
        }
      } catch { /* поврежденный черновик — игнорируем */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  // Поллинг: подсос подсчётов других кассиров (общий счёт точки). Не затираем
  // позиции, изменённые локально в последние 8с (ещё летят на сервер).
  useEffect(() => {
    if (!locationId) return
    const t = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/admin/store/revisions/draft?location_id=${encodeURIComponent(locationId)}`, { cache: 'no-store' })
          if (!res.ok) return
          const json = await res.json().catch(() => null)
          const srv = json?.data?.counts as Record<string, number> | undefined
          if (!srv) return
          setCounts((prev) => {
            const next = { ...prev }
            const now = Date.now()
            for (const [id, q] of Object.entries(srv)) {
              if ((lastLocalRef.current[id] || 0) > now - 8000) continue
              next[id] = Number(q)
            }
            return next
          })
        } catch { /* сеть моргнула — пропускаем тик */ }
      })()
    }, 6000)
    return () => clearInterval(t)
  }, [locationId])

  // localStorage-подстраховка (офлайн / сервер недоступен)
  useEffect(() => {
    if (!locationId) return
    try {
      if (Object.keys(counts).length === 0) window.localStorage.removeItem(draftKey(locationId))
      else window.localStorage.setItem(draftKey(locationId), JSON.stringify({ counts, savedAt: new Date().toISOString() }))
    } catch { /* localStorage забит — пропускаем */ }
  }, [counts, locationId, draftKey])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/store/revisions?scope=all', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
        if (!cancelled) setData(json?.data || null)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Не удалось загрузить данные')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const locations = data?.locations || []
  const selectedLoc = locations.find((l) => l.id === locationId) || null

  const itemByBarcode = useMemo(() => {
    const m = new Map<string, Item>()
    for (const it of data?.items || []) {
      const bc = String(it.barcode || '').trim()
      if (bc) m.set(bc, it)
    }
    return m
  }, [data?.items])

  const itemById = useMemo(() => {
    const m = new Map<string, Item>()
    for (const it of data?.items || []) m.set(it.id, it)
    return m
  }, [data?.items])

  const expectedByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of data?.balances || []) {
      if (b.location_id === locationId) m.set(b.item_id, Number(b.quantity || 0))
    }
    return m
  }, [data?.balances, locationId])

  const totalItems = useMemo(() => {
    let n = 0
    for (const b of data?.balances || []) if (b.location_id === locationId && Number(b.quantity || 0) > 0) n++
    return n
  }, [data?.balances, locationId])

  const flash = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (fbTimer.current) clearTimeout(fbTimer.current)
    fbTimer.current = setTimeout(() => setFeedback(null), 2200)
  }, [])

  const handleBarcode = useCallback(
    (raw: string) => {
      const code = String(raw || '').trim()
      if (!code) return
      const item = itemByBarcode.get(code)
      if (!item) {
        scanFeedback(false)
        flash(false, `Штрихкод не найден: ${code}`)
        return
      }
      scanFeedback(true)
      setPending({ item, expected: expectedByItem.get(item.id) ?? 0 })
      setQtyInput(counts[item.id] != null ? fmt(counts[item.id]) : '')
    },
    [itemByBarcode, expectedByItem, counts, flash],
  )

  const confirmQty = () => {
    if (!pending) return
    const qty = parseQty(qtyInput)
    setCounts((prev) => ({ ...prev, [pending.item.id]: qty }))
    pushDraftItem(pending.item.id, qty)
    flash(true, `${pending.item.name}: ${fmt(qty)}`)
    setPending(null)
    setQtyInput('')
  }
  const cancelQty = () => {
    setPending(null)
    setQtyInput('')
  }

  const addManual = (item: Item) => {
    setPending({ item, expected: expectedByItem.get(item.id) ?? 0 })
    setQtyInput(counts[item.id] != null ? fmt(counts[item.id]) : '')
    setManual('')
  }

  const manualResults = useMemo(() => {
    const q = manual.trim().toLowerCase()
    if (q.length < 2) return []
    return (data?.items || [])
      .filter((it) => it.name.toLowerCase().includes(q) || String(it.barcode || '').includes(q))
      .filter((it) => expectedByItem.has(it.id))
      .slice(0, 12)
  }, [manual, data?.items, expectedByItem])

  const countedList = useMemo(() => {
    return Object.entries(counts)
      .map(([id, qty]) => {
        const item = itemById.get(id)
        const expected = expectedByItem.get(id) ?? 0
        return { id, name: item?.name || 'Товар', qty, expected, delta: qty - expected }
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [counts, itemById, expectedByItem])

  const countedCount = countedList.length

  const submit = async () => {
    if (!locationId || countedCount === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const items = Object.entries(counts).map(([item_id, qty]) => ({ item_id, actual_qty: qty, comment: '' }))
      const res = await fetch('/api/admin/store/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createRevision',
          payload: { location_id: locationId, counted_at: new Date().toISOString().slice(0, 10), comment: 'Мобильная ревизия (камера)', items },
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || json?.message || `Ошибка (${res.status})`)
      try { window.localStorage.removeItem(draftKey(locationId)) } catch {}
      // очищаем общий серверный черновик точки после успешного провода
      void fetch(`/api/admin/store/revisions/draft?location_id=${encodeURIComponent(locationId)}`, { method: 'DELETE' }).catch(() => {})
      setResult({ changed: Number(json?.data?.changed_items ?? items.length) })
    } catch (e: any) {
      setError(e?.message || 'Не удалось провести ревизию')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Экран результата ───────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center border border-emerald-500/40 text-emerald-400">
          <Check className="h-8 w-8" />
        </div>
        <div className="font-mono text-lg font-semibold uppercase tracking-wide text-slate-900 dark:text-zinc-100">Ревизия проведена</div>
        <div className="font-mono text-sm text-slate-500 dark:text-zinc-400">Скорректировано позиций: {result.changed}</div>
        <div className="flex justify-center gap-2">
          <Link href="/store/revisions" className="border border-slate-200 dark:border-white/10 px-4 py-2 font-mono text-[13px] uppercase tracking-wide text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100">
            К ревизиям
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setCounts({})
            }}
            className="border border-amber-400/50 bg-amber-400/10 px-4 py-2 font-mono text-[13px] uppercase tracking-wide text-amber-300"
          >
            Новая
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-3 pb-24">
      <AdminPageHeader
        title="Сканер-ревизия"
        description="Считай товар камерой телефона"
        icon={<ScanLine className="h-5 w-5" />}
        accent="emerald"
        backHref="/store/revisions"
      />

      {error ? <div className="border border-rose-500/40 bg-rose-500/[0.06] p-3 font-mono text-[12px] text-rose-300">{error}</div> : null}

      {loading ? (
        <div className="flex items-center gap-3 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-4 font-mono text-[13px] uppercase text-slate-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : !locationId ? (
        // ── Выбор локации ──────────────────────────────────────────────────────
        <div className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Выберите, что считаем</div>
          {locations.length === 0 ? (
            <div className="border border-dashed border-slate-200 dark:border-white/10 p-6 text-center font-mono text-[12px] uppercase text-zinc-500">Нет доступных локаций</div>
          ) : (
            locations.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLocationId(l.id)}
                className="flex w-full items-center justify-between border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-4 text-left transition hover:border-amber-400/40"
              >
                <span className="font-mono text-[14px] uppercase tracking-wide text-slate-900 dark:text-zinc-100">{locLabel(l)}</span>
                <span className="font-mono text-[10px] uppercase text-zinc-600">{l.location_type === 'point_display' ? 'витрина' : l.location_type === 'warehouse' ? 'склад' : ''}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        // ── Сканирование ───────────────────────────────────────────────────────
        <>
          <div className="flex items-center justify-between border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[13px] uppercase tracking-wide text-slate-900 dark:text-zinc-100">{selectedLoc ? locLabel(selectedLoc) : ''}</div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">посчитано {countedCount} из {totalItems}</div>
            </div>
            <button type="button" onClick={() => setLocationId('')} className="font-mono text-[11px] uppercase text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200">сменить</button>
          </div>

          {/* Камера */}
          <CameraScanner
            onDetect={handleBarcode}
            onError={(m) => setError(m)}
            paused={!!pending}
            feedback={feedback}
            accent="amber"
            debounceMs={2000}
            startLabel="Включить камеру"
          />

          {/* Поиск вручную (если штрихкода нет) */}
          <div className="border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-2">
            <div className="flex items-center gap-2 px-1">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Найти по названию (если нет штрихкода)"
                className="w-full bg-transparent py-1.5 font-mono text-[13px] text-slate-900 dark:text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            {manualResults.length > 0 ? (
              <div className="mt-1 max-h-52 space-y-1 overflow-y-auto">
                {manualResults.map((it) => (
                  <button key={it.id} type="button" onClick={() => addManual(it)} className="flex w-full items-center justify-between gap-2 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-left">
                    <span className="truncate font-mono text-[12px] text-slate-700 dark:text-zinc-200">{it.name}</span>
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums">сист. {fmt(expectedByItem.get(it.id) ?? 0)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Посчитанное */}
          {countedList.length > 0 ? (
            <div className="space-y-1.5">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Посчитано</div>
              {countedList.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    const item = itemById.get(row.id)
                    if (item) addManual(item)
                  }}
                  className="flex w-full items-center justify-between gap-3 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px] text-slate-900 dark:text-zinc-100">{row.name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">факт {fmt(row.qty)} · сист. {fmt(row.expected)}</div>
                  </div>
                  <div className={`shrink-0 font-mono text-[13px] font-semibold tabular-nums ${row.delta < 0 ? 'text-rose-400' : row.delta > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {row.delta > 0 ? '+' : ''}
                    {fmt(row.delta)}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* Кнопка провести */}
      {locationId && countedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 dark:border-white/10 bg-background/95 p-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom,0px))' }}>
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 border border-amber-400/60 bg-amber-400/15 py-3 font-mono text-[14px] font-semibold uppercase tracking-wide text-amber-300 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Провести ревизию · {countedCount} поз.
            </button>
          </div>
        </div>
      ) : null}

      {/* Лист ввода количества */}
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={cancelQty}>
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto border-t border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-amber-500/40 text-amber-700 dark:text-amber-300">
                  <Package className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[14px] text-slate-900 dark:text-zinc-100">{pending.item.name}</div>
                  <div className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 tabular-nums">Система: {fmt(pending.expected)}{pending.item.unit ? ` ${pending.item.unit}` : ''}</div>
                </div>
              </div>
              <button type="button" onClick={cancelQty} className="text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Фактическое количество</div>
              <input
                autoFocus
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmQty()
                }}
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full border border-slate-200 dark:border-white/10 bg-white dark:bg-black px-3 py-3 text-center font-mono text-3xl font-bold tabular-nums text-amber-400 focus:border-amber-400/50 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[1, 6, 12, 24, 96, 144].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQtyInput(fmt(parseQty(qtyInput) + n))}
                    className="border border-slate-200 dark:border-white/10 px-3 py-1.5 font-mono text-[12px] tabular-nums text-slate-700 dark:text-zinc-300 hover:border-amber-400/40 hover:text-amber-300"
                  >
                    +{n}
                  </button>
                ))}
                <button type="button" onClick={() => setQtyInput('')} className="border border-slate-200 dark:border-white/10 px-3 py-1.5 font-mono text-[12px] text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200">сброс</button>
              </div>
            </div>

            <button type="button" onClick={confirmQty} className="mt-4 w-full border border-amber-400/60 bg-amber-400/15 py-3 font-mono text-[14px] font-semibold uppercase tracking-wide text-amber-300">
              Готово
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
