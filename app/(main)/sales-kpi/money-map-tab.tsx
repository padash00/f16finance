'use client'

/**
 * Вкладка «Карта денег».
 *
 * После разделения «оборот платит зарплата, качество платит KPI» настройки
 * денег живут в двух местах. По отдельности каждое выглядит полным, а вместе
 * может противоречить — например, включённые сменные бонусы в KPI при
 * ненулевых порогах в правилах зарплаты означают двойную оплату смены.
 *
 * Экран отвечает на три вопроса: что где настроено, кто это менял и нет ли
 * противоречий.
 */

import { AlertTriangle, CheckCircle2, Coins, History, Loader2 } from 'lucide-react'
import Link from 'next/link'

import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'
import { useApi } from '@/lib/hooks/use-api'

import { SectionIntro } from './section-intro'

type SalaryRule = {
  id: number
  shift_type: string
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  low_turnover_threshold: number | null
  low_turnover_base: number | null
  effective_from: string | null
  is_active: boolean | null
}

type MoneyMap = {
  company: { id: string; name: string; code: string | null } | null
  kpi: {
    configured: boolean
    updated_at: string | null
    updated_by: string | null
    shift_bonus_paid: boolean
    b1_amount: number
    b2_amount: number
    b3_amount: number
    record_amount: number
    monthly_bonus_strong: number
    monthly_bonus_top: number
    percentiles: { control: number; b1: number; b2: number; b3: number }
    require_product_test_for_top_bonus: boolean
    weather_adjusts_bonus_threshold: boolean
  }
  salary_rules: SalaryRule[]
  conflicts: string[]
  changes: { at: string; who: string; entity: string; action: string; details: any }[]
}

function dt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Row(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0 dark:border-white/5">
      <span className="text-sm text-slate-600 dark:text-slate-300">{props.label}</span>
      <span className="text-sm font-medium text-slate-900 tabular-nums dark:text-white">{props.value}</span>
      {props.hint ? <span className="w-full text-xs text-slate-400">{props.hint}</span> : null}
    </div>
  )
}

