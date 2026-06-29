'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Save,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  FlaskConical,
  Sun,
  Moon,
  Info,
} from 'lucide-react'

type ShiftType = 'day' | 'night'

type PointRule = {
  id: string
  company_id: string | null
  scope: string
  event: string
  name: string
  description: string | null
  priority: number
  is_active: boolean
  stop_processing: boolean
  conditions: Array<{ field: string; operator: string; value?: unknown }>
  actions: Array<{ type: string; amount?: number; value?: string }>
}

type CompanyRow = { id: string; name: string; code: string | null }

type Parsed = {
  shiftType: ShiftType | null
  turnoverGte: number | null
  turnoverLt: number | null
  basePerShift: number | null
  seniorOperatorBonus: number | null
  seniorCashierBonus: number | null
  thresholdBonus: number | null
}

function parseRule(rule: PointRule): Parsed {
  const parsed: Parsed = {
    shiftType: null,
    turnoverGte: null,
    turnoverLt: null,
    basePerShift: null,
    seniorOperatorBonus: null,
    seniorCashierBonus: null,
    thresholdBonus: null,
  }
  for (const c of rule.conditions || []) {
    if (c.field === 'shift.type' && c.operator === 'eq') {
      parsed.shiftType = c.value === 'night' ? 'night' : c.value === 'day' ? 'day' : null
    }
    if (c.field === 'shift.turnover' && c.operator === 'gte') parsed.turnoverGte = Number(c.value) || 0
    if (c.field === 'shift.turnover' && c.operator === 'lt') parsed.turnoverLt = Number(c.value) || 0
  }
  for (const a of rule.actions || []) {
    if (a.type === 'set_base_per_shift') parsed.basePerShift = Number(a.amount) || 0
    if (a.type === 'set_senior_operator_bonus') parsed.seniorOperatorBonus = Number(a.amount) || 0
    if (a.type === 'set_senior_cashier_bonus') parsed.seniorCashierBonus = Number(a.amount) || 0
    if (a.type === 'set_threshold_bonus') parsed.thresholdBonus = Number(a.amount) || 0
  }
  return parsed
}

const formatMoney = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

type FormState = {
  id: string | null
  company_id: string | null
  shift_type: ShiftType
  name: string
  priority: number
  is_active: boolean
  stop_processing: boolean
  turnover_gte: string
  turnover_lt: string
  base_per_shift: string
  senior_operator_bonus: string
  senior_cashier_bonus: string
  threshold_bonus: string
}

const EMPTY_FORM: FormState = {
  id: null,
  company_id: null,
  shift_type: 'day',
  name: '',
  priority: 100,
  is_active: true,
  stop_processing: true,
  turnover_gte: '',
  turnover_lt: '',
  base_per_shift: '',
  senior_operator_bonus: '',
  senior_cashier_bonus: '',
  threshold_bonus: '',
}

function toNumOrNull(v: string): number | null {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && v.trim() !== '' ? n : null
}

function buildPayload(form: FormState) {
  const conditions: Array<{ field: string; operator: string; value?: unknown }> = []
  conditions.push({ field: 'shift.type', operator: 'eq', value: form.shift_type })
  const gte = toNumOrNull(form.turnover_gte)
  const lt = toNumOrNull(form.turnover_lt)
  if (gte != null) conditions.push({ field: 'shift.turnover', operator: 'gte', value: gte })
  if (lt != null) conditions.push({ field: 'shift.turnover', operator: 'lt', value: lt })

  const actions: Array<{ type: string; amount?: number }> = []
  const base = toNumOrNull(form.base_per_shift)
  const so = toNumOrNull(form.senior_operator_bonus)
  const sc = toNumOrNull(form.senior_cashier_bonus)
  const tb = toNumOrNull(form.threshold_bonus)
  if (base != null) actions.push({ type: 'set_base_per_shift', amount: base })
  if (so != null) actions.push({ type: 'set_senior_operator_bonus', amount: so })
  if (sc != null) actions.push({ type: 'set_senior_cashier_bonus', amount: sc })
  if (tb != null) actions.push({ type: 'set_threshold_bonus', amount: tb })

  return {
    company_id: form.company_id || null,
    scope: 'salary',
    event: 'salary.shift.computed',
    name: form.name.trim() || `${form.shift_type === 'day' ? 'День' : 'Ночь'} · вариант`,
    priority: form.priority,
    is_active: form.is_active,
    stop_processing: form.stop_processing,
    conditions,
    actions,
  }
}

