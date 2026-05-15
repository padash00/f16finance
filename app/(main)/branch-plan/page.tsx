'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Building2, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/core/format'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const num = (v: string | number) => {
  const x = Number(String(v).replace(',', '.'))
  return Number.isFinite(x) && x >= 0 ? x : 0
}

type CapexRow = { id: string; name: string; unit_price: number; quantity: number }
type Tariff = { id: string; name: string; paid_hours: number; bonus_hours: number; price: number }
type ZoneMix = { tariff_id: string; share_pct: number }
type Zone = { id: string; name: string; device_count: number; occupancy_hours: number; tariff_mix: ZoneMix[] }
type OpexRow = { id: string; name: string; amount: number; kind: 'fixed' | 'percent_of_revenue' }

type Draft = {
  id?: string
  name: string
  capex: CapexRow[]
  tariffs: Tariff[]
  zones: Zone[]
  opex: OpexRow[]
}

type DraftListItem = { id: string; name: string; updated_at: string }

function tariffRate(t: Tariff): number {
  const hours = num(t.paid_hours) + num(t.bonus_hours)
  return hours > 0 ? num(t.price) / hours : 0
}

function defaultDraft(): Draft {
  const tariff21 = { id: uid(), name: '2+1', paid_hours: 2, bonus_hours: 1, price: 600 }
  const tariff32 = { id: uid(), name: '3+2', paid_hours: 3, bonus_hours: 2, price: 1000 }
  const tariffNight = { id: uid(), name: 'Ночь', paid_hours: 8, bonus_hours: 0, price: 3500 }
  return {
    name: 'Новая точка',
    capex: [
      { id: uid(), name: 'Игровой ПК (комплект)', unit_price: 400_000, quantity: 30 },
      { id: uid(), name: 'Монитор 27"', unit_price: 80_000, quantity: 30 },
      { id: uid(), name: 'Геймерское кресло', unit_price: 60_000, quantity: 30 },
      { id: uid(), name: 'Стол + перегородка', unit_price: 25_000, quantity: 30 },
      { id: uid(), name: 'Периферия (мышь/клава/гарнитура)', unit_price: 20_000, quantity: 30 },
      { id: uid(), name: 'Сетевое оборудование', unit_price: 250_000, quantity: 1 },
      { id: uid(), name: 'Ремонт и отделка', unit_price: 2_000_000, quantity: 1 },
      { id: uid(), name: 'Депозит аренды', unit_price: 600_000, quantity: 1 },
      { id: uid(), name: 'Вывеска и брендинг', unit_price: 400_000, quantity: 1 },
      { id: uid(), name: 'Прочее (запас 10%)', unit_price: 1_500_000, quantity: 1 },
    ],
    tariffs: [tariff21, tariff32, tariffNight],
    zones: [
      {
        id: uid(),
        name: 'Основная зона',
        device_count: 30,
        occupancy_hours: 7,
        tariff_mix: [
          { tariff_id: tariff21.id, share_pct: 60 },
          { tariff_id: tariff32.id, share_pct: 30 },
          { tariff_id: tariffNight.id, share_pct: 10 },
        ],
      },
    ],
    opex: [
      { id: uid(), name: 'Аренда', amount: 600_000, kind: 'fixed' },
      { id: uid(), name: 'ФОТ операторов', amount: 800_000, kind: 'fixed' },
      { id: uid(), name: 'Электричество', amount: 200_000, kind: 'fixed' },
      { id: uid(), name: 'Интернет', amount: 30_000, kind: 'fixed' },
      { id: uid(), name: 'Расходники / бар', amount: 100_000, kind: 'fixed' },
      { id: uid(), name: 'Маркетинг', amount: 80_000, kind: 'fixed' },
      { id: uid(), name: 'Налог (3% от выручки)', amount: 3, kind: 'percent_of_revenue' },
    ],
  }
}

