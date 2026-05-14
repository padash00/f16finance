'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Calculator, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/core/format'

type Company = { id: string; name: string; code: string | null }
type Tariff = {
  id: string
  name: string
  paid_hours: number
  bonus_hours: number
  price: number
}
type ZoneMix = { tariff_id: string; share_pct: number }
type Zone = {
  id: string
  name: string
  device_type: string
  device_count: number
  assumed_occupancy_hours: number
  tariff_mix: ZoneMix[]
}
type Fact = {
  window_days: number
  total_revenue: number
  revenue_per_day: number
  revenue_per_month: number
}

const DEVICE_TYPES = [
  { value: 'pc', label: 'ПК' },
  { value: 'ps', label: 'PlayStation' },
  { value: 'sim_racing', label: 'Sim Racing' },
  { value: 'vr', label: 'VR' },
  { value: 'other', label: 'Другое' },
]

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const n = (v: string | number) => {
  const x = Number(String(v).replace(',', '.'))
  return Number.isFinite(x) && x >= 0 ? x : 0
}

/** ₸ за час сидения по тарифу: цена / (оплаченные + бонусные часы) */
function tariffRate(t: Tariff): number {
  const hours = n(t.paid_hours) + n(t.bonus_hours)
  return hours > 0 ? n(t.price) / hours : 0
}

