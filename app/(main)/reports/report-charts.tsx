'use client'

/** Графики страницы /reports (recharts): динамика и выручка по компаниям. */

import { memo } from 'react'
import { ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar, Cell, ComposedChart, Line, Area } from 'recharts'
import { formatMoneyFull, formatCompact } from './report-shared'
import type { TimeAggregation } from './report-shared'

// =====================
// MEMOIZED CHART COMPONENTS
// =====================

export const MemoizedComposedChart = memo(({ data, onBucketClick }: { data: TimeAggregation[]; onBucketClick?: (row: TimeAggregation) => void }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 20, right: 20, bottom: 20, left: 0 }}
        style={onBucketClick ? { cursor: 'pointer' } : undefined}
        onClick={(state: any) => {
          const row = state?.activePayload?.[0]?.payload as TimeAggregation | undefined
          if (row && onBucketClick) onBucketClick(row)
        }}
      >
        <defs>
          <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} vertical={false} />
        <XAxis 
          dataKey="label" 
          stroke="#6b7280" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false}
          tickMargin={10}
        />
        <YAxis 
          stroke="#6b7280" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false} 
          tickFormatter={formatCompact}
          width={60}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px',
            backdropFilter: 'blur(10px)'
          }}
          labelFormatter={(label: any) => `Дата: ${label}`}
          formatter={(value: number, name: string) => {
            const ru = name === 'income' ? 'Доход' : name === 'expense' ? 'Расход' : name === 'profit' ? 'Прибыль' : name
            return [formatMoneyFull(value), ru]
          }}
        />
        <Area 
          type="monotone" 
          dataKey="income" 
          stroke="#10b981" 
          strokeWidth={2}
          fill="url(#colorIncome)" 
        />
        <Area 
          type="monotone" 
          dataKey="expense" 
          stroke="#f43f5e" 
          strokeWidth={2}
          fill="url(#colorExpense)" 
        />
        <Line 
          type="monotone" 
          dataKey="profit" 
          stroke="#fbbf24" 
          strokeWidth={3}
          dot={{ fill: '#fbbf24', strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
})
MemoizedComposedChart.displayName = 'MemoizedComposedChart'


export const MemoizedBarChart = memo(({ data, onBarClick }: {
  data: Array<{ companyId?: string; name: string; value: number; fill: string; percentage: number }>
  onBarClick?: (companyId: string) => void
}) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis 
          type="category" 
          dataKey="name" 
          width={100}
          stroke="#6b7280" 
          fontSize={11} 
          tickLine={false} 
          axisLine={false}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px' 
          }}
          formatter={(v: number, _n: string, p: { payload?: { percentage?: number } }) => [
            formatMoneyFull(v),
            `${p?.payload?.percentage?.toFixed(1)}% от общей`
          ]}
        />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          cursor={onBarClick ? 'pointer' : undefined}
          onClick={(entry: any) => {
            const id = entry?.companyId ?? entry?.payload?.companyId
            if (id && onBarClick) onBarClick(String(id))
          }}
        >
          {data.map((entry, idx) => (
            <Cell key={`bar-${idx}`} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
})
MemoizedBarChart.displayName = 'MemoizedBarChart'
