/**
 * Качество данных и поиск аномалий.
 *
 * Модель сравнивает людей друг с другом и с их собственной историей. Если в
 * эту историю попадает мусор — дубль смены, сбой кассы, тестовые чеки, — то
 * норма съезжает, и по ней потом оценивают живых людей. Поэтому подозрительные
 * смены нужно уметь замечать и исключать из базы сравнения.
 *
 * Два правила, которые здесь соблюдаются:
 *
 *   * исходные данные не трогаем. Смена помечается, а не удаляется, и из
 *     отчётов не исчезает — иначе разбираться будет не с чем;
 *   * автоматика только предлагает. Детектор ставит пометку `auto`, но
 *     решение «не учитывать в норме» остаётся за человеком: странная смена
 *     вполне может быть настоящей.
 */

import type { ShiftFact } from './types'
import type { StoreKpiSettings } from './settings'

export type AnomalyKind =
  | 'negative_revenue'
  | 'revenue_without_receipts'
  | 'receipts_without_revenue'
  | 'extreme_ticket'
  | 'high_refunds'
  | 'high_discounts'
  | 'no_cashier'
  | 'duplicate_shift'

export type Anomaly = {
  date: string
  shift: string
  kind: AnomalyKind
  /** Человеческое описание — оно же попадёт в пометку смены. */
  reason: string
  /** Стоит ли по умолчанию исключать смену из базы сравнения. */
  suggest_exclude: boolean
}

const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  negative_revenue: 'отрицательная выручка',
  revenue_without_receipts: 'выручка есть, а чеков нет',
  receipts_without_revenue: 'чеки есть, а выручка нулевая',
  extreme_ticket: 'средний чек резко выбивается из истории',
  high_refunds: 'аномально высокая доля возвратов',
  high_discounts: 'аномально высокая доля скидок',
  no_cashier: 'смена без кассира',
  duplicate_shift: 'дубль смены',
}

/** Доли, за которыми показатель перестаёт быть просто «высоким». */
const REFUND_ALARM = 0.25
const DISCOUNT_ALARM = 0.4
/** Во сколько раз средний чек должен отличаться от медианы, чтобы насторожить. */
const TICKET_ALARM_FACTOR = 3

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Ищет подозрительные смены.
 *
 * Пороги намеренно грубые: задача детектора — обратить внимание человека, а
 * не выносить приговор. Ложная тревога стоит одного взгляда, пропущенный
 * мусор в норме — искажённой оценки всей команды.
 */
export function detectAnomalies(facts: ShiftFact[], settings: StoreKpiSettings): Anomaly[] {
  const out: Anomaly[] = []

  const tickets = facts
    .filter((f) => f.receipts > 0 && f.revenue > 0)
    .map((f) => f.revenue / f.receipts)
  const ticketMedian = median(tickets)

  const seen = new Map<string, number>()

  for (const fact of facts) {
    const key = `${fact.date}|${fact.shift}|${fact.cashier_id ?? 'none'}`
    seen.set(key, (seen.get(key) || 0) + 1)

    const add = (kind: AnomalyKind, suggest_exclude: boolean, extra?: string) =>
      out.push({
        date: fact.date,
        shift: fact.shift,
        kind,
        reason: extra ? `${ANOMALY_LABEL[kind]}: ${extra}` : ANOMALY_LABEL[kind],
        suggest_exclude,
      })

    if (fact.revenue < 0) add('negative_revenue', true)
    if (fact.receipts === 0 && fact.revenue > 0) add('revenue_without_receipts', true)
    if (fact.receipts > 0 && fact.revenue <= 0) add('receipts_without_revenue', true)
    if (!fact.cashier_id && fact.receipts > 0) add('no_cashier', false)

    if (fact.gross_revenue > 0 && fact.refunds / fact.gross_revenue >= REFUND_ALARM) {
      add('high_refunds', false, `${Math.round((fact.refunds / fact.gross_revenue) * 100)}% оборота`)
    }

    if (fact.gross_revenue > 0 && fact.discount_amount / fact.gross_revenue >= DISCOUNT_ALARM) {
      add(
        'high_discounts',
        false,
        `${Math.round((fact.discount_amount / fact.gross_revenue) * 100)}% оборота`,
      )
    }

    if (ticketMedian && ticketMedian > 0 && fact.receipts > 0 && fact.revenue > 0) {
      const ticket = fact.revenue / fact.receipts
      if (ticket > ticketMedian * TICKET_ALARM_FACTOR || ticket * TICKET_ALARM_FACTOR < ticketMedian) {
        add('extreme_ticket', false, `${Math.round(ticket)} ₸ против обычных ${Math.round(ticketMedian)} ₸`)
      }
    }
  }

  for (const [key, count] of seen) {
    if (count <= 1) continue
    const [date, shift] = key.split('|')
    out.push({
      date,
      shift,
      kind: 'duplicate_shift',
      reason: `${ANOMALY_LABEL.duplicate_shift}: записей ${count}`,
      suggest_exclude: true,
    })
  }

  // Смены, где вовсе нет истории для сравнения, аномалией не считаются —
  // это просто начало работы точки.
  void settings

  return out
}

