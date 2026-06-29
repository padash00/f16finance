'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { cn } from '@/lib/utils'

// Soft modern: тёмный, но тёплый — мягкое цветное свечение по углам,
// градиентный чип-иконка, плавные закругления. Акцент задаёт оттенок свечения.
const ACCENT = {
  emerald: {
    glow1: 'bg-emerald-500/15',
    glow2: 'bg-sky-500/10',
    chip: 'from-emerald-400/30 to-sky-400/20 text-emerald-700 dark:text-emerald-100',
  },
  amber: {
    glow1: 'bg-amber-500/15',
    glow2: 'bg-orange-500/10',
    chip: 'from-amber-400/30 to-orange-400/20 text-amber-700 dark:text-amber-100',
  },
  violet: {
    glow1: 'bg-violet-500/15',
    glow2: 'bg-fuchsia-500/10',
    chip: 'from-violet-400/30 to-fuchsia-400/20 text-violet-700 dark:text-violet-100',
  },
  blue: {
    glow1: 'bg-sky-500/15',
    glow2: 'bg-indigo-500/10',
    chip: 'from-sky-400/30 to-indigo-400/20 text-sky-700 dark:text-sky-100',
  },
} as const

export type AdminPageAccent = keyof typeof ACCENT

export function AdminPageHeader(props: {
  title: string
  description?: string
  icon: ReactNode
  accent?: AdminPageAccent
  backHref?: string
  actions?: ReactNode
  /** Вторая строка: табы, фильтры, чипы */
  toolbar?: ReactNode
  className?: string
}) {
  const a = ACCENT[props.accent ?? 'emerald']
  const back = props.backHref ?? '/'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 dark:border-white/10 dark:bg-slate-900/60 dark:shadow-black/25 p-5',
        props.className,
      )}
    >
      <div className={cn('pointer-events-none absolute -left-16 -top-24 h-52 w-52 rounded-full blur-3xl', a.glow1)} />
      <div className={cn('pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full blur-3xl', a.glow2)} />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <Link
            href={back}
            className="shrink-0 text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            aria-label="Назад"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-gradient-to-br', a.chip)}>
            {props.icon}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{props.title}</h1>
            {props.description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{props.description}</p>
            ) : null}
          </div>
        </div>
        {props.actions ? (
          <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
        ) : null}
      </div>
      {props.toolbar ? <div className="relative mt-4 flex flex-col gap-3">{props.toolbar}</div> : null}
    </div>
  )
}

/** Обёртка для широких таблиц: горизонтальный скролл, опционально вертикаль + липкая шапка */
export function AdminTableViewport(props: {
  children: ReactNode
  /** Например min(70vh, 32rem) — для длинных списков */
  maxHeight?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]',
        props.className,
      )}
    >
      <div
        className={cn(
          'overflow-x-auto',
          props.maxHeight ? 'overflow-y-auto' : '',
        )}
        style={props.maxHeight ? { maxHeight: props.maxHeight } : undefined}
      >
        {props.children}
      </div>
    </div>
  )
}

/** Класс для &lt;thead&gt; внутри AdminTableViewport с maxHeight */
export const adminTableStickyTheadClass =
  'sticky top-0 z-10 border-b border-slate-200 bg-white/95 text-xs uppercase tracking-wide text-slate-500 backdrop-blur-md shadow-[0_1px_0_0_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-slate-950/95 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.06)]'
