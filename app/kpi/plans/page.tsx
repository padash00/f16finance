'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { Save, Wand2, AlertTriangle, CheckCircle2 } from 'lucide-react'

type KpiRow = {
  plan_key: string
  month_start: string // YYYY-MM-DD
  entity_type: 'collective' | 'operator' | 'role'
  company_code: string | null
  operator_id: string | null
  role_code: string | null
  turnover_target_month: number
  turnover_target_week: number
  shifts_target_month: number
  shifts_target_week: number
  is_locked: boolean
  meta: any
}

type IncomeNameRow = {
  operator_id: string | null
  operator_name: string | null
  date: string
}

const ruMoney = (n: number) =>
  (n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const weeksInMonth = (monthStartISO: string) => {
  const d = new Date(monthStartISO + 'T00:00:00')
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const days = Math.round((+next - +d) / (1000 * 60 * 60 * 24))
  return days / 7
}

const monthStartMinus = (monthStartISO: string, minusMonths: number) => {
  const d = new Date(monthStartISO + 'T00:00:00')
  const x = new Date(d.getFullYear(), d.getMonth() - minusMonths, 1)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function MoneyInput({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled?: boolean
  onChange: (n: number) => void
}) {
  const [txt, setTxt] = useState(() => String(value ?? 0))

  useEffect(() => {
    setTxt(String(value ?? 0))
  }, [value])

  const pretty = useMemo(() => {
    const n = Number(String(txt).replace(/\s/g, ''))
    if (!Number.isFinite(n)) return ''
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
  }, [txt])

  return (
    <div className="space-y-1">
      <input
        disabled={disabled}
        value={pretty}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '')
          setTxt(raw)
          const n = Number(raw || '0')
          onChange(n)
        }}
        className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full disabled:opacity-60"
        inputMode="numeric"
      />
      <div className="text-[10px] text-muted-foreground text-right">
        {ruMoney(Number(String(txt || '0')))}
      </div>
    </div>
  )
}

