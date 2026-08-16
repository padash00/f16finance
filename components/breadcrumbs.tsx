'use client'

import { Fragment, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'

import { cn } from '@/lib/utils'
import { navSections } from '@/lib/nav/sections'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function humanizeSegment(segment: string): string {
  if (UUID_RE.test(segment)) return segment.slice(0, 8)
  if (/^\d+$/.test(segment)) return `#${segment}`
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

type Crumb = {
  href: string
  label: string
  sectionTitle?: string
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return []

  const crumbs: Crumb[] = []
  let fullPath = ''

  for (let i = 0; i < segments.length; i += 1) {
    fullPath += `/${segments[i]}`

    let matched: Crumb | null = null
    for (const section of navSections) {
      const item = section.items.find((navItem) => navItem.href === fullPath)
      if (item) {
        matched = { href: fullPath, label: item.label, sectionTitle: section.title }
        break
      }
    }

    if (matched) {
      crumbs.push(matched)
    } else {
      crumbs.push({
        href: fullPath,
        label: humanizeSegment(segments[i]),
      })
    }
  }

  return crumbs
}

export function Breadcrumbs() {
  const pathname = usePathname()

  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname])

  // В модуле «Магазин» свой StoreShell — хлебные крошки не показываем.
  if (pathname === '/store' || pathname.startsWith('/store/')) return null
  if (crumbs.length === 0) return null
  if (crumbs.length === 1 && (pathname === '/dashboard' || pathname === '/')) return null

  const sectionTitle = crumbs[0]?.sectionTitle

  return (
    <nav
      aria-label="Навигация"
      // Цвета из токенов темы, а не захардкоженные: с фиксированным slate
      // крошки на светлой теме выглядели чужими — серый текст на светлом фоне
      // и подсветка белым по белому.
      className="flex items-center gap-1 border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground md:px-6 xl:px-8"
    >
      <Link
        href="/dashboard"
        aria-label="На главную"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {sectionTitle ? (
        <>
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="rounded-md px-1.5 py-1">{sectionTitle}</span>
        </>
      ) : null}
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <Fragment key={crumb.href}>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            {isLast ? (
              // Текущая страница — не ссылка: на саму себя не ходят.
              <span
                aria-current="page"
                className="truncate rounded-md px-1.5 py-1 font-medium text-foreground"
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className={cn(
                  'truncate rounded-md px-1.5 py-1 transition-colors',
                  'hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {crumb.label}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
