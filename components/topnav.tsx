'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Building2,
  ChevronDown,
  Command,
  LifeBuoy,
  LogOut,
  Search,
  Shield,
  User,
} from 'lucide-react'

import { AppLogoMark } from '@/components/app-brand-mark'
import { NotificationsBell } from '@/components/notifications-bell'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { SITE_NAME } from '@/lib/core/site'
import { cn } from '@/lib/utils'
import type { SessionRoleInfo } from '@/lib/core/types'
import {
  badgeColors,
  buildOwnerNavSections,
  navSections,
  sectionStyles,
  type NavItem,
  type NavSection,
} from '@/lib/nav/sections'
import { useNavSession } from '@/lib/nav/use-nav-session'

function isActiveItem(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
}

function MegaMenuItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all duration-200',
        active
          ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-foreground'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200',
          active
            ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-500 dark:text-amber-400'
            : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800/50 dark:group-hover:bg-slate-800 dark:group-hover:text-slate-300',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-sm font-medium', active ? 'text-foreground' : 'text-slate-700 group-hover:text-slate-900 dark:text-slate-200 dark:group-hover:text-white')}>
            {item.label}
          </span>
          {item.badge ? (
            <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', badgeColors[item.badgeColor || 'default'])}>
              {item.badge}
            </span>
          ) : null}
          {item.isNew ? (
            <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              new
            </span>
          ) : null}
        </div>
        {item.note ? (
          <p className={cn('mt-0.5 line-clamp-1 text-xs', active ? 'text-muted-foreground' : 'text-slate-500 group-hover:text-slate-500 dark:group-hover:text-slate-400')}>
            {item.note}
          </p>
        ) : null}
      </div>
    </Link>
  )
}

