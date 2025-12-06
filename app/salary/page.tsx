'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  Settings2,
  AlertTriangle,
  Check,
  Plus,
} from 'lucide-react'
import Link from 'next/link'

type Shift = 'day' | 'night'

type Company = {
  id: string
  name: string
  code: string | null
}

type RuleRow = {
  id: number | null
  company_code: string
  shift_type: Shift
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}

const formatMoney = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

export default function SalaryRulesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRowIndex, setSavingRowIndex] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [compRes, rulesRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase
          .from('operator_salary_rules')
          .select(
            'id,company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus,is_active',
          )
          .order('company_code', { ascending: true })
          .order('shift_type', { ascending: true }),
      ])

      if (compRes.error || rulesRes.error) {
        console.error('salary rules load error', {
          compErr: compRes.error,
          rulesErr: rulesRes.error,
        })
        setError('Ошибка загрузки правил зарплаты')
        setLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setRules(
        (rulesRes.data || []).map((r) => ({
          ...r,
          id: r.id as number,
        })) as RuleRow[],
      )
      setLoading(false)
    }

    load()
  }, [])

  const companyCodes = useMemo(
    () =>
      Array.from(
        new Set(
          companies
            .map((c) => c.code)
            .filter((c): c is string => Boolean(c)),
        ),
      ),
    [companies],
  )

  const companyLabel = (code: string) => {
    const company = companies.find((c) => c.code === code)
    return company ? `${company.name} (${code})` : code
  }

  const updateField = <K extends keyof RuleRow>(
    index: number,
    field: K,
    value: RuleRow[K],
  ) => {
    setRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    )
  }

  const parseNumber = (value: string) => {
    if (value === '') return null
    const n = Number(value.replace(',', '.').replace(/\s/g, ''))
    return Number.isFinite(n) ? n : null
  }

  const handleSaveRow = async (index: number) => {
    const row = rules[index]
    if (!row.company_code) {
      setError('Укажите компанию (code) для правила')
      return
    }
    if (!row.shift_type) {
      setError('Укажите смену (day/night) для правила')
      return
    }
    setError(null)
    setSavingRowIndex(index)

    const payload = {
      company_code: row.company_code,
      shift_type: row.shift_type,
      base_per_shift: row.base_per_shift ?? 0,
      threshold1_turnover: row.threshold1_turnover,
      threshold1_bonus: row.threshold1_bonus,
      threshold2_turnover: row.threshold2_turnover,
      threshold2_bonus: row.threshold2_bonus,
      is_active: row.is_active,
    }

    try {
      if (row.id) {
        const { error } = await supabase
          .from('operator_salary_rules')
          .update(payload)
          .eq('id', row.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('operator_salary_rules')
          .insert([payload])
          .select()
          .single()
        if (error) throw error
        setRules((prev) =>
          prev.map((r, i) =>
            i === index ? { ...r, id: data.id as number } : r,
          ),
        )
      }
    } catch (err: any) {
      console.error(err)
      setError(
        err.message || 'Ошибка при сохранении правила зарплаты',
      )
    } finally {
      setSavingRowIndex(null)
    }
  }

  const handleAddRow = () => {
    setAdding(true)
    setRules((prev) => [
      ...prev,
      {
        id: null,
        company_code: companyCodes[0] || 'arena',
        shift_type: 'day',
        base_per_shift: 8000,
        threshold1_turnover: 120_000,
        threshold1_bonus: 2000,
        threshold2_turnover: 160_000,
        threshold2_bonus: 2000,
        is_active: true,
      },
    ])
    setAdding(false)
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
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
                  <Settings2 className="w-6 h-6 text-emerald-400" />
                  Правила расчёта зарплаты
                </h1>
                <p className="text-xs text-muted-foreground">
                  Таблица operator_salary_rules — одна строка = одна комбинация
                  (компания + смена)
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-xs"
              onClick={handleAddRow}
              disabled={adding}
            >
              <Plus className="w-4 h-4" />
              Добавить правило
            </Button>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/40 bg-red-950/30 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          {/* Подсказка по логике */}
          <Card className="p-4 border-border bg-card/80 text-xs text-muted-foreground space-y-1.5">
            <p>
              <span className="font-semibold text-foreground">
                base_per_shift
              </span>{' '}
              — оклад за смену.
            </p>
            <p>
              Если{' '}
              <span className="font-mono">
                turnover ≥ threshold1_turnover
              </span>
              , добавляем{' '}
              <span className="font-mono">threshold1_bonus</span>.
            </p>
            <p>
              Если{' '}
              <span className="font-mono">
                turnover ≥ threshold2_turnover
              </span>
              , добавляем{' '}
              <span className="font-mono">threshold2_bonus</span> сверху.
            </p>
            <p>
              Итого зарплата за смену ={' '}
              <span className="font-mono">
                base_per_shift + bonus1 + bonus2
              </span>
              .
            </p>
          </Card>

          {/* Таблица правил */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">Компания</th>
                  <th className="py-2 px-2 text-center">Смена</th>
                  <th className="py-2 px-2 text-right">
                    Оклад / смена
                    <br />
                    <span className="text-[10px] font-normal">
                      base_per_shift
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right">
                    Порог&nbsp;1
                    <br />
                    <span className="text-[10px] font-normal">
                      threshold1_turnover
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right">
                    Бонус&nbsp;1
                    <br />
                    <span className="text-[10px] font-normal">
                      threshold1_bonus
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right">
                    Порог&nbsp;2
                    <br />
                    <span className="text-[10px] font-normal">
                      threshold2_turnover
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right">
                    Бонус&nbsp;2
                    <br />
                    <span className="text-[10px] font-normal">
                      threshold2_bonus
                    </span>
                  </th>
                  <th className="py-2 px-2 text-center">Активно</th>
                  <th className="py-2 px-2 text-right">Сохранить</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && rules.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Правил пока нет. Нажми «Добавить правило».
                    </td>
                  </tr>
                )}

                {!loading &&
                  rules.map((r, index) => (
                    <tr
                      key={r.id ?? `new-${index}`}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      {/* Компания */}
                      <td className="py-1.5 px-2">
                        <select
                          value={r.company_code}
                          onChange={(e) =>
                            updateField(index, 'company_code', e.target.value)
                          }
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs"
                        >
                          {companyCodes.length === 0 && (
                            <option value={r.company_code}>
                              {r.company_code || 'code'}
                            </option>
                          )}
                          {companyCodes.map((code) => (
                            <option key={code} value={code}>
                              {companyLabel(code)}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Смена */}
                      <td className="py-1.5 px-2 text-center">
                        <select
                          value={r.shift_type}
                          onChange={(e) =>
                            updateField(
                              index,
                              'shift_type',
                              e.target.value as Shift,
                            )
                          }
                          className="bg-input border border-border rounded-md px-2 py-1 text-xs"
                        >
                          <option value="day">День</option>
                          <option value="night">Ночь</option>
                        </select>
                      </td>

                      {/* base_per_shift */}
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs text-right"
                          value={r.base_per_shift ?? ''}
                          onChange={(e) =>
                            updateField(
                              index,
                              'base_per_shift',
                              parseNumber(e.target.value),
                            )
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {formatMoney(r.base_per_shift)}
                        </div>
                      </td>

                      {/* threshold1_turnover */}
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs text-right"
                          value={r.threshold1_turnover ?? ''}
                          onChange={(e) =>
                            updateField(
                              index,
                              'threshold1_turnover',
                              parseNumber(e.target.value),
                            )
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {formatMoney(r.threshold1_turnover)}
                        </div>
                      </td>

                      {/* threshold1_bonus */}
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs text-right"
                          value={r.threshold1_bonus ?? ''}
                          onChange={(e) =>
                            updateField(
                              index,
                              'threshold1_bonus',
                              parseNumber(e.target.value),
                            )
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {formatMoney(r.threshold1_bonus)}
                        </div>
                      </td>

                      {/* threshold2_turnover */}
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs text-right"
                          value={r.threshold2_turnover ?? ''}
                          onChange={(e) =>
                            updateField(
                              index,
                              'threshold2_turnover',
                              parseNumber(e.target.value),
                            )
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {formatMoney(r.threshold2_turnover)}
                        </div>
                      </td>

                      {/* threshold2_bonus */}
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs text-right"
                          value={r.threshold2_bonus ?? ''}
                          onChange={(e) =>
                            updateField(
                              index,
                              'threshold2_bonus',
                              parseNumber(e.target.value),
                            )
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {formatMoney(r.threshold2_bonus)}
                        </div>
                      </td>

                      {/* is_active */}
                      <td className="py-1.5 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.is_active}
                          onChange={(e) =>
                            updateField(index, 'is_active', e.target.checked)
                          }
                        />
                      </td>

                      {/* save */}
                      <td className="py-1.5 px-2 text-right">
                        <Button
                          size="xs"
                          className="h-7 px-3 text-[11px] gap-1"
                          onClick={() => handleSaveRow(index)}
                          disabled={savingRowIndex === index}
                        >
                          <Check className="w-3 h-3" />
                          {savingRowIndex === index ? 'Сохранение...' : 'Сохранить'}
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
