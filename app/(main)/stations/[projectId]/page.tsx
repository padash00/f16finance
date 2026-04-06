'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Monitor, Clock, Banknote,
  BarChart3, Settings, Loader2, CheckCircle2, ChevronDown, ChevronRight,
  AlertTriangle, RefreshCw, TrendingUp, Calendar, Map, Search, Download,
} from 'lucide-react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatTariffWindowLabel, parseTimeToMinutes } from '@/lib/core/arena-tariff-window'

// ─── Types ───────────────────────────────────────────────────────────────────

type Zone = {
  id: string
  name: string
  is_active: boolean
  /** ₸/час для продления по сумме на станциях зоны */
  extension_hourly_price: number | null
  grid_x: number | null; grid_y: number | null; grid_w: number | null; grid_h: number | null; color: string | null
}
type Station = {
  id: string; zone_id: string | null; name: string; order_index: number; is_active: boolean
  grid_x: number | null; grid_y: number | null
}
type Tariff = {
  id: string
  zone_id: string
  name: string
  duration_minutes: number
  price: number
  is_active: boolean
  tariff_type: 'fixed' | 'time_window'
  window_start_time: string | null
  window_end_time: string | null
}
type Decoration = {
  id: string; type: string; grid_x: number; grid_y: number; grid_w: number; grid_h: number
  label: string | null; rotation: number
}
type Session = {
  id: string; station_id: string; tariff_id: string | null; started_at: string; ends_at: string
  ended_at: string | null; amount: number; status: string
  payment_method: string; cash_amount: number; kaspi_amount: number; discount_percent: number
  station: { name: string; zone_id: string | null } | null
  tariff: { name: string; duration_minutes: number; price: number } | null
}

