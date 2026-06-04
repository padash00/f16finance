'use client'

import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/lib/utils'

// ── Industrial design system для кабинета оператора ──────────────────────────
// Тёплый чёрный фон, плоские панели, рамки 1px (без теней/блюра), моноширинный
// шрифт, tabular-цифры для денег, единственный сигнальный цвет — amber.
// Семантика: amber = акцент/итог, rose = удержание/долг, emerald = выплачено.

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
  const accented = accent !== 'default'
  return (
    <section
      className={cn(
        'relative border border-[#23262b] bg-[#0e0f10] p-4 sm:p-5',
        accented &&
          'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-amber-400/70 before:content-[""]',
        className,
      )}
    >
      {children}
    </section>
  )
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
        <div className="font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-zinc-100">{title}</div>
        {description ? <p className="mt-1.5 text-[13px] leading-5 text-zinc-500">{description}</p> : null}
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
  const valueColor =
    tone === 'red'
      ? 'text-rose-400'
      : tone === 'emerald'
        ? 'text-emerald-400'
        : tone === 'amber'
          ? 'text-amber-400'
          : 'text-zinc-50'

  return (
    <div className={cn('border border-[#23262b] bg-[#0e0f10] p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
          <div className={cn('mt-2 font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums', valueColor)}>{value}</div>
        </div>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-zinc-600" /> : null}
      </div>
      {hint ? <div className="mt-3 font-mono text-[11px] leading-4 text-zinc-500">{hint}</div> : null}
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
      ? 'border-emerald-500/40 text-emerald-300'
      : tone === 'amber'
        ? 'border-amber-500/40 text-amber-300'
        : tone === 'red'
          ? 'border-rose-500/40 text-rose-300'
          : 'border-zinc-700 text-zinc-300'

  return (
    <span className={cn('inline-flex items-center border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider tabular-nums', toneClass)}>
      {children}
    </span>
  )
}

export function OperatorEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="border border-dashed border-[#23262b] bg-[#0b0c0d] px-4 py-8 text-center">
      <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-zinc-200">{title}</div>
      <p className="mt-2 text-[13px] leading-5 text-zinc-500">{description}</p>
    </div>
  )
}
