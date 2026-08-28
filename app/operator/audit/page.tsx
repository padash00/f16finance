'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ClipboardList, Loader2, Package, Save, Search, X } from 'lucide-react'

import { CameraScanner, scanFeedback } from '@/components/store/camera-scanner'
import { OperatorEmptyState, OperatorPanel, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'
import { supabase } from '@/lib/supabaseClient'

type ActRow = { act_id: string; locationName: string; comment: string | null; opened_at: string; sectionLabel: string }
type ItemRow = { item_id: string; name: string; barcode: string | null; unit: string | null; counted: number | null; otherQty?: number | null; otherBy?: string | null }

const fmtDate = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function parseQty(value: string) {
  const n = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round((n + Number.EPSILON) * 1000) / 1000)
}
function fmtQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}
/// Коробка, полкоробки, блок — то, чем считают на самом деле. Ввод «24» руками
/// на телефоне у полки медленнее, чем два нажатия.
const QUICK_ADD = [1, 6, 12, 24, 96, 144]

export default function OperatorAuditPage() {
  const [acts, setActs] = useState<ActRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeAct, setActiveAct] = useState<string | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Автосохранение: каждое введённое число само улетает на сервер (дебаунс), чтобы
  // ничего не терялось при перезагрузке и другие кассиры видели его сразу.
  const [autoStatus, setAutoStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const editsRef = useRef<Record<string, string>>({})
  const dirtyRef = useRef<Set<string>>(new Set())
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Лист ввода количества: скан открывает его, камера на это время замирает.
  // Раньше скан прокручивал список к маленькому полю и пытался в него попасть —
  // промахивался, когда клавиатура уже вылезла, а при фильтре «осталось» строки
  // в списке не было вовсе, и скан молча не делал ничего.
  const [pending, setPending] = useState<ItemRow | null>(null)
  const [qtyInput, setQtyInput] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const fbTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [query, setQuery] = useState('')                       // поиск, когда штрихкода нет
  const [onlyLeft, setOnlyLeft] = useState(false)              // фильтр «осталось посчитать»
  const [unknownCode, setUnknownCode] = useState<string | null>(null) // штрихкод не из списка
  const unknownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { editsRef.current = edits }, [edits])
  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current)
    if (unknownTimer.current) clearTimeout(unknownTimer.current)
    if (fbTimer.current) clearTimeout(fbTimer.current)
  }, [])

  const flash = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (fbTimer.current) clearTimeout(fbTimer.current)
    fbTimer.current = setTimeout(() => setFeedback(null), 2200)
  }, [])

  const itemByBarcode = useMemo(() => {
    const m = new Map<string, ItemRow>()
    for (const it of items) if (it.barcode) m.set(String(it.barcode).trim(), it)
    return m
  }, [items])

  const handleScan = useCallback(
    (raw: string) => {
      const code = String(raw || '').trim()
      if (!code) return
      const it = itemByBarcode.get(code)
      if (!it) {
        scanFeedback(false)
        // штрихкод не из списка ревизии — покажем кассиру, чтобы не считал «в пустоту»
        setUnknownCode(code)
        if (unknownTimer.current) clearTimeout(unknownTimer.current)
        unknownTimer.current = setTimeout(() => setUnknownCode(null), 4000)
        return
      }
      setUnknownCode(null)
      scanFeedback(true)
      setPending(it)
      setQuery('')
      // Уже введённое подставляем: пересчитали полку — правят число, а не набирают заново.
      setQtyInput(editsRef.current[it.item_id] ?? '')
    },
    [itemByBarcode],
  )

  const loadActs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/operator/audit', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Ошибка')
      setActs(j?.data || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить ревизии')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadActs()
  }, [loadActs])

  // Тихий рефетч позиций (без мигания): обновляет отметки «уже посчитал другой кассир».
  // Свой ввод (edits) не трогаем — он живёт отдельно.
  const refreshItems = useCallback((id: string) => {
    return fetch(`/api/operator/audit?act=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const list = j?.data?.items; if (Array.isArray(list)) setItems(list as ItemRow[]) })
      .catch(() => {})
  }, [])

  // Realtime: подписываемся на изменения подсчётов этого акта — как только другой кассир
  // сохранил позицию, у нас она сразу подсветится «уже посчитал …». Дебаунс 350мс, чтобы
  // пачка сохранений дала один рефетч. Требует таблицу в publication supabase_realtime.
  useEffect(() => {
    if (!activeAct) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void refreshItems(activeAct), 350) }
    const channel = supabase
      .channel(`audit-counts-${activeAct}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_audit_counts', filter: `act_id=eq.${activeAct}` }, bump)
      .subscribe()
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel) }
  }, [activeAct, refreshItems])

  // Страховка: если realtime-публикация на таблице не включена — мягкий опрос раз в 15с.
  useEffect(() => {
    if (!activeAct) return
    const t = setInterval(() => void refreshItems(activeAct), 15000)
    return () => clearInterval(t)
  }, [activeAct, refreshItems])

  const openAct = useCallback(async (id: string) => {
    setActiveAct(id)
    setItemsLoading(true)
    setEdits({})
    setSaved(false)
    setAutoStatus('idle')
    dirtyRef.current = new Set()
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    try {
      const res = await fetch(`/api/operator/audit?act=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Ошибка')
      const list = (j?.data?.items || []) as ItemRow[]
      setItems(list)
      const init: Record<string, string> = {}
      for (const it of list) if (it.counted != null) init[it.item_id] = String(it.counted)
      setEdits(init)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить товары')
    } finally {
      setItemsLoading(false)
    }
  }, [])

  // Автосохранение «грязных» позиций (изменённых с последнего сохранения).
  const flushAutosave = useCallback(async () => {
    if (!activeAct) return
    const ids = Array.from(dirtyRef.current)
    dirtyRef.current = new Set()
    const counts = ids
      .map((item_id) => ({ item_id, v: editsRef.current[item_id] }))
      .filter((x) => x.v != null && String(x.v).trim() !== '')
      .map((x) => ({ item_id: x.item_id, counted_qty: Number(String(x.v).replace(',', '.')) || 0 }))
    if (counts.length === 0) { setAutoStatus('idle'); return }
    setAutoStatus('saving')
    try {
      const res = await fetch('/api/operator/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ act_id: activeAct, counts }) })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.map((it) => {
        const c = counts.find((x) => x.item_id === it.item_id)
        return c ? { ...it, counted: c.counted_qty } : it
      }))
      setAutoStatus('saved')
    } catch {
      // не удалось — вернём в очередь и попробуем при следующем вводе/сохранении
      for (const c of counts) dirtyRef.current.add(c.item_id)
      setAutoStatus('error')
    }
  }, [activeAct])

  // «Готово» в листе: число записано, лист закрывается, камера просыпается.
  // Сохраняем сразу, без дебаунса — человек уже отошёл к следующей полке, и
  // ждать от него ещё одного действия нечестно.
  const confirmQty = useCallback(() => {
    if (!pending) return
    const qty = parseQty(qtyInput)
    const id = pending.item_id
    setEdits((p) => ({ ...p, [id]: fmtQty(qty) }))
    editsRef.current = { ...editsRef.current, [id]: fmtQty(qty) }
    dirtyRef.current.add(id)
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    void flushAutosave()
    flash(true, `${pending.name}: ${fmtQty(qty)}`)
    setPending(null)
    setQtyInput('')
  }, [pending, qtyInput, flushAutosave, flash])

  const cancelQty = useCallback(() => { setPending(null); setQtyInput('') }, [])

  const openItem = useCallback((it: ItemRow) => {
    setPending(it)
    setQtyInput(editsRef.current[it.item_id] ?? '')
  }, [])

  // Ручное «Сохранить всё» — резерв (например, если автосейв упал): шлёт все непустые.
  const save = async () => {
    if (!activeAct) return
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    const counts = Object.entries(editsRef.current)
      .filter(([, v]) => String(v).trim() !== '')
      .map(([item_id, v]) => ({ item_id, counted_qty: Number(String(v).replace(',', '.')) || 0 }))
    if (counts.length === 0) {
      setError('Введите хотя бы одно количество')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/operator/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ act_id: activeAct, counts }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Ошибка сохранения')
      dirtyRef.current = new Set()
      setSaved(true)
      setAutoStatus('saved')
      // обновим counted в списке
      setItems((prev) => prev.map((it) => (editsRef.current[it.item_id] != null && String(editsRef.current[it.item_id]).trim() !== '' ? { ...it, counted: Number(String(editsRef.current[it.item_id]).replace(',', '.')) || 0 } : it)))
      setTimeout(() => setSaved(false), 1800)
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const countedNum = useMemo(() => Object.values(edits).filter((v) => String(v).trim() !== '').length, [edits])
  const leftNum = items.length - countedNum
  // Видимые позиции: фильтр «осталось» плюс поиск по названию и штрихкоду —
  // на штрихкод без наклейки или стёртый скан не сработает, а товар посчитать надо.
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = onlyLeft ? items.filter((it) => String(edits[it.item_id] ?? '').trim() === '') : items
    if (q) list = list.filter((it) => it.name.toLowerCase().includes(q) || String(it.barcode || '').includes(q))
    return list
  }, [items, onlyLeft, edits, query])

  // ── Список актов ───────────────────────────────────────────────────────────
  if (!activeAct) {
    return (
      <div className="space-y-3">
        <OperatorPanel accent="amber">
          <OperatorSectionHeading title="Ревизия" description="Назначенные вам акты. Считайте товар по своей секции — системный остаток не показывается." />
        </OperatorPanel>

        {error ? <OperatorPanel className="border-rose-500/40 text-sm text-rose-300">{error}</OperatorPanel> : null}

        {loading ? (
          <OperatorPanel>
            <div className="flex items-center gap-3 font-mono text-[13px] uppercase text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
          </OperatorPanel>
        ) : acts.length === 0 ? (
          <OperatorEmptyState title="Нет активных ревизий" description="Когда руководитель назначит вас на акт ревизии, он появится здесь." />
        ) : (
          <div className="space-y-2">
            {acts.map((a) => (
              <button key={a.act_id} type="button" onClick={() => void openAct(a.act_id)} className="block w-full border border-[#23262b] bg-[#0e0f10] p-4 text-left transition hover:border-amber-400/40">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-amber-400" />
                  <span className="font-mono text-[14px] uppercase tracking-wide text-zinc-100">{a.locationName}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-zinc-500">секция: {a.sectionLabel} · {fmtDate(a.opened_at)}</div>
                {a.comment ? <div className="mt-1 text-[12px] text-zinc-500">{a.comment}</div> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Слепой подсчёт ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pb-44 lg:pb-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { setActiveAct(null); void loadActs() }} className="border border-[#23262b] p-2 text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[14px] font-semibold uppercase tracking-tight text-zinc-100">Подсчёт</div>
          <div className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 tabular-nums">введено {countedNum} из {items.length}</div>
        </div>
        <div className="shrink-0 font-mono text-[10px] uppercase tracking-wide">
          {autoStatus === 'saving' ? (
            <span className="flex items-center gap-1 text-amber-300/90"><Loader2 className="h-3 w-3 animate-spin" /> сохраняю…</span>
          ) : autoStatus === 'saved' ? (
            <span className="text-emerald-400/90">сохранено ✓</span>
          ) : autoStatus === 'error' ? (
            <span className="text-rose-300">не сохранилось</span>
          ) : (
            <span className="text-zinc-600">автосохранение</span>
          )}
        </div>
      </div>

      {error ? <div className="border border-rose-500/40 bg-rose-500/[0.06] p-3 font-mono text-[12px] text-rose-300">{error}</div> : null}

      {items.some((it) => it.otherBy) ? (
        <div className="border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5 font-mono text-[11px] text-emerald-300/90">Зелёным — уже посчитал другой кассир. Не считайте эти позиции повторно.</div>
      ) : null}

      {/* Камера: STICKY сверху — скан доступен с любого места списка (не нужно
          листать наверх). Штрихкод → подсветит и сфокусирует нужный товар ниже. */}
      {!itemsLoading && items.length > 0 ? (
        <div className="sticky top-0 z-20 -mx-3 bg-[#0a0b0c] px-3 pb-2 pt-1 sm:-mx-5 sm:px-5">
          <CameraScanner
            onDetect={handleScan}
            onError={(m) => setError(m)}
            paused={!!pending}
            feedback={feedback}
            accent="amber"
            aspectClass="aspect-[2/1]"
            debounceMs={1500}
            startLabel="Сканировать камерой"
          />
          {/* Прогресс + фильтр «осталось посчитать» */}
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${items.length ? (countedNum / items.length) * 100 : 0}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 tabular-nums">посчитано {countedNum} · осталось {leftNum}</span>
              <button
                type="button"
                onClick={() => setOnlyLeft((v) => !v)}
                className={`border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition ${onlyLeft ? 'border-amber-400/60 bg-amber-400/15 text-amber-300' : 'border-[#23262b] text-zinc-400 hover:text-zinc-200'}`}
              >
                {onlyLeft ? `показаны осталось (${leftNum})` : 'показать осталось'}
              </button>
            </div>
          </div>
          {/* Поиск: когда наклейки нет или скан не берёт */}
          <div className="mt-1.5 flex items-center gap-2 border border-[#23262b] bg-[#0b0c0d] px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти по названию или штрихкоду"
              className="w-full bg-transparent py-2 font-mono text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="shrink-0 text-zinc-600 hover:text-zinc-300"><X className="h-3.5 w-3.5" /></button>
            ) : null}
          </div>

          {/* Штрихкод не из списка ревизии */}
          {unknownCode ? (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/[0.08] p-2 font-mono text-[11px] leading-snug text-amber-300">
              Штрихкод <span className="tabular-nums">{unknownCode}</span> — нет в списке. Возможно, товар не из вашей секции или его нет в каталоге.
            </div>
          ) : null}
        </div>
      ) : null}

      {itemsLoading ? (
        <div className="flex items-center gap-3 border border-[#23262b] bg-[#0e0f10] p-4 font-mono text-[13px] uppercase text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка товаров…</div>
      ) : items.length === 0 ? (
        <OperatorEmptyState title="В вашей секции нет товаров" description="По назначенной секции нет позиций для подсчёта." />
      ) : visibleItems.length === 0 && query.trim() ? (
        <OperatorEmptyState title="Ничего не нашлось" description="По этому названию или штрихкоду в вашей секции позиций нет." />
      ) : visibleItems.length === 0 ? (
        <OperatorEmptyState title="Всё посчитано ✓" description="В этой секции не осталось непосчитанных позиций. Сними фильтр, чтобы видеть все." />
      ) : (
        <div className="space-y-1.5">
          {visibleItems.map((it) => {
            const entered = String(edits[it.item_id] ?? '').trim()
            return (
              <button
                key={it.item_id}
                type="button"
                onClick={() => openItem(it)}
                className={`flex w-full items-center justify-between gap-3 border bg-[#0b0c0d] p-3 text-left transition ${it.otherBy && entered === '' ? 'border-emerald-500/30' : entered !== '' ? 'border-amber-400/40' : 'border-[#23262b] hover:border-amber-400/30'}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px] text-zinc-100">{it.name}</div>
                  {it.barcode ? <div className="font-mono text-[10px] text-zinc-600 tabular-nums">{it.barcode}</div> : null}
                  {it.otherBy ? <div className="font-mono text-[10px] text-emerald-400/90">✓ уже посчитал(а) {it.otherBy}: {it.otherQty}</div> : null}
                </div>
                <div className={`w-20 shrink-0 border py-2 text-center font-mono text-lg font-bold tabular-nums ${entered !== '' ? 'border-amber-400/50 bg-amber-400/10 text-amber-400' : 'border-[#23262b] text-zinc-700'}`}>
                  {entered !== '' ? entered : '—'}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {items.length > 0 ? (
        <div
          className="fixed inset-x-0 z-30 border-t border-[#23262b] bg-[#0a0b0c]/95 p-3 backdrop-blur lg:hidden"
          style={{ bottom: 'calc(3.6rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
            <span className="tabular-nums text-zinc-500">введено {countedNum} из {items.length}</span>
            {autoStatus === 'saving' ? (
              <span className="flex items-center gap-1 text-amber-300/90"><Loader2 className="h-3 w-3 animate-spin" /> сохраняю…</span>
            ) : autoStatus === 'saved' ? (
              <span className="text-emerald-400/90">сохранено ✓</span>
            ) : autoStatus === 'error' ? (
              <span className="text-rose-300">не сохранилось — нажми «Сохранить»</span>
            ) : (
              <span className="text-zinc-600">автосохранение</span>
            )}
          </div>
          <button type="button" onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 border border-amber-400/60 bg-amber-400/15 py-3 font-mono text-[14px] font-semibold uppercase tracking-wide text-amber-300 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? 'Сохранено ✓' : 'Сохранить всё'}
          </button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <button type="button" onClick={save} disabled={saving} className="hidden w-full items-center justify-center gap-2 border border-amber-400/60 bg-amber-400/15 py-3 font-mono text-[14px] font-semibold uppercase tracking-wide text-amber-300 disabled:opacity-50 lg:flex">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? 'Сохранено ✓' : 'Сохранить подсчёт'}
        </button>
      ) : null}

      {/* Лист ввода количества — то же, что на сайте: крупное поле и коробки.
          Остаток по системе тут не показываем: подсчёт слепой, и подсказанное
          число люди переписывают вместо того, чтобы считать. */}
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75" onClick={cancelQty}>
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto border-t border-amber-400/30 bg-[#0e0f10] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-amber-500/40 text-amber-300">
                  <Package className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[14px] text-zinc-100">{pending.name}</div>
                  {pending.barcode ? <div className="font-mono text-[10px] text-zinc-600 tabular-nums">{pending.barcode}</div> : null}
                </div>
              </div>
              <button type="button" onClick={cancelQty} className="text-zinc-500 hover:text-zinc-200"><X className="h-5 w-5" /></button>
            </div>

            {pending.otherBy ? (
              <div className="mt-3 border border-emerald-500/30 bg-emerald-500/[0.06] p-2 font-mono text-[11px] text-emerald-300/90">
                Эту позицию уже посчитал(а) {pending.otherBy}: {pending.otherQty}. Считайте заново, только если уверены.
              </div>
            ) : null}

            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Сколько на полке{pending.unit ? ` · ${pending.unit}` : ''}
              </div>
              <input
                autoFocus
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmQty() }}
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full border border-[#23262b] bg-black px-3 py-3 text-center font-mono text-3xl font-bold tabular-nums text-amber-400 focus:border-amber-400/50 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_ADD.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQtyInput(fmtQty(parseQty(qtyInput) + n))}
                    className="border border-[#23262b] px-3 py-1.5 font-mono text-[12px] tabular-nums text-zinc-300 hover:border-amber-400/40 hover:text-amber-300"
                  >
                    +{n}
                  </button>
                ))}
                <button type="button" onClick={() => setQtyInput('')} className="border border-[#23262b] px-3 py-1.5 font-mono text-[12px] text-zinc-500 hover:text-zinc-200">сброс</button>
              </div>
            </div>

            <button type="button" onClick={confirmQty} className="mt-4 w-full border border-amber-400/60 bg-amber-400/15 py-3 font-mono text-[14px] font-semibold uppercase tracking-wide text-amber-300">
              Готово
            </button>
            <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-zinc-600">камера продолжит после «готово»</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
