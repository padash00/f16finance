'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Building2, Cpu, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

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

// ── Типы ──────────────────────────────────────────────────────────────────
type PcComponent = { id: string; name: string; price: number }
type PcConfig = { id: string; name: string; quantity: number; components: PcComponent[] }
type CapexRow = { id: string; name: string; unit_price: number; quantity: number }
type Tariff = { id: string; name: string; paid_hours: number; bonus_hours: number; price: number }
type ZoneMix = { tariff_id: string; share_pct: number }
type Zone = { id: string; name: string; device_count: number; occupancy_hours: number; tariff_mix: ZoneMix[] }
type OpexRow = { id: string; name: string; amount: number; kind: 'fixed' | 'percent_of_revenue' }
type ScenarioCfg = { revenue_mult: number; opex_mult: number }
type RampUp = { enabled: boolean; months: number[] }

type Draft = {
  id?: string
  name: string
  pc_configs: PcConfig[]
  capex: CapexRow[]
  tariffs: Tariff[]
  zones: Zone[]
  opex: OpexRow[]
  scenarios: { best: ScenarioCfg; expected: ScenarioCfg; worst: ScenarioCfg }
  ramp_up: RampUp
}

type DraftListItem = { id: string; name: string; updated_at: string }

function tariffRate(t: Tariff): number {
  const hours = num(t.paid_hours) + num(t.bonus_hours)
  return hours > 0 ? num(t.price) / hours : 0
}

function pcUnitPrice(c: PcConfig): number {
  return c.components.reduce((s, x) => s + num(x.price), 0)
}

// ── Дефолтный шаблон ──────────────────────────────────────────────────────
function defaultDraft(): Draft {
  const tariff21 = { id: uid(), name: '2+1', paid_hours: 2, bonus_hours: 1, price: 600 }
  const tariff32 = { id: uid(), name: '3+2', paid_hours: 3, bonus_hours: 2, price: 1000 }
  const tariffNight = { id: uid(), name: 'Ночь', paid_hours: 8, bonus_hours: 0, price: 3500 }
  return {
    name: 'Новая точка',
    pc_configs: [
      {
        id: uid(),
        name: 'Премиум ПК',
        quantity: 20,
        components: [
          { id: uid(), name: 'Процессор Intel i5-13600KF', price: 130_000 },
          { id: uid(), name: 'Видеокарта RTX 4070', price: 250_000 },
          { id: uid(), name: 'ОЗУ 32GB DDR5', price: 50_000 },
          { id: uid(), name: 'Материнская плата B760', price: 60_000 },
          { id: uid(), name: 'SSD 1TB NVMe', price: 30_000 },
          { id: uid(), name: 'Блок питания 750W Gold', price: 35_000 },
          { id: uid(), name: 'Корпус', price: 25_000 },
          { id: uid(), name: 'Кулер CPU', price: 20_000 },
          { id: uid(), name: 'Монитор 27" 165Hz', price: 110_000 },
        ],
      },
      {
        id: uid(),
        name: 'Стандарт ПК',
        quantity: 10,
        components: [
          { id: uid(), name: 'Процессор Intel i5-12400F', price: 80_000 },
          { id: uid(), name: 'Видеокарта RTX 4060', price: 170_000 },
          { id: uid(), name: 'ОЗУ 16GB DDR4', price: 25_000 },
          { id: uid(), name: 'Материнская плата B660', price: 40_000 },
          { id: uid(), name: 'SSD 500GB NVMe', price: 18_000 },
          { id: uid(), name: 'Блок питания 650W', price: 25_000 },
          { id: uid(), name: 'Корпус', price: 18_000 },
          { id: uid(), name: 'Кулер CPU', price: 12_000 },
          { id: uid(), name: 'Монитор 24" 144Hz', price: 75_000 },
        ],
      },
    ],
    capex: [
      { id: uid(), name: 'Геймерское кресло DXRacer', unit_price: 80_000, quantity: 30 },
      { id: uid(), name: 'Стол игровой + перегородка', unit_price: 35_000, quantity: 30 },
      { id: uid(), name: 'Периферия (мышь/клава/гарнитура)', unit_price: 25_000, quantity: 30 },
      { id: uid(), name: 'Коврик игровой', unit_price: 5_000, quantity: 30 },
      { id: uid(), name: 'Сетевое оборудование (роутер/свитчи)', unit_price: 250_000, quantity: 1 },
      { id: uid(), name: 'Кондиционеры', unit_price: 250_000, quantity: 3 },
      { id: uid(), name: 'Ресепшн + барная стойка', unit_price: 400_000, quantity: 1 },
      { id: uid(), name: 'Ремонт и отделка', unit_price: 2_500_000, quantity: 1 },
      { id: uid(), name: 'Депозит аренды', unit_price: 800_000, quantity: 1 },
      { id: uid(), name: 'Вывеска и брендинг', unit_price: 500_000, quantity: 1 },
      { id: uid(), name: 'Камеры/охранка', unit_price: 400_000, quantity: 1 },
      { id: uid(), name: 'Кассовое оборудование', unit_price: 250_000, quantity: 1 },
    ],
    tariffs: [tariff21, tariff32, tariffNight],
    zones: [
      {
        id: uid(),
        name: 'Премиум зона',
        device_count: 20,
        occupancy_hours: 8,
        tariff_mix: [
          { tariff_id: tariff21.id, share_pct: 40 },
          { tariff_id: tariff32.id, share_pct: 50 },
          { tariff_id: tariffNight.id, share_pct: 10 },
        ],
      },
      {
        id: uid(),
        name: 'Стандарт зона',
        device_count: 10,
        occupancy_hours: 6,
        tariff_mix: [
          { tariff_id: tariff21.id, share_pct: 70 },
          { tariff_id: tariff32.id, share_pct: 20 },
          { tariff_id: tariffNight.id, share_pct: 10 },
        ],
      },
    ],
    opex: [
      { id: uid(), name: 'Аренда', amount: 800_000, kind: 'fixed' },
      { id: uid(), name: 'ФОТ операторов', amount: 900_000, kind: 'fixed' },
      { id: uid(), name: 'Электричество', amount: 300_000, kind: 'fixed' },
      { id: uid(), name: 'Интернет', amount: 40_000, kind: 'fixed' },
      { id: uid(), name: 'Расходники / бар', amount: 120_000, kind: 'fixed' },
      { id: uid(), name: 'Маркетинг', amount: 100_000, kind: 'fixed' },
      { id: uid(), name: 'Налог (3% от выручки)', amount: 3, kind: 'percent_of_revenue' },
    ],
    scenarios: {
      best: { revenue_mult: 1.3, opex_mult: 1.0 },
      expected: { revenue_mult: 1.0, opex_mult: 1.0 },
      worst: { revenue_mult: 0.7, opex_mult: 1.15 },
    },
    ramp_up: {
      enabled: true,
      months: [0.3, 0.5, 0.75, 1.0],
    },
  }
}