export type DataQualityCheck = {
  key: string
  label: string
  /** 0..1 — насколько закрыт этот участок. */
  value: number
  ok: boolean
  hint: string
}

export type DataQuality = {
  /** 0..1 — общая готовность данных к оценке людей. */
  score: number
  checks: DataQualityCheck[]
  /** Чего не хватает в первую очередь. */
  worst: DataQualityCheck | null
}

/**
 * Насколько данные вообще годятся для того, чтобы по ним оценивать людей.
 *
 * Показывается владельцу до того, как он начнёт делать выводы: балл 1.00 при
 * качестве данных 0.3 значит куда меньше, чем тот же балл при 0.9.
 */
export function dataQualityScore(facts: ShiftFact[], settings: StoreKpiSettings): DataQuality {
  const total = facts.length
  const share = (n: number) => (total > 0 ? n / total : 0)

  const checks: DataQualityCheck[] = [
    {
      key: 'history',
      label: 'Длина истории',
      value: Math.min(1, total / (settings.min_sample_size * 8)),
      ok: total >= settings.min_sample_size * 4,
      hint: `${total} смен в истории. Чем короче история, тем грубее нормы.`,
    },
    {
      key: 'cashier',
      label: 'Кассир указан',
      value: share(facts.filter((f) => f.cashier_id).length),
      ok: share(facts.filter((f) => f.cashier_id).length) >= 0.9,
      hint: 'Смены без кассира в оценку людей не попадают вовсе.',
    },
    {
      key: 'items',
      label: 'Позиции в чеках',
      value: share(facts.filter((f) => f.items > 0).length),
      ok: share(facts.filter((f) => f.items > 0).length) >= 0.8,
      hint: 'Без построчных чеков не считаются товары на чек и допродажи.',
    },
    {
      key: 'attach',
      label: 'Правила допродаж работают',
      value: share(facts.filter((f) => f.attach_opportunities > 0).length),
      ok: share(facts.filter((f) => f.attach_opportunities > 0).length) >= 0.5,
      hint: 'Если правила не срабатывают, четверть веса балла не участвует в оценке.',
    },
    {
      key: 'cogs',
      label: 'Себестоимость известна',
      value: share(facts.filter((f) => f.cogs > 0).length),
      ok: share(facts.filter((f) => f.cogs > 0).length) >= 0.7,
      hint: 'Без закупочных цен нельзя посчитать, окупаются ли бонусы.',
    },
    {
      key: 'clean',
      label: 'Данные без аномалий',
      value: 1 - share(facts.filter((f) => f.is_anomaly).length),
      ok: share(facts.filter((f) => f.is_anomaly).length) <= 0.05,
      hint: 'Помеченные смены не формируют норму, но их доля показывает, насколько чист учёт.',
    },
  ]

  const score = checks.reduce((sum, c) => sum + c.value, 0) / checks.length
  const worst = [...checks].sort((a, b) => a.value - b.value)[0] ?? null

  return { score: Math.round(score * 100) / 100, checks, worst }
}