export function SalaryVariantsTab({ companies }: { companies: CompanyRow[] }) {
  const [rules, setRules] = useState<PointRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM })
  const [showForm, setShowForm] = useState(false)
  const [testTurnover, setTestTurnover] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  const companyMap = useMemo(() => {
    const m = new Map<string, CompanyRow>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/point-rules', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка загрузки')
      const rows = (json.data || []) as PointRule[]
      setRules(rows.filter((r) => r.scope === 'salary' && r.event === 'salary.shift.computed'))
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, company_id: companies[0]?.id || null })
    setShowForm(true)
    setTestResult(null)
  }

  const openEdit = (rule: PointRule) => {
    const p = parseRule(rule)
    setForm({
      id: rule.id,
      company_id: rule.company_id,
      shift_type: p.shiftType || 'day',
      name: rule.name,
      priority: rule.priority,
      is_active: rule.is_active,
      stop_processing: rule.stop_processing,
      turnover_gte: p.turnoverGte != null ? String(p.turnoverGte) : '',
      turnover_lt: p.turnoverLt != null ? String(p.turnoverLt) : '',
      base_per_shift: p.basePerShift != null ? String(p.basePerShift) : '',
      senior_operator_bonus: p.seniorOperatorBonus != null ? String(p.seniorOperatorBonus) : '',
      senior_cashier_bonus: p.seniorCashierBonus != null ? String(p.seniorCashierBonus) : '',
      threshold_bonus: p.thresholdBonus != null ? String(p.thresholdBonus) : '',
    })
    setShowForm(true)
    setTestResult(null)
  }

  const handleSave = async () => {
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      const payload = buildPayload(form)
      if (payload.actions.length === 0) throw new Error('Укажите хотя бы одно действие (оклад или бонус)')
      const body = form.id
        ? { action: 'updateRule', ruleId: form.id, payload }
        : { action: 'createRule', payload }
      const res = await fetch('/api/admin/point-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка сохранения')
      setSuccess(form.id ? 'Вариант обновлён' : 'Вариант создан')
      setShowForm(false)
      await load()
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить вариант?')) return
    setError(null)
    try {
      const res = await fetch('/api/admin/point-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteRule', ruleId: id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка удаления')
      setSuccess('Вариант удалён')
      await load()
    } catch (e: any) {
      setError(e.message || 'Ошибка удаления')
    }
  }

  const handleTest = async () => {
    setError(null)
    setTestResult(null)
    const turnover = toNumOrNull(testTurnover)
    if (turnover == null) {
      setError('Укажите выручку для теста')
      return
    }
    try {
      const res = await fetch('/api/admin/point-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'testRules',
          scope: 'salary',
          event: 'salary.shift.computed',
          company_id: form.company_id,
          context: { shift: { type: form.shift_type, turnover, company_id: form.company_id } },
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка теста')
      const { rulesCount, matchedRules, effects } = json.data || {}
      if (!matchedRules?.length) {
        setTestResult(`Проверено правил: ${rulesCount}. Ни одно не сработало.`)
        return
      }
      const lines = [
        `Проверено правил: ${rulesCount}`,
        `Сработали: ${matchedRules.map((m: any) => m.name).join(', ')}`,
        ...(effects || []).map((e: any) => {
          if (e.type === 'set_base_per_shift') return `→ оклад = ${formatMoney(e.amount)}`
          if (e.type === 'set_senior_operator_bonus') return `→ бонус ст. оператора = ${formatMoney(e.amount)}`
          if (e.type === 'set_senior_cashier_bonus') return `→ бонус ст. кассира = ${formatMoney(e.amount)}`
          if (e.type === 'set_threshold_bonus') return `→ доп. бонус = ${formatMoney(e.amount)}`
          return `→ ${e.type}: ${formatMoney(e.amount)}`
        }),
      ]
      setTestResult(lines.join('\n'))
    } catch (e: any) {
      setError(e.message || 'Ошибка теста')
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, PointRule[]>()
    for (const r of rules) {
      const p = parseRule(r)
      const key = `${r.company_id || 'global'}__${p.shiftType || 'any'}`
      const list = map.get(key) || []
      list.push(r)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.priority - b.priority)
    return map
  }, [rules])

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-slate-200 dark:border-white/5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="text-foreground font-medium">Варианты оклада по выручке</p>
            <p className="text-slate-500 dark:text-gray-400">
              Несколько правил для одной точки и смены с разными диапазонами выручки. Напр.: «если выручка ≥ 500к → оклад 8000», «если &lt; 500к → оклад 5000». Выполняются по приоритету. <b>Stop</b> останавливает проверку следующих.
            </p>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-3 border border-red-500/30 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        </Card>
      )}
      {success && (
        <Card className="p-3 border border-emerald-500/30 bg-emerald-500/10">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-sm">
            <CheckCircle2 className="w-4 h-4" /> {success}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-slate-500 dark:text-gray-400">
          Всего вариантов: <span className="text-foreground font-semibold">{rules.length}</span>
        </div>
        <Button
          size="sm"
          onClick={openCreate}
          className="gap-2 rounded-xl bg-violet-600 text-white hover:bg-violet-500"
        >
          <Plus className="h-4 w-4" /> Добавить вариант
        </Button>
      </div>

      {showForm && (
        <Card className="p-5 bg-white dark:bg-gray-900/60 border-border space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Компания</label>
              <select
                value={form.company_id || ''}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value || null }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
              >
                <option value="">Все точки (глобально)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Смена</label>
              <select
                value={form.shift_type}
                onChange={(e) => setForm((f) => ({ ...f, shift_type: e.target.value as ShiftType }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
              >
                <option value="day">Дневная</option>
                <option value="night">Ночная</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Название (для истории)</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Напр.: День <500к → 5000"
                className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Условия по выручке</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Выручка ≥ (оставить пустым если не важно)</label>
                <input
                  type="number"
                  value={form.turnover_gte}
                  onChange={(e) => setForm((f) => ({ ...f, turnover_gte: e.target.value }))}
                  placeholder="500000"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Выручка &lt; (оставить пустым если не важно)</label>
                <input
                  type="number"
                  value={form.turnover_lt}
                  onChange={(e) => setForm((f) => ({ ...f, turnover_lt: e.target.value }))}
                  placeholder="1000000"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Что переопределить</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Оклад за смену</label>
                <input
                  type="number"
                  value={form.base_per_shift}
                  onChange={(e) => setForm((f) => ({ ...f, base_per_shift: e.target.value }))}
                  placeholder="8000"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Доп. бонус (к порогам)</label>
                <input
                  type="number"
                  value={form.threshold_bonus}
                  onChange={(e) => setForm((f) => ({ ...f, threshold_bonus: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Бонус старшего оператора</label>
                <input
                  type="number"
                  value={form.senior_operator_bonus}
                  onChange={(e) => setForm((f) => ({ ...f, senior_operator_bonus: e.target.value }))}
                  placeholder=""
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Бонус старшего кассира</label>
                <input
                  type="number"
                  value={form.senior_cashier_bonus}
                  onChange={(e) => setForm((f) => ({ ...f, senior_cashier_bonus: e.target.value }))}
                  placeholder=""
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">Приоритет (меньше = раньше)</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 100 }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Активно
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.stop_processing}
                onChange={(e) => setForm((f) => ({ ...f, stop_processing: e.target.checked }))}
              />
              Stop (не идти дальше)
            </label>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-4">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Проверить сценарий</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={testTurnover}
                onChange={(e) => setTestTurnover(e.target.value)}
                placeholder="Введите выручку для симуляции"
                className="flex-1 px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm text-foreground"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleTest()}
                className="gap-2 rounded-xl border-border bg-surface-muted hover:bg-surface-hover"
              >
                <FlaskConical className="h-4 w-4" /> Проверить
              </Button>
            </div>
            {testResult && (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                {testResult}
              </pre>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-white/5 pt-4">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="rounded-xl border-border">
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving}
              className="gap-2 rounded-xl bg-violet-600 text-white hover:bg-violet-500"
            >
              <Save className="h-4 w-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </Card>
      )}

      {loading && <div className="text-center text-gray-500 py-8">Загрузка...</div>}

      {!loading && rules.length === 0 && !showForm && (
        <Card className="p-8 text-center border-dashed border-border bg-slate-50 dark:bg-white/[0.02]">
          <p className="text-slate-500 dark:text-gray-400 text-sm">
            Вариантов пока нет. Базовые правила работают без тиров по выручке. Нажмите «Добавить вариант» чтобы создать гибкое правило.
          </p>
        </Card>
      )}

      {!loading &&
        Array.from(grouped.entries()).map(([key, list]) => {
          const first = list[0]
          const p = parseRule(first)
          const companyName = first.company_id
            ? companyMap.get(first.company_id)?.name || 'Точка'
            : 'Все точки'
          const ShiftIcon = p.shiftType === 'night' ? Moon : Sun
          return (
            <Card key={key} className="p-4 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-2 mb-3">
                <ShiftIcon className={`w-4 h-4 ${p.shiftType === 'night' ? 'text-indigo-400' : 'text-amber-400'}`} />
                <span className="text-sm font-medium text-foreground">{companyName}</span>
                <span className="text-xs text-gray-500">·</span>
                <span className="text-xs text-slate-500 dark:text-gray-400">
                  {p.shiftType === 'night' ? 'Ночная' : p.shiftType === 'day' ? 'Дневная' : 'Любая'} смена
                </span>
                <span className="ml-auto text-xs text-gray-500">{list.length} вариант(ов)</span>
              </div>
              <div className="space-y-2">
                {list.map((rule) => {
                  const rp = parseRule(rule)
                  const range =
                    rp.turnoverGte != null && rp.turnoverLt != null
                      ? `${formatMoney(rp.turnoverGte)} ≤ выручка < ${formatMoney(rp.turnoverLt)}`
                      : rp.turnoverGte != null
                        ? `выручка ≥ ${formatMoney(rp.turnoverGte)}`
                        : rp.turnoverLt != null
                          ? `выручка < ${formatMoney(rp.turnoverLt)}`
                          : 'любая выручка'
                  return (
                    <div
                      key={rule.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                        rule.is_active ? 'border-border bg-surface-muted' : 'border-slate-100 dark:border-white/5 bg-white dark:bg-white/[0.01] opacity-60'
                      }`}
                    >
                      <span className="text-xs font-mono text-gray-500 w-10">#{rule.priority}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{rule.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {range}
                          {rp.basePerShift != null && <> · оклад <b className="text-violet-600 dark:text-violet-300">{formatMoney(rp.basePerShift)}</b></>}
                          {rp.thresholdBonus != null && <> · +бонус {formatMoney(rp.thresholdBonus)}</>}
                          {rule.stop_processing && <> · <span className="text-amber-400">stop</span></>}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => openEdit(rule)}
                        className="h-7 text-violet-400 hover:text-violet-300"
                      >
                        Изменить
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleDelete(rule.id)}
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
    </div>
  )
}
