'use client'

import { useEffect, useState } from 'react'
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

type RuleRow = {
  id: number
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}

const formatMoney = (v: number | null) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const parseIntSafe = (v: string | number | null): number | null => {
  if (v === null || v === undefined) return null
  const num = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, ''))
  return Number.isFinite(num) ? num : null
}

export default function SalaryRulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadRules = async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('operator_salary_rules') // <-- правильная таблица
      .select(
        'id, company_code, shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus, is_active',
      )
      .order('company_code', { ascending: true })
      .order('shift_type', { ascending: true })

    if (error) {
      console.error('loadRules error', error)
      setError('Ошибка загрузки правил')
      setLoading(false)
      return
    }

    setRules((data || []) as RuleRow[])
    setLoading(false)
  }

  useEffect(() => {
    loadRules()
  }, [])

  const handleFieldChange = (
    id: number,
    field: keyof RuleRow,
    value: string | boolean,
  ) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, [field]: value } as RuleRow : r,
      ),
    )
  }

  const handleSaveRow = async (row: RuleRow) => {
    setError(null)
    setSuccessMsg(null)
    setSavingId(row.id)

    const payload = {
      company_code: row.company_code.trim(),
      shift_type: row.shift_type,
      base_per_shift: parseIntSafe(row.base_per_shift ?? 0),
      threshold1_turnover: parseIntSafe(row.threshold1_turnover),
      threshold1_bonus: parseIntSafe(row.threshold1_bonus),
      threshold2_turnover: parseIntSafe(row.threshold2_turnover),
      threshold2_bonus: parseIntSafe(row.threshold2_bonus),
      is_active: row.is_active,
    }

    const { error } = await supabase
      .from('operator_salary_rules')
      .update(payload)
      .eq('id', row.id)

    setSavingId(null)

    if (error) {
      console.error('save rule error', error)
      setError('Ошибка сохранения правила')
      return
    }

    setSuccessMsg('Правило сохранено')
    // перезагрузим из БД, чтобы не было рассинхрона
    await loadRules()
  }

  const handleAddRule = async () => {
    setError(null)
    setSuccessMsg(null)
    setAdding(true)

    // по умолчанию — Arena / день
    const { data, error } = await supabase
      .from('operator_salary_rules')
      .insert([
        {
          company_code: 'arena', // у тебя должны совпадать с companies.code
          shift_type: 'day',
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

    setAdding(false)

    if (error) {
      console.error('add rule error', error)
      setError('Ошибка при создании правила')
      return
    }

    setRules((prev) => [...prev, data as RuleRow])
    setSuccessMsg('Новое правило добавлено')
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
                <h1 className="text-2xl font-bold">
                  Правила расчёта зарплаты
                </h1>
                <p className="text-xs text-muted-foreground">
                  Таблица <code>operator_salary_rules</code> — одна строка = одна
                  комбинация (компания + смена).
                  Оклад + бонусы по выручке.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              className="gap-2"
              onClick={handleAddRule}
              disabled={adding}
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Создаём...' : 'Добавить правило'}
            </Button>
          </div>

          {/* Подсказка */}
          <Card className="p-4 border-border bg-card/70 text-xs leading-relaxed space-y-1">
            <p>
              <b>base_per_shift</b> — оклад за смену.
            </p>
            <p>
              Если <b>turnover ≥ threshold1_turnover</b>, добавляем{' '}
              <b>threshold1_bonus</b>.
            </p>
            <p>
              Если <b>turnover ≥ threshold2_turnover</b>, добавляем{' '}
              <b>threshold2_bonus</b> сверху.
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
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground"
                    >
                      Загрузка правил…
                    </td>
                  </tr>
                )}

                {!loading && rules.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground"
                    >
                      Правил ещё нет. Добавь первое через кнопку «Добавить
                      правило».
                    </td>
                  </tr>
                )}

                {!loading &&
                  rules.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      {/* company_code */}
                      <td className="px-3 py-2">
                        <select
                          value={r.company_code}
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'company_code',
                              e.target.value,
                            )
                          }
                          className="bg-input border border-border rounded px-2 py-1 text-xs w-full"
                        >
                          <option value="arena">F16 Arena (arena)</option>
                          <option value="ramen">F16 Ramen (ramen)</option>
                          <option value="extra">F16 Extra (extra)</option>
                          <option value={r.company_code}>
                            Другое: {r.company_code}
                          </option>
                        </select>
                      </td>

                      {/* shift_type */}
                      <td className="px-3 py-2">
                        <select
                          value={r.shift_type}
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'shift_type',
                              e.target.value as 'day' | 'night',
                            )
                          }
                          className="bg-input border border-border rounded px-2 py-1 text-xs w-full"
                        >
                          <option value="day">День</option>
                          <option value="night">Ночь</option>
                        </select>
                      </td>

                      {/* base_per_shift */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-full"
                          value={r.base_per_shift ?? ''}
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'base_per_shift',
                              e.target.value,
                            )
                          }
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
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'threshold1_turnover',
                              e.target.value,
                            )
                          }
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
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'threshold1_bonus',
                              e.target.value,
                            )
                          }
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
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'threshold2_turnover',
                              e.target.value,
                            )
                          }
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
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'threshold2_bonus',
                              e.target.value,
                            )
                          }
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
                          onChange={(e) =>
                            handleFieldChange(
                              r.id,
                              'is_active',
                              e.target.checked,
                            )
                          }
                        />
                      </td>

                      {/* save button */}
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="xs"
                          className="gap-1"
                          disabled={savingId === r.id}
                          onClick={() => handleSaveRow(r)}
                        >
                          <Save className="w-3 h-3" />
                          {savingId === r.id ? 'Сохраняю…' : 'Сохранить'}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
