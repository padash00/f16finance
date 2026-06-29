'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Sun, Moon, Sparkles, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { formatMoney } from '@/lib/core/format'

type OperatorOption = {
  id: string
  name: string
  short_name?: string | null
}

type PreviewShift = {
  id: string
  date: string
  shift: 'day' | 'night'
  companyId: string
  companyCode: string | null
  companyName: string | null
  totalIncome: number
  baseSalary: number
  seniorityBonus: number
  seniorityPercent: number
  autoBonus: number
  roleBonus: number
  salary: number
  matchedRules: Array<{ id: string; name: string }>
}

type PreviewResponse = {
  ok: boolean
  data?: {
    operator: { id: string; name: string; short_name: string | null }
    weekStart: string
    weekEnd: string
    shiftRulesCount: number
    summary: {
      grossAmount: number
      bonusAmount: number
      fineAmount: number
      debtAmount: number
      advanceAmount: number
      netAmount: number
      autoBonusTotal: number
      seniorityBonusTotal: number
      shiftsCount: number
    }
    shifts: PreviewShift[]
    companyAllocations: Array<{
      companyId: string
      companyName: string | null
      accruedAmount: number
      bonusAmount: number
      fineAmount: number
      debtAmount: number
      advanceAmount: number
      netAmount: number
    }>
  }
  error?: string
}

function mondayISO(d: Date) {
  const day = d.getDay()
  const diff = (day + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - diff)
  return monday.toISOString().slice(0, 10)
}

function formatDate(iso: string) {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  } catch {
    return iso
  }
}

