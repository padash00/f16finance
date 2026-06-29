'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { buildOwnerNavSections, navSections } from '@/lib/nav/sections'
import { useNavSession } from '@/lib/nav/use-nav-session'

type ShortcutDef = {
  keys: string
  label: string
  href: string
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (target.isContentEditable) return true
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const session = useNavSession()
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingRef = useRef<{ key: 'g'; expiresAt: number } | null>(null)

  const baseSections = useMemo(() => {
    if (!session.isSuperAdmin && session.staffRole === 'owner') return buildOwnerNavSections()
    return navSections
  }, [session.isSuperAdmin, session.staffRole])

  const visibleHrefs = useMemo(() => {
    return new Set(
      baseSections
        .map(session.filterSection)
        .flatMap((section) => section.items)
        .map((item) => item.href),
    )
  }, [baseSections, session])

  const shortcuts = useMemo<ShortcutDef[]>(() => {
    const all: ShortcutDef[] = [
      { keys: 'g d', label: 'Дашборд', href: '/dashboard' },
      { keys: 'g s', label: 'Склад', href: '/store/warehouse' },
      { keys: 'g w', label: 'Витрина', href: '/store/showcase' },
      { keys: 'g r', label: 'Заявки', href: '/store/requests' },
      { keys: 'g j', label: 'Журнал заявок', href: '/store/requests-journal' },
      { keys: 'g o', label: 'Операторы', href: '/operators' },
      { keys: 'g t', label: 'Задачи', href: '/tasks' },
      { keys: 'g p', label: 'POS', href: '/pos' },
    ]
    return all.filter((item) => visibleHrefs.has(item.href))
  }, [visibleHrefs])

  const jumpMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of shortcuts) {
      const key = item.keys.split(' ')[1]
      if (key) map.set(key, item.href)
    }
    return map
  }, [shortcuts])

  useEffect(() => {
    pendingRef.current = null
  }, [pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      const isQuestionMark = event.key === '?' || (event.key === '/' && event.shiftKey)
      if (isQuestionMark) {
        event.preventDefault()
        setHelpOpen(true)
        pendingRef.current = null
        return
      }

      if (key === 'escape' && helpOpen) {
        event.preventDefault()
        setHelpOpen(false)
        pendingRef.current = null
        return
      }

      const pending = pendingRef.current
      const now = Date.now()

      if (pending && now <= pending.expiresAt) {
        const href = jumpMap.get(key)
        pendingRef.current = null
        if (href) {
          event.preventDefault()
          router.push(href)
        }
        return
      }

      pendingRef.current = null
      if (key === 'g') {
        pendingRef.current = { key: 'g', expiresAt: now + 1500 }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [helpOpen, jumpMap, router])

  if (!helpOpen) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/70 p-6 pt-[12vh] backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => setHelpOpen(false)} aria-hidden />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-white dark:bg-slate-950/95 shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Горячие клавиши навигации</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Нажмите `g`, затем вторую клавишу за 1.5 сек</p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
          {shortcuts.map((item) => (
            <div key={item.keys} className="rounded-xl border border-border bg-slate-50 dark:bg-white/[0.02] px-3 py-2">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-0.5 text-sm font-medium text-amber-600 dark:text-amber-300">{item.keys}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
