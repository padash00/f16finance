'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { canAccessPath, type StaffRole } from '@/lib/core/access'
import { cn } from '@/lib/utils'
import {
  BarChart3,
  BrainCircuit,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarRange,
  ChevronDown,
  CreditCard,
  FolderKanban,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Logs,
  LogOut,
  Menu,
  MessageSquareText,
  Network,
  Radar,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Tags,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
  Users2,
  Wallet,
  Wrench,
  X,
  Zap,
  ClipboardCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

type NavItem = {
  href: string
  label: string
  icon: any
  note?: string
  badge?: string
}

type NavSection = {
  id: string
  title: string
  subtitle: string
  accent: string
  items: NavItem[]
}

const SIDEBAR_SCROLL_KEY = 'f16.sidebar.scrollTop'
const SIDEBAR_SECTIONS_KEY = 'f16.sidebar.sections'

const navSections: NavSection[] = [
  {
    id: 'command',
    title: 'Центр управления',
    subtitle: 'Главные экраны и сводка',
    accent: 'from-[#ffb36b] to-[#ff7b54]',
    items: [
      { href: '/', label: 'Главная панель', icon: LayoutDashboard, note: 'Общий статус бизнеса' },
      { href: '/analysis', label: 'AI Разбор', icon: BrainCircuit, note: 'Диагностика и выводы', badge: 'AI' },
      { href: '/reports', label: 'Отчёты', icon: BarChart3, note: 'Сводные метрики' },
      { href: '/weekly-report', label: 'Недельный отчёт', icon: CalendarRange, note: 'Ритм недели' },
    ],
  },
  {
    id: 'finance',
    title: 'Деньги',
    subtitle: 'Потоки, расходы и налоги',
    accent: 'from-[#70e1c8] to-[#2db7f5]',
    items: [
      { href: '/income', label: 'Доходы', icon: TrendingUp, note: 'Оборот и выручка' },
      { href: '/expenses', label: 'Расходы', icon: TrendingDown, note: 'Списания и статьи' },
      { href: '/categories', label: 'Категории', icon: Tags, note: 'Структура расходов' },
      { href: '/tax', label: 'Налоги', icon: Landmark, note: '3% и контроль базы' },
    ],
  },
  {
    id: 'team',
    title: 'Команда и зарплаты',
    subtitle: 'Люди, доступы и начисления',
    accent: 'from-[#f8d66d] to-[#f39f4f]',
    items: [
      { href: '/salary', label: 'Зарплата', icon: Wallet, note: 'Расчёты и выплаты' },
      { href: '/salary/rules', label: 'Правила зарплаты', icon: ListChecks, note: 'Ставки и бонусы' },
      { href: '/operators', label: 'Операторы', icon: Users2, note: 'Профили и состояние' },
      { href: '/structure', label: 'Структура', icon: Network, note: 'Иерархия команды и точек' },
      { href: '/staff', label: 'Сотрудники', icon: Users, note: 'Админкоманда' },
      { href: '/pass', label: 'Доступы', icon: KeyRound, note: 'Учётные записи' },
    ],
  },
  {
    id: 'ops',
    title: 'Операционная работа',
    subtitle: 'Планы, задачи и ритм',
    accent: 'from-[#8fc4ff] to-[#5b87ff]',
    items: [
      { href: '/kpi', label: 'KPI', icon: Target, note: 'Контроль выполнения' },
      { href: '/kpi/plans', label: 'Планы KPI', icon: Radar, note: 'План-факт' },
      { href: '/tasks', label: 'Задачи', icon: FolderKanban, note: 'Текущая работа' },
      { href: '/shifts', label: 'Смены', icon: CalendarClock, note: 'График и сменность' },
    ],
  },
  {
    id: 'operator-space',
    title: 'Операторское пространство',
    subtitle: 'Коммуникация и мотивация',
    accent: 'from-[#ee9ae5] to-[#5961f9]',
    items: [
      { href: '/operator-dashboard', label: 'Мой кабинет', icon: User, note: 'Сводка оператора' },
      { href: '/operator-tasks', label: 'Мои задачи', icon: ClipboardCheck, note: 'Личный контур задач', badge: 'new' },
      { href: '/operator-analytics', label: 'Аналитика операторов', icon: Zap, note: 'Эффективность по людям' },
      { href: '/operator-chat', label: 'Чат операторов', icon: MessageSquareText, note: 'Коммуникация', badge: 'live' },
      { href: '/operator-achievements', label: 'Достижения', icon: Trophy, note: 'Мотивация и XP' },
      { href: '/operator-settings', label: 'Настройки операторов', icon: Briefcase, note: 'Профильный контур' },
    ],
  },
  {
    id: 'system',
    title: 'Система',
    subtitle: 'Настройка и обслуживание',
    accent: 'from-[#8f9bb3] to-[#596780]',
    items: [
      { href: '/settings', label: 'Настройки системы', icon: Settings2, note: 'Компании и справочники' },
      { href: '/logs', label: 'Логирование', icon: Logs, note: 'Аудит, уведомления и события' },
      { href: '/debug', label: 'Диагностика', icon: Wrench, note: 'Проверки и отладка' },
    ],
  },
]

function LogoMark() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,164,84,0.26),rgba(59,130,246,0.22))] shadow-[0_18px_38px_rgba(0,0,0,0.34)]">
      <div className="absolute inset-[1px] rounded-[1.05rem] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_56%),linear-gradient(180deg,rgba(8,14,26,0.98),rgba(7,12,22,0.98))]" />
      <div className="absolute h-6 w-6 rounded-full border border-[#ffd27b]/35" />
      <Sparkles className="relative z-10 h-4 w-4 text-[#ffd27b]" />
    </div>
  )
}