export default function BranchPlanPage() {
  const [drafts, setDrafts] = useState<DraftListItem[]>([])
  const [draft, setDraft] = useState<Draft>(defaultDraft)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadList = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/branch-plan', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить')
      setDrafts(json.data?.drafts || [])
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadList()
  }, [])

  const loadDraft = async (id: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/branch-plan?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить черновик')
      const d = json.data.draft
      const p = d.payload || {}
      setDraft({
        id: d.id,
        name: d.name || 'Без названия',
        capex: Array.isArray(p.capex) ? p.capex : defaultDraft().capex,
        tariffs: Array.isArray(p.tariffs) ? p.tariffs : defaultDraft().tariffs,
        zones: Array.isArray(p.zones) ? p.zones : defaultDraft().zones,
        opex: Array.isArray(p.opex) ? p.opex : defaultDraft().opex,
      })
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    }
  }

  const saveDraft = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/branch-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          id: draft.id,
          name: draft.name,
          payload: { capex: draft.capex, tariffs: draft.tariffs, zones: draft.zones, opex: draft.opex },
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setDraft((d) => ({ ...d, id: json.data?.id || d.id }))
      setSuccess('Сохранено')
      setTimeout(() => setSuccess(null), 2200)
      await loadList()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const deleteDraft = async () => {
    if (!draft.id) return
    if (!window.confirm(`Удалить черновик «${draft.name}»?`)) return
    try {
      const res = await fetch('/api/admin/branch-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: draft.id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить')
      setDraft(defaultDraft())
      await loadList()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    }
  }

  // ── Расчёты ────────────────────────────────────────────────────────────────
  const tariffById = useMemo(() => {
    const m = new Map<string, Tariff>()
    for (const t of draft.tariffs) m.set(t.id, t)
    return m
  }, [draft.tariffs])

  const calc = useMemo(() => {
    // CAPEX
    const totalCapex = draft.capex.reduce((s, r) => s + num(r.unit_price) * num(r.quantity), 0)

    // Revenue per zone per month
    let monthlyRevenue = 0
    const zoneBreakdown = draft.zones.map((z) => {
      let blendedRate = 0
      for (const m of z.tariff_mix) {
        const t = tariffById.get(m.tariff_id)
        if (!t) continue
        blendedRate += (num(m.share_pct) / 100) * tariffRate(t)
      }
      const perDay = num(z.device_count) * num(z.occupancy_hours) * blendedRate
      const perMonth = perDay * 30
      monthlyRevenue += perMonth
      return { zone: z, perMonth, blendedRate }
    })

    // OPEX
    let opexFixed = 0
    let opexPercent = 0
    for (const o of draft.opex) {
      if (o.kind === 'fixed') opexFixed += num(o.amount)
      else opexPercent += (num(o.amount) / 100) * monthlyRevenue
    }
    const monthlyOpex = opexFixed + opexPercent
    const monthlyProfit = monthlyRevenue - monthlyOpex
    const paybackMonths = monthlyProfit > 0 ? totalCapex / monthlyProfit : null

    // Cumulative cash flow 24 months
    const cashFlow: Array<{ month: number; cash: number }> = []
    for (let i = 0; i <= 24; i++) {
      cashFlow.push({ month: i, cash: Math.round(-totalCapex + i * monthlyProfit) })
    }

    return {
      totalCapex,
      monthlyRevenue,
      opexFixed,
      opexPercent,
      monthlyOpex,
      monthlyProfit,
      paybackMonths,
      cashFlow,
      zoneBreakdown,
    }
  }, [draft, tariffById])

  if (loading) {
    return (
      <div className="app-page max-w-[1600px] flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="app-page max-w-[1600px] relative space-y-6">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-purple-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/30">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">Финмодель новой точки</h1>
          <p className="truncate text-xs text-muted-foreground">CAPEX · OPEX · выручка · окупаемость</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {drafts.length > 0 ? (
            <Select value={draft.id || '__new__'} onValueChange={(v) => v === '__new__' ? setDraft(defaultDraft()) : void loadDraft(v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Черновик" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">+ Новый черновик</SelectItem>
                {drafts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <button
            onClick={() => { setDraft(defaultDraft()); void loadList() }}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
            title="Обновить"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</Card> : null}
      {success ? <Card className="border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</Card> : null}

      {/* Имя черновика */}
      <Card className="border-white/10 bg-white/[0.02] p-4">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Название модели</Label>
        <Input
          className="mt-1 text-lg font-semibold"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="F16 Бостандык"
        />
      </Card>

      {/* ── РЕЗУЛЬТАТ ─────────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-pink-500/[0.03] p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-purple-300/80">Стартовые вложения</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-purple-200">{formatMoney(Math.round(calc.totalCapex))} ₸</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-emerald-300/80">Выручка / мес</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-200">{formatMoney(Math.round(calc.monthlyRevenue))} ₸</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-rose-300/80">Расходы / мес</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-rose-200">{formatMoney(Math.round(calc.monthlyOpex))} ₸</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Фикс {formatMoney(Math.round(calc.opexFixed))} · % {formatMoney(Math.round(calc.opexPercent))}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-amber-300/80">Прибыль / мес</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${calc.monthlyProfit > 0 ? 'text-amber-200' : 'text-rose-200'}`}>
              {formatMoney(Math.round(calc.monthlyProfit))} ₸
            </p>
            {calc.paybackMonths != null ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Окупаемость: <span className="font-semibold text-amber-200">{calc.paybackMonths.toFixed(1)} мес</span>
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-rose-300">Прибыль ≤ 0 — окупаемость не наступит</p>
            )}
          </div>
        </div>

        {/* Cash flow chart */}
        <div className="mt-5">
          <p className="mb-2 text-xs text-muted-foreground">Накопительный кэш за 24 месяца (начинаем с −CAPEX)</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calc.cashFlow}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" stroke="rgba(255,255,255,0.45)" fontSize={10} />
                <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => `${Math.round(Number(v) / 1_000_000)}M`} />
                <Tooltip
                  formatter={(v: any) => `${formatMoney(Number(v))} ₸`}
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                />
                <Line type="monotone" dataKey="cash" stroke="#a855f7" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {/* ── CAPEX ────────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Стартовые вложения (CAPEX)</h2>
            <p className="text-[11px] text-muted-foreground">Разовые траты на запуск: оборудование, ремонт, депозит, брендинг.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft((d) => ({ ...d, capex: [...d.capex, { id: uid(), name: '', unit_price: 0, quantity: 1 }] }))}
          >
            <Plus className="mr-1 h-4 w-4" /> Строка
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.capex.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1.6fr)_130px_90px_140px_auto] gap-2 items-end">
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Статья</Label> : null}
                <Input value={r.name} placeholder="Игровой ПК" onChange={(e) => setDraft((d) => ({ ...d, capex: d.capex.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Цена ₸</Label> : null}
                <Input inputMode="decimal" value={String(r.unit_price)} onChange={(e) => setDraft((d) => ({ ...d, capex: d.capex.map((x) => x.id === r.id ? { ...x, unit_price: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Кол-во</Label> : null}
                <Input inputMode="numeric" value={String(r.quantity)} onChange={(e) => setDraft((d) => ({ ...d, capex: d.capex.map((x) => x.id === r.id ? { ...x, quantity: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Подитог</Label> : null}
                <div className="grid h-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm tabular-nums">
                  {formatMoney(Math.round(num(r.unit_price) * num(r.quantity)))} ₸
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDraft((d) => ({ ...d, capex: d.capex.filter((x) => x.id !== r.id) }))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end rounded-xl border border-purple-500/30 bg-purple-500/[0.06] px-4 py-2.5">
          <span className="mr-2 text-sm text-muted-foreground">Итого CAPEX:</span>
          <span className="text-lg font-bold tabular-nums text-purple-200">{formatMoney(Math.round(calc.totalCapex))} ₸</span>
        </div>
      </Card>

      {/* ── ТАРИФЫ ──────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Тарифы</h2>
            <p className="text-[11px] text-muted-foreground">₸/час считается как цена ÷ (оплаченные + бонусные часы).</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, tariffs: [...d.tariffs, { id: uid(), name: '', paid_hours: 0, bonus_hours: 0, price: 0 }] }))}>
            <Plus className="mr-1 h-4 w-4" /> Тариф
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.tariffs.map((t, idx) => (
            <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px_80px_auto] gap-2 items-end">
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Название</Label> : null}
                <Input value={t.name} placeholder="2+1" onChange={(e) => setDraft((d) => ({ ...d, tariffs: d.tariffs.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Опл. ч</Label> : null}
                <Input inputMode="decimal" value={String(t.paid_hours)} onChange={(e) => setDraft((d) => ({ ...d, tariffs: d.tariffs.map((x) => x.id === t.id ? { ...x, paid_hours: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Бонус ч</Label> : null}
                <Input inputMode="decimal" value={String(t.bonus_hours)} onChange={(e) => setDraft((d) => ({ ...d, tariffs: d.tariffs.map((x) => x.id === t.id ? { ...x, bonus_hours: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Цена ₸</Label> : null}
                <Input inputMode="decimal" value={String(t.price)} onChange={(e) => setDraft((d) => ({ ...d, tariffs: d.tariffs.map((x) => x.id === t.id ? { ...x, price: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">₸/час</Label> : null}
                <div className="grid h-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm tabular-nums">
                  {formatMoney(Math.round(tariffRate(t)))}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDraft((d) => ({ ...d, tariffs: d.tariffs.filter((x) => x.id !== t.id) }))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* ── ЗОНЫ ────────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Зоны и загрузка</h2>
            <p className="text-[11px] text-muted-foreground">Сколько устройств, средняя загрузка (ч/сутки), доли тарифов.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, zones: [...d.zones, { id: uid(), name: '', device_count: 0, occupancy_hours: 0, tariff_mix: [] }] }))}>
            <Plus className="mr-1 h-4 w-4" /> Зона
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          {draft.zones.map((z) => (
            <div key={z.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <div className="grid grid-cols-[minmax(0,1.4fr)_110px_130px_auto] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-[10px]">Название</Label>
                  <Input value={z.name} placeholder="Премиум" onChange={(e) => setDraft((d) => ({ ...d, zones: d.zones.map((x) => x.id === z.id ? { ...x, name: e.target.value } : x) }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Устройств</Label>
                  <Input inputMode="numeric" value={String(z.device_count)} onChange={(e) => setDraft((d) => ({ ...d, zones: d.zones.map((x) => x.id === z.id ? { ...x, device_count: Math.round(num(e.target.value)) } : x) }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Загрузка ч/сутки</Label>
                  <Input inputMode="decimal" value={String(z.occupancy_hours)} onChange={(e) => setDraft((d) => ({ ...d, zones: d.zones.map((x) => x.id === z.id ? { ...x, occupancy_hours: num(e.target.value) } : x) }))} />
                </div>
                <Button size="icon" variant="ghost" onClick={() => setDraft((d) => ({ ...d, zones: d.zones.filter((x) => x.id !== z.id) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {draft.tariffs.length > 0 ? (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Доля тарифов, % (сумма ≈ 100)</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {draft.tariffs.map((t) => {
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
                              const pct = num(e.target.value)
                              setDraft((d) => ({
                                ...d,
                                zones: d.zones.map((x) => {
                                  if (x.id !== z.id) return x
                                  const rest = x.tariff_mix.filter((m) => m.tariff_id !== t.id)
                                  return { ...x, tariff_mix: pct > 0 ? [...rest, { tariff_id: t.id, share_pct: pct }] : rest }
                                }),
                              }))
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {calc.zoneBreakdown.length > 0 ? (
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calc.zoneBreakdown.map((z) => ({ name: z.zone.name || '—', value: Math.round(z.perMonth) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" fontSize={10} />
                <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => `${Math.round(Number(v) / 1_000_000)}M`} />
                <Tooltip
                  formatter={(v: any) => `${formatMoney(Number(v))} ₸ / мес`}
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {calc.zoneBreakdown.map((_, i) => <Cell key={i} fill="#10b981" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </Card>

      {/* ── OPEX ────────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ежемесячные расходы (OPEX)</h2>
            <p className="text-[11px] text-muted-foreground">Фиксированные суммы или процент от выручки (например, налог 3%).</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, opex: [...d.opex, { id: uid(), name: '', amount: 0, kind: 'fixed' }] }))}>
            <Plus className="mr-1 h-4 w-4" /> Статья
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.opex.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1.4fr)_140px_140px_140px_auto] gap-2 items-end">
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Статья</Label> : null}
                <Input value={r.name} placeholder="Аренда" onChange={(e) => setDraft((d) => ({ ...d, opex: d.opex.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Тип</Label> : null}
                <Select value={r.kind} onValueChange={(v) => setDraft((d) => ({ ...d, opex: d.opex.map((x) => x.id === r.id ? { ...x, kind: v as OpexRow['kind'] } : x) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Фиксированная</SelectItem>
                    <SelectItem value="percent_of_revenue">% от выручки</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">{r.kind === 'percent_of_revenue' ? 'Процент' : 'Сумма ₸'}</Label> : null}
                <Input inputMode="decimal" value={String(r.amount)} onChange={(e) => setDraft((d) => ({ ...d, opex: d.opex.map((x) => x.id === r.id ? { ...x, amount: num(e.target.value) } : x) }))} />
              </div>
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">В месяц</Label> : null}
                <div className="grid h-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm tabular-nums">
                  {r.kind === 'percent_of_revenue'
                    ? formatMoney(Math.round((num(r.amount) / 100) * calc.monthlyRevenue))
                    : formatMoney(Math.round(num(r.amount)))} ₸
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDraft((d) => ({ ...d, opex: d.opex.filter((x) => x.id !== r.id) }))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-2.5">
          <span className="mr-2 text-sm text-muted-foreground">Итого OPEX / мес:</span>
          <span className="text-lg font-bold tabular-nums text-rose-200">{formatMoney(Math.round(calc.monthlyOpex))} ₸</span>
        </div>
      </Card>

      {/* Кнопки сохранения */}
      <div className="flex flex-wrap justify-end gap-2">
        {draft.id ? (
          <Button variant="outline" className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10" onClick={() => void deleteDraft()}>
            <Trash2 className="mr-1 h-4 w-4" /> Удалить
          </Button>
        ) : null}
        <Button onClick={() => void saveDraft()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {draft.id ? 'Сохранить' : 'Сохранить как новый'}
        </Button>
      </div>

      <Card className="border-white/10 bg-white/[0.02] p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/80">Как пользоваться</p>
        <p className="mt-1">
          Введи структуру: сколько и каких устройств, по чём тарифы, какая ожидаемая загрузка, и сколько фиксированных
          ежемесячных трат. Всё считается вживую — выручка/мес, расходы/мес, прибыль/мес, окупаемость и кэш по месяцам.
          Сохраняй несколько вариантов («дорогой ремонт» / «эконом», «50 ПК» / «30 ПК»), сравнивай.
        </p>
        <p className="mt-1.5">
          Окупаемость = CAPEX ÷ месячная прибыль. График — что у тебя будет на счёте через N месяцев (старт −CAPEX,
          потом +прибыль каждый месяц). Точка пересечения с нулём — момент окупаемости.
        </p>
      </Card>
    </div>
  )
}
