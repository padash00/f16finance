'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { ArrowLeft, Camera, ClipboardList, Flashlight, Loader2, Save } from 'lucide-react'

import { OperatorEmptyState, OperatorPanel, OperatorSectionHeading } from '@/components/operator/operator-mobile-ui'

let audioCtx: AudioContext | null = null
function beep(ok: boolean) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.connect(g)
    g.connect(audioCtx.destination)
    o.frequency.value = ok ? 880 : 220
    g.gain.value = 0.05
    o.start()
    o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.18))
  } catch {
    /* звук необязателен */
  }
}

type ActRow = { act_id: string; locationName: string; comment: string | null; opened_at: string; sectionLabel: string }
type ItemRow = { item_id: string; name: string; barcode: string | null; unit: string | null; counted: number | null }

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

  const [scanning, setScanning] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const lastScan = useRef<{ code: string; t: number }>({ code: '', t: 0 })

  const itemByBarcode = useMemo(() => {
    const m = new Map<string, ItemRow>()
    for (const it of items) if (it.barcode) m.set(String(it.barcode).trim(), it)
    return m
  }, [items])

  const handleScan = useCallback(
    (raw: string) => {
      const code = String(raw || '').trim()
      if (!code) return
      const now = Date.now()
      if (lastScan.current.code === code && now - lastScan.current.t < 1500) return
      lastScan.current = { code, t: now }
      const it = itemByBarcode.get(code)
      if (!it) {
        beep(false)
        return
      }
      beep(true)
      setHighlightId(it.item_id)
      const el = document.getElementById(`audit-input-${it.item_id}`) as HTMLInputElement | null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setTimeout(() => el.focus(), 250)
      }
    },
    [itemByBarcode],
  )

  useEffect(() => {
    if (!scanning) return
    let cancelled = false
    const reader = new BrowserMultiFormatReader()
    void (async () => {
      try {
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current as HTMLVideoElement, (res) => {
          if (res) handleScan(res.getText())
        })
        if (cancelled) controls.stop()
        else {
          controlsRef.current = controls
          const stream = (videoRef.current?.srcObject as MediaStream | null) || null
          trackRef.current = stream?.getVideoTracks?.()[0] || null
        }
      } catch (e: any) {
        if (!cancelled) {
          setError('Камера недоступна: ' + (e?.message || ''))
          setScanning(false)
        }
      }
    })()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
      trackRef.current = null
      setTorchOn(false)
    }
  }, [scanning, handleScan])

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] })
      setTorchOn((v) => !v)
    } catch {
      /* фонарик не поддерживается устройством */
    }
  }

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

  const openAct = useCallback(async (id: string) => {
    setActiveAct(id)
    setItemsLoading(true)
    setEdits({})
    setSaved(false)
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

  const save = async () => {
    if (!activeAct) return
    const counts = Object.entries(edits)
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
      setSaved(true)
      // обновим counted в списке
      setItems((prev) => prev.map((it) => (edits[it.item_id] != null && String(edits[it.item_id]).trim() !== '' ? { ...it, counted: Number(String(edits[it.item_id]).replace(',', '.')) || 0 } : it)))
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
        <div className="min-w-0">
          <div className="font-mono text-[14px] font-semibold uppercase tracking-tight text-zinc-100">Подсчёт</div>
          <div className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 tabular-nums">введено {countedNum} из {items.length}</div>
        </div>
      </div>

      {error ? <div className="border border-rose-500/40 bg-rose-500/[0.06] p-3 font-mono text-[12px] text-rose-300">{error}</div> : null}

      {/* Камера: скан штрихкода → подсветит и сфокусирует нужный товар */}
      {!itemsLoading && items.length > 0 ? (
        <div className="border border-[#23262b] bg-[#0e0f10]">
          {scanning ? (
            <div className="relative aspect-[5/3] w-full overflow-hidden bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-20 w-3/4 border-2 border-amber-400/80" /></div>
              <div className="absolute right-2 top-2 flex gap-2">
                <button type="button" onClick={() => void toggleTorch()} className={`border p-2 ${torchOn ? 'border-amber-400 text-amber-300' : 'border-white/20 text-white'}`} aria-label="Фонарик"><Flashlight className="h-4 w-4" /></button>
                <button type="button" onClick={() => setScanning(false)} className="border border-white/20 px-2 py-2 font-mono text-xs text-white">Стоп</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setScanning(true)} className="flex w-full items-center justify-center gap-2 py-3 font-mono text-[12px] uppercase tracking-wide text-amber-300"><Camera className="h-4 w-4" /> Сканировать камерой</button>
          )}
        </div>
      ) : null}

      {itemsLoading ? (
        <div className="flex items-center gap-3 border border-[#23262b] bg-[#0e0f10] p-4 font-mono text-[13px] uppercase text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка товаров…</div>
      ) : items.length === 0 ? (
        <OperatorEmptyState title="В вашей секции нет товаров" description="По назначенной секции нет позиций для подсчёта." />
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.item_id} className="flex items-center justify-between gap-3 border border-[#23262b] bg-[#0b0c0d] p-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-[13px] text-zinc-100">{it.name}</div>
                {it.barcode ? <div className="font-mono text-[10px] text-zinc-600 tabular-nums">{it.barcode}</div> : null}
              </div>
              <input
                id={`audit-input-${it.item_id}`}
                value={edits[it.item_id] ?? ''}
                onChange={(e) => setEdits((p) => ({ ...p, [it.item_id]: e.target.value }))}
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
            {saved ? 'Сохранено ✓' : 'Сохранить подсчёт'}
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
