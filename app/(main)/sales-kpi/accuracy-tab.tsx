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
  /**
   * Теневое сравнение: нынешняя модель против вероятностной. Обе прогоняются
   * по одной истории, прогноз на смену делается до того, как смена попала в
   * базу. Ни на план, ни на выплату это не влияет — это измерение.
   */
  model_comparison?: {
    model_version: string
    v1: ModelMetrics
    v2: ModelMetrics
    verdict: { winner: 'v1' | 'v2' | 'tie'; wapeDelta: number | null; summary: string }
    b1_calibration: {
      brierScore: number | null
      observations: number
      buckets: Array<{ from: number; to: number; predicted: number; observed: number; count: number }>
    }
  }
}

type ModelMetrics = {
  mae: number | null
  wape: number | null
  bias: number | null
  coverage50: number | null
  coverage80: number | null
  intervalWidth: number | null
  observations: number
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

/**
 * Сравнение моделей — самая честная часть вкладки.
 *
 * Здесь видно не «какая формула красивее», а попадает ли обещанный диапазон
 * туда, куда обещал. Модель, чей «диапазон 80%» накрывает факт в половине
 * случаев, вводит в заблуждение — и это должно быть видно владельцу, а не
 * только в тестах.
 */
/** Процент с десятой долей: для сравнения моделей целых не хватает. */
function pctPrecise(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function ModelComparison(props: { data: NonNullable<AccuracyData['model_comparison']> }) {
  const { v1, v2, verdict, b1_calibration } = props.data

  const rows: Array<{ label: string; hint: string; v1: string; v2: string }> = [
    {
      label: 'Средний промах',
      hint: 'На сколько чеков в среднем ошибается прогноз',
      v1: v1.mae == null ? '—' : `${v1.mae} чек.`,
      v2: v2.mae == null ? '—' : `${v2.mae} чек.`,
    },
    {
      label: 'Промах в процентах',
      hint: 'Тот же промах относительно потока — позволяет сравнивать разные точки',
      // С десятой долей, а не целыми: округление до целых показывало «23% и
      // 23%» рядом с вердиктом «точнее на 0.9 п.п.» — читается как ошибка,
      // хотя разница настоящая.
      v1: pctPrecise(v1.wape),
      v2: pctPrecise(v2.wape),
    },
    {
      label: 'Систематический сдвиг',
      hint: 'Плюс — прогноз стабильно завышает, минус — занижает. Ноль лучше всего',
      v1: v1.bias == null ? '—' : v1.bias > 0 ? `+${v1.bias}` : String(v1.bias),
      v2: v2.bias == null ? '—' : v2.bias > 0 ? `+${v2.bias}` : String(v2.bias),
    },
    {
      label: 'Диапазон накрыл факт',
      hint: 'Обещали 80% — значит, факт обязан попадать в диапазон примерно в 80% смен',
      v1: pct(v1.coverage80),
      v2: pct(v2.coverage80),
    },
    {
      label: 'Ширина диапазона',
      hint: 'Цена этого попадания: слишком широкий диапазон накроет что угодно и ничего не скажет',
      v1: v1.intervalWidth == null ? '—' : `${v1.intervalWidth} чек.`,
      v2: v2.intervalWidth == null ? '—' : `${v2.intervalWidth} чек.`,
    },
  ]

  return (
    <Card className="p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">Нынешняя модель против вероятностной</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Обе прогоняются по одной истории: прогноз на смену делается до того, как смена попала в базу.
        Вероятностная пока ни на что не влияет — ни на балл продавца, ни на планы, ни на выплаты.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-2 font-normal">Показатель</th>
              <th className="w-28 py-2 px-2 text-right font-normal">Нынешняя</th>
              <th className="w-28 py-2 pl-2 text-right font-normal">Вероятностная</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-2 pr-2">
                  <div className="text-xs text-foreground">{row.label}</div>
                  <div className="text-[11px] text-muted-foreground">{row.hint}</div>
                </td>
                <td className="py-2 px-2 text-right text-sm tabular-nums">{row.v1}</td>
                <td className="py-2 pl-2 text-right text-sm font-semibold tabular-nums">{row.v2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className={`mt-3 rounded-lg px-3 py-2 text-xs ${
          verdict.winner === 'v2'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : verdict.winner === 'v1'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'bg-surface-muted text-muted-foreground'
        }`}
      >
        {verdict.summary}
      </div>

      {b1_calibration.buckets.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold text-foreground">Сбываются ли обещанные вероятности</div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Если модель обещает «B1 возьмут в 70% смен», то в реальности он должен браться примерно в 70%.
            Расхождение важнее средней ошибки: обещание, которому нельзя верить, хуже отсутствия обещания.
          </p>
          <div className="space-y-1">
            {b1_calibration.buckets.map((bucket) => {
              const gap = Math.abs(bucket.predicted - bucket.observed)
              return (
                <div key={`${bucket.from}-${bucket.to}`} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-muted-foreground">обещали ~{Math.round(bucket.predicted * 100)}%</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={gap > 0.12 ? 'h-full bg-rose-500/70' : 'h-full bg-emerald-500/70'}
                      style={{ width: `${Math.round(bucket.observed * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 text-right tabular-nums">
                    сбылось {Math.round(bucket.observed * 100)}%
                  </span>
                  <span className="w-14 text-right text-[11px] text-muted-foreground">{bucket.count} см.</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Card>
  )
}

export function AccuracyTab(props: { companyId: string }) {
  const { data, loading } = useApi<{ data: AccuracyData }>(
    `/api/admin/sales-kpi/accuracy?company_id=${props.companyId}`,
  )
  const payload = data?.data

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
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
          <Target className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Калибровка бонусных уровней</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Модель прогнали по всей истории точки так, как она проживала бы её день за днём: план на каждый
          день считался по данным, известным к его началу. Ниже — какая доля смен взяла бы каждый уровень.
        </p>

        {!bt || bt.evaluated === 0 ? (
          <p className="mt-3 text-sm text-body">
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
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3"
                  >
                    <span className="w-8 text-sm font-semibold text-foreground">
                      {LEVEL_LABELS[c.level] || c.level}
                    </span>
                    <span className="text-sm tabular-nums text-body">
                      берут {pct(c.rate)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ориентир {pct(c.target[0])}–{pct(c.target[1])}
                    </span>
                    <span className={`text-xs font-medium ${v.className}`}>{v.label}</span>
                    <span className="w-full text-xs text-muted-foreground">{v.hint}</span>
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
                <div className="text-xs text-muted-foreground">Смен проверено</div>
                <div className="text-lg font-semibold text-foreground">{bt.evaluated}</div>
                <div className="text-xs text-muted-foreground">без плана: {bt.skipped_no_history}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                {bt.bonus_cost_hypothetical ? 'Бонусы, если бы платил модуль' : 'Бонусы за период'}
              </div>
                <div className="text-lg font-semibold text-foreground">
                  {formatMoney(bt.bonus_cost)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {bt.bonus_share == null ? '' : `${(bt.bonus_share * 100).toFixed(1)}% выручки`}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Смен ниже контроля</div>
                <div className="text-lg font-semibold text-foreground">{pct(bt.review_rate)}</div>
                <div className="text-xs text-muted-foreground">повод разобраться, не штраф</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Рекордов</div>
                <div className="text-lg font-semibold text-foreground">
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
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Точность ожидания</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Насколько ожидание расходится с тем, что было на самом деле. «Промахивается на 20%» значит: в
          среднем модуль ошибается на пятую часть кассы. Перекос показывает, в какую сторону ошибка
          постоянная — ждёт больше, чем бывает, или меньше.
        </p>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              По всей истории точки
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <span>
                промахивается на <b className="tabular-nums">{errText(bt?.accuracy.wape)}</b>
              </span>
              <span className="text-body">{biasText(bt?.accuracy.bias)}</span>
              <span className="text-muted-foreground">
                смен {bt?.accuracy.n ?? 0}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              По объявленным планам
            </div>
            {live && live.shifts > 0 ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <span>
                  промахивается на <b className="tabular-nums">{errText(live.accuracy.wape)}</b>
                </span>
                <span className="text-body">{biasText(live.accuracy.bias)}</span>
                <span className="text-muted-foreground">смен {live.shifts}</span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Пока нет закрытых смен, план на которые был объявлен заранее. Появятся после первых суток
                работы планировщика.
              </p>
            )}
          </div>
        </div>

        {live && live.shifts > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-body">
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
          <h2 className="text-sm font-semibold text-foreground">Окупаемость бонусов</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Смысл программы не в том, чтобы меньше платить, а в том, чтобы прирост прибыли был больше
            выплат.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Выплачено</div>
              <div className="text-lg font-semibold text-foreground">
                {formatMoney(payload.roi.bonus_cost)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Прирост выручки над нормой</div>
              <div className="text-lg font-semibold text-foreground">
                {formatMoney(payload.roi.incremental_revenue)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Прирост валовой прибыли</div>
              <div className="text-lg font-semibold text-foreground">
                {payload.roi.incremental_gross_profit == null
                  ? 'нет себестоимости'
                  : formatMoney(payload.roi.incremental_gross_profit)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Итог</div>
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
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {payload.roi.caveats.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {payload?.model_comparison ? <ModelComparison data={payload.model_comparison} /> : null}

      <p className="px-1 text-xs text-muted-foreground">
        История: {payload?.history.from || '—'} — {payload?.history.to || '—'}, всего{' '}
        {payload?.history.shifts ?? 0} смен. Модель {payload?.model_version || '—'}. Ориентиры долей взяты
        из проектного задания и служат рамкой для разговора, а не жёстким правилом: если команда работает
        ровно хорошо, высокая доля B1 — это факт о команде, а не ошибка настройки.
      </p>
    </div>
  )
}
