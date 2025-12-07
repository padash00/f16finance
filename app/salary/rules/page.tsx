'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  AlertTriangle,
  Save,
  Plus,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'

type SalaryRuleRow = {
  id: number
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}

const COMPANY_OPTIONS = [
  { code: 'arena', label: 'F16 Arena' },
  { code: 'ramen', label: 'F16 Ramen' },
  { code: 'extra', label: 'F16 Extra' },
]

const formatMoney = (v: number | null) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const parseNumber = (value: string) => {
  if (!value) return null
  const num = Number(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(num)) return null
  return Math.round(num)
}

export default function SalaryRulesPage() {
  const [rows, setRows] = useState<SalaryRuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const loadRules = async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('operator_salary_rules')
      .select(
        'id,company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus,is_active',
      )
      .order('company_code', { ascending: true })
      .order('shift_type', { ascending: true })

    if (error) {
      console.error(error)
      setError('Не удалось загрузить правила зарплаты')
      setLoading(false)
      return
    }

    setRows((data || []) as SalaryRuleRow[])
    setLoading(false)
  }

  useEffect(() => {
    loadRules()
  }, [])

  const handleFieldChange = (
    id: number,
    field: keyof SalaryRuleRow,
    value: string | boolean,
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]:
                field === 'is_active'
                  ? Boolean(value)
                  : field === 'company_code' || field === 'shift_type'
                  ? value
                  : parseNumber(String(value)),
            }
          : r,
      ),
    )
  }

  const handleSaveRow = async (row: SalaryRuleRow) => {
    setError(null)
    setSavingId(row.id)

    try {
      const payload = {
        company_code: row.company_code,
        shift_type: row.shift_type,
        base_per_shift: row.base_per_shift,
        threshold1_turnover: row.threshold1_turnover,
        threshold1_bonus: row.threshold1_bonus,
        threshold2_turnover: row.threshold2_turnover,
        threshold2_bonus: row.threshold2_bonus,
        is_active: row.is_active,
      }

      const { error } = await supabase
        .from('operator_salary_rules')
        .update(payload)
        .eq('id', row.id)

      if (error) throw error
    } catch (err) {
      console.error(err)
      setError('Ошибка при сохранении правила')
    } finally {
      setSavingId(null)
    }
  }

  const handleAddRule = async () => {
    setError(null)
    setAdding(true)
    try {
      const { data, error } = await supabase
        .from('operator_salary_rules')
        .insert([
          {
            company_code: 'arena',
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

      if (error) throw error
      setRows((prev) => [...prev, data as SalaryRuleRow])
    } catch (err) {
      console.error(err)
      setError('Не удалось добавить новое правило')
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
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  Правила расчёта зарплаты
                </h1>
                <p className="text-xs text-muted-foreground">
                  Одна строка = одна комбинация (компания + смена).
                  Оклад за смену + авто-бонусы по выручке.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={loadRules}
                disabled={loading}
                className="gap-1 text-xs"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить
              </Button>
              <Button
                size="sm"
                onClick={handleAddRule}
                disabled={adding}
                className="gap-1 text-xs"
              >
                <Plus className="w-4 h-4" />
                Добавить правило
              </Button>
            </div>
          </div>

          <Card className="p-4 border-border bg-card/70 text-xs leading-relaxed">
            <p>
              <strong>base_per_shift</strong> — оклад за смену.
            </p>
            <p>
              Если <code>turnover ≥ threshold1_turnover</code> → добавляем{' '}
              <code>threshold1_bonus</code>.
            </p>
            <p>
              Если <code>turnover ≥ threshold2_turnover</code> → добавляем{' '}
              <code>threshold2_bonus</code> сверху.
            </p>
            <p className="mt-1">
              Итого зарплата за смену = base_per_shift + bonus1 + bonus2.
            </p>
          </Card>

          {error && (
            <Card className="p-3 border border-red-500/40 bg-red-950/30 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          <Card className="p-0 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-black/40 text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Компания</th>
                  <th className="px-3 py-2 text-left">Смена</th>
                  <th className="px-3 py-2 text-right">
                    Оклад / смена<br />
                    <span className="font-normal text-[9px]">
                      base_per_shift
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Порог 1<br />
                    <span className="font-normal text-[9px]">
                      threshold1_turnover
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Бонус 1<br />
                    <span className="font-normal text-[9px]">
                      threshold1_bonus
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Порог 2<br />
                    <span className="font-normal text-[9px]">
                      threshold2_turnover
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Бонус 2<br />
                    <span className="font-normal text-[9px]">
                      threshold2_bonus
                    </span>
                  </th>
                  <th className="px-3 py-2 text-center">Активно</th>
                  <th className="px-3 py-2 text-center">Сохранить</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground"
                    >
                      Загрузка правил...
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground"
                    >
                      Правила не заданы.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      {/* Компания */}
                      <td className="px-3 py-2">
                        <select
                          value={row.company_code}
                          onChange={(e) =>
                            handleFieldChange(
                              row.id,
                              'company_code',
                              e.target.value,
                            )
                          }
                          className="bg-input border border-border rounded px-2 py-1 text-xs"
                        >
                          {COMPANY_OPTIONS.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Смена */}
                      <td className="px-3 py-2">
                        <select
                          value={row.shift_type}
                          onChange={(e) =>
                            handleFieldChange(
                              row.id,
                              'shift_type',
                              e.target.value as 'day' | 'night',
                            )
                          }
                          className="bg-input border border-border rounded px-2 py-1 text-xs"
                        >
                          <option value="day">День</option>
                          <option value="night">Ночь</option>
                        </select>
                      </td>

                      {/* Оклад / смена */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-24 bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          defaultValue={row.base_per_shift}
                          onBlur={(e) =>
                            handleFieldChange(
                              row.id,
                              'base_per_shift',
                              e.target.value,
                            )
                          }
                        />
                        <div className="text-[9px] text-muted-foreground">
                          {formatMoney(row.base_per_shift)} ₸
                        </div>
                      </td>

                      {/* Порог 1 */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-24 bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          defaultValue={row.threshold1_turnover ?? ''}
                          onBlur={(e) =>
                            handleFieldChange(
                              row.id,
                              'threshold1_turnover',
                              e.target.value,
                            )
                          }
                        />
                        <div className="text-[9px] text-muted-foreground">
                          {formatMoney(row.threshold1_turnover)} ₸
                        </div>
                      </td>

                      {/* Бонус 1 */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-20 bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          defaultValue={row.threshold1_bonus ?? ''}
                          onBlur={(e) =>
                            handleFieldChange(
                              row.id,
                              'threshold1_bonus',
                              e.target.value,
                            )
                          }
                        />
                        <div className="text-[9px] text-muted-foreground">
                          {formatMoney(row.threshold1_bonus)} ₸
                        </div>
                      </td>

                      {/* Порог 2 */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-24 bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          defaultValue={row.threshold2_turnover ?? ''}
                          onBlur={(e) =>
                            handleFieldChange(
                              row.id,
                              'threshold2_turnover',
                              e.target.value,
                            )
                          }
                        />
                        <div className="text-[9px] text-muted-foreground">
                          {formatMoney(row.threshold2_turnover)} ₸
                        </div>
                      </td>

                      {/* Бонус 2 */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-20 bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          defaultValue={row.threshold2_bonus ?? ''}
                          onBlur={(e) =>
                            handleFieldChange(
                              row.id,
                              'threshold2_bonus',
                              e.target.value,
                            )
                          }
                        />
                        <div className="text-[9px] text-muted-foreground">
                          {formatMoney(row.threshold2_bonus)} ₸
                        </div>
                      </td>

                      {/* Активно */}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.is_active}
                          onChange={(e) =>
                            handleFieldChange(
                              row.id,
                              'is_active',
                              e.target.checked,
                            )
                          }
                        />
                      </td>

                      {/* Сохранить */}
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={savingId === row.id}
                          onClick={() => handleSaveRow(row)}
                          className="gap-1 text-[11px]"
                        >
                          {savingId === row.id ? (
                            <>
                              <Save className="w-3 h-3 animate-pulse" />
                              Сохранение...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Сохранить
                            </>
                          )}
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
