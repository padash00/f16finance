'use client'

import type { ComponentType, ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type IconComponent = ComponentType<{ className?: string }>

export function OperatorPanel({
  children,
  className,
  accent = 'default',
}: {
  children: ReactNode
  className?: string
  accent?: 'default' | 'emerald' | 'blue' | 'amber' | 'violet'
}) {
  const accentClass =
    accent === 'emerald'
      ? 'bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]'
      : accent === 'blue'
        ? 'bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]'
        : accent === 'amber'
          ? 'bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]'
          : accent === 'violet'
            ? 'bg-[radial-gradient(circle_at_top_right,_rgba(139,92,246,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]'
            : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))]'

  return <Card className={cn('border-white/10 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)]', accentClass, className)}>{children}</Card>
}

export function OperatorSectionHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-lg font-semibold text-white">{title}</div>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function OperatorMetricCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  hint,
  className,
}: {
  label: string
  value: ReactNode
  icon?: IconComponent
  tone?: 'default' | 'emerald' | 'blue' | 'amber' | 'red' | 'violet'
  hint?: ReactNode
  className?: string
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-300'
      : tone === 'blue'
        ? 'bg-blue-500/15 text-blue-300'
        : tone === 'amber'
          ? 'bg-amber-500/15 text-amber-300'
          : tone === 'red'
            ? 'bg-red-500/15 text-red-300'
            : tone === 'violet'
              ? 'bg-violet-500/15 text-violet-300'
              : 'bg-white/[0.07] text-slate-300'

  return (
    <div className={cn('rounded-[1.4rem] border border-white/10 bg-slate-950/35 p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
          <div className="mt-2 text-xl font-semibold leading-tight text-white">{value}</div>
        </div>
        {Icon ? (
          <div className={cn('rounded-2xl p-2.5', toneClass)}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {hint ? <div className="mt-3 text-xs leading-5 text-slate-400">{hint}</div> : null}
    </div>
  )
}

export function OperatorPill({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'emerald' | 'amber' | 'blue' | 'red'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
      : tone === 'amber'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
        : tone === 'blue'
          ? 'border-blue-400/20 bg-blue-400/10 text-blue-200'
          : tone === 'red'
            ? 'border-red-400/20 bg-red-400/10 text-red-200'
            : 'border-white/10 bg-white/[0.05] text-slate-300'

  return <span className={cn('inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium', toneClass)}>{children}</span>
}

export function OperatorEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
      <div className="text-sm font-medium text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </div>
  )
}
