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
      { href: '/operator-lead', label: 'Моя точка', icon: Building2, note: 'Команда и спорные смены точки', badge: 'lead' },
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
    <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[1rem] border border-[#d7ccb7]/12 bg-[linear-gradient(135deg,rgba(181,161,120,0.16),rgba(70,116,98,0.14))] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
      <div className="absolute inset-[1px] rounded-[0.9rem] bg-[linear-gradient(180deg,rgba(20,24,23,0.98),rgba(12,16,15,0.98))]" />
      <Sparkles className="relative z-10 h-4 w-4 text-[#d6b98b]" />
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
    <div className="rounded-[1.55rem] border border-[#d7ccb7]/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.008))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-3">
        <LogoMark />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#7f8f88]">Control room</p>
          <h1 className="mt-1 truncate text-[16px] font-semibold tracking-[-0.04em] text-[#f4efe5]">
            F16 Finance
          </h1>
          <p className="mt-1 text-[12px] leading-5 text-[#92a19a]">
            Спокойная навигация по ролям и рабочим зонам.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[1.2rem] border border-[#d7ccb7]/10 bg-[#0c1311]/70 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#6f7d76]">Активный контур</p>
            <p className="mt-1 truncate text-[14px] font-medium text-[#f4efe5]">
              {roleLabel || 'Панель управления'}
            </p>
          </div>
          <div className="rounded-full border border-[#8fb3a1]/18 bg-[#8fb3a1]/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#b8d8ca]">
            live
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-[#8a9992]">
          <span>{moduleCount} экранов</span>
          <span className="text-[#57635e]">•</span>
          <span>{sectionCount} секций</span>
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
        'group relative flex items-start gap-3 rounded-[1rem] px-3 py-2.5 transition-all duration-200',
        active
          ? 'bg-[linear-gradient(135deg,rgba(95,121,108,0.26),rgba(181,161,120,0.08))] text-[#f6f0e6] shadow-[0_8px_18px_rgba(0,0,0,0.18)]'
          : 'text-[#a9b3af] hover:bg-white/[0.035] hover:text-[#f6f0e6]',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.85rem] transition-all',
          active
            ? 'bg-[#d6b98b]/12 text-[#d6b98b]'
            : 'bg-black/20 text-[#7f8b86] group-hover:bg-white/[0.05] group-hover:text-[#d6b98b]',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium tracking-[-0.02em]">{item.label}</span>
          {item.badge ? (
            <span className="rounded-full border border-[#8fb3a1]/20 bg-[#8fb3a1]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#b8d8ca]">
              {item.badge}
            </span>
          ) : null}
        </div>
        {item.note ? <p className="mt-0.5 text-[10px] leading-4 text-[#6f7d76] group-hover:text-[#94a29b]">{item.note}</p> : null}
      </div>

      {active ? <div className="absolute inset-y-2.5 left-0 w-[2px] rounded-r-full bg-[#d6b98b]" /> : null}
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
    <section className="border-b border-[#d7ccb7]/8 pb-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-[0.9rem] px-2 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className={cn('h-6 w-1 rounded-full bg-gradient-to-b', section.accent)} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#c8d0cb]">{section.title}</p>
          <p className="mt-0.5 text-[10px] text-[#68756f]">{section.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveItem ? (
            <span className="rounded-full border border-[#d6b98b]/18 bg-[#d6b98b]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-[#d6b98b]">
              live
            </span>
          ) : null}
          <ChevronDown className={cn('h-4 w-4 text-[#62706a] transition-transform', open && 'rotate-180 text-[#d5ddd8]')} />
        </div>
      </button>

      {open ? (
        <div className="space-y-1.5 pt-2">
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
    <div className="rounded-[1.35rem] border border-[#d7ccb7]/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] p-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[0.95rem] border border-[#d7ccb7]/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] text-white">
          <ShieldCheck className="h-4 w-4 text-[#d6b98b]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#f4efe5]">{displayName || 'Панель управления'}</p>
          <p className="truncate text-[11px] text-[#6f7d76]">{email || 'admin@system.local'}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-[#8fb3a1]/20 bg-[#8fb3a1]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b8d8ca]">
          <LifeBuoy className="h-3 w-3" />
          online
        </div>
        <div className="flex items-center gap-1 rounded-full border border-[#d7ccb7]/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a9992]">
          <Building2 className="h-3 w-3" />
          {roleLabel || 'control'}
        </div>
      </div>

      <Button
        variant="ghost"
        onClick={onLogout}
        className="mt-3.5 h-10 w-full justify-between rounded-[0.95rem] border border-[#d7ccb7]/10 bg-white/[0.03] px-3 text-[#a7b2ad] hover:border-[#d6b98b]/18 hover:bg-[#d6b98b]/10 hover:text-[#f4efe5]"
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
  const [isLeadOperator, setIsLeadOperator] = useState(false)
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
        setIsLeadOperator(!!json?.isLeadOperator)
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
          if (item.href === '/operator-lead' && !isLeadOperator) {
            return false
          }
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
  }, [isLeadOperator, isOperator, isStaff, isSuperAdmin, staffRole])

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
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#0b0f10_0%,#101515_34%,#131918_100%)] text-white">
      <div className="flex items-center justify-between border-b border-[#d7ccb7]/8 px-4 py-3 md:px-4">
        <LogoMark />
        <button
          className="rounded-2xl border border-[#d7ccb7]/10 bg-white/[0.04] p-2 text-[#8a9992] transition-colors hover:text-white md:hidden"
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
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="sticky top-0 z-10 -mx-1 bg-[linear-gradient(180deg,rgba(11,15,16,0.98),rgba(11,15,16,0.82),transparent)] px-1 pb-3 pt-1 backdrop-blur-xl">
          <BrandHeader roleLabel={roleLabel} moduleCount={moduleCount} sectionCount={visibleSections.length} />
        </div>

        <div className="mt-4 space-y-3">
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

      <div className="border-t border-white/6 px-4 py-3.5 md:px-5">
        <UserCard onLogout={handleLogout} email={userEmail} displayName={displayName} roleLabel={roleLabel} />
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-[#d7ccb7]/8 bg-[rgba(11,15,16,0.86)] px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em] text-[#f4efe5]">F16 Finance</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#76837d]">workspace</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="rounded-2xl border border-[#d7ccb7]/10 bg-white/[0.04] text-[#a8b3ae] hover:bg-white/[0.08] hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-[rgba(3,6,12,0.75)] backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[84%] max-w-[19rem] border-r border-[#d7ccb7]/8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            {navContent}
          </div>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-[284px] shrink-0 border-r border-[#d7ccb7]/8 bg-[linear-gradient(180deg,#0b0f10_0%,#101515_36%,#131918_100%)] md:block xl:w-[296px]">
        {navContent}
      </aside>
    </>
  )
}
