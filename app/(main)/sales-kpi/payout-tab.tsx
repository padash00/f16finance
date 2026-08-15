'use client'

/**
 * «Кому сколько доплатить» — единственный экран модуля, который касается денег.
 *
 * Здесь нет ни баллов в долях, ни перцентилей, ни методологии. Только: кому,
 * сколько, за что и почему кому-то ноль. Всё остальное объясняется на других
 * вкладках, и открывать их для выплаты не нужно.
 */

import { useState } from 'react'
import { AlertCircle, Check, Coins, Loader2, Sparkles, Wallet } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'
import { useApi } from '@/lib/hooks/use-api'

type PayoutRow = {
  cashier_id: string
  name: string
  shifts: number
  revenue: number
  receipts: number
  score: number | null
  status: string
  status_label: string
  amount: number
  paid: boolean
  paid_at: string | null
  zero_reason: string | null
  strengths: string[]
  weaknesses: string[]
}

type MonthlyReport = {
  summary: string
  demand: string
  team: string
  money: string
  recommendation: string
  watch_out: string[]
}

type PayoutData = {
  month: string
  rows: PayoutRow[]
  totals: {
    to_pay: number
    to_pay_people: number
    already_paid: number
    already_paid_people: number
    people: number
  }
  settings: {
    monthly_bonus_strong: number
    monthly_bonus_top: number
    min_qualifying_shifts: number
    shift_bonus_paid: boolean
  }
}

const METRIC_WORDS: Record<string, string> = {
  avg_ticket: 'средний чек',
  items_per_receipt: 'товары в чеке',
  attach_rate: 'допродажи',
  revenue_efficiency: 'отдача с покупателя',
  plan_attainment: 'выполнение плана',
  product_knowledge: 'знание товара',
}

