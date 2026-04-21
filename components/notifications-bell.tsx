'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, Cake, ClipboardList, Receipt } from 'lucide-react'

import { cn } from '@/lib/utils'

type NotificationItem = {
  id: string
  title: string
  subtitle?: string | null
  href?: string | null
  date?: string | null
}

type NotificationGroup = {
  id: string
  label: string
  icon: 'clipboard' | 'cake' | 'receipt' | 'alert'
  href: string
  count: number
  items: NotificationItem[]
}

const iconMap = {
  clipboard: ClipboardList,
  cake: Cake,
  receipt: Receipt,
  alert: AlertTriangle,
} as const

const REFRESH_INTERVAL_MS = 60_000

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState(0)
  const [groups, setGroups] = useState<NotificationGroup[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/notifications', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok) {
        setTotal(Number(body.data?.total || 0))
        setGroups(Array.isArray(body.data?.groups) ? body.data.groups : [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((c) => !c)
          if (!open) load()
        }}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/70 transition hover:border-amber-500/20 hover:text-white',
          open ? 'text-white border-amber-500/30' : 'text-slate-400',
        )}
        aria-label="Уведомления"
      >
        <Bell className="h-4 w-4" />
        {total > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full border border-slate-950 bg-red-500 px-1 text-[10px] font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[360px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Уведомления</p>
              <p className="text-[11px] text-slate-500">
                {total > 0 ? `${total} ожидают внимания` : 'Всё в порядке'}
              </p>
            </div>
            {loading ? (
              <div className="h-3 w-3 animate-pulse rounded-full bg-amber-500/60" />
            ) : null}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {groups.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                {loading ? 'Загружаем...' : 'Пусто — всё разобрали'}
              </div>
            ) : (
              groups.map((group) => {
                const GroupIcon = iconMap[group.icon] || Bell
                return (
                  <div key={group.id} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between px-3 py-1">
                      <div className="flex items-center gap-2">
                        <GroupIcon className="h-3.5 w-3.5 text-amber-300" />
                        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{group.label}</span>
                        <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                          {group.count}
                        </span>
                      </div>
                      <Link
                        href={group.href}
                        onClick={() => setOpen(false)}
                        className="text-[11px] text-slate-400 transition hover:text-amber-300"
                      >
                        все →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <Link
                          key={item.id}
                          href={item.href || group.href}
                          onClick={() => setOpen(false)}
                          className="flex items-start gap-3 rounded-xl px-3 py-2 text-slate-300 transition hover:bg-white/5 hover:text-white"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/70 text-slate-400">
                            <GroupIcon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.title}</p>
                            {item.subtitle ? (
                              <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                            ) : null}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