export default function KpiPlansPage() {
  const [monthStart, setMonthStart] = useState('2026-01-01')
  const [growthPct, setGrowthPct] = useState(5)

  const [rows, setRows] = useState<KpiRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [dirty, setDirty] = useState<Record<string, Partial<KpiRow>>>({})
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [operatorNames, setOperatorNames] = useState<Record<string, string>>({})

  const w = useMemo(() => weeksInMonth(monthStart), [monthStart])

  const mergedRows = useMemo(() => {
    return rows.map((r) => ({ ...r, ...(dirty[r.plan_key] || {}) }))
  }, [rows, dirty])

  const summary = useMemo(() => {
    const collect = mergedRows.filter((r) => r.entity_type === 'collective')
    const totalMonth = collect.reduce(
      (s, r) => s + (r.turnover_target_month || 0),
      0,
    )
    const totalWeek = Math.round(totalMonth / (w || 1))
    const shifts = mergedRows
      .filter((r) => r.entity_type === 'operator')
      .reduce((s, r) => s + (r.shifts_target_month || 0), 0)

    return { totalMonth, totalWeek, shifts, rows: mergedRows.length }
  }, [mergedRows, w])

  const setField = (plan_key: string, patch: Partial<KpiRow>) => {
    setDirty((prev) => ({
      ...prev,
      [plan_key]: { ...(prev[plan_key] || {}), ...patch },
    }))
  }

  const loadOperatorNamesFromIncomes = async (operatorIds: string[]) => {
    if (operatorIds.length === 0) {
      setOperatorNames({})
      return
    }

    // берём 2 месяца ДО выбранного месяца (как ты и хотел)
    const fromDate = monthStartMinus(monthStart, 2)

    // вытаскиваем последние имена (по дате DESC)
    const { data, error } = await supabase
      .from('incomes')
      .select('operator_id, operator_name, date')
      .in('operator_id', operatorIds)
      .gte('date', fromDate)
      .lt('date', monthStart)
      .order('date', { ascending: false })
      .limit(5000)

    if (error) {
      console.error('loadOperatorNamesFromIncomes error', error)
      // не роняем страницу, просто без имён
      return
    }

    const map: Record<string, string> = {}
    for (const r of (data || []) as IncomeNameRow[]) {
      if (!r.operator_id) continue
      if (map[r.operator_id]) continue // уже взяли самое свежее
      const name = (r.operator_name || '').trim()
      if (name) map[r.operator_id] = name
    }
    setOperatorNames(map)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    setOk(null)
    setDirty({})

    const { data, error } = await supabase
      .from('kpi_plans')
      .select(
        'plan_key, month_start, entity_type, company_code, operator_id, role_code, turnover_target_month, turnover_target_week, shifts_target_month, shifts_target_week, is_locked, meta',
      )
      .eq('month_start', monthStart)
      .order('entity_type', { ascending: true })
      .order('company_code', { ascending: true })
      .order('role_code', { ascending: true })

    if (error) {
      console.error('load kpi error', error)
      setError('Ошибка загрузки KPI планов')
      setLoading(false)
      return
    }

    const list = (data || []) as KpiRow[]
    setRows(list)

    const ids = Array.from(
      new Set(
        list
          .filter((r) => r.entity_type === 'operator' && r.operator_id)
          .map((r) => r.operator_id!) as string[],
      ),
    )
    await loadOperatorNamesFromIncomes(ids)

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart])

  const saveAll = async () => {
    setError(null)
    setOk(null)
    setSaving(true)

    const updates = Object.entries(dirty).map(([plan_key, patch]) => ({
      plan_key,
      ...patch,
    }))

    if (updates.length === 0) {
      setSaving(false)
      setOk('Нечего сохранять')
      return
    }

    // weekly считаем от monthly (единая логика)
    const normalized = updates.map((u) => {
      const month = Number(u.turnover_target_month ?? 0)
      const shiftsMonth = Number(u.shifts_target_month ?? 0)
      const weekTurn = Math.round(month / (w || 1))
      const weekShifts = Number((shiftsMonth / (w || 1)).toFixed(2))

      return {
        plan_key: u.plan_key,
        turnover_target_month: month,
        turnover_target_week: weekTurn,
        shifts_target_month: shiftsMonth,
        shifts_target_week: weekShifts,
        is_locked: u.is_locked ?? undefined,
      }
    })

    const { error } = await supabase
      .from('kpi_plans')
      .upsert(normalized, { onConflict: 'plan_key' })

    setSaving(false)

    if (error) {
      console.error('save kpi error', error)
      setError('Ошибка сохранения KPI')
      return
    }

    setOk('Сохранено')
    await load()
  }

  const generate = async () => {
    setError(null)
    setOk(null)
    setGenerating(true)

    const { error } = await supabase.rpc('rpc_generate_kpi_plans', {
      p_month_start: monthStart,
      p_growth: growthPct / 100,
    })

    setGenerating(false)

    if (error) {
      console.error('generate kpi error', error)
      setError('Ошибка генерации KPI (проверь RPC и таблицы incomes/companies)')
      return
    }

    setOk('План сгенерирован')
    await load()
  }

  const label = (r: KpiRow) => {
    if (r.entity_type === 'collective') return 'Коллектив'
    if (r.entity_type === 'operator') return 'Оператор'
    return 'Роль'
  }

  const companyTitle = (code: string | null) => {
    if (code === 'arena') return 'F16 Arena'
    if (code === 'ramen') return 'F16 Ramen'
    if (code === 'extra') return 'F16 Extra'
    return code || '—'
  }

  const whoTitle = (r: KpiRow) => {
    if (r.entity_type === 'role') {
      if (r.role_code === 'supervisor') return 'Руководитель операторов'
      if (r.role_code === 'marketing') return 'Маркетолог'
      return r.role_code || '—'
    }

    if (r.entity_type === 'operator') {
      const id = r.operator_id || ''
      const name = id ? operatorNames[id] : ''
      if (name) return name
      // fallback
      return id ? `Оператор ${id.slice(0, 8)}` : '—'
    }

    return 'Коллектив'
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">
                KPI планы (коллектив + личные)
              </h1>
              <p className="text-xs text-muted-foreground">
                Генерация берёт <b>2 предыдущих месяца</b> и строит цели на
                выбранный месяц. Имена операторов берём из{' '}
                <code>incomes.operator_name</code>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Месяц:</span>
                <input
                  type="date"
                  value={monthStart}
                  onChange={(e) => setMonthStart(e.target.value)}
                  className="bg-input border border-border rounded px-2 py-1 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Рост %:</span>
                <input
                  type="number"
                  value={growthPct}
                  onChange={(e) => setGrowthPct(Number(e.target.value || 0))}
                  className="bg-input border border-border rounded px-2 py-1 text-xs w-[90px]"
                />
              </div>

              <Button
                size="sm"
                className="gap-2"
                onClick={generate}
                disabled={generating}
              >
                <Wand2 className="w-4 h-4" />
                {generating ? 'Генерирую…' : 'Сгенерировать план'}
              </Button>

              <Button
                size="sm"
                className="gap-2"
                onClick={saveAll}
                disabled={saving}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Сохраняю…' : `Сохранить (${Object.keys(dirty).length})`}
              </Button>
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/50 bg-red-950/40 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </Card>
          )}

          {ok && (
            <Card className="p-3 border border-emerald-500/40 bg-emerald-950/30 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {ok}
            </Card>
          )}

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4 border-border bg-card/70">
              <div className="text-xs text-muted-foreground">
                Коллективный план (месяц)
              </div>
              <div className="text-2xl font-bold">{ruMoney(summary.totalMonth)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Неделя: {ruMoney(summary.totalWeek)}
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/70">
              <div className="text-xs text-muted-foreground">Смены (операторы)</div>
              <div className="text-2xl font-bold">{summary.shifts}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Неделя: {Number((summary.shifts / (w || 1)).toFixed(2))}
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/70">
              <div className="text-xs text-muted-foreground">Строк планов</div>
              <div className="text-2xl font-bold">{summary.rows}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Недели в месяце: {Number(w.toFixed(2))}
              </div>
            </Card>
          </div>

          {/* Table */}
          <Card className="p-0 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Тип</th>
                  <th className="px-3 py-2 text-left">Компания</th>
                  <th className="px-3 py-2 text-left">Кто</th>
                  <th className="px-3 py-2 text-right">План месяц</th>
                  <th className="px-3 py-2 text-right">План неделя</th>
                  <th className="px-3 py-2 text-right">Смены мес</th>
                  <th className="px-3 py-2 text-right">Смены нед</th>
                  <th className="px-3 py-2 text-center">LOCK</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}

                {!loading && mergedRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Планов нет. Жми «Сгенерировать план».
                    </td>
                  </tr>
                )}

                {!loading &&
                  mergedRows.map((r) => (
                    <tr key={r.plan_key} className="border-t border-border/40 hover:bg-white/5">
                      <td className="px-3 py-2">{label(r)}</td>

                      <td className="px-3 py-2">{companyTitle(r.company_code)}</td>

                      <td className="px-3 py-2">
                        <div className="font-medium">{whoTitle(r)}</div>
                        {r.entity_type === 'operator' && r.operator_id && (
                          <div className="text-[10px] text-muted-foreground">
                            id: {r.operator_id}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <MoneyInput
                          value={r.turnover_target_month || 0}
                          disabled={r.is_locked}
                          onChange={(n) => setField(r.plan_key, { turnover_target_month: n })}
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <div className="text-xs font-semibold">{ruMoney(r.turnover_target_week || 0)}</div>
                        <div className="text-[10px] text-muted-foreground">авто из “месяц”</div>
                      </td>

                      <td className="px-3 py-2 text-right">
                        <input
                          disabled={r.is_locked}
                          type="number"
                          value={r.shifts_target_month ?? 0}
                          onChange={(e) =>
                            setField(r.plan_key, {
                              shifts_target_month: Number(e.target.value || 0),
                            })
                          }
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-[110px] disabled:opacity-60"
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <div className="text-xs font-semibold">
                          {Number((r.shifts_target_month / (w || 1)).toFixed(2))}
                        </div>
                        <div className="text-[10px] text-muted-foreground">авто из “смены мес”</div>
                      </td>

                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.is_locked}
                          onChange={(e) => setField(r.plan_key, { is_locked: e.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4 border-border bg-card/70 text-xs text-muted-foreground leading-relaxed">
            <b>LOCK</b> — если включишь, генератор больше не перезапишет строку.
          </Card>
        </div>
      </main>
    </div>
  )
}
