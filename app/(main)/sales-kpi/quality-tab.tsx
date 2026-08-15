'use client'

/**
 * Вкладка «Данные и деньги».
 *
 * Отвечает на вопрос, можно ли вообще доверять оценкам: насколько полны
 * данные, какие смены выглядят подозрительно и что мешало работать. Плюс
 * денежная часть — месячные бонусы и диагностические показатели розницы.
 *
 * Все пометки ставит человек. Детектор только предлагает: странная смена
 * вполне может быть настоящей, а исключение её из нормы меняет планку, по
 * которой потом оценивают всю команду.
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Plus, ShieldCheck, Trash2, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'
import { useApi } from '@/lib/hooks/use-api'

type QualityCheck = { key: string; label: string; value: number; ok: boolean; hint: string }

type Anomaly = {
  date: string
  shift: string
  kind: string
  reason: string
  suggest_exclude: boolean
}

type BusinessEvent = {
  id: string
  starts_on: string
  ends_on: string
  shift: string | null
  event_type: string
  title: string
  severity: 'low' | 'medium' | 'high'
}

type MonthlyRow = {
  cashier_id: string
  status: string
  score: number | null
  shifts: number
  amount: number
  level: string
}

type CategoryShare = {
  category_id: string | null
  category_name: string
  revenue: number
  share: number
}

type CashierMix = {
  cashier_id: string
  revenue: number
  notable: {
    category_id: string | null
    category_name: string
    share: number
    point_share: number
    delta_pp: number
  }[]
}

type QualityData = {
  period: { from: string; to: string }
  category_mix: CategoryShare[]
  cashier_mix: CashierMix[]
  quality: { score: number; checks: QualityCheck[]; worst: QualityCheck | null }
  anomalies: Anomaly[]
  flags: { shift_date: string; shift: string; reason: string; exclude_from_baseline: boolean }[]
  events: BusinessEvent[]
  diagnostics: {
    receipts: number
    revenue: number
    gross_profit: number | null
    avg_ticket: number | null
    items_per_receipt: number | null
    receipts_2plus_rate: number | null
    receipts_3plus_rate: number | null
    discount_rate: number | null
    refund_rate: number | null
    unique_skus: number
  }
  monthly: MonthlyRow[]
  awards: {
    cashier_id: string
    period_start: string
    amount: number
    level: string
    salary_adjustment_id: string | null
    voided_at: string | null
  }[]
  settings: { monthly_bonus_strong: number; monthly_bonus_top: number; shift_bonus_paid: boolean }
}

const EVENT_TYPES: [string, string][] = [
  ['STOCKOUT', 'Не было товара'],
  ['PROMOTION', 'Акция'],
  ['PRICE_CHANGE', 'Изменение цен'],
  ['NEW_PRODUCT', 'Новинка'],
  ['TECHNICAL_DOWNTIME', 'Простой техники'],
  ['PARTIAL_CLOSURE', 'Работали частично'],
  ['FULL_CLOSURE', 'Точка не работала'],
  ['CUSTOM', 'Другое'],
]

const SEVERITY_LABEL: Record<string, string> = {
  low: 'слабо мешало',
  medium: 'заметно мешало',
  high: 'сильно мешало',
}

function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export function QualityTab(props: { companyId: string; canManage: boolean; cashierNames: Map<string, string> }) {
  const key = `/api/admin/sales-kpi/quality?company_id=${props.companyId}`
  const { data, loading, refresh } = useApi<{ data: QualityData }>(key)
  const payload = data?.data

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [eventForm, setEventForm] = useState({
    starts_on: '',
    ends_on: '',
    event_type: 'STOCKOUT',
    title: '',
    severity: 'medium' as 'low' | 'medium' | 'high',
  })

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await refresh()
      return true
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось выполнить')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Проверяем данные…
      </Card>
    )
  }

  const q = payload?.quality
  const d = payload?.diagnostics
  const awarded = new Set(
    (payload?.awards || [])
      .filter((a) => !a.voided_at && a.salary_adjustment_id)
      .map((a) => `${a.cashier_id}|${monthOf(a.period_start)}`),
  )
  const currentMonth = monthOf(payload?.period.to || '')

  return (
    <div className="space-y-4">
      {/* Качество данных */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Качество данных</h2>
          <span className="text-lg font-semibold text-slate-900 dark:text-white">
            {q ? Math.round(q.score * 100) : 0}%
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Балл продавца 1.00 при качестве данных 30% значит куда меньше, чем тот же балл при 90%. Здесь
          видно, где именно данные дырявые.
        </p>

        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {(q?.checks || []).map((c) => (
            <div key={c.key} className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">{c.label}</span>
                <span
                  className={`text-sm tabular-nums ${
                    c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {pct(c.value)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{c.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Подозрительные смены */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <AlertTriangle className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Подозрительные смены</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            детектор предлагает, решение за вами
          </span>
        </div>

        {(payload?.anomalies || []).length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Ничего подозрительного не нашлось.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {(payload?.anomalies || []).slice(0, 30).map((a) => (
              <div key={`${a.date}|${a.shift}|${a.kind}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="tabular-nums text-slate-900 dark:text-white">{a.date}</span>
                <span className="text-slate-500 dark:text-slate-400">{a.shift === 'night' ? 'ночь' : 'день'}</span>
                <span className="text-slate-600 dark:text-slate-300">{a.reason}</span>
                {props.canManage ? (
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void post({
                          action: 'flag_shift',
                          shift_date: a.date,
                          shift: a.shift,
                          reason: a.reason,
                          is_anomaly: true,
                          exclude_from_baseline: false,
                        })
                      }
                    >
                      Пометить
                    </Button>
                    {a.suggest_exclude ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void post({
                            action: 'flag_shift',
                            shift_date: a.date,
                            shift: a.shift,
                            reason: a.reason,
                            is_anomaly: true,
                            exclude_from_baseline: true,
                          })
                        }
                      >
                        Исключить из нормы
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {(payload?.flags || []).length > 0 ? (
          <div className="border-t border-slate-200 px-4 py-3 dark:border-white/10">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Уже помечено
            </div>
            <div className="space-y-1">
              {(payload?.flags || []).slice(0, 20).map((f) => (
                <div key={`${f.shift_date}|${f.shift}`} className="flex items-center gap-2 text-xs">
                  <span className="tabular-nums text-slate-600 dark:text-slate-300">{f.shift_date}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {f.shift === 'night' ? 'ночь' : 'день'} — {f.reason}
                  </span>
                  {f.exclude_from_baseline ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      не в норме
                    </span>
                  ) : null}
                  {props.canManage ? (
                    <button
                      onClick={() =>
                        void post({ action: 'unflag_shift', shift_date: f.shift_date, shift: f.shift })
                      }
                      disabled={busy}
                      className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                      aria-label="Снять пометку"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* Деловые события */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Что мешало работать</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Отсутствие товара, акция, простой техники. Балл продавца от этого не меняется — кассир не виноват,
          что не смог продать напиток, которого нет на витрине. Но уверенность в оценке снижается, и событие
          попадает в разбор смены.
        </p>

        <div className="mt-3 space-y-1">
          {(payload?.events || []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
              Событий не отмечено.
            </div>
          ) : (
            (payload?.events || []).map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-white/10"
              >
                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                  {e.starts_on}
                  {e.ends_on !== e.starts_on ? ` — ${e.ends_on}` : ''}
                </span>
                <span className="text-slate-900 dark:text-white">{e.title}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {EVENT_TYPES.find(([v]) => v === e.event_type)?.[1] || e.event_type} ·{' '}
                  {SEVERITY_LABEL[e.severity]}
                  {e.shift ? ` · ${e.shift === 'night' ? 'ночь' : 'день'}` : ''}
                </span>
                {props.canManage ? (
                  <button
                    onClick={() => void post({ action: 'delete_event', event_id: e.id })}
                    disabled={busy}
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    aria-label="Удалить событие"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        {props.canManage ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
              С
              <input
                type="date"
                value={eventForm.starts_on}
                onChange={(e) => setEventForm({ ...eventForm, starts_on: e.target.value })}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
              По
              <input
                type="date"
                value={eventForm.ends_on}
                onChange={(e) => setEventForm({ ...eventForm, ends_on: e.target.value })}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <select
              value={eventForm.event_type}
              onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900 dark:text-white"
            >
              {EVENT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={eventForm.severity}
              onChange={(e) =>
                setEventForm({ ...eventForm, severity: e.target.value as 'low' | 'medium' | 'high' })
              }
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900 dark:text-white"
            >
              {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              placeholder="Что случилось"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-900 dark:text-white"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !eventForm.starts_on || !eventForm.title.trim()}
              onClick={() =>
                void post({
                  action: 'add_event',
                  ...eventForm,
                  ends_on: eventForm.ends_on || eventForm.starts_on,
                }).then((ok) => {
                  if (ok) setEventForm({ ...eventForm, title: '' })
                })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Месячный бонус */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <Wallet className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Месячный бонус</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            сильный {formatMoney(payload?.settings.monthly_bonus_strong ?? 0)} · топ{' '}
            {formatMoney(payload?.settings.monthly_bonus_top ?? 0)}
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-white/5">
          {(payload?.monthly || []).length === 0 ? (
            <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
              За период нет продавцов с достаточным числом смен.
            </div>
          ) : (
            (payload?.monthly || []).map((m) => {
              const already = awarded.has(`${m.cashier_id}|${currentMonth}`)
              return (
                <div key={m.cashier_id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <span className="font-medium text-slate-900 dark:text-white">
                    {props.cashierNames.get(m.cashier_id) || 'Без имени'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {m.shifts} смен · балл {m.score?.toFixed(2) ?? '—'}
                  </span>
                  <span className="tabular-nums text-slate-900 dark:text-white">
                    {m.amount > 0 ? formatMoney(m.amount) : '—'}
                  </span>
                  {already ? (
                    <>
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        начислено в зарплату
                      </span>
                      {props.canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt('Причина отмены начисления (минимум 5 символов):')
                            if (!reason || reason.trim().length < 5) return
                            void post({
                              action: 'void_monthly',
                              month: currentMonth,
                              cashier_id: m.cashier_id,
                              reason: reason.trim(),
                            })
                          }}
                        >
                          Отменить
                        </Button>
                      ) : null}
                    </>
                  ) : props.canManage && m.amount > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() =>
                        void post({
                          action: 'award_monthly',
                          month: currentMonth,
                          cashier_id: m.cashier_id,
                          status: m.status,
                          score: m.score,
                          shifts: m.shifts,
                        })
                      }
                    >
                      Начислить
                    </Button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-400 dark:border-white/10 dark:text-slate-500">
          Бонус считается, но не начисляется сам. По кнопке он попадает в зарплату отдельной
          корректировкой с пометкой источника — повторное нажатие деньги не удвоит. При статусе «мало
          смен» бонус не платится вовсе: платить за статус, который мы не смогли определить, нельзя ни в
          плюс, ни в минус.
          {payload?.settings.shift_bonus_paid === false ? (
            <>
              {' '}
              Сменные бонусы B1/B2/B3 этот модуль не платит — пороги по обороту уже есть в правилах
              зарплаты, и начислять за одну смену дважды нельзя. Уровни остаются целью на смену.
            </>
          ) : null}
        </p>
      </Card>

      {/* Диагностика розницы */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Показатели периода</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          В балл продавца не входят — это диагностика, которая помогает объяснить его.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Чеков', String(d?.receipts ?? 0)],
            ['Выручка', formatMoney(d?.revenue ?? 0)],
            ['Валовая прибыль', d?.gross_profit == null ? 'нет себестоимости' : formatMoney(d.gross_profit)],
            ['Средний чек', d?.avg_ticket == null ? '—' : formatMoney(d.avg_ticket)],
            ['Товаров на чек', d?.items_per_receipt?.toFixed(2) ?? '—'],
            ['Чеков с 2+ позициями', pct(d?.receipts_2plus_rate)],
            ['Чеков с 3+ позициями', pct(d?.receipts_3plus_rate)],
            ['Доля скидок', pct(d?.discount_rate)],
            ['Доля возвратов', pct(d?.refund_rate)],
            ['Уникальных товаров', String(d?.unique_skus ?? 0)],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Структура продаж */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Что продаётся</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          В балл не входит, но часто его объясняет: «средний чек просел» и «продавали в основном напитки
          вместо горячего» — одно и то же наблюдение с разных сторон.
        </p>

        {(payload?.category_mix || []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Нет данных: в чеках нет позиций или у товаров не проставлены категории.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {(payload?.category_mix || []).slice(0, 8).map((c) => (
              <div key={c.category_id ?? 'none'} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm text-slate-700 dark:text-slate-200">
                  {c.category_name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className="h-full bg-sky-500" style={{ width: `${Math.round(c.share * 100)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {pct(c.share)}
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatMoney(c.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}

        {(payload?.cashier_mix || []).some((m) => m.notable.length > 0) ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Чем продавцы отличаются от точки
            </div>
            <div className="space-y-2">
              {(payload?.cashier_mix || [])
                .filter((m) => m.notable.length > 0)
                .map((m) => (
                  <div key={m.cashier_id} className="rounded-lg border border-slate-200 p-2.5 dark:border-white/10">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {props.cashierNames.get(m.cashier_id) || 'Без имени'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {m.notable.map((n) => (
                        <span
                          key={`${m.cashier_id}-${n.category_id ?? 'none'}`}
                          className={
                            n.delta_pp > 0
                              ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                              : 'rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                          }
                          title={`${pct(n.share)} против ${pct(n.point_share)} по точке`}
                        >
                          {n.category_name} {n.delta_pp > 0 ? '+' : ''}
                          {n.delta_pp} п.п.
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Отклонение — это факт, а не вывод. Оно может объясняться сменой (ночью берут другое),
              отсутствием товара или тем, что человек работал в другие дни.
            </p>
          </div>
        ) : null}
      </Card>

      {problem ? <p className="text-sm text-rose-600 dark:text-rose-400">{problem}</p> : null}
    </div>
  )
}