export function SalaryPreviewTab() {
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [operatorId, setOperatorId] = useState<string>('')
  const [weekStart, setWeekStart] = useState<string>(() => mondayISO(new Date()))
  const [loading, setLoading] = useState(false)
  const [loadingOperators, setLoadingOperators] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PreviewResponse['data'] | null>(null)

  useEffect(() => {
    const loadOps = async () => {
      setLoadingOperators(true)
      try {
        const res = await fetch('/api/admin/operators?active_only=true', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        const list: OperatorOption[] = (json?.data || []).map((o: any) => ({
          id: String(o.id),
          name: String(o.name || o.short_name || 'Оператор'),
          short_name: o.short_name || null,
        }))
        setOperators(list)
        if (list.length > 0 && !operatorId) setOperatorId(list[0].id)
      } catch {
        /* ignore */
      } finally {
        setLoadingOperators(false)
      }
    }
    loadOps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runPreview = async () => {
    if (!operatorId || !weekStart) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/salary/preview?operator_id=${encodeURIComponent(operatorId)}&week_start=${encodeURIComponent(weekStart)}`,
        { cache: 'no-store' },
      )
      const json = (await res.json().catch(() => null)) as PreviewResponse | null
      if (!res.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось рассчитать')
      }
      setData(json.data)
    } catch (err: any) {
      setError(err?.message || 'Не удалось рассчитать')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const shiftsByDate = useMemo(() => {
    if (!data) return []
    return [...data.shifts].sort(
      (a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift),
    )
  }, [data])

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-gray-900/40 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_160px]">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">
              Оператор
            </label>
            <select
              value={operatorId}
              onChange={(event) => setOperatorId(event.target.value)}
              disabled={loadingOperators}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-gray-950 dark:text-white"
            >
              {loadingOperators ? (
                <option>Загрузка...</option>
              ) : operators.length === 0 ? (
                <option>Нет операторов</option>
              ) : (
                operators.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">
              Начало недели (пн)
            </label>
            <DatePicker
              value={weekStart}
              onChange={setWeekStart}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={runPreview} disabled={loading || !operatorId} className="w-full">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Рассчитать
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}
      </Card>

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <Card className="border-cyan-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Смен</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{data.summary.shiftsCount}</p>
            </Card>
            <Card className="border-emerald-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Начислено</p>
              <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{formatMoney(data.summary.grossAmount)}</p>
            </Card>
            <Card className="border-violet-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Авто-бонусы</p>
              <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{formatMoney(data.summary.autoBonusTotal)}</p>
            </Card>
            <Card className="border-cyan-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Стаж</p>
              <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{formatMoney(data.summary.seniorityBonusTotal || 0)}</p>
            </Card>
            <Card className="border-amber-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Штрафы</p>
              <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{formatMoney(data.summary.fineAmount)}</p>
            </Card>
            <Card className="border-rose-500/20 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">Долги+Аванс</p>
              <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                {formatMoney(data.summary.debtAmount + data.summary.advanceAmount)}
              </p>
            </Card>
            <Card className="border-green-500/30 bg-white dark:bg-gray-900/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-gray-400">К выплате</p>
              <p className="mt-2 text-2xl font-semibold text-green-600 dark:text-green-300">
                {formatMoney(data.summary.netAmount)}
              </p>
            </Card>
          </div>

          <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-gray-900/40 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-gray-300">
              Разбор по сменам ({data.weekStart} — {data.weekEnd})
            </h3>
            {data.shiftRulesCount === 0 ? (
              <p className="mt-2 text-xs text-gray-500">
                Нет активных правил типа <code>salary.shift.computed</code> — используются базовые правила из справочника.
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Активных правил-вариантов: {data.shiftRulesCount}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {shiftsByDate.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 p-6 text-center text-sm text-gray-500">
                  За эту неделю нет смен у оператора.
                </div>
              ) : (
                shiftsByDate.map((shift) => {
                  const ShiftIcon = shift.shift === 'day' ? Sun : Moon
                  return (
                    <div
                      key={shift.id}
                      className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-gray-950/60 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <ShiftIcon
                              className={`h-4 w-4 ${shift.shift === 'day' ? 'text-amber-400' : 'text-indigo-400'}`}
                            />
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {formatDate(shift.date)}, {shift.shift === 'day' ? 'дневная' : 'ночная'}
                            </span>
                            {shift.companyName ? (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                                {shift.companyName}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                            Выручка: <span className="text-slate-700 dark:text-gray-200">{formatMoney(shift.totalIncome)}</span>
                          </p>
                          {shift.matchedRules.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {shift.matchedRules.map((rule) => (
                                <span
                                  key={rule.id}
                                  className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-200"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {rule.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="grid min-w-[240px] gap-1 text-xs md:text-right">
                          <div className="flex items-center justify-between gap-6 text-slate-700 dark:text-gray-300">
                            <span className="text-gray-500">Оклад</span>
                            <span>{formatMoney(shift.baseSalary)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-6 text-slate-700 dark:text-gray-300">
                            <span className="text-gray-500">Авто-бонус</span>
                            <span>{formatMoney(shift.autoBonus)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-6 text-slate-700 dark:text-gray-300">
                            <span className="text-gray-500">
                              Стаж{shift.seniorityPercent ? ` ${shift.seniorityPercent}%` : ''}
                            </span>
                            <span>{formatMoney(shift.seniorityBonus || 0)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-6 text-slate-700 dark:text-gray-300">
                            <span className="text-gray-500">Роль</span>
                            <span>{formatMoney(shift.roleBonus)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-6 border-t border-slate-200 dark:border-white/10 pt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            <span>Итого</span>
                            <span>{formatMoney(shift.salary)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>

          {data.companyAllocations.length > 0 ? (
            <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-gray-900/40 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-gray-300">
                Распределение по точкам
              </h3>
              <div className="mt-4 space-y-2">
                {data.companyAllocations.map((alloc) => (
                  <div
                    key={alloc.companyId}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-gray-950/60 p-3 md:grid-cols-[1.5fr_repeat(6,auto)]"
                  >
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {alloc.companyName || '—'}
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Начислено</div>
                      <div className="font-semibold text-slate-700 dark:text-gray-200">{formatMoney(alloc.accruedAmount)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Бонусы</div>
                      <div className="font-semibold text-slate-700 dark:text-gray-200">{formatMoney(alloc.bonusAmount)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Штрафы</div>
                      <div className="font-semibold text-slate-700 dark:text-gray-200">{formatMoney(alloc.fineAmount)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Долги</div>
                      <div className="font-semibold text-slate-700 dark:text-gray-200">{formatMoney(alloc.debtAmount)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Аванс</div>
                      <div className="font-semibold text-slate-700 dark:text-gray-200">{formatMoney(alloc.advanceAmount)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-gray-500">Чистыми</div>
                      <div className="font-semibold text-green-600 dark:text-green-300">{formatMoney(alloc.netAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