type CrudDialogState =
  | null
  | { kind: 'station'; zoneId: string; zoneLabel: string }
  | { kind: 'tariff'; zoneId: string; zoneLabel: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(p: number) {
  return p.toLocaleString('ru-RU') + ' ₸'
}

function formatMinutes(m: number) {
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h} ч ${rem} мин` : `${h} ч`
}

/** Строки из POST /api/admin/arena (.select().single()) → типы экрана */
function arenaRowToZone(row: Record<string, unknown>): Zone {
  const extH = row.extension_hourly_price
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    is_active: Boolean(row.is_active),
    extension_hourly_price: (() => {
      if (extH == null || extH === '') return null
      const n = Number(extH)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    grid_x: row.grid_x != null ? Number(row.grid_x) : null,
    grid_y: row.grid_y != null ? Number(row.grid_y) : null,
    grid_w: row.grid_w != null ? Number(row.grid_w) : null,
    grid_h: row.grid_h != null ? Number(row.grid_h) : null,
    color: row.color != null ? String(row.color) : null,
  }
}

function arenaRowToStation(row: Record<string, unknown>): Station {
  return {
    id: String(row.id),
    zone_id: row.zone_id != null ? String(row.zone_id) : null,
    name: String(row.name ?? ''),
    order_index: Number(row.order_index ?? 0),
    is_active: Boolean(row.is_active),
    grid_x: row.grid_x != null ? Number(row.grid_x) : null,
    grid_y: row.grid_y != null ? Number(row.grid_y) : null,
  }
}

function arenaRowToTariff(row: Record<string, unknown>): Tariff {
  const tt = row.tariff_type === 'time_window' ? 'time_window' : 'fixed'
  return {
    id: String(row.id),
    zone_id: String(row.zone_id ?? ''),
    name: String(row.name ?? ''),
    duration_minutes: Number(row.duration_minutes ?? 0),
    price: Number(row.price ?? 0),
    is_active: Boolean(row.is_active ?? true),
    tariff_type: tt,
    window_start_time: row.window_start_time != null ? String(row.window_start_time) : null,
    window_end_time: row.window_end_time != null ? String(row.window_end_time) : null,
  }
}

function sortZonesByName(a: Zone, b: Zone) {
  return a.name.localeCompare(b.name, 'ru')
}

function sortStationsByOrder(a: Station, b: Station) {
  if (a.order_index !== b.order_index) return a.order_index - b.order_index
  return a.name.localeCompare(b.name, 'ru')
}

function sortTariffsByPrice(a: Tariff, b: Tariff) {
  return a.price - b.price
}

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function validateTariffInput(t: {
  name: string
  duration_minutes: string | number
  price: string | number
  tariff_type: string
  window_start_time: string
  window_end_time: string
}): string | null {
  if (!String(t.name).trim()) return 'Введите название тарифа'
  const price = Number(t.price)
  const dur = Number(t.duration_minutes)
  if (!Number.isFinite(price) || price < 0) return 'Укажите корректную цену (≥ 0)'
  if (!Number.isFinite(dur) || dur < 1) return 'Длительность не менее 1 минуты'
  if (t.tariff_type === 'time_window') {
    if (!String(t.window_end_time || '').trim()) return 'Для пакета укажите время окончания окна'
    if (parseTimeToMinutes(String(t.window_end_time).trim()) === null) return 'Окончание окна: формат ЧЧ:ММ (например 16:00)'
    const ws = String(t.window_start_time || '').trim()
    if (!ws) return 'Укажите начало окна (кнопки «День» / «Ночь» или поля времени). Иначе на точке не будет ограничения по часам.'
    if (parseTimeToMinutes(ws) === null) return 'Начало окна: формат ЧЧ:ММ (например 10:00)'
  }
  return null
}

const EMPTY_NEW_TARIFF: {
  name: string
  duration_minutes: string
  price: string
  tariff_type: 'fixed' | 'time_window'
  window_start_time: string
  window_end_time: string
} = {
  name: '',
  duration_minutes: '60',
  price: '',
  tariff_type: 'fixed',
  window_start_time: '',
  window_end_time: '',
}

// ─── Inline edit input ───────────────────────────────────────────────────────

function InlineEdit({ value, onSave, onCancel, placeholder }: { value: string; onSave: (v: string) => void; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = useState(value)
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(v); if (e.key === 'Escape') onCancel() }}
        className="rounded border border-white/20 bg-background px-2 py-1 text-sm w-40"
        placeholder={placeholder}
      />
      <button onClick={() => onSave(v)} className="p-1 text-emerald-400 hover:text-emerald-300"><Save className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

// ─── Map Editor ──────────────────────────────────────────────────────────────

const GRID_W = 24
const GRID_H = 14

const ZONE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#a78bfa',
]

const DECORATION_TYPES = [
  { type: 'sofa', emoji: '🛋', label: 'Диван' },
  { type: 'entrance', emoji: '🚪', label: 'Вход/выход' },
  { type: 'wall', emoji: '🧱', label: 'Стена' },
  { type: 'label', emoji: 'Aa', label: 'Надпись' },
  { type: 'desk', emoji: '🖥', label: 'Стол' },
  { type: 'arrow', emoji: '➡️', label: 'Стрелка' },
  { type: 'tv', emoji: '📺', label: 'Телевизор' },
  { type: 'bar', emoji: '🍺', label: 'Барная стойка' },
  { type: 'column', emoji: '⬤', label: 'Колонна' },
  { type: 'window', emoji: '🪟', label: 'Окно' },
  { type: 'stairs', emoji: '🪜', label: 'Лестница' },
]

function decoEmoji(type: string) {
  return DECORATION_TYPES.find(d => d.type === type)?.emoji ?? '❓'
}

interface MapEditorProps {
  projectId: string
  companyId: string | null
  zones: Zone[]
  stations: Station[]
  decorations: Decoration[]
  cellSize: number
  onSaved: (zones: Zone[], stations: Station[], decorations: Decoration[]) => void
  showFlash: (type: 'ok' | 'err', msg: string) => void
}

function MapEditor({ projectId, companyId, zones, stations, decorations, cellSize: CELL, onSaved, showFlash }: MapEditorProps) {
  // Local mutable state for positions
  const [localZones, setLocalZones] = useState<Zone[]>(zones)
  const [localStations, setLocalStations] = useState<Station[]>(stations)
  const [localDecos, setLocalDecos] = useState<Decoration[]>(decorations)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  // Refs to always hold latest state for async save (avoids stale closure in setTimeout)
  const latestStationsRef = useRef(localStations)
  const latestZonesRef = useRef(localZones)
  const latestDecosRef = useRef(localDecos)
  useEffect(() => { latestStationsRef.current = localStations }, [localStations])
  useEffect(() => { latestZonesRef.current = localZones }, [localZones])
  useEffect(() => { latestDecosRef.current = localDecos }, [localDecos])

  // Drag state
  const dragRef = useRef<{
    type: 'station' | 'zone' | 'deco'
    id: string
    // offset within element in cells
    ox: number
    oy: number
  } | null>(null)

  // Selected zone for color editing
  const [colorPicker, setColorPicker] = useState<string | null>(null)

  // New decoration modal
  const [addDecoCell, setAddDecoCell] = useState<{ x: number; y: number } | null>(null)
  const [newDecoType, setNewDecoType] = useState('sofa')
  const [newDecoLabel, setNewDecoLabel] = useState('')
  const [newDecoW, setNewDecoW] = useState(1)
  const [newDecoH, setNewDecoH] = useState(1)

  // Sync when parent data changes
  useEffect(() => { setLocalZones(zones) }, [zones])
  useEffect(() => { setLocalStations(stations) }, [stations])
  useEffect(() => { setLocalDecos(decorations) }, [decorations])

  function markDirty() {
    setDirty(true)
  }

  async function saveMapLayout() {
    const stationsSnap = latestStationsRef.current
    const zonesSnap = latestZonesRef.current
    const decosSnap = latestDecosRef.current
    setSaving(true)
    try {
      const res = await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateMapLayout',
          stations: stationsSnap.map(s => ({ id: s.id, grid_x: s.grid_x, grid_y: s.grid_y })),
          zones: zonesSnap.map(z => ({ id: z.id, grid_x: z.grid_x, grid_y: z.grid_y, grid_w: z.grid_w, grid_h: z.grid_h, color: z.color })),
          decorations: decosSnap.map(d => ({ id: d.id, grid_x: d.grid_x, grid_y: d.grid_y })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.ok) throw new Error(data.error || 'Ошибка')
      setDirty(false)
      onSaved(zonesSnap, stationsSnap, decosSnap)
      showFlash('ok', 'Карта сохранена')
    } catch {
      showFlash('err', 'Не удалось сохранить карту')
    } finally {
      setSaving(false)
    }
  }

  function getCellFromEvent(e: React.DragEvent): { x: number; y: number } | null {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL)
    const y = Math.floor((e.clientY - rect.top) / CELL)
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null
    return { x, y }
  }

  function handleDragStart(e: React.DragEvent, type: 'station' | 'zone' | 'deco', id: string, itemX: number, itemY: number) {
    if (!gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const ox = Math.floor((e.clientX - rect.left) / CELL) - itemX
    const oy = Math.floor((e.clientY - rect.top) / CELL) - itemY
    dragRef.current = { type, id, ox, oy }
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const cell = getCellFromEvent(e)
    if (!cell || !dragRef.current) return
    const { type, id, ox, oy } = dragRef.current
    let nx = Math.max(0, cell.x - ox)
    let ny = Math.max(0, cell.y - oy)

    if (type === 'station') {
      nx = Math.min(nx, GRID_W - 1)
      ny = Math.min(ny, GRID_H - 1)
      setLocalStations(prev => prev.map(s => s.id === id ? { ...s, grid_x: nx, grid_y: ny } : s))
      markDirty()
    } else if (type === 'zone') {
      const zone = localZones.find(z => z.id === id)
      if (!zone) return
      nx = Math.min(nx, GRID_W - (zone.grid_w ?? 4))
      ny = Math.min(ny, GRID_H - (zone.grid_h ?? 4))
      setLocalZones(prev => prev.map(z => z.id === id ? { ...z, grid_x: nx, grid_y: ny } : z))
      markDirty()
    } else if (type === 'deco') {
      nx = Math.min(nx, GRID_W - 1)
      ny = Math.min(ny, GRID_H - 1)
      setLocalDecos(prev => prev.map(d => d.id === id ? { ...d, grid_x: nx, grid_y: ny } : d))
      markDirty()
    }
    dragRef.current = null
  }

  function handleGridClick(e: React.MouseEvent) {
    if (!gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL)
    const y = Math.floor((e.clientY - rect.top) / CELL)
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return
    setAddDecoCell({ x, y })
    setNewDecoType('sofa')
    setNewDecoLabel('')
    setNewDecoW(1)
    setNewDecoH(1)
  }

  async function handleAddDecoration() {
    if (!addDecoCell) return
    try {
      const res = await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createDecoration',
          projectId,
          companyId,
          type: newDecoType,
          grid_x: addDecoCell.x,
          grid_y: addDecoCell.y,
          grid_w: newDecoW, grid_h: newDecoH,
          label: newDecoLabel || null,
          rotation: 0,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setLocalDecos(prev => [...prev, data.data])
      onSaved(localZones, localStations, [...localDecos, data.data])
      setAddDecoCell(null)
    } catch (e: any) {
      showFlash('err', e.message)
    }
  }

  async function handleDeleteDeco(id: string) {
    try {
      await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteDecoration', decorationId: id }),
      })
      setLocalDecos(prev => prev.filter(d => d.id !== id))
      onSaved(localZones, localStations, localDecos.filter(d => d.id !== id))
    } catch (e: any) {
      showFlash('err', e.message)
    }
  }

  function handleZoneColor(zoneId: string, color: string) {
    setLocalZones(prev => prev.map(z => z.id === zoneId ? { ...z, color } : z))
    setColorPicker(null)
    markDirty()
  }

  async function handleZoneResize(zoneId: string, dw: number, dh: number) {
    setLocalZones(prev => prev.map(z => {
      if (z.id !== zoneId) return z
      const nw = Math.max(2, Math.min(GRID_W - (z.grid_x ?? 0), (z.grid_w ?? 4) + dw))
      const nh = Math.max(2, Math.min(GRID_H - (z.grid_y ?? 0), (z.grid_h ?? 4) + dh))
      return { ...z, grid_w: nw, grid_h: nh }
    }))
    markDirty()
  }

  const stationsOnMap = localStations.filter(s => s.grid_x != null && s.grid_y != null)
  const stationsOff = localStations.filter(s => s.grid_x == null || s.grid_y == null)

  return (
    <div className="flex gap-4">
      {/* Left: grid */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Расставьте зоны, станции и декор, затем нажмите «Сохранить карту». Новый декор и удаление — сразу на сервере.
          </span>
          {dirty && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-400">
              Есть несохранённые изменения
            </span>
          )}
          <button
            type="button"
            onClick={() => void saveMapLayout()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Сохранить карту
          </button>
          {!dirty && !saving && (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Сохранено
            </span>
          )}
        </div>

        {localZones.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">Цвета зон</span>
            {localZones.map(z => (
              <span
                key={z.id}
                className="inline-flex max-w-[140px] items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-foreground"
                title={z.name}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: z.color ?? '#3b82f6' }} />
                <span className="truncate">{z.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Grid */}
        <div
          ref={gridRef}
          className="relative border border-white/10 rounded-lg overflow-hidden bg-zinc-900 cursor-crosshair"
          style={{ width: GRID_W * CELL, height: GRID_H * CELL }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={handleGridClick}
        >
          {/* Grid lines */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={GRID_W * CELL} height={GRID_H * CELL}
            style={{ zIndex: 0 }}
          >
            {Array.from({ length: GRID_W + 1 }, (_, i) => (
              <line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={GRID_H * CELL} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ))}
            {Array.from({ length: GRID_H + 1 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={i * CELL} x2={GRID_W * CELL} y2={i * CELL} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ))}
          </svg>

          {/* Zones */}
          {localZones.filter(z => z.grid_x != null).map(zone => {
            const x = zone.grid_x!
            const y = zone.grid_y!
            const w = zone.grid_w ?? 4
            const h = zone.grid_h ?? 4
            const color = zone.color ?? '#3b82f6'
            return (
              <div
                key={zone.id}
                draggable
                onDragStart={e => {
                  e.stopPropagation()
                  handleDragStart(e, 'zone', zone.id, x, y)
                }}
                onDragOver={e => e.preventDefault()}
                onClick={e => { e.stopPropagation(); setColorPicker(colorPicker === zone.id ? null : zone.id) }}
                className="absolute rounded select-none group"
                style={{
                  left: x * CELL + 1,
                  top: y * CELL + 1,
                  width: w * CELL - 2,
                  height: h * CELL - 2,
                  backgroundColor: color + '22',
                  border: `2px solid ${color}55`,
                  zIndex: 1,
                  cursor: 'grab',
                }}
              >
                <div
                  className="absolute top-0 left-0 right-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-tl rounded-tr truncate"
                  style={{ backgroundColor: color + '40', color: color }}
                >
                  {zone.name}
                </div>
                {/* Resize handle */}
                <div
                  className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 group-hover:opacity-100"
                  style={{ background: color }}
                  onMouseDown={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    const startX = e.clientX
                    const startY = e.clientY
                    const startW = w
                    const startH = h
                    function onMove(me: MouseEvent) {
                      const dw = Math.round((me.clientX - startX) / CELL)
                      const dh = Math.round((me.clientY - startY) / CELL)
                      setLocalZones(prev => prev.map(z => {
                        if (z.id !== zone.id) return z
                        const nw = Math.max(2, Math.min(GRID_W - (z.grid_x ?? 0), startW + dw))
                        const nh = Math.max(2, Math.min(GRID_H - (z.grid_y ?? 0), startH + dh))
                        return { ...z, grid_w: nw, grid_h: nh }
                      }))
                    }
                    function onUp() {
                      markDirty()
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                />
                {/* Color picker popover */}
                {colorPicker === zone.id && (
                  <div
                    className="absolute z-50 top-6 left-0 flex flex-wrap gap-1 rounded-lg border border-white/20 bg-zinc-900 p-2 shadow-xl"
                    style={{ width: 120 }}
                    onClick={e => e.stopPropagation()}
                  >
                    {ZONE_COLORS.map(c => (
                      <button
                        key={c}
                        className="h-5 w-5 rounded-full border-2 hover:scale-110 transition-transform"
                        style={{ backgroundColor: c, borderColor: color === c ? 'white' : 'transparent' }}
                        onClick={() => handleZoneColor(zone.id, c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Decorations */}
          {localDecos.map(deco => (
            <div
              key={deco.id}
              draggable
              onDragStart={e => { e.stopPropagation(); handleDragStart(e, 'deco', deco.id, deco.grid_x, deco.grid_y) }}
              onDragOver={e => e.preventDefault()}
              className="absolute flex items-center justify-center select-none group overflow-hidden"
              style={{
                left: deco.grid_x * CELL,
                top: deco.grid_y * CELL,
                width: deco.grid_w * CELL,
                height: deco.grid_h * CELL,
                zIndex: 2,
                cursor: 'grab',
                transform: deco.rotation ? `rotate(${deco.rotation}deg)` : undefined,
                ...(deco.type === 'wall' ? { background: 'repeating-linear-gradient(45deg, #4b5563, #4b5563 5px, #374151 5px, #374151 10px)', opacity: 0.85 } : {}),
              }}
              onClick={e => e.stopPropagation()}
            >
              {deco.type === 'label'
                ? <span className="text-[9px] text-white/60 text-center px-1 leading-tight break-words">{deco.label || 'Text'}</span>
                : deco.type !== 'wall'
                  ? <span className="text-xl" title={deco.label ?? deco.type}>{decoEmoji(deco.type)}</span>
                  : null
              }
              <button
                className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] text-white"
                onClick={e => { e.stopPropagation(); void handleDeleteDeco(deco.id) }}
              >×</button>
            </div>
          ))}

          {/* Stations on map */}
          {stationsOnMap.map(station => {
            const x = station.grid_x!
            const y = station.grid_y!
            return (
              <div
                key={station.id}
                draggable
                onDragStart={e => { e.stopPropagation(); handleDragStart(e, 'station', station.id, x, y) }}
                onDragOver={e => e.preventDefault()}
                className="absolute flex flex-col items-center justify-center rounded border text-center select-none"
                style={{
                  left: x * CELL + 2,
                  top: y * CELL + 2,
                  width: CELL - 4,
                  height: CELL - 4,
                  zIndex: 3,
                  cursor: 'grab',
                  backgroundColor: 'rgba(99,102,241,0.2)',
                  borderColor: 'rgba(99,102,241,0.6)',
                  fontSize: 11,
                }}
                title={station.name}
              >
                <Monitor style={{ width: 18, height: 18, opacity: 0.8 }} />
                <span className="truncate leading-tight mt-1 font-semibold" style={{ maxWidth: CELL - 8, fontSize: 11 }}>
                  {station.name}
                </span>
              </div>
            )
          })}
        </div>

        {/* Add decoration modal */}
        {addDecoCell && (
          <div
            className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-900 p-3"
            style={{ width: GRID_W * CELL }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Добавить декор ({addDecoCell.x}, {addDecoCell.y})</span>
              <button onClick={() => setAddDecoCell(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap gap-2">
              {DECORATION_TYPES.map(d => (
                <button
                  key={d.type}
                  onClick={() => setNewDecoType(d.type)}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-xs transition ${newDecoType === d.type ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
                >
                  <span className="text-base">{d.emoji}</span>
                  <span className="text-muted-foreground">{d.label}</span>
                </button>
              ))}
            </div>
            {newDecoType === 'label' && (
              <input
                value={newDecoLabel}
                onChange={e => setNewDecoLabel(e.target.value)}
                placeholder="Текст надписи"
                className="rounded border border-white/20 bg-background px-2 py-1 text-sm"
              />
            )}
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-muted-foreground">
                Ширина
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newDecoW}
                  onChange={e => setNewDecoW(Math.max(1, Math.min(10, Number(e.target.value))))}
                  className="w-12 rounded border border-white/20 bg-background px-1.5 py-1 text-sm text-foreground"
                />
              </label>
              <label className="flex items-center gap-1.5 text-muted-foreground">
                Высота
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newDecoH}
                  onChange={e => setNewDecoH(Math.max(1, Math.min(10, Number(e.target.value))))}
                  className="w-12 rounded border border-white/20 bg-background px-1.5 py-1 text-sm text-foreground"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleAddDecoration()}
                className="flex-1 rounded-lg bg-primary py-1.5 text-sm font-medium text-primary-foreground"
              >
                Добавить
              </button>
              <button onClick={() => setAddDecoCell(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted-foreground">
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: sidebar - zones on/off map, unplaced stations */}
      <div className="flex w-48 flex-col gap-4">
        {/* Zones placement */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Зоны</p>
          <div className="space-y-1.5">
            {localZones.map(zone => {
              const onMap = zone.grid_x != null
              const color = zone.color ?? '#3b82f6'
              return (
                <div key={zone.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="truncate">{zone.name}</span>
                  </span>
                  <button
                    onClick={() => {
                      if (onMap) {
                        setLocalZones(prev => prev.map(z => z.id === zone.id ? { ...z, grid_x: null, grid_y: null } : z))
                      } else {
                        setLocalZones(prev => prev.map(z => z.id === zone.id ? { ...z, grid_x: 0, grid_y: 0 } : z))
                      }
                      markDirty()
                    }}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${onMap ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'}`}
                  >
                    {onMap ? 'Убрать' : 'На карту'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Unplaced stations */}
        {stationsOff.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Станции вне карты</p>
            <p className="mb-2 text-[10px] text-muted-foreground">Перетащите на карту или нажмите кнопку</p>
            <div className="space-y-1">
              {stationsOff.map(st => (
                <div
                  key={st.id}
                  draggable
                  onDragStart={e => handleDragStart(e, 'station', st.id, 0, 0)}
                  className="flex cursor-grab items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
                >
                  <span className="flex items-center gap-1 truncate">
                    <Monitor className="h-3 w-3 shrink-0 text-indigo-400" />
                    <span className="truncate">{st.name}</span>
                  </span>
                  <button
                    onClick={() => {
                      // Find first free cell
                      const used = new Set(localStations.filter(s => s.grid_x != null).map(s => `${s.grid_x},${s.grid_y}`))
                      let placed = false
                      for (let y = 0; y < GRID_H && !placed; y++) {
                        for (let x = 0; x < GRID_W && !placed; x++) {
                          if (!used.has(`${x},${y}`)) {
                            setLocalStations(prev => prev.map(s => s.id === st.id ? { ...s, grid_x: x, grid_y: y } : s))
                            used.add(`${x},${y}`)
                            placed = true
                          }
                        }
                      }
                      markDirty()
                    }}
                    className="shrink-0 rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-500/30"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Placed stations */}
        {stationsOnMap.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">На карте</p>
            <div className="space-y-1">
              {stationsOnMap.map(st => (
                <div key={st.id} className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1 text-xs">
                  <span className="flex items-center gap-1 truncate">
                    <Monitor className="h-3 w-3 shrink-0 text-indigo-400" />
                    <span className="truncate">{st.name}</span>
                  </span>
                  <button
                    onClick={() => {
                      setLocalStations(prev => prev.map(s => s.id === st.id ? { ...s, grid_x: null, grid_y: null } : s))
                      markDirty()
                    }}
                    className="shrink-0 rounded bg-destructive/20 px-1 py-0.5 text-[10px] text-destructive hover:bg-destructive/30"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StationsPage() {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const projectId = params.projectId as string
  const companyId = searchParams.get('company') || null

  const [projectName, setProjectName] = useState('')
  const [allProjects, setAllProjects] = useState<{ id: string; name: string; companies: { id: string; name: string }[] }[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [decorations, setDecorations] = useState<Decoration[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'manage' | 'map' | 'analytics'>(() => {
    if (typeof window === 'undefined') return 'manage'
    const t = new URLSearchParams(window.location.search).get('tab')
    return t === 'map' || t === 'analytics' ? t : 'manage'
  })

  const cellSize = 70
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Analytics
  const [sessions, setSessions] = useState<Session[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsFrom, setAnalyticsFrom] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = new URLSearchParams(window.location.search).get('afrom')
      if (v && isISODate(v)) return v
    }
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [analyticsTo, setAnalyticsTo] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = new URLSearchParams(window.location.search).get('ato')
      if (v && isISODate(v)) return v
    }
    return new Date().toISOString().slice(0, 10)
  })

  // Add zone form
  const [addingZone, setAddingZone] = useState(false)
  const [newZoneName, setNewZoneName] = useState('')
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [zoneEditName, setZoneEditName] = useState('')
  const [zoneEditHourly, setZoneEditHourly] = useState('')

  const [crudDialog, setCrudDialog] = useState<CrudDialogState>(null)
  const [newStationName, setNewStationName] = useState('')
  const [editingStationId, setEditingStationId] = useState<string | null>(null)

  const [newTariff, setNewTariff] = useState(() => ({ ...EMPTY_NEW_TARIFF }))
  const [editingTariff, setEditingTariff] = useState<Tariff | null>(null)

  const [manageQuery, setManageQuery] = useState('')
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({})

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const showFlash = useCallback((type: 'ok' | 'err', msg: string) => {
    setFlash({ type, msg })
    setTimeout(() => setFlash(null), 3000)
  }, [])

  /** silent: обновить данные без полноэкранного лоадера (после CRUD и т.п.) */
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (silent) {
      setSyncing(true)
    } else {
      setLoading(true)
      setError(null)
    }
    try {
      const url = companyId
        ? `/api/admin/arena?projectId=${projectId}&companyId=${companyId}`
        : `/api/admin/arena?projectId=${projectId}`
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setProjectName(data.data.project?.name || '')
      setZones(
        Array.isArray(data.data.zones)
          ? (data.data.zones as Record<string, unknown>[]).map(arenaRowToZone)
          : [],
      )
      setStations(data.data.stations)
      setTariffs(
        Array.isArray(data.data.tariffs)
          ? (data.data.tariffs as Record<string, unknown>[]).map(arenaRowToTariff)
          : [],
      )
      setDecorations(data.data.decorations || [])
    } catch (e: any) {
      const msg = e?.message || 'Ошибка загрузки'
      if (silent) {
        showFlash('err', msg)
      } else {
        setError(msg)
      }
    } finally {
      if (silent) {
        setSyncing(false)
      } else {
        setLoading(false)
      }
    }
  }, [projectId, companyId, showFlash])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'map' || t === 'analytics' || t === 'manage') setActiveTab(t)
    const af = searchParams.get('afrom')
    const at = searchParams.get('ato')
    if (af && isISODate(af)) setAnalyticsFrom(af)
    if (at && isISODate(at)) setAnalyticsTo(at)
  }, [projectId, searchParams])

  useEffect(() => {
    const id = setTimeout(() => {
      const curTab = searchParams.get('tab') || 'manage'
      const curAf = searchParams.get('afrom') || ''
      const curAt = searchParams.get('ato') || ''
      if (
        curTab === activeTab &&
        curAf === analyticsFrom &&
        curAt === analyticsTo &&
        (searchParams.get('company') || '') === (companyId || '')
      ) {
        return
      }
      const p = new URLSearchParams(searchParams.toString())
      p.set('tab', activeTab)
      p.set('afrom', analyticsFrom)
      p.set('ato', analyticsTo)
      if (companyId) p.set('company', companyId)
      else p.delete('company')
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    }, 200)
    return () => clearTimeout(id)
  }, [activeTab, analyticsFrom, analyticsTo, companyId, pathname, router, searchParams])

  // Load all projects with companies for the selector (once)
  useEffect(() => {
    fetch('/api/admin/arena')
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const projects = d.data.projects || []
        setAllProjects(projects)
        // Auto-select first company if none selected yet
        if (!companyId) {
          const current = projects.find((p: any) => p.id === projectId)
          if (current?.companies?.length > 0) {
            router.replace(`/stations/${projectId}?company=${current.companies[0].id}`)
          }
        }
      })
      .catch(() => null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])


  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAnalytics', projectId, companyId, from: analyticsFrom, to: analyticsTo + 'T23:59:59' }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setSessions(data.data.sessions)
    } catch (e: any) {
      showFlash('err', e.message)
    } finally {
      setAnalyticsLoading(false)
    }
  }, [projectId, companyId, analyticsFrom, analyticsTo])

  useEffect(() => {
    if (activeTab === 'analytics') void loadAnalytics()
  }, [activeTab, loadAnalytics])

  const filteredZones = useMemo(() => {
    const q = manageQuery.trim().toLowerCase()
    if (!q) return zones
    return zones.filter(z => {
      if (z.name.toLowerCase().includes(q)) return true
      const sts = stations.filter(s => s.zone_id === z.id)
      const trs = tariffs.filter(t => t.zone_id === z.id)
      return (
        sts.some(s => s.name.toLowerCase().includes(q)) ||
        trs.some(t => t.name.toLowerCase().includes(q))
      )
    })
  }, [zones, stations, tariffs, manageQuery])

  const exportAnalyticsCsv = useCallback(() => {
    if (sessions.length === 0) {
      showFlash('err', 'Нет данных для экспорта за период')
      return
    }
    const headers = ['Начало', 'Окончание', 'Статус', 'Станция', 'Тариф', 'Сумма', 'Наличные', 'Kaspi', 'Способ оплаты']
    const rows: string[][] = [headers]
    for (const s of sessions) {
      rows.push([
        s.started_at,
        s.ends_at,
        s.status,
        s.station?.name ?? '',
        s.tariff?.name ?? '',
        String(s.amount),
        String(s.cash_amount ?? ''),
        String(s.kaspi_amount ?? ''),
        s.payment_method,
      ])
    }
    const escape = (c: string) => `"${String(c).replace(/"/g, '""')}"`
    const bom = '\uFEFF'
    const csv = bom + rows.map(r => r.map(escape).join(';')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arena_sessions_${analyticsFrom}_${analyticsTo}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showFlash('ok', 'Файл CSV сохранён')
  }, [sessions, analyticsFrom, analyticsTo, showFlash])

  async function apiPost(body: object): Promise<{ ok: true; data?: unknown }> {
    const res = await fetch('/api/admin/arena', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Ошибка')
    return data
  }

  // ─── Zone CRUD ───────────────────────────────────────────────────────────
  async function handleCreateZone() {
    if (!newZoneName.trim()) return
    setSaving(true)
    try {
      const out = await apiPost({ action: 'createZone', projectId, companyId, name: newZoneName })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных зоны')
      const z = arenaRowToZone(out.data as Record<string, unknown>)
      setZones(prev => [...prev, z].sort(sortZonesByName))
      setNewZoneName(''); setAddingZone(false)
      showFlash('ok', 'Зона создана')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleSaveZoneEdit(zoneId: string) {
    const name = zoneEditName.trim()
    if (!name) {
      showFlash('err', 'Введите название зоны')
      return
    }
    const h = zoneEditHourly.trim()
    let extension_hourly_price: number | null = null
    if (h !== '') {
      const n = Number(h)
      if (!Number.isFinite(n) || n <= 0) {
        showFlash('err', 'Час продления: положительное число или оставьте пустым')
        return
      }
      extension_hourly_price = n
    }
    setSaving(true)
    try {
      const out = await apiPost({ action: 'updateZone', zoneId, name, extension_hourly_price })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных зоны')
      const z = arenaRowToZone(out.data as Record<string, unknown>)
      setZones(prev => prev.map(x => x.id === zoneId ? z : x))
      setEditingZoneId(null)
      showFlash('ok', 'Зона обновлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteZone(zoneId: string) {
    const z = zones.find(x => x.id === zoneId)
    const nSt = stations.filter(s => s.zone_id === zoneId).length
    const nTr = tariffs.filter(t => t.zone_id === zoneId).length
    const label = z?.name ?? 'зону'
    if (!confirm(`Удалить зону «${label}»?\nВместе с ней будут удалены ${nSt} станций и ${nTr} тарифов.`)) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteZone', zoneId })
      // На сервере каскад/связанные строки — один запрос надёжнее локального guess
      await load({ silent: true })
      showFlash('ok', 'Зона удалена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Station CRUD ────────────────────────────────────────────────────────
  async function handleCreateStation(zoneId: string) {
    if (!newStationName.trim()) return
    setSaving(true)
    try {
      const out = await apiPost({ action: 'createStation', projectId, companyId, zoneId, name: newStationName })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных станции')
      const s = arenaRowToStation(out.data as Record<string, unknown>)
      setStations(prev => [...prev, s].sort(sortStationsByOrder))
      setNewStationName('')
      setCrudDialog(null)
      showFlash('ok', 'Станция добавлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateStation(stationId: string, name: string) {
    setSaving(true)
    try {
      const out = await apiPost({ action: 'updateStation', stationId, name })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных станции')
      const s = arenaRowToStation(out.data as Record<string, unknown>)
      setStations(prev => prev.map(x => x.id === stationId ? s : x))
      setEditingStationId(null)
      showFlash('ok', 'Станция обновлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteStation(stationId: string) {
    const st = stations.find(s => s.id === stationId)
    const label = st?.name ?? 'станцию'
    if (!confirm(`Удалить станцию «${label}»?`)) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteStation', stationId })
      setStations(prev => prev.filter(s => s.id !== stationId))
      showFlash('ok', 'Станция удалена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Tariff CRUD ─────────────────────────────────────────────────────────
  async function handleCreateTariff(zoneId: string) {
    const err = validateTariffInput(newTariff)
    if (err) {
      showFlash('err', err)
      return
    }
    setSaving(true)
    try {
      const out = await apiPost({
        action: 'createTariff',
        projectId,
        companyId,
        zoneId,
        name: newTariff.name,
        duration_minutes: Number(newTariff.duration_minutes),
        price: Number(newTariff.price),
        tariff_type: newTariff.tariff_type || 'fixed',
        window_start_time: newTariff.tariff_type === 'time_window' ? (newTariff.window_start_time || null) : null,
        window_end_time: newTariff.tariff_type === 'time_window' ? (newTariff.window_end_time || null) : null,
      })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных тарифа')
      const t = arenaRowToTariff(out.data as Record<string, unknown>)
      setTariffs(prev => [...prev, t].sort(sortTariffsByPrice))
      setNewTariff({ ...EMPTY_NEW_TARIFF })
      setCrudDialog(null)
      showFlash('ok', 'Тариф добавлен')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateTariff() {
    if (!editingTariff) return
    const err = validateTariffInput({
      name: editingTariff.name,
      duration_minutes: editingTariff.duration_minutes,
      price: editingTariff.price,
      tariff_type: editingTariff.tariff_type,
      window_start_time: editingTariff.window_start_time || '',
      window_end_time: editingTariff.window_end_time || '',
    })
    if (err) {
      showFlash('err', err)
      return
    }
    const tariffId = editingTariff.id
    setSaving(true)
    try {
      const out = await apiPost({
        action: 'updateTariff',
        tariffId,
        name: editingTariff.name,
        duration_minutes: editingTariff.duration_minutes,
        price: editingTariff.price,
        tariff_type: editingTariff.tariff_type || 'fixed',
        window_start_time: editingTariff.tariff_type === 'time_window' ? (editingTariff.window_start_time || null) : null,
        window_end_time: editingTariff.tariff_type === 'time_window' ? (editingTariff.window_end_time || null) : null,
      })
      if (!out.data || typeof out.data !== 'object') throw new Error('Нет данных тарифа')
      const t = arenaRowToTariff(out.data as Record<string, unknown>)
      setTariffs(prev => prev.map(x => x.id === tariffId ? t : x))
      setEditingTariff(null)
      showFlash('ok', 'Тариф обновлён')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteTariff(tariffId: string) {
    const tr = tariffs.find(t => t.id === tariffId)
    const label = tr?.name ?? 'тариф'
    if (!confirm(`Удалить тариф «${label}»?`)) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteTariff', tariffId })
      setTariffs(prev => prev.filter(t => t.id !== tariffId))
      showFlash('ok', 'Тариф удалён')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Analytics calculations ───────────────────────────────────────────────
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const totalRevenue = completedSessions.reduce((s, x) => s + Number(x.amount), 0)
  const totalSessions = completedSessions.length
  const totalCash = completedSessions.reduce((s, x) => s + Number(x.cash_amount || 0), 0)
  const totalKaspi = completedSessions.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0)
  const totalDiscount = completedSessions.reduce((s, x) => {
    const orig = x.tariff ? x.tariff.price : 0
    const disc = Number(x.discount_percent || 0)
    return s + (orig * disc / 100)
  }, 0)

  // By station with occupancy
  const totalMinutes = completedSessions.reduce((s, x) => {
    const tariff = x.tariff
    return s + (tariff ? tariff.duration_minutes : 0)
  }, 0)

  const byStation = stations.map(st => {
    const stSessions = completedSessions.filter(s => s.station_id === st.id)
    const stMinutes = stSessions.reduce((s, x) => s + (x.tariff?.duration_minutes || 0), 0)
    // period in minutes
    const from = new Date(analyticsFrom)
    const to = new Date(analyticsTo)
    const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
    const periodMinutes = periodDays * 24 * 60
    const occupancy = Math.min(100, Math.round((stMinutes / periodMinutes) * 100))
    return {
      station: st,
      count: stSessions.length,
      revenue: stSessions.reduce((s, x) => s + Number(x.amount), 0),
      occupancy,
    }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  // By zone
  const byZone = zones.map(z => {
    const zStations = stations.filter(s => s.zone_id === z.id)
    const zSessions = completedSessions.filter(s => zStations.some(st => st.id === s.station_id))
    return {
      zone: z,
      count: zSessions.length,
      revenue: zSessions.reduce((s, x) => s + Number(x.amount), 0),
      cash: zSessions.reduce((s, x) => s + Number(x.cash_amount || 0), 0),
      kaspi: zSessions.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0),
    }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  // By tariff
  const byTariff = tariffs.map(t => {
    const tSessions = completedSessions.filter(s => s.tariff_id === t.id)
    return { tariff: t, count: tSessions.length, revenue: tSessions.reduce((s, x) => s + Number(x.amount), 0) }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  // By payment method
  const paymentBreakdown = {
    cash: completedSessions.filter(s => s.payment_method === 'cash').reduce((s, x) => s + Number(x.amount), 0),
    kaspi: completedSessions.filter(s => s.payment_method === 'kaspi').reduce((s, x) => s + Number(x.amount), 0),
    mixed: completedSessions.filter(s => s.payment_method === 'mixed').reduce((s, x) => s + Number(x.amount), 0),
  }

  // Daily revenue (last N days)
  const dailyMap: Record<string, { revenue: number; count: number }> = {}
  completedSessions.forEach(s => {
    const day = s.started_at.slice(0, 10)
    const prev = dailyMap[day] || { revenue: 0, count: 0 }
    dailyMap[day] = { revenue: prev.revenue + Number(s.amount), count: prev.count + 1 }
  })
  const dailyData = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, ...d }))
  const maxDailyRevenue = Math.max(...dailyData.map(d => d.revenue), 1)

  // Hour buckets
  const hourBuckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0, revenue: 0 }))
  completedSessions.forEach(s => {
    const h = new Date(s.started_at).getHours()
    hourBuckets[h].count++
    hourBuckets[h].revenue += Number(s.amount)
  })
  const maxHourCount = Math.max(...hourBuckets.map(b => b.count), 1)

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
    </div>
  )

  if (error) return (
    <div className="p-6">
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">{error}</div>
    </div>
  )

  return (
    <div className={activeTab === 'map' ? 'app-page app-page-wide space-y-4' : 'app-page max-w-5xl space-y-6'}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/point-devices" className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <button
          type="button"
          title="Обновить данные с сервера"
          onClick={() => void load({ silent: true })}
          disabled={syncing || loading}
          className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:text-foreground transition disabled:opacity-40"
        >
          <RefreshCw className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-2.5">
          <Monitor className="h-6 w-6 text-cyan-300" />
        </div>
        {/* Точка selector — shows individual companies within arena-enabled projects */}
        {(() => {
          // Flat list of (projectId, projectName, companyId, companyName)
          const options: { pId: string; pName: string; cId: string; cName: string }[] = []
          for (const p of allProjects) {
            if (p.companies.length > 0) {
              for (const c of p.companies) {
                options.push({ pId: p.id, pName: p.name, cId: c.id, cName: c.name })
              }
            } else {
              options.push({ pId: p.id, pName: p.name, cId: '', cName: p.name })
            }
          }
          const currentValue = companyId ? `${projectId}|${companyId}` : (options.find(o => o.pId === projectId)?.cId ? `${projectId}|${options.find(o => o.pId === projectId)!.cId}` : projectId)
          const currentLabel = options.find(o => o.pId === projectId && (companyId ? o.cId === companyId : true))?.cName || projectName || '...'
          const showProject = allProjects.length > 1
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Точка</span>
              <div className="relative">
                {options.length === 0 ? (
                  <span className="rounded-xl border border-white/10 bg-card px-4 py-2 text-lg font-bold text-foreground">{currentLabel}</span>
                ) : (
                  <select
                    value={currentValue}
                    onChange={e => {
                      const [pId, cId] = e.target.value.split('|')
                      const p = new URLSearchParams()
                      p.set('tab', activeTab)
                      p.set('afrom', analyticsFrom)
                      p.set('ato', analyticsTo)
                      if (cId) p.set('company', cId)
                      router.push(`/stations/${pId}?${p.toString()}`)
                    }}
                    className="appearance-none rounded-xl border border-white/10 bg-card px-4 py-2 pr-8 text-lg font-bold text-foreground focus:outline-none focus:border-primary cursor-pointer"
                  >
                    {options.map(o => (
                      <option key={`${o.pId}|${o.cId}`} value={o.cId ? `${o.pId}|${o.cId}` : o.pId}>
                        {showProject ? `${o.pName} / ${o.cName}` : o.cName}
                      </option>
                    ))}
                  </select>
                )}
                {options.length > 0 && <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
              </div>
            </div>
          )
        })()}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Станций</span>
          <span className="text-lg font-bold">{stations.length}</span>
        </div>
        {syncing && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Синхронизация…
          </span>
        )}
      </div>

      {/* Flash */}
      {flash && (
        <div className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg ${flash.type === 'ok' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400' : 'bg-destructive/20 border border-destructive/30 text-destructive'}`}>
          {flash.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {flash.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-white/10">
        {[
          { id: 'manage', label: 'Управление', icon: Settings },
          { id: 'map', label: 'Карта', icon: Map },
          { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {activeTab === 'manage' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Зоны и станции</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Поиск, сворачивание зон, станции и тарифы — в окнах.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {zones.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCollapsedZones({})}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    >
                      Развернуть все
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollapsedZones(Object.fromEntries(zones.map(z => [z.id, true])))}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    >
                      Свернуть все
                    </button>
                  </>
                )}
                {!addingZone && (
                  <button
                    type="button"
                    onClick={() => setAddingZone(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                  >
                    <Plus className="h-4 w-4" /> Добавить зону
                  </button>
                )}
              </div>
            </div>

            {zones.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={manageQuery}
                  onChange={e => setManageQuery(e.target.value)}
                  placeholder="Поиск по названию зоны, станции или тарифа…"
                  className="w-full rounded-xl border border-white/10 bg-card py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary/50"
                  aria-label="Поиск по зонам и станциям"
                />
              </div>
            )}

            {addingZone && (
              <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <input
                  autoFocus
                  value={newZoneName}
                  onChange={e => setNewZoneName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateZone(); if (e.key === 'Escape') { setAddingZone(false); setNewZoneName('') } }}
                  placeholder="Название зоны (напр. PlayStation, ПК, VIP)"
                  className="flex-1 rounded-lg border border-white/10 bg-background px-3 py-1.5 text-sm"
                />
                <button type="button" onClick={handleCreateZone} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Создать
                </button>
                <button type="button" onClick={() => { setAddingZone(false); setNewZoneName('') }} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            )}

            {zones.length === 0 && !addingZone && (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-muted-foreground">
                <Monitor className="mx-auto h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">Зон пока нет. Создайте первую зону, чтобы добавить станции и тарифы.</p>
              </div>
            )}

            {zones.length > 0 && filteredZones.length === 0 && (
              <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-muted-foreground">
                Ничего не найдено — измените запрос или сбросьте поиск.
              </p>
            )}

            {filteredZones.map(zone => {
              const zoneStations = stations.filter(s => s.zone_id === zone.id)
              const zoneTariffs = tariffs.filter(t => t.zone_id === zone.id)
              const collapsed = Boolean(collapsedZones[zone.id])
              const zColor = zone.color ?? '#3b82f6'
              return (
                <div key={zone.id} className="rounded-xl border border-white/10 bg-card overflow-hidden">
                  <div className="flex items-center gap-1 border-b border-white/10 bg-white/5 px-2 py-2 sm:px-3">
                    <button
                      type="button"
                      onClick={() => setCollapsedZones(p => ({ ...p, [zone.id]: !p[zone.id] }))}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                      title={collapsed ? 'Развернуть зону' : 'Свернуть зону'}
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: zColor }} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                      {editingZoneId === zone.id ? (
                        <div className="flex min-w-0 w-full flex-col gap-2">
                          <input
                            value={zoneEditName}
                            onChange={e => setZoneEditName(e.target.value)}
                            className="w-full rounded border border-white/20 bg-background px-2 py-1 text-sm"
                            placeholder="Название зоны"
                          />
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="min-w-[140px] flex-1 text-[10px] text-muted-foreground">
                              <span className="mb-0.5 block">Час продления по сумме, ₸</span>
                              <input
                                value={zoneEditHourly}
                                onChange={e => setZoneEditHourly(e.target.value)}
                                type="number"
                                min={0}
                                step="1"
                                placeholder="напр. 1200"
                                className="w-full rounded border border-white/20 bg-background px-2 py-1 text-xs"
                              />
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => void handleSaveZoneEdit(zone.id)}
                                disabled={saving}
                                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                              >
                                Сохранить
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingZoneId(null)}
                                className="rounded bg-white/10 px-2 py-1 text-xs"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                          <p className="text-[10px] text-muted-foreground/90 leading-snug">
                            Если оставить пустым — для продления по сумме подставится минимальная цена среди фикс. тарифов зоны ровно на 60 мин (например «Час»).
                          </p>
                        </div>
                      ) : (
                        <>
                          <span className="truncate font-semibold text-sm">{zone.name}</span>
                          <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">{zoneStations.length} ст.</span>
                          <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">{zoneTariffs.length} тар.</span>
                          {zone.extension_hourly_price != null && zone.extension_hourly_price > 0 && (
                            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                              час {formatPrice(zone.extension_hourly_price)}
                            </span>
                          )}
                          {!zone.is_active && <span className="shrink-0 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">неактивна</span>}
                        </>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 self-start sm:self-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (editingZoneId === zone.id) {
                            setEditingZoneId(null)
                          } else {
                            setEditingZoneId(zone.id)
                            setZoneEditName(zone.name)
                            setZoneEditHourly(
                              zone.extension_hourly_price != null && zone.extension_hourly_price > 0
                                ? String(zone.extension_hourly_price)
                                : '',
                            )
                          }
                        }}
                        className="rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => handleDeleteZone(zone.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  {!collapsed && (
                    <div className="grid md:grid-cols-2 divide-y divide-white/10 md:divide-x md:divide-y-0">
                      <div className="p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Monitor className="h-3.5 w-3.5" /> Станции</span>
                          <button
                            type="button"
                            onClick={() => {
                              setNewStationName('')
                              setCrudDialog({ kind: 'station', zoneId: zone.id, zoneLabel: zone.name })
                            }}
                            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
                          >
                            <Plus className="h-3 w-3" /> Добавить
                          </button>
                        </div>
                        <div className="space-y-1">
                          {zoneStations.length === 0 && <p className="py-2 text-xs text-muted-foreground">Нет станций</p>}
                          {zoneStations.map(st => (
                            <div key={st.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                              {editingStationId === st.id ? (
                                <InlineEdit value={st.name} onSave={v => handleUpdateStation(st.id, v)} onCancel={() => setEditingStationId(null)} />
                              ) : (
                                <>
                                  <span className="text-sm">{st.name}</span>
                                  <div className="hidden items-center gap-1 group-hover:flex">
                                    <button type="button" onClick={() => setEditingStationId(st.id)} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                                    <button type="button" onClick={() => handleDeleteStation(st.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Тарифы</span>
                          <button
                            type="button"
                            onClick={() => {
                              setNewTariff({ ...EMPTY_NEW_TARIFF })
                              setCrudDialog({ kind: 'tariff', zoneId: zone.id, zoneLabel: zone.name })
                            }}
                            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
                          >
                            <Plus className="h-3 w-3" /> Добавить
                          </button>
                        </div>
                        <div className="space-y-1">
                          {zoneTariffs.length === 0 && <p className="py-2 text-xs text-muted-foreground">Нет тарифов</p>}
                          {zoneTariffs.map(t => (
                            <div key={t.id} className="group">
                              {editingTariff?.id === t.id ? (
                                <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2">
                                  <input value={editingTariff.name} onChange={e => setEditingTariff(p => p ? ({ ...p, name: e.target.value }) : p)} className="w-full rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                  <div className="grid grid-cols-2 gap-1">
                                    <input value={editingTariff.duration_minutes} onChange={e => setEditingTariff(p => p ? ({ ...p, duration_minutes: Number(e.target.value) }) : p)} type="number" min={1} className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                    <input value={editingTariff.price} onChange={e => setEditingTariff(p => p ? ({ ...p, price: Number(e.target.value) }) : p)} type="number" min={0} step="1" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                  </div>
                                  <div className="grid grid-cols-2 gap-1">
                                    <select
                                      value={editingTariff.tariff_type || 'fixed'}
                                      onChange={e => {
                                        const v = e.target.value as 'fixed' | 'time_window'
                                        setEditingTariff(p => p
                                          ? {
                                              ...p,
                                              tariff_type: v,
                                              ...(v === 'fixed'
                                                ? { window_start_time: null, window_end_time: null }
                                                : {}),
                                            }
                                          : p)
                                      }}
                                      className="rounded border border-white/20 bg-background px-2 py-1 text-xs"
                                    >
                                      <option value="fixed">Фикс. длительность</option>
                                      <option value="time_window">Пакет по окну</option>
                                    </select>
                                  </div>
                                  {editingTariff.tariff_type === 'time_window' && (
                                    <div className="grid grid-cols-2 gap-1">
                                      <input
                                        value={editingTariff.window_start_time || ''}
                                        onChange={e => setEditingTariff(p => p ? ({ ...p, window_start_time: e.target.value }) : p)}
                                        type="time"
                                        className="rounded border border-white/20 bg-background px-2 py-1 text-xs"
                                        title="Начало окна"
                                      />
                                      <input
                                        value={editingTariff.window_end_time || ''}
                                        onChange={e => setEditingTariff(p => p ? ({ ...p, window_end_time: e.target.value }) : p)}
                                        type="time"
                                        className="rounded border border-white/20 bg-background px-2 py-1 text-xs"
                                        title="Конец окна"
                                      />
                                    </div>
                                  )}
                                  <div className="flex gap-1">
                                    <button type="button" onClick={handleUpdateTariff} className="flex-1 rounded bg-primary py-1 text-xs text-primary-foreground">Сохранить</button>
                                    <button type="button" onClick={() => setEditingTariff(null)} className="rounded bg-white/10 px-2 py-1 text-xs">Отмена</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                                  <div className="min-w-0">
                                    <span className="text-sm">{t.name}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {t.tariff_type === 'time_window' && t.window_end_time
                                        ? formatTariffWindowLabel(t.window_start_time, t.window_end_time)
                                        : formatMinutes(t.duration_minutes)}
                                      {' · '}{formatPrice(t.price)}
                                    </span>
                                    {t.tariff_type === 'time_window' && (
                                      <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400">Окно</span>
                                    )}
                                  </div>
                                  <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                                    <button type="button" onClick={() => setEditingTariff(t)} className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                                    <button type="button" onClick={() => handleDeleteTariff(t.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'map' && (
          <div
            ref={mapContainerRef}
            className="flex flex-col"
            style={{ height: 'calc(100vh - 240px)' }}
          >
            <p className="mb-2 shrink-0 text-xs text-muted-foreground">
              Редактор карты: подсказки и легенда цветов — внутри блока слева. Ячейка сетки: {cellSize}px.
            </p>
            <div className="flex-1 min-h-0">
              <MapEditor
                projectId={projectId}
                companyId={companyId}
                zones={zones}
                stations={stations}
                decorations={decorations}
                cellSize={cellSize}
                onSaved={(updatedZones, updatedStations, updatedDecos) => {
                  setZones(updatedZones)
                  setStations(updatedStations)
                  setDecorations(updatedDecos)
                }}
                showFlash={showFlash}
              />
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input type="date" value={analyticsFrom} onChange={e => setAnalyticsFrom(e.target.value)} className="rounded-lg border border-white/10 bg-card px-3 py-1.5 text-sm" aria-label="Дата с" />
              <span className="text-muted-foreground">—</span>
              <input type="date" value={analyticsTo} onChange={e => setAnalyticsTo(e.target.value)} className="rounded-lg border border-white/10 bg-card px-3 py-1.5 text-sm" aria-label="Дата по" />
              <button type="button" onClick={() => void loadAnalytics()} disabled={analyticsLoading} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
                {analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Загрузить
              </button>
              <button
                type="button"
                onClick={exportAnalyticsCsv}
                disabled={analyticsLoading || sessions.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                title="Экспорт всех загруженных сессий за период (CSV, UTF-8)"
              >
                <Download className="h-4 w-4" /> CSV
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">Период сохраняется в адресе (<code className="rounded bg-white/5 px-1">tab</code>, <code className="rounded bg-white/5 px-1">afrom</code>, <code className="rounded bg-white/5 px-1">ato</code>) — можно поделиться ссылкой.</p>

            {analyticsLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-24 rounded-xl border border-white/5 bg-white/5" />
                  ))}
                </div>
                <div className="h-32 rounded-xl border border-white/5 bg-white/5" />
                <div className="h-40 rounded-xl border border-white/5 bg-white/5" />
                <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем сессии…
                </p>
              </div>
            ) : completedSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-muted-foreground text-sm">
                За выбранный период нет завершённых сессий
              </div>
            ) : (
              <>
                {/* Summary cards — row of 5 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    { label: 'Выручка', value: formatPrice(totalRevenue), icon: Banknote, color: 'text-emerald-400' },
                    { label: 'Сессий', value: totalSessions.toString(), icon: CheckCircle2, color: 'text-blue-400' },
                    { label: 'Средний чек', value: totalSessions > 0 ? formatPrice(Math.round(totalRevenue / totalSessions)) : '—', icon: TrendingUp, color: 'text-violet-400' },
                    { label: 'Наличка', value: formatPrice(totalCash), icon: Banknote, color: 'text-amber-400' },
                    { label: 'Каспи', value: formatPrice(totalKaspi), icon: Banknote, color: 'text-cyan-400' },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="rounded-xl border border-white/10 bg-card p-4">
                      <div className={`flex items-center gap-1.5 text-xs mb-1 ${color}`}><Icon className="h-3.5 w-3.5" />{label}</div>
                      <p className="text-lg font-bold">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Payment method breakdown */}
                <div className="rounded-xl border border-white/10 bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Banknote className="h-4 w-4 text-amber-400" /> По способу оплаты</h3>
                  <div className="flex gap-4">
                    {[
                      { label: 'Наличка', amount: paymentBreakdown.cash, color: '#f59e0b' },
                      { label: 'Каспи', amount: paymentBreakdown.kaspi, color: '#06b6d4' },
                      { label: 'Смешанный', amount: paymentBreakdown.mixed, color: '#8b5cf6' },
                    ].filter(p => p.amount > 0).map(p => (
                      <div key={p.label} className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs text-muted-foreground">{p.label}</span>
                          <span className="text-xs font-semibold">{formatPrice(p.amount)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${(p.amount / totalRevenue) * 100}%`, background: p.color }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{Math.round((p.amount / totalRevenue) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Daily revenue chart */}
                {dailyData.length > 1 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-400" /> Динамика по дням</h3>
                    <div className="flex items-end gap-1" style={{ height: 80 }}>
                      {dailyData.map(d => (
                        <div key={d.date} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${d.date}: ${formatPrice(d.revenue)} (${d.count} сес.)`}>
                          <div className="w-full rounded-t bg-emerald-500/70 hover:bg-emerald-500 transition-colors cursor-default"
                            style={{ height: `${Math.max(2, (d.revenue / maxDailyRevenue) * 64)}px` }} />
                          {dailyData.length <= 14 && (
                            <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                              {d.date.slice(5)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By zone */}
                {byZone.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full bg-primary inline-block" /> По зонам
                    </h3>
                    <div className="space-y-3">
                      {byZone.map(({ zone, count, revenue, cash, kaspi }) => {
                        const color = zone.color ?? '#3b82f6'
                        return (
                          <div key={zone.id}>
                            <div className="flex items-center gap-3 mb-1">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                              <span className="text-sm font-medium flex-1">{zone.name}</span>
                              <span className="text-sm font-bold">{formatPrice(revenue)}</span>
                              <span className="text-xs text-muted-foreground w-16 text-right">{count} сес.</span>
                            </div>
                            <div className="flex gap-1 ml-4">
                              <div className="h-1.5 rounded-full" style={{ width: `${(revenue / (byZone[0]?.revenue || 1)) * 100}%`, background: color + 'aa' }} />
                            </div>
                            <div className="ml-4 mt-1 flex gap-3 text-[10px] text-muted-foreground">
                              {cash > 0 && <span>💵 {formatPrice(cash)}</span>}
                              {kaspi > 0 && <span>📱 {formatPrice(kaspi)}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* By station with occupancy */}
                {byStation.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Monitor className="h-4 w-4 text-primary" /> По станциям</h3>
                    <div className="space-y-2">
                      {byStation.map(({ station, count, revenue, occupancy }) => (
                        <div key={station.id} className="flex items-center gap-3">
                          <span className="w-24 text-sm truncate shrink-0">{station.name}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(revenue / (byStation[0]?.revenue || 1)) * 100}%` }} />
                          </div>
                          <span className="text-sm font-medium w-24 text-right shrink-0">{formatPrice(revenue)}</span>
                          <span className="text-xs text-muted-foreground w-12 text-right shrink-0">{count} сес.</span>
                          <span className={`text-xs w-12 text-right shrink-0 font-medium ${occupancy >= 50 ? 'text-emerald-400' : occupancy >= 20 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {occupancy}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By tariff */}
                {byTariff.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-violet-400" /> По тарифам</h3>
                    <div className="space-y-2">
                      {byTariff.map(({ tariff, count, revenue }) => (
                        <div key={tariff.id} className="flex items-center gap-3">
                          <span className="w-36 text-sm truncate shrink-0">{tariff.name}</span>
                          <span className="text-xs text-muted-foreground w-16 shrink-0">{formatMinutes(tariff.duration_minutes)}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-violet-500" style={{ width: `${(revenue / (byTariff[0]?.revenue || 1)) * 100}%` }} />
                          </div>
                          <span className="text-sm font-medium w-24 text-right shrink-0">{formatPrice(revenue)}</span>
                          <span className="text-xs text-muted-foreground w-14 text-right shrink-0">{count} сес.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Peak hours */}
                <div className="rounded-xl border border-white/10 bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Загруженность по часам</h3>
                  <div className="flex items-end gap-0.5 h-20">
                    {hourBuckets.map(({ hour, count, revenue }) => (
                      <div key={hour} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                        <div className="w-full rounded-t bg-primary/60 hover:bg-primary transition-colors cursor-default"
                          style={{ height: `${Math.max(0, (count / maxHourCount) * 64)}px`, minHeight: count > 0 ? 2 : 0 }}
                          title={`${hour}:00 — ${count} сес. / ${formatPrice(revenue)}`} />
                        {hour % 3 === 0 && <span className="text-[8px] text-muted-foreground">{hour}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Discounts summary — only if any discounts were given */}
                {totalDiscount > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-amber-400">Скидки за период</h3>
                    <p className="text-lg font-bold text-amber-400">{formatPrice(Math.round(totalDiscount))}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Сумма недополученной выручки от скидок</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <Dialog open={crudDialog !== null} onOpenChange={open => { if (!open) setCrudDialog(null) }}>
        <DialogContent className="border-white/10 bg-card sm:max-w-md">
          {crudDialog?.kind === 'station' && (
            <>
              <DialogHeader>
                <DialogTitle>Новая станция</DialogTitle>
                <DialogDescription>Зона «{crudDialog.zoneLabel}». Имя отображается в зале и в отчётах.</DialogDescription>
              </DialogHeader>
              <input
                autoFocus
                value={newStationName}
                onChange={e => setNewStationName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleCreateStation(crudDialog.zoneId)
                }}
                placeholder="Например, PS-1 или ПК-3"
                className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <button
                  type="button"
                  onClick={() => setCrudDialog(null)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted-foreground hover:bg-white/10"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={saving || !newStationName.trim()}
                  onClick={() => void handleCreateStation(crudDialog.zoneId)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                >
                  {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null} Добавить
                </button>
              </DialogFooter>
            </>
          )}
          {crudDialog?.kind === 'tariff' && (
            <>
              <DialogHeader>
                <DialogTitle>Новый тариф</DialogTitle>
                <DialogDescription>
                  Зона «{crudDialog.zoneLabel}». <strong>Фикс</strong> — сеанс на N минут в любое время. <strong>Пакет по окну</strong> — старт только внутри интервала, окончание в конце окна. Час для продления по сумме задаётся у <strong>зоны</strong> (карандаш у названия зоны), не у тарифа.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <input
                  value={newTariff.name}
                  onChange={e => setNewTariff(p => ({ ...p, name: e.target.value }))}
                  placeholder="Название (напр. 1 час, День пакет)"
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">
                    <span className="mb-1 block">Минуты (для справки / продлений)</span>
                    <input value={newTariff.duration_minutes} onChange={e => setNewTariff(p => ({ ...p, duration_minutes: e.target.value }))} type="number" min={1} className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    <span className="mb-1 block">Цена, ₸</span>
                    <input value={newTariff.price} onChange={e => setNewTariff(p => ({ ...p, price: e.target.value }))} type="number" min={0} step="1" className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm" />
                  </label>
                </div>

                <label className="block text-xs font-medium text-muted-foreground">Режим</label>
                <select
                  value={newTariff.tariff_type}
                  onChange={e => {
                    const v = e.target.value as 'fixed' | 'time_window'
                    setNewTariff(p => ({
                      ...p,
                      tariff_type: v,
                      ...(v === 'fixed' ? { window_start_time: '', window_end_time: '' } : {}),
                    }))
                  }}
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                >
                  <option value="fixed">Фиксированная длительность — доступно в любое время</option>
                  <option value="time_window">Пакет по окну времени (день / ночь / свой интервал)</option>
                </select>

                {newTariff.tariff_type === 'fixed' && (
                  <p className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
                    На точке оператор сможет начать сеанс в любой момент. Длительность = поле «Минуты» (например 60, 180, 300).
                  </p>
                )}

                {newTariff.tariff_type === 'time_window' && (
                  <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs text-amber-200/90">
                      Старт сессии только если текущее время внутри окна. Конец сессии — в указанное «до» (для ночи 22–10 конец до 10:00 следующего утра).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setNewTariff(p => ({
                          ...p,
                          tariff_type: 'time_window',
                          window_start_time: '10:00',
                          window_end_time: '16:00',
                          name: p.name.trim() ? p.name : 'День пакет',
                        }))}
                        className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/15"
                      >
                        День 10:00–16:00
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewTariff(p => ({
                          ...p,
                          tariff_type: 'time_window',
                          window_start_time: '22:00',
                          window_end_time: '10:00',
                          name: p.name.trim() ? p.name : 'Ночь пакет',
                        }))}
                        className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/15"
                      >
                        Ночь 22:00–10:00
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-muted-foreground">
                        <span className="mb-1 block">Окно с</span>
                        <input
                          value={newTariff.window_start_time}
                          onChange={e => setNewTariff(p => ({ ...p, window_start_time: e.target.value }))}
                          type="time"
                          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground">
                        <span className="mb-1 block">Окно до</span>
                        <input
                          value={newTariff.window_end_time}
                          onChange={e => setNewTariff(p => ({ ...p, window_end_time: e.target.value }))}
                          type="time"
                          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Если «с» позже «до» по часам (например 22 и 10) — это ночное окно через полночь.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <button type="button" onClick={() => setCrudDialog(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted-foreground hover:bg-white/10">
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleCreateTariff(crudDialog.zoneId)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                >
                  {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null} Добавить тариф
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
