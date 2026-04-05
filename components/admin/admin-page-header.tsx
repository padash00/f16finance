'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const ACCENT = {
  emerald: {
    card: 'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]',
    iconWrap: 'bg-emerald-500/15 text-emerald-300',
  },
  amber: {
    card: 'bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]',
    iconWrap: 'bg-amber-500/15 text-amber-300',
  },
  violet: {
    card: 'bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.12),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]',
    iconWrap: 'bg-violet-500/15 text-violet-300',
  },
  blue: {
    card: 'bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]',
    iconWrap: 'bg-blue-500/15 text-blue-300',
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
    <Card
      className={cn(
        'overflow-hidden border-white/10 p-4 md:p-5',
        a.card,
        props.className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={back}
            className="shrink-0 text-slate-400 transition hover:text-white"
            aria-label="Назад"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className={cn('shrink-0 rounded-xl p-2', a.iconWrap)}>{props.icon}</div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-white">{props.title}</h1>
            {props.description ? (
              <p className="mt-0.5 text-xs text-slate-500">{props.description}</p>
            ) : null}
          </div>
        </div>
        {props.actions ? (
          <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
        ) : null}
      </div>
      {props.toolbar ? <div className="mt-4 flex flex-col gap-3">{props.toolbar}</div> : null}
    </Card>
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
        'relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]',
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
  'sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-wide text-slate-500 backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.06)]'
