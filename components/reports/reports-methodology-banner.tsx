'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react'

type Props = {
  dateFrom: string
  dateTo: string
  comparisonMode: boolean
  impreciseNightKaspiCount: number
  companyId: string
}

export function ReportsMethodologyBanner({
  dateFrom,
  dateTo,
  comparisonMode,
  impreciseNightKaspiCount,
  companyId,
}: Props) {
  const [open, setOpen] = useState(false)

  const incomeHref = useMemo(() => {
    const p = new URLSearchParams({ from: dateFrom, to: dateTo })
    if (companyId !== 'all') p.set('company_id', companyId)
    return `/income?${p.toString()}`
  }, [dateFrom, dateTo, companyId])

  const kaspiHref = useMemo(() => {
    const p = new URLSearchParams({ from: dateFrom, to: dateTo, tab: 'reconciliation' })
    if (companyId !== 'all') p.set('company_id', companyId)
    return `/kaspi-terminal?${p.toString()}`
  }, [dateFrom, dateTo, companyId])

  return (
    <div className="rounded-2xl border border-white/10 bg-gray-900/30 backdrop-blur-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0 text-violet-400" /> : <ChevronRight className="w-4 h-4 shrink-0 text-violet-400" />}
        <Info className="w-4 h-4 shrink-0 text-violet-400" />
        <span className="font-medium text-white">Как формируется отчёт</span>
        {impreciseNightKaspiCount > 0 && (
          <span className="ml-auto text-xs text-amber-400 whitespace-nowrap">
            Ночных смен без «Безналичный до 00:00»: {impreciseNightKaspiCount}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 space-y-3 text-sm text-gray-400 border-t border-white/5">
          <ul className="list-disc pl-5 space-y-1.5 pt-3">
            <li>
              Сводка строится по строкам <strong className="text-gray-200">доходов</strong> и{' '}
              <strong className="text-gray-200">расходов</strong> за выбранный период; при включённом сравнении второй столбец — предыдущий период той же длины
              {comparisonMode ? ' (включено).' : '.'}
            </li>
            <li>
              Для <strong className="text-gray-200">ночных смен</strong> Безналичный в этом отчёте делится по календарным суткам: сумма до полуночи остаётся на дате смены, остаток переносится на следующий день (если заполнено поле «Безналичный до 00:00» в доходах).
            </li>
            <li>
              Если у ночной смены есть Безналичный, но нет разбивки до полуночи, суточное распределение Безналичный в отчёте может быть неточным — заполните поле в доходах.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link
              href={incomeHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
            >
              Доходы за период
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </Link>
            <Link
              href={kaspiHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
            >
              Сверка Безналичный с доходами
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