function BrandHeader({
  roleLabel,
  moduleCount,
  sectionCount,
}: {
  roleLabel: string | null
  moduleCount: number
  sectionCount: number
}) {
  return (
    <div className="overflow-hidden rounded-[2.2rem] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(70,145,255,0.12),transparent_36%),linear-gradient(180deg,rgba(10,18,30,0.98),rgba(8,14,24,0.98))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.34)]">
      <div className="flex items-start gap-4">
        <LogoMark />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-[18px] font-semibold tracking-[-0.04em] text-white">F16 Finance</h1>
            <span className="rounded-full border border-[#8eb8ff]/18 bg-[#8eb8ff]/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#b8d2ff]">
              console
            </span>
          </div>
          <p className="mt-2 max-w-[18rem] text-[13px] leading-5 text-slate-400">
            Рабочая навигация по ролям, процессам и системным действиям.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Текущий контур</p>
            <p className="mt-2 text-[15px] font-semibold tracking-[-0.03em] text-white">
              {roleLabel || 'Панель управления'}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Доступно {moduleCount} экранов в {sectionCount} группах навигации.
            </p>
          </div>
          <div className="rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            active
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick?: () => void
}) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'group relative flex items-start gap-3 overflow-hidden rounded-[1.2rem] border px-3.5 py-3.5 transition-all duration-200',
        active
          ? 'border-[#86b8ff]/14 bg-[linear-gradient(135deg,rgba(75,128,255,0.16),rgba(255,255,255,0.03))] text-white shadow-[0_14px_28px_rgba(0,0,0,0.22)]'
          : 'border-transparent bg-transparent text-slate-300 hover:border-white/7 hover:bg-white/[0.035] hover:text-white',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border transition-all',
          active
            ? 'border-[#86b8ff]/15 bg-[#86b8ff]/10 text-[#d8b66c]'
            : 'border-white/6 bg-black/20 text-slate-400 group-hover:border-white/10 group-hover:text-[#d8b66c]',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium tracking-[-0.02em]">{item.label}</span>
          {item.badge ? (
            <span className="rounded-full border border-[#7ef0cf]/20 bg-[#7ef0cf]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7ef0cf]">
              {item.badge}
            </span>
          ) : null}
        </div>
        {item.note ? <p className="mt-1 text-xs leading-4 text-slate-500 group-hover:text-slate-400">{item.note}</p> : null}
      </div>

      {active ? <div className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[#d8b66c]" /> : null}
    </Link>
  )
}

function SidebarSection({
  section,
  pathname,
  open,
  onToggle,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  open: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const hasActiveItem = section.items.some((item) =>
    item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/'),
  )

  return (
    <section className="rounded-[1.7rem] border border-white/7 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.01))] p-2.5 shadow-[0_12px_24px_rgba(0,0,0,0.16)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-[1.25rem] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className={cn('h-10 w-1 rounded-full bg-gradient-to-b', section.accent)} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-[-0.025em] text-white">{section.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{section.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveItem ? (
            <span className="rounded-full border border-[#d8b66c]/18 bg-[#d8b66c]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#d8b66c]">
              open
            </span>
          ) : null}
          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', open && 'rotate-180 text-slate-200')} />
        </div>
      </button>

      {open ? (
        <div className="space-y-2 pb-1 pl-1.5 pr-1 pt-2.5">
          {section.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/')
            return <SidebarItem key={item.href} item={item} active={active} onClick={onNavigate} />
          })}
        </div>
      ) : null}
    </section>
  )
}

