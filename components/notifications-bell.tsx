'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, Cake, Check, ClipboardList, Receipt } from 'lucide-react'

import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabaseClient'

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

// Бэкап-обновление раз в 90 сек, если realtime отвалился.
const REFRESH_INTERVAL_MS = 90_000
// Дебаунс между приходом события и rеshooting к API.
const REALTIME_DEBOUNCE_MS = 600
const READ_AT_KEY = 'f16.notifications.lastReadAt'
const SEEN_IDS_KEY = 'f16.notifications.seenIds'
const SEEN_IDS_MAX = 500  // храним до 500 последних

function readLastReadAt(): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(READ_AT_KEY)
  const value = raw ? Number(raw) : 0
  return Number.isFinite(value) ? value : 0
}

function writeLastReadAt(value: number) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_AT_KEY, String(value))
}

function readSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(SEEN_IDS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeSeenIds(ids: Set<string>) {
  if (typeof window === 'undefined') return
  const arr = Array.from(ids).slice(-SEEN_IDS_MAX)
  try { window.localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(arr)) } catch {}
}

function isItemNew(item: NotificationItem, lastReadAt: number, seenIds: Set<string>): boolean {
  // Если ID уже отмечен как просмотренный — не новый (главный фикс).
  if (seenIds.has(item.id)) return false
  // Без timestamp и не в seen — считаем новым (только что появился).
  if (!item.date) return true
  const ts = new Date(item.date).getTime()
  if (!Number.isFinite(ts)) return true
  return ts > lastReadAt
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<NotificationGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<number>(0)
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Восстанавливаем «прочитано до» и seen IDs при первом монтировании.
  useEffect(() => {
    setLastReadAt(readLastReadAt())
    setSeenIds(readSeenIds())
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/notifications', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok) {
        setGroups(Array.isArray(body.data?.groups) ? body.data.groups : [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Дебаунсенный триггер для realtime: раз в 600 мс собираем все события в один fetch.
  const scheduleReload = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => load(), REALTIME_DEBOUNCE_MS)
  }, [load])

  // Initial load + бэкап-poll.
  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  // Realtime подписка: при любом INSERT/UPDATE/DELETE в таблицах источников — релоад.
  useEffect(() => {
    const channel = supabase
      .channel('notifications-bell')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_requests' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_balances' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, scheduleReload)
      .subscribe()

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [scheduleReload])

  // Закрытие по клику вне.
  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Синхронизация между вкладками браузера.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key === READ_AT_KEY) {
        const value = event.newValue ? Number(event.newValue) : 0
        setLastReadAt(Number.isFinite(value) ? value : 0)
      } else if (event.key === SEEN_IDS_KEY) {
        setSeenIds(readSeenIds())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Счётчик «новых» — то что добавилось/изменилось после lastReadAt.
  const unreadTotal = groups.reduce((sum, group) => {
    const newItems = group.items.filter((item) => isItemNew(item, lastReadAt, seenIds)).length
    return sum + newItems
  }, 0)

  // Грубое total для подписи внутри попапа.
  const total = groups.reduce((sum, g) => sum + g.count, 0)

  const handleMarkAllRead = () => {
    const now = Date.now()
    writeLastReadAt(now)
    setLastReadAt(now)
    // Сохраняем ID всех текущих айтемов как "просмотренные" — критично для
    // айтемов без даты (низкие остатки, долги). Без этого они оставались
    // "новыми" даже после нажатия "Прочитать всё".
    const allIds = new Set(seenIds)
    for (const group of groups) {
      for (const item of group.items) allIds.add(item.id)
    }
    writeSeenIds(allIds)
    setSeenIds(allIds)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((c) => !c)
          if (!open) load()
        }}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white transition hover:border-amber-500/20 hover:text-slate-900 dark:border-white/10 dark:bg-slate-900/70 dark:hover:text-white',
          open ? 'text-slate-900 border-amber-500/30 dark:text-white dark:border-amber-500/30' : 'text-slate-500 dark:text-slate-400',
        )}
        aria-label="Уведомления"
      >
        <Bell className={cn('h-4 w-4', unreadTotal > 0 && 'animate-pulse')} />
        {unreadTotal > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full border border-white bg-red-500 px-1 text-[10px] font-bold text-white dark:border-slate-950">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Уведомления</p>
              <p className="text-[11px] text-slate-500">
                {unreadTotal > 0
                  ? `${unreadTotal} новых · всего ${total}`
                  : total > 0
                    ? `${total} ожидают внимания`
                    : 'Всё в порядке'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {loading ? <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500/70" /> : null}
              {unreadTotal > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 transition hover:border-emerald-500/40 hover:bg-emerald-500/20 dark:text-emerald-300"
                  title="Отметить все как прочитанные"
                >
                  <Check className="h-3 w-3" />
                  Прочитать всё
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {groups.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                {loading ? 'Загружаем...' : 'Пусто — всё разобрали'}
              </div>
            ) : (
              groups.map((group) => {
                const GroupIcon = iconMap[group.icon] || Bell
                const newCount = group.items.filter((item) => isItemNew(item, lastReadAt, seenIds)).length
                return (
                  <div key={group.id} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between px-3 py-1">
                      <div className="flex items-center gap-2">
                        <GroupIcon className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
                        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{group.label}</span>
                        <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                          {group.count}
                        </span>
                        {newCount > 0 ? (
                          <span className="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-300">
                            +{newCount}
                          </span>
                        ) : null}
                      </div>
                      <Link
                        href={group.href}
                        onClick={() => setOpen(false)}
                        className="text-[11px] text-slate-400 transition hover:text-amber-600 dark:hover:text-amber-300"
                      >
                        все →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const isNew = isItemNew(item, lastReadAt, seenIds)
                        return (
                          <Link
                            key={item.id}
                            href={item.href || group.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              'flex items-start gap-3 rounded-xl px-3 py-2 transition',
                              isNew
                                ? 'bg-red-500/[0.04] text-slate-900 hover:bg-red-500/10 dark:text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white',
                            )}
                          >
                            <div className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                              isNew ? 'bg-red-500/15 text-red-600 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400',
                            )}>
                              <GroupIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium">{item.title}</p>
                                {isNew ? (
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 animate-pulse" />
                                ) : null}
                              </div>
                              {item.subtitle ? (
                                <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                              ) : null}
                            </div>
                          </Link>
                        )
                      })}
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
