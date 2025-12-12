'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  Plus,
  Save,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'

type ShiftType = 'day' | 'night'

type RuleRow = {
  id: number
  company_code: string
  shift_type: ShiftType
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}

type CompanyRow = {
  id: string
  name: string
  code: string | null
}

const formatMoney = (v: number | null) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const parseIntSafe = (v: string | number | null): number | null => {
  if (v === null || v === undefined) return null
  const s = typeof v === 'number' ? String(v) : String(v)
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return null
  return Math.round(num)
}

const ruleKey = (company_code: string, shift_type: ShiftType) =>
  `${company_code}__${shift_type}`

export default function SalaryRulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // "грязные" строки
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())

  const loadAll = async () => {
    setLoading(true)
    setError(null)

    const [rulesRes, compRes] = await Promise.all([
      supabase
        .from('operator_salary_rules')
        .select(
          'id, company_code, shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus, is_active',
        )
        .order('company_code', { ascending: true })
        .order('shift_type', { ascending: true }),
      supabase.from('companies').select('id,name,code').order('name'),
    ])

    if (rulesRes.error || compRes.error) {
      console.error('loadAll error', rulesRes.error, compRes.error)
      setError('Ошибка загрузки данных')
      setLoading(false)
      return
    }

    setRules((rulesRes.data || []) as RuleRow[])
    setCompanies((compRes.data || []) as CompanyRow[])
    setDirtyIds(new Set())
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const companyOptions = useMemo(() => {
    // берём только те, у кого есть code
    const list = (companies || []).filter((c) => c.code)
    // на всякий случай: если вдруг companies пустой — покажем минимум
    if (list.length === 0) {
      return [
        { id: 'x1', name: 'F16 Arena', code: 'arena' },
        { id: 'x2', name: 'F16 Ramen', code: 'ramen' },
        { id: 'x3', name: 'F16 Extra', code: 'extra' },
      ] as CompanyRow[]
    }
    return list
  }, [companies])

  const existingKeys = useMemo(() => {
    const set = new Set<string>()
    for (const r of rules) set.add(ruleKey(r.company_code, r.shift_type))
    return set
  }, [rules])

  const markDirty = (id: number) => {
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const handleFieldChange = (
    id: number,
    field: keyof RuleRow,
    value: string | boolean,
  ) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? ({ ...r, [field]: value } as RuleRow) : r)),
    )
    markDirty(id)
    setSuccessMsg(null)
  }

  const buildPayload = (row: RuleRow) => ({
    company_code: row.company_code.trim(),
    shift_type: row.shift_type,
    base_per_shift: parseIntSafe(row.base_per_shift ?? 0),
    threshold1_turnover: parseIntSafe(row.threshold1_turnover),
    threshold1_bonus: parseIntSafe(row.threshold1_bonus),
    threshold2_turnover: parseIntSafe(row.threshold2_turnover),
    threshold2_bonus: parseIntSafe(row.threshold2_bonus),
    is_active: row.is_active,
  })

  const handleSaveRow = async (row: RuleRow) => {
    setError(null)
    setSuccessMsg(null)
    setSavingId(row.id)

    try {
      const payload = buildPayload(row)

      // UI защита от дубликатов
      const key = ruleKey(payload.company_code, payload.shift_type)
      const same = rules.filter(
        (x) =>
          ruleKey(x.company_code, x.shift_type) === key && x.id !== row.id,
      )
      if (same.length > 0) {
        throw new Error(
          `Дубликат: уже есть правило для "${payload.company_code}" + "${payload.shift_type}"`,
        )
      }

      const { error } = await supabase
        .from('operator_salary_rules')
        .update(payload)
        .eq('id', row.id)

      if (error) throw error

      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })

      setSuccessMsg('Правило сохранено')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка сохранения правила')
    } finally {
      setSavingId(null)
    }
  }

  const handleSaveAll = async () => {
    setError(null)
    setSuccessMsg(null)
    setSavingAll(true)

    try {
      const dirty = rules.filter((r) => dirtyIds.has(r.id))
      if (dirty.length === 0) {
        setSuccessMsg('Нечего сохранять')
        return
      }

      // Пробежим и сохраним по одному, чтобы ловить конкретную ошибку
      for (const row of dirty) {
        const payload = buildPayload(row)
        const key = ruleKey(payload.company_code, payload.shift_type)
        const same = rules.filter(
          (x) =>
            ruleKey(x.company_code, x.shift_type) === key && x.id !== row.id,
        )
        if (same.length > 0) {
          throw new Error(
            `Дубликат: уже есть правило для "${payload.company_code}" + "${payload.shift_type}"`,
          )
        }

        const { error } = await supabase
          .from('operator_salary_rules')
          .update(payload)
          .eq('id', row.id)

        if (error) throw error
      }

      setSuccessMsg('Все изменения сохранены')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSavingAll(false)
    }
  }

  const handleAddRule = async () => {
    setError(null)
    setSuccessMsg(null)
    setAdding(true)

    try {
      // добавляем дефолт для первой компании (чтобы не спрашивать пользователя)
      const defaultCompany = (companyOptions[0]?.code || 'arena') as string

      // если уже есть правило arena/day — создадим arena/night (и наоборот)
      const dayKey = ruleKey(defaultCompany, 'day')
      const nightKey = ruleKey(defaultCompany, 'night')
      const shift_type: ShiftType = !existingKeys.has(dayKey)
        ? 'day'
        : !existingKeys.has(nightKey)
          ? 'night'
          : 'day'

      if (existingKeys.has(ruleKey(defaultCompany, shift_type))) {
        throw new Error(
          `Уже есть правила и для day и для night у "${defaultCompany}". Выбери компанию в строке и создай для неё.`,
        )
      }

      const { data, error } = await supabase
        .from('operator_salary_rules')
        .insert([
          {
            company_code: defaultCompany,
            shift_type,
            base_per_shift: 8000,
            threshold1_turnover: 130000,
            threshold1_bonus: 2000,
            threshold2_turnover: 160000,
            threshold2_bonus: 2000,
            is_active: true,
          },
        ])
        .select()
        .single()

      if (error) throw error

      setRules((prev) => [...prev, data as RuleRow])
      setSuccessMsg('Новое правило добавлено')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка при создании правила')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/salary">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Правила расчёта зарплаты</h1>
                <p className="text-xs text-muted-foreground">
                  Таблица <code>operator_salary_rules</code> — одна строка = компания + смена.
                  Оклад + бонусы по выручке.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveAll}
                disabled={savingAll || dirtyIds.size === 0}
                className="gap-2"
              >
                <Save className="w-4 h-4" />
                {savingAll ? 'Сохраняю…' : `Сохранить всё (${dirtyIds.size})`}
              </Button>

              <Button
                size="sm"
                className="gap-2"
                onClick={handleAddRule}
                disabled={adding}
              >
                <Plus className="w-4 h-4" />
                {adding ? 'Создаём…' : 'Добавить правило'}
              </Button>
            </div>
          </div>

          {/* Подсказка */}
          <Card className="p-4 border-border bg-card/70 text-xs leading-relaxed space-y-1">
            <p>
              <b>base_per_shift</b> — оклад за смену.
            </p>
            <p>
              Если <b>turnover ≥ threshold1_turnover</b>, добавляем <b>threshold1_bonus</b>.
            </p>
            <p>
              Если <b>turnover ≥ threshold2_turnover</b>, добавляем <b>threshold2_bonus</b> сверху.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Итог за смену = <b>base_per_shift + bonus1 + bonus2</b>.
            </p>
          </Card>

          {error && (
            <Card className="p-3 border border-red-500/50 bg-red-950/40 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </Card>
          )}

          {successMsg && (
            <Card className="p-3 border border-emerald-500/40 bg-emerald-950/30 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {successMsg}
            </Card>
          )}

          {/* Таблица правил */}
          <Card className="p-0 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Компания (code)</th>
                  <th className="px-3 py-2 text-left">Смена</th>
                  <th className="px-3 py-2 text-right">Оклад / смена</th>
                  <th className="px-3 py-2 text-right">Порог 1</th>
                  <th className="px-3 py-2 text-right">Бонус 1</th>
                  <th className="px-3 py-2 text-right">Порог 2</th>
                  <th className="px-3 py-2 text-right">Бонус 2</th>
                  <th className="px-3 py-2 text-center">Активно</th>
                  <th className="px-3 py-2 text-right">Сохранить</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      Загрузка правил…
                    </td>
                  </tr>
                )}

                {!loading && rules.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      Правил ещё нет. Добавь первое через кнопку «Добавить правило».
                    </td>
                  </tr>
                )}

                {!loading &&
                  rules.map((r) => {
                    const isDirty = dirtyIds.has(r.id)
                    const dup =
                      rules.filter(
                        (x) =>
                          x.id !== r.id &&
                          ruleKey(x.company_code, x.shift_type) === ruleKey(r.company_code, r.shift_type),
                      ).length > 0

                    return (
                      <tr key={r.id} className="border-t border-border/40 hover:bg-white/5">
                        {/* company_code */}
                        <td className="px-3 py-2">
                          <select
                            value={r.company_code}
                            onChange={(e) => handleFieldChange(r.id, 'company_code', e.target.value)}
                            className="bg-input border border-border rounded px-2 py-1 text-xs w-full"
                          >
                            {companyOptions.map((c) => (
                              <option key={c.id} value={c.code || ''}>
                                {c.name} ({c.code})
                              </option>
                            ))}
                            {!companyOptions.some((c) => c.code === r.company_code) && (
                              <option value={r.company_code}>Другое: {r.company_code}</option>
                            )}
                          </select>
                          {dup && (
                            <div className="text-[10px] text-red-300 mt-1">
                              Дубликат company+смена — исправь, иначе не сохранится
                            </div>
                          )}
                        </td>

                        {/* shift_type */}
                        <td className="px-3 py-2">
                          <select
                            value={r.shift_type}
                            onChange={(e) =>
                              handleFieldChange(r.id, 'shift_type', e.target.value as ShiftType)
                            }
                            className="bg-input border border-border rounded px-2 py-1 text-xs w-full"
                          >
                            <option value="day">День</option>
                            <option value="night">Ночь</option>
                          </select>
                          {isDirty && (
                            <div className="text-[10px] text-amber-300 mt-1">
                              Есть изменения
                            </div>
                          )}
                        </td>

                        {/* base_per_shift */}
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                            value={r.base_per_shift ?? ''}
                            onChange={(e) => handleFieldChange(r.id, 'base_per_shift', e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {formatMoney(r.base_per_shift)}
                          </div>
                        </td>

                        {/* th1 / b1 */}
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                            value={r.threshold1_turnover ?? ''}
                            onChange={(e) => handleFieldChange(r.id, 'threshold1_turnover', e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {formatMoney(r.threshold1_turnover)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                            value={r.threshold1_bonus ?? ''}
                            onChange={(e) => handleFieldChange(r.id, 'threshold1_bonus', e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {formatMoney(r.threshold1_bonus)}
                          </div>
                        </td>

                        {/* th2 / b2 */}
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                            value={r.threshold2_turnover ?? ''}
                            onChange={(e) => handleFieldChange(r.id, 'threshold2_turnover', e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {formatMoney(r.threshold2_turnover)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                            value={r.threshold2_bonus ?? ''}
                            onChange={(e) => handleFieldChange(r.id, 'threshold2_bonus', e.target.value)}
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {formatMoney(r.threshold2_bonus)}
                          </div>
                        </td>

                        {/* is_active */}
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={r.is_active}
                            onChange={(e) => handleFieldChange(r.id, 'is_active', e.target.checked)}
                          />
                        </td>

                        {/* save button */}
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="xs"
                            className="gap-1"
                            disabled={savingId === r.id || dup}
                            onClick={() => handleSaveRow(r)}
                          >
                            <Save className="w-3 h-3" />
                            {savingId === r.id ? 'Сохраняю…' : 'Сохранить'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
