'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ClipboardList, Loader2, Save } from 'lucide-react'

import { CameraScanner, scanFeedback } from '@/components/store/camera-scanner'
import { OperatorEmptyState, OperatorPanel, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'
import { supabase } from '@/lib/supabaseClient'

type ActRow = { act_id: string; locationName: string; comment: string | null; opened_at: string; sectionLabel: string }
type ItemRow = { item_id: string; name: string; barcode: string | null; unit: string | null; counted: number | null; otherQty?: number | null; otherBy?: string | null }

const fmtDate = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

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

  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => { editsRef.current = edits }, [edits])
  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current) }, [])

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
        return
      }
      scanFeedback(true)
      setHighlightId(it.item_id)
      const el = document.getElementById(`audit-input-${it.item_id}`) as HTMLInputElement | null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setTimeout(() => el.focus(), 250)
      }
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

  // Ввод количества: обновляем поле, помечаем «грязным» и планируем автосейв через 700мс.
  const onCount = useCallback((id: string, val: string) => {
    setEdits((p) => ({ ...p, [id]: val }))
    dirtyRef.current.add(id)
    setAutoStatus('saving')
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => void flushAutosave(), 700)
  }, [flushAutosave])

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
    <div className="space-y-3 pb-24">
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

      {/* Камера: скан штрихкода → подсветит и сфокусирует нужный товар */}
      {!itemsLoading && items.length > 0 ? (
        <CameraScanner
          onDetect={handleScan}
          onError={(m) => setError(m)}
          accent="amber"
          aspectClass="aspect-[5/3]"
          debounceMs={1500}
          startLabel="Сканировать камерой"
        />
      ) : null}

      {itemsLoading ? (
        <div className="flex items-center gap-3 border border-[#23262b] bg-[#0e0f10] p-4 font-mono text-[13px] uppercase text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка товаров…</div>
      ) : items.length === 0 ? (
        <OperatorEmptyState title="В вашей секции нет товаров" description="По назначенной секции нет позиций для подсчёта." />
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.item_id} className={`flex items-center justify-between gap-3 border bg-[#0b0c0d] p-3 ${it.otherBy && (edits[it.item_id] ?? '') === '' ? 'border-emerald-500/30' : 'border-[#23262b]'}`}>
              <div className="min-w-0">
                <div className="truncate font-mono text-[13px] text-zinc-100">{it.name}</div>
                {it.barcode ? <div className="font-mono text-[10px] text-zinc-600 tabular-nums">{it.barcode}</div> : null}
                {it.otherBy ? <div className="font-mono text-[10px] text-emerald-400/90">✓ уже посчитал(а) {it.otherBy}: {it.otherQty}</div> : null}
              </div>
              <input
                id={`audit-input-${it.item_id}`}
                value={edits[it.item_id] ?? ''}
                onChange={(e) => onCount(it.item_id, e.target.value)}
                onBlur={() => { if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null } void flushAutosave() }}
                onFocus={() => setHighlightId(it.item_id)}
                inputMode="decimal"
                placeholder="0"
                className={`w-20 shrink-0 border bg-black px-2 py-2 text-center font-mono text-lg font-bold tabular-nums text-amber-400 focus:outline-none ${highlightId === it.item_id ? 'border-amber-400' : 'border-[#23262b] focus:border-amber-400/50'}`}
              />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#23262b] bg-[#0a0b0c]/95 p-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom,0px))' }}>
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
    </div>
  )
}
