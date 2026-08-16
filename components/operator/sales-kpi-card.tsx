'use client'

/**
 * «Как я работаю» — блок в кабинете продавца.
 *
 * Человек видит только себя: ни чужих баллов, ни рейтинга команды. Сравнение
 * людей между собой это инструмент управляющего, а у кассы оно превращается в
 * повод для обид.
 *
 * Показывается то, за что модуль реально платит, — доплата за качество и
 * метрики, из которых она складывается. Бонусных порогов B1/B2/B3 здесь нет:
 * за оборот платят правила зарплаты со своими цифрами, и вторая линейка
 * порогов рядом только запутала бы.
 *
 * Тон намеренно спокойный. «Есть над чем поработать» вместо «слабый», и всегда
 * сказано, что делать дальше.
 */

import { useEffect, useState } from 'react'
import { Award, Loader2, TrendingDown, TrendingUp } from 'lucide-react'

import { OperatorPanel, OperatorPill } from '@/components/operator/operator-mobile-ui'
import { formatMoney } from '@/lib/core/format'

type KpiData = {
  available: boolean
  reason?: string
  month: string
  shifts?: number
  receipts?: number
  status?: string
  status_label?: string
  status_meaning?: string
  strengths?: string[]
  weaknesses?: string[]
  bonus?: {
    amount: number
    paid: boolean
    next_step: string | null
    strong: number
    top: number
  }
  exam?: {
    title: string
    score: number
    passed: boolean
    on: string
    gates_top_bonus: boolean
  } | null
}

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'default'> = {
  TOP: 'emerald',
  STRONG: 'emerald',
  NORMAL: 'default',
  NEEDS_TRAINING: 'amber',
  INSUFFICIENT_DATA: 'default',
}

export function SalesKpiCard() {
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/operator/sales-kpi', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (active) setData(j?.data ?? null)
      })
      .catch(() => {
        if (active) setData(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <OperatorPanel>
        <div className="flex items-center gap-2 text-[13px] text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Считаем ваши показатели…
        </div>
      </OperatorPanel>
    )
  }

  // Продавец без продаж в магазине этот блок вообще не видит: пустая карточка
  // с надписью «нет данных» только мешала бы.
  if (!data?.available) return null

  const bonus = data.bonus
  const tone = STATUS_TONE[data.status || 'NORMAL'] || 'default'

  return (
    <OperatorPanel accent={tone === 'default' ? 'default' : tone}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Как я работаю
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold uppercase tracking-tight text-zinc-50">
            {data.status_label}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-zinc-500">{data.status_meaning}</p>
        </div>
        <Award className="h-5 w-5 shrink-0 text-amber-400" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <OperatorPill>
          Смен за месяц: <span className="ml-1 font-semibold">{data.shifts}</span>
        </OperatorPill>
        <OperatorPill>
          Чеков: <span className="ml-1 font-semibold">{data.receipts}</span>
        </OperatorPill>
      </div>

      {(data.strengths?.length || 0) > 0 || (data.weaknesses?.length || 0) > 0 ? (
        <div className="mt-3 space-y-1.5 text-[13px] leading-5">
          {(data.strengths?.length || 0) > 0 ? (
            <div className="flex items-start gap-2 text-emerald-400">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Лучше обычного: {data.strengths?.join(', ').toLowerCase()}</span>
            </div>
          ) : null}
          {(data.weaknesses?.length || 0) > 0 ? (
            <div className="flex items-start gap-2 text-amber-400">
              <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Стоит подтянуть: {data.weaknesses?.join(', ').toLowerCase()}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Последний экзамен: человек должен видеть свой результат, иначе
          проверка знаний быстро превращается в формальность. */}
      {data.exam ? (
        <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                Проверка знаний
              </div>
              <div className="mt-1 truncate text-[13px] text-zinc-300">{data.exam.title}</div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={`font-mono text-xl font-semibold ${
                  data.exam.passed ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {data.exam.score}%
              </div>
              <div className="text-[11px] text-zinc-500">{data.exam.on}</div>
            </div>
          </div>

          <p className="mt-2 text-[12px] leading-5 text-zinc-500">
            {data.exam.passed
              ? 'Тест сдан.'
              : 'Тест не сдан — стоит перечитать регламент и пройти ещё раз.'}
            {data.exam.gates_top_bonus && !data.exam.passed
              ? ' Без сданного теста верхний уровень бонуса за смену не берётся.'
              : ''}
          </p>
        </div>
      ) : null}

      {bonus ? (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Доплата за качество
          </div>
          {bonus.amount > 0 ? (
            <>
              <div className="mt-1 font-mono text-xl font-semibold text-zinc-50">
                {formatMoney(bonus.amount)}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-zinc-500">
                {bonus.paid
                  ? 'Начислена — придёт вместе с зарплатой.'
                  : 'Посчитана. Начисляет управляющий в конце месяца.'}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] leading-5 text-zinc-500">
              {bonus.next_step}
              {' '}
              Сильный — {formatMoney(bonus.strong)}, топ — {formatMoney(bonus.top)}.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-zinc-600">
            Это доплата за работу с покупателем: средний чек, допродажи, товары в чеке. Ставка за смену и
            бонусы за оборот считаются отдельно и приходят как обычно.
          </p>
        </div>
      ) : null}
    </OperatorPanel>
  )
}
