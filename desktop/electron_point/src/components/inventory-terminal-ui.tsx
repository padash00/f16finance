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

export function InventorySectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  sticky = false,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  sticky?: boolean
}) {
  return (
    <section
      className={cn(
        'rounded-3xl border border-white/10 bg-card/80 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-sm',
        sticky ? 'sticky top-0' : '',
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>
            ) : null}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export function InventoryActionChip({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled = false,
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition hover:border-emerald-400/30 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {Icon ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-foreground">
          <Icon className="h-4 w-4" />
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </button>
  )
}

export function InventoryNotice({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'emerald' | 'amber' | 'blue'
}) {
  const classes =
    tone === 'emerald'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : tone === 'amber'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
        : tone === 'blue'
          ? 'border-blue-500/20 bg-blue-500/10 text-blue-200'
          : 'border-white/10 bg-white/[0.04] text-muted-foreground'

  return <div className={cn('rounded-2xl border px-4 py-3 text-sm', classes)}>{children}</div>
}