function mergeDraft(d: Partial<Draft>): Draft {
  const base = defaultDraft()
  return {
    id: d.id,
    name: d.name || base.name,
    pc_configs: Array.isArray(d.pc_configs) ? d.pc_configs : base.pc_configs,
    capex: Array.isArray(d.capex) ? d.capex : base.capex,
    tariffs: Array.isArray(d.tariffs) ? d.tariffs : base.tariffs,
    zones: Array.isArray(d.zones) ? d.zones : base.zones,
    opex: Array.isArray(d.opex) ? d.opex : base.opex,
    scenarios: d.scenarios || base.scenarios,
    ramp_up: d.ramp_up || base.ramp_up,
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
      setDraft(mergeDraft({ id: d.id, name: d.name, ...(d.payload || {}) }))
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
          payload: {
            pc_configs: draft.pc_configs,
            capex: draft.capex,
            tariffs: draft.tariffs,
            zones: draft.zones,
            opex: draft.opex,
            scenarios: draft.scenarios,
            ramp_up: draft.ramp_up,
          },
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
    // CAPEX от ПК-конфигов + прочее
    const pcCapex = draft.pc_configs.reduce((s, c) => s + num(c.quantity) * pcUnitPrice(c), 0)
    const otherCapex = draft.capex.reduce((s, r) => s + num(r.unit_price) * num(r.quantity), 0)
    const totalCapex = pcCapex + otherCapex

    // Базовая выручка по зонам
    let baseRevenue = 0
    const zoneBreakdown = draft.zones.map((z) => {
      let blendedRate = 0
      for (const m of z.tariff_mix) {
        const t = tariffById.get(m.tariff_id)
        if (!t) continue
        blendedRate += (num(m.share_pct) / 100) * tariffRate(t)
      }
      const perMonth = num(z.device_count) * num(z.occupancy_hours) * blendedRate * 30
      baseRevenue += perMonth
      return { zone: z, perMonth }
    })

    // OPEX
    const computeOpex = (revenue: number, opexMult = 1) => {
      let fixed = 0
      let percent = 0
      for (const o of draft.opex) {
        if (o.kind === 'fixed') fixed += num(o.amount) * opexMult
        else percent += (num(o.amount) / 100) * revenue
      }
      return { fixed, percent, total: fixed + percent }
    }

    // Базовый сценарий (expected)
    const expectedOpex = computeOpex(baseRevenue * num(draft.scenarios.expected.revenue_mult), num(draft.scenarios.expected.opex_mult))
    const baseScenario = {
      revenue: baseRevenue * num(draft.scenarios.expected.revenue_mult),
      opexFixed: expectedOpex.fixed,
      opexPercent: expectedOpex.percent,
      opex: expectedOpex.total,
      profit: baseRevenue * num(draft.scenarios.expected.revenue_mult) - expectedOpex.total,
    }
    const paybackMonths = baseScenario.profit > 0 ? totalCapex / baseScenario.profit : null

    // Сценарии Best/Worst для сравнения
    const buildScenario = (cfg: ScenarioCfg) => {
      const rev = baseRevenue * num(cfg.revenue_mult)
      const op = computeOpex(rev, num(cfg.opex_mult))
      const profit = rev - op.total
      return {
        revenue: rev,
        opex: op.total,
        profit,
        payback: profit > 0 ? totalCapex / profit : null,
      }
    }
    const scenarioBest = buildScenario(draft.scenarios.best)
    const scenarioExpected = buildScenario(draft.scenarios.expected)
    const scenarioWorst = buildScenario(draft.scenarios.worst)

    // Cash flow с учётом ramp-up на expected
    const ramp = draft.ramp_up
    const cashFlow: Array<{ month: number; cash: number }> = []
    let acc = -totalCapex
    cashFlow.push({ month: 0, cash: Math.round(acc) })
    for (let i = 1; i <= 24; i++) {
      const idx = i - 1
      const rampMult = ramp.enabled
        ? (idx < ramp.months.length ? num(ramp.months[idx]) : num(ramp.months[ramp.months.length - 1] || 1))
        : 1
      const monthRev = baseScenario.revenue * rampMult
      // Fixed OPEX не зависит от выручки, percent — зависит
      const monthOpex =
        baseScenario.opexFixed +
        (baseScenario.opexPercent / Math.max(baseScenario.revenue, 1)) * monthRev
      acc += monthRev - monthOpex
      cashFlow.push({ month: i, cash: Math.round(acc) })
    }

    // Точка безубыточности: сколько часов/устройство в день нужно
    // breakEvenHours = (fixedOpex) / (devices × 30 × blended_avg_rate × (1 − percent_share))
    const totalDevices = draft.zones.reduce((s, z) => s + num(z.device_count), 0)
    const weightedRate = totalDevices > 0
      ? zoneBreakdown.reduce((s, z) => {
          const rate = num(z.zone.device_count) > 0 && num(z.zone.occupancy_hours) > 0
            ? z.perMonth / (num(z.zone.device_count) * num(z.zone.occupancy_hours) * 30)
            : 0
          return s + num(z.zone.device_count) * rate
        }, 0) / totalDevices
      : 0
    const percentShare = draft.opex
      .filter((o) => o.kind === 'percent_of_revenue')
      .reduce((s, o) => s + num(o.amount) / 100, 0)
    const denom = totalDevices * 30 * weightedRate * (1 - percentShare)
    const breakEvenHours = denom > 0 ? baseScenario.opexFixed / denom : null

    return {
      pcCapex,
      otherCapex,
      totalCapex,
      baseRevenue,
      baseScenario,
      paybackMonths,
      scenarioBest,
      scenarioExpected,
      scenarioWorst,
      cashFlow,
      zoneBreakdown,
      breakEvenHours,
      totalDevices,
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
          <p className="truncate text-xs text-muted-foreground">CAPEX · OPEX · сценарии · окупаемость</p>
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

      <Card className="border-white/10 bg-white/[0.02] p-4">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Название модели</Label>
        <Input
          className="mt-1 text-lg font-semibold"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="F16 Бостандык"
        />
      </Card>

      {/* ── ОСНОВНОЙ РЕЗУЛЬТАТ (Expected) ────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-pink-500/[0.03] p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-purple-300/80">Стартовые вложения</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-purple-200">{formatMoney(Math.round(calc.totalCapex))} ₸</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              ПК: {formatMoney(Math.round(calc.pcCapex))} · прочее: {formatMoney(Math.round(calc.otherCapex))}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-emerald-300/80">Выручка / мес</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-200">{formatMoney(Math.round(calc.baseScenario.revenue))} ₸</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-rose-300/80">Расходы / мес</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-rose-200">{formatMoney(Math.round(calc.baseScenario.opex))} ₸</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Фикс {formatMoney(Math.round(calc.baseScenario.opexFixed))} · % {formatMoney(Math.round(calc.baseScenario.opexPercent))}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-amber-300/80">Прибыль / мес</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${calc.baseScenario.profit > 0 ? 'text-amber-200' : 'text-rose-200'}`}>
              {formatMoney(Math.round(calc.baseScenario.profit))} ₸
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

        {calc.breakEvenHours != null ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Точка безубыточности: </span>
            нужно <span className="font-bold text-purple-200">{calc.breakEvenHours.toFixed(1)} ч/устройство в сутки</span>
            <span className="text-muted-foreground"> при текущих тарифах и OPEX, чтобы выйти в ноль.</span>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="mb-2 text-xs text-muted-foreground">
            Накопительный кэш (24 мес){draft.ramp_up.enabled ? ' с учётом постепенного выхода на нагрузку' : ''}
          </p>
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

      {/* ── СЦЕНАРИИ ──────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div>
          <h2 className="text-sm font-semibold">Сценарии</h2>
          <p className="text-[11px] text-muted-foreground">
            Множители выручки и OPEX к базе. Используйте для оценки рисков и upside.
          </p>
        </div>
        <div className="mt-3 overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-normal"></th>
                <th className="px-3 py-2 text-center font-normal text-emerald-300/80">Best</th>
                <th className="px-3 py-2 text-center font-normal text-amber-300/80">Expected</th>
                <th className="px-3 py-2 text-center font-normal text-rose-300/80">Worst</th>
              </tr>
            </thead>
            <tbody>
              {(['best','expected','worst'] as const).map((k) => null /* placeholder */)}
              <tr className="border-t border-white/[0.06]">
                <td className="px-3 py-2 text-muted-foreground">Множитель выручки</td>
                {(['best','expected','worst'] as const).map((k) => (
                  <td key={k} className="px-3 py-2">
                    <Input
                      className="h-8 mx-auto w-24 text-center"
                      inputMode="decimal"
                      value={String(draft.scenarios[k].revenue_mult)}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        scenarios: { ...d.scenarios, [k]: { ...d.scenarios[k], revenue_mult: num(e.target.value) } },
                      }))}
                    />
                  </td>
                ))}
              </tr>
              <tr className="border-t border-white/[0.06]">
                <td className="px-3 py-2 text-muted-foreground">Множитель OPEX (фикс)</td>
                {(['best','expected','worst'] as const).map((k) => (
                  <td key={k} className="px-3 py-2">
                    <Input
                      className="h-8 mx-auto w-24 text-center"
                      inputMode="decimal"
                      value={String(draft.scenarios[k].opex_mult)}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        scenarios: { ...d.scenarios, [k]: { ...d.scenarios[k], opex_mult: num(e.target.value) } },
                      }))}
                    />
                  </td>
                ))}
              </tr>
              <tr className="border-t border-white/[0.06] bg-white/[0.01]">
                <td className="px-3 py-2 text-muted-foreground">Выручка / мес</td>
                <td className="px-3 py-2 text-center tabular-nums text-emerald-200">{formatMoney(Math.round(calc.scenarioBest.revenue))}</td>
                <td className="px-3 py-2 text-center tabular-nums text-amber-200">{formatMoney(Math.round(calc.scenarioExpected.revenue))}</td>
                <td className="px-3 py-2 text-center tabular-nums text-rose-200">{formatMoney(Math.round(calc.scenarioWorst.revenue))}</td>
              </tr>
              <tr className="border-t border-white/[0.06]">
                <td className="px-3 py-2 text-muted-foreground">Расходы / мес</td>
                <td className="px-3 py-2 text-center tabular-nums">{formatMoney(Math.round(calc.scenarioBest.opex))}</td>
                <td className="px-3 py-2 text-center tabular-nums">{formatMoney(Math.round(calc.scenarioExpected.opex))}</td>
                <td className="px-3 py-2 text-center tabular-nums">{formatMoney(Math.round(calc.scenarioWorst.opex))}</td>
              </tr>
              <tr className="border-t border-white/[0.06] bg-white/[0.02]">
                <td className="px-3 py-2 font-semibold">Прибыль / мес</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-emerald-200">{formatMoney(Math.round(calc.scenarioBest.profit))}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-amber-200">{formatMoney(Math.round(calc.scenarioExpected.profit))}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-rose-200">{formatMoney(Math.round(calc.scenarioWorst.profit))}</td>
              </tr>
              <tr className="border-t border-white/[0.06]">
                <td className="px-3 py-2 font-semibold">Окупаемость</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-emerald-200">{calc.scenarioBest.payback != null ? `${calc.scenarioBest.payback.toFixed(1)} мес` : '—'}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-amber-200">{calc.scenarioExpected.payback != null ? `${calc.scenarioExpected.payback.toFixed(1)} мес` : '—'}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold text-rose-200">{calc.scenarioWorst.payback != null ? `${calc.scenarioWorst.payback.toFixed(1)} мес` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── RAMP-UP ───────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Постепенный выход на нагрузку (ramp-up)</h2>
            <p className="text-[11px] text-muted-foreground">
              Первые месяцы загрузка обычно ниже целевой — модель учитывает это в графике кэша.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-purple-500"
              checked={draft.ramp_up.enabled}
              onChange={(e) => setDraft((d) => ({ ...d, ramp_up: { ...d.ramp_up, enabled: e.target.checked } }))}
            />
            <span>{draft.ramp_up.enabled ? 'Включено' : 'Выключено'}</span>
          </label>
        </div>
        {draft.ramp_up.enabled ? (
          <div className="mt-3 space-y-2">
            <Label className="text-[10px] text-muted-foreground">Доля целевой загрузки по месяцам (1.0 = 100%)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {draft.ramp_up.months.map((m, idx) => (
                <div key={idx} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Мес {idx + 1}</Label>
                  <Input
                    inputMode="decimal"
                    value={String(m)}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      ramp_up: { ...d.ramp_up, months: d.ramp_up.months.map((x, i) => i === idx ? num(e.target.value) : x) },
                    }))}
                  />
                </div>
              ))}
              <div className="flex items-end gap-1">
                <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, ramp_up: { ...d.ramp_up, months: [...d.ramp_up.months, 1] } }))}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                {draft.ramp_up.months.length > 1 ? (
                  <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, ramp_up: { ...d.ramp_up, months: d.ramp_up.months.slice(0, -1) } }))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              После последнего значения дальше идёт оно же. Пример: 0.3 / 0.5 / 0.75 / 1.0 → первый месяц 30%, со 4-го выход на 100%.
            </p>
          </div>
        ) : null}
      </Card>

      {/* ── КОНФИГУРАЦИИ ПК ────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-purple-300" />
            <div>
              <h2 className="text-sm font-semibold">Конфигурации ПК</h2>
              <p className="text-[11px] text-muted-foreground">Раскладка по комплектующим (процессор, видеокарта, ОЗУ, монитор и т.д.). Цена 1 ПК = сумма компонентов.</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, pc_configs: [...d.pc_configs, { id: uid(), name: 'Новая конфигурация', quantity: 1, components: [] }] }))}>
            <Plus className="mr-1 h-4 w-4" /> Конфигурация
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          {draft.pc_configs.map((c) => {
            const unit = pcUnitPrice(c)
            const total = unit * num(c.quantity)
            return (
              <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
                <div className="grid grid-cols-[minmax(0,1.4fr)_120px_180px_180px_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Название</Label>
                    <Input value={c.name} placeholder="Премиум ПК" onChange={(e) => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Кол-во</Label>
                    <Input inputMode="numeric" value={String(c.quantity)} onChange={(e) => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, quantity: num(e.target.value) } : x) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Цена 1 ПК</Label>
                    <div className="grid h-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm tabular-nums">{formatMoney(Math.round(unit))} ₸</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Подитог</Label>
                    <div className="grid h-10 place-items-center rounded-lg border border-purple-500/30 bg-purple-500/[0.06] text-sm font-semibold tabular-nums text-purple-200">{formatMoney(Math.round(total))} ₸</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.filter((x) => x.id !== c.id) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Компоненты */}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted-foreground">Компоненты</Label>
                    <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, components: [...x.components, { id: uid(), name: '', price: 0 }] } : x) }))}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Компонент
                    </Button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {c.components.map((cp) => (
                      <div key={cp.id} className="flex items-center gap-1.5">
                        <Input
                          className="h-8 flex-1"
                          value={cp.name}
                          placeholder="например: Видеокарта RTX 4070"
                          onChange={(e) => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, components: x.components.map((y) => y.id === cp.id ? { ...y, name: e.target.value } : y) } : x) }))}
                        />
                        <Input
                          className="h-8 w-28 text-right tabular-nums"
                          inputMode="decimal"
                          value={String(cp.price)}
                          placeholder="0"
                          onChange={(e) => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, components: x.components.map((y) => y.id === cp.id ? { ...y, price: num(e.target.value) } : y) } : x) }))}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDraft((d) => ({ ...d, pc_configs: d.pc_configs.map((x) => x.id === c.id ? { ...x, components: x.components.filter((y) => y.id !== cp.id) } : x) }))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-end rounded-xl border border-purple-500/30 bg-purple-500/[0.06] px-4 py-2.5">
          <span className="mr-2 text-sm text-muted-foreground">Итого ПК:</span>
          <span className="text-lg font-bold tabular-nums text-purple-200">{formatMoney(Math.round(calc.pcCapex))} ₸</span>
        </div>
      </Card>

      {/* ── ПРОЧИЕ ВЛОЖЕНИЯ ──────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Прочие стартовые вложения</h2>
            <p className="text-[11px] text-muted-foreground">Мебель, периферия, ремонт, депозит, оборудование зала.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, capex: [...d.capex, { id: uid(), name: '', unit_price: 0, quantity: 1 }] }))}>
            <Plus className="mr-1 h-4 w-4" /> Строка
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.capex.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1.6fr)_130px_90px_140px_auto] gap-2 items-end">
              <div className="space-y-1">
                {idx === 0 ? <Label className="text-[10px]">Статья</Label> : null}
                <Input value={r.name} placeholder="Геймерское кресло" onChange={(e) => setDraft((d) => ({ ...d, capex: d.capex.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} />
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
          <span className="mr-2 text-sm text-muted-foreground">Итого прочее:</span>
          <span className="text-lg font-bold tabular-nums text-purple-200">{formatMoney(Math.round(calc.otherCapex))} ₸</span>
        </div>
      </Card>

      {/* ── ТАРИФЫ ──────────────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Тарифы</h2>
            <p className="text-[11px] text-muted-foreground">₸/час = цена ÷ (оплаченные + бонусные часы).</p>
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
            <p className="text-[11px] text-muted-foreground">Сколько устройств, средняя загрузка (ч/сутки), доли тарифов в зоне.</p>
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
            <p className="text-[11px] text-muted-foreground">Фиксированная сумма или процент от выручки.</p>
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
                    ? formatMoney(Math.round((num(r.amount) / 100) * calc.baseScenario.revenue))
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
          <span className="text-lg font-bold tabular-nums text-rose-200">{formatMoney(Math.round(calc.baseScenario.opex))} ₸</span>
        </div>
      </Card>

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
          1) Собираешь конфигурации ПК по компонентам (процессор, GPU, ОЗУ, монитор и т.д.) — цена 1 ПК считается сама.
          2) Прочие вложения (кресла, столы, ремонт, депозит). 3) Тарифы и зоны с долями. 4) Ежемесячные расходы.
        </p>
        <p className="mt-1.5">
          <span className="text-foreground/80">Сценарии</span> — оценка риска: «что если выручка −30%, OPEX +15%». Показывает окупаемость во всех трёх вариантах.
        </p>
        <p className="mt-1.5">
          <span className="text-foreground/80">Ramp-up</span> — постепенный выход на нагрузку. Реалистичная картина: первые месяцы редко 100% сразу.
        </p>
        <p className="mt-1.5">
          <span className="text-foreground/80">Точка безубыточности</span> — сколько часов на устройство в день нужно, чтобы покрыть OPEX (понимаешь, реалистична ли модель).
        </p>
      </Card>
    </div>
  )
}
