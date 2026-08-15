'use client'

/**
 * Объяснение вкладки — первое, что видно при её открытии.
 *
 * Модуль получился большим, и владелец справедливо сказал, что не понимает,
 * что за вкладка перед ним и что она делает. Поэтому каждая начинается с трёх
 * ответов: что это, что тут делать и как считается. Без терминов — если без
 * термина никак, он объясняется тут же.
 */

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'

export function SectionIntro(props: {
  icon: ReactNode
  /** Один из акцентов портала — чтобы вкладки различались на глаз. */
  tone: 'emerald' | 'sky' | 'amber' | 'violet' | 'slate'
  title: string
  /** Что это такое — одно-два предложения. */
  what: string
  /** Что здесь делать. Короткие пункты, по одному действию. */
  todo: string[]
  /** Откуда берутся числа. */
  how: string
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[props.tone]}`}>
          {props.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{props.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{props.what}</p>

          {props.todo.length > 0 ? (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Что тут делать
              </div>
              <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {props.todo.map((t) => (
                  <li key={t}>• {t}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <b className="text-slate-600 dark:text-slate-300">Откуда числа.</b> {props.how}
          </div>
        </div>
      </div>
    </Card>
  )
}
