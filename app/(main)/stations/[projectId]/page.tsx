'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Monitor, Clock, Banknote,
  BarChart3, Settings, Loader2, CheckCircle2, ChevronDown,
  AlertTriangle, RefreshCw, TrendingUp, Calendar, Map,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type Zone = {
  id: string; name: string; is_active: boolean
  grid_x: number | null; grid_y: number | null; grid_w: number; grid_h: number; color: string | null
}
type Station = {
  id: string; zone_id: string | null; name: string; order_index: number; is_active: boolean
  grid_x: number | null; grid_y: number | null
}
type Tariff = { id: string; zone_id: string; name: string; duration_minutes: number; price: number; is_active: boolean; tariff_type: 'fixed' | 'time_window'; window_end_time: string | null }
type Decoration = {
  id: string; type: string; grid_x: number; grid_y: number; grid_w: number; grid_h: number
  label: string | null; rotation: number
}
type Session = {
  id: string; station_id: string; tariff_id: string; started_at: string; ends_at: string
  ended_at: string | null; amount: number; status: string
  station: { name: string; zone_id: string | null } | null
  tariff: { name: string; duration_minutes: number; price: number } | null
}

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

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
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void autoSave(), 1000)
  }

  async function autoSave() {
    setSaving(true)
    try {
      await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateMapLayout',
          stations: localStations.map(s => ({ id: s.id, grid_x: s.grid_x, grid_y: s.grid_y })),
          zones: localZones.map(z => ({ id: z.id, grid_x: z.grid_x, grid_y: z.grid_y, grid_w: z.grid_w, grid_h: z.grid_h, color: z.color })),
        }),
      })
      setDirty(false)
      onSaved(localZones, localStations, localDecos)
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
      // Save decoration position directly
      void fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateDecoration', decorationId: id, grid_x: nx, grid_y: ny }),
      })
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

  async function handleZoneColor(zoneId: string, color: string) {
    setLocalZones(prev => prev.map(z => z.id === zoneId ? { ...z, color } : z))
    setColorPicker(null)
    await fetch('/api/admin/arena', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateMapLayout', zones: [{ id: zoneId, color }], stations: [] }),
    })
    onSaved(localZones.map(z => z.id === zoneId ? { ...z, color } : z), localStations, localDecos)
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
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Перетащите элементы на сетку. Правая кнопка на ячейке — добавить декор.</span>
          {dirty && <span className="text-amber-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Сохранение...</span>}
          {!dirty && !saving && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Сохранено</span>}
        </div>

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
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'manage' | 'map' | 'analytics'>('manage')

  const cellSize = 70
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Analytics
  const [sessions, setSessions] = useState<Session[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsFrom, setAnalyticsFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [analyticsTo, setAnalyticsTo] = useState(() => new Date().toISOString().slice(0, 10))

  // Add zone form
  const [addingZone, setAddingZone] = useState(false)
  const [newZoneName, setNewZoneName] = useState('')
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)

  // Add station
  const [addingStationZone, setAddingStationZone] = useState<string | null>(null)
  const [newStationName, setNewStationName] = useState('')
  const [editingStationId, setEditingStationId] = useState<string | null>(null)

  // Add tariff
  const [addingTariffZone, setAddingTariffZone] = useState<string | null>(null)
  const [newTariff, setNewTariff] = useState({ name: '', duration_minutes: '60', price: '', tariff_type: 'fixed', window_end_time: '' })
  const [editingTariff, setEditingTariff] = useState<Tariff | null>(null)

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const showFlash = (type: 'ok' | 'err', msg: string) => {
    setFlash({ type, msg })
    setTimeout(() => setFlash(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = companyId
        ? `/api/admin/arena?projectId=${projectId}&companyId=${companyId}`
        : `/api/admin/arena?projectId=${projectId}`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setProjectName(data.data.project?.name || '')
      setZones(data.data.zones)
      setStations(data.data.stations)
      setTariffs(data.data.tariffs)
      setDecorations(data.data.decorations || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [projectId, companyId])

  useEffect(() => { void load() }, [load])

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

  async function apiPost(body: object) {
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
      await apiPost({ action: 'createZone', projectId, companyId, name: newZoneName })
      setNewZoneName(''); setAddingZone(false)
      await load(); showFlash('ok', 'Зона создана')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateZone(zoneId: string, name: string) {
    setSaving(true)
    try {
      await apiPost({ action: 'updateZone', zoneId, name })
      setEditingZoneId(null); await load(); showFlash('ok', 'Зона обновлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteZone(zoneId: string) {
    if (!confirm('Удалить зону? Все станции и тарифы зоны будут удалены.')) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteZone', zoneId })
      await load(); showFlash('ok', 'Зона удалена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Station CRUD ────────────────────────────────────────────────────────
  async function handleCreateStation(zoneId: string) {
    if (!newStationName.trim()) return
    setSaving(true)
    try {
      await apiPost({ action: 'createStation', projectId, companyId, zoneId, name: newStationName })
      setNewStationName(''); setAddingStationZone(null)
      await load(); showFlash('ok', 'Станция добавлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateStation(stationId: string, name: string) {
    setSaving(true)
    try {
      await apiPost({ action: 'updateStation', stationId, name })
      setEditingStationId(null); await load(); showFlash('ok', 'Станция обновлена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteStation(stationId: string) {
    if (!confirm('Удалить станцию?')) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteStation', stationId })
      await load(); showFlash('ok', 'Станция удалена')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Tariff CRUD ─────────────────────────────────────────────────────────
  async function handleCreateTariff(zoneId: string) {
    if (!newTariff.name.trim() || !newTariff.price) return
    setSaving(true)
    try {
      await apiPost({
        action: 'createTariff',
        projectId,
        companyId,
        zoneId,
        name: newTariff.name,
        duration_minutes: Number(newTariff.duration_minutes),
        price: Number(newTariff.price),
        tariff_type: newTariff.tariff_type || 'fixed',
        window_end_time: newTariff.tariff_type === 'time_window' ? (newTariff.window_end_time || null) : null,
      })
      setNewTariff({ name: '', duration_minutes: '60', price: '', tariff_type: 'fixed', window_end_time: '' }); setAddingTariffZone(null)
      await load(); showFlash('ok', 'Тариф добавлен')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateTariff() {
    if (!editingTariff) return
    setSaving(true)
    try {
      await apiPost({
        action: 'updateTariff',
        tariffId: editingTariff.id,
        name: editingTariff.name,
        duration_minutes: editingTariff.duration_minutes,
        price: editingTariff.price,
        tariff_type: editingTariff.tariff_type || 'fixed',
        window_end_time: editingTariff.tariff_type === 'time_window' ? (editingTariff.window_end_time || null) : null,
      })
      setEditingTariff(null); await load(); showFlash('ok', 'Тариф обновлён')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleDeleteTariff(tariffId: string) {
    if (!confirm('Удалить тариф?')) return
    setSaving(true)
    try {
      await apiPost({ action: 'deleteTariff', tariffId })
      await load(); showFlash('ok', 'Тариф удалён')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  // ─── Analytics calculations ───────────────────────────────────────────────
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const totalRevenue = completedSessions.reduce((s, x) => s + Number(x.amount), 0)
  const totalSessions = completedSessions.length

  const byStation = stations.map(st => {
    const stSessions = completedSessions.filter(s => s.station_id === st.id)
    return { station: st, count: stSessions.length, revenue: stSessions.reduce((s, x) => s + Number(x.amount), 0) }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  const byTariff = tariffs.map(t => {
    const tSessions = completedSessions.filter(s => s.tariff_id === t.id)
    return { tariff: t, count: tSessions.length, revenue: tSessions.reduce((s, x) => s + Number(x.amount), 0) }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  const hourBuckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }))
  completedSessions.forEach(s => {
    const h = new Date(s.started_at).getHours()
    hourBuckets[h].count++
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
                      if (cId) router.push(`/stations/${pId}?company=${cId}`)
                      else router.push(`/stations/${pId}`)
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
            {/* Add zone button */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Зоны и станции</h2>
              {!addingZone && (
                <button onClick={() => setAddingZone(true)} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20">
                  <Plus className="h-4 w-4" /> Добавить зону
                </button>
              )}
            </div>

            {/* New zone form */}
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
                <button onClick={handleCreateZone} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Создать
                </button>
                <button onClick={() => { setAddingZone(false); setNewZoneName('') }} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            )}

            {zones.length === 0 && !addingZone && (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-muted-foreground">
                <Monitor className="mx-auto h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">Зон пока нет. Создайте первую зону чтобы добавить станции и тарифы.</p>
              </div>
            )}

            {/* Zone cards */}
            {zones.map(zone => {
              const zoneStations = stations.filter(s => s.zone_id === zone.id)
              const zoneTariffs = tariffs.filter(t => t.zone_id === zone.id)
              return (
                <div key={zone.id} className="rounded-xl border border-white/10 bg-card overflow-hidden">
                  {/* Zone header */}
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      {editingZoneId === zone.id ? (
                        <InlineEdit value={zone.name} onSave={v => handleUpdateZone(zone.id, v)} onCancel={() => setEditingZoneId(null)} />
                      ) : (
                        <>
                          <span className="font-semibold text-sm">{zone.name}</span>
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">{zoneStations.length} ст.</span>
                          {!zone.is_active && <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">неактивна</span>}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditingZoneId(editingZoneId === zone.id ? null : zone.id)} className="p-1.5 text-muted-foreground hover:text-foreground rounded"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleDeleteZone(zone.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 divide-x divide-white/10">
                    {/* Stations */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> Станции</span>
                        <button onClick={() => { setAddingStationZone(zone.id); setNewStationName('') }} className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                          <Plus className="h-3 w-3" /> Добавить
                        </button>
                      </div>

                      {addingStationZone === zone.id && (
                        <div className="mb-2 flex items-center gap-1">
                          <input
                            autoFocus
                            value={newStationName}
                            onChange={e => setNewStationName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCreateStation(zone.id); if (e.key === 'Escape') setAddingStationZone(null) }}
                            placeholder="Название (напр. PS-1)"
                            className="flex-1 rounded border border-white/20 bg-background px-2 py-1 text-xs"
                          />
                          <button onClick={() => handleCreateStation(zone.id)} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">OK</button>
                          <button onClick={() => setAddingStationZone(null)} className="p-1 text-muted-foreground"><X className="h-3 w-3" /></button>
                        </div>
                      )}

                      <div className="space-y-1">
                        {zoneStations.length === 0 && <p className="text-xs text-muted-foreground py-2">Нет станций</p>}
                        {zoneStations.map(st => (
                          <div key={st.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5 group">
                            {editingStationId === st.id ? (
                              <InlineEdit value={st.name} onSave={v => handleUpdateStation(st.id, v)} onCancel={() => setEditingStationId(null)} />
                            ) : (
                              <>
                                <span className="text-sm">{st.name}</span>
                                <div className="hidden group-hover:flex items-center gap-1">
                                  <button onClick={() => setEditingStationId(st.id)} className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => handleDeleteStation(st.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Tariffs */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Тарифы</span>
                        <button onClick={() => { setAddingTariffZone(zone.id); setNewTariff({ name: '', duration_minutes: '60', price: '' }) }} className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                          <Plus className="h-3 w-3" /> Добавить
                        </button>
                      </div>

                      {addingTariffZone === zone.id && (
                        <div className="mb-2 space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2">
                          <input value={newTariff.name} onChange={e => setNewTariff(p => ({ ...p, name: e.target.value }))} placeholder="Название (напр. 1 час)" className="w-full rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                          <div className="grid grid-cols-2 gap-1">
                            <input value={newTariff.duration_minutes} onChange={e => setNewTariff(p => ({ ...p, duration_minutes: e.target.value }))} placeholder="Минуты" type="number" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                            <input value={newTariff.price} onChange={e => setNewTariff(p => ({ ...p, price: e.target.value }))} placeholder="Цена ₸" type="number" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <select value={newTariff.tariff_type} onChange={e => setNewTariff(p => ({ ...p, tariff_type: e.target.value }))} className="rounded border border-white/20 bg-background px-2 py-1 text-xs">
                              <option value="fixed">Фиксированный</option>
                              <option value="time_window">Пакет по времени</option>
                            </select>
                            {newTariff.tariff_type === 'time_window' && (
                              <input value={newTariff.window_end_time} onChange={e => setNewTariff(p => ({ ...p, window_end_time: e.target.value }))} placeholder="До (напр. 16:00)" type="time" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleCreateTariff(zone.id)} className="flex-1 rounded bg-primary py-1 text-xs text-primary-foreground">Добавить</button>
                            <button onClick={() => setAddingTariffZone(null)} className="rounded bg-white/10 px-2 py-1 text-xs text-muted-foreground">Отмена</button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-1">
                        {zoneTariffs.length === 0 && <p className="text-xs text-muted-foreground py-2">Нет тарифов</p>}
                        {zoneTariffs.map(t => (
                          <div key={t.id} className="group">
                            {editingTariff?.id === t.id ? (
                              <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2">
                                <input value={editingTariff.name} onChange={e => setEditingTariff(p => p ? ({ ...p, name: e.target.value }) : p)} className="w-full rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                <div className="grid grid-cols-2 gap-1">
                                  <input value={editingTariff.duration_minutes} onChange={e => setEditingTariff(p => p ? ({ ...p, duration_minutes: Number(e.target.value) }) : p)} type="number" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                  <input value={editingTariff.price} onChange={e => setEditingTariff(p => p ? ({ ...p, price: Number(e.target.value) }) : p)} type="number" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  <select value={editingTariff.tariff_type || 'fixed'} onChange={e => setEditingTariff(p => p ? ({ ...p, tariff_type: e.target.value as 'fixed' | 'time_window' }) : p)} className="rounded border border-white/20 bg-background px-2 py-1 text-xs">
                                    <option value="fixed">Фиксированный</option>
                                    <option value="time_window">Пакет по времени</option>
                                  </select>
                                  {editingTariff.tariff_type === 'time_window' && (
                                    <input value={editingTariff.window_end_time || ''} onChange={e => setEditingTariff(p => p ? ({ ...p, window_end_time: e.target.value }) : p)} type="time" className="rounded border border-white/20 bg-background px-2 py-1 text-xs" />
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={handleUpdateTariff} className="flex-1 rounded bg-primary py-1 text-xs text-primary-foreground">Сохранить</button>
                                  <button onClick={() => setEditingTariff(null)} className="rounded bg-white/10 px-2 py-1 text-xs">Отмена</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                                <div>
                                  <span className="text-sm">{t.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {t.tariff_type === 'time_window' && t.window_end_time
                                      ? `до ${t.window_end_time}`
                                      : formatMinutes(t.duration_minutes)}
                                    {' · '}{formatPrice(t.price)}
                                  </span>
                                  {t.tariff_type === 'time_window' && (
                                    <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400">Пакет</span>
                                  )}
                                </div>
                                <div className="hidden group-hover:flex items-center gap-1">
                                  <button onClick={() => setEditingTariff(t)} className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => handleDeleteTariff(t.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
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
              Перетаскивайте зоны и станции мышью. Клик по пустой ячейке — добавить декор. Ячейка: {cellSize}px
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
            {/* Date filter */}
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input type="date" value={analyticsFrom} onChange={e => setAnalyticsFrom(e.target.value)} className="rounded-lg border border-white/10 bg-card px-3 py-1.5 text-sm" />
              <span className="text-muted-foreground">—</span>
              <input type="date" value={analyticsTo} onChange={e => setAnalyticsTo(e.target.value)} className="rounded-lg border border-white/10 bg-card px-3 py-1.5 text-sm" />
              <button onClick={loadAnalytics} disabled={analyticsLoading} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                {analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Загрузить
              </button>
            </div>

            {analyticsLoading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка аналитики...</div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Выручка', value: formatPrice(totalRevenue), icon: Banknote },
                    { label: 'Сессий завершено', value: totalSessions.toString(), icon: CheckCircle2 },
                    { label: 'Средний чек', value: totalSessions > 0 ? formatPrice(Math.round(totalRevenue / totalSessions)) : '—', icon: TrendingUp },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-xl border border-white/10 bg-card p-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Icon className="h-3.5 w-3.5" />{label}</div>
                      <p className="text-xl font-bold">{value}</p>
                    </div>
                  ))}
                </div>

                {/* By station */}
                {byStation.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Monitor className="h-4 w-4 text-primary" /> По станциям</h3>
                    <div className="space-y-2">
                      {byStation.map(({ station, count, revenue }) => (
                        <div key={station.id} className="flex items-center gap-3">
                          <span className="w-28 text-sm truncate">{station.name}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(revenue / (byStation[0]?.revenue || 1)) * 100}%` }} />
                          </div>
                          <span className="text-sm font-medium w-28 text-right">{formatPrice(revenue)}</span>
                          <span className="text-xs text-muted-foreground w-16 text-right">{count} сес.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By tariff */}
                {byTariff.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> По тарифам</h3>
                    <div className="space-y-2">
                      {byTariff.map(({ tariff, count, revenue }) => (
                        <div key={tariff.id} className="flex items-center gap-3">
                          <span className="w-36 text-sm truncate">{tariff.name}</span>
                          <span className="text-xs text-muted-foreground w-20">{formatMinutes(tariff.duration_minutes)}</span>
                          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(revenue / (byTariff[0]?.revenue || 1)) * 100}%` }} />
                          </div>
                          <span className="text-sm font-medium w-28 text-right">{formatPrice(revenue)}</span>
                          <span className="text-xs text-muted-foreground w-16 text-right">{count} сес.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Peak hours */}
                <div className="rounded-xl border border-white/10 bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Загруженность по часам</h3>
                  <div className="flex items-end gap-1 h-20">
                    {hourBuckets.map(({ hour, count }) => (
                      <div key={hour} className="flex flex-col items-center gap-1 flex-1">
                        <div className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${(count / maxHourCount) * 60}px`, minHeight: count > 0 ? 2 : 0 }} title={`${hour}:00 — ${count} сес.`} />
                        {hour % 4 === 0 && <span className="text-[9px] text-muted-foreground">{hour}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {completedSessions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-muted-foreground text-sm">
                    За выбранный период нет завершённых сессий
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
