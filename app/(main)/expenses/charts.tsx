'use client'

/**
 * Графики страницы расходов.
 *
 * Отдельный модуль ради веса: библиотека графиков — 382 КБ, и в самой странице
 * она качалась до того, как человек увидит хоть одну цифру. Здесь она
 * подгружается по требованию и общая с другими страницами — браузер берёт её
 * из кэша.
 *
 * Форматирование продублировано сознательно и минимально: тянуть его из
 * page.tsx нельзя — модуль графиков утащил бы за собой всю страницу, и
 * экономия исчезла бы.
 */

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const money = (v: number): string => {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + ' тыс ₸'
  return v.toLocaleString('ru-RU') + ' ₸'
}

const moneyDetailed = (v: number): string =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸'

const TOOLTIP = {
  contentStyle: {
    backgroundColor: '#1e1e2f',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: '12px 16px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
  },
  itemStyle: { color: '#fff' },
  labelStyle: { color: '#a0a0c0', fontSize: 12 },
} as const

/** Динамика расходов: заливка плюс скользящее среднее. */
export function ExpenseTrendChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" vertical={false} />
        <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => money(v)} />
        <Tooltip {...TOOLTIP} formatter={(val: number) => [moneyDetailed(val), '']} />
        <Area type="monotone" dataKey="total" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
        <Line
          type="monotone"
          dataKey="movingAvg"
          stroke="#fbbf24"
          strokeWidth={2}
          dot={false}
          strokeDasharray="5 5"
          name="Среднее (7 дней)"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Кольцо по категориям. */
export function ExpenseCategoryPie({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RePieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius="58%" outerRadius="88%" paddingAngle={2} dataKey="value">
          {data.map((entry: any, index: number) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(val: number) => [moneyDetailed(val), '']} contentStyle={TOOLTIP.contentStyle} />
      </RePieChart>
    </ResponsiveContainer>
  )
}

/** Наличные против безнала. */
export function ExpensePaymentBars({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" />
        <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
        <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => money(v)} />
        <Tooltip formatter={(v: number) => moneyDetailed(v)} contentStyle={TOOLTIP.contentStyle} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
