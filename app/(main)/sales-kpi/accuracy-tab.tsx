'use client'

/**
 * Вкладка «Точность и калибровка».
 *
 * Экран, на который нужно смотреть до того, как платить по этой модели.
 * Он отвечает на два вопроса: попадает ли ожидание в факт и какая доля смен
 * взяла бы каждый бонусный уровень на реальной истории.
 *
 * Второй вопрос важнее. Порог, который берут почти все, ничего не мотивирует;
 * порог, который не берёт никто, воспринимается как обман.
 */

import { AlertTriangle, CheckCircle2, Loader2, Target, TrendingUp } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'
import { useApi } from '@/lib/hooks/use-api'

import { SectionIntro } from './section-intro'

type Calibration = {
  level: string
  rate: number
  target: [number, number]
  verdict: 'too_easy' | 'ok' | 'too_hard'
  alarm: 'threshold_too_easy' | 'threshold_demotivating' | null
}

type Roi = {
  shifts: number
  bonus_cost: number
  incremental_revenue: number
  gross_margin: number | null
  incremental_gross_profit: number | null
  net_effect: number | null
  roi: number | null
  caveats: string[]
}

type AccuracyData = {
  roi?: Roi
  history: { from: string | null; to: string | null; shifts: number }
  backtest: {
    evaluated: number
    skipped_no_history: number
    hit_rates: Record<string, number>
    review_rate: number
    bonus_cost: number
    bonus_cost_hypothetical?: boolean
    revenue: number
    bonus_share: number | null
    accuracy: { n: number; wape: number | null; bias: number | null; mae: number | null }
    calibration: Calibration[]
  }
  live: {
    shifts: number
    accuracy: { n: number; wape: number | null; bias: number | null; mae: number | null }
    levels: Record<string, number>
    bonus_cost: number
  }
  settings: { b1_amount: number; b2_amount: number; b3_amount: number; min_sample_size: number }
  model_version: string
}

const LEVEL_LABELS: Record<string, string> = { b1: 'B1', b2: 'B2', b3: 'B3' }

const VERDICT_TEXT: Record<Calibration['verdict'], { label: string; className: string; hint: string }> = {
  too_easy: {
    label: 'слишком легко',
    className: 'text-amber-600 dark:text-amber-400',
    hint: 'Уровень берут слишком часто — как надбавка за выход на работу, а не за результат. Поднимите планку в настройках.',
  },
  ok: {
    label: 'в норме',
    className: 'text-emerald-600 dark:text-emerald-400',
    hint: 'Доля попаданий в ориентире: уровень достижим, но не даётся сам собой.',
  },
  too_hard: {
    label: 'слишком трудно',
    className: 'text-rose-600 dark:text-rose-400',
    hint: 'Уровень почти недостижим — такой бонус демотивирует. Опустите планку в настройках.',
  },
}

function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