function MegaMenuPanel({
  section,
  pathname,
  align,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  align: 'start' | 'center' | 'end'
  onNavigate: () => void
}) {
  const count = section.items.length
  const columns = count > 12 ? 3 : count > 6 ? 2 : 1
  const style = sectionStyles[section.accentColor]

  const widthClass = columns === 3 ? 'w-[780px]' : columns === 2 ? 'w-[560px]' : 'w-[320px]'
  const alignClass = align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'

  return (
    <div
      className={cn(
        'absolute top-full z-50 mt-2 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl',
        widthClass,
        alignClass,
      )}
    >
      <div className={cn('mb-2 flex items-center gap-2 rounded-xl border px-3 py-2', style.bg, style.border)}>
        <section.icon className={cn('h-4 w-4', style.text)} />
        <div>
          <p className={cn('text-sm font-semibold', style.text)}>{section.title}</p>
          <p className="text-[11px] text-slate-500">{section.subtitle}</p>
        </div>
      </div>
      <div
        className={cn(
          'grid gap-1',
          columns === 3 ? 'grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        {section.items.map((item) => (
          <MegaMenuItem
            key={item.href}
            item={item}
            active={isActiveItem(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}

function SectionButton({
  section,
  pathname,
  isOpen,
  onOpen,
  onClose,
  align,
}: {
  section: NavSection
  pathname: string
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  align: 'start' | 'center' | 'end'
}) {
  const style = sectionStyles[section.accentColor]
  const active = section.items.some((item) => isActiveItem(pathname, item.href))
  const SectionIcon = section.icon
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(onClose, 150)
  }

  useEffect(() => () => cancelClose(), [])

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose()
        if (!section.homeHref) onOpen()
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => {
          if (section.homeHref) {
            router.push(section.homeHref)
            onClose()
          } else {
            isOpen ? onClose() : onOpen()
          }
        }}
        className={cn(
          'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
          active
            ? cn('text-foreground', style.bg, 'border', style.border)
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white border border-transparent',
          isOpen && !active && 'bg-slate-100 text-slate-900 dark:bg-white/5 dark:text-white',
        )}
      >
        <SectionIcon className={cn('h-4 w-4', active ? style.text : 'text-muted-foreground')} />
        <span className="hidden lg:inline">{section.title}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-slate-500 transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && !section.homeHref ? (
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <MegaMenuPanel section={section} pathname={pathname} align={align} onNavigate={onClose} />
        </div>
      ) : null}
    </div>
  )
}

function OrganizationMenu({
  organizations,
  activeOrganization,
  onSelect,
  disabled,
  editable,
}: {
  organizations: NonNullable<SessionRoleInfo['organizations']>
  activeOrganization: SessionRoleInfo['activeOrganization']
  onSelect: (organizationId: string) => Promise<void>
  disabled: boolean
  editable: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!activeOrganization && !organizations.length) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => editable && setOpen((c) => !c)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/70 px-3 py-2 text-left transition hover:border-amber-500/20',
          !editable && 'cursor-default',
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
          <Building2 className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
        </div>
        <div className="hidden min-w-0 max-w-[180px] md:block">
          <p className="truncate text-xs font-semibold text-foreground">
            {activeOrganization?.name || organizations[0]?.name || 'Не выбрана'}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {disabled ? 'Переключаем...' : `${organizations.length} ${organizations.length === 1 ? 'организация' : 'организации'}`}
          </p>
        </div>
        {editable ? <ChevronDown className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} /> : null}
      </button>

      {open && editable ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[300px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
          <div className="mb-1 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">Доступные организации</div>
          <div className="space-y-1">
            {organizations.map((organization) => {
              const isActive = activeOrganization?.id === organization.id
              return (
                <button
                  key={organization.id}
                  type="button"
                  disabled={disabled || isActive}
                  onClick={async () => {
                    await onSelect(organization.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    isActive
                      ? 'border-emerald-500/20 bg-emerald-500/10'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.04]',
                    (disabled || isActive) && 'cursor-default',
                  )}
                >
                  <div className={cn('mt-0.5 h-2.5 w-2.5 rounded-full', isActive ? 'bg-emerald-400' : 'bg-slate-400 dark:bg-slate-600')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{organization.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {organization.slug} · {organization.accessRole}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function UserMenu({
  onLogout,
  email,
  displayName,
  roleLabel,
}: {
  onLogout: () => Promise<void>
  email: string | null
  displayName: string | null
  roleLabel: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

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
        onClick={() => setOpen((c) => !c)}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/70 px-2.5 py-1.5 text-left transition hover:border-amber-500/20"
      >
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-amber-50 dark:border-white/10 dark:bg-gradient-to-br dark:from-slate-800 dark:to-slate-700">
          <User className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
        </div>
        <div className="hidden min-w-0 max-w-[140px] lg:block">
          <p className="truncate text-xs font-semibold text-foreground">{displayName || 'Панель'}</p>
          <p className="truncate text-[10px] text-slate-500">{roleLabel || 'control'}</p>
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[280px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 dark:border-white/5 dark:bg-white/[0.02] p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-amber-50 dark:border-white/10 dark:bg-gradient-to-br dark:from-slate-800 dark:to-slate-700">
              <User className="h-5 w-5 text-amber-500 dark:text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{displayName || 'Панель управления'}</p>
              <p className="truncate text-xs text-slate-500">{email || 'admin@system.local'}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1">
              <LifeBuoy className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">online</span>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 dark:border-white/5 dark:bg-slate-800 px-2 py-1">
              <Shield className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-body">{roleLabel || 'control'}</span>
            </div>
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 dark:border-white/5 dark:bg-slate-800/50 px-3 py-2 text-sm text-body transition-all duration-300 hover:border-violet-500/20 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300"
          >
            <User className="h-4 w-4" />
            Мой профиль
            <span className="ml-auto text-[10px] text-slate-500">пароль · email · имя</span>
          </Link>
          <Button
            variant="ghost"
            onClick={async () => {
              setOpen(false)
              await onLogout()
            }}
            className="mt-2 w-full justify-between rounded-xl border border-slate-200 bg-slate-50 dark:border-white/5 dark:bg-slate-800/50 px-3 py-2 text-body transition-all duration-300 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          >
            <span className="flex items-center gap-2 text-sm">
              <LogOut className="h-4 w-4" />
              Выйти
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function SearchPalette({
  open,
  onClose,
  sections,
  pathname,
}: {
  open: boolean
  onClose: () => void
  sections: NavSection[]
  pathname: string
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return sections.slice(0, 3).map((section) => ({
        section,
        items: section.items.slice(0, 6),
      }))
    }
    return sections
      .map((section) => ({
        section,
        items: section.items.filter((item) =>
          `${item.label} ${item.note || ''} ${section.title}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [query, sections])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/70 p-6 pt-[10vh] backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/95 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-white/5 px-4 py-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск страниц..."
            className="flex-1 bg-transparent text-sm text-body placeholder:text-slate-500 outline-none"
          />
          <kbd className="rounded-md border border-slate-200 bg-slate-100 text-slate-500 dark:border-white/5 dark:bg-slate-800 dark:text-slate-400 px-1.5 py-0.5 text-[10px]">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">Ничего не найдено</div>
          ) : (
            results.map(({ section, items }) => (
              <div key={section.id} className="mb-3 last:mb-0">
                <div className="px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{section.title}</div>
                <div className="space-y-1">
                  {items.map((item) => (
                    <MegaMenuItem
                      key={item.href}
                      item={item}
                      active={isActiveItem(pathname, item.href)}
                      onNavigate={onClose}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function TopNav() {
  const pathname = usePathname()
  const session = useNavSession()
  const [openSectionId, setOpenSectionId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const baseSections = useMemo(() => {
    if (!session.isSuperAdmin && session.staffRole === 'owner') {
      return buildOwnerNavSections()
    }
    return navSections
  }, [session.isSuperAdmin, session.staffRole])

  const visibleSections = useMemo(
    () => baseSections.map(session.filterSection).filter((section) => section.items.length > 0),
    [baseSections, session.filterSection],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setOpenSectionId(null)
  }, [pathname])

  // Внутри модуля «Магазин» верхнее меню скрыто — там свой StoreShell.
  if (pathname === '/store' || pathname.startsWith('/store/')) return null

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b border-slate-200 bg-white/90 dark:border-white/5 dark:bg-slate-950/90 backdrop-blur-xl md:block">
        <div className="flex h-14 items-center gap-3 px-4 xl:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <AppLogoMark />
            <div className="hidden xl:block">
              <h1 className="bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-base font-bold leading-tight text-transparent">
                {SITE_NAME}
              </h1>
              <p className="text-[10px] text-slate-500">v2.0.1</p>
            </div>
          </Link>

          <nav className="ml-2 flex flex-1 items-center gap-1">
            {visibleSections.map((section, index) => {
              const align: 'start' | 'center' | 'end' =
                index === 0 ? 'start' : index >= visibleSections.length - 2 ? 'end' : 'start'
              return (
                <SectionButton
                  key={section.id}
                  section={section}
                  pathname={pathname}
                  isOpen={openSectionId === section.id}
                  onOpen={() => setOpenSectionId(section.id)}
                  onClose={() => setOpenSectionId((current) => (current === section.id ? null : current))}
                  align={align}
                />
              )
            })}
          </nav>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-amber-500/20 hover:text-slate-900 dark:hover:text-white"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Поиск</span>
            <span className="hidden items-center gap-1 rounded-md border border-slate-200 bg-slate-100 text-slate-500 dark:border-white/5 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] dark:text-slate-300 lg:flex">
              <Command className="h-3 w-3" />K
            </span>
          </button>

          <ThemeToggle className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition hover:text-slate-900 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-400 dark:hover:text-white" />

          <NotificationsBell />

          <UserMenu
            onLogout={session.handleLogout}
            email={session.userEmail}
            displayName={session.displayName}
            roleLabel={session.roleLabel}
          />
        </div>
      </header>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        sections={visibleSections}
        pathname={pathname}
      />
    </>
  )
}