export function MoneyMapTab(props: { companyId: string }) {
  const { data, loading } = useApi<{ data: MoneyMap }>(
    `/api/admin/sales-kpi/money-map?company_id=${props.companyId}`,
  )
  const payload = data?.data

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Собираем настройки денег…
      </Card>
    )
  }

  const kpi = payload?.kpi

  return (
    <div className="space-y-4">
      <SectionIntro
        icon={<Coins className="h-5 w-5" />}
        tone="slate"
        title="Где что настроено"
        what="Деньги продавца складываются из двух мест: ставка и бонусы за оборот — в правилах зарплаты, доплата за качество — здесь. По отдельности каждое выглядит правильным, а вместе может противоречить."
        todo={[
          'Проверить, не платится ли за одну смену дважды',
          'Посмотреть, кто и когда менял денежные настройки',
          'Открыть правила зарплаты, если пороги нужно поправить',
        ]}
        how="Слева — настоящие правила зарплаты этой точки, справа — настройки этого модуля. Внизу история изменений: кто, когда и с какой причиной."
      />

      {/* Противоречия */}
      {(payload?.conflicts || []).length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" /> На что обратить внимание
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-800 dark:text-amber-200">
            {(payload?.conflicts || []).map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="flex items-center gap-2 p-4 text-sm text-slate-600 dark:text-slate-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Настройки не противоречат друг другу: за оборот платят правила зарплаты, за качество — этот
          модуль.
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Правила зарплаты */}
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Правила зарплаты — платят за оборот
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ставка за смену и пороги по обороту. Живут отдельно от этого модуля.
          </p>

          {(payload?.salary_rules || []).length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Правил для этой точки нет
              {payload?.company?.code ? ` (код «${payload.company.code}»)` : ' — у точки не задан код'}.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {(payload?.salary_rules || []).map((r) => (
                <div key={r.id}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {r.shift_type === 'night' ? 'Ночная смена' : 'Дневная смена'}
                    {r.is_active === false ? ' · неактивно' : ''}
                    {r.effective_from ? ` · с ${r.effective_from}` : ''}
                  </div>
                  <Row label="Ставка за смену" value={formatMoney(r.base_per_shift || 0)} />
                  <Row
                    label="Порог 1"
                    value={
                      Number(r.threshold1_bonus || 0) > 0
                        ? `${formatMoney(r.threshold1_turnover || 0)} → +${formatMoney(r.threshold1_bonus || 0)}`
                        : 'не платится'
                    }
                  />
                  <Row
                    label="Порог 2"
                    value={
                      Number(r.threshold2_bonus || 0) > 0
                        ? `${formatMoney(r.threshold2_turnover || 0)} → +${formatMoney(r.threshold2_bonus || 0)}`
                        : 'не платится'
                    }
                  />
                  {Number(r.low_turnover_base || 0) > 0 ? (
                    <Row
                      label="Пониженная ставка"
                      value={`${formatMoney(r.low_turnover_base || 0)}`}
                      hint={`если оборот ниже ${formatMoney(r.low_turnover_threshold || 0)}`}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <Link
            href="/salary/rules"
            className="mt-3 inline-block text-xs text-sky-600 hover:underline dark:text-sky-400"
          >
            Открыть правила зарплаты
          </Link>
        </Card>

        {/* Настройки KPI */}
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Этот модуль — платит за качество
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {kpi?.configured
              ? `Последнее изменение: ${dt(kpi.updated_at)}${kpi.updated_by ? `, ${kpi.updated_by}` : ''}`
              : 'Настройки не сохранялись — действуют значения по умолчанию.'}
          </p>

          <div className="mt-3">
            <Row
              label="Месячный бонус «сильный»"
              value={formatMoney(kpi?.monthly_bonus_strong ?? 0)}
              hint="уходит в зарплату отдельной корректировкой"
            />
            <Row label="Месячный бонус «топ»" value={formatMoney(kpi?.monthly_bonus_top ?? 0)} />
            <Row
              label="Сменные бонусы B1/B2/B3"
              value={kpi?.shift_bonus_paid ? 'платятся отсюда' : 'не платятся — только цель'}
              hint={
                kpi?.shift_bonus_paid
                  ? `${formatMoney(kpi.b1_amount)} / ${formatMoney(kpi.b2_amount)} / ${formatMoney(kpi.b3_amount)}, рекорд ${formatMoney(kpi.record_amount)}`
                  : 'за оборот платят правила зарплаты'
              }
            />
            <Row
              label="Перцентили уровней"
              value={`${Math.round((kpi?.percentiles.control ?? 0) * 100)} / ${Math.round((kpi?.percentiles.b1 ?? 0) * 100)} / ${Math.round((kpi?.percentiles.b2 ?? 0) * 100)} / ${Math.round((kpi?.percentiles.b3 ?? 0) * 100)}`}
              hint="контроль / B1 / B2 / B3 по распределению выручки сегмента"
            />
            <Row
              label="Тест на знание товара"
              value={kpi?.require_product_test_for_top_bonus ? 'нужен для B3 и рекорда' : 'не требуется'}
            />
            <Row
              label="Погода двигает пороги"
              value={kpi?.weather_adjusts_bonus_threshold ? 'да' : 'нет'}
              hint="по умолчанию нет: продавец не отвечает за дождь"
            />
          </div>
        </Card>
      </div>

      {/* История изменений */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <History className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Кто что менял</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            только то, что двигает деньги людей
          </span>
        </div>

        {(payload?.changes || []).length === 0 ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
            Изменений пока не было.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {(payload?.changes || []).map((c, i) => (
              <div key={`${c.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="w-32 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {dt(c.at)}
                </span>
                <span className="font-medium text-slate-900 dark:text-white">{c.who}</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {c.entity} — {c.action}
                </span>
                {c.details?.reason ? (
                  <span className="w-full text-xs text-slate-500 dark:text-slate-400">
                    Причина: {String(c.details.reason)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
        Полный журнал всех действий — на странице «Журнал». Здесь только денежные настройки этой точки:
        план смены, месячный индекс, начисления, правила допродаж и сама модель.
      </p>
    </div>
  )
}
