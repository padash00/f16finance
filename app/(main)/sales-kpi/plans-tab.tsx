'use client'

/**
 * Вкладка «Планы смен».
 *
 * Показывает лестницу бонусных уровней на ближайшие дни и состояние плана:
 * предварительный (пересчитывается) или зафиксированный (обещание, данное
 * продавцу). Правка зафиксированного плана возможна только с причиной —
 * поле обязательное и в форме, и на сервере, и в самой базе.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, Loader2, Lock, Pencil, RefreshCw, Target } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'
import { useApi } from '@/lib/hooks/use-api'

import { CalendarBlock } from './calendar-block'
import { SectionIntro } from './section-intro'

type PlanRow = {
  date: string
  shift: 'day' | 'night'
  source: 'saved' | 'preview'
  locked: boolean
  locked_at: string | null
  override_reason: string | null
  control: number | null
  b1: number | null
  b2: number | null
  b3: number | null
  record_threshold: number | null
  expected_revenue: number | null
  expected_receipts: number | null
  monthly_index: number
  baseline_level: string | null
  baseline_sample: number
  weather?: {
    bucket: string
    bucket_label: string
    factor: number
    usable: boolean
    sample: number
    temperature_max: number | null
    precipitation_mm: number | null
    known: boolean
  } | null
}

type MonthlyRow = {
  month: string
  value: number | null
  status: string | null
  recommended: number | null
  effective: number
}

type PlansData = {
  company_id: string
  period: { from: string; to: string }
  plans: PlanRow[]
  monthly: MonthlyRow[]
  settings: {
    b1_amount: number
    b2_amount: number
    b3_amount: number
    record_amount: number
    min_sample_size: number
    monthly_index_min: number
    monthly_index_max: number
    auto_adjust_max_delta: number
    plan_lock_days_ahead: number
  }
  model_version: string
}

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return WEEKDAYS[new Date(y, (m || 1) - 1, d || 1).getDay()]
}

export function PlansTab(props: { companyId: string; canManage: boolean }) {
  const from = isoToday()
  const to = isoPlus(13)
  const key = `/api/admin/sales-kpi/plans?company_id=${props.companyId}&from=${from}&to=${to}`
  const { data, loading, refresh, refreshing } = useApi<{ data: PlansData }>(key)
  const payload = data?.data

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<PlanRow | null>(null)

  const currentMonth = useMemo(() => payload?.monthly?.[0] ?? null, [payload])

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await refresh()
      return json
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось выполнить')
      return null
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Считаем планы…
      </Card>
    )
  }

  const plans = payload?.plans || []
  const withPlan = plans.filter((p) => p.b1 != null)

  return (
    <div className="space-y-4">
      <SectionIntro
        icon={<Target className="h-5 w-5" />}
        tone="sky"
        title="Цели на смену"
        what="Три уровня выручки, к которым продавцу идти в смену. Это цель и ориентир, а не обещание денег: за оборот платят правила зарплаты, как и раньше."
        todo={[
          'Посмотреть, какие цели стоят на ближайшие дни',
          '«Пересчитать планы» — если менялись цены или ассортимент',
          '«Зафиксировать» — чтобы цель на смену больше не менялась',
          'Карандашом можно поправить уровень вручную, но нужно указать причину',
          'Заполнить праздники и учебные периоды — без них месячный индекс работает вхолостую',
        ]}
        how="Уровни берутся из выручки похожих смен за прошлое: тот же сезон, тот же день недели, дневная или ночная. B1 — то, что берут чаще половины раз, B3 — то, что даётся редко. Суммы округляются вверх, чтобы цель запоминалась."
      />

      {/* Месячный индекс */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Месячный индекс спроса
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-slate-900 dark:text-white">
                {currentMonth?.effective?.toFixed(2) ?? '1.00'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {currentMonth?.month || ''}
                {currentMonth?.status === 'pending_approval' ? ' — ждёт подтверждения' : ''}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs text-slate-500 dark:text-slate-400">
              Поправка на то, что месяц месяцу рознь: сезонность, свежий тренд, учебный период и состав
              календаря. Двигает всю лестницу порогов целиком, границы{' '}
              {payload?.settings.monthly_index_min ?? 0.85}–{payload?.settings.monthly_index_max ?? 1.2}.
            </p>
          </div>

          {props.canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void post({ action: 'recompute_monthly_index', month: currentMonth?.month })}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Пересчитать индекс
              </Button>
              {currentMonth?.status === 'pending_approval' ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void post({ action: 'approve_monthly_index', month: currentMonth.month })}
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Подтвердить {currentMonth.value?.toFixed(2)}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {currentMonth?.status === 'pending_approval' ? (
          <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Модель предлагает {currentMonth.value?.toFixed(2)}, но изменение слишком большое, чтобы
              применяться само. Пока не подтвердите — планы считаются по 1.00.
            </span>
          </div>
        ) : null}
      </Card>

      <CalendarBlock companyId={props.companyId} canManage={props.canManage} />

      {/* Действия */}
      {props.canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void post({ action: 'generate', from, to })}
          >
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Пересчитать планы
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void post({ action: 'generate', from, to: isoPlus(payload?.settings.plan_lock_days_ahead ?? 3), lock: true })
            }
          >
            <Lock className="mr-1 h-3.5 w-3.5" /> Зафиксировать ближайшие
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Зафиксированные планы пересчёт не трогает
          </span>
        </div>
      ) : null}

      {problem ? <p className="text-sm text-rose-600 dark:text-rose-400">{problem}</p> : null}

      {/* Таблица планов */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Ближайшие смены</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            B1 {formatMoney(payload?.settings.b1_amount ?? 0)} · B2 {formatMoney(payload?.settings.b2_amount ?? 0)} ·
            B3 {formatMoney(payload?.settings.b3_amount ?? 0)} · рекорд{' '}
            {formatMoney(payload?.settings.record_amount ?? 0)}
          </span>
        </div>

        {withPlan.length === 0 ? (
          <div className="p-6 text-sm text-slate-600 dark:text-slate-300">
            Планы построить не из чего: в сегментах меньше{' '}
            {payload?.settings.min_sample_size ?? 8} сопоставимых смен. План по двум сменам был бы случайным
            числом, за которое платят деньги, — поэтому он не назначается.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Дата</th>
                  <th className="px-4 py-2 text-left font-medium">Смена</th>
                  <th className="px-4 py-2 text-right font-medium">Контроль</th>
                  <th className="px-4 py-2 text-right font-medium">B1</th>
                  <th className="px-4 py-2 text-right font-medium">B2</th>
                  <th className="px-4 py-2 text-right font-medium">B3</th>
                  <th className="px-4 py-2 text-right font-medium">Покупателей</th>
                  <th className="px-4 py-2 text-right font-medium">Прогноз кассы</th>
                  <th className="px-4 py-2 text-left font-medium">Погода</th>
                  <th className="px-4 py-2 text-left font-medium">Статус</th>
                  {props.canManage ? <th className="w-20" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {plans.map((p) => (
                  <tr key={`${p.date}|${p.shift}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-4 py-2 tabular-nums">
                      {p.date}
                      <span className="ml-1 text-xs text-slate-400">{weekdayLabel(p.date)}</span>
                    </td>
                    <td className="px-4 py-2">{p.shift === 'night' ? 'Ночь' : 'День'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {p.control == null ? '—' : formatMoney(p.control)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.b1 == null ? '—' : formatMoney(p.b1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.b2 == null ? '—' : formatMoney(p.b2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {p.b3 == null ? '—' : formatMoney(p.b3)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {p.expected_receipts == null ? '—' : p.expected_receipts}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {p.expected_revenue == null ? '—' : formatMoney(p.expected_revenue)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {!p.weather?.known ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          title={
                            p.weather.usable
                              ? `Такая погода исторически меняет выручку в ${p.weather.factor.toFixed(2)} раза (по ${p.weather.sample} дням). Поправлен только прогноз, пороги не тронуты.`
                              : 'Наблюдений по такой погоде мало — прогноз не поправляется.'
                          }
                        >
                          {p.weather.bucket_label}
                          {p.weather.temperature_max == null
                            ? ''
                            : ` ${Math.round(p.weather.temperature_max)}°`}
                          {p.weather.usable && p.weather.factor !== 1 ? (
                            <span className="ml-1 text-slate-400">×{p.weather.factor.toFixed(2)}</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {p.b1 == null ? (
                        <span className="text-xs text-slate-400">мало истории</span>
                      ) : p.locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                          <Lock className="h-3 w-3" /> зафиксирован
                        </span>
                      ) : p.source === 'saved' ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">сохранён</span>
                      ) : (
                        <span className="text-xs text-slate-400">предварительный</span>
                      )}
                      {p.override_reason ? (
                        <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400" title={p.override_reason}>
                          правка вручную
                        </div>
                      ) : null}
                    </td>
                    {props.canManage ? (
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          {p.b1 != null && !p.locked && p.source === 'saved' ? (
                            <button
                              title="Зафиксировать"
                              disabled={busy}
                              onClick={() => void post({ action: 'lock', plan_date: p.date, shift: p.shift })}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                            >
                              <Lock className="h-4 w-4" />
                            </button>
                          ) : null}
                          {p.b1 != null && p.source === 'saved' ? (
                            <button
                              title="Изменить вручную"
                              disabled={busy}
                              onClick={() => setEditing(p)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
        Погода поправляет только прогноз и только тогда, когда по такой погоде накопилось достаточно
        собственных наблюдений. Бонусных порогов она не касается: продавец не отвечает за дождь.
        <br />
        Прогноз и план — разные вещи. Прогноз меняется каждый день вслед за потоком, планка стоит на месте:
        человек работает под ту цифру, которую ему назвали до смены. Уровни не суммируются — платится только
        максимальный достигнутый, а рекорд заменяет B3. Ниже «контроля» штрафа нет: это отметка «разобраться».
      </p>

      {editing ? (
        <OverrideModal
          plan={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={async (levels, reason) => {
            const ok = await post({
              action: 'override',
              plan_date: editing.date,
              shift: editing.shift,
              ...levels,
              reason,
            })
            if (ok) setEditing(null)
          }}
        />
      ) : null}

      {refreshing ? <div className="text-xs text-slate-400">Обновляем…</div> : null}
    </div>
  )
}

function OverrideModal(props: {
  plan: PlanRow
  busy: boolean
  onClose: () => void
  onSubmit: (levels: Record<string, number>, reason: string) => void
}) {
  const [control, setControl] = useState(String(props.plan.control ?? 0))
  const [b1, setB1] = useState(String(props.plan.b1 ?? 0))
  const [b2, setB2] = useState(String(props.plan.b2 ?? 0))
  const [b3, setB3] = useState(String(props.plan.b3 ?? 0))
  const [reason, setReason] = useState('')

  const levels = [Number(control), Number(b1), Number(b2), Number(b3)]
  const increasing = levels.every((v, i) => i === 0 || v > levels[i - 1])
  const valid = levels.every((v) => Number.isFinite(v) && v >= 0) && increasing && reason.trim().length >= 5

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="mt-16 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-900">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          План на {props.plan.date}, {props.plan.shift === 'night' ? 'ночь' : 'день'}
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {props.plan.locked
            ? 'План уже объявлен продавцу. Причина правки обязательна и попадёт в журнал.'
            : 'Ручные уровни заменят расчётные. Причина обязательна и попадёт в журнал.'}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {field('Контроль', control, setControl)}
          {field('B1', b1, setB1)}
          {field('B2', b2, setB2)}
          {field('B3', b3, setB3)}
        </div>

        {!increasing ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Уровни должны строго расти: иначе часть из них недостижима или берётся одновременно.
          </p>
        ) : null}

        <label className="mt-4 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          Причина правки
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Например: точка не работала половину смены из-за аварии"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={!valid || props.busy}
            onClick={() =>
              props.onSubmit(
                { control: levels[0], b1: levels[1], b2: levels[2], b3: levels[3] },
                reason.trim(),
              )
            }
          >
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}
