'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Monitor, Clock, Banknote,
  BarChart3, Settings, ChevronDown, ChevronUp, Loader2, CheckCircle2,
  AlertTriangle, RefreshCw, TrendingUp, Calendar,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type Zone = { id: string; name: string; is_active: boolean }
type Station = { id: string; zone_id: string | null; name: string; order_index: number; is_active: boolean }
type Tariff = { id: string; zone_id: string; name: string; duration_minutes: number; price: number; is_active: boolean }
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StationsPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [projectName, setProjectName] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'manage' | 'analytics'>('manage')

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
  const [newTariff, setNewTariff] = useState({ name: '', duration_minutes: '60', price: '' })
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
      const res = await fetch(`/api/admin/arena?projectId=${projectId}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setProjectName(data.data.project?.name || '')
      setZones(data.data.zones)
      setStations(data.data.stations)
      setTariffs(data.data.tariffs)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch('/api/admin/arena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAnalytics', projectId, from: analyticsFrom, to: analyticsTo + 'T23:59:59' }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setSessions(data.data.sessions)
    } catch (e: any) {
      showFlash('err', e.message)
    } finally {
      setAnalyticsLoading(false)
    }
  }, [projectId, analyticsFrom, analyticsTo])

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
      await apiPost({ action: 'createZone', projectId, name: newZoneName })
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
      await apiPost({ action: 'createStation', projectId, zoneId, name: newStationName })
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
      await apiPost({ action: 'createTariff', projectId, zoneId, name: newTariff.name, duration_minutes: Number(newTariff.duration_minutes), price: Number(newTariff.price) })
      setNewTariff({ name: '', duration_minutes: '60', price: '' }); setAddingTariffZone(null)
      await load(); showFlash('ok', 'Тариф добавлен')
    } catch (e: any) { showFlash('err', e.message) } finally { setSaving(false) }
  }

  async function handleUpdateTariff() {
    if (!editingTariff) return
    setSaving(true)
    try {
      await apiPost({ action: 'updateTariff', tariffId: editingTariff.id, name: editingTariff.name, duration_minutes: editingTariff.duration_minutes, price: editingTariff.price })
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

  // Hours distribution
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/point-devices" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Устройства
          </Link>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <span className="font-semibold">{projectName}</span>
            <span className="text-muted-foreground">— Управление станциями</span>
          </div>
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
      <div className="border-b bg-card px-6">
        <div className="flex gap-0">
          {[
            { id: 'manage', label: 'Управление', icon: Settings },
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
      </div>

      <div className="p-6 max-w-5xl">
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
                                <div className="flex gap-1">
                                  <button onClick={handleUpdateTariff} className="flex-1 rounded bg-primary py-1 text-xs text-primary-foreground">Сохранить</button>
                                  <button onClick={() => setEditingTariff(null)} className="rounded bg-white/10 px-2 py-1 text-xs">Отмена</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                                <div>
                                  <span className="text-sm">{t.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">{formatMinutes(t.duration_minutes)} · {formatPrice(t.price)}</span>
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