/** Ошибка прогноза долей от кассы — на экране это просто проценты. */
function errText(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

/**
 * Перекос прогноза словами.
 *
 * Число со знаком («−0.04») читателю ничего не говорит, а вот «немного
 * занижает» говорит сразу и в какую сторону, и насколько это важно.
 */
function biasText(value: number | null | undefined): string {
  if (value == null) return 'перекоса не видно'
  const p = Math.round(value * 100)
  if (Math.abs(p) < 3) return 'без перекоса'
  const size = Math.abs(p) >= 10 ? 'заметно' : 'немного'
  return p > 0 ? `${size} завышает ожидание` : `${size} занижает ожидание`
}

export function AccuracyTab(props: { companyId: string }) {
  const { data, loading } = useApi<{ data: AccuracyData }>(
    `/api/admin/sales-kpi/accuracy?company_id=${props.companyId}`,
  )
  const payload = data?.data

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Прогоняем историю через модель…
      </Card>
    )
  }

  const bt = payload?.backtest
  const live = payload?.live

  return (
    <div className="space-y-4">
      <SectionIntro
        icon={<Target className="h-5 w-5" />}
        tone="violet"
        title="Проверка модели"
        what="Экран, чтобы убедиться, что цели поставлены разумно. Если цель берут почти все — она ничего не двигает; если почти никто — она злит, а не мотивирует."
        todo={[
          'Посмотреть, какая доля смен берёт каждый уровень',
          'Если написано «слишком легко» или «слишком трудно» — подвинуть планку в настройках',
          'Сверить, насколько ожидание вообще попадает в факт',
        ]}
        how="Вся история точки прогоняется через модель день за днём: цель на каждый день считается только по тем данным, которые были известны к его началу. Заглянуть вперёд модель не может — иначе она выглядела бы точнее, чем есть."
      />

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Калибровка бонусных уровней</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Модель прогнали по всей истории точки так, как она проживала бы её день за днём: план на каждый
          день считался по данным, известным к его началу. Ниже — какая доля смен взяла бы каждый уровень.
        </p>

        {!bt || bt.evaluated === 0 ? (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Истории пока не хватает: ни одна смена не набрала {payload?.settings.min_sample_size ?? 8}{' '}
            сопоставимых наблюдений. Это нормально в начале — вернитесь сюда, когда накопятся смены.
          </p>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {bt.calibration.map((c) => {
                const v = VERDICT_TEXT[c.verdict]
                return (
                  <div
                    key={c.level}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 p-3 dark:border-white/10"
                  >
                    <span className="w-8 text-sm font-semibold text-slate-900 dark:text-white">
                      {LEVEL_LABELS[c.level] || c.level}
                    </span>
                    <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
                      берут {pct(c.rate)}
                    </span>
                    <span className="text-xs text-slate-400">
                      ориентир {pct(c.target[0])}–{pct(c.target[1])}
                    </span>
                    <span className={`text-xs font-medium ${v.className}`}>{v.label}</span>
                    <span className="w-full text-xs text-slate-500 dark:text-slate-400">{v.hint}</span>
                    {c.alarm ? (
                      <span className="w-full text-xs font-medium text-rose-600 dark:text-rose-400">
                        {c.alarm === 'threshold_too_easy'
                          ? 'Порог берут больше 70% смен — как бонус он не работает.'
                          : 'Порог берут меньше 15% смен — такой уровень скорее демотивирует.'}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Смен проверено</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">{bt.evaluated}</div>
                <div className="text-xs text-slate-400">без плана: {bt.skipped_no_history}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                {bt.bonus_cost_hypothetical ? 'Бонусы, если бы платил модуль' : 'Бонусы за период'}
              </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">
                  {formatMoney(bt.bonus_cost)}
                </div>
                <div className="text-xs text-slate-400">
                  {bt.bonus_share == null ? '' : `${(bt.bonus_share * 100).toFixed(1)}% выручки`}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Смен ниже контроля</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">{pct(bt.review_rate)}</div>
                <div className="text-xs text-slate-400">повод разобраться, не штраф</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Рекордов</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">
                  {pct(bt.hit_rates.record)}
                </div>
              </div>
            </div>

            {bt.bonus_share != null && bt.bonus_share > 0.05 ? (
              <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Бонусный фонд составил бы {(bt.bonus_share * 100).toFixed(1)}% выручки. Это много: смысл
                  системы в том, чтобы допродажи росли быстрее, чем расходы на бонусы.
                </span>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Точность ожидания</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Насколько ожидание расходится с тем, что было на самом деле. «Промахивается на 20%» значит: в
          среднем модуль ошибается на пятую часть кассы. Перекос показывает, в какую сторону ошибка
          постоянная — ждёт больше, чем бывает, или меньше.
        </p>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              По всей истории точки
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <span>
                промахивается на <b className="tabular-nums">{errText(bt?.accuracy.wape)}</b>
              </span>
              <span className="text-slate-600 dark:text-slate-300">{biasText(bt?.accuracy.bias)}</span>
              <span className="text-slate-500 dark:text-slate-400">
                смен {bt?.accuracy.n ?? 0}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              По объявленным планам
            </div>
            {live && live.shifts > 0 ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <span>
                  промахивается на <b className="tabular-nums">{errText(live.accuracy.wape)}</b>
                </span>
                <span className="text-slate-600 dark:text-slate-300">{biasText(live.accuracy.bias)}</span>
                <span className="text-slate-500 dark:text-slate-400">смен {live.shifts}</span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Пока нет закрытых смен, план на которые был объявлен заранее. Появятся после первых суток
                работы планировщика.
              </p>
            )}
          </div>
        </div>

        {live && live.shifts > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              По объявленным планам выплачено бы {formatMoney(live.bonus_cost)}: B1 — {live.levels.b1 || 0},
              B2 — {live.levels.b2 || 0}, B3 — {live.levels.b3 || 0}, рекордов — {live.levels.record || 0}.
            </span>
          </div>
        ) : null}
      </Card>

      {payload?.roi ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Окупаемость бонусов</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Смысл программы не в том, чтобы меньше платить, а в том, чтобы прирост прибыли был больше
            выплат.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Выплачено</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">
                {formatMoney(payload.roi.bonus_cost)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Прирост выручки над нормой</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">
                {formatMoney(payload.roi.incremental_revenue)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Прирост валовой прибыли</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">
                {payload.roi.incremental_gross_profit == null
                  ? 'нет себестоимости'
                  : formatMoney(payload.roi.incremental_gross_profit)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Итог</div>
              <div
                className={`text-lg font-semibold ${
                  (payload.roi.net_effect ?? 0) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {payload.roi.net_effect == null ? '—' : formatMoney(payload.roi.net_effect)}
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
            {payload.roi.caveats.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
        История: {payload?.history.from || '—'} — {payload?.history.to || '—'}, всего{' '}
        {payload?.history.shifts ?? 0} смен. Модель {payload?.model_version || '—'}. Ориентиры долей взяты
        из проектного задания и служат рамкой для разговора, а не жёстким правилом: если команда работает
        ровно хорошо, высокая доля B1 — это факт о команде, а не ошибка настройки.
      </p>
    </div>
  )
}
