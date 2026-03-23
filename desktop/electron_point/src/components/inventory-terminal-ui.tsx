import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type Accent = 'emerald' | 'amber' | 'blue' | 'violet'

const accentStyles: Record<Accent, { panel: string; icon: string; glow: string }> = {
  emerald: {
    panel: 'border-emerald-500/20 bg-emerald-500/10',
    icon: 'bg-emerald-500/15 text-emerald-300',
    glow: 'shadow-[0_0_0_1px_rgba(16,185,129,0.15)]',
  },
  amber: {
    panel: 'border-amber-500/20 bg-amber-500/10',
    icon: 'bg-amber-500/15 text-amber-300',
    glow: 'shadow-[0_0_0_1px_rgba(245,158,11,0.15)]',
  },
  blue: {
    panel: 'border-blue-500/20 bg-blue-500/10',
    icon: 'bg-blue-500/15 text-blue-300',
    glow: 'shadow-[0_0_0_1px_rgba(59,130,246,0.15)]',
  },
  violet: {
    panel: 'border-violet-500/20 bg-violet-500/10',
    icon: 'bg-violet-500/15 text-violet-300',
    glow: 'shadow-[0_0_0_1px_rgba(139,92,246,0.15)]',
  },
}

export function InventoryHeroPanel({
  icon: Icon,
  title,
  description,
  accent = 'emerald',
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  accent?: Accent
  children?: ReactNode
}) {
  const style = accentStyles[accent]
  return (
    <div className={cn('rounded-3xl border p-5', style.panel, style.glow)}>
      <div className="flex items-start gap-4">
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', style.icon)}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}

export function InventoryMetric({
  label,
  value,
  hint,
  accent = 'emerald',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  accent?: Accent
}) {
  const style = accentStyles[accent]
  return (
    <div className={cn('rounded-2xl border px-4 py-3', style.panel)}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function InventoryEmptyState({
  title,
  description,
  compact = false,
}: {
  title: string
  description: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-white/10 px-4 text-center text-sm text-muted-foreground',
        compact ? 'py-6' : 'py-10',
      )}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-2">{description}</p>
    </div>
  )
}