function UserCard({
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
  return (
    <div className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-[18px]">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-white/8 bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] text-white">
          <ShieldCheck className="h-5 w-5 text-[#d8b66c]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{displayName || 'Панель управления'}</p>
          <p className="truncate text-xs text-slate-500">{email || 'admin@system.local'}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-[#7ef0cf]/20 bg-[#7ef0cf]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7ef0cf]">
          <LifeBuoy className="h-3 w-3" />
          online
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <Building2 className="h-3 w-3" />
          {roleLabel || 'control'}
        </div>
      </div>

      <Button
        variant="ghost"
        onClick={onLogout}
        className="mt-4 h-11 w-full justify-between rounded-[1.2rem] border border-white/8 bg-white/[0.035] px-4 text-slate-300 hover:border-[#ff8f70]/20 hover:bg-[#ff8f70]/10 hover:text-white"
      >
        <span className="flex items-center gap-2">
          <LogOut className="h-4 w-4" />
          Выйти
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">exit</span>
      </Button>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hasRestoredScrollRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)
      if (raw) {
        try {
          return JSON.parse(raw) as Record<string, boolean>
        } catch {}
      }
    }

    return Object.fromEntries(navSections.map((section, index) => [section.id, index < 3]))
  })

  useEffect(() => {
    let ignore = false

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!ignore) {
        setUserEmail(user?.email || null)
      }

      const response = await fetch('/api/auth/session-role').catch(() => null)
      const json = await response?.json().catch(() => null)

      if (!ignore && response?.ok) {
        setIsSuperAdmin(!!json?.isSuperAdmin)
        setIsStaff(!!json?.isStaff)
        setIsOperator(!!json?.isOperator)
        setStaffRole((json?.staffRole as StaffRole | null) || null)
        setDisplayName((json?.displayName as string | null) || null)
        setRoleLabel((json?.roleLabel as string | null) || null)
      }
    }

    loadUser()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(openSections))
  }, [openSections])

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !scrollRef.current || hasRestoredScrollRef.current) return
    const saved = window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY)
    if (saved) {
      scrollRef.current.scrollTop = Number(saved) || 0
    }
    hasRestoredScrollRef.current = true
  }, [])

  const visibleSections = useMemo(() => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          return canAccessPath({
            pathname: item.href,
            isStaff,
            isOperator,
            staffRole,
            isSuperAdmin,
          })
        }),
      }))
      .filter((section) => section.items.length > 0)
  }, [isOperator, isStaff, isSuperAdmin, staffRole])

  const moduleCount = useMemo(
    () => visibleSections.reduce((sum, section) => sum + section.items.length, 0),
    [visibleSections],
  )

  useEffect(() => {
    const activeSection = visibleSections.find((section) =>
      section.items.some((item) => (item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/'))),
    )

    if (!activeSection) return

    setOpenSections((prev) => ({
      ...prev,
      [activeSection.id]: true,
    }))
  }, [pathname, visibleSections])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  const navContent = (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#06101a_0%,#08111d_35%,#09131f_100%)] text-white">
      <div className="flex items-center justify-between border-b border-white/6 px-5 py-4 md:px-6">
        <LogoMark />
        <button
          className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-slate-400 transition-colors hover:text-white md:hidden"
          onClick={() => setIsOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          if (typeof window === 'undefined') return
          window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(event.currentTarget.scrollTop))
        }}
        className="flex-1 overflow-y-auto px-5 py-5 md:px-6"
      >
        <div className="sticky top-0 z-10 -mx-1 bg-[linear-gradient(180deg,rgba(6,16,26,0.98),rgba(6,16,26,0.8),transparent)] px-1 pb-4 pt-1 backdrop-blur-xl">
          <BrandHeader roleLabel={roleLabel} moduleCount={moduleCount} sectionCount={visibleSections.length} />
        </div>

        <div className="mt-5 space-y-3.5 pl-1">
          {visibleSections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              pathname={pathname}
              open={!!openSections[section.id]}
              onToggle={() => toggleSection(section.id)}
              onNavigate={() => setIsOpen(false)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/6 px-5 py-4 md:px-6">
        <UserCard onLogout={handleLogout} email={userEmail} displayName={displayName} roleLabel={roleLabel} />
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/8 bg-[rgba(7,12,20,0.82)] px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em] text-white">F16 Finance OS</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">navigation</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="rounded-2xl border border-white/8 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-[rgba(3,6,12,0.75)] backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[94%] max-w-[26rem] border-r border-white/8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            {navContent}
          </div>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-[398px] shrink-0 border-r border-white/6 bg-[linear-gradient(180deg,#06101a_0%,#08111d_40%,#09131f_100%)] md:block xl:w-[422px]">
        {navContent}
      </aside>
    </>
  )
}