const STATUS_STYLE: Record<string, string> = {
  TOP: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  STRONG: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
  NORMAL: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
  NEEDS_TRAINING: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400',
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function PayoutTab(props: { companyId: string; canManage: boolean }) {
  const [month, setMonth] = useState(currentMonth())
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [reportBusy, setReportBusy] = useState(false)

  async function buildReport() {
    setReportBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, action: 'monthly', month }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      if (json?.data?.ai) setReport(json.data.ai as MonthlyReport)
      if (json?.data?.ai_error) setProblem(`ИИ не ответил: ${json.data.ai_error}`)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось собрать отчёт')
    } finally {
      setReportBusy(false)
    }
  }

  const key = `/api/admin/sales-kpi/payout?company_id=${props.companyId}&month=${month}`
  const { data, loading, refresh } = useApi<{ data: PayoutData }>(key)
  const payload = data?.data

  async function pay(row: PayoutRow) {
    setBusy(row.cashier_id)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: props.companyId,
          action: 'award_monthly',
          month,
          cashier_id: row.cashier_id,
          status: row.status,
          score: row.score,
          shifts: row.shifts,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось начислить')
    } finally {
      setBusy(null)
    }
  }

  async function cancel(row: PayoutRow) {
    const reason = window.prompt('Причина отмены (минимум 5 символов):')
    if (!reason || reason.trim().length < 5) return
    setBusy(row.cashier_id)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: props.companyId,
          action: 'void_monthly',
          month,
          cashier_id: row.cashier_id,
          reason: reason.trim(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось отменить')
    } finally {
      setBusy(null)
    }
  }

  const t = payload?.totals

  return (
    <div className="space-y-4">
      {/* Что это вообще такое */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Доплата за качество работы
          </h2>
        </div>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <p>
            Это единственная выплата, которую добавляет модуль. Ставка за смену и бонусы за оборот
            считаются как раньше — на странице{' '}
            <Link href="/salary" className="text-sky-600 hover:underline dark:text-sky-400">
              «Зарплата»
            </Link>
            , их тут нет.
          </p>
          <p>
            Доплата идёт не за выручку, а за то, как человек работает с каждым покупателем: средний чек,
            допродажи, сколько товаров в чеке. Продавец может отработать смену с маленькой кассой просто
            потому, что мало кто зашёл, — за это здесь не наказывают.
          </p>
          <p className="text-slate-500 dark:text-slate-400">
            Сильный — {formatMoney(payload?.settings.monthly_bonus_strong ?? 0)}, топ —{' '}
            {formatMoney(payload?.settings.monthly_bonus_top ?? 0)}. Статус ставится от{' '}
            {payload?.settings.min_qualifying_shifts ?? 6} отработанных смен: по паре смен человека
            оценивать нельзя.
          </p>
        </div>
      </Card>

      {/* Месяц и итог */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))}>
              ←
            </Button>
            <span className="min-w-[150px] text-center text-sm font-medium text-slate-900 dark:text-white">
              {monthLabel(month)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={month >= currentMonth()}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              →
            </Button>
          </div>

          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">К доплате</div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {formatMoney(t?.to_pay ?? 0)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t?.to_pay_people ?? 0} чел.
              </div>
            </div>
            {(t?.already_paid ?? 0) > 0 ? (
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Уже начислено</div>
                <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatMoney(t?.already_paid ?? 0)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t?.already_paid_people ?? 0} чел.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {problem ? <p className="text-sm text-rose-600 dark:text-rose-400">{problem}</p> : null}

      {/* Люди */}
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Считаем…
        </Card>
      ) : (payload?.rows || []).length === 0 ? (
        <Card className="p-6 text-sm text-slate-600 dark:text-slate-300">
          За этот месяц нет смен с указанным продавцом.
        </Card>
      ) : (
        <div className="space-y-2">
          {(payload?.rows || []).map((r) => (
            <Card key={r.cashier_id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-slate-900 dark:text-white">{r.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[r.status] || STATUS_STYLE.NORMAL
                      }`}
                    >
                      {r.status_label}
                    </span>
                  </div>

                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {r.shifts} смен · {r.receipts} чеков · {formatMoney(r.revenue)} выручки
                  </div>

                  {r.strengths.length > 0 || r.weaknesses.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {r.strengths.length > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Хорошо: {r.strengths.map((m) => METRIC_WORDS[m] || m).join(', ')}
                        </span>
                      ) : null}
                      {r.weaknesses.length > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          Слабее: {r.weaknesses.map((m) => METRIC_WORDS[m] || m).join(', ')}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {r.zero_reason ? (
                    <div className="mt-2 flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{r.zero_reason}</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div
                      className={`text-xl font-semibold ${
                        r.amount > 0
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {r.amount > 0 ? formatMoney(r.amount) : '—'}
                    </div>
                    {r.paid ? (
                      <div className="flex items-center justify-end gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> в зарплате
                      </div>
                    ) : null}
                  </div>

                  {props.canManage && r.amount > 0 ? (
                    r.paid ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === r.cashier_id}
                        onClick={() => void cancel(r)}
                      >
                        Отменить
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy === r.cashier_id} onClick={() => void pay(r)}>
                        {busy === r.cashier_id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Coins className="mr-1 h-3.5 w-3.5" />
                        )}
                        Начислить
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Отчёт месяца словами */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Что было в этом месяце</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Связный разбор: спрос, команда, деньги и что делать дальше. Считают цифры код и модель, ИИ
              только излагает.
            </p>
          </div>
          {!report ? (
            <Button variant="outline" size="sm" disabled={reportBusy} onClick={() => void buildReport()}>
              {reportBusy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              Собрать отчёт
            </Button>
          ) : null}
        </div>

        {report ? (
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {[
              ['Коротко', report.summary],
              ['Спрос', report.demand],
              ['Команда', report.team],
              ['Деньги', report.money],
              ['Что делать', report.recommendation],
            ]
              .filter(([, text]) => Boolean(text))
              .map(([title, text]) => (
                <div key={title as string}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {title as string}
                  </div>
                  <p className="mt-0.5">{text as string}</p>
                </div>
              ))}
            {report.watch_out.length > 0 ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Оговорки
                </div>
                <ul className="mt-0.5 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {report.watch_out.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Как это работает</div>
        <ul className="space-y-1.5">
          <li>
            <b>Нажали «Начислить»</b> — сумма уходит в зарплату отдельной строкой с пометкой, что это
            бонус за качество. Увидите её в ведомости на странице «Зарплата».
          </li>
          <li>
            <b>Нажали второй раз</b> — ничего не удвоится. Повторное начисление за тот же месяц
            невозможно.
          </li>
          <li>
            <b>Передумали</b> — «Отменить» уберёт деньги из зарплаты, но запись с причиной останется.
          </li>
          <li>
            <b>Ноль у человека</b> — это не наказание. Либо смен мало для оценки, либо работал в пределах
            обычного. Доплата начинается со статуса «сильный».
          </li>
          {payload?.settings.shift_bonus_paid === false ? (
            <li>
              <b>Бонусы за оборот</b> (B1/B2/B3) этот модуль не платит — они начисляются правилами
              зарплаты, как и раньше. Здесь только доплата за качество.
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  )
}