export default function SimulationPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [zones, setZones] = useState<Zone[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [fact, setFact] = useState<Fact | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = async (cid?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = cid ? `/api/admin/simulation?company_id=${cid}` : '/api/admin/simulation'
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить')
      const d = json.data
      setCompanies(d.companies || [])
      setCompanyId(d.company_id || '')
      setTariffs(
        (d.tariffs || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          paid_hours: Number(t.paid_hours || 0),
          bonus_hours: Number(t.bonus_hours || 0),
          price: Number(t.price || 0),
        })),
      )
      setZones(
        (d.zones || []).map((z: any) => ({
          id: z.id || uid(),
          name: z.name,
          device_type: z.device_type || 'pc',
          device_count: Number(z.device_count || 0),
          assumed_occupancy_hours: Number(z.assumed_occupancy_hours || 0),
          tariff_mix: Array.isArray(z.tariff_mix)
            ? z.tariff_mix.map((m: any) => ({ tariff_id: String(m.tariff_id), share_pct: Number(m.share_pct || 0) }))
            : [],
        })),
      )
      setFact(d.fact || null)
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (!companyId) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, zones, tariffs }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setSuccess('Конфигурация сохранена')
      setTimeout(() => setSuccess(null), 2400)
      await load(companyId)
    } catch (err: any) {
      setError(err?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // ── Расчёты (вживую, на клиенте) ───────────────────────────────────────────
  const tariffById = useMemo(() => {
    const m = new Map<string, Tariff>()
    for (const t of tariffs) m.set(t.id, t)
    return m
  }, [tariffs])

  const calc = useMemo(() => {
    const perZone = zones.map((z) => {
      // средневзвешенная ставка ₸/час по миксу тарифов зоны
      let blendedRate = 0
      let shareSum = 0
      for (const m of z.tariff_mix) {
        const t = tariffById.get(m.tariff_id)
        if (!t) continue
        blendedRate += (n(m.share_pct) / 100) * tariffRate(t)
        shareSum += n(m.share_pct)
      }
      const perDevicePerDay = n(z.assumed_occupancy_hours) * blendedRate
      const potentialPerDay = n(z.device_count) * perDevicePerDay
      return {
        zone: z,
        blendedRate,
        shareSum,
        perDevicePerDay,
        potentialPerDay,
        potentialPerMonth: potentialPerDay * 30,
      }
    })
    const totalPotentialPerDay = perZone.reduce((s, r) => s + r.potentialPerDay, 0)
    const totalDevices = zones.reduce((s, z) => s + n(z.device_count), 0)
    // Σ (device_count × blendedRate) — «выручка за 1 час полной загрузки клуба»
    const capacityRatePerHour = perZone.reduce((s, r) => s + n(r.zone.device_count) * r.blendedRate, 0)
    const factPerDay = fact?.revenue_per_day || 0
    const impliedOccupancy = capacityRatePerHour > 0 ? factPerDay / capacityRatePerHour : null
    return {
      perZone,
      totalPotentialPerDay,
      totalPotentialPerMonth: totalPotentialPerDay * 30,
      totalDevices,
      capacityRatePerHour,
      impliedOccupancy,
    }
  }, [zones, tariffById, fact])

  const totalPotentialMonth = calc.totalPotentialPerMonth
  const factMonth = fact?.revenue_per_month || 0
  const gapMonth = totalPotentialMonth - factMonth

  if (loading) {
    return (
      <div className="app-page-wide flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="app-page-wide relative space-y-6">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
          <Calculator className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">Симуляция выручки</h1>
          <p className="truncate text-xs text-muted-foreground">Потенциал по зонам vs реальная выручка клуба</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {companies.length > 0 ? (
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); void load(v) }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Точка" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <button
            onClick={() => void load(companyId)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
            title="Обновить"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</Card> : null}
      {success ? <Card className="border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</Card> : null}

      {/* ── РЕЗУЛЬТАТ ───────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-blue-500/30 bg-gradient-to-br from-blue-500/[0.08] to-indigo-500/[0.03] p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-blue-300/80">Потенциал клуба / мес</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-blue-200">{formatMoney(Math.round(totalPotentialMonth))} ₸</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{formatMoney(Math.round(calc.totalPotentialPerDay))} ₸ / день · только время устройств</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-emerald-300/80">Факт / мес</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-200">{formatMoney(factMonth)} ₸</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {fact ? `${formatMoney(fact.revenue_per_day)} ₸ / день · по факту за ${fact.window_days} дн (вся выручка)` : 'нет данных'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-amber-300/80">Разрыв / мес</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${gapMonth > 0 ? 'text-amber-200' : 'text-emerald-200'}`}>
              {gapMonth > 0 ? formatMoney(Math.round(gapMonth)) : `+${formatMoney(Math.round(-gapMonth))}`} ₸
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {gapMonth > 0 ? 'столько недозарабатываете против потенциала' : 'факт выше расчётного потенциала'}
            </p>
          </div>
        </div>

        {/* Обратный расчёт загрузки */}
        {calc.impliedOccupancy != null && calc.capacityRatePerHour > 0 ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Обратный расчёт: </span>
            чтобы выйти на текущую выручку, средняя загрузка должна быть{' '}
            <span className="font-bold text-blue-200">{calc.impliedOccupancy.toFixed(1)} ч/устройство в сутки</span>.
            {(() => {
              const assumedAvg = calc.totalDevices > 0
                ? zones.reduce((s, z) => s + n(z.device_count) * n(z.assumed_occupancy_hours), 0) / calc.totalDevices
                : 0
              if (assumedAvg <= 0) return null
              const diff = calc.impliedOccupancy! - assumedAvg
              return (
                <span className="text-muted-foreground">
                  {' '}Вы заложили в среднем {assumedAvg.toFixed(1)} ч —{' '}
                  {Math.abs(diff) < 0.5
                    ? 'расчёт сходится с реальностью.'
                    : diff < 0
                      ? `по факту загрузка ниже на ${Math.abs(diff).toFixed(1)} ч — зоны простаивают.`
                      : `факт выше расчёта на ${diff.toFixed(1)} ч (вероятно, в выручку входят бар/допуслуги).`}
                </span>
              )
            })()}
          </div>
        ) : null}
      </Card>

      {/* ── ПО ЗОНАМ ────────────────────────────────────────────────────────── */}
      {calc.perZone.length > 0 ? (
        <Card className="border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold">Потенциал по зонам</h2>
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calc.perZone.map((r) => ({ name: r.zone.name || '—', value: Math.round(r.potentialPerMonth) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" fontSize={10} />
                <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  formatter={(v: any) => `${formatMoney(Number(v))} ₸ / мес`}
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {calc.perZone.map((_, i) => <Cell key={i} fill="#3b82f6" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-normal">Зона</th>
                  <th className="px-3 py-2 text-right font-normal">Устройств</th>
                  <th className="px-3 py-2 text-right font-normal">Загрузка</th>
                  <th className="px-3 py-2 text-right font-normal">₸/час</th>
                  <th className="px-3 py-2 text-right font-normal">На 1 устр/сутки</th>
                  <th className="px-3 py-2 text-right font-normal">Потенциал/день</th>
                  <th className="px-3 py-2 text-right font-normal">Потенциал/мес</th>
                </tr>
              </thead>
              <tbody>
                {calc.perZone.map((r) => (
                  <tr key={r.zone.id} className="border-t border-white/[0.06]">
                    <td className="px-3 py-2">
                      {r.zone.name || '—'}
                      {r.shareSum > 0 && Math.abs(r.shareSum - 100) > 1 ? (
                        <span className="ml-1 text-[10px] text-amber-300">микс {Math.round(r.shareSum)}%</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.zone.device_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.zone.assumed_occupancy_hours} ч</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Math.round(r.blendedRate))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Math.round(r.perDevicePerDay))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Math.round(r.potentialPerDay))}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-200">{formatMoney(Math.round(r.potentialPerMonth))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ── ТАРИФЫ ──────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Тарифы</h2>
            <p className="text-[11px] text-muted-foreground">Пакеты времени: 2+1, 3+2, день, ночь, продление. ₸/час = цена ÷ (оплаченные + бонусные часы).</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTariffs((cur) => [...cur, { id: uid(), name: '', paid_hours: 0, bonus_hours: 0, price: 0 }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Тариф
          </Button>
        </div>
        {tariffs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Тарифов нет. Добавьте хотя бы один, чтобы считать выручку.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tariffs.map((t, idx) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px_80px_auto] gap-2 items-end">
                <div className="space-y-1">
                  {idx === 0 ? <Label className="text-[10px]">Название</Label> : null}
                  <Input value={t.name} placeholder="2+1" onChange={(e) => setTariffs((cur) => cur.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x))} />
                </div>
                <div className="space-y-1">
                  {idx === 0 ? <Label className="text-[10px]">Опл. часы</Label> : null}
                  <Input inputMode="decimal" value={String(t.paid_hours)} onChange={(e) => setTariffs((cur) => cur.map((x) => x.id === t.id ? { ...x, paid_hours: n(e.target.value) } : x))} />
                </div>
                <div className="space-y-1">
                  {idx === 0 ? <Label className="text-[10px]">Бонус часы</Label> : null}
                  <Input inputMode="decimal" value={String(t.bonus_hours)} onChange={(e) => setTariffs((cur) => cur.map((x) => x.id === t.id ? { ...x, bonus_hours: n(e.target.value) } : x))} />
                </div>
                <div className="space-y-1">
                  {idx === 0 ? <Label className="text-[10px]">Цена ₸</Label> : null}
                  <Input inputMode="decimal" value={String(t.price)} onChange={(e) => setTariffs((cur) => cur.map((x) => x.id === t.id ? { ...x, price: n(e.target.value) } : x))} />
                </div>
                <div className="space-y-1">
                  {idx === 0 ? <Label className="text-[10px]">₸/час</Label> : null}
                  <div className="grid h-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm tabular-nums">
                    {formatMoney(Math.round(tariffRate(t)))}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setTariffs((cur) => cur.filter((x) => x.id !== t.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── ЗОНЫ ────────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Зоны</h2>
            <p className="text-[11px] text-muted-foreground">Кол-во устройств, средняя загрузка (ч/сутки) и доля каждого тарифа в зоне.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setZones((cur) => [...cur, { id: uid(), name: '', device_type: 'pc', device_count: 0, assumed_occupancy_hours: 0, tariff_mix: [] }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Зона
          </Button>
        </div>
        {zones.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Зон нет. Добавьте зону (например «Премиум — 30 ПК»).</p>
        ) : (
          <div className="mt-3 space-y-3">
            {zones.map((z) => (
              <div key={z.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
                <div className="grid grid-cols-[minmax(0,1.4fr)_130px_100px_120px_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Название зоны</Label>
                    <Input value={z.name} placeholder="Премиум" onChange={(e) => setZones((cur) => cur.map((x) => x.id === z.id ? { ...x, name: e.target.value } : x))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Тип</Label>
                    <Select value={z.device_type} onValueChange={(v) => setZones((cur) => cur.map((x) => x.id === z.id ? { ...x, device_type: v } : x))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Устройств</Label>
                    <Input inputMode="numeric" value={String(z.device_count)} onChange={(e) => setZones((cur) => cur.map((x) => x.id === z.id ? { ...x, device_count: Math.round(n(e.target.value)) } : x))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Загрузка, ч/сутки</Label>
                    <Input inputMode="decimal" value={String(z.assumed_occupancy_hours)} onChange={(e) => setZones((cur) => cur.map((x) => x.id === z.id ? { ...x, assumed_occupancy_hours: n(e.target.value) } : x))} />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setZones((cur) => cur.filter((x) => x.id !== z.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Микс тарифов зоны */}
                {tariffs.length > 0 ? (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Доля тарифов в зоне, % (сумма ≈ 100)</Label>
                    <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {tariffs.map((t) => {
                        const mix = z.tariff_mix.find((m) => m.tariff_id === t.id)
                        return (
                          <div key={t.id} className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={t.name}>{t.name || 'тариф'}</span>
                            <Input
                              className="h-8 w-16"
                              inputMode="numeric"
                              value={mix ? String(mix.share_pct) : ''}
                              placeholder="0"
                              onChange={(e) => {
                                const pct = n(e.target.value)
                                setZones((cur) => cur.map((x) => {
                                  if (x.id !== z.id) return x
                                  const rest = x.tariff_mix.filter((m) => m.tariff_id !== t.id)
                                  return { ...x, tariff_mix: pct > 0 ? [...rest, { tariff_id: t.id, share_pct: pct }] : rest }
                                }))
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-300/80">Сначала добавьте тарифы выше — без них зона не считается.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || !companyId}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Сохранить конфигурацию
        </Button>
      </div>

      <Card className="border-white/10 bg-white/[0.02] p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/80">Как это работает</p>
        <p className="mt-1">
          Ты задаёшь структуру (зоны, устройства, тарифы) и грубую загрузку — система считает потенциал выручки.
          «Факт» берётся из системы автоматически (вся выручка точки за {fact?.window_days || 90} дней).
          «Потенциал» — это только выручка за время устройств, без бара и допуслуг — поэтому факт может быть выше.
          Главное здесь — обратный расчёт загрузки и разбивка по зонам: видно, какая зона недорабатывает.
        </p>
      </Card>
    </div>
  )
}
