'use client'

/**
 * Графики дашборда.
 *
 * Отдельный модуль нужен ради веса. Библиотека графиков — 382 КБ, и раньше она
 * лежала прямо в странице: качалась до того, как человек увидит хоть одну
 * цифру. Причём у каждой страницы с графиками была своя копия, поэтому переход
 * с дашборда на расходы качал эти 382 КБ заново.
 *
 * Теперь модуль подгружается по требованию, уже после первой отрисовки, и один
 * на все страницы: браузер берёт его из кэша.
 */

import type { ReactNode } from 'react'
import { LineChart } from 'lucide-react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { COLORS, DateUtils, Formatters, type CategoryData, type ChartPoint } from './chart-types'

export function ChartCard(props: {
  data: ChartPoint[]
  metric: 'income' | 'expense' | 'profit'
  showMovingAvg: boolean
  onToggleMovingAvg: () => void
}) {
  const metricName = props.metric === 'income' ? 'Доход' : props.metric === 'expense' ? 'Расход' : 'Прибыль'
  const metricColor = props.metric === 'income' ? COLORS.income : props.metric === 'expense' ? COLORS.expense : COLORS.profit

  return (
    <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/20 rounded-xl">
            <LineChart className="w-5 h-5 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Динамика: {metricName}</h3>
            <p className="text-xs text-slate-500">
              {props.data.length ? `с ${DateUtils.formatShort(props.data[0].date)} по ${DateUtils.formatShort(props.data[props.data.length - 1].date)}` : 'Нет данных'}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={props.onToggleMovingAvg}
          className="text-xs h-8 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:hover:bg-slate-700 dark:text-slate-200"
        >
          {props.showMovingAvg ? 'Скрыть среднее' : 'Показать среднее'}
        </Button>
      </div>

      {!props.data.length ? (
        <div className="h-80 flex items-center justify-center text-slate-500">Нет данных</div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={props.data}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" vertical={false} />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => Formatters.moneyDetailed(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                formatter={(val: any) => [Formatters.moneyDetailed(Number(val)), '']}
              />
              <Legend />

              <Area
                type="monotone"
                dataKey={props.metric}
                name={metricName}
                stroke={metricColor}
                strokeWidth={2}
                fill="url(#metricFill)"
              />

              {props.showMovingAvg && (
                <Line
                  type="monotone"
                  dataKey="movingAvg"
                  name="Среднее (7д)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 5"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

export function CategoryPie(props: { title: string; data: CategoryData[]; total: number; icon: ReactNode }) {
  return (
    <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-slate-100 dark:bg-slate-700/40 rounded-xl">{props.icon}</div>
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      </div>

      {!props.data.length ? (
        <div className="h-48 flex items-center justify-center text-slate-500">Нет данных</div>
      ) : (
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={props.data} dataKey="value" cx="50%" cy="50%" innerRadius="58%" outerRadius="88%" paddingAngle={2}>
                  {props.data.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                  formatter={(v: any) => [Formatters.moneyDetailed(Number(v)), '']}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-32 overflow-auto">
            {props.data.map((x, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: x.color }} />
                  <span className="text-body truncate max-w-[120px]">{x.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{Formatters.moneyDetailed(x.value)}</span>
                  <span className="text-slate-500">({x.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-border">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Всего</span>
              <span className="text-foreground font-medium">{Formatters.moneyDetailed(props.total)}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Способы оплаты — столбики.
 *
 * Вынесен из блока «Подробно» той же страницы: иначе библиотека графиков
 * осталась бы в ней и весь смысл разделения пропал бы.
 */
export function PaymentBars({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" />
                    <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                    <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.moneyDetailed(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                      itemStyle={{ color: '#fff' }}
                      labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                      formatter={(v: any) => Formatters.moneyDetailed(Number(v))}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {data.map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
  )
}
